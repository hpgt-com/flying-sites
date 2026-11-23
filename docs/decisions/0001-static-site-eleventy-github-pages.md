# 0001: Statisk side med Eleventy på GitHub Pages

- **Status:** Erstattet av [0006](0006-site-served-by-cloudflare.md) for hostingen; den statiske siden med Eleventy står
- **Dato:** 2026-09

## Bakgrunn
Flystedsguiden må være billig, rask, trygg å drifte for frivillige og enkel å endre gjennom pull requests.

## Beslutning
Hvert flysted er en mappe med filer (`src/sites/<id>/`). Eleventy bygger hele siden i GitHub Actions, og GitHub Pages
serverer den på flysteder.hpgt.com. Bygget validerer hver stedsfil (`lib/validation.js`) og stopper ved feil.

## Konsekvenser
- Ingen server eller database for selve siden; all historikk ligger i Git, og hver endring gjennomgås i en PR.
- Data som må være ferske, kan ikke bare bakes inn ved bygging, så de kommer fra en egen datatjeneste ([0002](0002-data-service-cloudflare.md)).
- Byggene publiserer signert provenance og en SBOM (SECURITY.md).

## Alternativer som ble vurdert
Et CMS med database (mer å sikre og vedlikeholde), og hosting på Cloudflare (GitHub Pages holdt for selve siden, og
publiseringen trengte ingen hemmeligheter).
