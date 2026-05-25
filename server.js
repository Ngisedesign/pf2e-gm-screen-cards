/**
 * GM Screen Cards Server
 * Serves the app and provides monster scraping API
 */

const http = require('http');
const { scrapeMonster } = require('./scraper');
const fs = require('fs');
const path = require('path');

const PORT = 8788;

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Proxy AoN monster family pages (member picker)
  if (url.pathname === '/api/family' && req.method === 'GET') {
    const familyId = (url.searchParams.get('id') || '').replace(/\D/g, '');
    if (!familyId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing id parameter' }));
      return;
    }

    try {
      const { parseFamilyPage } = await import('./api/family.js');
      const aonRes = await fetch(
        `https://2e.aonprd.com/MonsterFamilies.aspx?ID=${familyId}`,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        }
      );
      if (!aonRes.ok) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `AoN request failed (${aonRes.status})` }));
        return;
      }
      const html = await aonRes.text();
      const { name, members, subfamilies } = parseFamilyPage(html);
      if (members.length === 0 && subfamilies.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error:
              'No member creatures found on this family page. Paste a Monsters.aspx URL instead.',
            name,
            familyId,
          })
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ familyId, name, members, subfamilies }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API endpoint for scraping
  if (url.pathname === '/api/scrape' && req.method === 'GET') {
    const monsterUrl = url.searchParams.get('url');
    const monsterId = url.searchParams.get('id');

    if (!monsterUrl && !monsterId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing url or id parameter' }));
      return;
    }

    try {
      console.log(`Scraping: ${monsterUrl || monsterId}`);
      const data = await scrapeMonster(monsterUrl || monsterId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      console.error('Scrape error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static file serving
  let filePath = url.pathname;
  if (filePath === '/') filePath = '/index.html';

  const fullPath = path.join(__dirname, filePath);
  const ext = path.extname(fullPath);

  try {
    const content = fs.readFileSync(fullPath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`GM Screen Cards server running at http://localhost:${PORT}`);
  console.log(`API: GET /api/scrape?url=<aon_url> or ?id=<monster_id>`);
  console.log(`API: GET /api/family?id=<family_id>`);
});
