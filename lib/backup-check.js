// Checks the off-site copy of the nightly backup (.github/workflows/backup.yml): each table's latest.json, as copied
// to the other provider, must parse as a backup of that table (workers/data/src/backup.js backupRows) and be from
// today or yesterday (the Worker writes it at 02:14 UTC, the copy is taken at 03:30). Returns one line per table for
// the log, or throws with what is wrong, so the workflow fails and opens an issue. Pure; tested in test/backup-check.test.js.
import { TABLES, backupRows } from "../workers/data/src/backup.js";

export const MAX_AGE_DAYS = 2;

// files: { table: text }; now: milliseconds.
export function checkBackups(files, now) {
  const today = new Date(now).toISOString().slice(0, 10);
  const lines = [];
  for (const table of Object.keys(TABLES)) {
    const text = files[table];
    if (typeof text !== "string") throw new Error(`${table}: latest.json mangler i kopien`);
    const rows = backupRows(text, table);
    const day = JSON.parse(text).day;
    const age = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Math.round((Date.parse(today) - Date.parse(day)) / 86400000) : NaN;
    if (!(age >= 0 && age <= MAX_AGE_DAYS)) throw new Error(`${table}: kopien er fra ${day}, ${Number.isNaN(age) ? "ukjent alder" : `${age} dager gammel`} (grense ${MAX_AGE_DAYS})`);
    lines.push(`${table}: ${rows.length} rader fra ${day}`);
  }
  return lines;
}
