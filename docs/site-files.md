# Site files

Each site is one folder in `src/sites/<id>/`. The folder name is the site's id (lower case, æ/ø/å written as
ae/o/a, hyphens instead of spaces), and it becomes the URL: `/flysteder/<id>/` and `/en/sites/<id>/`.

| File | Required | What |
|---|---|---|
| `index.md` | yes | Data about the site (front matter) and the text (Markdown) |
| `index.en.md` | no | English text. See [Translation](#translation) |
| `<id>-route.gpx` | no | Walking route. Several routes: `<id>-route-1.gpx`, `<id>-route-2.gpx` … |
| `<id>-overview-1.jpg` etc. | no | Images, see [Images](#images) |
| `<id>-drawing.geojson` | no | Points, lines and areas on the map, see [Drawing](#drawing) |

The build stops if anything is wrong: unknown keys, invalid directions or levels, wrongly named images, walking
routes that do not exist (`lib/validation.js`). The error message names the file and the field. For a complete
example, see `src/sites/elgen/index.md`.

## Front matter

Keys are in English; values and text are in Norwegian. Empty fields are written `null` and shown as
«Ikke registrert ennå» ("Not registered yet"), never as guessed values.

| Key | What |
|---|---|
| `name`, `id` | The displayed name, and the id (same as the folder name). |
| `status`, `reviewed` | `draft` or `reviewed`. `reviewed` requires `reviewed.by` (name) and `reviewed.date` (`'2026-10-06'`). |
| `region` | For example «Harstad og Kvæfjord» or «Lofoten». The home page map opens over the region in `src/_data/site.js`. |
| `municipality` | The municipality the launch is in, from Kartverket (for example «Kvæfjord»). Required. The home page search finds the site by municipality and region. |
| `external` | `flightlog_id`, `yr_id` (the Yr location nearest the launch). |
| `level` | `PP2`–`PP5`. See [Level](#level). |
| `training_site` | `true` for a training site. |
| `categories` | `PG`, `SPG`, `PPG`. |
| `season` | Free text, for example «Vår til høst». |
| `wind_directions` | `primary` (main directions), `possible` and `source`. Codes: `N NE E SE S SW W NW`. |
| `wind_limits` | `max_wind` in m/s, when the site tolerates less than the shared limit (7 m/s). Used in the wind assessment. `soar_min_wind` in m/s: about how much wind it takes to stay up (soar) at the site, for example a coastal ridge. Never changes the rating, since the site can be flown without it (a flight down): below it the assessment only adds «Under 4 m/s: nok til en tur ned, men trolig for lite til å henge her», and the site page says how much it takes. Must be below `max_wind` (or 7). |
| `launch` | The main launch: `lat`, `lon`, `source`. |
| `launches` | One entry per launch or direction group: `directions`, `categories`, `text`, and optionally its own `lat`/`lon` (at most 5 km from `launch`). The categories control which directions the SPG filter uses. |
| `landings` | `name`, `lat`, `lon`, `primary` (one main landing), `source`. |
| `no_fixed_landing` | `true` when the site has no fixed landing (Ramnskogheia). `landings` must then be empty. |
| `parking` | List with `name`, `lat`, `lon`, `masl` (height from Kartverket) and `source`. |
| `access` | `parking_text`, `route_text`, `routes` (`file`, `name`, `km`, `elevation_gain_m`, `walk_time_min`) and `walk_time_min` when there is no route. Length, elevation gain and time on the page are calculated from the GPX file. |
| `elevation` | `launch_masl`, `landing_masl`, `difference_m`, `source`. Heights from Kartverket. |
| `airspace` | Airspace notes (`name`, `note`, optionally `type`, `lower`). The airspace itself is fetched from openAIP. |
| `hazards` | Hazards for the whole site: `title` and `text`. Shown in «Før du starter» ("Before you launch"). |
| `links` | Extra links under «Logg og mer» ("Log and more"): `title`, `text`, `url` (https). |

`source` is used in the sources line at the bottom of the page: `manual` (registered manually), `gpx`, `kartverket`,
`flightlog`, `local_knowledge`, `flightlog/local_knowledge`, `kartverket/flightlog`, `flightlog/gpx`, `ippc`,
`old_site` (the old flying site guide). Any other value stops the build (`SOURCES` in `lib/validation.js`).

## Text

The text below the front matter has three parts:

```markdown
Kort ingress, én–to setninger. Vises øverst, på forsidekortet og når siden deles.

## Start

Om startområdet.

## Landing

Om landingen.
```

That is: a short introduction of one or two sentences (shown at the top, on the home page card and when the page is
shared), then a `## Start` section about the launch area and a `## Landing` section about the landing.

Each piece of information belongs in one place. Hazards go in `hazards`, access in `access`, and map points in the
drawing. The status page flags «starttekst» (launch text) and «landingstekst» (landing text) when the section is
missing or only a placeholder.

## Level

The level is the lowest pilot rating the site is suitable for, according to the NLF/HPS rules (Sikkerhetssystem for
HPS and the training programmes for paragliding and speedflying):

- **PP2** requires a student launch: easy launch and landing with a good margin, no wires or trees in a wide sector
  around the launch, no cliff launch, and a large landing that can be reached with plenty of height. Students fly in
  at most 5 m/s, measured as the strongest gust.
- **PP3** allows cliff launches and top landings (the first time with an instructor), and requires a defined main
  landing that can easily be reached by gliding.
- **SPG4** is required for cliff launches with a speedwing.

Launches that require more than the site's level are mentioned in the text («Velger man en stupstart, er det PP3»,
"If you choose a cliff launch, it is PP3").

## Images

Images are found by file name, so the site file has no image list:

| Name | What |
|---|---|
| `<id>-overview-<nr>.jpg` | Overview. No. 1 is the main image and the image used when the page is shared. |
| `<id>-takeoff-<direction>-<nr>.jpg` | Launch, named by the direction you face (`se`, `nw` …). The direction may be omitted. |
| `<id>-landing-<nr>.jpg` | Landing. |
| `<id>-landing-spg-<nr>.jpg` | A separate SPG landing. |

Import images with `npm run images`, which gives them the correct name, downscales them, removes GPS and other
metadata, and embeds photographer and licence. Naming images before import is described in
[SPEC.md](../SPEC.md#content).

## Drawing

`<id>-drawing.geojson` is a plain GeoJSON file (it can be drawn in [geojson.io](https://geojson.io)) with
`properties.kind`:

- `label` (point): numbered point with `title` and `text`. `style: hazard` makes it a hazard point.
- `path` (line): `style` `launch`, `flight`, `hazard` or `info`, and `dashed`/`arrow`.
- `area` (area): `style` `hazard`, `launch`, `landing` or `info`.

Launch, landing, parking, walking route and direction arcs are drawn from the site file and must not be in the
drawing. See `lib/drawing.js`.

## Translation

`index.en.md` (and `index.<language>.md` for other languages) contains text only. Lists are in the same order as in
`index.md`, and `- {}` skips an item that needs no translation:

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

- If the file is missing, the Norwegian text is shown with the notice «not translated yet».
- Unknown keys stop the build, so a typo cannot silently turn the text Norwegian.
- The status page shows «engelsk tekst utdatert» (English text outdated) when `index.md` has been changed in Git
  after `index.en.md`. Read through the English text and update it.
- Place names stay as in Norwegian. Terminology: launch, cliff launch, top landing, ridge soaring (hang and subhang),
  thermals, aerial cable (løypestreng), high-voltage power line (høyspent), landowner, m asl.
