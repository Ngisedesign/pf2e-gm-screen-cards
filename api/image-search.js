// Proxy DuckDuckGo image search to avoid CORS and keep search server-side

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function searchImages(query) {
  const encoded = encodeURIComponent(query);
  const htmlRes = await fetch(`https://duckduckgo.com/?q=${encoded}&iax=images&ia=images`, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!htmlRes.ok) {
    throw new Error(`Image search init failed (${htmlRes.status})`);
  }

  const html = await htmlRes.text();
  const vqdMatch = html.match(/vqd=([\d-]+)/);
  if (!vqdMatch) {
    throw new Error('Could not initialize image search');
  }

  const jsonRes = await fetch(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encoded}&vqd=${vqdMatch[1]}&f=,,,,,&p=1`,
    { headers: { 'User-Agent': USER_AGENT } }
  );

  if (!jsonRes.ok) {
    throw new Error(`Image search failed (${jsonRes.status})`);
  }

  const data = await jsonRes.json();
  return (data.results || []).slice(0, 5).map((result) => ({
    title: result.title || '',
    image: result.image,
    thumbnail: result.thumbnail || result.image,
    source: result.url || '',
  }));
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

  const query = (req.query.q || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Missing q parameter' });
  }

  try {
    const results = await searchImages(query);
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
