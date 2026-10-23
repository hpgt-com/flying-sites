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
npm run check:behaviour  # what the pages do in Chromium: markers on zoom, live layer, data service down, «Meld fra», offline
```

`check:a11y` fails only on findings with impact «serious» or «critical», and lists the rest. With a Chromium already
installed, set `CHROMIUM_PATH` instead of running `playwright install`. Pages checked: `PAGES` in
`scripts/check-a11y.mjs`. `check:behaviour` runs the scenarios in `scripts/check-behaviour.mjs` with the data service and
Turnstile answered by the script (stations from `test/fixtures/stations.json`, moved to now) and no network; add a scenario
there when something in the browser breaks.

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

## Data service health

- `https://data.hpgt.workers.dev/v1/status.json` (`workers/data/src/health.js`) says for each source when it last
  ran, last succeeded and its last error, and how long its runs take (`lastMs`, `avgMs` as a running average, `maxMs`
  the slowest today: a failure at 20 000 ms is a timeout, a success at 8 000 a slow source), for each dataset when it was last written and whether that is within its
  limit (forecast 60 min, stations 15, winds aloft 90, verification 90), which launches the forecast and the winds aloft
  lack, and the last day archived per station source. `"ok": false` when a dataset is too old.
- «Data service health» (`health.yml`) checks it from outside every hour: when something is wrong it opens an issue
  «Datatjenesten: data mangler eller er for gamle» (or comments on the open one), and closes it when all is well again.
  GitHub may run it late, so a problem can take an hour or two to show. Run it now: Actions → «Data service health» →
  «Run workflow».
- When it reports a problem: the logs are in Cloudflare (Workers → data → Observability), and a source that fails keeps
  its error in the status until it succeeds again. The usual causes are a source down (MET, Holfuy, Frost, Open-Meteo),
  an expired secret, or one of the free plan's daily limits (reset at 00:00 UTC): 100 000 requests, and for the store
  100 000 requests, 5 million rows read and 100 000 rows written (Cloudflare e-mails at 90 %). `test/data-quota.test.js`
  runs one day of the schedule against a full store and fails when it uses more than 30 % of any of these (run it with
  `QUOTA_DETAIL=1` to see which queries cost what). Every query on the time goes through a key or an index
  (`workers/data/src/indexes.js`, `test/store-indexes.test.js`), and each index costs a row written per row. The
  datasets are cached 60 seconds in front of the store (`cache.js`), so page views add little.
- Publishing (`data-worker.yml`): after `wrangler deploy` the job waits up to 6 minutes until the new version has run
  the stations successfully and serves `/v1/forecast.json` (`scripts/data-smoke.mjs`). If it does not, the job rolls
  back to the version that ran before (`wrangler rollback`) and fails, so the alert opens an issue. A rollback by hand:
  Cloudflare → Workers & Pages → data → Deployments, or `npx wrangler rollback` in `workers/data`.
- The forecast grids (`/v1/grid.json`, `/v1/grid-wide.json`, `sources/grid.js`) use Open-Meteo's free, non-commercial
  use: at most 600 points a minute and 10 000 a day. The close grid (about 540 points) is fetched every 3 hours and the
  wide one (about 380) every 6, at different minutes, so a day uses about 5 800, and the winds aloft about 300 more.
  `test/data-store.test.js` fails if a grid gets over 600 points or the day over 7 000. A larger area or a finer grid
  needs Open-Meteo's paid API.
