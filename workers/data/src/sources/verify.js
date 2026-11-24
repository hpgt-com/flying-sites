// Hvor godt varselet traff (datasettet «verification»). For hvert flysted med egen stasjon (stations.js) settes
// varselet for hver ferdige time (forecast_hours, slik det sto i løpet av timen, sources/forecast.js) opp mot det
// stasjonen målte i timen: middelvinden, det høyeste kastet og retningen, og der stasjonen måler dem, temperaturen og
// lufttrykket (begge ved havnivå: METs varsel gir det slik, og stasjonene rapporterer det slik). Parene beholdes i et
// år (store.js verify_hours), og datasettet summerer de siste DAYS dagene per sted. Testet i test/data-worker.test.js.

export const DATASET = "verification";
export const DAYS = 30;
export const KEEP_DAYS = 365;
// Timene som ses på igjen i hver kjøring, så en time der målingene kom sent (METs timesverdier), likevel blir paret.
export const BACK_HOURS = 3;
// En sektor trenger så mange timer før dens egen feil vises, og retningen teller bare når det er litt vind.
export const SECTOR_MIN_HOURS = 5;
export const DIR_MIN_SPEED = 2;
const HOUR = 3600000;
const CODES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const rad = Math.PI / 180;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round1 = (v) => Math.round(v * 10) / 10;

export function sector(dir) { return CODES[Math.round((((dir % 360) + 360) % 360) / 45) % 8]; }
// Den minste vinkelen mellom to retninger, 0–180.
export function angle(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }

// Det en stasjon målte i timen fra `start` (ms): rader med tid etter starten til og med slutten av timen (MET stempler
// timesverdien ved slutten). { speed (middel), gust (høyest), dir (vektormiddel), temp og pressure (middel, null uten),
// n }, eller null.
export function measuredHour(rows, start) {
  const part = rows.filter((r) => { const t = Date.parse(r.time); return t > start && t <= start + HOUR && num(r.speed) !== null; });
  if (!part.length) return null;
  let u = 0, v = 0, withDir = 0;
  for (const r of part) if (num(r.dir) !== null) { u += Math.sin(r.dir * rad) * r.speed; v += Math.cos(r.dir * rad) * r.speed; withDir++; }
  const gusts = part.map((r) => num(r.gust)).filter((g) => g !== null);
  const meanOf = (key) => { const xs = part.map((r) => num(r[key])).filter((x) => x !== null); return xs.length ? round1(xs.reduce((t, x) => t + x, 0) / xs.length) : null; };
  return {
    speed: round1(part.reduce((t, r) => t + r.speed, 0) / part.length),
    gust: gusts.length ? Math.max(...gusts) : null,
    dir: withDir && (u || v) ? Math.round((Math.atan2(u, v) / rad + 360) % 360) : null,
    temp: meanOf("temperature"),
    pressure: meanOf("pressure"),
    n: part.length,
  };
}

// Parene for de ferdige timene fra `from` til `now`: ett per koblet sted med både et varsel og en måling.
// links: [{ site, source, station }]. hours: rader fra forecast_hours. rows: rader fra measurements for alle koblede
// stasjoner.
export function pairs(links, hours, rows, from, now) {
  const out = [];
  for (const link of links) {
    const own = rows.filter((r) => r.source === link.source && String(r.station) === String(link.station));
    for (const h of hours.filter((x) => x.site === link.site)) {
      const start = Date.parse(h.time);
      if (start < from || start + HOUR > now || num(h.speed) === null) continue;
      const m = measuredHour(own, start);
      if (!m) continue;
      out.push({ site: link.site, station: String(link.station), time: h.time, f_dir: num(h.dir), f_speed: h.speed, f_gust: num(h.gust),
        m_dir: m.dir, m_speed: m.speed, m_gust: m.gust, n: m.n,
        f_temp: num(h.temp), m_temp: m.temp, f_pressure: num(h.pressure), m_pressure: m.pressure });
    }
  }
  return out;
}

