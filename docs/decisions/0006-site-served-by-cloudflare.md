# 0006: Siden serveres av Cloudflare, med GitHub Pages som reserve

- **Status:** Vedtatt
- **Dato:** 2026-11-19

## Bakgrunn
Navnetjenerne for hpgt.com ligger i Cloudflare, der datatjenesten også kjører ([0002](0002-data-service-cloudflare.md)).
GitHub Pages kan ikke sende egne HTTP-headere, så siden fikk ikke HSTS og kunne rammes inn av andre sider (en
meta-CSP kan ikke sette `frame-ancestors`), og GitHub gir hver fil ti minutter i mellomlageret. Å proxye GitHub Pages
gjennom Cloudflare ville hindret GitHub i å fornye sertifikatet.

## Beslutning
Siden serveres av Cloudflare som statiske filer (Workeren `flysteder`, Workers static assets,
`workers/site/wrangler.toml`), på flysteder.hpgt.com som custom domain på Workeren. «Bygg og publiser» bygger én gang
og publiserer det samme arkivet både til Cloudflare (jobben `cloudflare`) og til GitHub Pages, som står klar som
reserve. Headerne lages fra `src/headers.njk` (bygget til `_site/_headers`). Datatjenesten har egen adresse,
data.hpgt.com, og workers.dev-adressene er slått av.

## Konsekvenser
- Ekte sikkerhetsheadere (HSTS, `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, Referrer-Policy,
  Permissions-Policy) og ett år i mellomlageret for bildene, som har en hash i navnet.
- Publisering trenger en hemmelighet: `CLOUDFLARE_SITE_TOKEN` i miljøet `cloudflare`, laget fra Workeren så det bare
  kan publisere `flysteder`. Det utløper 19.11.2027 og må fornyes (docs/operations.md).
- Custom domains for siden og datatjenesten er innstillinger i dashbordet, ikke i Wrangler-oppsettet, siden tokenene
  ikke får røre DNS. De står i docs/operations.md.
- Byggeprovenance og SBOM signeres for Pages-arkivet; det er det samme arkivet Cloudflare får.
- Å gå tilbake til GitHub Pages er en DNS-endring og tar minutter (docs/operations.md «Siden på Cloudflare»).

## Alternativer som ble vurdert
Å proxye GitHub Pages gjennom Cloudflare (bryter GitHubs fornying av sertifikatet, og to CDN-er etter hverandre), og
Cloudflare Pages koblet til repoet (Cloudflare ville bygget fra GitHub med egen tilgang til repoet, utenfor testene,
malsjekken og signeringen i GitHub Actions).
