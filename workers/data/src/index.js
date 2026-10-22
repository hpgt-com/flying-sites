// The data service for flysteder.hpgt.com on Cloudflare Workers (deployed by .github/workflows/data-worker.yml).
//
// One module per source in sources/ fetches, checks and converts its data, and stores the dataset in the store
// (store.js). Every dataset is served the same way, as /v1/<dataset>.json, with the same frame: dataset, source and
// fetched (and license where the source's terms ask for one, as MET's do), then the dataset's own fields. A source that fails does not stop the others.
//
// - forecast: the MET forecast for each launch (sources/forecast.js), used by the pages when it is newer than the one
//   built into the page (fetchNewerForecast in src/assets/js/wind.js).
// - stations: measured wind from Holfuy's stations (sources/holfuy.js, stations in stations.js) and MET's stations in
//   the area (sources/frost.js), served together; each station carries its own source.
// - windgram: winds aloft from Open-Meteo for the launches in WINDGRAM_SITES (sources/windgram.js), used by the site
//   page when newer than the one built into it (src/assets/js/windgram.js).
// - verification: how well the forecast hit at each flying site with its own station (sources/verify.js), on the weather
//   page and the site page.
// - flights: how many paragliders are seen in the air from each flying site, per month, from the Open Glider Network
//   (sources/flights.js), on the site page (src/assets/js/flights.js).
//
// - grid, grid-wide: Open-Meteo's forecast for a grid close around the sites every three hours, and a coarser one over
//   a wider area every six (sources/grid.js), for the map layers
//   «Prognose» (src/assets/js/forecast-layer.js).
//
// - live: the aircraft the Open Glider Network hears in the area now (live.js), fetched on demand and cached a few
//   seconds, for the map layer «Piloter i lufta» (src/assets/js/live.js).
// - POST /v1/report: «Meld fra om endring» from the site pages, as a GitHub issue (report.js).
// - status: how the sources and datasets are doing (health.js), for the hourly check in .github/workflows/health.yml.
//
// sites.json (the launches) is written from the site files before deploy (scripts/data-sites.mjs).

import * as forecast from "./sources/forecast.js";
import * as holfuy from "./sources/holfuy.js";
import * as frost from "./sources/frost.js";
import * as windgram from "./sources/windgram.js";
import * as verify from "./sources/verify.js";
import * as flights from "./sources/flights.js";
import * as grid from "./sources/grid.js";
import { HOLFUY_STATIONS, MET_STATION_SITES, MET_EXCLUDE, siteLinks } from "./stations.js";
import { due, INTERVALS } from "./schedule.js";
import { mergeStations } from "./merge.js";
import { handleReport, ORIGINS } from "./report.js";
import { handleLive } from "./live.js";
import { recordRuns, buildStatus, MAX_AGE } from "./health.js";
import { cached, CACHE_SECONDS } from "./cache.js";
import { WINDGRAM_SITES } from "../../../lib/weather/open-meteo.js";
import SITES from "./sites.json";

export { Store } from "./store.js";

const DATASETS = { "/v1/forecast.json": forecast.DATASET, "/v1/stations.json": holfuy.DATASET, "/v1/windgram.json": windgram.DATASET, "/v1/verification.json": verify.DATASET,
  "/v1/flights.json": flights.DATASET, "/v1/grid.json": "grid", "/v1/grid-wide.json": "grid-wide" };

const store = (env) => env.STORE.get(env.STORE.idFromName("main"));

// Public data, read by the pages on flysteder.hpgt.com (and anyone else), so any origin may read it. Short cache: the
// data changes every few minutes. The answers are data, never a page: opened as a document or in a frame they can do
// nothing (content-security-policy), and other sites may load them (cross-origin-resource-policy).
const INERT = { "content-security-policy": "default-src 'none'; frame-ancestors 'none'", "cross-origin-resource-policy": "cross-origin" };
const HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "x-content-type-options": "nosniff",
  ...INERT,
};

