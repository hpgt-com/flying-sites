# Operations and maintenance

Practical how-tos for those who maintain the site. How the site fits together is described in
[architecture.md](architecture.md), and the site file format in [site-files.md](site-files.md).

## Running the site locally

Requires Node.js 22.22 or later (html-validate needs it).

```bash
npm ci          # install the packages
npm start       # http://localhost:8080, reloads when you save
npm test        # the tests in test/
npm run build   # builds into _site/
```

`FORECAST_OFFLINE=1 npm run build` builds without the weather (MET and Open-Meteo), which is faster and works
offline. Otherwise the build fetches the weather when `.cache/weather/` is missing or older than 30 minutes.
`npm run weather` fetches it right away, the same way the `weather` job in «Build and deploy» does.

The quality checks in the PR check can be run locally after the build:

```bash
npm run check:links   # internal links and images point to files that exist (no network)
npm run check:html    # HTML validation of every page, rules in .htmlvalidate.mjs
npm run check:output  # no «[object Object]», «undefined», «NaN» or unfilled placeholders in the pages
npx playwright install chromium   # once
npm run check:a11y    # axe in Chromium on a few pages, light and dark mode
```

`check:a11y` fails only on findings with impact «serious» or «critical», and lists the rest. With a Chromium already
installed, set `CHROMIUM_PATH` instead of running `playwright install`. Pages checked: `PAGES` in
`scripts/check-a11y.mjs`.

## Workflow

1. Create a branch and make the change.
2. Open a pull request. The PR check runs the tests, builds the site, and checks links, HTML and accessibility.
   Invalid site files, broken internal links, invalid HTML or serious accessibility errors make it fail.
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

- Fetched from MET on every build (the `weather` job; the site is built only when its content changes, with no
  schedule).
- The **data service** (`workers/data`, Cloudflare account «HPGT») fetches MET by itself every 5 minutes, six launches
  per run, and the pages use its forecast when it is newer than the one built into the page. See it at
  `https://data.hpgt.workers.dev/v1/forecast.json` (`fetched` = when the oldest launch was fetched). Its logs are in
  Cloudflare → Workers & Pages → data → Logs.
- **Publishing the data service:** happens by itself when `workers/data/`, `lib/weather/met.js` or a site file changes
  on `main` (Actions → «Data service»), or with «Run workflow» there. Test locally with `node scripts/data-sites.mjs`
  and `cd workers/data && npm ci --ignore-scripts && npx wrangler dev --test-scheduled` (then open `/__scheduled` to run
  the schedule, and `/v1/forecast.json`). For Holfuy locally, put `HOLFUY_KEY=…` in `workers/data/.dev.vars` (ignored by Git).

## Weather stations (Holfuy)

- The stations are listed in `workers/data/src/stations.js`: `id` (the number in holfuy.com/en/weather/<id>), and
  optionally `name` (otherwise Holfuy's), `model` and `site` (the flying site's folder: that site page then shows the
  «Målt nå» block and a Holfuy button, and its assessment for the hour now uses the measurement). Today: 490 HPGT Heia
  (site `heia`) and 820 Modellflystripa. A change there is published by itself. A station is linked to a site only by
  `site`, not by distance.
- The key: Cloudflare → Workers & Pages → data → Settings → Variables and Secrets → add the secret `HOLFUY_KEY`
  (type Secret). Publishing keeps it. Without the key, or without stations, the service skips Holfuy.
- Fetched every minute. `https://data.hpgt.workers.dev/v1/stations.json` has the latest measurement and the last
  6 hours per station. The service keeps the last 7 days; older days go to the archive (below), and nothing is deleted
  before it is there. Holfuy has accepted that the club stores the measurements over time.
