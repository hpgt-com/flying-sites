// Tests for the weather service's state (workers/forecast/src/state.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForecast, keepSites, pickSites, MAX_AGE_HOURS } from "../workers/forecast/src/state.js";

const NOW = Date.parse("2026-10-18T15:20:00Z");
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const rows = (start, n = 3) => Array.from({ length: n }, (_, i) => [new Date(Date.parse(start) + i * 3600000).toISOString().replace(".000", ""), 200, 5, 9, 0]);
const sites = ["a", "b", "c", "d"].map((id) => ({ id, lat: 68.8, lon: 16.5, altitude: 500 }));

test("picks the launches missing from the state first, then those fetched longest ago", () => {
  const state = { sites: { a: { fetched: ago(5) }, b: { fetched: ago(25) }, c: { fetched: ago(15) } } };
  assert.deepEqual(pickSites(sites, state, 2).map((s) => s.id), ["d", "b"]);
  assert.deepEqual(pickSites(sites, state, 6).map((s) => s.id), ["d", "b", "c", "a"]);
});

test("a site removed from the site files disappears from the state", () => {
  const state = { sites: { a: { fetched: ago(5) }, gone: { fetched: ago(5) } } };
  assert.deepEqual(Object.keys(keepSites(state, sites).sites), ["a"]);
  assert.deepEqual(keepSites(null, sites), { sites: {} });
});

test("the forecast follows the latest start, places the others by time, and is as old as its oldest launch", () => {
  const state = { sites: {
    a: { fetched: ago(30), updated: "2026-10-18T13:00:00Z", rows: rows("2026-10-18T14:00:00Z") },
    b: { fetched: ago(5), updated: "2026-10-18T14:00:00Z", rows: rows("2026-10-18T15:00:00Z") },
  } };
  const f = buildForecast(state, NOW);
  assert.deepEqual(f.times, ["2026-10-18T15:00:00Z", "2026-10-18T16:00:00Z", "2026-10-18T17:00:00Z"]);
  assert.deepEqual(f.sites.a, [[200, 5, 9, 0], [200, 5, 9, 0], null]);
  assert.equal(f.fetched, ago(30));
  assert.equal(f.updated, "2026-10-18T13:00:00Z");
  assert.equal(f.source, "MET Norge");
});

test("launches older than the limit are left out, and nothing fresh gives null", () => {
  const old = { fetched: ago(MAX_AGE_HOURS * 60 + 1), updated: null, rows: rows("2026-10-18T08:00:00Z") };
  assert.equal(buildForecast({ sites: { a: old } }, NOW), null);
  const f = buildForecast({ sites: { a: old, b: { fetched: ago(5), updated: null, rows: rows("2026-10-18T15:00:00Z") } } }, NOW);
  assert.deepEqual(Object.keys(f.sites), ["b"]);
});
