import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { lookup } from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS || 0);
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 4;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allowedHosts = (process.env.READER_ALLOWED_HOSTS || "")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

app.disable("x-powered-by");
// Only set TRUST_PROXY_HOPS when the deployment proxy topology is known and
// the proxy strips client-supplied forwarding headers. Never blindly trust all proxies.
app.set("trust proxy", TRUST_PROXY_HOPS);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null
    }
  },
  referrerPolicy: { policy: "no-referrer" },
  crossOriginEmbedderPolicy: false
}));
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// Cross-origin API access is opt-in for a GitHub Pages frontend.
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin) {
    if (!allowedOrigins.includes(origin) && origin !== `http://localhost:${PORT}` && origin !== `http://127.0.0.1:${PORT}`) {
      return res.status(403).json({ error: "This website origin is not allowed to use the API." });
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
    if (req.method === "OPTIONS") return res.status(204).end();
  }
  next();
});

app.use(express.json({ limit: "16kb", strict: true }));
app.use(express.static(path.join(__dirname, "web-proxy"), {
  etag: true, maxAge: "5m", index: "index.html"
}));

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const n = address.split(".").map(Number);
    return n[0] === 0 || n[0] === 10 || n[0] === 127 ||
      (n[0] === 169 && n[1] === 254) ||
      (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
      (n[0] === 192 && n[1] === 168) ||
      (n[0] === 100 && n[1] >= 64 && n[1] <= 127) ||
      n[0] >= 224;
  }
  if (family === 6) {
    const a = address.toLowerCase();
    return a === "::" || a === "::1" || a.startsWith("fc") ||
      a.startsWith("fd") || a.startsWith("fe8") || a.startsWith("fe9") ||
      a.startsWith("fea") || a.startsWith("feb") || a.startsWith("ff") ||
      a.startsWith("::ffff:127.") || a.startsWith("::ffff:10.") ||
      a.startsWith("::ffff:192.168.");
  }
  return true;
}

function hostIsAllowed(host) {
  return allowedHosts.some(rule => host === rule || host.endsWith("." + rule));
}

async function validateTarget(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("Enter a valid URL."); }
  if (url.protocol !== "https:") throw new Error("Only HTTPS pages can be read.");
  if (url.username || url.password) throw new Error("URLs containing credentials are not allowed.");
  if (url.port && url.port !== "443") throw new Error("Only the standard HTTPS port is allowed.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || net.isIP(host)) {
    throw new Error("Local and IP-address destinations are not allowed.");
  }
  if (allowedHosts.length === 0 || !hostIsAllowed(host)) {
    throw new Error("This host is not on the reader allowlist. Configure READER_ALLOWED_HOSTS on the server.");
  }
  let records;
  try { records = await lookup(host, { all: true, verbatim: true }); }
  catch { throw new Error("Could not resolve the destination host."); }
  if (!records.length || records.some(record => isPrivateAddress(record.address))) {
    throw new Error("The destination resolves to a private or reserved network address.");
  }
  url.hash = "";
  return url;
}

async function fetchPublicPage(raw) {
  let current = await validateTarget(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, {
        method: "GET", redirect: "manual", signal: controller.signal,
        headers: { "User-Agent": "PublicPageReader/1.0", "Accept": "text/html,text/plain;q=0.9" }
      });
    } catch (error) {
      if (error.name === "AbortError") throw new Error("The destination timed out.");
      throw new Error("Could not fetch the destination page.");
    } finally {
      clearTimeout(timer);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || hop === MAX_REDIRECTS) throw new Error("Too many redirects.");
      current = await validateTarget(new URL(location, current).href);
      continue;
    }
    if (!response.ok) throw new Error("Destination returned HTTP " + response.status + ".");
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("text/html") && !type.includes("text/plain")) {
      throw new Error("Only HTML and plain-text pages are supported.");
    }
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) throw new Error("Page is larger than the 1.5 MB limit.");
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Page is larger than the 1.5 MB limit.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { body: new TextDecoder().decode(bytes), contentType: type, url: current.href };
  }
  throw new Error("Could not load destination.");
}

