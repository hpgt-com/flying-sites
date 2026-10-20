// The backup of the history that exists only in the store (store.js): the flying activity per day (flight_days) and how
// well the forecast hit (verify_hours). The measurements have their own archive (archive.js). Once a night each table is
// written to R2 as backup/<table>/<day>.json and backup/<table>/latest.json, and the file from KEEP_DAYS before is
// deleted. A new, empty store (a lost Durable Object) reads latest.json back in on its first backup run, before it
// writes its own (Store.backup). Tested in test/data-quota.test.js.

export const TABLES = {
  flight_days: ["day", "site", "flights", "pilots", "minutes", "max_dist", "max_alt"],
  verify_hours: ["site", "station", "time", "f_dir", "f_speed", "f_gust", "m_dir", "m_speed", "m_gust", "n"],
};
export const KEEP_DAYS = 90;
export const JSON_META = { httpMetadata: { contentType: "application/json; charset=utf-8" } };

export const backupPath = (table, day) => `backup/${table}/${day}.json`;
export const latestPath = (table) => `backup/${table}/latest.json`;

// The day KEEP_DAYS before day (YYYY-MM-DD), whose file is deleted.
export function expiredDay(day, keepDays = KEEP_DAYS) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - keepDays * 86400000).toISOString().slice(0, 10);
}

// A table's rows as the file: the columns once, each row as an array in that order.
export function backupBody(table, rows, day) {
  const columns = TABLES[table];
  return JSON.stringify({ table, day, columns, rows: rows.map((r) => columns.map((c) => r[c] ?? null)) });
}

// The rows of a backup file, checked: the table is one of TABLES, the columns are its columns, and each row has one
// value per column. Throws otherwise, so a wrong file is never read in.
export function backupRows(text, table) {
  const body = JSON.parse(text);
  const columns = TABLES[table];
  if (body?.table !== table || !Array.isArray(body.columns) || body.columns.join() !== columns.join() || !Array.isArray(body.rows)) {
    throw new Error(`backup: ${table}: feil format`);
  }
  if (body.rows.some((r) => !Array.isArray(r) || r.length !== columns.length)) throw new Error(`backup: ${table}: feil rad`);
  return body.rows;
}

// The statement that reads a row back in. A row already there (written since the store was lost) is kept: it is newer.
export function restoreSql(table) {
  const columns = TABLES[table];
  return `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
}
