/**
 * AoN Monster Scraper
 * Run with: node scraper.js <monster_url_or_id>
 *
 * Extracts monster data from Archives of Nethys for PF2e
 */

const { chromium } = require('playwright');

async function scrapeMonster(urlOrId) {
  let url = urlOrId;
  if (/^\d+$/.test(urlOrId)) {
    url = `https://2e.aonprd.com/Monsters.aspx?ID=${urlOrId}`;
  }

  console.log(`Scraping: ${url}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(5000); // Wait for JS to render content

    const data = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      const result = {
        name: '',
        level: 0,
        type: '',
        traits: [],
        image: '',
        hp: 0,
        ac: 0,
        fort: '',
        ref: '',
        will: '',
        speed: '',
        abilities: [],
        attacks: [],
        source: ''
      };

      // Name and Level - look for the pattern ending in 'Creature N'
      const nameMatch = bodyText.match(/([A-Za-z][A-Za-z\s'-]+)\s*Creature\s*(\d+)/);
      if (nameMatch) {
        // Clean up name - remove navigation text that might be captured
        let name = nameMatch[1].trim();
        // Remove common prefixes that get captured
        name = name.replace(/^.*?(Weak|Elite|Print Stat Block)\s*/i, '');
        name = name.replace(/^[A-Z]\s*\|\s*/, ''); // Remove "A | B | C..." nav
        // Get last meaningful name
        const lines = name.split('\n');
        result.name = lines[lines.length - 1].trim();
        result.level = parseInt(nameMatch[2]);
      }

      // Image
      const imgs = Array.from(document.querySelectorAll('img'));
      const monsterImg = imgs.find(i => i.src && i.src.includes('Monsters'));
      result.image = monsterImg ? monsterImg.src : '';

      // HP
      const hpMatch = bodyText.match(/HP\s*(\d+)/);
      result.hp = hpMatch ? parseInt(hpMatch[1]) : 0;

      // AC
      const acMatch = bodyText.match(/AC\s*(\d+)/);
      result.ac = acMatch ? parseInt(acMatch[1]) : 0;

      // Saves
      const fortMatch = bodyText.match(/Fort(?:itude)?\s*\+?(\d+)/);
      result.fort = fortMatch ? '+' + fortMatch[1] : '';

      const refMatch = bodyText.match(/Ref(?:lex)?\s*\+?(\d+)/);
      result.ref = refMatch ? '+' + refMatch[1] : '';

      const willMatch = bodyText.match(/Will\s*\+?(\d+)/);
      result.will = willMatch ? '+' + willMatch[1] : '';

      // Speed - get until newline or Melee
      const speedMatch = bodyText.match(/Speed\s*([\d\w\s,\.]+feet[^M\n]*)/i);
      result.speed = speedMatch ? speedMatch[1].trim().replace(/\n.*/, '').substring(0, 50) : '';

      // Type line - Size + Type
      const typeMatch = bodyText.match(/(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+([A-Za-z\s]+?)(?=\s*Source|\s*Perception)/);
      result.type = typeMatch ? (typeMatch[1] + ' ' + typeMatch[2]).trim() : '';

      // Traits - common PF2e traits
      const commonTraits = ['Dragon', 'Arcane', 'Primal', 'Divine', 'Occult', 'Beast', 'Animal', 'Undead', 'Construct', 'Humanoid', 'Fiend', 'Celestial', 'Elemental', 'Amphibious', 'Aquatic', 'Fire', 'Cold', 'Electricity', 'Acid', 'Sonic', 'Evil', 'Good', 'Lawful', 'Chaotic', 'Rare', 'Uncommon', 'Unique', 'Aberration', 'Fey', 'Giant', 'Ooze', 'Plant', 'Fungus', 'Monitor', 'Swarm'];
      result.traits = commonTraits.filter(t => {
        const regex = new RegExp('\\b' + t + '\\b', 'i');
        return regex.test(bodyText);
      }).slice(0, 6);

      // Melee attacks - look for "Melee [one-action]" pattern
      const meleePattern = /Melee\s*\[one-action\]\s*(\w+[\w\s]*?)\s*\+(\d+)\s*\[([^\]]+)\][,\s]*Damage\s*([^\n]+)/gi;
      let match;
      while ((match = meleePattern.exec(bodyText)) !== null) {
        result.attacks.push({
          name: match[1].trim(),
          bonus: '+' + match[2],
          damage: match[4].trim().substring(0, 35),
          reach: match[3].substring(0, 25)
        });
      }

      // Ranged attacks
      const rangedPattern = /Ranged\s*\[one-action\]\s*(\w+[\w\s]*?)\s*\+(\d+)\s*\[([^\]]+)\][,\s]*Damage\s*([^\n]+)/gi;
      while ((match = rangedPattern.exec(bodyText)) !== null) {
        result.attacks.push({
          name: match[1].trim() + ' (R)',
          bonus: '+' + match[2],
          damage: match[4].trim().substring(0, 35),
          reach: match[3].substring(0, 25)
        });
      }

      // Key abilities - look for bold/action patterns
      const abilityPatterns = [
        /Aura of \w+/g,
        /Breath Weapon/gi,
        /\w+ Breath/g,
        /Swallow Whole/gi,
        /Grab/g,
        /Constrict/gi,
        /Rend/gi,
        /Trample/gi
      ];

      // Extract abilities from the text (simplified)
      const abilityNames = ['Aura of Disruption', 'Disruptive Breath', 'Share the Wealth', 'Capture Spell', 'Inexorable', 'Slough Skin', 'Swallow Whole', 'Thrash', 'Breach', 'Grab', 'Constrict', 'Trample'];

      abilityNames.forEach(name => {
        if (bodyText.includes(name)) {
          // Try to get description
          const descPattern = new RegExp(name + '[^A-Z]*?([A-Z][^.]+\\.)', 'i');
          const descMatch = bodyText.match(descPattern);
          result.abilities.push({
            name: name,
            desc: descMatch ? descMatch[1].substring(0, 80) : ''
          });
        }
      });

      result.abilities = result.abilities.slice(0, 4);

      // Source
      const sourceMatch = bodyText.match(/Source\s+([A-Za-z\s]+pg\.\s*\d+)/);
      result.source = sourceMatch ? sourceMatch[1].trim() : '';

      return result;
    });

    // Fallback for attacks if none found
    if (data.attacks.length === 0) {
      data.attacks = [{ name: 'See stat block', bonus: '', damage: '', reach: '' }];
    }

    console.log('Scraped:', data.name, 'Level', data.level);
    return data;

  } finally {
    await browser.close();
  }
}

// CLI usage
if (process.argv[2]) {
  scrapeMonster(process.argv[2])
    .then(data => {
      console.log('\n--- Result ---');
      console.log(JSON.stringify(data, null, 2));
    })
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

module.exports = { scrapeMonster };
