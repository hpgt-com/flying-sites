// The weather service for flysteder.hpgt.com on Cloudflare Workers (deployed by .github/workflows/forecast-worker.yml).
//
// - Every 5 minutes (Cron Trigger) the launches fetched longest ago are fetched from MET (lib/weather/met.js, the same
//   code as the build), and the forecast is written to KV (FORECAST).
// - GET /forecast.json returns the forecast in the same format as the build's. The pages fetch it after loading and use
//   it when it is newer than the one built into the page, so the wind assessment no longer depends on GitHub running
//   the scheduled build (src/assets/js/common.js, newerForecast).
//
// sites.json (the launches) is written from the site files before deploy (scripts/forecast-sites.mjs).

import { fetchSite } from "../../../lib/weather/met.js";
import { buildForecast, keepSites, pickSites } from "./state.js";
import SITES from "./sites.json";

const STATE_KEY = "state";
const FORECAST_KEY = "forecast.json";

async function refresh(env, now = Date.now()) {
  const state = keepSites(await env.FORECAST.get(STATE_KEY, "json"), SITES);
  // One after another, so MET gets at most one request at a time from us.
  for (const site of pickSites(SITES, state)) {
    try {
      const { rows, updated } = await fetchSite({ lat: site.lat, lon: site.lon }, site.altitude);
      state.sites[site.id] = { fetched: new Date(now).toISOString(), updated, rows };
    } catch (err) {
      console.warn(`MET: ${site.id}: ${err.message}`);
    }
  }
  await env.FORECAST.put(STATE_KEY, JSON.stringify(state));
  const forecast = buildForecast(state, now);
  if (forecast) await env.FORECAST.put(FORECAST_KEY, JSON.stringify(forecast));
}

// Public data, read by the pages on flysteder.hpgt.com (and anyone else), so any origin may read it. Short cache: the
// forecast changes every few minutes.
const HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "x-content-type-options": "nosniff",
};

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(refresh(env));
  },

  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: HEADERS });
    if (pathname !== "/forecast.json") return new Response("Not found", { status: 404, headers: HEADERS });
    const body = await env.FORECAST.get(FORECAST_KEY, { cacheTtl: 60 });
    if (!body) return Response.json({ error: "no forecast yet" }, { status: 503, headers: { ...HEADERS, "cache-control": "no-store" } });
    return new Response(request.method === "HEAD" ? null : body, {
      headers: { ...HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=120" },
    });
  },
};
