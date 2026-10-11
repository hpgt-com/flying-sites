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
