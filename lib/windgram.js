// Høydevind (windgram) for en start: vind time for time i høyder over start, med grenselaget (omtrent hvor høyt
// termikken går) og en anslått skybase, og per time regnet, skydekket i tre lag, sola og vindkastene nær bakken,
// for radene under rutenettet. Dataene kommer fra Open-Meteo (src/_data/windgram.js), som gir vind, temperatur og
// høyde på trykkflater (1000, 925, 850 hPa …). Her gjøres svaret om til et fast rutenett av høyder (moh.), så siden
// bare trenger å tegne det.

// Trykkflatene som hentes, fra bakken opp til omtrent 3000 moh.
export const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700];
// Høydene i rutenettet: hver 250. m opp til 3000 moh. Høyden på start legges til som en egen rad.
export const STEP_M = 250;
export const TOP_M = 3000;

export function hourlyVariables() {
  const vars = ["temperature_2m", "dew_point_2m", "wind_speed_10m", "wind_direction_10m", "boundary_layer_height",
    "precipitation", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "shortwave_radiation", "wind_gusts_10m"];
  for (const p of LEVELS) vars.push(`wind_speed_${p}hPa`, `wind_direction_${p}hPa`, `geopotential_height_${p}hPa`);
  return vars;
}

const rad = Math.PI / 180;
const toUV = (speed, dir) => [-speed * Math.sin(dir * rad), -speed * Math.cos(dir * rad)];
const fromUV = (u, v) => ({ speed: Math.hypot(u, v), dir: (Math.atan2(-u, -v) / rad + 360) % 360 });
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

// Vind i en høyde (moh.) for én time. Mellom to flater interpoleres vindkomponentene lineært i høyden, så vind som
// dreier fra sør til vest, går via sørvest, ikke øst. Under den laveste trykkflaten brukes vinden i 10 m.
// Under bakken, eller over øverste flate, er det ingen verdi.
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

// Høydene i rutenettet for en start: 250, 500 … 3000 moh. pluss høyden på start, fra lavest til høyest.
export function gridHeights(launchMasl) {
  const heights = [];
  for (let h = STEP_M; h <= TOP_M; h += STEP_M) heights.push(h);
  if (Number.isFinite(launchMasl) && !heights.includes(Math.round(launchMasl))) heights.push(Math.round(launchMasl));
  return heights.sort((a, b) => a - b);
}

// Svaret fra Open-Meteo (timeformat=unixtime, wind_speed_unit=ms) gjort om til rutenettet:
// { times: [ms], heights: [masl], launch, elevation, cells: [time][height] = [direction, m/s] eller null,
//   blh: [masl], cloudBase: [masl], rain: [mm], clouds: [[low, mid, high] %], sun: [W/m²], gust: [m/s] }.
// Grenselaget og skybasen gjøres om til meter over havet.
// Skybasen anslås fra temperatur og duggpunkt ved bakken: omtrent 125 m per grad forskjell.
export function buildWindgram(json, launchMasl) {
  const hourly = json?.hourly;
  if (!hourly?.time?.length) return null;
  const elevation = num(json.elevation) ?? 0;
  const heights = gridHeights(launchMasl);
  const ground = Number.isFinite(launchMasl) ? Math.min(elevation, Math.round(launchMasl)) : elevation;
  const times = hourly.time.map((s) => s * 1000);
  const cells = [], blh = [], cloudBase = [], rain = [], clouds = [], sun = [], gust = [];
  times.forEach((_, i) => {
    const points = [];
    // Vinden i 10 m gjelder fra terrenget, eller fra start når start ligger lavere enn terrenget Open-Meteo
    // oppgir for punktet, så raden for start alltid har en verdi.
    const s10 = num(hourly.wind_speed_10m?.[i]), d10 = num(hourly.wind_direction_10m?.[i]);
    if (s10 != null && d10 != null) points.push({ h: ground, speed: s10, dir: d10 });
    for (const p of LEVELS) {
      const h = num(hourly[`geopotential_height_${p}hPa`]?.[i]);
      const speed = num(hourly[`wind_speed_${p}hPa`]?.[i]), dir = num(hourly[`wind_direction_${p}hPa`]?.[i]);
      // Trykkflater under terrenget (1000 hPa er ofte under bakken på et fjell) hoppes over.
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
    const mm = num(hourly.precipitation?.[i]);
    rain.push(mm == null ? null : Math.round(mm * 10) / 10);
    const layer = (key) => { const v = num(hourly[key]?.[i]); return v == null ? null : Math.round(v); };
    clouds.push([layer("cloud_cover_low"), layer("cloud_cover_mid"), layer("cloud_cover_high")]);
    const sw = num(hourly.shortwave_radiation?.[i]);
    sun.push(sw == null ? null : Math.round(sw));
    const g = num(hourly.wind_gusts_10m?.[i]);
    gust.push(g == null ? null : Math.round(g * 10) / 10);
  });
  return { times, heights, launch: Number.isFinite(launchMasl) ? Math.round(launchMasl) : null, elevation: Math.round(elevation), cells, blh, cloudBase, rain, clouds, sun, gust };
}
