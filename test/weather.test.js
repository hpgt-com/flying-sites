// Tests for the weather module (lib/weather/). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { metRows, metUpdated, mergeSites } from "../lib/weather/met.js";
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
