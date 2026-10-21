// The forecast grids for the map layers «Prognose»: Open-Meteo's forecast for grids of points (GRIDS): «grid», close
// around the flying sites every 0.1 × 0.25 degrees (about 11 × 10 km), and «grid-wide», coarser over a wider area from
// Saltfjellet to Tromsø and Kiruna, so what comes over the mountains from Sweden in a south-easterly is on the map too.
// For the hours of the day in the next days: temperature and dew point, wind at 10 m and at 925 hPa (about 750 m), the boundary layer, CAPE, cloud and rain,
// and the sunshine on the ground. The page works out the rest from these (src/assets/js/forecast-layer.js): the thermal
// strength, the thermal top, the cloud base and Cu, and low cloud.
//
// The close grid every three hours and the wide one every six (schedule.js), at different minutes: Open-Meteo's free
// use allows 600 points a minute and 10 000 a day (a request counts once per point, more with over 10 variables), and
// each grid stays under 600. The answers are large (hundreds of points × the hours × the variables), more than the
// 10 ms of CPU a run of the Worker may use, so the fetching and the building are done in the store's Durable Object
// (Store.refreshGrid), which may use far more. A run that fails keeps the previous dataset. Tested in
// test/data-store.test.js.

// box: a fixed area { s, w, n, e }; otherwise the launches with margin [lat, lon] around them.
export const GRIDS = {
  grid: { dLat: 0.1, dLon: 0.25, margin: [0.35, 0.9] },
  "grid-wide": { dLat: 0.2, dLon: 0.5, box: { s: 66.6, w: 11.5, n: 70.0, e: 21.5 } },
};
export const SOURCE = "Open-Meteo";
export const LICENSE = "CC BY 4.0, Open-Meteo";
export const API = "https://api.open-meteo.com/v1/forecast";
// Points per request (the addresses stay short).
export const PER_REQUEST = 100;
export const FORECAST_DAYS = 3;
// The hours kept, in UTC: 04–20 is 05/06–21/22 in Norway, the hours anyone flies.
export const FIRST_HOUR = 4;
export const LAST_HOUR = 20;
// Open-Meteo's names, and the short keys in the dataset with their decimals. Ten, so a point counts once.
export const VARS = [
  ["temperature_2m", "T", 1], ["dew_point_2m", "Td", 1], ["wind_speed_10m", "ws", 1], ["wind_direction_10m", "wd", 0],
  ["wind_speed_925hPa", "ws9", 1], ["wind_direction_925hPa", "wd9", 0], ["boundary_layer_height", "blh", 0],
  ["cloud_cover_low", "cl", 0], ["precipitation", "pr", 1], ["shortwave_radiation", "sw", 0],
];

// Down or up to a whole step, so the margin is never cut (the small epsilon keeps 68.4 from becoming 68.3).
const floorTo = (v, step) => Math.floor(v / step + 1e-9) * step;
const ceilTo = (v, step) => Math.ceil(v / step - 1e-9) * step;
const round = (v, d) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

// A grid (GRIDS): its box, or the launches with the margin around them, out to whole steps. { dLat, dLon, lat0, lon0,
// rows, cols, points: [[lat, lon], ...] } row by row from the south.
export function gridPoints(spec, sites = []) {
  let box = spec.box;
  if (!box) {
    const ok = sites.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
    const lats = ok.map((s) => s.lat), lons = ok.map((s) => s.lon);
    box = { s: Math.min(...lats) - spec.margin[0], n: Math.max(...lats) + spec.margin[0], w: Math.min(...lons) - spec.margin[1], e: Math.max(...lons) + spec.margin[1] };
  }
  const { dLat, dLon } = spec;
  const lat0 = +floorTo(box.s, dLat).toFixed(2), lat1 = +ceilTo(box.n, dLat).toFixed(2);
  const lon0 = +floorTo(box.w, dLon).toFixed(2), lon1 = +ceilTo(box.e, dLon).toFixed(2);
  const rows = Math.round((lat1 - lat0) / dLat) + 1, cols = Math.round((lon1 - lon0) / dLon) + 1;
  const points = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) points.push([+(lat0 + r * dLat).toFixed(2), +(lon0 + c * dLon).toFixed(2)]);
  return { dLat, dLon, lat0, lon0, rows, cols, points };
}

// The request for some points: all the variables, hourly, in m/s and Unix time.
export function gridUrl(points) {
  const u = new URL(API);
  u.searchParams.set("latitude", points.map((p) => p[0]).join(","));
  u.searchParams.set("longitude", points.map((p) => p[1]).join(","));
  u.searchParams.set("hourly", VARS.map((v) => v[0]).join(","));
  u.searchParams.set("wind_speed_unit", "ms");
  u.searchParams.set("timeformat", "unixtime");
  u.searchParams.set("forecast_days", String(FORECAST_DAYS));
  return u.toString();
}

// The dataset from Open-Meteo's answers, one per point in the grid's order (an answer for several points is a list):
// the hours from the one going on, within FIRST_HOUR–LAST_HOUR UTC; for each variable one list per point; the model's
// height of each point (0 at sea). Throws when an answer is missing or has other hours than the first.
export function buildGrid(name, grid, answers, now = Date.now()) {
  if (answers.length !== grid.points.length) throw new Error(`Open-Meteo: ${answers.length} svar for ${grid.points.length} punkter`);
  const all = answers[0]?.hourly?.time;
  if (!Array.isArray(all) || !all.length) throw new Error("Open-Meteo: tomt svar");
  const keep = all.map((t, i) => [t, i]).filter(([t]) => t * 1000 > now - 3600000 && new Date(t * 1000).getUTCHours() >= FIRST_HOUR && new Date(t * 1000).getUTCHours() <= LAST_HOUR);
  const values = {};
  for (const [name, key, dec] of VARS) {
    values[key] = answers.map((a) => {
      if (a?.hourly?.time?.[0] !== all[0]) throw new Error("Open-Meteo: punktene har ulike timer");
      const list = a.hourly[name] ?? [];
      return keep.map(([, i]) => round(list[i], dec));
    });
  }
  return {
    dataset: name, source: SOURCE, license: LICENSE, fetched: new Date(now).toISOString(),
    lat0: grid.lat0, lon0: grid.lon0, dLat: grid.dLat, dLon: grid.dLon, rows: grid.rows, cols: grid.cols,
    times: keep.map(([t]) => t), elev: answers.map((a) => Math.max(0, Math.round(a.elevation ?? 0))), values,
  };
}

// Fetches a grid from Open-Meteo, PER_REQUEST points at a time, and builds its dataset. Run in the Durable Object.
export async function fetchGrid(name, sites, now = Date.now(), fetchFn = fetch) {
  const grid = gridPoints(GRIDS[name], sites);
  const answers = [];
  for (let i = 0; i < grid.points.length; i += PER_REQUEST) {
    const part = grid.points.slice(i, i + PER_REQUEST);
    const r = await fetchFn(gridUrl(part), { headers: { "user-agent": "hpgt-flysteder/1.0 (https://flysteder.hpgt.com)" }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`Open-Meteo svarte ${r.status}`);
    const body = await r.json();
    answers.push(...(Array.isArray(body) ? body : [body]));
  }
  return buildGrid(name, grid, answers, now);
}

// One run, from the Worker: the store fetches and stores the grid (Store.refreshGrid).
export async function run(store, name, sites, now = Date.now()) {
  await store.refreshGrid(name, sites.map((s) => ({ lat: s.lat, lon: s.lon })), now);
}
