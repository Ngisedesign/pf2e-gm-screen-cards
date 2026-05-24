import { serve, file } from "bun";

const ES_URL = "https://elasticsearch.aonprd.com/aon/_search";
const DDG_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://duckduckgo.com/",
};

const VQD_PATTERNS = [
  /vqd=['"]([\d-]+)['"]/,
  /vqd=([\d-]+)/,
  /name="vqd"\s+value="([\d-]+)"/,
];

function extractVqd(html: string) {
  for (const pattern of VQD_PATTERNS) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function fetchVqdFromHtmlSearch(query: string) {
  const body = new URLSearchParams({ q: query, b: "", kl: "us-en" });
  const response = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { ...DDG_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`HTML search init failed (${response.status})`);
  const html = await response.text();
  const vqd = extractVqd(html);
  if (!vqd) throw new Error("Could not parse image search token from HTML search");
  return vqd;
}

async function fetchVqdFromMainSearch(query: string) {
  const encoded = encodeURIComponent(query);
  const response = await fetch(`https://duckduckgo.com/?q=${encoded}&iax=images&ia=images`, {
    headers: DDG_HEADERS,
  });
  if (!response.ok) throw new Error(`Image search init failed (${response.status})`);
  const html = await response.text();
  const vqd = extractVqd(html);
  if (!vqd) throw new Error("Could not parse image search token from main search");
  return vqd;
}

async function getVqd(query: string) {
  try {
    return await fetchVqdFromHtmlSearch(query);
  } catch {
    return fetchVqdFromMainSearch(query);
  }
}

async function searchImages(query: string) {
  const encoded = encodeURIComponent(query);
  const vqd = await getVqd(query);
  const jsonRes = await fetch(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encoded}&vqd=${vqd}&f=,,,,,&p=1`,
    { headers: DDG_HEADERS }
  );
  if (!jsonRes.ok) throw new Error(`Image search failed (${jsonRes.status})`);

  const data = await jsonRes.json();
  return (data.results || []).slice(0, 5).map((result: any) => ({
    title: result.title || "",
    image: result.image,
    thumbnail: result.thumbnail || result.image,
    source: result.url || "",
  }));
}

serve({
  port: 8788,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS headers for all responses
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Proxy Elasticsearch requests
    if (url.pathname === "/api/search") {
      try {
        const body = await req.text();
        const response = await fetch(ES_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        const data = await response.text();
        return new Response(data, {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (url.pathname === "/api/image-search") {
      const query = url.searchParams.get("q")?.trim();
      if (!query) {
        return new Response(JSON.stringify({ error: "Missing q parameter" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      try {
        const results = await searchImages(query);
        return new Response(JSON.stringify({ results }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Serve static files
    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const fullPath = `${import.meta.dir}${filePath}`;

    try {
      const f = file(fullPath);
      if (await f.exists()) {
        return new Response(f, { headers: corsHeaders });
      }
    } catch {}

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
});

console.log("GM Screen Cards server running on http://localhost:8788");
