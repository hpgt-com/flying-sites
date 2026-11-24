// Vindvarsel fra MET (api.met.no, samme kilde som Yr) for hver start, for vurderingen av vind og regn på forsiden
// og «Vind nå» på flystedssidene. Feiler hentingen for ett flysted, er det bare det flystedet som mangler.

// Hvor langt fram: MET gir hver time i omtrent 2½ døgn, så hver 6. time (00, 06, 12, 18 UTC) i ti døgn; alt
// beholdes opptil DAYS døgn fra første time, så tidslinjen på forsiden når like langt.
export const DAYS = 5;
const HOUR = 3600000;
// MET krever at klienter oppgir hvem de er, med kontaktinformasjon.
const USER_AGENT = "hpgt-flysteder/1.0 (https://flysteder.hpgt.com)";

// Én rad per tidspunkt i varselet: [time, direction, speed, gust, rain]. Hver gjelder til den neste (en time, eller
// 6 timer lenger fram). Regn er nedbør per time i mm: neste times, eller for et steg på 6 timer de 6 timene fordelt
// jevnt (null når varselet mangler det). MET gir ikke vindkast for stegene på 6 timer (null).
export function metRows(data, days = DAYS) {
  const series = data.properties.timeseries;
  const end = Date.parse(series[0]?.time) + days * 24 * HOUR;
  return series.filter((t) => Date.parse(t.time) < end).map((t) => {
    const d = t.data.instant.details;
    const six = t.data.next_6_hours?.details?.precipitation_amount;
    const rain = t.data.next_1_hours?.details?.precipitation_amount ?? (typeof six === "number" ? Math.round((six / 6) * 10) / 10 : null);
    return [t.time, Math.round(d.wind_from_direction), d.wind_speed, d.wind_speed_of_gust ?? null, rain];
  });
}

// Temperaturen (°C, i høyden til start) og lufttrykket ved havnivå (hPa) per tidspunkt for de første EXTRA_HOURS
// timene: [[time, temperature, pressure]]. Holdes atskilt fra radene, som hver side henter og som bare trenger
// vinden, siden det bare er verifiseringen i datatjenesten (workers/data/src/sources/verify.js) som bruker disse.
export const EXTRA_HOURS = 48;
export function metExtras(data, hours = EXTRA_HOURS) {
  const series = data.properties.timeseries;
  const end = Date.parse(series[0]?.time) + hours * HOUR;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return series.filter((t) => Date.parse(t.time) < end).map((t) => {
    const d = t.data.instant.details;
    return [t.time, num(d.air_temperature), num(d.air_pressure_at_sea_level)];
  });
}

// Når MET sist oppdaterte varselet for punktet (modellkjøringen), ikke når vi hentet det.
export function metUpdated(data) {
  const updated = data.properties?.meta?.updated_at;
  return Number.isFinite(Date.parse(updated)) ? updated : null;
}

// Tidspunktene lagres én gang. Flystedene hentes etter hverandre og kan starte på ulike timer hvis hentingen går
// over et timeskifte, så hver rad settes på sitt eget tidspunkt. En time som mangler, blir null.
// updated: updated_at fra MET per flysted. Den eldste beholdes, så siden aldri påstår en nyere modellkjøring enn alle har.
export function mergeSites(fetched, now = new Date(), updated = {}) {
  const series = Object.values(fetched);
  if (!series.length) return null;
  const times = series[0].map((row) => row[0]);
  const sites = {};
  for (const [id, rows] of Object.entries(fetched)) {
    const byTime = new Map(rows.map(([time, dir, speed, gust, rain]) => [time, [dir, speed, gust, rain]]));
    sites[id] = times.map((time) => byTime.get(time) ?? null);
  }
  const runs = Object.values(updated).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { fetched: now.toISOString(), updated: runs[0] ?? null, source: "MET Norge", times, sites };
}

// Datoen i en header som ISO-tid, eller null.
const headerTime = (response, name) => { const t = Date.parse(response.headers.get(name) ?? ""); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

// Varselet for en start: { rows, extras, updated, expires, lastModified }. Vilkårene til MET ber klienter ikke spørre
// igjen før Expires, og sende If-Modified-Since så et uendret varsel blir 304 uten innhold: med expires og lastModified
// fra forrige svar (datatjenesten tar vare på dem per start, workers/data/src/sources/forecast.js) er svaret
// { notModified: true, expires } uten forespørsel så lenge Expires ikke er passert, og etter en 304. Byggingen henter
// hver start én gang og har ingenting å sende med.
export async function fetchSite(launch, altitude, { expires = null, lastModified = null, now = Date.now(), fetchFn = fetch } = {}) {
  if (expires && Date.parse(expires) > now) return { notModified: true, expires, lastModified };
  const url = new URL("https://api.met.no/weatherapi/locationforecast/2.0/complete");
  url.searchParams.set("lat", launch.lat.toFixed(4));
  url.searchParams.set("lon", launch.lon.toFixed(4));
  if (Number.isFinite(altitude)) url.searchParams.set("altitude", Math.round(altitude));
  const headers = { "user-agent": USER_AGENT };
  if (lastModified) headers["if-modified-since"] = new Date(lastModified).toUTCString();
  const response = await fetchFn(url, { headers, signal: AbortSignal.timeout(20000) });
  if (response.status === 304 && lastModified) return { notModified: true, expires: headerTime(response, "expires") ?? expires, lastModified };
  if (!response.ok) throw new Error(`MET svarte ${response.status}`);
  const data = await response.json();
  return { rows: metRows(data), extras: metExtras(data), updated: metUpdated(data), expires: headerTime(response, "expires"), lastModified: headerTime(response, "last-modified") };
}

// sites: fra readSites() i lib/site-files.js. Gir null når ingen flysteder kunne hentes.
export async function fetchForecast(sites) {
  const fetched = {};
  const updated = {};
  const failed = [];
  for (const { id, data } of sites) {
    try {
      ({ rows: fetched[id], updated: updated[id] } = await fetchSite(data.launch, data.elevation?.launch_masl));
    } catch (err) {
      failed.push(`${id} (${err.message})`);
    }
  }
  const forecast = mergeSites(fetched, new Date(), updated);
  if (!forecast) console.warn(`[varsel] Fikk ikke vindvarsel fra MET for noen steder: ${failed.join(", ")}. Siden bygges uten vindvurdering.`);
  else if (failed.length) console.warn(`[varsel] Mangler vindvarsel for ${failed.join(", ")}.`);
  return forecast;
}
