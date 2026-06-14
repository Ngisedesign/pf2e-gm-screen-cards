// Vercel serverless function: "Smart" custom-monster fill.
// Takes a free-form text dump (a pasted stat block, rough notes, a description)
// and uses Claude Opus to map it onto the GM-screen custom-monster form fields.
// Returns { fields: { ...formFieldValues } } — every value is a string ("" when unknown).

const MODEL = 'claude-opus-4-8';

// All form fields the front-end can fill. Every property is a required string so the
// model always returns the full shape; unknown values come back as "".
const FIELD_KEYS = [
  'name', 'type', 'traits', 'level', 'cr', 'hp', 'ac', 'fort', 'ref', 'will',
  'str', 'dex', 'con', 'int', 'wis', 'cha',
  'strSave', 'dexSave', 'conSave', 'intSave', 'wisSave', 'chaSave',
  'immunities', 'resistances', 'weaknesses', 'speed', 'skills', 'senses',
  'abilities', 'attacks', 'spellTitle', 'spellDc', 'spellAttack', 'spells',
];

function buildSchema() {
  const properties = {};
  for (const k of FIELD_KEYS) {
    properties[k] = { type: 'string' };
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: FIELD_KEYS,
    properties,
  };
}

function systemPrompt(system) {
  const is5e = system === 'dnd5e';
  const common = `You convert a messy, pasted monster/creature description into structured form fields for a tabletop GM screen card builder.

Return ONLY the structured object. For every field, output a string. If a value is not present or not applicable, output an empty string "" — never guess or invent numbers that aren't supported by the input.

Shared field formats:
- name: the creature's name.
- type: size + type/family, e.g. "Huge Dragon" or "Medium Humanoid".
- traits: comma-separated tags, e.g. "Dragon, Fire, Uncommon".
- hp: just the number, e.g. "230".
- ac: just the number, e.g. "36".
- immunities / resistances / weaknesses: comma/space text as written, e.g. "fire, paralyzed" or "cold 10".
- speed: e.g. "50 ft., fly 100 ft.".
- skills: comma-separated "Skill +N", e.g. "Athletics +27, Arcana +28".
- attacks: ONE attack per line, formatted exactly "Name, bonus, damage, Melee/Ranged" — e.g. "Jaws, +27, 3d10+13 piercing, Melee". Use a newline between attacks.`;

  const pf2e = `
You are filling a PATHFINDER 2e stat block.
- level: integer as a string, e.g. "17".
- fort / ref / will: saving throw modifiers like "+24".
- abilities: ONE per line. Active abilities start with an action cost in brackets: [1], [2], [3] for actions, or [F] for free actions/reactions. Passive abilities have no bracket. Format "[cost] Name: description" or "Name: description". Example:
  [2] Breath Weapon: 40-foot cone, 13d6 fire, DC 34
  [F] Attack of Opportunity: Trigger - a creature leaves reach
  Aura of Flame: 10 ft., 2d6 fire to creatures ending their turn
- spellTitle: e.g. "Arcane Prepared Spells" (only if the creature casts spells).
- spellDc: just the number, e.g. "36". spellAttack: e.g. "+28".
- spells: spells grouped by rank, one rank per line, e.g. "6th: chain lightning, dominate". Separate ranks by newline.
- Leave the 5e-only fields (cr, str..cha, *Save, senses) as "".`;

  const fivee = `
You are filling a D&D 5th EDITION stat block.
- cr: challenge rating as a string, e.g. "24" or "1/2".
- str, dex, con, int, wis, cha: ability SCORES as numbers, e.g. "23". (Not modifiers.)
- strSave..chaSave: saving throw modifiers like "+14" ONLY if the creature has a listed save proficiency for that ability; otherwise "".
- senses: e.g. "darkvision 120 ft., passive Perception 26".
- abilities: ONE per line. Prefix with the action type in brackets: [A] action, [B] bonus action, [R] reaction, [L] legendary action. Passive traits get no bracket. Format "[type] Name: description" or "Name: description". Example:
  Legendary Resistance: If the dragon fails a save, it can choose to succeed instead.
  [A] Multiattack: The dragon makes three attacks.
  [L] Tail Attack: The dragon makes one tail attack.
- Leave the PF2e-only fields (level, fort, ref, will, spellTitle, spellDc, spellAttack, spells) as "".`;

  return common + (is5e ? fivee : pf2e);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Smart fill is not configured yet (missing ANTHROPIC_API_KEY on the server).',
    });
  }

  // Body may arrive parsed (Vercel) or as a raw string.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const text = (body && body.text ? String(body.text) : '').trim();
  const system = body && body.system === 'dnd5e' ? 'dnd5e' : 'pf2e';

  if (text.length < 10) {
    return res.status(400).json({ error: 'Please paste a bit more detail to work from.' });
  }
  if (text.length > 12000) {
    return res.status(400).json({ error: 'That is a lot of text — trim it down to the stat block and try again.' });
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        system: systemPrompt(system),
        messages: [
          {
            role: 'user',
            content: `Here is the monster to convert into ${system === 'dnd5e' ? 'D&D 5e' : 'Pathfinder 2e'} form fields:\n\n${text}`,
          },
        ],
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: buildSchema() },
        },
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic error:', anthropicRes.status, errText);
      const msg = anthropicRes.status === 401
        ? 'Smart fill auth failed — the server API key is invalid.'
        : `AI request failed (${anthropicRes.status}).`;
      return res.status(502).json({ error: msg });
    }

    const data = await anthropicRes.json();
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock || !textBlock.text) {
      return res.status(502).json({ error: 'AI returned no usable output.' });
    }

    let fields;
    try {
      fields = JSON.parse(textBlock.text);
    } catch {
      return res.status(502).json({ error: 'AI output could not be parsed.' });
    }

    // Keep only known string fields.
    const clean = {};
    for (const k of FIELD_KEYS) {
      clean[k] = typeof fields[k] === 'string' ? fields[k] : '';
    }

    return res.status(200).json({ fields: clean });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('parse-monster error:', message);
    return res.status(500).json({ error: 'Server error while parsing the stat block.' });
  }
}