// Parene for ett sted summert: middelfeilen for middelvinden og kastet (målt − varslet, så + betyr sterkere enn
// varslet), den gjennomsnittlige absolutte feilen, andelen timer retningen var innenfor 45° (ved DIR_MIN_SPEED eller
// mer), og feilen i middelvinden per sektor vinden kom fra. Temperaturen og trykket på samme måte (bias og
// gjennomsnittlig absolutt feil, målt − varslet), over timene som har begge, null uten noen. null uten par.
export function summarize(list) {
  if (!list.length) return null;
  const mean = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length;
  const err = list.map((p) => p.m_speed - p.f_speed);
  const gusts = list.filter((p) => num(p.m_gust) !== null && num(p.f_gust) !== null).map((p) => p.m_gust - p.f_gust);
  const dirs = list.filter((p) => num(p.m_dir) !== null && num(p.f_dir) !== null && p.m_speed >= DIR_MIN_SPEED);
  const bySector = {};
  for (const p of list) if (num(p.m_dir) !== null) (bySector[sector(p.m_dir)] ??= []).push(p.m_speed - p.f_speed);
  const sectors = Object.fromEntries(Object.entries(bySector).filter(([, xs]) => xs.length >= SECTOR_MIN_HOURS)
    .map(([code, xs]) => [code, { hours: xs.length, bias: round1(mean(xs)) }]));
  const errors = (m, f) => list.filter((p) => num(p[m]) !== null && num(p[f]) !== null).map((p) => p[m] - p[f]);
  const temps = errors("m_temp", "f_temp"), pressures = errors("m_pressure", "f_pressure");
  return {
    hours: list.length,
    bias: round1(mean(err)),
    mae: round1(mean(err.map(Math.abs))),
    gustBias: gusts.length ? round1(mean(gusts)) : null,
    dirHit: dirs.length ? Math.round((dirs.filter((p) => angle(p.m_dir, p.f_dir) <= 45).length / dirs.length) * 100) / 100 : null,
    sectors,
    tempHours: temps.length, tempBias: temps.length ? round1(mean(temps)) : null, tempMae: temps.length ? round1(mean(temps.map(Math.abs))) : null,
    pressureHours: pressures.length, pressureBias: pressures.length ? round1(mean(pressures)) : null, pressureMae: pressures.length ? round1(mean(pressures.map(Math.abs))) : null,
  };
}

// Datasettet fra de lagrede parene: per sted stasjonen og sammendraget for de siste DAYS dagene.
export function buildVerification(stored, now = Date.now()) {
  const sites = {};
  for (const p of stored) (sites[p.site] ??= []).push(p);
  return {
    dataset: DATASET, source: "MET Norge, Holfuy", fetched: new Date(now).toISOString(), days: DAYS,
    sites: Object.fromEntries(Object.entries(sites).map(([site, list]) => [site, { station: list[list.length - 1].station, ...summarize(list) }])),
  };
}

// Én kjøring: parer de siste BACK_HOURS ferdige timene, lagrer dem, rydder bort dem eldre enn KEEP_DAYS dager, og
// lagrer datasettet.
export async function run(store, links, now = Date.now()) {
  if (!links.length) return;
  const from = Math.floor(now / HOUR) * HOUR - BACK_HOURS * HOUR;
  const hours = (await store.forecastHoursSince(new Date(from).toISOString()));
  const rows = [];
  for (const source of [...new Set(links.map((l) => l.source))]) rows.push(...(await store.measurementsSince(source, new Date(from).toISOString())));
  await store.putVerifyHours(pairs(links, hours, rows, from, now));
  await store.pruneVerifyHours(new Date(now - KEEP_DAYS * 24 * HOUR).toISOString());
  const stored = await store.verifyHoursSince(new Date(now - DAYS * 24 * HOUR).toISOString());
  await store.putSnapshot(DATASET, JSON.stringify(buildVerification(stored, now)));
}
