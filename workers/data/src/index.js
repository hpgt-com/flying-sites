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
//
// - POST /v1/report: «Meld fra om endring» from the site pages, as a GitHub issue (report.js).
//
// sites.json (the launches) is written from the site files before deploy (scripts/data-sites.mjs).

import * as forecast from "./sources/forecast.js";
import * as holfuy from "./sources/holfuy.js";
import * as frost from "./sources/frost.js";
import * as windgram from "./sources/windgram.js";
import * as verify from "./sources/verify.js";
import { HOLFUY_STATIONS, MET_STATION_SITES, MET_EXCLUDE, siteLinks } from "./stations.js";
import { due } from "./schedule.js";
import { mergeStations } from "./merge.js";
import { handleReport, ORIGINS } from "./report.js";
import SITES from "./sites.json";

export { Store } from "./store.js";

const DATASETS = { "/v1/forecast.json": forecast.DATASET, "/v1/stations.json": holfuy.DATASET, "/v1/windgram.json": windgram.DATASET, "/v1/verification.json": verify.DATASET };

const store = (env) => env.STORE.get(env.STORE.idFromName("main"));

// Public data, read by the pages on flysteder.hpgt.com (and anyone else), so any origin may read it. Short cache: the
// data changes every few minutes.
const HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "x-content-type-options": "nosniff",
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
    ctx.waitUntil(Promise.allSettled(Object.values(runs)).then((results) => {
      Object.keys(runs).forEach((name, i) => { if (results[i].status === "rejected") console.warn(`${name}: ${results[i].reason?.message}`); });
    }));
  },

  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    // «Meld fra om endring» (report.js): only from the site itself (or REPORT_ORIGINS when testing).
    if (pathname === "/v1/report") {
      const origin = request.headers.get("origin") || "";
      const allowed = (env.REPORT_ORIGINS ? env.REPORT_ORIGINS.split(",") : ORIGINS).includes(origin);
      const cors = { "access-control-allow-origin": allowed ? origin : ORIGINS[0], "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type", vary: "origin", "x-content-type-options": "nosniff", "cache-control": "no-store" };
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
      if (!allowed) return Response.json({ error: "origin" }, { status: 403, headers: cors });
      const { status, body } = await handleReport(request, env, store(env), Object.fromEntries(SITES.map((s) => [s.id, s.name ?? s.id])));
      return Response.json(body, { status, headers: cors });
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: HEADERS });
    const dataset = DATASETS[pathname];
    if (!dataset) return new Response("Not found", { status: 404, headers: HEADERS });
    const body = dataset === holfuy.DATASET
      ? mergeStations(await store(env).getSnapshot(holfuy.DATASET), await store(env).getSnapshot(frost.DATASET))
      : await store(env).getSnapshot(dataset);
    if (!body) return Response.json({ dataset, error: "no data yet" }, { status: 503, headers: { ...HEADERS, "cache-control": "no-store" } });
    return new Response(request.method === "HEAD" ? null : body, {
      headers: { ...HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=120" },
    });
  },
};