- Restoring: the code is in Git (redeploy with Actions → «Data service» → «Run workflow»). The store (the Durable
  Object) holds only data that comes back by itself: the forecast and winds aloft within half an hour, the last 7 days
  of measurements from the sources' own short history (Holfuy and Frost give only the latest, so a lost store loses
  the days not yet archived), the verification from then on. The flying activity per day (`flight_days`) and the
  verification history (`verify_hours`) are backed up to R2 every night at 02:14 UTC (`backup.js`:
  `backup/<table>/<day>.json` and `latest.json`, 90 days kept). A new, empty store reads `latest.json` back in within a
  minute of starting (`store.js` `restore`, tried every minute until it has succeeded once, shown in `/v1/status.json`
  as `backup.restored` and as the source `restore`), so after a lost store the history is back with nothing to do by
  hand, and a restore that keeps failing shows in the health check. The archive in R2 has the measurements of every
  finished day.

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
  `workers/data/src/report.js`), checks it with Cloudflare Turnstile and creates the issue. At most 50 a day, and 3 from one address (kept
  only as a hash with a salt for the day). Turnstile's answer must be for `flysteder.hpgt.com` (or the hosts in
  `REPORT_ORIGINS` when testing).
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
  IGC and a KML file counts once. One folder per pilot (`pilots` in the file is the number of folders). A flight that
  counts wrongly can be left out with `--skip <part of the file name>` (repeatable; run it with the same skips again).
