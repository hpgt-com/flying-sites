// Sikkerhetskopien av historikken som bare finnes i lageret (store.js): flyaktiviteten per dag (flight_days) og hvor
// godt varselet traff (verify_hours). Målingene har sitt eget arkiv (archive.js). Hver natt skrives hver tabell til R2
// som backup/<table>/<day>.json og backup/<table>/latest.json, og filen fra KEEP_DAYS dager før slettes. Et nytt, tomt
// lager (et tapt Durable Object) leser latest.json inn igjen ved sin første kopiering, før det skriver sin egen
// (Store.backup). Testet i test/data-quota.test.js.

export const TABLES = {
  flight_days: ["day", "site", "flights", "pilots", "minutes", "max_dist", "max_alt"],
  verify_hours: ["site", "station", "time", "f_dir", "f_speed", "f_gust", "m_dir", "m_speed", "m_gust", "n", "f_temp", "m_temp", "f_pressure", "m_pressure"],
  flights: ["id", "day", "site", "start", "end", "minutes", "max_alt", "max_dist", "max_speed", "counted", "points"],
};
// En fil laget før kolonner ble lagt til (på slutten), leses fortsatt inn. Kolonnene må være de første i tabellen,
// minst så mange som dette, og resten blir null.
export const MIN_COLUMNS = { flight_days: 7, verify_hours: 10, flights: 11 };
export const KEEP_DAYS = 90;
export const JSON_META = { httpMetadata: { contentType: "application/json; charset=utf-8" } };

export const backupPath = (table, day) => `backup/${table}/${day}.json`;
export const latestPath = (table) => `backup/${table}/latest.json`;

// Dagen KEEP_DAYS dager før day (YYYY-MM-DD). Filen for den dagen slettes.
export function expiredDay(day, keepDays = KEEP_DAYS) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - keepDays * 86400000).toISOString().slice(0, 10);
}

// Radene i en tabell som fil: kolonnene én gang, og hver rad som en liste i den rekkefølgen.
export function backupBody(table, rows, day) {
  const columns = TABLES[table];
  return JSON.stringify({ table, day, columns, rows: rows.map((r) => columns.map((c) => r[c] ?? null)) });
}

// Radene i en sikkerhetskopi, sjekket: tabellen er en av TABLES, kolonnene er tabellens kolonner (eller de første av
// dem, MIN_COLUMNS eller flere, fra før de senere ble lagt til; de blir null), og hver rad har én verdi per kolonne.
// Ellers kastes en feil, så en feil fil leses aldri inn.
export function backupRows(text, table) {
  const body = JSON.parse(text);
  const columns = TABLES[table];
  const own = Array.isArray(body?.columns) ? body.columns : [];
  const known = own.length >= (MIN_COLUMNS[table] ?? columns.length) && own.length <= columns.length && own.join() === columns.slice(0, own.length).join();
  if (body?.table !== table || !known || !Array.isArray(body.rows)) throw new Error(`backup: ${table}: feil format`);
  if (body.rows.some((r) => !Array.isArray(r) || r.length !== own.length)) throw new Error(`backup: ${table}: feil rad`);
  const missing = columns.length - own.length;
  return missing ? body.rows.map((r) => r.concat(Array(missing).fill(null))) : body.rows;
}

// Setningen som leser en rad inn igjen. En rad som alt finnes (skrevet etter at lageret ble tapt), beholdes: den er
// nyere.
export function restoreSql(table) {
  const columns = TABLES[table];
  return `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
}
