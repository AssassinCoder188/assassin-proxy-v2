
const ALLOWED_HOSTS = new Set([
  "example.com",
  "www.example.com",
]);

export default {
  async fetch(request) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const incoming = new URL(request.url);

    if (incoming.pathname !== "/fetch") {
      return new Response("Proxy is running.", {
        headers: corsHeaders,
      });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders,
      });
    }

    const target = incoming.searchParams.get("url");

    let destination;
    try {
      destination = new URL(target);
    } catch {
      return new Response("Invalid URL", {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (
      destination.protocol !== "https:" ||
      !ALLOWED_HOSTS.has(destination.hostname) ||
      destination.username ||
      destination.password
    ) {
      return new Response("Destination not allowed", {
        status: 403,
        headers: corsHeaders,
      });
    }

    try {
      const upstream = await fetch(destination.toString(), {
        redirect: "manual",
        headers: {
          "Accept": "text/html,application/json",
        },
      });

      const headers = new Headers(corsHeaders);
      headers.set(
        "Content-Type",
        upstream.headers.get("Content-Type") ||
          "application/octet-stream"
      );
      headers.set("Cache-Control", "no-store");
      headers.set("X-Content-Type-Options", "nosniff");

      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      });
    } catch {
      return new Response("Upstream request failed", {
        status: 502,
        headers: corsHeaders,
      });
    }
  },
};
