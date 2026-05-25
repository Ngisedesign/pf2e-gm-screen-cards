// Proxy AoN monster family pages and return member creatures for picker UI

const AON_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function decodeHtml(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function parseFamilyPage(html) {
  const h1Match = html.match(
    /<h1 class="title"><a href="MonsterFamilies\.aspx\?ID=\d+">([^<]+)<\/a>/i
  );
  const titleMatch = html.match(/<title>\s*([^-]+?)\s*-/i);
  const name = decodeHtml((h1Match && h1Match[1]) || (titleMatch && titleMatch[1]) || 'Unknown family').trim();

  const membersBlock = html.match(/<h3 class="framing">Members<\/h3>([\s\S]*?)(?=<h3)/i);
  const members = [];
  const subfamilies = [];
  if (membersBlock) {
    const block = membersBlock[1];
    const monsterPattern =
      /<a href="Monsters\.aspx\?ID=(\d+)"><u>([^<]+)(?:<\/u><\/a>|<\/a><\/u>)\s*\(Creature\s*(\d+)\)/gi;
    let match;
    while ((match = monsterPattern.exec(block)) !== null) {
      members.push({
        id: match[1],
        name: decodeHtml(match[2]).trim(),
        level: parseInt(match[3], 10),
      });
    }

    if (members.length === 0) {
      const subfamilyPattern =
        /<a href="MonsterFamilies\.aspx\?ID=(\d+)"><u>([^<]+)(?:<\/u><\/a>|<\/a><\/u>)/gi;
      while ((match = subfamilyPattern.exec(block)) !== null) {
        subfamilies.push({
          id: match[1],
          name: decodeHtml(match[2]).trim(),
        });
      }
    }
  }

  return { name, members, subfamilies };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawId = (req.query.id || '').trim();
  const familyId = rawId.replace(/\D/g, '');
  if (!familyId) {
    return res.status(400).json({ error: 'Missing id parameter' });
  }

  try {
    const response = await fetch(
      `https://2e.aonprd.com/MonsterFamilies.aspx?ID=${familyId}`,
      { headers: AON_HEADERS }
    );

    if (!response.ok) {
      return res.status(502).json({ error: `AoN request failed (${response.status})` });
    }

    const html = await response.text();
    const { name, members, subfamilies } = parseFamilyPage(html);

    if (members.length === 0 && subfamilies.length === 0) {
      return res.status(404).json({
        error: 'No member creatures found on this family page. Paste a Monsters.aspx URL instead.',
        name,
        familyId,
      });
    }

    return res.status(200).json({ familyId, name, members, subfamilies });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}
