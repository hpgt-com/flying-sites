// Tests for the weather module (lib/weather/). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { metRows, metExtras, metUpdated, mergeSites, fetchSite } from "../lib/weather/met.js";
import { loadWeather, readWeather, writeWeather } from "../lib/weather/index.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "weather-"));
const hour = (time, dir, speed, gust, rain) => ({
  time,
  data: { instant: { details: { wind_from_direction: dir, wind_speed: speed, wind_speed_of_gust: gust } }, ...(rain == null ? {} : { next_1_hours: { details: { precipitation_amount: rain } } }) },
});

test("the MET response becomes one row per hour with direction, wind, gust and rain", () => {
  const rows = metRows({ properties: { timeseries: [hour("2026-10-17T10:00:00Z", 271.6, 4.2, 7.1, 0.3), hour("2026-10-17T11:00:00Z", 90, 2, undefined, null)] } });
  assert.deepEqual(rows, [["2026-10-17T10:00:00Z", 272, 4.2, 7.1, 0.3], ["2026-10-17T11:00:00Z", 90, 2, null, null]]);
});

test("the temperature and the sea-level pressure per hour, apart from the rows", () => {
  const withExtras = (time, temp, pressure) => ({ time, data: { instant: { details: { wind_from_direction: 180, wind_speed: 3, air_temperature: temp, air_pressure_at_sea_level: pressure } } } });
  const series = [withExtras("2026-10-17T10:00:00Z", 6.4, 1006.5), withExtras("2026-10-17T11:00:00Z", undefined, 1006.1)];
  assert.deepEqual(metExtras({ properties: { timeseries: series } }), [["2026-10-17T10:00:00Z", 6.4, 1006.5], ["2026-10-17T11:00:00Z", null, 1006.1]]);
  assert.equal(metExtras({ properties: { timeseries: series } }, 1).length, 1, "only the first hours");
  assert.deepEqual(metRows({ properties: { timeseries: series } })[0].length, 5, "the rows every page fetches are unchanged");
});

test("the hours as long as MET gives them, then the 6-hour steps without gust and with the rain per hour, up to five days", () => {
  const t0 = Date.parse("2026-10-17T10:00:00Z");
  const at = (h) => new Date(t0 + h * 3600000).toISOString().replace(".000", "");
  const six = (time, rain) => ({ time, data: { instant: { details: { wind_from_direction: 200, wind_speed: 5 } }, next_6_hours: { details: { precipitation_amount: rain } } } });
  const series = [...Array.from({ length: 57 }, (_, h) => hour(at(h), 180, 3, 6, 0)), ...Array.from({ length: 30 }, (_, k) => six(at(56 + 6 * (k + 1)), 1.2))];
  const rows = metRows({ properties: { timeseries: series } });
  assert.equal(rows.at(-1)[0], at(116), "five days from the first hour, not further");
  assert.equal(rows.length, 57 + 10);
  assert.deepEqual(rows[57], [at(62), 200, 5, null, 0.2], "no gust in the 6-hour steps; 1.2 mm over 6 hours is 0.2 mm an hour");
  assert.equal(metRows({ properties: { timeseries: series } }, 2).length, 48);
});

test("sites that start an hour later are placed at their own times", () => {
  const forecast = mergeSites({
    a: [["10:00", 180, 3, 5, 0], ["11:00", 190, 4, 6, 0]],
    b: [["11:00", 200, 5, 7, 0.1]],
  }, new Date("2026-10-17T10:05:00Z"));
  assert.deepEqual(forecast.times, ["10:00", "11:00"]);
  assert.deepEqual(forecast.sites.b, [null, [200, 5, 7, 0.1]]);
  assert.equal(forecast.fetched, "2026-10-17T10:05:00.000Z");
  assert.equal(mergeSites({}), null);
});

test("MET's update time is kept, the oldest across the sites", () => {
  assert.equal(metUpdated({ properties: { meta: { updated_at: "2026-10-17T08:12:31Z" } } }), "2026-10-17T08:12:31Z");
  assert.equal(metUpdated({ properties: {} }), null);
  const rows = [["10:00", 180, 3, 5, 0]];
  const forecast = mergeSites({ a: rows, b: rows, c: rows }, new Date(), { a: "2026-10-17T08:12:31Z", b: "2026-10-17T07:40:02Z", c: null });
  assert.equal(forecast.updated, "2026-10-17T07:40:02Z");
  assert.equal(mergeSites({ a: rows }).updated, null);
});

