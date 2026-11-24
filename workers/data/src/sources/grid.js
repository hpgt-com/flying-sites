// Varselrutenettene for kartlagene «Prognose»: Open-Meteos varsel for rutenett av punkter (GRIDS). «grid» ligger tett
// rundt flystedene med 0,1 × 0,25 grader mellom punktene (omtrent 11 × 10 km). «grid-wide» er grovere og dekker et
// større område fra Saltfjellet til Tromsø og Kiruna, så det som kommer over fjellet fra Sverige i sørøstlig vind, også
// er på kartet. For timene på dagen de neste dagene: temperatur og duggpunkt, vind i 10 m og i 925 hPa (omtrent 750 m),
// grenselaget, CAPE, skyer og nedbør, og solinnstrålingen på bakken. Siden regner ut resten fra disse
// (src/assets/js/forecast-layer.js): termikkstyrken, termikktoppen, skybasen og Cu, og lave skyer.
//
// Det tette rutenettet hver tredje time og det store hver sjette (schedule.js), på ulike minutter. Gratisbruken av
// Open-Meteo tillater 600 punkter i minuttet og 10 000 i døgnet (en forespørsel teller én gang per punkt, mer med over
// 10 variabler), og hvert rutenett holder seg under 600. Svarene er store (hundrevis av punkter × timene ×
// variablene), mer enn de 10 ms CPU en kjøring av Workeren kan bruke. Derfor gjøres hentingen og byggingen i lagerets
// Durable Object (Store.refreshGrid), som kan bruke langt mer. En kjøring som feiler, beholder det forrige datasettet.
// Testet i test/data-store.test.js.

// box: et fast område { s, w, n, e }. Ellers startstedene med margin [lat, lon] rundt seg.
export const GRIDS = {
  grid: { dLat: 0.1, dLon: 0.25, margin: [0.35, 0.9] },
  "grid-wide": { dLat: 0.2, dLon: 0.5, box: { s: 66.6, w: 11.5, n: 70.0, e: 21.5 } },
};
export const SOURCE = "Open-Meteo";
export const LICENSE = "CC BY 4.0, Open-Meteo";
export const API = "https://api.open-meteo.com/v1/forecast";
// Punkter per forespørsel (adressene holdes korte).
export const PER_REQUEST = 100;
// Fem dager, så langt tidslinjen på forsiden går (lib/weather/met.js). Hver time de første HOURLY_HOURS timene, som MET
// har. Etter det har MET bare 00, 06, 12 og 18 UTC, så bare 06, 12 og 18 beholdes. Tidslinjen viser ingen andre timer
// der, og hver time i fem dager ville kommet nær de 2 MB en verdi i lageret kan være.
export const FORECAST_DAYS = 5;
export const HOURLY_HOURS = 60;
// Timene som beholdes, i UTC: 04–20 er 05/06–21/22 i Norge, timene noen flyr.
export const FIRST_HOUR = 4;
export const LAST_HOUR = 20;
// Navnene hos Open-Meteo, og de korte nøklene i datasettet med antall desimaler. Ti, så et punkt teller én gang.
export const VARS = [
  ["temperature_2m", "T", 1], ["dew_point_2m", "Td", 1], ["wind_speed_10m", "ws", 1], ["wind_direction_10m", "wd", 0],
  ["wind_speed_925hPa", "ws9", 1], ["wind_direction_925hPa", "wd9", 0], ["boundary_layer_height", "blh", 0],
  ["cloud_cover_low", "cl", 0], ["precipitation", "pr", 1], ["shortwave_radiation", "sw", 0],
];

// Ned eller opp til et helt steg, så marginen aldri kuttes (den lille epsilon hindrer at 68.4 blir 68.3).
const floorTo = (v, step) => Math.floor(v / step + 1e-9) * step;
const ceilTo = (v, step) => Math.ceil(v / step - 1e-9) * step;
const round = (v, d) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

// Et rutenett (GRIDS): boksen, eller startstedene med marginen rundt, ut til hele steg. { dLat, dLon, lat0, lon0,
// rows, cols, points: [[lat, lon], ...] }, rad for rad fra sør.
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

// Forespørselen for noen punkter: alle variablene, per time, i m/s og Unix-tid.
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

// Datasettet fra svarene fra Open-Meteo, ett per punkt i rekkefølgen i rutenettet (et svar for flere punkter er en
// liste). Timene fra den som pågår, innenfor FIRST_HOUR–LAST_HOUR UTC (etter HOURLY_HOURS bare hver sjette). For hver
// variabel én liste per punkt. Modellens høyde for hvert punkt (0 på havet). Kaster en feil når et svar mangler eller
// har andre timer enn det første.
export function buildGrid(name, grid, answers, now = Date.now()) {
  if (answers.length !== grid.points.length) throw new Error(`Open-Meteo: ${answers.length} svar for ${grid.points.length} punkter`);
  const all = answers[0]?.hourly?.time;
  if (!Array.isArray(all) || !all.length) throw new Error("Open-Meteo: tomt svar");
  const keep = all.map((t, i) => [t, i]).filter(([t]) => {
    const hour = new Date(t * 1000).getUTCHours();
    return t * 1000 > now - 3600000 && hour >= FIRST_HOUR && hour <= LAST_HOUR && (t * 1000 < now + HOURLY_HOURS * 3600000 || hour % 6 === 0);
  });
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

// Henter et rutenett fra Open-Meteo, PER_REQUEST punkter om gangen, og bygger datasettet. Kjøres i Durable Object-et.
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

// Én kjøring, fra Workeren: lageret henter og lagrer rutenettet (Store.refreshGrid).
export async function run(store, name, sites, now = Date.now()) {
  await store.refreshGrid(name, sites.map((s) => ({ lat: s.lat, lon: s.lon })), now);
}
