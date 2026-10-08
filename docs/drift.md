# Drift og vedlikehold

Praktiske oppskrifter for dem som vedlikeholder siden. Hvordan siden henger sammen står i
[arkitektur.md](arkitektur.md), og formatet på stedsfilene i [stedsfiler.md](stedsfiler.md).

## Kjøre siden lokalt

Krever Node.js 20 eller nyere.

```bash
npm ci          # installer pakkene
npm start       # http://localhost:8080, oppdateres når du lagrer
npm test        # testene i test/
npm run build   # bygger til _site/
```

`FORECAST_OFFLINE=1 npm run build` bygger uten å hente vindvarsel fra MET (raskere, og uten nett). Lokalt
mellomlagres varselet i `.cache/` i 30 minutter.

## Arbeidsflyt

1. Lag en branch og gjør endringen.
2. Åpne en pull request. PR-sjekken kjører testene og bygger siden. Ugyldige stedsfiler stopper den.
3. Merge til `main`. Siden publiseres automatisk etter noen minutter.

Endringer gjort av Claude eller andre bots vises i «Sist endret» som PR-en de kom fra (`lib/git.js`).

## Legge til et sted

1. Lag mappen `src/flysteder/<id>/` og kopier `index.md` fra et lignende sted.
2. Fyll inn `name`, `id`, `launch`, `wind_directions`, `landings` og `parking`. Hent høydene fra Kartverket
   (`https://ws.geonorge.no/hoydedata/v1/punkt?koordsys=4258&punkter=[[lon,lat]]`).
3. Sett `status: utkast` til stedet er gjennomgått.
4. Legg til gangrute (`<id>-route.gpx`, uten tidsstempler og pulsdata) og bilder (`npm run images`).
5. Kjør `npm run airspace` (krever `OPENAIP_API_KEY`), eller vent på den månedlige oppdateringen.
6. Skriv `index.en.md`, eller la statussiden minne om det.
7. Sjekk `/status/` etter bygging: den viser hva som mangler.

## Gjennomgang av et sted

Når stedet er kontrollert av noen som kjenner det, sett:

```yaml
status: gjennomgått
reviewed:
  by: Navn Navnesen
  date: '2026-10-06'
```

Bygget stopper hvis `status` og `reviewed` ikke stemmer overens.

## Statussiden

