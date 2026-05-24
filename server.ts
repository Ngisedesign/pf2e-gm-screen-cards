import { serve, file } from "bun";

const ES_URL = "https://elasticsearch.aonprd.com/aon/_search";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function decodeHtml(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function dedupeResults(results: Array<{ image: string }>) {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (!result.image || seen.has(result.image)) return false;
    seen.add(result.image);
    return true;
  });
}

async function searchBingImages(query: string) {
  const encoded = encodeURIComponent(query);
  const response = await fetch(
    `https://www.bing.com/images/search?q=${encoded}&qft=+filterui:photo-photo&form=IRFLTR&first=1`,
    { headers: HEADERS }
  );
  if (!response.ok) throw new Error(`Bing search failed (${response.status})`);

  const html = await response.text();
  const results: Array<{ title: string; image: string; thumbnail: string; source: string }> = [];
  const richPattern =
    /murl&quot;:&quot;([^&]+?)&quot;.*?turl&quot;:&quot;([^&]+?)&quot;(?:.*?desc&quot;:&quot;([^&]*?)&quot;)?/g;
  let match: RegExpExecArray | null;
  while ((match = richPattern.exec(html)) !== null && results.length < 5) {
    results.push({
      title: decodeHtml(match[3] || query),
      image: decodeHtml(match[1]),
      thumbnail: decodeHtml(match[2]),
      source: "",
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
        source: "",
      });
    }
  }

  return dedupeResults(results).slice(0, 5);
}

async function searchImages(query: string) {
  try {
    const bingResults = await searchBingImages(query);
    if (bingResults.length > 0) return bingResults;
  } catch {
    // fall through
  }
  throw new Error("No images found. Try Replace to upload your own.");
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
