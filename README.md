# assassin-proxy-v2 — Assassin Search

Assassin Search is a static GitHub Pages interface plus a separately hosted Node.js API and SearXNG metasearch backend. Searches render in the page instead of navigating to DuckDuckGo. The backend can query multiple configured search engines through SearXNG; it does not scrape DuckDuckGo's private endpoints.

**Important:** GitHub Pages cannot run Node.js or API routes. To use full results, deploy the backend stack separately and connect its HTTPS origin in the page's **Search backend settings**. A deployment is not live just because the code is committed.

## Architecture

- `index.html`: static GitHub Pages UI; renders result cards in place.
- `server.mjs`: rate-limited search API, opt-in CORS, and optional allowlisted text reader.
- `searxng/settings.yml`: enables SearXNG's JSON output for the API.
- `Dockerfile` and `docker-compose.yml`: run the Node API and SearXNG together.
- Search API endpoint: `GET /api/search?q=...`.
- Optional page reader: `POST /api/read`; only configured allowlisted HTTPS hosts are supported.

## Deploy the stack

### Option A: Docker Compose

Requires Docker Compose. Generate a long random secret locally; do not commit it. For example, use a password manager or a command such as `openssl rand -hex 32`.

1. Clone this repository.
2. Set the following variables in your deployment environment (or an untracked `.env` file):
   - `SEARXNG_SECRET`: a unique, long random secret.
   - `SEARXNG_BASE_URL`: the public HTTPS URL of the SearXNG instance if you expose it; for the internal-only Compose service, the default is only a placeholder.
   - `ALLOWED_ORIGINS`: comma-separated exact browser origins allowed to call the API, e.g. your GitHub Pages origin. Do not include a path or trailing slash.
   - `READER_ALLOWED_HOSTS`: optional comma-separated hostname allowlist for the text reader. Leave empty to keep the reader disabled.
3. Start it with `docker compose up --build -d`.
4. Verify `https://YOUR-API-HOST/api/health` returns JSON. Search should return a clear setup error until the API can reach SearXNG and the SearXNG JSON format is enabled.
5. Deploy the static `index.html` using GitHub Pages with **Settings → Pages → Build and deployment → Source: GitHub Actions**.
6. Open the Pages URL, expand **Search backend settings**, enter your backend's HTTPS origin (not `/api/search`), and select **Connect**.

The default Compose port is 3000. Put the API behind a TLS-terminating reverse proxy before exposing it publicly. Do not expose the SearXNG container port directly to the internet. The API's browser CORS allowlist is not authentication; add hosting-level abuse protection and monitoring for public deployments.

### Option B: Node API on a Node-capable host

Use Node.js 20 or newer. Install dependencies with `npm install`, set `SEARXNG_URL` to an accessible SearXNG instance with JSON output enabled, set `ALLOWED_ORIGINS` to the exact Pages origin, then run `npm start`. Configure the hosting platform to provide HTTPS. If using a different origin for the UI, the exact origin must be allowed by the API's CORS policy.

## Search behavior and privacy

- Searches stay in the current GitHub Pages tab; the result cards render locally in that page.
- The browser sends queries to your configured API. The API forwards them to your configured SearXNG service; SearXNG may contact upstream search engines. Review those services' policies.
- The configured API origin is held in `sessionStorage` for the current browser tab. Search queries and results are not saved by this frontend.
- Results' external links open in a new tab only when selected.
- This is not anonymity, a separate browser profile, or protection from local browser history, extensions, the operating system, or network monitoring.
- GitHub Pages alone cannot run the backend. Full results require the separately hosted API and metasearch service.

## Reader safety

The optional `/api/read` endpoint is restricted to HTTPS hosts listed in `READER_ALLOWED_HOSTS`, applies timeouts, size and redirect limits, and extracts text without executing remote scripts. It is disabled unless the host allowlist is configured. It is a text reader, not a general-purpose browser emulator. The SSRF caveats in [SECURITY.md](SECURITY.md) still apply; do not expose it publicly without network egress controls.

## GitHub Pages workflow

The workflow checks the static frontend and deploys only the root `index.html`. It does not deploy the Node API or SearXNG. After merging, confirm the workflow succeeds in **Actions** and the published URL in **Settings → Pages**.

## Security

See [SECURITY.md](SECURITY.md) for transport encryption, trust boundaries, CORS, rate limits, SSRF limitations, and deployment checks.
