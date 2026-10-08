# Stedsfiler

Hvert flysted er én mappe i `src/flysteder/<id>/`. Mappenavnet er stedets id (små bokstaver, æ/ø/å skrevet som
ae/o/a, bindestrek i stedet for mellomrom), og det blir adressen: `/flysteder/<id>/` og `/en/sites/<id>/`.

| Fil | Påkrevd | Hva |
|---|---|---|
| `index.md` | ja | Data om stedet (front matter) og teksten (Markdown) |
| `index.en.md` | nei | Engelsk tekst. Se [Oversettelse](#oversettelse) |
| `<id>-route.gpx` | nei | Gangrute. Flere ruter: `<id>-route-1.gpx`, `<id>-route-2.gpx` … |
| `<id>-overview-1.jpg` osv. | nei | Bilder, se [Bilder](#bilder) |
| `<id>-drawing.geojson` | nei | Punkter, linjer og områder i kartet, se [Tegning](#tegning) |

Bygget stopper hvis noe er feil: ukjente nøkler, ugyldige retninger eller nivåer, bilder med feil navn, gangruter
som ikke finnes (`lib/validation.js`). Feilmeldingen sier hvilken fil og hvilket felt. Se et komplett eksempel i
`src/flysteder/elgen/index.md`.

## Front matter

Nøklene er på engelsk, verdiene og tekstene på norsk. Tomme felt skrives `null` og vises som «Ikke registrert ennå»,
aldri som gjettede verdier.

| Nøkkel | Hva |
|---|---|
| `name`, `id` | Navnet som vises, og id (lik mappenavnet). |
| `status`, `reviewed` | `utkast` eller `gjennomgått`. Gjennomgått krever `reviewed.by` (navn) og `reviewed.date` (`'2026-10-06'`). |
| `region` | For eksempel «Harstad og Kvæfjord» eller «Lofoten». Forsidekartet åpner over regionen i `src/_data/site.js`. |
| `municipality` | Kommunen starten ligger i, fra Kartverket (for eksempel «Kvæfjord»). Påkrevd. Søket på forsiden finner stedet på kommunen og regionen. |
| `external` | `flightlog_id`, `yr_id` (Yr-stedet nærmest starten), `pgearth_id` (bare når stedet finnes på Paraglidingearth). |
| `level` | `PP2`–`PP5`. Se [Nivå](#nivå). |
| `training_site` | `true` for kursplass. |
| `categories` | `PG`, `SPG`, `PPG`. |
| `season` | Fritekst, for eksempel «Vår til høst». |
| `wind_directions` | `primary` (hovedretninger), `possible` (mulige) og `source`. Koder: `N NE E SE S SW W NW`. |
| `wind_limits` | `max_wind` i m/s, når stedet tåler mindre enn den felles grensen (7 m/s). Brukes i vindvurderingen. |
| `launch` | Hovedstarten: `lat`, `lon`, `source`. |
| `launches` | Én linje per start eller retningsgruppe: `directions`, `categories`, `text`, og valgfritt egen `lat`/`lon` (maks 5 km fra `launch`). Kategoriene styrer hvilke retninger SPG-filteret bruker. |
| `landings` | `name`, `lat`, `lon`, `primary` (én hovedlanding), `source`. |
| `no_fixed_landing` | `true` når stedet ikke har fast landing (Ramnskogheia). Da skal `landings` være tom. |
| `parking` | Liste med `name`, `lat`, `lon`, `masl` (høyde fra Kartverket) og `source`. |
| `access` | `parking_text`, `route_text`, `routes` (`file`, `name`, `km`, `elevation_gain_m`, `walk_time_min`) og `walk_time_min` uten rute. Lengde, stigning og tid på siden regnes ut fra GPX-filen. |
| `elevation` | `launch_masl`, `landing_masl`, `difference_m`, `source`. Høyder fra Kartverket. |
| `airspace` | Merknader til luftrom (`name`, `note`, eventuelt `type`, `lower`). Selve luftrommet hentes fra openAIP. |
| `hazards` | Farer for hele stedet: `title` og `text`. Vises i «Før du starter». |
| `links` | Egne lenker under «Logg og mer»: `title`, `text`, `url` (https). |

`source` brukes i kildelinjen nederst på siden: `gpx`, `manuell`, `Kartverket`, `flightlog`,
`flightlog/lokalkunnskap`, `Kartverket/flightlog`, `flightlog/gpx`, `gammel side`, `IPPC`.

## Tekst

Teksten under front matter har tre deler:

```markdown
Kort ingress, én–to setninger. Vises øverst, på forsidekortet og når siden deles.

## Start

Om startområdet.

## Landing

Om landingen.
```

Hver opplysning skal stå ett sted. Farer hører hjemme i `hazards`, adkomst i `access`, og punkter i kartet i
tegningen. Statussiden viser «starttekst» og «landingstekst» når avsnittet mangler eller bare er en plassholder.

## Nivå

Nivået er det laveste kompetansebeviset stedet passer for, etter NLF/HPS sitt regelverk (Sikkerhetssystem for HPS
og utdanningsprogrammene for paragliding og speedgliding):

- **PP2** krever elevstart: lett start og landing med god margin, ingen ledninger eller trær i en bred sektor ved
  starten, ingen stupstart, og en stor landing som nås med god høyde. Elever flyr i maks 5 m/s, målt som sterkeste
  kast.
- **PP3** gir rett til stupstart og topplanding (første gang med instruktør), og krever en definert hovedlanding
  som kan nås enkelt ved gliding.
- **SPG4** kreves for stupstart med speedglider.

Starter som krever mer enn stedets nivå, nevnes i teksten («Velger man en stupstart, er det PP3»).

## Bilder

Bildene finnes ut fra filnavnet, så stedsfilen har ingen bildeliste:

| Navn | Hva |
|---|---|
| `<id>-overview-<nr>.jpg` | Oversikt. Nr 1 er hovedbildet og bildet når siden deles. |
| `<id>-takeoff-<retning>-<nr>.jpg` | Start, retningen man ser mot (`se`, `nw` …). Retningen kan mangle. |
| `<id>-landing-<nr>.jpg` | Landing. |
| `<id>-landing-spg-<nr>.jpg` | Landing som er egen for SPG. |

Importer bilder med `npm run images`, som gir riktig navn, skalerer ned, fjerner GPS og annen metadata og skriver
inn fotograf og lisens. Navngiving av bilder før import står i [SPEC.md](../SPEC.md#innhold).

## Tegning

`<id>-drawing.geojson` er en vanlig GeoJSON-fil (kan tegnes i [geojson.io](https://geojson.io)) med
`properties.kind`:

- `label` (punkt): nummerert punkt med `title` og `text`. `style: hazard` gir farepunkt.
- `path` (linje): `style` `launch`, `flight`, `hazard` eller `info`, og `dashed`/`arrow`.
- `area` (område): `style` `hazard`, `launch`, `landing` eller `info`.

Start, landing, parkering, gangrute og retningsbuer tegnes fra stedsfilen og skal ikke ligge i tegningen. Se
`lib/drawing.js`.

## Oversettelse

`index.en.md` (og `index.<språk>.md` for andre språk) har bare tekst. Lister står i samme rekkefølge som i
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

- Mangler filen, vises den norske teksten med merknaden «not translated yet».
- Ukjente nøkler stopper bygget, så skrivefeil ikke stille gjør teksten norsk.
- Statussiden viser «engelsk tekst utdatert» når `index.md` er endret i Git etter `index.en.md`. Les da gjennom
  den engelske teksten og oppdater den.
- Stedsnavn står som på norsk. Ordbruk: launch, cliff launch, top landing, ridge soaring (hang og subhang),
  thermals, aerial cable (løypestreng), high-voltage power line (høyspent), landowner, m asl.
