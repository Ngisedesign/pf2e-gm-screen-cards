// Vercel serverless function to proxy Open5e API requests
// Handles monster search and full monster data fetching

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { q, slug } = req.query;

  try {
    // If slug is provided, fetch full monster data
    if (slug) {
      const response = await fetch(`https://api.open5e.com/v1/monsters/${encodeURIComponent(slug)}/`);
      if (!response.ok) {
        return res.status(response.status).json({ error: 'Monster not found' });
      }
      const monster = await response.json();
      return res.status(200).json(monster);
    }

    // Otherwise, search for monsters
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    // Open5e API search - search by name
    const searchUrl = `https://api.open5e.com/v1/monsters/?search=${encodeURIComponent(q)}&limit=10`;
    const response = await fetch(searchUrl);

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Open5e API error' });
    }

    const data = await response.json();

    // Transform results to match our expected format
    const results = (data.results || []).map(monster => ({
      slug: monster.slug,
      name: monster.name,
      cr: monster.cr || monster.challenge_rating,
      type: monster.type,
      size: monster.size,
      image: monster.img_main || null,
      // Include source info
      source: monster.document__title || 'Open5e'
    }));

    return res.status(200).json({ results });

  } catch (error) {
    console.error('Open5e API error:', error);
    return res.status(500).json({ error: 'Failed to fetch from Open5e' });
  }
}
