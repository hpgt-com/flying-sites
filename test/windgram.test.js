// Tester for høydevinden (lib/windgram.js). Kjøres med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { windAtHeight, gridHeights, buildWindgram, hourlyVariables, LEVELS } from "../lib/windgram.js";

test("vinden mellom to nivåer interpoleres i komponenter, så sør til vest går via sørvest", () => {
  const points = [{ h: 0, speed: 4, dir: 180 }, { h: 1000, speed: 4, dir: 270 }];
  const mid = windAtHeight(points, 500);
  assert.equal(Math.round(mid.dir), 225);
  assert.ok(mid.speed > 2.8 && mid.speed < 2.9); // kortere vektor midt mellom, ikke 4
  assert.deepEqual(windAtHeight(points, 0), { speed: 4, dir: 180 });
  assert.equal(windAtHeight(points, 1200), null);
  assert.equal(windAtHeight(points, -10), null);
});

test("rutenettet har hver 250. meter og starthøyden", () => {
  const h = gridHeights(563);
  assert.equal(h[0], 250);
  assert.equal(h.at(-1), 3000);
  assert.ok(h.includes(563));
  assert.equal(h.indexOf(563), h.indexOf(500) + 1);
  assert.equal(gridHeights(500).filter((x) => x === 500).length, 1);
});

test("svaret fra Open-Meteo blir rutenett med grenselag og skybase i moh", () => {
  const hourly = { time: [1760000000], temperature_2m: [8], dew_point_2m: [4], wind_speed_10m: [3], wind_direction_10m: [90], boundary_layer_height: [700], cape: [12.4] };
  const heights = { 1000: 50, 975: 260, 950: 480, 925: 700, 900: 930, 850: 1400, 800: 1900, 700: 2950 };
  for (const p of LEVELS) {
    hourly[`geopotential_height_${p}hPa`] = [heights[p]];
    hourly[`wind_speed_${p}hPa`] = [p >= 925 ? 4 : 10];
    hourly[`wind_direction_${p}hPa`] = [270];
  }
  const g = buildWindgram({ elevation: 120, hourly }, 563);
  assert.deepEqual(g.times, [1760000000000]);
  assert.equal(g.elevation, 120);
  assert.equal(g.blh[0], 820); // 120 + 700
  assert.equal(g.cloudBase[0], 620); // 120 + (8 − 4) × 125
  assert.equal(g.cape[0], 12);
  // 1000 hPa ligger under terrenget og tas ikke med. 250 moh ligger mellom vinden i 10 m (Ø) og 975 hPa (V).
  const at = (h) => g.cells[0][g.heights.indexOf(h)];
  assert.deepEqual(at(500), [270, 4]);
  assert.deepEqual(at(3000), null);
  assert.ok(at(2000)[1] === 10);
});

test("alle variablene som hentes, finnes for hver trykkflate", () => {
  const vars = hourlyVariables();
  for (const p of LEVELS) assert.ok(vars.includes(`geopotential_height_${p}hPa`));
  assert.ok(vars.includes("boundary_layer_height"));
});
