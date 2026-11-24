// Datatjenesten for flysteder.hpgt.com på Cloudflare Workers (publiseres av .github/workflows/data-worker.yml).
//
// Én modul per kilde i sources/ henter, sjekker og gjør om dataene sine, og lagrer datasettet i lageret (store.js).
// Alle datasett sendes på samme måte, som /v1/<dataset>.json, med samme ramme: dataset, source og fetched (og license
// der kildens vilkår krever det, som METs gjør), så datasettets egne felt. En kilde som feiler, stopper ikke de andre.
//
// - forecast: METs varsel for hvert startsted (sources/forecast.js). Sidene bruker det når det er nyere enn varselet
//   som er bygget inn i siden (fetchNewerForecast i src/assets/js/wind.js).
// - stations: målt vind fra Holfuys stasjoner (sources/holfuy.js, stasjonene i stations.js) og METs stasjoner i
//   området (sources/frost.js), sendt samlet. Hver stasjon har sin egen kilde.
// - windgram: høydevind fra Open-Meteo for startstedene i WINDGRAM_SITES (sources/windgram.js). Stedssiden bruker den
//   når den er nyere enn den som er bygget inn (src/assets/js/windgram.js).
// - verification: hvor godt varselet traff på hvert flysted med egen stasjon (sources/verify.js), på værsiden og
//   stedssiden.
// - flights: hvor mange paraglidere som ses i lufta fra hvert flysted, per måned, fra Open Glider Network
//   (sources/flights.js), på stedssiden (src/assets/js/flights.js).
//
// - grid, grid-wide: Open-Meteos varsel for et rutenett tett rundt stedene hver tredje time, og et grovere over et
//   større område hver sjette (sources/grid.js), for kartlagene «Prognose» (src/assets/js/forecast-layer.js).
//
// - live: luftfartøyene Open Glider Network hører i området nå (live.js), hentet ved behov og bufret noen sekunder,
//   for kartlaget «Piloter i lufta» (src/assets/js/live.js).
// - POST /v1/report: «Meld fra om endring» fra stedssidene, som en sak på GitHub (report.js).
// - POST /v1/csp-report: nettlesernes rapporter om CSP-brudd på sidene, som korte linjer i loggen uten
//   personopplysninger (csp-report.js).
// - status: hvordan det går med kildene og datasettene (health.js), for timesjekken i .github/workflows/health.yml.
//
// sites.json (startstedene) skrives fra stedsfilene før publisering (scripts/data-sites.mjs).

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
import { handleCspReport } from "./csp-report.js";
import { handleLive } from "./live.js";
import { recordRuns, buildStatus, MAX_AGE } from "./health.js";
import { cached, CACHE_SECONDS } from "./cache.js";
import { WINDGRAM_SITES } from "../../../lib/weather/open-meteo.js";
import SITES from "./sites.json";

export { Store } from "./store.js";

const DATASETS = { "/v1/forecast.json": forecast.DATASET, "/v1/stations.json": holfuy.DATASET, "/v1/windgram.json": windgram.DATASET, "/v1/verification.json": verify.DATASET,
  "/v1/flights.json": flights.DATASET, "/v1/flight-log.json": flights.LOG_DATASET, "/v1/grid.json": "grid", "/v1/grid-wide.json": "grid-wide" };

const store = (env) => env.STORE.get(env.STORE.idFromName("main"));

