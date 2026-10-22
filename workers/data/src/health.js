// The data service's health, as /v1/status.json: for each source when it last ran, when it last succeeded and its last
// error, and for each dataset when it was last written, how old it is and whether that is within its limit (MAX_AGE).
// The launches missing from the forecast and the winds aloft, and the last day archived per station source, are listed
// too. Nothing in it is secret or about a visitor. Read by the hourly check .github/workflows/health.yml, which opens an
// issue when something is too old. Tested in test/data-worker.test.js.

// Minutes a dataset may go without being written before it counts as too old: a few runs of its source missed
// (schedule.js), so one slow or failed run is not an alarm. The flights are written only when someone is in the air,
// the verification twice an hour, the forecast grids every three and six hours.
export const MAX_AGE = { forecast: 60, stations: 15, windgram: 90, verification: 90, grid: 400, "grid-wide": 760 };

// An error message as it may be shown: addresses are left out (Holfuy's has the key in it), and it is kept short.
export const cleanError = (message) => String(message).replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[adresse]").replace(/[?&][^\s=]+=\S+/g, "").slice(0, 200);

// The sources' runs recorded: { name: { tried, ok, error } } from the previous one and this run's results
// ({ name: null for success, or the error message }).
export function recordRuns(prev, results, now) {
  const out = { ...(prev ?? {}) };
  const at = new Date(now).toISOString();
  for (const [name, error] of Object.entries(results)) {
    out[name] = { ...out[name], tried: at, ...(error ? { error: cleanError(error), errorAt: at } : { ok: at }) };
  }
  return out;
}

// Days the nightly backup (store.js backup) may be behind before it counts as a problem: one missed run is not an alarm.
export const BACKUP_MAX_DAYS = 2;

// The status. snapshots: { dataset: { updated, body } } as stored; expected: { forecast: [ids], windgram: [ids] }, the
// launches each should have; archive: { source: last day archived }; backup: { day, rows } from the last nightly backup,
// or null when none has been made (ok then only while the archive is not set up, env.ARCHIVE missing).
// The source that writes a dataset, where its name differs (index.js scheduled).
const SOURCE_OF = { verification: "verify", "grid-wide": "gridWide" };

export function buildStatus({ runs, snapshots, expected, archive, backup, now }) {
  const datasets = {};
  let ok = true;
  for (const [name, max] of Object.entries(MAX_AGE)) {
    const snap = snapshots[name];
    const updated = snap?.updated ?? null;
    const age = updated ? Math.round((now - Date.parse(updated)) / 60000) : null;
    // A dataset whose source has never run (a new one, before its first turn on the schedule) is pending, not an alarm.
    const pending = !snap && !runs?.[SOURCE_OF[name] ?? name];
    const d = { updated, ageMinutes: age, maxAgeMinutes: max, ok: pending || (age !== null && age <= max), ...(pending ? { pending: true } : {}) };
    if (expected[name] && snap?.body) {
      let sites = {};
      try { sites = JSON.parse(snap.body).sites ?? {}; } catch { /* not JSON */ }
      d.missing = expected[name].filter((id) => !Object.hasOwn(sites, id));
    }
    if (!d.ok) ok = false;
    datasets[name] = d;
  }
  const today = new Date(now).toISOString().slice(0, 10);
  const backupDays = backup?.day ? Math.round((Date.parse(today) - Date.parse(backup.day)) / 86400000) : null;
  const b = backup === undefined ? null : { day: backup?.day ?? null, daysAgo: backupDays, maxDays: BACKUP_MAX_DAYS, ok: backupDays !== null && backupDays <= BACKUP_MAX_DAYS };
  if (b && !b.ok) ok = false;
  return { dataset: "status", fetched: new Date(now).toISOString(), ok, datasets, sources: runs ?? {}, archive, backup: b };
}
