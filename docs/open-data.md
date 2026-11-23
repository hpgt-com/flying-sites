# Åpne data: HPGT flysteder

Paraglider- og speedflyingstedene rundt Harstad i Nord-Norge, publisert som åpne data av Harstad Hang og
Paragliderklubb (HPGT). Filene bygges på nytt fra stedsfilene i dette repoet hver gang siden publiseres (ved hver
endring), så adressene gir alltid gjeldende data.

| Fil | Adresse | Brukes til |
|---|---|---|
| GeoJSON | <https://flysteder.hpgt.com/flysteder.geojson> | Apper og kart (Leaflet, MapLibre, QGIS). Strukturerte felt, anbefalt for import. |
| KML | <https://flysteder.hpgt.com/flysteder.kml> | Google Earth, norgeskart.no og kartapper. Samme innhold, med lesbare navn og beskrivelser på norsk. |

Hent filene fra adressene i stedet for å kopiere dem én gang, så rettelser kommer med.

## Lisens

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Dataene kan brukes, deles og bearbeides, også
kommersielt, så lenge de krediteres slik:

> Flysteder: HPGT flysteder (https://flysteder.hpgt.com), CC BY 4.0

Se [LICENSE_DATA.md](../LICENSE_DATA.md). Dataene er bare veiledende og ikke for navigasjon. Sjekk alltid
stedssiden, IPPC (luftrom og NOTAM) og forholdene selv.

**Ikke med:** beskrivelsene av flystedene, farer og opplysninger om grunneiere. De hører hjemme på stedssidene, der
de holdes oppdatert og leses i sammenheng. Lenk til stedssiden (`site_url`) i stedet for å kopiere dem.

## Hvordan et flysted er bygget opp

Hvert flysted (`site_id`, for eksempel `elgen`) består av flere features:

- **Én hovedstart** (`kind: "launch"`, `main: true`). Dette er posisjonen til flystedet, med alle vindretninger,
  kategorier, nivå og høyde. Et flysted har ofte flere starter i ulike retninger eller for ulike kategorier
  (paragliding og speedflying). De står i `launch_groups` på hovedstarten.
- **Ekstra starter med egen posisjon** (`kind: "launch"`, `main: false`), der en start ligger langt nok fra
  hovedstarten til å få sitt eget punkt. Starter uten egen posisjon står bare i `launch_groups`.
- **Landinger** (`kind: "landing"`). `primary: true` er hovedlandingen, og `primary: false` er alternative
  landinger. Et flysted kan mangle landing helt, for eksempel når landingen er på myrene rundt fjellet.
- **Parkering** (`kind: "parking"`), én eller flere.
- **Gangruter** (`kind: "route"`), fra parkering til start, som linjer, med lenke til GPX-filen.
- **Klubbens kartmarkeringer** (`kind: "drawing_label"` for punkter, `"drawing_path"` for linjer, `"drawing_area"`
  for områder), for eksempel et navngitt punkt, en sti eller et landingsområde. Markeringer av farer er utelatt,
  som faretekstene.

### Eksempler

**Sollifjellet** (`sollifjellet`) har en hovedstart og flere starter med egen posisjon. Paragliding (PG) og
speedflying (SPG) deler starten mot Ø–S, mens PG også starter mot N–NØ og NV:

```
launch (main)      Sollifjellet            directions_primary: N, NE, E, SE, S, NW
launch             PG/SPG towards E, SE, S
launch             PG towards N, NE
launch             PG towards NW (two points)
landing (primary)  main landing
landing            SPG landing
parking, route, drawing_label …
```

**Elgen** (`elgen`) har ett startpunkt, men PG starter i alle retninger og SPG bare mot NØ–SV. Det står i
`launch_groups` på hovedstarten:

```json
"launch_groups": [
  { "categories": ["PG"], "directions": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] },
  { "categories": ["SPG"], "directions": ["NE", "E", "SE", "S", "SW"] }
]
```

Elgen har også en hovedlanding (Aun, i sør) og to alternative landinger (ved kapellet i nord, og i fjæra ved
Elgsnes).

## Felt (GeoJSON)

Koordinatene er WGS 84, `[lengdegrad, breddegrad]` som i GeoJSON. Samlingen har `name`, `generated` (ISO-tidspunktet
for bygget) og `license`.

**På hver feature**

| Felt | Beskrivelse |
|---|---|
| `site_id` | Stabil id for flystedet, brukes også i adressen til stedssiden. Brukes til å kjenne igjen flysteder mellom oppdateringer. |
| `site_name` | Navnet på flystedet. |
| `site_url` | Stedssiden (norsk). Den engelske siden har samme sti under `/en/sites/`. |
| `municipality` | Kommunen starten ligger i. |
| `kind` | `launch`, `landing`, `parking`, `route`, `drawing_label`, `drawing_path` eller `drawing_area`. |
| `name` | Navnet på featuren. |
| `source` | Hvor posisjonen kommer fra (se under). `null` når den ikke er registrert, alltid `null` på gangruter og tegninger. |

**Hovedstart** (`kind: "launch"`, `main: true`)

| Felt | Beskrivelse |
|---|---|
| `directions_primary` | Hovedretninger for vinden, i kompassrekkefølge. |
| `directions_possible` | Retninger som kan fungere, men er mindre ideelle. |
| `launch_groups` | `[{ categories, directions }]`, én oppføring per type start. |
| `categories` | `PG` (paragliding), `SPG` (speedflying), `PPG` (paramotor), `WINCH` (vinsjslep). |
| `level` | Påkrevd norsk pilotbevis: `PP2`, `PP3`, `PP4` eller `PP5`. `null` når nivået ikke er satt. |
| `training_site` | `true` når flystedet brukes til opplæring. |
| `elevation_m` | Høyden på starten over havet, i meter (for det meste fra Kartverkets terrengmodell). |
| `height_difference_m` | Høydeforskjellen fra start til hovedlanding, i meter. |
| `reviewed` | `true` når flystedet er gjennomgått av klubben. |

**Ekstra start** (`main: false`): `directions` og `categories`.

**Landing:** `primary` (`true` for hovedlandingen).

**Gangrute:** `length_km`, `elevation_gain_m`, `gpx_url`.

**Tegning:** `text` (kort beskrivelse) og `style` (`launch`, `flight`, `landing` eller `info`).

**Koder**

- Retninger: `N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`. KML-filen bruker de norske betegnelsene (`NØ`, `Ø`, `SØ`,
  `SV`, `V`, `NV`).
- `source`: `manual` (registrert av klubben), `gpx` (fra en logget tur), `kartverket` (Kartverket), `flightlog`,
  `local_knowledge`, `flightlog/local_knowledge`, `kartverket/flightlog`, `flightlog/gpx`, `ippc`, `old_site`
  (klubbens tidligere flystedsoversikt).

## KML

KML-filen har én mappe per flysted, med de samme featurene som GeoJSON-filen. Navnene sier hva hvert punkt er, på
norsk:

| Navn | Betydning |
|---|---|
| `Elgen – start` | Hovedstart. Beskrivelsen lister retninger, startgrupper, kategorier, nivå og høyde. |
| `Sollifjellet – start PG (N, NØ)` | Ekstra start for paragliding mot N og NØ. |
| `Elgen – hovedlanding: Landing Aun …` | Hovedlanding. |
| `Elgen – alternativ landing: …` | Alternativ landing. |
| `Elgen – parkering: P kapellet` | Parkering. |
| `Elgen – gangrute: fra kapellet` | Gangrute. |

Hver beskrivelse slutter med en lenke til stedssiden.

## Spørsmål og rettelser

Opprett en sak i [hpgt-com/flying-sites](https://github.com/hpgt-com/flying-sites/issues), eller bruk «Meld fra» på
<https://flysteder.hpgt.com>.
