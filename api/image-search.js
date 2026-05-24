// Image search proxy — Bing primary (works from serverless), DuckDuckGo fallback

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const VQD_PATTERNS = [
  /vqd=['"]([\d-]+)['"]/,
  /vqd=([\d-]+)/,
  /name="vqd"\s+value="([\d-]+)"/,
];

function decodeHtml(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function dedupeResults(results) {
  const seen = new Set();
  return results.filter((result) => {
    if (!result.image || seen.has(result.image)) return false;
    seen.add(result.image);
    return true;
  });
}

async function searchBingImages(query) {
  const encoded = encodeURIComponent(query);
  const response = await fetch(
    `https://www.bing.com/images/search?q=${encoded}&qft=+filterui:photo-photo&form=IRFLTR&first=1`,
    { headers: HEADERS }
  );

  if (!response.ok) {
    throw new Error(`Bing search failed (${response.status})`);
  }

  const html = await response.text();
  const results = [];

  const richPattern =
    /murl&quot;:&quot;([^&]+?)&quot;.*?turl&quot;:&quot;([^&]+?)&quot;(?:.*?desc&quot;:&quot;([^&]*?)&quot;)?/g;
  let match;
  while ((match = richPattern.exec(html)) !== null && results.length < 5) {
    results.push({
      title: decodeHtml(match[3] || query),
      image: decodeHtml(match[1]),
      thumbnail: decodeHtml(match[2]),
      source: '',
    });
  }

  if (results.length === 0) {
    const murls = [...html.matchAll(/murl&quot;:&quot;(https?:\/\/[^&]+?)&quot;/g)].map((m) => m[1]);
    const turls = [...html.matchAll(/turl&quot;:&quot;(https?:\/\/[^&]+?)&quot;/g)].map((m) => m[1]);
    for (let i = 0; i < Math.min(murls.length, 5); i++) {
      results.push({
        title: query,
        image: decodeHtml(murls[i]),
        thumbnail: decodeHtml(turls[i] || murls[i]),
        source: '',
      });
    }
  }

  return dedupeResults(results).slice(0, 5);
}

function extractVqd(html) {
  for (const pattern of VQD_PATTERNS) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function getDdgVqd(query) {
  const body = new URLSearchParams({ q: query, b: '', kl: 'us-en' });
  const htmlRes = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (htmlRes.ok) {
    const vqd = extractVqd(await htmlRes.text());
    if (vqd) return vqd;
  }

  const encoded = encodeURIComponent(query);
  const mainRes = await fetch(`https://duckduckgo.com/?q=${encoded}&iax=images&ia=images`, {
    headers: { ...HEADERS, Referer: 'https://duckduckgo.com/' },
  });

  if (!mainRes.ok) return null;
  return extractVqd(await mainRes.text());
}

async function searchDdgImages(query) {
  const encoded = encodeURIComponent(query);
  const vqd = await getDdgVqd(query);
  if (!vqd) return [];

  const jsonRes = await fetch(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encoded}&vqd=${vqd}&f=,,,,,&p=1`,
    { headers: { ...HEADERS, Referer: 'https://duckduckgo.com/' } }
  );

  if (!jsonRes.ok) return [];

  const data = await jsonRes.json();
  return (data.results || []).slice(0, 5).map((result) => ({
    title: result.title || '',
    image: result.image,
    thumbnail: result.thumbnail || result.image,
    source: result.url || '',
  }));
}

async function searchImages(query) {
  try {
    const bingResults = await searchBingImages(query);
    if (bingResults.length > 0) return bingResults;
  } catch {
    // fall through to DuckDuckGo
  }

  const ddgResults = await searchDdgImages(query);
  if (ddgResults.length > 0) return ddgResults;

  throw new Error('No images found. Try Replace to upload your own.');
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
