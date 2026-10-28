# assassin-proxy-v2 — DuckDuckGo & Reader

A DuckDuckGo search homepage that works without a search API key, plus an optional Node.js text reader for explicitly allowlisted public HTTPS pages.

## Requirements

- Node.js 20+
- A deliberate server-side host allowlist to enable the optional reader

## Run locally

```sh
npm install
cp .env.example .env
```

Set `READER_ALLOWED_HOSTS` in `.env` if you want to enable the reader, then start the server:

```sh
set -a; . ./.env; set +a
npm start
```

Open http://localhost:3000. Searches navigate directly to DuckDuckGo using your browser; no search API key or search backend is required.

- `READER_ALLOWED_HOSTS`: comma-separated hostnames/domains the page reader may fetch. Example: `example.com,docs.example.org`. Empty means reader access is disabled.
- `PORT`: optional server port (default `3000`).

## Endpoints

- `GET /api/health` — reports whether reader configuration is present.
- `POST /api/read` with JSON `{"url":"https://example.com/page"}` — returns extracted title, description, plain text, and a limited list of links.

## Safety model and limitations

- The reader accepts HTTPS only, rejects URL credentials, nonstandard ports, IP-literal and local hostnames, checks DNS answers against private/reserved address ranges, validates each redirect, limits redirects and response size, and accepts HTML/plain text only.
- Configure a narrow allowlist. Do not expose the reader endpoint publicly without adding authentication and rate limiting.
- Page scripts are never executed; returned content is extracted into text. This is not a general-purpose proxy and does not provide network-filter bypass, anonymity, or cloaking.
- For production use, add outbound egress restrictions at the network/container layer and pin/validate resolved IPs at connection time to mitigate DNS rebinding; add authentication, per-user rate limits, logging and monitoring.

## Deploy

### Static search homepage (GitHub Pages)

The root `index.html` is a standalone search homepage. In GitHub, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. The workflow at `.github/workflows/deploy-pages.yml` publishes the root `index.html` whenever it changes on `main`. Open the **Actions** tab and check that **Deploy DuckDuckGo search homepage** succeeds, then use the Pages URL shown in **Settings → Pages**. The search form submits directly to `https://duckduckgo.com/?q=...`; it does not need Node.js, a backend, or an API key. The optional reader tab is hidden on static hosting because `/api/read` requires the Node server.

### Full app with the optional reader

Deploy to a Node.js 20+ host that supports outbound HTTPS and runs `npm start`. Set `READER_ALLOWED_HOSTS` as a server environment variable for the reader. No search provider key is needed.

## Security

See [SECURITY.md](SECURITY.md) for the data-flow boundaries, HTTPS/TLS guidance, application-layer encryption decisions, reader SSRF limitations, secrets handling, and deployment verification checklist.