[`/status/`](https://flysteder.hpgt.com/status/) lages ved hver bygging (`lib/status.js`), er ikke lenket fra
menyen og er merket `noindex`. Den viser per sted:

| Sjekk | Mangler når |
|---|---|
| nivå, landing, parkering | feltet er tomt (landing ikke når `no_fixed_landing: true`) |
| parkeringstekst | parkering finnes i kartet, men `access.parking_text` mangler |
| gangrute | ingen GPX, og ingen parkering under 300 m fra starten og under 50 m lavere |
| starttekst, landingstekst | avsnittet mangler eller er en plassholder |
| høyder | `launch_masl` eller `landing_masl` mangler |
| startbilde, landingsbilde, oversiktsbilde | ingen bilder av den typen |
| luftrom | verken hentet fra openAIP eller registrert i stedsfilen |
| yr_id, flightlog_id | ikke koblet |
| engelsk tekst (utdatert) | `index.en.md` mangler, eller er eldre enn `index.md` |

## Vindvarsel

- Hentes fra MET ved hver bygging. `deploy.yml` bygger kl. xx:17 og xx:47, men GitHub kan forsinke eller hoppe
  over planlagte kjøringer.
- Er varselet over 6 timer gammelt (`maxForecastAgeHours` i `src/_data/windRules.json`), slås vindvurderingen av,
  og siden sier fra.
- **Hente nytt varsel med en gang:** Actions → «Build and deploy» → «Run workflow».
- Grensene for vurderingen står i `src/_data/windRules.json`. Stedets egen grense settes med
  `wind_limits.max_wind` i stedsfilen.

## Luftrom

- Hentes fra openAIP den 1. hver måned (`airspace.yml`). Er noe endret, kommer det som en PR som bør leses gjennom
  før merge.
- **Hente nå:** Actions → «Update airspace» → «Run workflow», eller `npm run airspace` lokalt.
- Nøkkelen ligger som repository secret `OPENAIP_API_KEY`. Uten den virker ikke oppdateringen.
- Merknader til luftrom (for eksempel at innflygingen går inn i Evenes CTR) skrives i stedsfilens `airspace`.
- Telefonnumrene til tårnene står bare i `src/_data/towers.json` (med navn per språk i `names`).

## Bilder

```bash
npm run images -- ~/Bilder/flysteder        # importerer alle bilder navngitt etter konvensjonen
npm run images -- elgen landing bilde.jpg    # ett bilde til et sted
npm run images                               # sjekker og krymper alle bildene i repoet
```

Navngiving før import: `Storlitinden_Takeoff_SE_1_DSC04968.jpg`, `Storlitinden_Landing_1_DSC05012.jpg`,
`Storlitinden_Overview_1_DJI_0042.jpg`. Se [SPEC.md](../SPEC.md#innhold). Standardfotograf og lisens står i
`src/_data/photoCredit.json`.

## Statistikk

- [GoatCounter](https://hpgt-flysteder.goatcounter.com), konto `hpgt-flysteder`. Anonymt og uten
  informasjonskapsler. Teller ikke på localhost.
- Skriptet er en kopi i `src/assets/js/goatcounter.js` (CSP tillater bare egne skript). Adressen står i
  `src/_data/site.js` og i CSP-en i `base.njk`.
- Hendelser (klikk) har faste navn på alle språk: `lenke/<domene><side>`, `nedlasting/<fil>`, `fane/…`,
  `filter/retning|nivå|kategori/…`, `filter/vind fra varsel/…`, `kart/valgt/<id>`, `kartlag/…`, `søk/uten treff/…`,
  `bilder<side>`, `fullskjerm<side>`, `innstilling/…`.
- Egne besøk telles ikke etter at man har åpnet `https://flysteder.hpgt.com/#toggle-goatcounter` i nettleseren.

## Legge til et språk

1. Legg språket til i `src/_data/languages.js`: `code`, `name` (som det skrives på språket selv), `locale`
   (for Open Graph), `prefix` (`/de`) og `slugs` (adresser: `{ flysteder: "orte", luftrom: "tuerme" }`).
2. Kopier `src/_i18n/en.json` til `src/_i18n/<code>.json` og oversett verdiene. Nøkler som mangler, vises på norsk.
3. Legg til språknavnet på norsk i `LANGUAGE_WORDS` i `lib/status.js`, så statussiden kan vise «tysk tekst».
4. Oversett stedene i `index.<code>.md`, eller la statussiden vise hva som mangler.
5. `npm test` sjekker at ordboken bare har nøkler som finnes i `nb.json`.

## Kontoer og hemmeligheter

| Hva | Hvor | Brukes til |
|---|---|---|
| `OPENAIP_API_KEY` | GitHub → Settings → Secrets | Månedlig henting av luftrom |
| GoatCounter `hpgt-flysteder` | goatcounter.com | Besøksstatistikk |
| GitHub Pages, domene | Settings → Pages, DNS-post for `flysteder.hpgt.com` | Publisering |

MET og Kartverket krever ingen nøkkel. MET krever at klienten oppgir kontaktinfo (`USER_AGENT` i
`src/_data/forecast.js`).

## Feilsøking

| Melding i bygget | Løsning |
|---|---|
| `ukjent nøkkel …` | Skrivefeil i front matter. Se tabellen i [stedsfiler.md](stedsfiler.md#front-matter). |
| `bildet … har feil navn` | Importer med `npm run images`, eller døp om etter mønsteret. |
| `gangruten … skal hete …` | Flere ruter skal hete `<id>-route-1.gpx`, `<id>-route-2.gpx`. |
| `status er «gjennomgått», men reviewed …` | Fyll inn `reviewed.by` og `reviewed.date`. |
| `index.en.md: ukjente nøkler …` | Skrivefeil i oversettelsen. Se [Oversettelse](stedsfiler.md#oversettelse). |
| Vindvurderingen mangler på siden | Varselet er for gammelt, eller MET svarte ikke. Kjør «Build and deploy» manuelt. |
| Luftromslaget sier «Kunne ikke hente luftrom» | `assets/airspace.geojson` mangler i bygget. Sjekk at `src/_data/cache/airspace/region.geojson` finnes. |
