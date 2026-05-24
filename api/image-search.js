// Proxy DuckDuckGo image search to avoid CORS and keep search server-side

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://duckduckgo.com/',
};

const VQD_PATTERNS = [
  /vqd=['"]([\d-]+)['"]/,
  /vqd=([\d-]+)/,
  /name="vqd"\s+value="([\d-]+)"/,
];

function extractVqd(html) {
  for (const pattern of VQD_PATTERNS) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function fetchVqdFromHtmlSearch(query) {
  const body = new URLSearchParams({ q: query, b: '', kl: 'us-en' });
  const response = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`HTML search init failed (${response.status})`);
  }

  const html = await response.text();
  const vqd = extractVqd(html);
  if (!vqd) {
    throw new Error('Could not parse image search token from HTML search');
  }
  return vqd;
}

async function fetchVqdFromMainSearch(query) {
  const encoded = encodeURIComponent(query);
  const response = await fetch(`https://duckduckgo.com/?q=${encoded}&iax=images&ia=images`, {
    headers: HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Image search init failed (${response.status})`);
  }

  const html = await response.text();
  const vqd = extractVqd(html);
  if (!vqd) {
    throw new Error('Could not parse image search token from main search');
  }
  return vqd;
}

async function getVqd(query) {
  try {
    return await fetchVqdFromHtmlSearch(query);
  } catch {
    return fetchVqdFromMainSearch(query);
  }
}

async function searchImages(query) {
  const encoded = encodeURIComponent(query);
  const vqd = await getVqd(query);

  const jsonRes = await fetch(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encoded}&vqd=${vqd}&f=,,,,,&p=1`,
    { headers: HEADERS }
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
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}
