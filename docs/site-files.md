# Stedsfiler

Hvert flysted er én mappe i `src/sites/<id>/`. Mappenavnet er id-en til flystedet (små bokstaver, æ/ø/å skrevet som
ae/o/a, bindestrek i stedet for mellomrom), og det blir adressen: `/flysteder/<id>/` og `/en/sites/<id>/`.

| Fil | Påkrevd | Hva |
|---|---|---|
| `index.md` | ja | Data om flystedet (front matter) og teksten (Markdown) |
| `index.en.md` | nei | Engelsk tekst. Se [Oversettelse](#oversettelse) |
| `<id>-route.gpx` | nei | Gangrute. Flere ruter: `<id>-route-1.gpx`, `<id>-route-2.gpx` … |
| `<id>-overview-1.jpg` osv. | nei | Bilder, se [Bilder](#bilder) |
| `<id>-drawing.geojson` | nei | Punkter, linjer og områder i kartet, se [Tegning](#tegning) |

Bygget stopper hvis noe er feil: ukjente nøkler, ugyldige retninger eller nivåer, feil navngitte bilder, gangruter
som ikke finnes (`lib/validation.js`). Feilmeldingen sier hvilken fil og hvilket felt. Et komplett eksempel er
`src/sites/elgen/index.md`.

## Front matter

Nøklene er på engelsk; verdier og tekst er på norsk. Tomme felt skrives `null` og vises som «Ikke registrert ennå»,
aldri som gjetninger.

| Nøkkel | Hva |
|---|---|
| `name`, `id` | Navnet som vises, og id-en (samme som mappenavnet). |
| `status`, `reviewed` | `draft` eller `reviewed`. `reviewed` krever `reviewed.by` (navn) og `reviewed.date` (`'2026-10-06'`). |
| `region` | For eksempel «Harstad og Kvæfjord» eller «Lofoten». Kartet på forsiden åpner over regionen i `src/_data/site.js`. |
| `municipality` | Kommunen starten ligger i, fra Kartverket (for eksempel «Kvæfjord»). Påkrevd. Søket på forsiden finner flystedet på kommune og region. |
| `external` | `flightlog_id`, `yr_id` (stedet på Yr nærmest starten). |
| `level` | `PP2`–`PP5`. Se [Nivå](#nivå). |
| `training_site` | `true` for en kursplass. |
| `categories` | `PG`, `SPG`, `PPG`, `WINCH` (vinsj). Vises som «Vinsj» / «Winch». |
| `season` | Fritekst, for eksempel «Vår til høst». |
| `wind_directions` | `primary` (hovedretninger), `possible` og `source`. Koder: `N NE E SE S SW W NW`. |
| `wind_limits` | `max_wind` i m/s, når flystedet tåler mindre enn den felles grensen (7 m/s). Brukes i vindvurderingen. `soar_min_wind` i m/s: omtrent hvor mye vind som trengs for å holde seg oppe (soare) på flystedet, for eksempel en kystrygg. Endrer aldri vurderingen, siden flystedet kan flys uten (en tur ned): under grensen legger vurderingen bare til «Under 4 m/s: nok til en tur ned, men trolig for lite til å henge her», og stedssiden sier hvor mye som trengs. Må være lavere enn `max_wind` (eller 7). |
| `launch` | Hovedstarten: `lat`, `lon`, `source`. |
| `launches` | Én oppføring per start eller retningsgruppe: `directions`, `categories`, `text`, og eventuelt egen `lat`/`lon` (høyst 5 km fra `launch`). Kategoriene styrer hvilke retninger SPG-filteret bruker. |
| `landings` | `name`, `lat`, `lon`, `primary` (én hovedlanding), `source`. |
| `no_fixed_landing` | `true` når flystedet ikke har fast landing (Ramnskogheia). `landings` må da være tom. |
| `parking` | Liste med `name`, `lat`, `lon`, `masl` (høyde fra Kartverket) og `source`. |
| `access` | `parking_text`, `route_text`, `routes` (`file`, `name`, `km`, `elevation_gain_m`, `walk_time_min`) og `walk_time_min` når det ikke finnes noen rute. Lengde, stigning og tid på siden regnes ut fra GPX-filen. |
| `elevation` | `launch_masl`, `landing_masl`, `difference_m`, `source`. Høyder fra Kartverket. |
| `airspace` | Merknader om luftrom (`name`, `note`, eventuelt `type`, `lower`). Selve luftrommet hentes fra openAIP. |
| `hazards` | Farer for hele flystedet: `title` og `text`. Vises i «Før du starter». |
| `links` | Ekstra lenker under «Mer om stedet» i Lenker: `title`, `text`, `url` (https). |

`source` brukes i kildelinjen nederst på siden: `manual` (registrert for hånd), `gpx`, `kartverket`, `flightlog`,
`local_knowledge`, `flightlog/local_knowledge`, `kartverket/flightlog`, `flightlog/gpx`, `ippc`, `old_site` (den
gamle flystedsoversikten). Alle andre verdier stopper bygget (`SOURCES` i `lib/validation.js`).

## Tekst

Teksten under front matter har tre deler:

```markdown
Kort ingress, én–to setninger. Vises øverst, på forsidekortet og når siden deles.

## Start

Om startområdet.

## Landing

Om landingen.
```

Altså en kort ingress på én eller to setninger (vises øverst, på kortet på forsiden og når siden deles), så en del
`## Start` om startområdet og en del `## Landing` om landingen.

Hver opplysning hører hjemme ett sted. Farer står i `hazards`, adkomst i `access`, og punkter i kartet i tegningen.
Statussiden markerer «starttekst» og «landingstekst» når delen mangler eller bare er en plassholder.

## Nivå

Nivået er det laveste pilotbeviset flystedet passer for, etter reglene til NLF/HPS (Sikkerhetssystem for HPS og
utdanningsprogrammene for paragliding og speedflying):

- **PP2** krever en elevstart: enkel start og landing med god margin, ingen ledninger eller trær i en bred sektor
  rundt starten, ingen stupstart, og en stor landing som nås med god høyde. Elever flyr i høyst 5 m/s, målt som det
  sterkeste vindkastet.
- **PP3** tillater stupstart og topplanding (første gang med instruktør), og krever en definert hovedlanding som
  lett nås i glid.
- **SPG4** kreves for stupstart med speedwing.

Starter som krever mer enn nivået til flystedet, nevnes i teksten («Velger man en stupstart, er det PP3»).

## Bilder

Bildene finnes på filnavnet, så stedsfilen har ingen bildeliste:

| Navn | Hva |
|---|---|
| `<id>-overview-<nr>.jpg` | Oversikt. Nr. 1 er hovedbildet og bildet som brukes når siden deles. |
| `<id>-takeoff-<retning>-<nr>.jpg` | Start, navngitt etter retningen piloten vender mot (`se`, `nw` …). Retningen kan utelates. |
| `<id>-landing-<nr>.jpg` | Landing. |
| `<id>-landing-spg-<nr>.jpg` | En egen SPG-landing. |

Bilder importeres med `npm run images`, som gir dem riktig navn, skalerer dem ned, fjerner GPS og andre metadata,
og legger inn fotograf og lisens. Navngiving av bilder før import står i [SPEC.md](../SPEC.md#innhold).

## Tegning

`<id>-drawing.geojson` er en vanlig GeoJSON-fil (den kan tegnes i [geojson.io](https://geojson.io)) med
`properties.kind`:

- `label` (punkt): nummerert punkt med `title` og `text`. `style: hazard` gjør det til et farepunkt.
- `path` (linje): `style` `launch`, `flight`, `hazard` eller `info`, og `dashed`/`arrow`.
- `area` (område): `style` `hazard`, `launch`, `landing` eller `info`.

Start, landing, parkering, gangrute og retningsbuer tegnes fra stedsfilen og skal ikke stå i tegningen. Se
`lib/drawing.js`.

## Oversettelse

`index.en.md` (og `index.<språk>.md` for andre språk) inneholder bare tekst. Lister står i samme rekkefølge som i
`index.md`, og `- {}` hopper over et element som ikke trenger oversettelse:

```markdown
---
hazards:
  - title: Aerial cable at Innersand
    text: An aerial cable crosses the landing at Innersand.
launches:
  - text: Easy to find a launch spot on the top.
landings:
  - {}
  - name: Landing by the parking
parking:
  - name: Kasfjord cemetery
access:
  parking_text: At the campsite (fee).
  route_text: Follow the trail to the top.
routes:
  - name: from the parking
links:
  - title: …
    text: …
airspace:
  - note: …
season: Spring to autumn
---

Ingress.

## Launch

…

## Landing

…
```

- Mangler filen, vises den norske teksten med merknaden «The description of this site has not been translated yet
  and is shown in Norwegian.»
- Ukjente nøkler stopper bygget, så en skrivefeil ikke kan gjøre teksten norsk uten at det merkes.
- Statussiden viser «engelsk tekst utdatert» når `index.md` er endret i Git etter `index.en.md`. Les gjennom den
  engelske teksten og oppdater den.
- Stedsnavn står som på norsk. Terminologi på engelsk: launch, cliff launch (stupstart), top landing (topplanding),
  ridge soaring (henge og subhenge), thermals (termikk), aerial cable (løypestreng), high-voltage power line
  (høyspent), landowner (grunneier), m asl (moh.).