// Åpne data, lest av sidene på flysteder.hpgt.com (og alle andre), så alle opphav kan lese dem. Kort hurtigbuffer:
// dataene endres med få minutters mellomrom. Svarene er data, aldri en side. Åpnet som dokument eller i en ramme kan
// de ikke gjøre noe (content-security-policy), og andre nettsteder kan laste dem (cross-origin-resource-policy).
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
    // Når hver kilde sist kjørte, og om kjøringen feilet. Brukes for kildene som tar igjen et tapt minutt eller prøves
    // på nytt etter en feil (schedule.js CATCH_UP).
    const last = (await s.getState("health")) ?? {};
    const failed = (r) => Boolean(r?.errorAt && (!r.ok || r.errorAt > r.ok));
    const isDue = (name) => due(name, now, last[name]?.tried, failed(last[name]));
    // Hver kjøring tas tiden på, så statusen viser hvor lang tid hver kilde bruker (health.js recordRuns). En kilde
    // som feiler etter tjue sekunder, har gått ut på tid. En som lykkes på åtte, er treg. Endringer over dager blir
    // synlige.
    const runs = {};
    const timed = (name, start) => {
      if (!isDue(name)) return;
      const t0 = Date.now();
      runs[name] = start().then((v) => ({ ms: Date.now() - t0, value: v }), (err) => { throw Object.assign(err instanceof Error ? err : new Error(String(err)), { ms: Date.now() - t0 }); });
    };
    timed("forecast", () => forecast.run(s, SITES, now));
    timed("stations", () => holfuy.run(s, env, HOLFUY_STATIONS, now));
    timed("met", () => frost.run(s, env, SITES, MET_STATION_SITES, now, MET_EXCLUDE));
    timed("windgram", () => windgram.run(s, SITES, now));
    timed("verify", () => verify.run(s, siteLinks(), now));
    timed("flights", () => flights.run(s, SITES, now, INTERVALS.flights));
    timed("grid", () => grid.run(s, "grid", SITES, now));
    timed("gridWide", () => grid.run(s, "grid-wide", SITES, now));
    if (isDue("backup")) {
      const day = new Date(now).toISOString().slice(0, 10);
      timed("backup", () => s.backup(day));
      // Saltene og adressehashene for «Meld fra» fra tidligere dager (report.js): slettes med dagen, ikke først når
      // neste rapport kommer.
      ctx.waitUntil(s.pruneReports(day));
    }
    timed("ognDdb", () => s.refreshNoTrack(now));
    // Et lager uten en vellykket gjenoppretting i helsetilstanden er nytt (eller tapt). Da leses den siste
    // sikkerhetskopien inn igjen, hvert minutt til det lykkes (store.js restore). Et lager som har gjort det én gang,
    // eller som ikke har arkiv, får være i fred.
    if (env.ARCHIVE && !last.restore?.ok) timed("restore", () => s.restore(now));
    ctx.waitUntil(Promise.allSettled(Object.values(runs)).then(async (results) => {
      const outcome = {};
      Object.keys(runs).forEach((name, i) => {
        const failed = results[i].status === "rejected";
        if (failed) console.warn(`${name}: ${results[i].reason?.message}`);
        outcome[name] = { error: failed ? results[i].reason?.message || "feil" : null, ms: failed ? results[i].reason?.ms ?? null : results[i].value.ms };
      });
      // Når hver kilde sist kjørte og sist lyktes, for /v1/status.json.
      if (Object.keys(outcome).length) await s.putState("health", recordRuns(await s.getState("health"), outcome, now));
    }));
  },

  // Uansett hva som går galt (lageret er overbelastet eller tom for dagskvoten, en feil i koden), er svaret fortsatt
  // JSON med CORS-hodene. Da får siden en 503 den kan håndtere, ikke Cloudflares feilside uten hodene (som nettleseren
  // melder som en CORS-feil).
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

// CORS-hodene for /v1/report, og om opphavet til forespørselen er tillatt: nettstedet selv (eller REPORT_ORIGINS under
// testing).
function reportCors(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = (env.REPORT_ORIGINS ? env.REPORT_ORIGINS.split(",") : ORIGINS).includes(origin);
  const cors = { "access-control-allow-origin": allowed ? origin : ORIGINS[0], "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type", vary: "origin", "x-content-type-options": "nosniff", "cache-control": "no-store", ...INERT };
  return { allowed, cors };
}

// Hodene i svarene fra /v1/csp-report. Nettleseren sender rapportene uten CORS (no-cors) og leser ikke svaret, så det
// er ingen CORS-hoder. Bare POST er tillatt.
const CSP_REPORT_HEADERS = { allow: "POST", "x-content-type-options": "nosniff", "cache-control": "no-store", ...INERT };

async function handle(request, env, ctx) {
  const { pathname } = new URL(request.url);
  // Rapporter om CSP-brudd fra sidene (csp-report.js).
  if (pathname === "/v1/csp-report") {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CSP_REPORT_HEADERS });
    return new Response(null, { status: await handleCspReport(request, env), headers: CSP_REPORT_HEADERS });
  }
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

// Hvordan det går med kildene og datasettene (health.js).
async function status(env) {
  const s = store(env);
  const [runs, snapshots, holfuyArchive, metArchive, backup, restore] = await Promise.all([
    s.getState("health"), s.snapshotsFor([...Object.keys(MAX_AGE), frost.DATASET]),
    s.getState(`${holfuy.KEY}-archive`), s.getState(`${frost.KEY}-archive`), s.getState("backup"), s.getState("restore"),
  ]);
  // Stasjonsdatasettet sendes slått sammen fra Holfuys og METs. Statusen regner med det nyeste av de to.
  const st = [snapshots[holfuy.DATASET], snapshots[frost.DATASET]].filter(Boolean).sort((a, b) => (a.updated < b.updated ? 1 : -1))[0];
  if (st) snapshots[holfuy.DATASET] = st;
  const body = buildStatus({ runs, snapshots, now: Date.now(),
    expected: { forecast: SITES.map((x) => x.id), windgram: WINDGRAM_SITES.filter((id) => SITES.some((x) => x.id === id)) },
    archive: { [holfuy.KEY]: holfuyArchive?.through ?? null, [frost.KEY]: metArchive?.through ?? null },
    // Uten arkivet (ingen R2-binding) er det ingen sikkerhetskopi å melde om.
    backup: env.ARCHIVE ? backup ?? null : undefined, restore });
  return Response.json(body, { headers: JSON_HEADERS });
}

// Et datasett slik det er lagret. Stasjonene er Holfuys og METs slått sammen. 503 (uten hurtigbuffer) til den første
// kjøringen har lagret det.
async function dataset(env, name) {
  const s = store(env);
  const body = name === holfuy.DATASET
    ? mergeStations(...(await Promise.all([s.getSnapshot(holfuy.DATASET), s.getSnapshot(frost.DATASET)])))
    : await s.getSnapshot(name);
  if (!body) return Response.json({ dataset: name, error: "no data yet" }, { status: 503, headers: { ...HEADERS, "cache-control": "no-store" } });
  return new Response(body, { headers: JSON_HEADERS });
}
