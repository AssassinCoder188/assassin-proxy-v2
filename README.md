# assassin-proxy-v2 — Search & Reader

A small Node.js app with a Brave Search homepage and a text-first reader for explicitly allowlisted public HTTPS pages.

## Requirements

- Node.js 20+
- A Brave Search API subscription key to enable search
- A deliberate server-side host allowlist to enable the reader

## Run locally

```sh
npm install
cp .env.example .env
```

Set values in `.env`, then start the server:

```sh
set -a; . ./.env; set +a
npm start
```

Open http://localhost:3000.

- `BRAVE_API_KEY`: Brave Search API key. It is only used server-side and is never sent to the browser.
- `READER_ALLOWED_HOSTS`: comma-separated hostnames/domains the page reader may fetch. Example: `example.com,docs.example.org`. Empty means reader access is disabled.
- `PORT`: optional server port (default `3000`).

## Endpoints

- `GET /api/health` — reports whether search and reader configuration are present.
- `GET /api/search?q=...` — returns up to 10 Brave web results.
- `POST /api/read` with JSON `{"url":"https://example.com/page"}` — returns extracted title, description, plain text, and a limited list of links.

## Safety model and limitations

- The reader accepts HTTPS only, rejects URL credentials, nonstandard ports, IP-literal and local hostnames, checks DNS answers against private/reserved address ranges, validates each redirect, limits redirects and response size, and accepts HTML/plain text only.
- Configure a narrow allowlist. Do not expose the reader endpoint publicly without adding authentication and rate limiting.
- Page scripts are never executed; returned content is extracted into text. This is not a general-purpose proxy and does not provide network-filter bypass, anonymity, or cloaking.
- For production use, add outbound egress restrictions at the network/container layer and pin/validate resolved IPs at connection time to mitigate DNS rebinding; add authentication, per-user rate limits, logging and monitoring.
- The Brave Search API key must be kept server-side and never committed. Do not put real secrets in `.env.example`.

## Deploy

Deploy to a Node.js 20+ host that supports outbound HTTPS. Configure `BRAVE_API_KEY` and `READER_ALLOWED_HOSTS` as server environment variables. Do not enable unrestricted host access.
