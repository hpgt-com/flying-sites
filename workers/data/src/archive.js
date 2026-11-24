// Arkivet: data eldre enn det lageret beholder (de siste 7 dagene) skrives som filer til R2 (env.ARCHIVE), én fil per
// stasjon per dag (UTC). Slik varer de i årevis for lite penger, og rapporter kan kjøres på filene (DuckDB, Excel).
// Filene er lagt opp for å kunne lastes inn i en database senere. Hver rad har kilden og stasjonen, så filer fra alle
// stasjoner passer i én tabell. Mappene bruker formen nøkkel=verdi (holfuy/station=490/year=2026/2026-10-16.csv), som
// DuckDB, BigQuery, Athena og Spark leser som kolonner. Da kan en spørring velge stasjoner og år uten å åpne hver fil.
// Ingenting slettes fra lageret før dagen er i arkivet, så uten R2 beholder lageret alt.
// Hjelpefunksjonene er rene. archiveSource skriver filene for en kilde og deles av kildene. Testet i
// test/data-worker.test.js.

import { FIELDS } from "./measurements.js";

const DAY = 86400000;

export const dateOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// De hele dagene (UTC) som skal arkiveres: fra dagen for den eldste målingen, eller dagen etter den sist arkiverte, til
// den siste dagen som sluttet for LATE_HOURS timer siden. Målinger kan komme sent: METs stasjoner rapporterer opptil to
// timer etter, og en arkivert dag skrives ikke på nytt. Høyst `limit` dager, så én kjøring blir kort. Resten kommer
// senere.
export const LATE_HOURS = 3;
export function daysToArchive(oldest, archivedThrough, now, limit = 2) {
  if (!oldest) return [];
  let day = archivedThrough ? Date.parse(archivedThrough + "T00:00:00Z") + DAY : Date.parse(dateOf(Date.parse(oldest)) + "T00:00:00Z");
  const today = Date.parse(dateOf(now - LATE_HOURS * 3600000) + "T00:00:00Z");
  const days = [];
  while (day < today && days.length < limit) { days.push(dateOf(day)); day += DAY; }
  return days;
}

// Det som kan slettes fra lageret: eldre enn keepDays, og bare dager som er i arkivet. Uten en arkivert dag ingenting
// (null).
export function pruneBefore(now, keepDays, archivedThrough) {
  if (!archivedThrough) return null;
  const keep = now - keepDays * DAY;
  const archivedEnd = Date.parse(archivedThrough + "T00:00:00Z") + DAY;
  return new Date(Math.min(keep, archivedEnd)).toISOString();
}

const cell = (v) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
const csv = (header, rows) => header.join(",") + "\n" + rows.map((r) => r.map(cell).join(",")).join("\n") + (rows.length ? "\n" : "");

// Hvor en dag for en stasjon havner i arkivet.
export const dayPath = (source, station, day) => `${source}/station=${station}/year=${day.slice(0, 4)}/${day}.csv`;

// Målinger som CSV: én rad per måling med kilden og stasjonen, tider i UTC, én kolonne per felt i measurements.js med
// enheten i navnet, og de andre verdiene som JSON i extra_json.
export function measurementsCsv(rows) {
  return csv(["source", "station", "time_utc", ...FIELDS.map((f) => f.csv), "extra_json"],
    rows.map((r) => [r.source, r.station, r.time, ...FIELDS.map((f) => r[f.key]), r.extra ? JSON.stringify(r.extra) : null]));
}

// Stasjonene som CSV (kilde, nummer, navn, stasjonens modell når den er kjent, flystedet, posisjon). Da kan rapporter
// og kart vise navn og steder, og skille målinger fra ulike typer stasjoner.
export function stationsCsv(stations) {
  return csv(["source", "station", "name", "model", "site", "lat", "lon", "altitude_m"],
    stations.map((s) => [s.source, s.id, s.name, s.model, s.site, s.lat, s.lon, s.altitude]));
}

const CSV = { httpMetadata: { contentType: "text/csv; charset=utf-8" } };

// Skriver de ferdige dagene for en kilde som ennå ikke er i arkivet (høyst to per kjøring), og stasjonslisten. Så
// slettes det som både er i arkivet og eldre enn keepDays, fra lageret. stations: [{ source, id, name, model, site,
// lat, lon, altitude }]. Uten R2 (env.ARCHIVE) skrives og slettes ingenting.
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