- Where they are shown: the layer «Klubbens værstasjoner» (MET's in their own layer, «METs værstasjoner») on the home map and the site maps (at Holfuy's position, or at the
  site's launch when Holfuy gives none), short rows in the Vær tab, the weather page `/vaer/`, and «Målt nå» on the
  station's site page. The rating of the measured wind, the change over a period and how even the wind is are worked out
  in the browser (`src/assets/js/stations.js`), with the limits in `src/_data/windRules.json`.
- The assessment for the hour now (site page and home page «Nå») uses a measurement at most 15 minutes old: a stricter
  measurement always counts, a better one only when the wind over the last half hour is steady. Change the rule in
  `rateNow` (`src/assets/js/wind.js`) and the steadiness in `measurement` (`stations.js`).

- **What the forecast said for each hour:** every forecast fetch also stores the forecast for the hour going on then
  (the latest fetch during the hour wins), kept for 30 days in the store (`forecast_hours`). The last 6 hours are in
  `/v1/forecast.json` as `past`, which «Målt mot varslet» on the weather page draws over the measurements.

## «Meld fra om endring» (report a change)

- A short form on each site page (`report.js`) that becomes an issue in this repository, titled «[Meld fra] <site>:
  <kind>», and the same form on `/meld-fra/` (in the menu) for what does not concern one site, titled «[Meld fra]
  Generelt: <kind>» (new flying site, error on the site, idea, other). The data service receives it (`POST https://data.hpgt.workers.dev/v1/report`,
  `workers/data/src/report.js`), checks it with Cloudflare Turnstile and creates the issue. At most 20 a day.
- The issue gets the labels for its kind (`LABELS` in `report.js`): what concerns a site `endringsforslag` and
  `site-data`, a hazard also `safety`, an error on the site `bug`, an idea `enhancement`, a general «Annet» none. The
  labels must exist in the repository (they do); GitHub drops a label the app may not set without saying so. The answer
  carries the issue's number and address, and the form's thanks link to it.
- **Turning it on** (once):
  1. Cloudflare → Turnstile → Add widget: name «flysteder», hostname `flysteder.hpgt.com`, mode «Managed». Copy the
     **site key** (public) into `turnstileSiteKey` in `src/_data/site.js`. The form is hidden while it is empty.
  2. The **secret key** from the same widget: Cloudflare → Workers & Pages → data → Settings → Variables and Secrets →
     add the secret `TURNSTILE_SECRET`.
  3. The issues are made by the club's **GitHub App**, so they show as from the app and nothing expires:
     organisation `hpgt-com` → Settings → Developer settings → GitHub Apps → New GitHub App. Name «HPGT Flying Sites
     Reports» (its own app, not «HPGT Flying Sites», whose key may change the code),
     homepage `https://flysteder.hpgt.com`, Webhook off, permissions **Repository → Issues: Read and write** (nothing
     else), «Only on this account». Create it; note the **App ID**; «Generate a private key» downloads a `.pem` file.
     Then «Install App» → only the repository `flying-sites`. Add the secrets `REPORTS_APP_ID` (the App ID, or the Client ID) and
     `REPORTS_APP_PRIVATE_KEY` (the whole `.pem` file, as it is) on the data service as above, and delete the `.pem`.
     A fine-grained token in `GITHUB_ISSUES_TOKEN` (Issues: read and write, only this repository) is used instead when
     the app's secrets are missing; once the app works it can be deleted, in Cloudflare and on GitHub.
- Without Turnstile and the app (or the token) the endpoint answers 503 «not-configured». Errors from GitHub are in the data service's logs
  (Observability), as `report: GitHub svarte …`.

## Flight logs («Fra turlogger»)

- Flight logs (IGC, and KML with times) are read on the pilot's own machine and only the sums are committed:
  `npm run logbook -- ~/turer [~/turer-fra-andre …]` (`scripts/logbook.mjs`, `lib/igc.js`) writes
  `src/_data/logbook.json`. Look it over, then commit it. The logs, tracks and names never leave the machine.
- Run it again over all the folders when logs are added: the file is written anew each time, and the same flight in an
  IGC and a KML file counts once. One folder per pilot (`pilots` in the file is the number of folders).
- A flight is found where the log moves at 4 m/s or more over 20 seconds (takeoff and landing), and counts for the
  nearest launch within 500 m (a site's `launch` and its `launches` with a position). The script prints how many
  flights it found per site, how many were elsewhere, in how many IGC and KML files, and the files without a flight
  or that could not be read (`--list` names them). KML works with times: a gx:Track, or one placemark per fix with
  its time, or a GpsDump trip (the tracklog's times in FsInfo); a KML with only a line has no times and gives no
  flight (export IGC instead; XCTracer writes such a KML beside its IGC, and the IGC is counted).
- Shown on the site page as «Fra turlogger» when the site has flights in the file.

## Pilots in the air (OGN)

- The map layer «Piloter i lufta» asks the data service every 5 seconds while it is on; the data service asks OGN's live
  map (`live.glidernet.org/lxml.php`, the area of the sites with a margin) at most once per 5 seconds and passes on what
  it gets for paragliders (`workers/data/src/live.js`; hang gliders and other aircraft are left out), with each pilot's
  track and climb over the last 10 minutes, kept in the store's memory
  only (never written down; gone when the store is evicted). No key.
- **Flyaktivitet** (`workers/data/src/sources/flights.js`): every other minute the data service asks OGN the same way and
  counts the flights of the paragliders seen flying (3 m/s over the ground, or climbing or sinking 0.5 m/s). A flight
  counts for the site nearest where first seen in the air (within 5 km); a new one begins when the pilot has landed:
  standing still two runs in a row, or not heard for 15 minutes, and in both cases less than 100 m over the ground
  where last seen. The ground's height comes from Kartverket's elevation model (`ws.geonorge.no/hoydedata/v1/punkt`,
  no key), asked only for those few pilots, in one request per run; without an answer a stop or a gap counts as a
  landing, and a gap of more than two hours always does. The day's state holds each pilot's last position in the air,
  thrown away with the keys the next day. Only the sums per site and day are kept
  (`flight_days` in the store: flights, pilots, minutes, farthest from launch, highest); the day's pilots are told apart by a key made with a random
  salt for the day (state `flights-today`), which is replaced at the first run of a new day, so no device id is kept.
  Served as `/v1/flights.json`, shown on the site page and on /flyaktivitet/ (`activity.js`). Counting began when this was deployed (`flights-since`).
- OGN's rules (`https://www.glidernet.org/ogn-data-usage/`): ODbL with credit, follow the owners' privacy choices, pass
  on nothing older than 24 hours. OGN's live data already leaves out devices that must not be tracked and gives the
  unidentified a random name, shown here as «Ukjent».
- The address is OGN's own live map's and is not documented; if OGN changes it, the layer shows nothing and the data
  service logs `live: …`. Receivers near Harstad (October 2026): AVX970 north of Evenes, AVX1058 Hadsel/Sortland,
  AVX1004 Tromsø (`live.glidernet.org/rec.php`).

## How well the forecast hits

- The data service pairs the forecast for each finished hour (as it stood during the hour, `forecast_hours`) with what
  the flying site's own station measured in it (`workers/data/src/sources/verify.js`): the mean wind, the highest gust
  and the direction. Twice an hour (:09 and :39). The pairs are kept for a year (`verify_hours`); the last 30 days are
  summed up in `https://data.hpgt.workers.dev/v1/verification.json`.
- Which sites: those with a station of their own (`site` in `HOLFUY_STATIONS`, and `MET_STATION_SITES`), now Heia and
  Sætertinden, and those with one nearby at about the same height (`near` in `HOLFUY_STATIONS`), now Hinnstein against
  Heia's station. A station nearby is also shown under «Målt nå» on that site's page, with the distance; only a site's
  own station is used for the assessment of the hour now. Other sites have no station near enough at their height
  (most stations stand down by the road or the sea), so they are left out rather than compared with a valley station. Shown under «Målt nå» on the site page and in «Målt mot varslet» on /vaer/, once there are 24 hours
  (before that, how far the collecting has come).

## Winds aloft

- Fetched by the data service from Open-Meteo, two launches every 10 minutes (each about every half hour), for the launches in `WINDGRAM_SITES` in
  `lib/weather/open-meteo.js` (`workers/data/src/sources/windgram.js`), served as
  `https://data.hpgt.workers.dev/v1/windgram.json`, with the rain, cloud cover, sun and gusts per hour for the rows under
  the grid. No key. A launch that fails keeps its previous grid for up to 6
  hours. The site page uses it when it is newer than the grid built into the page; the section stays hidden when
  neither has hours left.
- A new launch: add its folder to `WINDGRAM_SITES` and deploy both the site and the data service.

## Weather stations (MET)

- MET's own stations are found by the data service itself: once a day it asks Frost for the stations in the area of the
  flying sites, and keeps those within 50 km of a launch (Lofoten to Bardu) that measure wind (`workers/data/src/sources/frost.js`). Their
  latest observations are fetched every 10 minutes (wind, direction, gust, temperature, humidity, pressure, rain), stored
  and archived like Holfuy's (`met/station=SN…/…` in the archive), and served in `/v1/stations.json` together with
  Holfuy's, each station with its source («MET Norge», licence CC BY).
- The client ID: register (free) at `https://frost.met.no/auth/requestCredentials.html` with the club's e-mail, then
  Cloudflare → Workers & Pages → data → Settings → Variables and Secrets → add the secret `FROST_CLIENT_ID` (the client ID
  only; the client secret is not used). Without it the service skips MET.
- A MET station on a flying site is linked to it in `MET_STATION_SITES` in `workers/data/src/stations.js` (MET's number
  and the site's folder; Sætertinden's own MET station, SN87772, is linked to it). A station that should not be shown goes in `MET_EXCLUDE` there; the stations are then looked up
  again at the next run.

## Weather archive (R2)

- One CSV per station per day (UTC) in the R2 bucket `hpgt-data-archive`: `holfuy/station=<id>/year=<year>/<date>.csv`
  (columns `source, station, time_utc, direction_deg, speed_ms, gust_ms, min_ms, temperature_c, humidity_pct,
  pressure_hpa, rain_mm, extra_json`), and the stations in `holfuy/stations.csv` (`source, station, name, model, site,
  lat, lon, altitude_m`). A station without a sensor leaves its column empty. Other numbers a station sends are kept in
  `extra_json` until they get a column of their own (`workers/data/src/measurements.js`; the store adds the column).
  `source` + `station` identify a station, since two providers can use the same number. Written after midnight UTC for the day before
  (`workers/data/src/archive.js`).
- The folders use the `key=value` form, so DuckDB, BigQuery, Athena and Spark read `station` and `year` as columns, and
  every row carries the station, so all files load into one table. Example with DuckDB and R2's S3 address:
  `SELECT station, date_trunc('day', time_utc) AS day, avg(speed_ms), max(gust_ms) FROM read_csv('s3://hpgt-data-archive/holfuy/*/*/*.csv', hive_partitioning = true) GROUP BY ALL ORDER BY day;`
- **Turned on** 19.10.2026: the bucket exists and is bound in `workers/data/wrangler.toml`. How it was done, for a new
  account or bucket (without it the service keeps every measurement, so nothing is lost):
  1. Cloudflare → R2 → enable R2 (Free: 10 GB and free downloads; Cloudflare may ask for a card even within the free
     limits) and create the bucket `hpgt-data-archive` (private, no public access).
  2. Give the token «GitHub – flying-sites» the permission `Account → Workers R2 Storage → Edit` (My Profile → API
     Tokens → Edit). The token's value stays the same.
  3. The `[[r2_buckets]]` binding in `workers/data/wrangler.toml` (binding `ARCHIVE`, bucket `hpgt-data-archive`).
     Only after steps 1 and 2: a deploy with the binding and no bucket fails.
- Reading the files for reports: R2 → `hpgt-data-archive` → Settings → R2 API tokens (read only), and use them with the
  S3 address `https://<account id>.r2.cloudflarestorage.com`.
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
- **GitHub App «HPGT Flying Sites»** (recommended). The club's app for automation in GitHub Actions; today it is
  only used by the airspace workflow. Without it the PR is created with the GitHub token, which
  does not trigger the PR check, so the PR must be merged with «Bypass rules». With it the PR gets the checks like
  any other. Setting it up (someone with admin access to hpgt-com):
  1. hpgt-com → Settings → Developer settings → GitHub Apps → New GitHub App. Name «HPGT Flying Sites»,
     homepage `https://flysteder.hpgt.com`, Webhook «Active» off. Repository permissions: Contents = Read and
     write, Pull requests = Read and write (Metadata = Read is added automatically). Nothing else. «Only on this
     account». Give it only what the workflows using it need; widen it when a new task needs more. Anything that
     runs outside GitHub or takes input from the public (such as a form) should get its own app instead.
  2. On the app page: note the **Client ID**, and «Generate a private key» (downloads a `.pem` file).
  3. «Install App» → hpgt-com → «Only select repositories» → flying-sites.
  4. In flying-sites → Settings → Secrets and variables → Actions: the variable `APP_CLIENT_ID` (the
     Client ID) under Variables, and the secret `APP_PRIVATE_KEY` (the whole content of the `.pem` file)
     under Secrets. Then delete the `.pem` file.
  5. Test the app: Actions → «Update airspace» → «Run workflow», tick «Test the GitHub App token only». The job
     `test-app-token` gets a read-only token from the app and reads the repository; it fetches no airspace and
     opens no PR. Green means the app works. Then «Allow GitHub Actions to create and approve pull requests» can
     be turned off (Settings → Actions → General). The next airspace PR comes from `hpgt-flying-sites[bot]`
     and gets the PR check.
  The workflow uses the app only when `APP_CLIENT_ID` is set, and falls back to the GitHub token otherwise.
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
  `tab/sites|weather` (`tab/info` until the Info tab moved into the menu), `filter/direction|level|category/…`,
  `filter/wind/<hours from now>`, `filter/suggest/on|off`, `map/select/<id>`, `map/status` (the status details opened),
  `list/show-all`, `list/open/<id>` (second tap in the list on mobile), `day-plan/select/<id>`, `map-layer/<key>` (topo, greyscale, opentopomap, satellite, skyways,
  thermals, hillshade, radar, airspace-tma, airspace-ctr, airspace-military, airspace-danger), `search/no-hits` (only counted, the search text is not sent),
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
| GitHub App «HPGT Flying Sites»: `APP_CLIENT_ID` (variable), `APP_PRIVATE_KEY` (secret) | hpgt-com → Developer settings → GitHub Apps; flying-sites → Settings → Secrets and variables | Automation in GitHub Actions (today: the airspace PRs, so the PR check runs) |
| Cloudflare account «HPGT» (owner: Kristoffer's user for now; move to a club address under Manage account → Members) | dash.cloudflare.com | The data service (`data.hpgt.workers.dev`) and «Meld fra» |
| `HOLFUY_KEY` | Cloudflare → Workers & Pages → data → Settings → Variables and Secrets | The Holfuy stations |
| `FROST_CLIENT_ID` | Cloudflare → Workers & Pages → data → Settings → Variables and Secrets | MET's stations (Frost) |
| `TURNSTILE_SECRET` | Cloudflare → Workers & Pages → data → Settings → Variables and Secrets | «Meld fra»: the robot check (the site key is public, in `src/_data/site.js`) |
| GitHub App «HPGT Flying Sites Reports»: `REPORTS_APP_ID`, `REPORTS_APP_PRIVATE_KEY` | Cloudflare (as above); the app under hpgt-com → Developer settings → GitHub Apps | «Meld fra»: makes the issues (only Issues: read and write) |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | flying-sites → Settings → Environments → `cloudflare` (only `main`) | Publishing the data service. The token («GitHub – flying-sites», Workers, KV and R2 Storage in HPGT only) expires 18.10.2027: make a new one under My Profile → API Tokens → Roll, and update the secret. |
| GoatCounter `hpgt-flysteder` | goatcounter.com | Visitor statistics |
| GitHub Pages, domain | Settings → Pages, DNS record for `flysteder.hpgt.com` | Publishing |

MET and Kartverket require no key. MET requires the client to provide contact details (`USER_AGENT` in
`lib/weather/met.js`).

## Troubleshooting

| Build message | Fix |
|---|---|
| `ukjent source «…»` | Use one of the fixed values, see [source](site-files.md#front-matter). |
| `ukjent nøkkel …` | Typo in the front matter. See the table in [site-files.md](site-files.md#front-matter). |
| `bildet … har feil navn` | Import with `npm run images`, or rename the file to match the pattern. |
| `gangruten … skal hete …` | Multiple routes must be named `<id>-route-1.gpx`, `<id>-route-2.gpx`. |
| `status er «reviewed», men reviewed …` | Fill in `reviewed.by` and `reviewed.date`. |
| `index.en.md: ukjente nøkler …` | Typo in the translation. See [Translation](site-files.md#translation). |
| The wind assessment is missing on the site | The forecast is too old, or MET did not respond. Check `https://data.hpgt.workers.dev/v1/forecast.json`, and run «Build and deploy» manually. |
| «Data service» fails with an authentication error | The Cloudflare token has expired or been changed. Roll it and update `CLOUDFLARE_API_TOKEN` in the environment `cloudflare`. |
| The airspace layer says «Kunne ikke hente luftrom» ("Could not load airspace") | `assets/airspace.geojson` is missing from the build. Check that `src/_data/cache/airspace/region.geojson` exists. |
