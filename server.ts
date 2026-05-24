import { serve, file } from "bun";

const ES_URL = "https://elasticsearch.aonprd.com/aon/_search";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function searchImages(query: string) {
  const encoded = encodeURIComponent(query);
  const htmlRes = await fetch(`https://duckduckgo.com/?q=${encoded}&iax=images&ia=images`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!htmlRes.ok) throw new Error(`Image search init failed (${htmlRes.status})`);

  const html = await htmlRes.text();
  const vqdMatch = html.match(/vqd=([\d-]+)/);
  if (!vqdMatch) throw new Error("Could not initialize image search");

  const jsonRes = await fetch(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encoded}&vqd=${vqdMatch[1]}&f=,,,,,&p=1`,
    { headers: { "User-Agent": USER_AGENT } }
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
