import express from "express";
import { lookup } from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BRAVE_API_KEY = process.env.BRAVE_API_KEY || "";
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 4;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allowedHosts = (process.env.READER_ALLOWED_HOSTS || "")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "web-proxy"), {
  etag: true, maxAge: "5m", index: "index.html"
}));
app.use(express.json({ limit: "16kb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  next();
});

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
  if (contentType.includes("text/plain")) return body.slice(0, 60_000);
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

app.get("/api/health", (_req, res) => res.json({ ok: true, searchConfigured: Boolean(BRAVE_API_KEY), readerConfigured: allowedHosts.length > 0 }));

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 300);
  if (!q) return res.status(400).json({ error: "Enter a search query." });
  if (!BRAVE_API_KEY) return res.status(503).json({ error: "Search is not configured. Set BRAVE_API_KEY on the server." });
  try {
    const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
    endpoint.searchParams.set("q", q);
    endpoint.searchParams.set("count", "10");
    const upstream = await fetch(endpoint, {
      headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_API_KEY },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!upstream.ok) return res.status(502).json({ error: "Brave Search returned HTTP " + upstream.status + "." });
    const data = await upstream.json();
    const results = (data.web?.results || []).slice(0, 10).map(item => ({
      title: String(item.title || "").slice(0, 300),
      url: String(item.url || ""),
      description: String(item.description || "").slice(0, 700)
    })).filter(item => {
      try { return new URL(item.url).protocol === "https:"; } catch { return false; }
    });
    res.json({ query: q, results });
  } catch {
    res.status(502).json({ error: "Search request failed. Please try again." });
  }
});

app.post("/api/read", async (req, res) => {
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
  console.log("Brave Search + public-page reader listening on http://localhost:" + PORT);
  if (!BRAVE_API_KEY) console.warn("Set BRAVE_API_KEY to enable search.");
  if (!allowedHosts.length) console.warn("Reader disabled until READER_ALLOWED_HOSTS is configured.");
});
