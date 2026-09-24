# HPGT flysteder

Kildekoden til **[flysteder.hpgt.com](https://flysteder.hpgt.com)**, flystedsoversikten til Harstad Hang og Paragliderklubb (HPGT). Oversikten viser flysteder for paraglider og speedglider i området rundt Harstad og Kvæfjord, med vindretninger, farer, luftrom, gangrute, værvarsel og en grov vindvurdering fra MET.

Siden bygger videre på den gamle flystedsoversikten til Lars Sletten, som han har gitt til klubben.

> Oversikten er en grov guide. Klubben tar ikke ansvar for opplysninger om sikkerhet, luftrom eller grunneierforhold. Sjekk alltid [IPPC](https://ippc.no) før du flyr.

## Meld inn en endring

Har du rettelser, bilder eller nye opplysninger om et sted?

- Trykk **«Foreslå endring»** nederst på stedssiden. Da åpnes et skjema her på GitHub (krever konto).
- Eller si fra direkte til noen i klubben.

## Slik er repoet bygget opp

| Hvor | Hva |
|---|---|
| `src/flysteder/<id>/index.md` | Ett flysted: strukturerte data øverst (front matter), tekst under |
| `src/flysteder/<id>/` | Bilder (`<id>-overview.jpg`, `-launch`, `-landing`, `-air`) og gangruter (`<id>-route.gpx`) |
| `src/_data/` | Tårn (`towers.json`), vindgrenser (`windRules.json`), vindvarsel (`forecast.js`) og mellomlagret luftrom |
| `src/_includes/` | Sidemaler for forsiden og stedssidene |
| `src/assets/` | CSS, JavaScript og bilder |
| `lib/`, `scripts/` | Validering, GPX, bilder, luftrom og vedlikeholdsskript |
| `SPEC.md` | Full spesifikasjon: hva siden skal vise, og hvordan |

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
| `npm run images` | Sjekker alle bilder (størrelse, GPS-data) og krymper dem ved behov |
| `npm run images -- <id> <felt> <fil>` | Importerer et nytt bilde til et sted med riktig navn og størrelse |
| `npm run airspace` | Henter luftrom fra openAIP (krever `OPENAIP_API_KEY`) |

## Publisering

- Alt som merges til `main` publiseres automatisk til GitHub Pages.
- Siden bygges også hver time, så vindvurderingen på forsiden har ferskt varsel.
- Endringer går via en branch og en pull request. PR-sjekken bygger siden og stopper ugyldige stedsfiler.
- Luftrom hentes automatisk den 1. hver måned. Endringer kommer som en PR som gjennomgås før de publiseres.
- Dependabot foreslår oppdateringer av pakker og Actions én gang i måneden.

## Kilder

- Kart: [Kartverket](https://www.kartverket.no/) og [OpenTopoMap](https://opentopomap.org)
- Høyder til gangruter: Kartverket
- Vindvarsel: [MET Norge](https://api.met.no/) og [Yr](https://www.yr.no/)
- Luftrom: [openAIP](https://www.openaip.net/) (CC BY-NC 4.0)
- Termikk: [thermal.kk7.ch](https://thermal.kk7.ch) (CC BY-NC-SA 4.0)
- Stedsbeskrivelser: den gamle flystedsoversikten til Lars Sletten, Flightlog og lokalkunnskap i klubben

## Lisens

Koden er MIT-lisensiert, se [LICENSE](LICENSE).
