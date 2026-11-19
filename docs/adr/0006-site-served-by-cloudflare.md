# 0006: Site served by Cloudflare, with GitHub Pages as a fallback

- **Status:** Accepted
- **Date:** 2026-11-19

## Context
In November 2026 hpgt.com moved its name servers to Cloudflare, where the data service already runs
([0002](0002-data-service-cloudflare.md)). GitHub Pages cannot send HTTP headers of our own, so the site had no
HSTS and could be framed by other sites (a meta CSP cannot set `frame-ancestors`), and GitHub gives every file ten
minutes in the cache. Proxying GitHub Pages through Cloudflare would stop GitHub from renewing its certificate.

## Decision
The site is served by Cloudflare as static files (the Worker `flysteder`, Workers static assets,
`workers/site/wrangler.toml`), at flysteder.hpgt.com as a custom domain on the Worker. «Build and deploy» builds once
and publishes the same archive both to Cloudflare (job `cloudflare`) and to GitHub Pages, which stays ready as a
fallback. Headers come from `src/_headers`. The data service moved to its own address data.hpgt.com at the same
time, and both workers.dev addresses were turned off.

## Consequences
- Real security headers (HSTS, `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, Referrer-Policy,
  Permissions-Policy) and a year in the cache for the images, which have a hash in their names.
- Publishing now needs a secret: `CLOUDFLARE_SITE_TOKEN` in the environment `cloudflare`, made from the Worker so it
  can only publish `flysteder`. It expires 19.11.2027 and must be renewed (docs/operations.md).
- The custom domains for the site and the data service are dashboard settings, not in the Wrangler config, since the
  tokens may not touch DNS. They are listed in docs/operations.md.
- The build provenance and SBOM are still signed for the Pages archive; it is the same archive Cloudflare gets.
- Going back to GitHub Pages is a DNS change and takes minutes (docs/operations.md «The site on Cloudflare»).

## Alternatives considered
Proxying GitHub Pages through Cloudflare (breaks GitHub's certificate renewal, and two CDNs in a row), and Cloudflare
Pages connected to the repository (Cloudflare would build from GitHub with its own access to the repository, outside
the tests, the template check and the signing in GitHub Actions).
