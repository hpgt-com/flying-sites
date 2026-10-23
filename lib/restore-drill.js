// The restore drill (.github/workflows/restore-drill.yml): the data service's own code is run locally (wrangler dev,
// workerd) with the latest backup files from the off-site copy put in its local R2, its schedule is fired once, and
// the store must have read every row back in (store.js restore), as /v1/status.json reports under backup.restored.
// Pure; tested in test/restore-drill.test.js.
import { TABLES, backupRows } from "../workers/data/src/backup.js";

// The rows each table's backup file holds: { table: n }. Throws on a file that is not a backup of that table.
export function expectedRows(files) {
  const out = {};
  for (const table of Object.keys(TABLES)) {
    if (typeof files[table] !== "string") throw new Error(`${table}: mangler`);
    out[table] = backupRows(files[table], table).length;
  }
  return out;
}

// Whether the status shows the restore done with the expected rows: { done, ok, reason }. Not done while the schedule's
// runs are still being recorded (the restore is recorded with the others, after the slow sources).
export function drillVerdict(status, expected) {
  const run = status?.sources?.restore;
  if (!run?.tried) return { done: false, ok: false, reason: "venter på at kjøringen er registrert" };
  if (!run.ok) return { done: true, ok: false, reason: `innlesingen feilet: ${run.error ?? "ukjent feil"}` };
  const rows = status?.backup?.restored?.rows ?? {};
  const wrong = Object.keys(expected).filter((t) => rows[t] !== expected[t]).map((t) => `${t}: ${rows[t] ?? 0} av ${expected[t]}`);
  if (wrong.length) return { done: true, ok: false, reason: `rader lest inn stemmer ikke: ${wrong.join(", ")}` };
  return { done: true, ok: true, reason: `lest inn ${Object.keys(expected).map((t) => `${t}: ${expected[t]}`).join(", ")} på ${run.lastMs ?? "?"} ms` };
}
