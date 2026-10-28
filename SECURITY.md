# Security architecture and operations

This document describes the security controls and limitations of assassin-proxy-v2. It is not a claim that a particular deployment has been independently audited.

## 1. Data-flow boundaries

### Static search homepage
The browser renders the static homepage and submits searches directly to DuckDuckGo using HTTPS. The app does not receive or store the search query when the native search form is used. DuckDuckGo receives the query, and the browser/network environment can still observe normal connection metadata. This design is not anonymous browsing and does not encrypt a query from the search provider.

### Optional page reader
The browser sends a URL to the Node.js API. The server validates it, fetches an allowlisted HTTPS page, extracts a limited amount of text, and returns JSON. The server necessarily sees the requested URL and retrieved content while processing the request. Do not describe this flow as end-to-end encrypted: TLS protects connections in transit, but it does not hide data from the application server or the destination website.

The app does not persist page content by design. If persistence, accounts, saved history, or analytics are added later, review the data model and threat model before adding encryption-at-rest.

## 2. Encapsulation boundaries

- index.html: static browser UI and direct DuckDuckGo navigation.
- web-proxy/index.html: Node-hosted UI variant with optional reader interaction.
- server.mjs: HTTP API, input validation, outbound fetch policy, content extraction, and security headers.
- package.json: explicit runtime and dependency boundary.
- Environment variables: deployment-specific configuration; secrets must not be committed.
- Hosting platform: TLS certificate issuance/renewal, network ingress policy, and runtime isolation.

Keep secrets, host policy, and deployment settings out of browser JavaScript. The browser is untrusted: every API input must be validated on the server. Treat all fetched page content as untrusted text, never execute returned scripts, and avoid inserting page content with innerHTML.

## 3. Transport encryption

### Browser to deployment
For production, serve the site and API over HTTPS with TLS 1.2 or newer (TLS 1.3 preferred). Use a managed platform or reverse proxy that correctly provisions and renews certificates. Redirect HTTP to HTTPS at the edge and enable HSTS only after confirming the whole intended hostname is HTTPS-capable. Do not commit private keys or certificates to the repository.

GitHub Pages serves only the static homepage and does not run the Node API. Its HTTPS protects the static site delivery; the reader API needs a separate Node-capable host with HTTPS. If the UI and API are hosted on different origins, configure a specific CORS allowlist and CSRF protections before enabling browser access; do not use wildcard CORS for a credentialed API.

### Server to destination
The reader permits HTTPS URLs only and validates every redirect against the host allowlist. TLS certificate validation should remain enabled; do not use insecure TLS flags or disable certificate verification. The reader's allowlist is a policy boundary, not a replacement for outbound network restrictions.

### Application-layer encryption
Do not add custom encryption around ordinary search requests: the browser must send the query to DuckDuckGo for search, and custom encryption would not prevent the recipient from reading it. Use standard TLS for transport. If a future feature stores sensitive data, choose a documented authenticated-encryption design (for example AES-256-GCM using a vetted library), keep keys outside the repository in a managed secret store/KMS, version keys, define rotation and recovery procedures, and never reuse a nonce with the same key. Do not invent a home-grown cipher or hard-code a key in frontend code.

## 4. HTTP security controls

The Node server uses Helmet for common security headers, including a Content Security Policy, no-sniff behavior, frame restrictions, and a no-referrer policy. The current UI uses inline scripts and styles, so the CSP allows inline script/style. A stronger future configuration should move these to external files or use per-response nonces/hashes before removing unsafe-inline.

The reader endpoint has a per-IP rate limit of 20 requests per 15-minute window. This is a basic abuse control, not authentication and not a complete distributed denial-of-service defense. A production deployment should also use host-level request limits, concurrency caps, timeouts, monitoring, and authentication if the reader is not meant to be public.

TRUST_PROXY_HOPS defaults to 0. Only set it to the exact trusted proxy hop count after checking the hosting provider's proxy topology and ensuring client-supplied forwarding headers are overwritten. Incorrect proxy trust can make IP-based rate limits unreliable.

## 5. Reader SSRF and egress protections

The reader accepts only HTTPS, rejects credentials in URLs, nonstandard ports, IP-literal/local hostnames, enforces a configured hostname allowlist, resolves the hostname and rejects many private/reserved address ranges, validates redirects, limits redirects and response size, applies a timeout, and accepts HTML/plain text only.

Important limitation: DNS validation followed by a separate hostname fetch can still be vulnerable to DNS rebinding because the HTTP client may resolve the name again. Application-level checks are not a complete SSRF boundary. For production, run the service with outbound network/egress rules that deny loopback, private, link-local, metadata-service, and other internal networks; ideally pin validated DNS results to the actual connection. Keep the allowlist narrow and avoid broad parent domains when only a few hosts are needed. Do not expose the reader publicly without authentication and additional rate limiting.

## 6. Secrets and repository hygiene

- Commit .env.example, never .env.
- Keep credentials, tokens, private keys, and production host allowlists in the deployment's secret/configuration store.
- Use least-privilege GitHub permissions. The Pages workflow requires contents read, Pages write, and ID-token write for deployment.
- Review dependency updates and run npm audit in a controlled development workflow.
- Do not log full URLs if their query strings may contain tokens or personal information.
- Avoid storing request bodies or page content in logs.
- Keep Node.js and dependencies supported and patched.

## 7. Verification checklist

Before calling a deployment production-ready, verify:

1. The actual public URL uses HTTPS and presents a valid certificate.
2. HTTP redirects to HTTPS at the hosting edge.
3. npm start succeeds after installing dependencies.
4. /api/health returns expected configuration status.
5. A host outside READER_ALLOWED_HOSTS is rejected.
6. HTTP, local hostnames, IP-literal targets, disallowed ports, and redirects to disallowed hosts are rejected.
7. Oversized or slow responses are stopped.
8. The reader rate limit returns HTTP 429 after its configured threshold.
9. Response headers include the expected Helmet security headers.
10. GitHub Actions deployment succeeds and the deployed homepage matches the intended root index.html.
11. Logs and repository history contain no secrets.
12. Outbound egress policy blocks internal networks independently of the application.

These checks must be run against the actual deployment. A successful code commit alone does not prove deployment or security controls are active.
