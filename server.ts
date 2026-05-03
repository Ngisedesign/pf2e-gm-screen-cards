import { serve, file } from "bun";

const ES_URL = "https://elasticsearch.aonprd.com/aon/_search";

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
