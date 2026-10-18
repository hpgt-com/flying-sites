// The archive: data older than the store keeps (the last 7 days) is written as files to R2 (env.ARCHIVE), one file per
// station per day (UTC), so it lasts for years at little cost and reports can run on the files (DuckDB, Excel).
// The files are laid out to be loaded into a database later: every row carries the station, so files from all stations
// fit one table, and the folders use the key=value form (holfuy/station=490/year=2026/2026-10-16.csv) that DuckDB,
// BigQuery, Athena and Spark read as columns, so a query can pick stations and years without opening every file.
// Nothing is deleted from the store before its day is in the archive, so without R2 the store keeps everything.
// Pure helpers here; the sources write their own files. Tested in test/data-worker.test.js.

const DAY = 86400000;

export const dateOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// The whole days (UTC) to archive: from the day of the oldest measurement, or the day after the last archived one,
// up to yesterday. At most `limit`, so one run stays short; the rest follow on the next runs.
export function daysToArchive(oldest, archivedThrough, now, limit = 2) {
  if (!oldest) return [];
  let day = archivedThrough ? Date.parse(archivedThrough + "T00:00:00Z") + DAY : Date.parse(dateOf(Date.parse(oldest)) + "T00:00:00Z");
  const today = Date.parse(dateOf(now) + "T00:00:00Z");
  const days = [];
  while (day < today && days.length < limit) { days.push(dateOf(day)); day += DAY; }
  return days;
}

// What may be deleted from the store: older than keepDays, and only days that are in the archive. Without an archived
// day, nothing (null).
export function pruneBefore(now, keepDays, archivedThrough) {
  if (!archivedThrough) return null;
  const keep = now - keepDays * DAY;
  const archivedEnd = Date.parse(archivedThrough + "T00:00:00Z") + DAY;
  return new Date(Math.min(keep, archivedEnd)).toISOString();
}

const cell = (v) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
const csv = (header, rows) => header.join(",") + "\n" + rows.map((r) => r.map(cell).join(",")).join("\n") + (rows.length ? "\n" : "");

// Where a station's day goes in the archive.
export const dayPath = (source, station, day) => `${source}/station=${station}/year=${day.slice(0, 4)}/${day}.csv`;

// Measurements as CSV, one row each with the station, times in UTC and the units in the header.
export function measurementsCsv(rows) {
  return csv(["station", "time_utc", "direction_deg", "speed_ms", "gust_ms", "min_ms", "temperature_c"],
    rows.map((r) => [r.station, r.time, r.dir, r.speed, r.gust, r.min, r.temperature]));
}

// The stations as CSV (number, name, position), so reports and maps can show names and places.
export function stationsCsv(stations) {
  return csv(["station", "name", "site", "lat", "lon", "altitude_m"], stations.map((s) => [s.id, s.name, s.site, s.lat, s.lon, s.altitude]));
}
