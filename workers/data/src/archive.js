// The archive: data older than the store keeps (the last 7 days) is written as files to R2 (env.ARCHIVE), one file per
// station per day (UTC), so it lasts for years at little cost and reports can run on the files (DuckDB, Excel).
// The files are laid out to be loaded into a database later: every row carries the source and the station, so files from all stations
// fit one table, and the folders use the key=value form (holfuy/station=490/year=2026/2026-10-16.csv) that DuckDB,
// BigQuery, Athena and Spark read as columns, so a query can pick stations and years without opening every file.
// Nothing is deleted from the store before its day is in the archive, so without R2 the store keeps everything.
// The helpers are pure; archiveSource writes a source's files and is shared by the sources. Tested in
// test/data-worker.test.js.

import { FIELDS } from "./measurements.js";

const DAY = 86400000;

export const dateOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// The whole days (UTC) to archive: from the day of the oldest measurement, or the day after the last archived one,
// up to the last day that ended LATE_HOURS ago (measurements can come in late: MET's stations report up to two hours
// after, and an archived day is not written again). At most `limit`, so one run stays short; the rest follow later.
export const LATE_HOURS = 3;
export function daysToArchive(oldest, archivedThrough, now, limit = 2) {
  if (!oldest) return [];
  let day = archivedThrough ? Date.parse(archivedThrough + "T00:00:00Z") + DAY : Date.parse(dateOf(Date.parse(oldest)) + "T00:00:00Z");
  const today = Date.parse(dateOf(now - LATE_HOURS * 3600000) + "T00:00:00Z");
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

// Measurements as CSV, one row each with the source and the station, times in UTC, a column per field in measurements.js with the unit
// in its name, and the other values as JSON in extra_json.
export function measurementsCsv(rows) {
  return csv(["source", "station", "time_utc", ...FIELDS.map((f) => f.csv), "extra_json"],
    rows.map((r) => [r.source, r.station, r.time, ...FIELDS.map((f) => r[f.key]), r.extra ? JSON.stringify(r.extra) : null]));
}

// The stations as CSV (source, number, name, the station's model when known, the flying site, position), so reports and
// maps can show names and places, and tell measurements from different kinds of stations apart.
export function stationsCsv(stations) {
  return csv(["source", "station", "name", "model", "site", "lat", "lon", "altitude_m"],
    stations.map((s) => [s.source, s.id, s.name, s.model, s.site, s.lat, s.lon, s.altitude]));
}

const CSV = { httpMetadata: { contentType: "text/csv; charset=utf-8" } };

// Writes a source's finished days not yet in the archive (at most two per run) and its station list, then deletes from
// the store what is both in the archive and older than keepDays. stations: [{ source, id, name, model, site, lat, lon,
// altitude }]. Without R2 (env.ARCHIVE) nothing is written or deleted.
export async function archiveSource(store, env, key, stations, keepDays, now) {
  if (!env.ARCHIVE) return;
  const state = (await store.getState(`${key}-archive`)) ?? { through: null };
  const days = daysToArchive(await store.oldestMeasurement(key), state.through, now);
  if (days.length) await env.ARCHIVE.put(`${key}/stations.csv`, stationsCsv(stations), CSV);
  for (const day of days) {
    const rows = await store.measurementsBetween(key, day + "T00:00:00.000Z", day + "T23:59:59.999Z");
    const ids = new Set(rows.map((r) => String(r.station)));
    for (const id of ids) {
      await env.ARCHIVE.put(dayPath(key, id, day), measurementsCsv(rows.filter((r) => String(r.station) === id)), CSV);
    }
    state.through = day;
    await store.putState(`${key}-archive`, state);
  }
  const before = pruneBefore(now, keepDays, state.through);
  if (before) await store.prune(key, before);
}
