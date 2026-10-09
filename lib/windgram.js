// Høydevind (windgram) for en start: vind i høydene over starten time for time, med grenselaget (omtrent hvor
// høyt termikken går) og et anslag på skybasen. Dataene kommer fra Open-Meteo (src/_data/windgram.js), som gir
// vind, temperatur og høyde i trykkflater (1000, 925, 850 hPa …). Her gjøres svaret om til et fast rutenett
// av høyder (moh), så siden bare trenger å tegne det.

// Trykkflatene som hentes, fra bakken og opp til omtrent 3000 moh.
export const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700];
// Høydene i rutenettet: hver 250. meter opp til 3000 moh. Starthøyden legges til som egen rad.
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

// Vind i en høyde (moh) for én time. Mellom to nivåer interpoleres vindkomponentene lineært i høyde, så en
// vind som dreier fra sør til vest går via sørvest og ikke via øst. Under laveste trykkflate brukes vinden i
// 10 m over bakken. Under bakken, eller over øverste nivå, er det ingen verdi.
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

// Høydene i rutenettet for en start: 250, 500 … 3000 moh og starthøyden, fra lavest til høyest.
export function gridHeights(launchMasl) {
  const heights = [];
  for (let h = STEP_M; h <= TOP_M; h += STEP_M) heights.push(h);
  if (Number.isFinite(launchMasl) && !heights.includes(Math.round(launchMasl))) heights.push(Math.round(launchMasl));
  return heights.sort((a, b) => a - b);
}

// Open-Meteo-svaret (timeformat=unixtime, wind_speed_unit=ms) gjort om til rutenettet:
// { times: [ms], heights: [moh], launch, elevation, cells: [time][height] = [retning, m/s] eller null,
//   blh: [moh], cloudBase: [moh], cape: [J/kg] }. Grenselaget og skybasen er regnet om til meter over havet.
// Skybasen er anslått fra temperatur og duggpunkt ved bakken: omtrent 125 m per grad forskjell.
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
    // Vinden 10 m over bakken gjelder fra terrenget, eller fra starten når starten ligger lavere enn terrenget
    // Open-Meteo oppgir for punktet, så startraden alltid har en verdi.
    const s10 = num(hourly.wind_speed_10m?.[i]), d10 = num(hourly.wind_direction_10m?.[i]);
    if (s10 != null && d10 != null) points.push({ h: ground, speed: s10, dir: d10 });
    for (const p of LEVELS) {
      const h = num(hourly[`geopotential_height_${p}hPa`]?.[i]);
      const speed = num(hourly[`wind_speed_${p}hPa`]?.[i]), dir = num(hourly[`wind_direction_${p}hPa`]?.[i]);
      // Trykkflater under terrenget (1000 hPa ligger ofte under bakken på fjellet) tas ikke med.
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