test("with WEATHER_FETCH=0 the build only reads the file, and never fetches", async () => {
  const dir = tmp();
  const fetch = () => assert.fail("should not fetch");
  assert.equal(await loadWeather("forecast", { env: { WEATHER_FETCH: "0" }, dir, fetch }), null);
  writeWeather("forecast", { fetched: "2020-01-01T00:00:00Z", sites: {} }, dir);
  assert.deepEqual(await loadWeather("forecast", { env: { WEATHER_FETCH: "0" }, dir, fetch }), { fetched: "2020-01-01T00:00:00Z", sites: {} });
});

test("locally a missing or old file is fetched again, a fresh one is reused", async () => {
  const dir = tmp();
  let calls = 0;
  const fetch = async () => { calls++; return "fresh"; };
  const now = Date.parse("2026-10-17T10:00:00Z");
  assert.equal(await loadWeather("forecast", { env: {}, dir, now, fetch }), "fresh");
  writeWeather("forecast", { fetched: "2026-10-17T09:45:00Z" }, dir);
  assert.deepEqual(await loadWeather("forecast", { env: {}, dir, now, fetch }), { fetched: "2026-10-17T09:45:00Z" });
  writeWeather("forecast", { fetched: "2026-10-17T09:00:00Z" }, dir);
  assert.equal(await loadWeather("forecast", { env: {}, dir, now, fetch }), "fresh");
  assert.equal(calls, 2);
});

test("FORECAST_OFFLINE gives no weather, and a null file is read as null", async () => {
  const dir = tmp();
  assert.equal(await loadWeather("windgram", { env: { FORECAST_OFFLINE: "1" }, dir }), null);
  writeWeather("windgram", null, dir);
  assert.equal(readWeather("windgram", dir), null);
  assert.equal(readWeather("missing", dir), undefined);
});

test("MET: not asked again before Expires, If-Modified-Since sent after, and a 304 keeps the rows", async () => {
  const launch = { lat: 68.8, lon: 16.5 };
  const now = Date.parse("2026-10-18T15:00:00Z");
  const body = { properties: { meta: { updated_at: "2026-10-18T14:00:00Z" }, timeseries: [hour("2026-10-18T15:00:00Z", 200, 5, 9, 0)] } };
  const calls = [];
  const ok = async (url, init) => { calls.push(init.headers); return new Response(JSON.stringify(body), { headers: { expires: "Sun, 18 Oct 2026 15:30:00 GMT", "last-modified": "Sun, 18 Oct 2026 14:05:00 GMT" } }); };
  const r = await fetchSite(launch, 500, { now, fetchFn: ok });
  assert.equal(r.rows.length, 1);
  assert.equal(r.updated, "2026-10-18T14:00:00Z");
  assert.equal(r.expires, "2026-10-18T15:30:00.000Z");
  assert.equal(r.lastModified, "2026-10-18T14:05:00.000Z");
  assert.equal(calls[0]["if-modified-since"], undefined, "nothing to send the first time");
  assert.match(calls[0]["user-agent"], /hpgt-flysteder/);
  const skipped = await fetchSite(launch, 500, { now: now + 10 * 60000, expires: r.expires, lastModified: r.lastModified, fetchFn: ok });
  assert.deepEqual(skipped, { notModified: true, expires: r.expires, lastModified: r.lastModified });
  assert.equal(calls.length, 1, "no request before Expires");
  const unchanged = async (url, init) => { calls.push(init.headers); return new Response(null, { status: 304, headers: { expires: "Sun, 18 Oct 2026 16:30:00 GMT" } }); };
  const nm = await fetchSite(launch, 500, { now: now + 40 * 60000, expires: r.expires, lastModified: r.lastModified, fetchFn: unchanged });
  assert.equal(calls[1]["if-modified-since"], "Sun, 18 Oct 2026 14:05:00 GMT");
  assert.deepEqual(nm, { notModified: true, expires: "2026-10-18T16:30:00.000Z", lastModified: r.lastModified });
  const noHeaders = await fetchSite(launch, 500, { now, fetchFn: async () => new Response(JSON.stringify(body)) });
  assert.deepEqual([noHeaders.expires, noHeaders.lastModified], [null, null], "without the headers, nothing is kept");
  await assert.rejects(() => fetchSite(launch, 500, { now, fetchFn: async () => new Response(null, { status: 304 }) }), /MET svarte 304/, "a 304 without If-Modified-Since sent is an error");
});
