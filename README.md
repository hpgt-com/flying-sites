# HPGT flysteder

Kildekoden til **[flysteder.hpgt.com](https://flysteder.hpgt.com)**, flystedsoversikten til Harstad Hang og Paragliderklubb (HPGT). Oversikten viser flysteder for paraglider og speedglider i området rundt Harstad og Kvæfjord, med vindretninger, farer, luftrom, gangrute, værvarsel og en grov vindvurdering fra MET.

Siden bygger videre på den gamle flystedsoversikten til Lars Sletten, som han har gitt til klubben.

> Oversikten er en grov guide. Klubben tar ikke ansvar for opplysninger om sikkerhet, luftrom eller grunneierforhold. Sjekk alltid [IPPC](https://ippc.no) før du flyr.

## Meld inn en endring

Har du rettelser, bilder eller nye opplysninger om et sted?

- Trykk **«Foreslå endring»** nederst på stedssiden. Da åpnes et skjema her på GitHub (krever konto).
- Eller si fra direkte til noen i klubben.

## Dokumentasjon

| Dokument | Innhold |
|---|---|
| [docs/arkitektur.md](docs/arkitektur.md) | Hvordan siden henger sammen, med tegninger: kilder, bygging, nettleser, språk, publisering, hva som er bygget og hva som er planlagt |
| [docs/stedsfiler.md](docs/stedsfiler.md) | Formatet på stedsfilene: alle feltene, tekst, nivå, bilder, tegning og oversettelse |
| [docs/drift.md](docs/drift.md) | Oppskrifter: nytt sted, gjennomgang, statussiden, vindvarsel, luftrom, bilder, statistikk, nytt språk, feilsøking |
| [SPEC.md](SPEC.md) | Spesifikasjonen: hva siden skal vise, og hvordan |
| [SECURITY.md](SECURITY.md) | Sikkerhet: CSP, kodeskanning og innstillinger i GitHub |

## Slik er repoet bygget opp

| Hvor | Hva |
|---|---|
| `src/flysteder/<id>/index.md` | Ett flysted: strukturerte data øverst (front matter), tekst under |
| `src/flysteder/<id>/index.en.md` | Engelsk tekst for stedet (valgfri, se `lib/translations.js`). Mangler den, vises den norske teksten med en merknad |
| `src/flysteder/<id>/` | Bilder (`<id>-overview-1.jpg`, `<id>-takeoff-se-1.jpg`, `<id>-landing-1.jpg`, `<id>-landing-spg-1.jpg`), gangruter (`<id>-route.gpx`) og tegning til kartet (`<id>-drawing.geojson`: punkter, linjer og områder, se `lib/drawing.js`) |
| `src/_data/` | Tårn (`towers.json`), felles vindgrenser (`windRules.json`), vindvarsel (`forecast.js`) og mellomlagret luftrom |
| `src/_includes/` | Sidemaler for forsiden og stedssidene |
| `src/assets/` | CSS, JavaScript og bilder |
| `lib/`, `scripts/` | Validering, GPX, bilder, luftrom og vedlikeholdsskript |
| `src/_i18n/` | Ordbøkene for norsk og engelsk (all fast tekst i maler og skript) |
| `docs/` | Dokumentasjon, se over |

Siden finnes på norsk og engelsk (`/en/`). Språkene står i `src/_data/languages.js`, og all fast tekst i maler og skript ligger i ordbøkene `src/_i18n/<språk>.json`. Nytt språk: legg det til i `languages.js` og lag en ordbok med samme nøkler som `nb.json`. Tekst som mangler i et språk, vises på norsk.

Nøklene i stedsfilene er på engelsk, verdiene og tekstene på norsk. Ukjente nøkler og ugyldige verdier stopper byggingen, så feil ikke kommer ut på siden. [Statussiden](https://flysteder.hpgt.com/status/) viser hva som mangler for hvert sted.

## Kjøre siden lokalt

Krever [Node.js](https://nodejs.org) 20 eller nyere.

```bash
npm ci
npm start
```

Siden kjører da på http://localhost:8080 og oppdateres når du lagrer.

Andre kommandoer:

| Kommando | Hva |
|---|---|
| `npm run build` | Bygger siden til `_site/` |
| `npm test` | Tester vindvurderingen, valideringen, tegningene, bildene, statussiden, språkstøtten og eksporten |
| `npm run images` | Sjekker alle bilder (størrelse, GPS-data) og krymper dem ved behov |
| `npm run images -- <filer eller mappe>` | Importerer bilder navngitt etter konvensjonen, f.eks. `Storlitinden_Takeoff_SE_1_DSC04968.jpg` (se SPEC). Alle bildene importeres, og bygget finner dem ut fra filnavnet |
| `npm run images -- <id> <felt> <fil>` | Importerer ett bilde til et sted med riktig navn og størrelse |
| `npm run airspace` | Henter luftrom fra openAIP (krever `OPENAIP_API_KEY`) |

## Publisering

- Alt som merges til `main` publiseres automatisk til GitHub Pages.
- Siden bygges også to ganger i timen, så vindvurderingen på forsiden har ferskt varsel. GitHub kan forsinke eller hoppe over planlagte kjøringer. Er varselet over 6 timer gammelt, slås vindvurderingen av. Kjør «Build and deploy» manuelt under Actions for å hente nytt varsel med en gang.
- Endringer går via en branch og en pull request. PR-sjekken bygger siden og stopper ugyldige stedsfiler.
- Luftrom hentes automatisk den 1. hver måned. Endringer kommer som en PR som gjennomgås før de publiseres.
- Dependabot foreslår oppdateringer av pakker og Actions én gang i måneden.
- Sikkerhet (Content-Security-Policy, CodeQL, dependency review, zizmor, innstillinger i GitHub): se [SECURITY.md](SECURITY.md).

## Kilder

- Kart: [Kartverket](https://www.kartverket.no/) (topografisk, gråtone og terrengskygge fra [høydedata.no](https://hoydedata.no)), [OpenTopoMap](https://opentopomap.org) og satellittbilde fra [Sentinel-2 cloudless](https://s2maps.eu) (EOX, CC BY-NC-SA 4.0)
- Høyder for start, landing og parkering: Kartverket
- Høyder til gangruter: Kartverket
- Vindvarsel: [MET Norge](https://api.met.no/) og [Yr](https://www.yr.no/)
- Høydevind (utkast, Sollifjellet): [Open-Meteo](https://open-meteo.com/) (CC BY 4.0)
- Nedbørsradar: [Rain Viewer](https://www.rainviewer.com/) (gratis for ikke-kommersiell bruk, med kreditering)
- Luftrom: [openAIP](https://www.openaip.net/) (CC BY-NC 4.0)
- Termikk: [thermal.kk7.ch](https://thermal.kk7.ch) (CC BY-NC-SA 4.0)
- Stedsbeskrivelser: den gamle flystedsoversikten til Lars Sletten, Flightlog og lokalkunnskap i klubben

## Åpne data

Flystedene publiseres også som åpne datafiler, laget ved hver bygging, så de alltid er oppdatert:

- **GeoJSON:** <https://flysteder.hpgt.com/flysteder.geojson> (QGIS, Leaflet, MapLibre og andre kart)
- **KML:** <https://flysteder.hpgt.com/flysteder.kml> (Google Earth, norgeskart.no, kartapper)

Filene inneholder starter med retninger, landinger, parkering, gangruter og klubbens punkter i kartet, men ikke stedstekstene. De lages i `lib/export.js`. Lisens: CC BY 4.0 med kreditering «Flysteder: HPGT flysteder (https://flysteder.hpgt.com)», se [LICENSE_DATA.md](LICENSE_DATA.md).

## Lisens

Koden (maler, skript, CSS og JavaScript) er MIT-lisensiert, se [LICENSE](LICENSE).

Innholdet tilhører klubben og dem som har bidratt, og er ikke omfattet av MIT-lisensen (de åpne datafilene har egen lisens, se over). Det gjelder tekstene om flystedene, tegningene og gangrutene i `src/flysteder/`. Ta kontakt med HPGT før du bruker innhold herfra andre steder.

Bildene er lisensiert under CC BY-NC 4.0 med fotografen oppgitt, se [LICENSE_IMAGES.md](LICENSE_IMAGES.md). Fotograf, copyright og lisens står i hvert bilde (EXIF/XMP) og i bildevisningen. Standardfotograf og lisens står i `src/_data/photoCredit.json`.

Data fra andre kilder følger lisensene deres, se [Kilder](#kilder).
