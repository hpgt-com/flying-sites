# Architecture

How flysteder.hpgt.com is put together: where the data comes from, what happens when the site is built, and what
runs in the browser. The diagrams are Mermaid and render as diagrams on GitHub.

In short: **a static site with no server and no database.** All content lives as files in the repository. GitHub
Actions builds the site with Eleventy and publishes it to GitHub Pages, twice an hour and on every change. Data that
must be fresh (the wind forecast) is fetched in its own job just before the build. Data that is slow to fetch
(airspace, heights) is cached in the repository. Each kind of external data is a module, see
[Data modules](#data-modules).

## Overview

```mermaid
flowchart LR
  subgraph repo["GitHub repository (hpgt-com/flying-sites)"]
    sites["Site files<br/>src/sites/&lt;id&gt;/index.md<br/>+ index.en.md, images, GPX, drawing"]
    data["Shared data<br/>src/_data/ and src/_i18n/"]
    cache["Cache<br/>src/_data/cache/<br/>(airspace, heights)"]
    code["Templates, scripts, CSS<br/>src/_includes/, src/assets/, lib/"]
  end

  subgraph actions["GitHub Actions"]
    prcheck["PR check<br/>tests + build,<br/>links, HTML, axe"]
    deploy["Build and deploy<br/>on merge + twice an hour<br/>(weather → build → deploy)"]
    airspace["Update airspace<br/>1st of each month → PR"]
    scan["Code scanning<br/>CodeQL"]
  end

  subgraph ext["External sources"]
    met["MET Locationforecast<br/>(wind forecast)"]
    kv["Kartverket elevation data<br/>(walking routes)"]
    oaip["openAIP<br/>(airspace)"]
  end

  pages["GitHub Pages<br/>flysteder.hpgt.com"]

  subgraph browser["The browser"]
    ui["Home page and site pages<br/>Leaflet map, filters,<br/>wind assessment"]
  end

  subgraph runtime["Fetched by the browser"]
    tiles["Map tiles<br/>Kartverket, høydedata.no, OpenTopoMap,<br/>EOX Sentinel-2, kk7 thermals"]
    yr["Yr meteogram"]
    gc["GoatCounter<br/>(anonymous statistics)"]
  end

  sites & data & cache & code --> deploy
  sites & code --> prcheck
  met --> deploy
  kv -. "new GPX" .-> cache
  oaip --> airspace --> cache
  deploy --> pages --> ui
  ui --> tiles & yr & gc
```

- **Content is files.** Each site is one folder. Changes go through a pull request, and the PR check stops invalid
  site files before they go live.
- **Automatic imports never write to the site files**, only to `src/_data/cache/`. Airspace arrives as a separate PR
  that is reviewed.
- **No secrets in the browser.** The only key (`OPENAIP_API_KEY`) is used only in the workflow.

## The build

Eleventy reads the data in a fixed order (the data cascade) and generates one HTML page per page and language.

```mermaid
flowchart TB
  subgraph global["Shared data (src/_data/)"]
    lang["languages.js<br/>nb, en (prefix, URLs)"]
    i18n["i18n.js ← src/_i18n/nb.json, en.json<br/>(Norwegian as fallback)"]
    fc["forecast.js, windgram.js<br/>read .cache/weather/<br/>(lib/weather/)"]
    rules["windRules.json, towers.json,<br/>site.js, photoCredit.json"]
    comp["eleventyComputed.js<br/>lang and t (the dictionary) per page"]
  end

  subgraph site["Per site and language (sites.11tydata.js)"]
    pag["Pagination over languages<br/>/flysteder/&lt;id&gt;/ and /en/sites/&lt;id&gt;/"]
    derived["derived:<br/>walking routes (lib/gpx.js + Kartverket)<br/>images (lib/images.js)<br/>airspace (lib/airspace.js + cache)<br/>translation (lib/translations.js)<br/>last changed (lib/git.js)"]
  end

  valid["The «sites» collection<br/>validation (lib/validation.js)<br/>the build stops on errors"]

  subgraph out["Pages and files in _site/"]
    home["/ and /en/<br/>home page"]
    sitepg["site pages"]
    towers["/tarn/ and /en/towers/"]
    status["/status/<br/>(lib/status.js)"]
    exp["flysteder.geojson / .kml<br/>(lib/export.js)"]
    seo["sitemap.xml, robots.txt, 404"]
  end

  global --> site --> valid
  valid --> home & sitepg & status & exp & seo
  global --> towers
```

| Part | Where | What it does |
|---|---|---|
| Site data | `src/sites/<id>/index.md` | Front matter (structured data) and Markdown text. See [site-files.md](site-files.md). |
| Validation | `lib/validation.js` | Unknown keys, invalid directions, levels and categories, wrongly named images, missing walking routes. Errors stop the build. |
| Walking routes | `lib/gpx.js` | Length, elevation gain, moving time and elevation profile. Heights from Kartverket, cached per file in `src/_data/cache/elevations/`. |
| Images | `lib/images.js`, `lib/site-images.js` | WebP/JPEG at 400–2400 px without metadata, with photographer and licence embedded. Images are found by file name. |
| Airspace | `lib/airspace.js`, `lib/airspace-profile.js`, `scripts/update-airspace.mjs` | openAIP per launch, the "ceiling" above the launch and its height profile, notes from the site file. The map layer uses `region.geojson`. |
| Weather | `lib/weather/`, `src/_data/forecast.js`, `src/_data/windgram.js` | 48 hours of wind, gusts and precipitation per launch from MET, and winds aloft from Open-Meteo. Read from `.cache/weather/`, see [Data modules](#data-modules). If one site fails, only that site is missing. |
| Languages | `lib/i18n.js`, `lib/translations.js` | Dictionaries, URLs per language and translated site text. See below. |
| Status | `lib/status.js` | What is missing per site, for `/status/`. |
| Open data | `lib/export.js` | GeoJSON and KML with launches, landings, parking and walking routes (CC BY 4.0). |

## In the browser

The pages work without JavaScript for the essentials (text, images, links). The scripts add maps, filters and the
wind assessment. The data is embedded in the page as JSON (`<script type="application/json">`), so the scripts do not
need to fetch anything from the site themselves.

```mermaid
flowchart LR
  subgraph page["HTML from the build"]
    j1["#i18n-data<br/>text for the language"]
    j2["#sites-data / #site-data<br/>sites, directions, routes"]
    j3["#forecast-data / #site-wind-data<br/>forecast and rules"]
  end

  common["common.js<br/>FS.t(), maps and map layers,<br/>wind roses, airspace,<br/>colour mode, statistics"]
  wind["wind.js<br/>rateWind(): Kan passe / Usikkert /<br/>For mye vind / Passer ikke"]
  home["home.js<br/>home page: search, filters,<br/>card, summary"]
  site["site.js<br/>site map, direction arcs,<br/>elevation profile"]
  sitewind["site-wind.js<br/>«Kan jeg fly her nå?» on the site page"]
  lightbox["lightbox.js<br/>image viewer"]
  goat["goatcounter.js<br/>(copy, CSP allows only own scripts)"]
  pwa["pwa.js<br/>registers the service worker,<br/>«Du er offline» notice"]
  sw["sw.js (service worker)<br/>pages, files, GPX and<br/>Kartverket tiles offline"]

  j1 --> common
  common --> home & site & sitewind & lightbox
  j2 --> home & site
  j3 --> wind --> home & sitewind
  common -- "FS.track()" --> goat
  common --> pwa --> sw
```

- **The wind assessment** (`wind.js`) is pure logic without DOM access and is tested in `test/wind.test.js`. The rules
  are in `src/_data/windRules.json`. It returns both text and codes (`gust`, `rain`, `overSiteLimit` …), so the home
  page can count reasons independently of language. The ratings are «Kan passe» ("May work"), «Usikkert»
  ("Uncertain"), «For mye vind» ("Too much wind") and «Passer ikke» ("Not suitable"). It never says «OK å fly»
  ("OK to fly").
- **Category and direction are linked:** with SPG selected, the directions of the launches marked SPG are used
  (`categoryDirections` in `lib/format.js`), in the filter, the rose and the assessment.
- **Offline and app:** the site can be installed from the browser (`/manifest.webmanifest`, one per language). The
  service worker (`/sw.js`, made by `src/sw.11ty.js` from `lib/service-worker.js` and `lib/pwa.js`) stores the pages
  the visitor opens, the site's own files, GPX files and the Kartverket map tiles that have been shown (at most 300),
  so a site checked at home also works on the mountain. Pages are fetched from the network first, so the forecast is
  fresh when there is coverage. The static cache follows the content of the stored files, and the pages and tiles are
  kept across deploys. Nothing is downloaded in advance beyond the front pages, the offline pages and the scripts.
- **Speed:** Leaflet is loaded only on the pages with a map (`map: true` in the front matter: the home page and the
  site pages). On the site page the map and the elevation profile are set up when they come near the screen
  (`IntersectionObserver` in `site.js`), so the map tiles are only fetched when they are needed. The map's first view is
  the fitted one (`fitWhenVisible` in `common.js`), not a temporary view first. On mobile the home page map keeps its
  size while the page scrolls, and only its frame gets lower, so Leaflet does not redraw it. Three font files, all
  preloaded. The home page opens the connections to the tile servers early (`preconnect` in the front matter). The
  site page keeps space for «Kan jeg fly her nå?» until `site-wind.js` has filled it in, so the boxes below do not jump.
- **Security:** the Content-Security-Policy in `base.njk` allows scripts only from the site itself, and images and
  data only from the sources above. A new external source must be added there. See [SECURITY.md](../SECURITY.md).

## Languages

```mermaid
flowchart LR
  langs["src/_data/languages.js<br/>code, name, prefix, slugs"]
  dicts["src/_i18n/nb.json<br/>src/_i18n/en.json"]
  lib["lib/i18n.js<br/>dict(), t(), fmt(), localeUrl()"]
  tr["index.en.md per site<br/>(lib/translations.js)"]
  tpl["Templates: t.site.map,<br/>| fmt, | localeUrl"]
  js["Scripts: FS.t('home.seeSite')"]
  pages["/flysteder/elgen/<br/>/en/sites/elgen/"]

  langs --> lib
  dicts --> lib --> tpl & js
  tr --> tpl
  tpl --> pages
```

- **Norwegian is the main language** and has no prefix. Other languages live under their own prefix (`/en/`), with
  their own URL names (`slugs`: `flysteder` → `sites`, `tarn` → `towers`). `localeUrl` translates URLs both ways and
  is used by the language switcher in the menu, hreflang and the sitemap.
- **Fixed text** (menu, filters, headings, script messages) lives in the dictionaries. Anything missing in a language
  falls back to `nb.json`. `test/i18n.test.js` checks that every lookup in templates and scripts exists.
- **Site text** is translated in `index.<language>.md` next to `index.md`. Text only: coordinates, level and
  directions always come from `index.md`. If the translation is missing, the Norwegian text is shown with a notice.
  The status page lists sites without a translation, and translations older than the Norwegian text.
- **New language:** see [operations.md](operations.md#adding-a-language).

## Publishing and workflow

```mermaid
sequenceDiagram
  participant Dev as Contributor / Claude
  participant PR as Pull request
  participant CI as PR check
  participant Main as main
  participant Deploy as Build and deploy
  participant Pages as GitHub Pages

  Dev->>PR: branch + change
  PR->>CI: npm test, npm run build
  CI-->>PR: green / red
  PR->>Main: merge
  Main->>Deploy: push to main
  Note over Deploy: also at xx:17 and xx:47<br/>for a fresh wind forecast
  Deploy->>Pages: _site/ is published
```

| Workflow | When | What |
|---|---|---|
| `pr-check.yml` | Every PR | Tests, build, link check, HTML validation and the check for template slips such as «[object Object]» (`build`), axe in Chromium on a few pages (`accessibility`), dependency review (packages with known vulnerabilities) and zizmor (workflow security). |
| `deploy.yml` | Push to `main`, at xx:17 and xx:47, manually | Four jobs: `weather` fetches MET and Open-Meteo, `build` builds with that weather and the full Git history (for «Sist endret», "Last changed") and stops if a page has a template slip such as «[object Object]», `deploy` publishes, and `attest` signs build provenance and an SBOM for what was published (see [SECURITY.md](../SECURITY.md#verifying-a-publish)). |
| `data-worker.yml` | Push to `main` when the data service, the MET code or the sites change, manually | Publishes the data service (`workers/data`) to Cloudflare Workers, with the token in the environment `cloudflare` (only `main`). |
| `airspace.yml` | The 1st of each month, manually | Fetches airspace from openAIP and opens a PR if anything has changed. |
| `code-scanning.yml` | PR, push, Mondays | CodeQL (security issues in the code). |
| `scorecard.yml` | Push to `main`, Mondays, branch protection changes | OpenSSF Scorecard (supply-chain good practice). Results in Code scanning and behind the README badge. |
| Dependabot | Monthly | PRs with updated packages and Actions. |

## Data modules

External data is split into modules. Each module has one job: fetch from its source, write files in a fixed format,
and let the site read the files. The templates never fetch anything themselves, so a module can change how or where
it fetches (a workflow today, a backend later) without the site noticing.

| Module | Source | Code | Fetched | Stored in | Read by |
|---|---|---|---|---|---|
| Airspace | openAIP (key) | `lib/airspace.js`, `scripts/update-airspace.mjs` (`npm run airspace`) | `airspace.yml`, the 1st of each month, as a PR | `src/_data/cache/airspace/` (committed) | `sites.11tydata.js`, the map layer |
| Weather | MET Locationforecast, Open-Meteo | `lib/weather/`, `scripts/fetch-weather.mjs` (`npm run weather`) | The `weather` job in `deploy.yml`, before every build | `.cache/weather/` (artifact, not committed) | `src/_data/forecast.js`, `src/_data/windgram.js` |
| Data service: forecast | MET Locationforecast | `workers/data/src/sources/forecast.js` (the same `lib/weather/met.js`) | Every 5 minutes, 6 launches per run | Durable Object (SQLite), served as `https://data.hpgt.workers.dev/v1/forecast.json` | `home.js` and `site-wind.js`, after the page has loaded (`fetchNewerForecast` in `wind.js`) |
| Data service: stations | Holfuy (key `HOLFUY_KEY` in Cloudflare): wind, temperature, humidity, pressure, rain, and other values in `extra` | `workers/data/src/sources/holfuy.js`, fields in `measurements.js`, stations in `stations.js` | Every minute | Durable Object (SQLite): the last 7 days, served with the last 6 hours as `/v1/stations.json`; older days as CSV in R2 (`archive.js`, once R2 is on) | `stations.js` on the home page (map layer, Vær tab) and the station's site page, refetched every minute |
| Heights | Kartverket elevation data | `lib/gpx.js` | During the build, only for new or changed GPX files | `src/_data/cache/elevations/` (committed) | `sites.11tydata.js` |
| Images | The site folders | `lib/images.js`, `lib/site-images.js` | During the build | `_site/img/` (cached in CI) | The site pages |

- **Committed or not:** data that changes rarely and should be reviewed (airspace) is committed and arrives as a PR.
  Data that is only valid for a few hours (weather) is never committed.
- **Failure:** a module that fails leaves out its own part, not the whole site. A weather source that fails is
  written as `null`, and the site builds without the wind assessment or winds aloft.
- **Locally**, `npm start` fetches the weather by itself when `.cache/weather/` is missing or older than 30 minutes.
  In CI the build only reads the files (`WEATHER_FETCH=0`), and the PR check skips the weather (`FORECAST_OFFLINE=1`).
- **Shared code:** `lib/site-files.js` reads the front matter of all sites for the scripts.
- **Data service** (`workers/data`): one Cloudflare Worker with one module per source in `src/sources/`. Each module
  fetches its source, checks and converts the data, and stores the dataset. Every dataset is served the same way, as
  `/v1/<dataset>.json`, with the same frame (`dataset`, `source`, `license`, `fetched`, then the dataset's own fields),
  and a source that fails does not stop the others. One schedule runs every minute, and each source has its own interval
  (`src/schedule.js`: stations every minute, forecast every 5). The store is one Durable Object with SQLite
  (`src/store.js`): the free plan allows far more writes per day there than in KV (1000). Hot and cold: the store keeps
  the last 7 days for the pages; older days go to the archive in R2 as one CSV per station per day, laid out for loading
  into a database later (the station in every row, `station=…/year=…` folders), and nothing is deleted before it is
  archived (`src/archive.js`).
- **Forecast in the data service:** GitHub skips many scheduled runs, so the forecast built into the pages can be hours old. The
  data service fetches MET by itself, and the pages use its forecast when it is newer, well formed and
  covers every launch the page has (`isNewerForecast` in `wind.js`); otherwise they keep their own. It also brings the
  assessment back when the page's forecast has become too old. The free plan gives 10 ms of CPU per run, so each run
  fetches the 6 launches fetched longest ago, and the whole forecast is renewed about every half hour.
- **Next steps:** the stations on the map and in the Vær tab; the winds aloft (Open-Meteo) to the same service. Then the `weather` job and the schedule in
  `deploy.yml` can go, and the site is only built when the content changes.

## What has been built

The main features, roughly in the order they were added. Details are in [SPEC.md](../SPEC.md) and in the PRs.

- **Foundation:** an Eleventy site on GitHub Pages that replaces the old iframe-based guide. One file per site with
  validation, a fixed page template, a Leaflet map with Kartverket as the base map, dark mode and colour-blind-friendly
  colours.
- **Home page:** map with wind roses and clusters (on mobile it stays at the top and shrinks while the list scrolls),
  search, filters for direction, level and category, a card for the selected site, and tabs for Flysteder ("Sites")
  and Vær ("Weather").
- **Wind assessment from MET:** «Kan passe», «Usikkert», «For mye vind» and «Passer ikke» for any hour in the
  forecast (a timeline on the map), with a summary that follows the filters, and «Kan jeg fly her nå?» ("Can I fly
  here now?") with the next 12 hours on the site pages. Turned off when the forecast is too old.
- **Site pages:** map with launches, direction arcs, landings, parking, walking routes and numbered points from the
  drawing, elevation profile from Kartverket, hazards, airspace above the launch, Yr meteogram and image viewer.
- **Data and quality:** Kartverket heights for launch, landing and parking, review of all 32 sites, the status page
  with checks for missing content, open data (GeoJSON/KML).
- **Airspace:** openAIP layer on the map (CTA/TMA, CTR, military areas, danger and restricted areas) with an error
  message and «Prøv igjen» ("Try again"), monthly update via PR, and the towers page.
- **Images:** import with fixed naming, downscaling, and photographer/licence in the metadata.
- **Sharing and statistics:** previews on Facebook/Messenger, sitemap and hreflang, anonymous statistics with
  GoatCounter (pages and clicks, no cookies).
- **Languages:** Norwegian and English, with English text for all sites, and a structure for more languages.

## Planned

```mermaid
flowchart LR
  form["Form on the site<br/>(«Foreslå endring»)"] --> worker["Cloudflare Worker<br/>Turnstile + GitHub key"]
  worker --> issue["GitHub issue<br/>labelled from-form"]
  issue --> agent["Agent (GitHub Action)<br/>summarises and labels"]
  agent -- "approved" --> pr["PR with the change"]
  pr --> review["Review and merge"]
  worker -. "later" .-> live["Live weather data and NOTAM<br/>(cache)"]
  data["Data service (built)<br/>data.hpgt.workers.dev: forecast, stations"] -. "same account" .- worker
```

- **Data service** (built): the MET forecast and the Holfuy stations on Cloudflare Workers, see [Data modules](#data-modules).
  The Cloudflare account «HPGT» is the club's; the form, more stations, winds aloft and OGN/FANET go in the same service.
- **Change form** without a GitHub account, via a Cloudflare Worker that creates the issue and replies with a link
  to it. An agent summarises the issue, and creates the change as a PR once it is labelled `approved`.
- **Live weather data** from the club's and the model aircraft club's (Modellflyklubben) stations, and **NOTAM** as a
  separate map layer. Both need a server-side intermediary (the same Worker, or Cloudflare Pages Functions if the site
  moves there).
