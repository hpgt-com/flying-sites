# Open data: HPGT flying sites

The paragliding and speedflying sites around Harstad, Northern Norway, published by Harstad Hang og Paragliderklubb
(HPGT) as open data. The files are rebuilt from the site files in this repository every time the site is published
(twice an hour), so the URLs always serve the current data.

| File | URL | Use it for |
|---|---|---|
| GeoJSON | <https://flysteder.hpgt.com/flysteder.geojson> | Apps and maps (Leaflet, MapLibre, QGIS). Structured fields, recommended for import. |
| KML | <https://flysteder.hpgt.com/flysteder.kml> | Google Earth, norgeskart.no and map apps. Same content, with readable names and descriptions in Norwegian. |

Fetch the files from the URLs rather than copying them once, so corrections reach you.

## Licence

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). You may use, share and adapt the data, also commercially,
as long as you credit:

> Flying sites: HPGT flysteder (https://flysteder.hpgt.com), CC BY 4.0

See [LICENSE_DATA.md](../LICENSE_DATA.md). The data is for guidance only and not for navigation. Always check the site
page, IPPC (airspace and NOTAM) and the conditions yourself.

**Not included:** the site descriptions, hazards and landowner information. They belong on the site pages, where they
are kept up to date and read in context. Please link to the site page (`site_url`) instead of copying them.

## How a site is structured

Each site (`site_id`, for example `elgen`) consists of several features:

- **One main launch** (`kind: "launch"`, `main: true`). This is the site's position, with all its wind directions,
  categories, level and height. Sites often have several launches in different directions or for different categories
  (paragliding and speedflying). They are listed in `launch_groups` on the main launch.
- **Extra launches with their own position** (`kind: "launch"`, `main: false`), where a launch is far enough from the
  main launch to have its own point. Launches without their own position are only in `launch_groups`.
- **Landings** (`kind: "landing"`). `primary: true` is the main landing, and `primary: false` marks alternative
  landings. A site can have no landing at all, for example when you land on the bogs around the mountain.
- **Parking** (`kind: "parking"`), one or more.
- **Walking routes** (`kind: "route"`), from parking to launch, as lines, with a link to the GPX file.
- **Club map annotations** (`kind: "drawing_label"` for points, `"drawing_path"` for lines, `"drawing_area"` for areas),
  for example a named point, a path or a landing area. Hazard annotations are left out, like the hazard texts.

### Examples

**Sollifjellet** (`sollifjellet`) has a main launch and several launches with their own positions. Paragliding (PG)
and speedflying (SPG) share the launch towards E–S, while PG also launches towards N–NE and NW:

```
launch (main)      Sollifjellet            directions_primary: N, NE, E, SE, S, NW
launch             PG/SPG towards E, SE, S
launch             PG towards N, NE
launch             PG towards NW (two points)
landing (primary)  main landing
landing            SPG landing
parking, route, drawing_label …
```

**Elgen** (`elgen`) has one launch point, but PG launches in all directions and SPG only towards NE–SW. That is in
`launch_groups` on the main launch:

```json
"launch_groups": [
  { "categories": ["PG"], "directions": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] },
  { "categories": ["SPG"], "directions": ["NE", "E", "SE", "S", "SW"] }
]
```

It also has a main landing (Aun, south) and two alternative landings (by the chapel, north, and on the shore at
Elgsnes).

## Fields (GeoJSON)

Coordinates are WGS 84, `[longitude, latitude]` as in GeoJSON. The collection has `name`, `generated` (ISO time of the
build) and `license`.

**On every feature**

| Field | Description |
|---|---|
| `site_id` | Stable id of the site, also used in the site URL. Use it to match sites between updates. |
| `site_name` | Name of the site. |
| `site_url` | The site page (Norwegian). The English page is the same path under `/en/sites/`. |
| `municipality` | Municipality the launch is in. |
| `kind` | `launch`, `landing`, `parking`, `route`, `drawing_label`, `drawing_path` or `drawing_area`. |
| `name` | Name of the feature. |
| `source` | Where the position comes from (see below). `null` when not recorded, always `null` on routes and drawings. |

**Main launch** (`kind: "launch"`, `main: true`)

| Field | Description |
|---|---|
| `directions_primary` | Main wind directions, in compass order. |
| `directions_possible` | Directions that can work but are less ideal. |
| `launch_groups` | `[{ categories, directions }]`, one entry per distinct launch type. |
| `categories` | `PG` (paragliding), `SPG` (speedflying), `PPG` (paramotor). |
| `level` | Required Norwegian pilot rating: `PP2`, `PP3`, `PP4` or `PP5`. `null` when not set. |
| `training_site` | `true` when the site is used for training. |
| `elevation_m` | Launch height above sea level, in metres (mostly from Kartverket's terrain model). |
| `height_difference_m` | Height from launch to main landing, in metres. |
| `reviewed` | `true` when the site has been reviewed by the club. |

**Extra launch** (`main: false`): `directions` and `categories`.

**Landing:** `primary` (`true` for the main landing).

**Route:** `length_km`, `elevation_gain_m`, `gpx_url`.

**Drawing:** `text` (short description) and `style` (`launch`, `flight`, `landing` or `info`).

**Codes**

- Directions: `N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`. The KML uses the Norwegian labels (`NØ`, `Ø`, `SØ`, `SV`, `V`, `NV`).
- `source`: `manual` (registered by the club), `gpx` (from a logged walk), `kartverket` (Norwegian Mapping Authority),
  `flightlog`, `local_knowledge`, `flightlog/local_knowledge`, `kartverket/flightlog`, `flightlog/gpx`, `ippc`,
  `old_site` (the club's previous site list).

## KML

The KML has one folder per site, with the same features as the GeoJSON. The names say what each point is, in Norwegian:

| Name | Meaning |
|---|---|
| `Elgen – start` | Main launch. The description lists directions, launch groups, categories, level and height. |
| `Sollifjellet – start PG (N, NØ)` | Extra launch for paragliding towards N and NE. |
| `Elgen – hovedlanding: Landing Aun …` | Main landing. |
| `Elgen – alternativ landing: …` | Alternative landing. |
| `Elgen – parkering: P kapellet` | Parking. |
| `Elgen – gangrute: fra kapellet` | Walking route. |

Every description ends with a link to the site page.

## Questions and corrections

Open an issue in [hpgt-com/flying-sites](https://github.com/hpgt-com/flying-sites/issues), or contact the club through
<https://flysteder.hpgt.com>.