export default {
  async scheduled(controller, env, ctx) {
    const s = store(env);
    const now = controller.scheduledTime;
    const runs = {};
    if (due("forecast", now)) runs.forecast = forecast.run(s, SITES, now);
    if (due("stations", now)) runs.stations = holfuy.run(s, env, HOLFUY_STATIONS, now);
    if (due("met", now)) runs.met = frost.run(s, env, SITES, MET_STATION_SITES, now, MET_EXCLUDE);
    if (due("windgram", now)) runs.windgram = windgram.run(s, SITES, now);
    if (due("verify", now)) runs.verify = verify.run(s, siteLinks(), now);
    if (due("flights", now)) runs.flights = flights.run(s, SITES, now, INTERVALS.flights);
    if (due("grid", now)) runs.grid = grid.run(s, "grid", SITES, now);
    if (due("gridWide", now)) runs.gridWide = grid.run(s, "grid-wide", SITES, now);
    if (due("backup", now)) runs.backup = s.backup(new Date(now).toISOString().slice(0, 10));
    if (due("ognDdb", now)) runs.ognDdb = s.refreshNoTrack(now);
    ctx.waitUntil(Promise.allSettled(Object.values(runs)).then(async (results) => {
      const outcome = {};
      Object.keys(runs).forEach((name, i) => {
        const failed = results[i].status === "rejected";
        if (failed) console.warn(`${name}: ${results[i].reason?.message}`);
        outcome[name] = failed ? results[i].reason?.message || "feil" : null;
      });
      // When each source last ran and last succeeded, for /v1/status.json.
      if (Object.keys(outcome).length) await s.putState("health", recordRuns(await s.getState("health"), outcome, now));
    }));
  },

  // Whatever goes wrong (the store overloaded or out of its daily quota, a bug), the answer is still JSON with the CORS
  // headers, so the page sees a 503 it can handle, not Cloudflare's error page without them (which the browser reports
  // as a CORS failure).
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (err) {
      console.warn(`fetch ${new URL(request.url).pathname}: ${err.message}`);
      const report = new URL(request.url).pathname === "/v1/report";
      return Response.json({ error: "unavailable" }, { status: 503, headers: { ...(report ? reportCors(request, env).cors : HEADERS), "cache-control": "no-store" } });
    }
  },
};

// The CORS headers for /v1/report, and whether the request's origin is allowed: the site itself (or REPORT_ORIGINS when
// testing).
function reportCors(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = (env.REPORT_ORIGINS ? env.REPORT_ORIGINS.split(",") : ORIGINS).includes(origin);
  const cors = { "access-control-allow-origin": allowed ? origin : ORIGINS[0], "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type", vary: "origin", "x-content-type-options": "nosniff", "cache-control": "no-store", ...INERT };
  return { allowed, cors };
}

async function handle(request, env, ctx) {
  const { pathname } = new URL(request.url);
  // «Meld fra om endring» (report.js).
  if (pathname === "/v1/report") {
    const { allowed, cors } = reportCors(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
    if (!allowed) return Response.json({ error: "origin" }, { status: 403, headers: cors });
    const { status, body } = await handleReport(request, env, store(env), Object.fromEntries(SITES.map((s) => [s.id, s.name ?? s.id])));
    return Response.json(body, { status, headers: cors });
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: HEADERS });
  if (pathname === "/v1/live.json") {
    const res = await handleLive(SITES, Date.now(), globalThis.caches?.default, store(env));
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(HEADERS)) headers.set(k, v);
    return new Response(request.method === "HEAD" ? null : res.body, { status: res.status, headers });
  }
  if (pathname !== "/v1/status.json" && !DATASETS[pathname]) return new Response("Not found", { status: 404, headers: HEADERS });
  const res = await cached(globalThis.caches?.default, request, ctx, () => (pathname === "/v1/status.json" ? status(env) : dataset(env, DATASETS[pathname])));
  return request.method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
}

const JSON_HEADERS = { ...HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${CACHE_SECONDS}` };

// How the sources and datasets are doing (health.js).
async function status(env) {
  const s = store(env);
  const [runs, snapshots, holfuyArchive, metArchive] = await Promise.all([
    s.getState("health"), s.snapshotsFor([...Object.keys(MAX_AGE), frost.DATASET]),
    s.getState(`${holfuy.KEY}-archive`), s.getState(`${frost.KEY}-archive`),
  ]);
  // The stations dataset is served merged from Holfuy's and MET's; the status counts the newer of the two.
  const st = [snapshots[holfuy.DATASET], snapshots[frost.DATASET]].filter(Boolean).sort((a, b) => (a.updated < b.updated ? 1 : -1))[0];
  if (st) snapshots[holfuy.DATASET] = st;
  const body = buildStatus({ runs, snapshots, now: Date.now(),
    expected: { forecast: SITES.map((x) => x.id), windgram: WINDGRAM_SITES.filter((id) => SITES.some((x) => x.id === id)) },
    archive: { [holfuy.KEY]: holfuyArchive?.through ?? null, [frost.KEY]: metArchive?.through ?? null } });
  return Response.json(body, { headers: JSON_HEADERS });
}

// A dataset as stored; the stations are Holfuy's and MET's merged. 503 (not cached) until the first run has stored it.
async function dataset(env, name) {
  const s = store(env);
  const body = name === holfuy.DATASET
    ? mergeStations(...(await Promise.all([s.getSnapshot(holfuy.DATASET), s.getSnapshot(frost.DATASET)])))
    : await s.getSnapshot(name);
  if (!body) return Response.json({ dataset: name, error: "no data yet" }, { status: 503, headers: { ...HEADERS, "cache-control": "no-store" } });
  return new Response(body, { headers: JSON_HEADERS });
}