- A flight is found where the log moves at 4 m/s or more over 20 seconds (takeoff and landing), and counts for the
  nearest launch within 500 m (a site's `launch` and its `launches` with a position). The script prints how many
  flights it found per site, how many were elsewhere, in how many IGC and KML files, and the files without a flight
  or that could not be read (`--list` names them). KML works with times: a gx:Track, or one placemark per fix with
  its time, or a GpsDump trip (the tracklog's times in FsInfo); a KML with only a line has no times and gives no
  flight (export IGC instead; XCTracer writes such a KML beside its IGC, and the IGC is counted).
- Shown on the site page as «Fra turlogger» when the site has flights in the file. For now there is no
  `src/_data/logbook.json`, so the box is hidden: one pilot's logs were too few, and the records did not match Flightlog.
  Commit the file again when more pilots have added logs (or Flightlog or pgpilot get an API, #105).

## Pilots in the air (OGN)

- The map layer «Piloter i lufta» asks the data service every 10 seconds while it is on; the data service asks OGN's live
  map (`live.glidernet.org/lxml.php`, the area of the sites with a margin) at most once per 10 seconds and passes on what
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
- **The APRS reserve** (`workers/data/src/aprs.js`): when the live map does not answer (it gave `521` all of the afternoon
  of 21.10.2026), both the layer and the flying activity read the same positions from OGN's APRS stream instead
  (`aprs.glidernet.org:14580`, read-only with passcode -1 and an area filter for the same area): the layer listens 8
  seconds, the flying activity 20. The stream is OGN's own backbone, which receivers and apps such as pgpilot send to;
  it needs no receiver of ours. Since the stream has every device, OGN's rules are followed here: the no-tracking flag
  in each message and `tracked: N` in OGN's device database (`ddb.glidernet.org/download/ddb-cache.csv`, fetched by the store
  every day at 05:14 UTC while OGN is up, source `ognDdb` in `/v1/status.json`, state `ogn-notrack`) leave a device
  out, and no one is named (all are «Ukjent»). The database went down with the live map on 21.10.2026, so the list is
  fetched ahead and the kept one used up to a week old; without any list the reserve gives nothing. `/v1/live.json` then has `"via": "aprs"`, and the flights run logs `flights: … fra OGNs
  APRS-strøm`. It does not help when all of OGN is down, or when a pilot's app could not send.
- The address is OGN's own live map's and is not documented; if OGN changes it, the reserve above is used, and if that
  fails too the layer shows nothing and the data service logs `live: …`. Receivers near Harstad (October 2026): AVX970 north of Evenes, AVX1058 Hadsel/Sortland,
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
  `source` + `station` identify a station, since two providers can use the same number. Written from 03:00 UTC for the day before, so
  measurements that come in late are included (`workers/data/src/archive.js`). The fresh measurements are published
  before the archive is written, so a failing archive (R2 down) does not stop «Målt nå»; nothing is deleted from the
  store before its day is archived.
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
- **Off-site copy** (`.github/workflows/backup.yml`, every night at 03:30 UTC and by hand with «Run workflow»): the whole
  bucket is copied with rclone to the bucket `hpgt-flysteder-backup` at Backblaze B2 (another provider, so a lost
  Cloudflare account or bucket does not lose the data) under `archive/`, never deleting anything there (the B2 bucket
  keeps old versions too). The copy's `latest.json` of each table is then checked (`scripts/check-backup.mjs`,
  `lib/backup-check.js`): present, parses as that table, from today or yesterday. The issues and their comments go to
  `github/` every night (the only copy of «Meld fra» outside GitHub) and the whole Git history as a bundle to
  `git/flying-sites.bundle` on Sundays (`git clone flying-sites.bundle` restores it). A failed night opens the issue
  «Backup: den nattlige kopien feilet», closed by the next good night. The keys are in the GitHub environment `backup`
  (see [Accounts and secrets](#accounts-and-secrets)). **Restoring R2 from the copy** (a lost bucket): create the
  bucket, then from a machine with rclone and both keys: `rclone copy b2:hpgt-flysteder-backup/archive r2:hpgt-data-archive`;
  the data service then reads the history back in by itself within a minute of its store being empty (`store.js`
  `restore`).
- If the forecast is more than 6 hours old (`maxForecastAgeHours` in `src/_data/windRules.json`), or comes from a MET
  model run more than 12 hours old (`maxModelAgeHours`), the wind assessment
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

## Power lines and obstacles

- The map layer «Kraftlinjer og hindre» (home page and site pages, off until turned on) comes from
  `src/_data/cache/obstacles/` (`index.json` and `tiles/<row>_<column>.geojson`, 0.25° × 0.5°, about 28 × 20 km),
  fetched by `npm run obstacles` (`scripts/update-obstacles.mjs`, `lib/obstacles.js`) for the whole region around
  the sites (25 km beyond the outermost, out to whole tiles), so flights away from the sites are covered too. The map
  loads only the tiles in view, from zoom 10 («Zoom inn for å se kraftlinjer» further out). A new site far from the
  others widens the region at the next fetch.
  - **NVE** (`kart.nve.no/enterprise`, NLOD): the overhead power lines of the transmission, regional and distribution
    grid (22 kV and up) with voltage and owner, and wind turbines in operation. The masts and poles only within 1.5 km
    of each site's launches and landings (there are over 40 000 in the region; the lines show where they stand).
  - **OpenStreetMap** (Overpass, ODbL, one query for the whole region): low-voltage lines (`power=minor_line`), ski
    lifts and other aerial lifts (also `aerialway=yes`, such as old goods cables), and communication masts. Only where
    someone has drawn them.
- Fetched on the 2nd of each month (`obstacles.yml`); changes arrive as a PR. No secrets are needed. **Fetch now:**
  Actions → «Update power lines and obstacles» → «Run workflow», or `npm run obstacles` locally.
  `npm run obstacles -- --no-osm` fetches NVE only (when Overpass cannot be reached); the file then says so, and the
  map's attribution names only NVE.
- Not complete: low voltage (230/400 V) is not in NVE's data and only partly in OpenStreetMap, and wires that are not
  power lines (guy wires, cables for timber and goods) are rarely in either. Kartverket's register of aviation obstacles
  (NRL) closed for the public on 1 July 2026 («Norge digitalt begrenset»; access for entitled users by application to
  kundesenter@kartverket.no). What is known locally belongs in the site's hazards.
- A missing lift, line or mast is best added in OpenStreetMap; it comes with the next monthly fetch.

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
| `OPENAIP_API_KEY` | GitHub → Settings → Environments → `automation` (only `main`) | Monthly airspace fetch |
| GitHub App «HPGT Flying Sites»: `APP_CLIENT_ID` (variable), `APP_PRIVATE_KEY` (secret) | hpgt-com → Developer settings → GitHub Apps; the variable under flying-sites → Settings → Secrets and variables, the secret in the environment `automation` (only `main`) | Automation in GitHub Actions (today: the airspace PRs, so the PR check runs) |
| Cloudflare account «HPGT» (owner: Kristoffer's user for now; move to a club address under Manage account → Members) | dash.cloudflare.com | The data service (`data.hpgt.workers.dev`) and «Meld fra» |
| `HOLFUY_KEY` | Cloudflare → Workers & Pages → data → Settings → Variables and Secrets | The Holfuy stations |
| `FROST_CLIENT_ID` | Cloudflare → Workers & Pages → data → Settings → Variables and Secrets | MET's stations (Frost) |
| `TURNSTILE_SECRET` | Cloudflare → Workers & Pages → data → Settings → Variables and Secrets | «Meld fra»: the robot check (the site key is public, in `src/_data/site.js`) |
| GitHub App «HPGT Flying Sites Reports»: `REPORTS_APP_ID`, `REPORTS_APP_PRIVATE_KEY` | Cloudflare (as above); the app under hpgt-com → Developer settings → GitHub Apps | «Meld fra»: makes the issues (only Issues: read and write) |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | flying-sites → Settings → Environments → `cloudflare` (only `main`) | Publishing the data service. The token («GitHub – flying-sites»: Workers Scripts Edit, Workers R2 Storage Edit, Account Settings Read, in HPGT only, made 22.10.2026 with a year's TTL) expires in October 2027: make a new custom token with the same permissions under My Profile → API Tokens, update the secret, run «Data service» once, and delete the old token. |
| GoatCounter `hpgt-flysteder` | goatcounter.com | Visitor statistics |
| Backblaze B2 (free plan; the account is on the club's address) with the bucket `hpgt-flysteder-backup` and the key `github-backup` (that bucket only, read and write, no expiry) | backblaze.com | The off-site copy of the archive, the backups, the issues and the code (`backup.yml`) |
| `B2_KEY_ID`, `B2_APPLICATION_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (secrets); `B2_ENDPOINT`, `R2_ENDPOINT` (variables; `B2_BUCKET` and `R2_BUCKET` only when the names differ from the defaults in `backup.yml`) | flying-sites → Settings → Environments → `backup` (only `main`) | `backup.yml`. The R2 token («github-backup-read», account token, Object Read only, `hpgt-data-archive` only, no expiry) is made under R2 → Manage R2 API Tokens |
| UptimeRobot (free plan; the account is on the maintainer's e-mail, moved by changing it under My Settings → Account) | uptimerobot.com | Three monitors every five minutes: `https://flysteder.hpgt.com/` answers, `https://hpgt.com/` (the club's site) answers, and `/v1/status.json` on the data service contains `"ok":true`. E-mails the alert contacts when one fails and when it is back. |
| GitHub Pages, domain | Settings → Pages, DNS record for `flysteder.hpgt.com` | Publishing |

MET and Kartverket require no key. MET requires the client to provide contact details (`USER_AGENT` in
`lib/weather/met.js`).

## Runbook

What to do when something stops, and how the next board takes over. Everything here can be done by one person with
admin on the repository and the Cloudflare account; nothing needs a developer machine except where `npm` is named.

**A source is down (MET, Holfuy, Frost, Open-Meteo, OGN).** Nothing to do. The data service keeps the last good data,
the pages show it with its age, and the assessment goes off when the forecast is too old (6 hours). The status
(`/v1/status.json`) shows the source's last error; the hourly check opens an issue only when the source has failed for a
day or a dataset is over its limit.

**The schedule has stopped.** GitHub turns the schedule of a public repository off after 60 days without a commit, and
runs it late when busy. Signs: the monthly airspace PR did not come, or «Data service health» has not run for days
(Actions → the workflow → the list of runs). Fix: Actions → the workflow → «Enable workflow», then «Run workflow». A
commit of any kind resets the 60 days. The data service's own schedule runs on Cloudflare and is not affected, and
UptimeRobot (see [Accounts and secrets](#accounts-and-secrets)) watches the site and the status from outside GitHub
whatever the schedule does: an e-mail from it is the first sign of a problem in a quiet season.

**The data service does not answer, or answers 503.** The pages still work from the built-in forecast. Look at
Cloudflare → Workers & Pages → data → Observability (the logs name the source and the error) and at Metrics (the
free plan's daily limits reset at 00:00 UTC; Cloudflare e-mails at 90 %). A bad version: roll back under Deployments
(or `npx wrangler rollback` in `workers/data`). A lost store comes back by itself, see
[Data service health](#data-service-health). To publish again from the code: Actions → «Data service» → «Run workflow».

**A publish of the site went wrong.** Actions → «Build and deploy» → an earlier green run → «Re-run all jobs» publishes
that commit again, with a fresh forecast. For good: `git revert` of the merge on `main` through a PR. Nothing is lost:
every publish is built from Git.

**A secret or token may have leaked, or has expired.** Roll it where it lives (the table under
[Accounts and secrets](#accounts-and-secrets)), and nothing else needs to change:

- `CLOUDFLARE_API_TOKEN`: a new custom token under My Profile → API Tokens (Workers Scripts: Edit, Workers R2
  Storage: Edit, Account Settings: Read, account HPGT only), then the environment `cloudflare` in GitHub, run «Data
  service» once, and delete the old token. Expires in October 2027; «Data service» then fails with an authentication
  error.
- The Worker's secrets (`HOLFUY_KEY`, `FROST_CLIENT_ID`, `TURNSTILE_SECRET`, `REPORTS_APP_*`): new value under
  Variables and Secrets; the running version picks it up at once. For a GitHub App key, make a new key under the app
  and delete the old one. For Turnstile, a new widget under Cloudflare → Turnstile gives a new site key
  (`src/_data/site.js`) and secret.
- `OPENAIP_API_KEY` and `APP_PRIVATE_KEY`: new value under Settings → Environments → `automation`.
- A GitHub account with admin: change the password, check Settings → Sessions and Applications, and keep two-factor
  with a security key.

If a token with write access to the repository may have leaked, also read the commits and Actions runs since (Settings →
Audit log on the organization).

**The domain does not resolve, or shows GitHub's 404.** `flysteder.hpgt.com` is a CNAME to `hpgt-com.github.io` at the
DNS provider of `hpgt.com`, and the domain is set under Settings → Pages (with «Enforce HTTPS»). GitHub also checks the
verification record `_github-pages-challenge-hpgt-com` (Organization → Settings → Pages → Verified domains). If the
record or the Pages setting is gone, put it back; the certificate renews by itself within a day.

**Handing over to a new board.** Give the new person owner on the GitHub organization `hpgt-com` and admin on the
repository, a member with Administrator on the Cloudflare account «HPGT» (and move the account's owner to a club
address if it is still a person's), access to the GoatCounter account and to the DNS of `hpgt.com`, and ownership of
the two GitHub Apps (the organization owns them). Then remove the people who left. The checklist in `SECURITY.md`
is the list of settings to go through afterwards.

## Disaster recovery

What is lost when each part goes, what brings it back, and how long it takes. The site is static and built from Git,
and the data service keeps only data that comes back by itself within the hour, except the history and the archive,
which are copied every night. Everything below that says «by itself» has been run at least once, with the date.

**Targets.** At most 24 hours of history and archive lost (the copies are nightly). The site and the data service back
within an hour, with no step that needs a developer machine.

**What lives where, and its copies.**

| What | Lives in | Comes back from | Copy taken |
|---|---|---|---|
| Code, site files, images, workflows | GitHub (`hpgt-com/flying-sites`) | Any clone; `git/flying-sites.bundle` in the B2 bucket (`git clone flying-sites.bundle`) | Bundle every Sunday (`backup.yml`); every maintainer's clone |
| Issues (including «Meld fra») and comments | GitHub | `github/issues.json` and `github/issue-comments.json` in the B2 bucket, as the API gives them | Every night |
| Forecast, winds aloft, grids, last 7 days of measurements, pilots in the air | The store (Durable Object) | The sources, within the hour; the last 7 days of measurements only as far as the sources' own history goes (Holfuy and Frost give the latest only) | None needed |
| Flying activity per day, verification history | The store | `backup/<table>/latest.json` in R2, read in by the store itself within a minute of being empty (`store.js` `restore`, since 23.10.2026) | Every night 02:14 UTC to R2, 03:30 UTC on to B2 |
| Weather archive (CSV per station and day) | R2 `hpgt-data-archive` | `archive/` in the B2 bucket `hpgt-flysteder-backup` (`rclone copy b2:… r2:…`) | Every night 03:30 UTC |
| Settings outside Git: rulesets, environments, Pages, Turnstile, the GitHub Apps, DNS | GitHub, Cloudflare, the DNS provider | By hand from the checklist in `SECURITY.md` and the table under [Accounts and secrets](#accounts-and-secrets) | None (it is small; the checklist is the copy) |
| Secrets and keys | Where the table says; the values in the club's password manager | Rolled, never restored: new values where they live | — |

**Scenarios, in the order to work them.**

1. **The store is lost** (a Durable Object migration gone wrong, a Cloudflare incident, a reset). Nothing to do. The
   next minute the store reads the history back in from R2, the sources fill the rest within the hour, and
   `/v1/status.json` shows `backup.restored` with the time and rows. Verified 23.10.2026: 274 + 1 rows in 1.1 s.
2. **The archive bucket is lost, or emptied.** Create `hpgt-data-archive` again (R2, private), then from any machine with
   rclone and the two keys from the environment `backup`: `rclone copy b2:hpgt-flysteder-backup/archive r2:hpgt-data-archive`.
   Then scenario 1 happens by itself. About half an hour for the copy at today's size.
3. **The Cloudflare account is lost.** New account (on the club's address), R2 and the bucket as under
   [Weather archive (R2)](#weather-archive-r2), the Worker's secrets as under [Accounts and secrets](#accounts-and-secrets)
   (the values from the password manager; a lost `REPORTS_APP_PRIVATE_KEY` is replaced by a new key on the app, a lost
   Turnstile widget by a new one), a new deploy token into the environment `cloudflare`, Actions → «Data service» →
   «Run workflow», then scenario 2. The pages work from the built-in forecast meanwhile; `src/_data/site.js` names the
   service's address, which changes with the account. An hour of work plus the copy.
4. **The GitHub repository is lost.** Push any clone, or the bundle from B2, to a new repository (`git clone
   flying-sites.bundle`, add the remote, `git push --all`). Then the settings from the `SECURITY.md` checklist: Pages
   with the domain, the environments `automation`, `cloudflare` and `backup` with their secrets and variables, the
   rulesets, the two GitHub Apps' installation. The issues are in `github/issues.json` for reading; they are not
   imported back. Half a day, mostly settings.
5. **The B2 account is lost.** Nothing is down. New account and bucket, new key into the environment `backup`, and the
   next night copies everything again from R2.
6. **The domain.** See «The domain does not resolve» under [Runbook](#runbook). The DNS of `hpgt.com` is outside this
   repository.
7. **The person is unavailable.** See «Handing over to a new board» under [Runbook](#runbook). This is the one scenario
   nothing here automates: it needs a second owner on the GitHub organization and the Cloudflare account, and the
   password manager shared, before it is needed.

**What watches it.** `backup.yml` fails and opens an issue when the nightly copy or its check fails, and closes it when
a night goes through again. `health.yml` opens an issue when the store's own backup is more than two days behind, or
when the restore keeps failing. UptimeRobot e-mails when the site or the status stops answering. A quiet repository
turns GitHub's schedules off after 60 days without a commit (see [Runbook](#runbook)); UptimeRobot does not depend on it.

**Not yet done.** A staging Worker (`[env.staging]` in `wrangler.toml` with its own store and bucket) and a monthly run
that restores there from the copy and compares the row counts, so scenario 2 is proven without touching production;
and a «Recover» workflow that runs scenario 3's deploy and checks in one go. A copy of the repository at another Git
host would make scenario 4 a push instead of a bundle.

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
| An issue «Datatjenesten: data mangler eller er for gamle» | See [Data service health](#data-service-health). It closes by itself when the status is in order again. |
| An issue «Jobben «…» feilet» | A run failed (the job `alert` opens it, or comments on the open one). Open the run from the link, fix the cause, run the workflow again, and close the issue. |
| «Data service» fails with an authentication error | The Cloudflare token has expired or been changed. Make a new one (see [Runbook](#runbook)) and update `CLOUDFLARE_API_TOKEN` in the environment `cloudflare`. |
| The airspace layer says «Kunne ikke hente luftrom» ("Could not load airspace") | `assets/airspace.geojson` is missing from the build. Check that `src/_data/cache/airspace/region.geojson` exists. |
