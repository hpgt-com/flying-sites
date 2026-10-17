# Operations and maintenance

Practical how-tos for those who maintain the site. How the site fits together is described in
[architecture.md](architecture.md), and the site file format in [site-files.md](site-files.md).

## Running the site locally

Requires Node.js 20 or later.

```bash
npm ci          # install the packages
npm start       # http://localhost:8080, reloads when you save
npm test        # the tests in test/
npm run build   # builds into _site/
```

`FORECAST_OFFLINE=1 npm run build` builds without fetching the wind forecast from MET (faster, and works offline).
Locally, the forecast is cached in `.cache/` for 30 minutes.

## Workflow

1. Create a branch and make the change.
2. Open a pull request. The PR check runs the tests and builds the site. Invalid site files make it fail.
3. Merge to `main`. The site is published automatically after a few minutes.

Changes made by Claude or other bots appear in «Sist endret» ("Last changed") as the PR they came from
(`lib/git.js`).

## Adding a site

1. Create the folder `src/sites/<id>/` and copy `index.md` from a similar site.
2. Fill in `name`, `id`, `launch`, `wind_directions`, `landings` and `parking`. Get the heights from Kartverket
   (`https://ws.geonorge.no/hoydedata/v1/punkt?koordsys=4258&punkter=[[lon,lat]]`).
3. Set `status: draft` until the site has been reviewed.
4. Add a walking route (`<id>-route.gpx`, without timestamps or heart-rate data) and images (`npm run images`).
5. Run `npm run airspace` (requires `OPENAIP_API_KEY`), or wait for the monthly update.
6. Write `index.en.md`, or let the status page remind you.
7. Check `/status/` after the build: it shows what is missing.

## Reviewing a site

When the site has been checked by someone who knows it, set:

```yaml
status: reviewed
reviewed:
  by: Navn Navnesen
  date: '2026-10-06'
```

The build stops if `status` and `reviewed` do not match.

## Status page

