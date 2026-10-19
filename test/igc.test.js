// Tests for the flight logs (lib/igc.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIgc, parseKml, analyzeFlight, launchPoints, aggregate, flightKey, sector } from "../lib/igc.js";

// An IGC B record: time (s), position and height.
function b(t, lat, lon, alt) {
  const hh = String(Math.floor(t / 3600) % 24).padStart(2, "0"), mm = String(Math.floor(t / 60) % 60).padStart(2, "0"), ss = String(t % 60).padStart(2, "0");
  const la = Math.abs(lat), lo = Math.abs(lon);
  const dla = String(Math.floor(la)).padStart(2, "0") + String(Math.round((la % 1) * 60000)).padStart(5, "0") + (lat < 0 ? "S" : "N");
  const dlo = String(Math.floor(lo)).padStart(3, "0") + String(Math.round((lo % 1) * 60000)).padStart(5, "0") + (lon < 0 ? "W" : "E");
  const a = String(Math.round(alt)).padStart(5, "0");
  return `B${hh}${mm}${ss}${dla}${dlo}A${a}${a}`;
}
// Standing at the launch for a minute, then flying west at 10 m/s for 10 minutes, climbing 2 m/s in minutes 3–5, and
// standing at the landing.
function flightIgc(lat = 68.80389, lon = 16.36667, t0 = 12 * 3600) {
  const lines = ["AXXX", "HFDTEDATE:150726,01", "HFPLTPILOTINCHARGE:Ola Nordmann"];
  let alt = 563, x = lon;
  for (let s = 0; s < 60; s += 2) lines.push(b(t0 + s, lat, lon, alt));
  const dLon = 10 / (111320 * Math.cos(lat * Math.PI / 180));
  for (let s = 60; s <= 660; s += 2) {
    x -= dLon * 2;
    alt += s >= 240 && s < 360 ? 4 : -2;
    lines.push(b(t0 + s, lat, x, alt));
  }
  for (let s = 662; s < 720; s += 2) lines.push(b(t0 + s, lat, x, alt));
  return lines.join("\r\n");
}
const sites = [{ id: "sollifjellet", launch: { lat: 68.80389, lon: 16.36667 }, launches: [{ lat: 68.80604, lon: 16.37694 }, { text: "no position" }] }, { id: "heia", launch: { lat: 68.76, lon: 16.51 } }];

test("an IGC file: the date, the points in order, past midnight carries on", () => {
  const log = parseIgc(flightIgc());
  assert.equal(log.date, "2026-07-15");
  assert.equal(log.points.length, 30 + 301 + 29);
  assert.ok(Math.abs(log.points[0].lat - 68.80389) < 1e-4 && Math.abs(log.points[0].lon - 16.36667) < 1e-4);
  const night = parseIgc(["HFDTE010826", b(86398, 68.8, 16.4, 600), b(2, 68.8, 16.4, 600)].join("\n"));
  assert.deepEqual(night.points.map((p) => p.t), [86398, 86402]);
});

test("the flight: takeoff from the nearest launch, the direction just after it, time, height, distance and climbing", () => {
  const f = analyzeFlight(parseIgc(flightIgc()), launchPoints(sites));
  assert.equal(f.site, "sollifjellet");
  assert.equal(f.direction, "W");
  assert.ok(f.minutes >= 9 && f.minutes <= 11, String(f.minutes));
  assert.equal(f.maxAlt, 623, "sinks first, then climbs 240 m");
  assert.ok(f.maxDistKm > 5.5 && f.maxDistKm < 6.5, String(f.maxDistKm));
  assert.ok(f.cells.length >= 1, "climbed somewhere");
  assert.equal(f.date, "2026-07-15");
  assert.equal(analyzeFlight(parseIgc(flightIgc(69.5, 18.0)), launchPoints(sites)).site, null, "far from every site: no site");
  assert.equal(analyzeFlight({ date: "2026-07-15", points: Array.from({ length: 50 }, (_, i) => ({ t: i * 2, lat: 68.8, lon: 16.4, alt: 500 })) }, []), null, "standing still is no flight");
});

test("a KML with gx:Track gives the same flight; the same flight in two files has the same key", () => {
  const log = parseIgc(flightIgc());
  const when = log.points.map((p) => `<when>${new Date(Date.UTC(2026, 6, 15) + p.t * 1000).toISOString()}</when>`).join("");
  const coords = log.points.map((p) => `<gx:coord>${p.lon} ${p.lat} ${p.alt}</gx:coord>`).join("");
  const kml = parseKml(`<kml><gx:Track>${when}${coords}</gx:Track></kml>`);
  const a = analyzeFlight(log, launchPoints(sites)), k = analyzeFlight(kml, launchPoints(sites));
  assert.equal(k.site, "sollifjellet");
  assert.equal(flightKey(a), flightKey(k));
  assert.deepEqual(parseKml("<kml><LineString><coordinates>16.4,68.8,500</coordinates></LineString></kml>").points, [], "no times, no flight");
});

test("the sums per site: months, directions, records, and thermal cells from several flights only", () => {
  const base = { site: "sollifjellet", takeoff: 0, cells: ["1:2"] };
  const sum = aggregate([
    { ...base, date: "2020-06-01", direction: "W", minutes: 30, maxAlt: 1200, maxDistKm: 3, cells: ["1:2", "5:5"] },
    { ...base, date: "2024-07-10", direction: "W", minutes: 95, maxAlt: 900, maxDistKm: 12.5 },
    { ...base, date: "2023-06-20", direction: "NW", minutes: 10, maxAlt: null, maxDistKm: 1 },
    { ...base, site: null, date: "2025-08-01", direction: "S", minutes: 5, maxAlt: 600, maxDistKm: 1, cells: [] },
  ]);
  assert.equal(sum.flights, 4);
  assert.equal(sum.unattributed, 1);
  assert.deepEqual([sum.first, sum.last], ["2020-06-01", "2025-08-01"]);
  const s = sum.sites.sollifjellet;
  assert.deepEqual([s.flights, s.minutes, s.first, s.last], [3, 135, "2020-06-01", "2024-07-10"]);
  assert.deepEqual(s.months, { "06": 2, "07": 1 });
  assert.deepEqual(s.directions, { W: 2, NW: 1 });
  assert.deepEqual(s.longest, { value: 95, date: "2024-07-10" });
  assert.deepEqual(s.highest, { value: 1200, date: "2020-06-01" });
  assert.deepEqual(s.farthest, { value: 12.5, date: "2024-07-10" });
  assert.deepEqual(sum.thermals, [[0.0075, 0.025, 3]], "the cell climbed in by three flights; the one-off is left out");
  assert.equal(sector(359), "N");
});
