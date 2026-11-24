# HPGT flysteder

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/hpgt-com/flying-sites/badge)](https://scorecard.dev/viewer/?uri=github.com/hpgt-com/flying-sites)

Kildekoden til **[flysteder.hpgt.com](https://flysteder.hpgt.com)**, flystedsguiden til Harstad Hang og
Paragliderklubb (HPGT). Den viser paraglider- og speedflyingsteder rundt Harstad og Kvæfjord i Nord-Norge, med
vindretninger, farer, luftrom, gangruter, værvarsel, målt vind fra klubbens værstasjoner og en grov vindvurdering
basert på data fra MET og stasjonene.
Siden er på norsk, med en [engelsk versjon](https://flysteder.hpgt.com/en/).

Den bygger på Lars Slettens gamle flystedsoversikt, som han har overlatt til klubben.

> Guiden er bare en grov veiledning. Klubben tar ikke ansvar for opplysninger om sikkerhet, luftrom eller
> grunneiere. Sjekk alltid [IPPC](https://ippc.no) før du flyr.

## Foreslå en endring

Rettelser, bilder eller nye opplysninger om et flysted meldes på en av disse måtene:

- «Meld fra om endring» nederst på stedssiden, eller «Meld fra» i menyen. Skjemaet krever ingen konto og blir til en
  sak her på GitHub.
- Til noen i klubben, eller som en sak her på GitHub (krever konto).

## Dokumentasjon

| Dokument | Innhold |
|---|---|
| [docs/open-data.md](docs/open-data.md) | De åpne datafilene (GeoJSON og KML): hvordan hvert flysted er bygget opp, feltene og lisensen. For apper og andre som bruker dataene. |
| [docs/architecture.md](docs/architecture.md) | Hvordan siden henger sammen, med diagrammer: kilder, bygget, nettleseren, språk, publisering, funksjoner og hva som er planlagt. |
| [docs/site-files.md](docs/site-files.md) | Formatet på stedsfilene: alle felt, tekst, nivå, bilder, tegning og oversettelse. |
| [docs/decisions/](docs/decisions/README.md) | Beslutningsnotater (Architecture Decision Records): de viktige valgene, hvorfor de ble tatt og hva som ble valgt bort. |
| [docs/operations.md](docs/operations.md) | Fremgangsmåter: nytt flysted, gjennomgang, statussiden, vindvarsel, luftrom, bilder, statistikk, nytt språk, kontoer og hemmeligheter, runbook, katastrofegjenoppretting og feilsøking. |
| [SPEC.md](SPEC.md) | Spesifikasjonen: hva siden viser, og hvordan. |
| [SECURITY.md](SECURITY.md) | Sikkerhet: rapportering av sårbarheter, CSP, kodeskanning og GitHub-innstillinger. |

Dokumentasjonen holdes som kode: den ligger her, ved siden av det den beskriver, diagrammene er Mermaid (tekst som
GitHub viser som diagram), og den endres i samme pull request som koden. Innstillinger som gjøres i et dashbord
(Cloudflare, GitHub, Backblaze), skrives inn i [docs/operations.md](docs/operations.md) samme dag. Større valg får et
beslutningsnotat. Hemmeligheter skrives aldri ned, bare hvor de ligger.

## Mappestruktur

| Hvor | Hva |
|---|---|
| `src/sites/<id>/index.md` | Ett flysted: strukturerte data øverst (front matter), tekst under. |
| `src/sites/<id>/index.en.md` | Engelsk tekst for flystedet (valgfri, se `lib/translations.js`). Mangler den, vises den norske teksten med en merknad. |
| `src/sites/<id>/` | Bilder (`<id>-overview-1.jpg`, `<id>-takeoff-se-1.jpg`, `<id>-landing-1.jpg`, `<id>-landing-spg-1.jpg`), gangruter (`<id>-route.gpx`) og karttegningen (`<id>-drawing.geojson`: punkter, linjer og områder, se `lib/drawing.js`). |
| `src/_data/` | Tårn (`towers.json`), felles vindgrenser (`windRules.json`), været (`forecast.js`, `windgram.js`, lest fra `lib/weather/`), mellomlagret luftrom og kraftlinjer (`cache/`), og «Nytt på siden» (`news.json`). |
| `src/_includes/` | Sidemaler for forsiden og stedssidene. |
| `src/assets/` | CSS, JavaScript og bilder. |
| `lib/`, `scripts/` | Validering, GPX, bilder, luftrom, kraftlinjer, vær og vedlikeholdsskript. Se [Datamoduler](docs/architecture.md#datamoduler). |
| `workers/data/` | Datatjenesten på Cloudflare Workers: MET-varselet, værstasjonene (Holfuy og METs Frost), høydevind, hvor godt varselet treffer, piloter i lufta og flyaktivitet (Open Glider Network), og «Meld fra» som saker på GitHub, med arkivet i R2. Se [drift](docs/operations.md#værstasjoner-holfuy). |
| `workers/site/` | Wrangler-oppsettet for Workeren `flysteder`, som serverer siden på Cloudflare. |
| `src/_i18n/` | Ordbøker for norsk og engelsk (all fast tekst i maler og skript). |
| `docs/` | Dokumentasjon, se over. |

Siden finnes på norsk og engelsk (`/en/`). Språkene er definert i `src/_data/languages.js`, og all fast tekst i maler
og skript ligger i ordbøkene `src/_i18n/<språk>.json`. Et nytt språk legges til i `languages.js`, med en ordbok med
de samme nøklene som `nb.json` (se [docs/operations.md](docs/operations.md#nytt-språk)). Tekst som mangler i et
språk, vises på norsk.

Nøklene i stedsfilene er på engelsk; verdier og tekst er på norsk. Ukjente nøkler og ugyldige verdier stopper bygget,
så feil når aldri den publiserte siden. [Statussiden](https://flysteder.hpgt.com/status/) viser hva som mangler for
hvert flysted.

## Kjøre siden lokalt

Krever [Node.js](https://nodejs.org) 26 eller nyere (`.nvmrc`, `engines` i `package.json`).

```bash
npm ci
npm start
```

Siden kjører da på http://localhost:8080 og lastes på nytt ved lagring.

Andre kommandoer:

| Kommando | Hva |
|---|---|
| `npm run build` | Bygger siden til `_site/`. |
| `npm run lint` | ESLint med de anbefalte reglene (`eslint.config.js`): udefinerte navn, ubrukte variabler. Kjører også i PR-sjekken. |
| `npm test` | Tester vindvurderingen, valideringen, tegningene, bildene, statussiden, språkstøtten, eksporten, værstasjonene, høydevinden, OGN, turloggene og kraftlinjene. |
| `npm run images` | Sjekker alle bilder (størrelse, GPS-data) og krymper dem ved behov. |
| `npm run images -- <filer eller mappe>` | Importerer bilder navngitt etter konvensjonen, f.eks. `Storlitinden_Takeoff_SE_1_DSC04968.jpg` (se [SPEC.md](SPEC.md#innhold)). Alle bildene importeres, og bygget finner dem på filnavnet. |
| `npm run images -- <id> <felt> <fil>` | Importerer ett bilde for et flysted med riktig navn og størrelse. |
| `npm run airspace` | Henter luftrom fra openAIP (krever `OPENAIP_API_KEY`). |
| `npm run obstacles` | Henter kraftlinjer og hindre fra NVE og OpenStreetMap (`-- --no-osm` for bare NVE). |
| `npm run check:links` | Etter bygget: sjekker at hver intern lenke og hvert bilde i `_site/` peker på en fil som finnes. |
| `npm run check:html` | Etter bygget: validerer HTML-en på hver side (`.htmlvalidate.mjs`). |
| `npm run check:output` | Etter bygget: feiler hvis en side har «[object Object]», «undefined», «NaN» eller en plassholder som ikke er fylt inn. Kjører også i publiseringsbygget. |
| `npm run check:a11y` | Etter bygget: axe-sjekk av tilgjengeligheten på noen sider i Chromium (`npx playwright install chromium` først). |
| `npm run check:budget` | Etter bygget: ytelsesbudsjettet (byte per type, forespørsler, DOM-noder, layoutskift) for noen sider på en skjerm på størrelse med en telefon, mot grensene i `scripts/check-budget.mjs`. |
| `npm run check:behaviour` | Etter bygget: hva sidene gjør i Chromium (kartmarkører ved zoom, «Piloter i lufta», datatjenesten nede, «Meld fra», offline). |

## Publisering

- Alt som merges til `main`, publiseres automatisk til Cloudflare (flysteder.hpgt.com), og til GitHub Pages som
  reserve.
- Siden bygges bare når innholdet endres. Hvert bygg starter med et varsel som hentes i en egen jobb (`weather`);
  etter lasting henter sidene varselet, høydevinden og værstasjonene fra datatjenesten (`workers/data`) når den har
  nyere data, så de holder seg ferske mellom byggene.
- Bildevariantene (`_site/img`) mellomlagres mellom byggene i CI, så et bygg uten bildeendringer hopper over dem.
  Mellomlageret byttes når et bilde, bildekoden eller en pakke endres.
- Endringer går via en gren og en pull request. PR-sjekken bygger siden og stopper ugyldige stedsfiler, brutte
  interne lenker, ugyldig HTML og alvorlige tilgjengelighetsfeil.
- Luftrom hentes automatisk den 1. hver måned, og kraftlinjer og hindre den 2. Endringer kommer som en PR, som
  gjennomgås før publisering.
- Dependabot foreslår oppdateringer av pakker og Actions én gang i måneden.
- Sikkerhet (Content-Security-Policy, CodeQL, dependency review, zizmor, GitHub-innstillinger): se
  [SECURITY.md](SECURITY.md).

## Kilder

- Kart: [Kartverket](https://www.kartverket.no/) (topografisk, gråtone og terrengskygge fra
  [høydedata.no](https://hoydedata.no)), [OpenTopoMap](https://opentopomap.org) og satellittbilder fra
  [Sentinel-2 cloudless](https://s2maps.eu) (EOX, CC BY-NC-SA 4.0)
- Høyder for start, landing og parkering: Kartverket
- Høyder langs gangrutene: Kartverket
- Vindvarsel: [Meteorologisk institutt](https://api.met.no/) og [Yr](https://www.yr.no/)
- Høydevind, termikk, skyer, regn og vindkast for «Vind over starten» (Sollifjellet, Sætertinden, Heia, Kilhusåsen, Elgen): [Open-Meteo](https://open-meteo.com/) (CC BY 4.0)
- Målt vind: klubbens [Holfuy](https://holfuy.com/)-stasjoner og Meteorologisk institutts stasjoner ([Frost](https://frost.met.no/), CC BY 4.0)
- Piloter i lufta og flyaktivitet: [Open Glider Network](https://www.glidernet.org/) (ODbL)
- Nedbørsradar: [Rain Viewer](https://www.rainviewer.com/) (gratis for ikke-kommersiell bruk, med kreditering)
- Luftrom: [openAIP](https://www.openaip.net/) (CC BY-NC 4.0)
- Kraftlinjer, master og vindturbiner: [NVE](https://www.nve.no/) (NLOD); lavspentlinjer, taubaner og master: [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL)
- Termikk: [thermal.kk7.ch](https://thermal.kk7.ch) (CC BY-NC-SA 4.0)
- Beskrivelser av flystedene: Lars Slettens gamle flystedsoversikt, Flightlog og lokalkunnskap i klubben

## Åpne data

Flystedene publiseres også som åpne datafiler, som lages ved hvert bygg og derfor alltid er oppdaterte:

- **GeoJSON:** <https://flysteder.hpgt.com/flysteder.geojson> (QGIS, Leaflet, MapLibre og andre kart)
- **KML:** <https://flysteder.hpgt.com/flysteder.kml> (Google Earth, norgeskart.no, kartapper)

Filene inneholder starter med vindretninger, landinger, parkering, gangruter og klubbens kartmarkeringer, men ikke
beskrivelsene av flystedene. De lages i `lib/export.js`. Lisens: CC BY 4.0, kreditert som
«Flysteder: HPGT flysteder (https://flysteder.hpgt.com)». Se [docs/open-data.md](docs/open-data.md) for formatet
og [LICENSE_DATA.md](LICENSE_DATA.md) for lisensen.

<a id="licence"></a>

## Lisens

Koden (maler, skript, CSS og JavaScript) er MIT-lisensiert, se [LICENSE](LICENSE).

Innholdet tilhører klubben og bidragsyterne og dekkes ikke av MIT-lisensen (de åpne datafilene har egen lisens, se
over). Dette gjelder tekstene, tegningene og gangrutene i `src/sites/`. Kontakt HPGT før innhold herfra brukes andre
steder.

Bildene er lisensiert under CC BY-NC 4.0 med fotografen kreditert, se [LICENSE_IMAGES.md](LICENSE_IMAGES.md).
Fotograf, opphavsrett og lisens ligger i hvert bilde (EXIF/XMP) og vises i bildeviseren. Standard fotograf og
lisens settes i `src/_data/photoCredit.json`.

Data fra andre kilder følger sine egne lisenser, se [Kilder](#kilder).