function extractReadable(body, contentType) {
  if (contentType.includes("text/plain")) return { title: "Plain-text page", description: "", text: body.slice(0, 60_000), links: [] };
  const $ = cheerio.load(body);
  $("script, style, noscript, iframe, frame, object, embed, svg, canvas, form, nav, footer, header, aside").remove();
  const title = $("title").first().text().trim();
  const description = $('meta[name="description"]').attr("content") || "";
  const main = $("main, article, [role=main]").first();
  const source = main.length ? main : $("body");
  const text = source.text().replace(/\s+/g, " ").trim().slice(0, 60_000);
  const links = [];
  source.find("a[href]").each((_, el) => {
    if (links.length >= 40) return false;
    const label = $(el).text().replace(/\s+/g, " ").trim();
    const href = $(el).attr("href");
    if (label && href) {
      try {
        const u = new URL(href, "https://invalid.example/");
        if (u.protocol === "https:") links.push({ label: label.slice(0, 180), url: u.href });
      } catch {}
    }
  });
  return { title, description: description.slice(0, 500), text, links };
}

const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many searches. Please wait before trying again." }
});

app.get("/api/search", searchLimiter, async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!query || query.length > 300) {
    return res.status(400).json({ error: "Enter a search query of 1–300 characters." });
  }
  const base = process.env.SEARXNG_URL || "";
  if (!base) {
    return res.status(503).json({ error: "Search backend is not configured. Set SEARXNG_URL to your SearXNG instance." });
  }
  let endpoint;
  try {
    endpoint = new URL("/search", base);
    if (endpoint.protocol !== "https:" && endpoint.hostname !== "searxng" && endpoint.hostname !== "localhost" && endpoint.hostname !== "127.0.0.1") {
      throw new Error("Search backend must use HTTPS outside a private deployment network.");
    }
  } catch {
    return res.status(503).json({ error: "SEARXNG_URL must be a valid HTTPS URL (or a private Docker/local URL)." });
  }
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("language", "all");
  endpoint.searchParams.set("safesearch", "1");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(endpoint, {
      headers: { "Accept": "application/json", "User-Agent": "AssassinSearch/1.0" },
      signal: controller.signal,
      redirect: "error"
    });
    if (!response.ok) {
      return res.status(502).json({ error: "Search provider returned HTTP " + response.status + "." });
    }
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("application/json")) {
      return res.status(502).json({ error: "Search provider did not return JSON. Enable the JSON format in SearXNG." });
    }
    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results.slice(0, 20).flatMap(item => {
      if (!item || typeof item.url !== "string" || typeof item.title !== "string") return [];
      let target;
      try { target = new URL(item.url); } catch { return []; }
      if (target.protocol !== "https:" && target.protocol !== "http:") return [];
      return [{
        title: item.title.slice(0, 300),
        url: target.href,
        snippet: typeof item.content === "string" ? item.content.slice(0, 1200) : "",
        engine: typeof item.engine === "string" ? item.engine.slice(0, 80) : ""
      }];
    }) : [];
    res.setHeader("Cache-Control", "no-store");
    return res.json({ query, results, count: results.length });
  } catch (error) {
    const message = error.name === "AbortError"
      ? "Search timed out. Please try again."
      : "Could not reach the configured search backend.";
    return res.status(502).json({ error: message });
  } finally {
    clearTimeout(timer);
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true, readerConfigured: allowedHosts.length > 0 }));

const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reader requests. Please wait before trying again." }
});

app.post("/api/read", readLimiter, async (req, res) => {
  const raw = typeof req.body?.url === "string" ? req.body.url.slice(0, 2048) : "";
  if (!raw) return res.status(400).json({ error: "Provide a page URL." });
  try {
    const page = await fetchPublicPage(raw);
    res.json({ url: page.url, page: extractReadable(page.body, page.contentType) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not read this page." });
  }
});

app.listen(PORT, () => {
  console.log("DuckDuckGo homepage + public-page reader listening on http://localhost:" + PORT);
  if (!allowedHosts.length) console.warn("Reader disabled until READER_ALLOWED_HOSTS is configured.");
});
