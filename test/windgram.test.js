// Tests for winds aloft (lib/windgram.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { windAtHeight, gridHeights, buildWindgram, hourlyVariables, LEVELS } from "../lib/windgram.js";

test("wind between two levels is interpolated by components, so south to west goes via southwest", () => {
  const points = [{ h: 0, speed: 4, dir: 180 }, { h: 1000, speed: 4, dir: 270 }];
  const mid = windAtHeight(points, 500);
  assert.equal(Math.round(mid.dir), 225);
  assert.ok(mid.speed > 2.8 && mid.speed < 2.9); // shorter vector halfway between, not 4
  assert.deepEqual(windAtHeight(points, 0), { speed: 4, dir: 180 });
  assert.equal(windAtHeight(points, 1200), null);
  assert.equal(windAtHeight(points, -10), null);
});

test("the grid has every 250 m and the launch altitude", () => {
  const h = gridHeights(563);
  assert.equal(h[0], 250);
  assert.equal(h.at(-1), 3000);
  assert.ok(h.includes(563));
  assert.equal(h.indexOf(563), h.indexOf(500) + 1);
  assert.equal(gridHeights(500).filter((x) => x === 500).length, 1);
});

test("the Open-Meteo response becomes a grid with boundary layer and cloud base in m a.s.l.", () => {
  const hourly = { time: [1760000000], temperature_2m: [8], dew_point_2m: [4], wind_speed_10m: [3], wind_direction_10m: [90], boundary_layer_height: [700] };
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
  // 1000 hPa is below the terrain and is left out. 250 m a.s.l. is between the 10 m wind (E) and 975 hPa (W).
  const at = (h) => g.cells[0][g.heights.indexOf(h)];
  assert.deepEqual(at(500), [270, 4]);
  assert.deepEqual(at(3000), null);
  assert.ok(at(2000)[1] === 10);
});

test("every fetched variable exists for each pressure level", () => {
  const vars = hourlyVariables();
  for (const p of LEVELS) assert.ok(vars.includes(`geopotential_height_${p}hPa`));
  assert.ok(vars.includes("boundary_layer_height"));
});

test("the launch row has wind even when the terrain at the point is slightly above launch", () => {
  const hourly = { time: [1760000000], wind_speed_10m: [3], wind_direction_10m: [90] };
  for (const p of LEVELS) {
    hourly[`geopotential_height_${p}hPa`] = [{ 1000: 50, 975: 260, 950: 480, 925: 700, 900: 930, 850: 1400, 800: 1900, 700: 2950 }[p]];
    hourly[`wind_speed_${p}hPa`] = [6];
    hourly[`wind_direction_${p}hPa`] = [270];
  }
  const g = buildWindgram({ elevation: 561, hourly }, 563);
  // 2 m above the terrain: almost only the surface wind (E 3 m/s), pulled slightly towards the wind higher up.
  const [dir, speed] = g.cells[0][g.heights.indexOf(563)];
  assert.ok(Math.abs(dir - 90) < 5 && Math.abs(speed - 3) < 0.3, `${dir}/${speed}`);
  assert.equal(g.cells[0][g.heights.indexOf(500)], null);
});

test("rain, cloud cover in three layers, sun and gusts per hour for the rows under the grid", () => {
  const hourly = { time: [1760000000, 1760003600], precipitation: [0.04, 1.26], cloud_cover_low: [80, 10], cloud_cover_mid: [20, null], cloud_cover_high: [0, 5],
    shortwave_radiation: [123.4, 0], wind_gusts_10m: [7.06, 12.34] };
  const g = buildWindgram({ elevation: 120, hourly }, 563);
  assert.deepEqual(g.rain, [0, 1.3]);
  assert.deepEqual(g.clouds, [[80, 20, 0], [10, null, 5]]);
  assert.deepEqual(g.sun, [123, 0]);
  assert.deepEqual(g.gust, [7.1, 12.3]);
  for (const v of ["precipitation", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "shortwave_radiation", "wind_gusts_10m"]) assert.ok(hourlyVariables().includes(v), v);
});

test("the page: the thermals a pilot can use stop at the cloud base, and the gusts are marked by the site's rules", async () => {
  await import("../src/assets/js/windgram.js");
  const WG = globalThis.FlyingSitesWindgram;
  assert.deepEqual(WG.usableThermal(1361, 836, 563), { top: 836, over: 250, capped: true }, "the clouds are the ceiling");
  assert.deepEqual(WG.usableThermal(1361, 1500, 563), { top: 1361, over: 800, capped: false });
  assert.deepEqual(WG.usableThermal(1361, null, 563), { top: 1361, over: 800, capped: false });
  assert.equal(WG.usableThermal(null, 800, 563), null);
  const rules = { minWind: 2, maxWind: 7, maxGust: 10 };
  assert.deepEqual([6, 8, 11].map((g) => WG.gustClass(g, rules)), ["calm", "maybe", "high"]);
  assert.deepEqual([1, 4, 6, 9, 12].map((s) => WG.speedClass(s, rules)), ["calm", "ok", "maybe", "high", "storm"]);
});
