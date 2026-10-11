// Winds aloft (windgram) for a launch: hourly wind at heights above the launch, with the boundary layer (roughly
// how high thermals go) and an estimated cloud base. The data comes from Open-Meteo (src/_data/windgram.js), which
// gives wind, temperature and height on pressure levels (1000, 925, 850 hPa …). Here the response is converted to a
// fixed grid of heights (masl), so the page only has to draw it.

// The pressure levels fetched, from the ground up to about 3000 masl.
export const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700];
// Grid heights: every 250 m up to 3000 masl. The launch elevation is added as its own row.
export const STEP_M = 250;
export const TOP_M = 3000;

export function hourlyVariables() {
  const vars = ["temperature_2m", "dew_point_2m", "wind_speed_10m", "wind_direction_10m", "boundary_layer_height", "cape"];
  for (const p of LEVELS) vars.push(`wind_speed_${p}hPa`, `wind_direction_${p}hPa`, `geopotential_height_${p}hPa`);
  return vars;
}

const rad = Math.PI / 180;
const toUV = (speed, dir) => [-speed * Math.sin(dir * rad), -speed * Math.cos(dir * rad)];
const fromUV = (u, v) => ({ speed: Math.hypot(u, v), dir: (Math.atan2(-u, -v) / rad + 360) % 360 });
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

// Wind at a height (masl) for one hour. Between two levels the wind components are interpolated linearly in height,
// so wind veering from south to west passes through southwest, not east. Below the lowest pressure level the
// 10 m wind is used. Below ground, or above the top level, there is no value.
export function windAtHeight(points, height) {
  const below = points.filter((pt) => pt.h <= height).at(-1);
  const above = points.find((pt) => pt.h >= height);
  if (!below || !above) return null;
  if (below === above || above.h === below.h) return { speed: below.speed, dir: below.dir };
  const f = (height - below.h) / (above.h - below.h);
  const [u1, v1] = toUV(below.speed, below.dir);
  const [u2, v2] = toUV(above.speed, above.dir);
  return fromUV(u1 + f * (u2 - u1), v1 + f * (v2 - v1));
}

// Grid heights for a launch: 250, 500 … 3000 masl plus the launch elevation, lowest to highest.
export function gridHeights(launchMasl) {
  const heights = [];
  for (let h = STEP_M; h <= TOP_M; h += STEP_M) heights.push(h);
  if (Number.isFinite(launchMasl) && !heights.includes(Math.round(launchMasl))) heights.push(Math.round(launchMasl));
  return heights.sort((a, b) => a - b);
}

// The Open-Meteo response (timeformat=unixtime, wind_speed_unit=ms) converted to the grid:
// { times: [ms], heights: [masl], launch, elevation, cells: [time][height] = [direction, m/s] or null,
//   blh: [masl], cloudBase: [masl], cape: [J/kg] }. Boundary layer and cloud base are converted to metres above sea level.
// The cloud base is estimated from surface temperature and dew point: about 125 m per degree of spread.
export function buildWindgram(json, launchMasl) {
  const hourly = json?.hourly;
  if (!hourly?.time?.length) return null;
  const elevation = num(json.elevation) ?? 0;
  const heights = gridHeights(launchMasl);
  const ground = Number.isFinite(launchMasl) ? Math.min(elevation, Math.round(launchMasl)) : elevation;
  const times = hourly.time.map((s) => s * 1000);
  const cells = [], blh = [], cloudBase = [], cape = [];
  times.forEach((_, i) => {
    const points = [];
    // The 10 m wind applies from the terrain, or from the launch when the launch is lower than the terrain
    // Open-Meteo reports for the point, so the launch row always has a value.
    const s10 = num(hourly.wind_speed_10m?.[i]), d10 = num(hourly.wind_direction_10m?.[i]);
    if (s10 != null && d10 != null) points.push({ h: ground, speed: s10, dir: d10 });
    for (const p of LEVELS) {
      const h = num(hourly[`geopotential_height_${p}hPa`]?.[i]);
      const speed = num(hourly[`wind_speed_${p}hPa`]?.[i]), dir = num(hourly[`wind_direction_${p}hPa`]?.[i]);
      // Pressure levels below the terrain (1000 hPa is often below ground on a mountain) are skipped.
      if (h != null && speed != null && dir != null && h > elevation + 10) points.push({ h, speed, dir });
    }
    points.sort((a, b) => a.h - b.h);
    cells.push(heights.map((height) => {
      const w = height >= ground ? windAtHeight(points, height) : null;
      return w ? [Math.round(w.dir), Math.round(w.speed * 10) / 10] : null;
    }));
    const b = num(hourly.boundary_layer_height?.[i]);
    blh.push(b == null ? null : Math.round(elevation + b));
    const t = num(hourly.temperature_2m?.[i]), td = num(hourly.dew_point_2m?.[i]);
    cloudBase.push(t == null || td == null ? null : Math.round(elevation + Math.max(0, t - td) * 125));
    const c = num(hourly.cape?.[i]);
    cape.push(c == null ? null : Math.round(c));
  });
  return { times, heights, launch: Number.isFinite(launchMasl) ? Math.round(launchMasl) : null, elevation: Math.round(elevation), cells, blh, cloudBase, cape };
}
