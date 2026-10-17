# HPGT flysteder

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/hpgt-com/flying-sites/badge)](https://scorecard.dev/viewer/?uri=github.com/hpgt-com/flying-sites)

Source code for **[flysteder.hpgt.com](https://flysteder.hpgt.com)**, the flying site guide of Harstad Hang og
Paragliderklubb (HPGT). It shows paragliding and speedflying sites around Harstad and Kvæfjord, Northern Norway, with
wind directions, hazards, airspace, walking routes, weather forecasts and a rough wind assessment based on MET data.
The site is in Norwegian, with an [English version](https://flysteder.hpgt.com/en/).

It builds on Lars Sletten's old flying site guide, which he has handed over to the club.

> The guide is only a rough guide. The club takes no responsibility for information about safety, airspace or
> landowners. Always check [IPPC](https://ippc.no) before you fly.

## Suggest a change

Do you have corrections, photos or new information about a site?

- Press **«Foreslå endring»** ("Suggest a change") at the bottom of the site page. It opens a form here on GitHub
  (requires an account).
- Or tell someone in the club directly.

## Documentation

| Document | Contents |
|---|---|
| [docs/open-data.md](docs/open-data.md) | The open data files (GeoJSON and KML): how each site is structured, the fields and the licence. For apps and other data users. |
| [docs/architecture.md](docs/architecture.md) | How the site fits together, with diagrams: sources, build, browser, languages, publishing, what has been built and what is planned. |
| [docs/site-files.md](docs/site-files.md) | The site file format: all fields, text, level, images, drawing and translation. |
| [docs/operations.md](docs/operations.md) | How-tos: new site, review, status page, wind forecast, airspace, images, statistics, new language, troubleshooting. |
| [SPEC.md](SPEC.md) | The specification: what the site shows, and how. |
| [SECURITY.md](SECURITY.md) | Security: CSP, code scanning and GitHub settings. |

## Repository layout

| Where | What |
|---|---|
| `src/sites/<id>/index.md` | One site: structured data at the top (front matter), text below. |
| `src/sites/<id>/index.en.md` | English text for the site (optional, see `lib/translations.js`). If missing, the Norwegian text is shown with a notice. |
| `src/sites/<id>/` | Images (`<id>-overview-1.jpg`, `<id>-takeoff-se-1.jpg`, `<id>-landing-1.jpg`, `<id>-landing-spg-1.jpg`), walking routes (`<id>-route.gpx`) and the map drawing (`<id>-drawing.geojson`: points, lines and areas, see `lib/drawing.js`). |
| `src/_data/` | Towers (`towers.json`), shared wind limits (`windRules.json`), the weather (`forecast.js`, `windgram.js`, read from `lib/weather/`) and cached airspace. |
| `src/_includes/` | Page templates for the home page and the site pages. |
| `src/assets/` | CSS, JavaScript and images. |
| `lib/`, `scripts/` | Validation, GPX, images, airspace, weather and maintenance scripts. See [Data modules](docs/architecture.md#data-modules). |
| `src/_i18n/` | Dictionaries for Norwegian and English (all fixed text in templates and scripts). |
| `docs/` | Documentation, see above. |

The site is available in Norwegian and English (`/en/`). The languages are defined in `src/_data/languages.js`, and
all fixed text in templates and scripts lives in the dictionaries `src/_i18n/<language>.json`. To add a language, add
it to `languages.js` and create a dictionary with the same keys as `nb.json` (see
[docs/operations.md](docs/operations.md#adding-a-language)). Text missing in a language is shown in Norwegian.

Keys in the site files are in English; values and text are in Norwegian. Unknown keys and invalid values stop the
build, so errors never reach the live site. The [status page](https://flysteder.hpgt.com/status/) shows what is
missing for each site.

## Running the site locally

Requires [Node.js](https://nodejs.org) 20 or later.

```bash
npm ci
npm start
```

The site then runs at http://localhost:8080 and reloads when you save.

Other commands:

| Command | What |
|---|---|
| `npm run build` | Builds the site into `_site/`. |
| `npm test` | Tests the wind assessment, validation, drawings, images, status page, language support and export. |
| `npm run images` | Checks all images (size, GPS data) and shrinks them if needed. |
| `npm run images -- <files or folder>` | Imports images named by the convention, e.g. `Storlitinden_Takeoff_SE_1_DSC04968.jpg` (see [SPEC.md](SPEC.md#content)). All images are imported, and the build finds them by file name. |
| `npm run images -- <id> <field> <file>` | Imports one image for a site with the correct name and size. |
| `npm run airspace` | Fetches airspace from openAIP (requires `OPENAIP_API_KEY`). |
| `npm run check:links` | After the build: checks that every internal link and image in `_site/` points to a file that exists. |
| `npm run check:html` | After the build: validates the HTML of every page (`.htmlvalidate.mjs`). |
| `npm run check:a11y` | After the build: axe accessibility check of a few pages in Chromium (`npx playwright install chromium` first). |

## Publishing

- Everything merged to `main` is published automatically to GitHub Pages.
- The site is also rebuilt twice an hour, so the wind assessment on the home page uses a fresh forecast. The forecast
  is fetched in its own job (`weather`) before the build, and the build only reads it. GitHub may
  delay or skip scheduled runs. If the forecast is more than 6 hours old, the wind assessment is turned off. To fetch
  a new forecast immediately, run «Build and deploy» manually under Actions.
- The image variants (`_site/img`) are cached between builds in CI, so a build without image changes skips them.
  The cache is replaced whenever an image, the image code or a package changes.
- Changes go through a branch and a pull request. The PR check builds the site and stops invalid site files, broken
  internal links, invalid HTML and serious accessibility errors.
- Airspace is fetched automatically on the 1st of each month. Changes arrive as a PR, which is reviewed before
  publishing.
- Dependabot proposes updates to packages and Actions once a month.
- Security (Content-Security-Policy, CodeQL, dependency review, zizmor, GitHub settings): see
  [SECURITY.md](SECURITY.md).

## Sources

- Maps: [Kartverket](https://www.kartverket.no/) (topographic, greyscale and hillshade from
  [høydedata.no](https://hoydedata.no)), [OpenTopoMap](https://opentopomap.org) and satellite imagery from
  [Sentinel-2 cloudless](https://s2maps.eu) (EOX, CC BY-NC-SA 4.0)
- Heights of launches, landings and parking: Kartverket
- Heights along walking routes: Kartverket
- Wind forecast: [MET Norway](https://api.met.no/) and [Yr](https://www.yr.no/)
- Winds aloft (draft, Sollifjellet): [Open-Meteo](https://open-meteo.com/) (CC BY 4.0)
- Precipitation radar: [Rain Viewer](https://www.rainviewer.com/) (free for non-commercial use, with attribution)
- Airspace: [openAIP](https://www.openaip.net/) (CC BY-NC 4.0)
- Thermals: [thermal.kk7.ch](https://thermal.kk7.ch) (CC BY-NC-SA 4.0)
- Site descriptions: Lars Sletten's old flying site guide, Flightlog and local knowledge in the club

## Open data

The sites are also published as open data files, generated on every build so they are always up to date:

- **GeoJSON:** <https://flysteder.hpgt.com/flysteder.geojson> (QGIS, Leaflet, MapLibre and other maps)
- **KML:** <https://flysteder.hpgt.com/flysteder.kml> (Google Earth, norgeskart.no, map apps)

The files contain launches with wind directions, landings, parking, walking routes and the club's map annotations,
but not the site descriptions. They are generated in `lib/export.js`. Licence: CC BY 4.0, credited as
«Flysteder: HPGT flysteder (https://flysteder.hpgt.com)». See [docs/open-data.md](docs/open-data.md) for the format
and [LICENSE_DATA.md](LICENSE_DATA.md) for the licence.

## Licence

The code (templates, scripts, CSS and JavaScript) is MIT-licensed, see [LICENSE](LICENSE).

The content belongs to the club and its contributors and is not covered by the MIT licence (the open data files have
their own licence, see above). This covers the site texts, drawings and walking routes in `src/sites/`. Contact HPGT
before using content from here elsewhere.

The images are licensed under CC BY-NC 4.0 with the photographer credited, see [LICENSE_IMAGES.md](LICENSE_IMAGES.md).
Photographer, copyright and licence are embedded in each image (EXIF/XMP) and shown in the image viewer. The default
photographer and licence are set in `src/_data/photoCredit.json`.

Data from other sources follows their own licences, see [Sources](#sources).
