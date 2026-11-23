# AGENTS.md

Instruksjoner for kodeagenter og andre som jobber i repoet. Beskrivelsen av prosjektet står i [README.md](README.md).

## Prosjektet

Flystedsguiden flysteder.hpgt.com: en statisk Eleventy-side på Cloudflare, med datatjenesten data.hpgt.com som
Cloudflare Worker i `workers/data/`. Arkitekturen står i [docs/architecture.md](docs/architecture.md), og drift og
fremgangsmåter i [docs/operations.md](docs/operations.md).

## Kommandoer

| Kommando | Når |
|---|---|
| `npm ci --ignore-scripts` | Etter kloning og etter endringer i låsefilen |
| `npm start` | Utviklingsserver |
| `npm test` | Etter endringer i koden |
| `npm run lint` | Etter endringer i koden |
| `npm run build` | Før hver pull request |
| `npm run check:links`, `check:html`, `check:output` | Etter bygget |
| `npm run check:a11y`, `check:behaviour`, `check:budget` | Etter bygget, med Playwright (`npx playwright install chromium`) |

## Regler

- Følg de felles retningslinjene i https://github.com/hpgt-com/guidelines.
- Alle endringer går via pull request med grønne sjekker. Ikke push til `main`.
- Oppdater dokumentasjonen i samme pull request som endringen.
- Ingen hemmeligheter, tokens eller private opplysninger i repoet. Repoet er offentlig.
- Flystedene ligger i `src/sites/<id>/`. Formatet står i [docs/site-files.md](docs/site-files.md), og ukjente
  nøkler stopper bygget.
- All fast tekst i maler og skript ligger i ordbøkene i `src/_i18n/`, med de samme nøklene i alle språk.
- Innstillinger i Cloudflare, GitHub og Backblaze som ikke er kode, beskrives i
  [docs/operations.md](docs/operations.md).