[`/status/`](https://flysteder.hpgt.com/status/) is generated on every build (`lib/status.js`), is not linked from
the menu and is marked `noindex`. It shows per site:

| Check | Missing when |
|---|---|
| level, landing, parking | the field is empty (landing not when `no_fixed_landing: true`) |
| parking text | parking is on the map, but `access.parking_text` is missing |
| walking route | no GPX, and no parking within 300 m of the launch and less than 50 m lower |
| launch text, landing text | the section is missing or is a placeholder |
| heights | `launch_masl` or `landing_masl` is missing |
| launch photo, landing photo, overview photo | no images of that type |
| airspace | neither fetched from openAIP nor recorded in the site file |
| yr_id, flightlog_id | not linked |
| English text (outdated) | `index.en.md` is missing, or is older than `index.md` |

## Wind forecast

- Fetched from MET on every build. `deploy.yml` builds at xx:17 and xx:47, but GitHub may delay or skip scheduled
  runs.
- If the forecast is more than 6 hours old (`maxForecastAgeHours` in `src/_data/windRules.json`), the wind assessment
  is turned off and the site says so.
- **Fetch a new forecast now:** Actions → «Build and deploy» → «Run workflow».
- The limits for the assessment are in `src/_data/windRules.json`. A site's own limit is set with
  `wind_limits.max_wind` in the site file.

## Airspace

- Fetched from openAIP on the 1st of each month (`airspace.yml`). If anything has changed, it arrives as a PR that
  should be read through before merging. The workflow has two jobs: `fetch` gets the data with read-only access,
  and `pr` opens the PR only if something changed (it is skipped otherwise).
- **Fetch now:** Actions → «Update airspace» → «Run workflow», or `npm run airspace` locally.
- The key is stored as the repository secret `OPENAIP_API_KEY`. The update does not work without it.
- Airspace notes (for example that the approach enters Evenes CTR) go in the site file's `airspace`.
- The towers' phone numbers are only in `src/_data/towers.json` (with names per language in `names`).

## Images

```bash
npm run images -- ~/Bilder/flysteder        # imports all images named by the convention
npm run images -- elgen landing bilde.jpg    # one image for a site
npm run images                               # checks and shrinks all images in the repository
```

Naming before import: `Storlitinden_Takeoff_SE_1_DSC04968.jpg`, `Storlitinden_Landing_1_DSC05012.jpg`,
`Storlitinden_Overview_1_DJI_0042.jpg`. See [SPEC.md](../SPEC.md#content). The default photographer and licence are
set in `src/_data/photoCredit.json`.

## Statistics

- [GoatCounter](https://hpgt-flysteder.goatcounter.com), account `hpgt-flysteder`. Anonymous and without cookies.
  Does not count on localhost.
- The script is a copy in `src/assets/js/goatcounter.js` (the CSP allows only the site's own scripts). The URL is set
  in `src/_data/site.js` and in the CSP in `base.njk`.
- Events (clicks) have fixed English names, the same in all languages: `link/<domain><page>`, `download/<file>`,
  `tab/sites|weather|info`, `filter/direction|level|category/…`, `filter/wind/…`, `filter/suggest/on|off`,
  `map/select/<id>`, `day-plan/select/<id>`, `map-layer/<key>` (topo, greyscale, opentopomap, satellite, skyways,
  thermals, hillshade, radar, airspace-tma, airspace-ctr, airspace-military, airspace-danger), `search/no-hits/…`,
  `images<page>`, `fullscreen<page>`, `setting/theme/…`, `setting/colorblind/on|off`. Up to and including
  11.10.2026 they had Norwegian names (`lenke/…`, `fane/…`, `kart/valgt/…` etc.).
- Your own visits are not counted once you have opened `https://flysteder.hpgt.com/#toggle-goatcounter` in the
  browser.

## Adding a language

1. Add the language to `src/_data/languages.js`: `code`, `name` (as written in the language itself), `locale`
   (for Open Graph), `prefix` (`/de`) and `slugs` (URLs: `{ flysteder: "orte", tarn: "tuerme" }`).
2. Copy `src/_i18n/en.json` to `src/_i18n/<code>.json` and translate the values. Missing keys are shown in Norwegian.
3. Add the language's Norwegian name to `LANGUAGE_WORDS` in `lib/status.js`, so the status page can show
   «tysk tekst» ("German text").
4. Translate the sites in `index.<code>.md`, or let the status page show what is missing.
5. `npm test` checks that the dictionary only has keys that exist in `nb.json`.

## Accounts and secrets

| What | Where | Used for |
|---|---|---|
| `OPENAIP_API_KEY` | GitHub → Settings → Secrets | Monthly airspace fetch |
| GoatCounter `hpgt-flysteder` | goatcounter.com | Visitor statistics |
| GitHub Pages, domain | Settings → Pages, DNS record for `flysteder.hpgt.com` | Publishing |

MET and Kartverket require no key. MET requires the client to provide contact details (`USER_AGENT` in
`src/_data/forecast.js`).

## Troubleshooting

| Build message | Fix |
|---|---|
| `ukjent source «…»` | Use one of the fixed values, see [source](site-files.md#front-matter). |
| `ukjent nøkkel …` | Typo in the front matter. See the table in [site-files.md](site-files.md#front-matter). |
| `bildet … har feil navn` | Import with `npm run images`, or rename the file to match the pattern. |
| `gangruten … skal hete …` | Multiple routes must be named `<id>-route-1.gpx`, `<id>-route-2.gpx`. |
| `status er «reviewed», men reviewed …` | Fill in `reviewed.by` and `reviewed.date`. |
| `index.en.md: ukjente nøkler …` | Typo in the translation. See [Translation](site-files.md#translation). |
| The wind assessment is missing on the site | The forecast is too old, or MET did not respond. Run «Build and deploy» manually. |
| The airspace layer says «Kunne ikke hente luftrom» ("Could not load airspace") | `assets/airspace.geojson` is missing from the build. Check that `src/_data/cache/airspace/region.geojson` exists. |
