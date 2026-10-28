# assassin-proxy-v2 — DuckDuckGo Search

A static GitHub Pages search homepage. Searches are submitted directly to DuckDuckGo over HTTPS in a new tab. No search API key, Node.js server, search proxy, or database is needed for the Pages site.

## GitHub Pages deployment

1. In the repository, open **Settings → Pages**.
2. Set **Build and deployment → Source** to **GitHub Actions**.
3. Open the **Actions** tab and make sure **Deploy and verify DuckDuckGo search homepage** succeeds.
4. Open the Pages URL shown in **Settings → Pages**.

The workflow checks the search form's destination, HTTP method, query parameter, separate-tab behavior, and absence of backend API calls before deploying the root `index.html`.

## How search and separation work

- The form submits to `https://duckduckgo.com/?q=...` using the standard `q` parameter.
- Results open in a separate tab, leaving the GitHub Pages homepage open.
- This site does not store search history, use cookies or local storage, or send search queries to a project backend.
- DuckDuckGo receives the search query and normal connection metadata. Your browser may keep a history entry for the results tab.
- A website cannot create an isolated browser profile or prevent the operating system, browser, extensions, or network from observing their normal activity. For stronger local separation, open the Pages site in a separate browser profile or private window.

## Optional Node.js reader

The repository still contains `server.mjs` and `web-proxy/index.html` for the optional public-page reader when running on a Node.js host. **GitHub Pages cannot run Node.js or API endpoints**, so that reader is not part of the Pages deployment. The static homepage intentionally has no reader button that would fail on GitHub Pages.

To run the optional server separately, use Node.js 20+, run `npm install`, configure `READER_ALLOWED_HOSTS` on the server, and run `npm start`. Do not assume that the optional reader is available on the GitHub Pages URL.

## Security

See [SECURITY.md](SECURITY.md) for transport encryption, application boundaries, reader SSRF limitations, secrets handling, and production verification notes.
