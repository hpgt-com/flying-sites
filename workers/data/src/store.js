// The data service's store: one Durable Object with SQLite (free plan), which allows far more writes per day than KV.
// Holds the datasets as they are served (snapshots), each source's own state, the station measurements, and the forecast for
// each hour as it stood during that hour (forecast_hours, sources/forecast.js).
// Reached through env.STORE (wrangler.toml); the methods are called over RPC from index.js and the sources.

import { DurableObject } from "cloudflare:workers";
import { FIELDS } from "./measurements.js";
import { mergeTrails } from "./live.js";
import { fetchNoTrack, DDB_MAX_AGE_HOURS, DDB_MAX_KEEP_HOURS } from "./aprs.js";
import { INDEXES } from "./indexes.js";
import { fetchGrid, GRIDS } from "./sources/grid.js";
import { TABLES, JSON_META, backupPath, latestPath, expiredDay, backupBody, backupRows, restoreSql } from "./backup.js";

const COLUMNS = FIELDS.map((f) => f.key);
// A measurement row as stored: the fields as numbers, extra as JSON text.
// The station is identified by its source and its number there (two providers can use the same number), kept as text.
const toRow = (r) => [r.source, String(r.station), r.time, ...COLUMNS.map((c) => r[c] ?? null), r.extra ? JSON.stringify(r.extra) : null];
const fromRow = (r) => ({ ...r, extra: r.extra ? JSON.parse(r.extra) : null });
const SELECT = `SELECT source, station, time, ${COLUMNS.join(", ")}, extra FROM measurements`;
const ROW_KEYS = ["source", "station", "time", ...COLUMNS, "extra"];
// How many hours of measurements per source are kept in memory (Store.measurementsSince): the 6 of the stations dataset
// (HISTORY_HOURS in the sources) and a margin.
export const RECENT_HOURS = 7;

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // snapshots, state, forecast_hours and measurements are WITHOUT ROWID tables, keyed so no query needs another index: a
    // row written is then one row counted, not one for the table and one per index (the free plan allows 100 000 a day).
    // All in one transaction, so a start that fails halfway leaves the tables as they were.
    ctx.storage.transactionSync(() => this.createTables());
    // Forecast against measured, per site and finished hour (sources/verify.js), kept for a year.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS verify_hours (site TEXT NOT NULL, station TEXT NOT NULL, time TEXT NOT NULL,
      f_dir REAL, f_speed REAL, f_gust REAL, m_dir REAL, m_speed REAL, m_gust REAL, n INTEGER, PRIMARY KEY (site, station, time))`);
    // The temperature and the pressure came later (24.10.2026): added to stores made before.
    const verifyHave = new Set(this.sql.exec("PRAGMA table_info(verify_hours)").toArray().map((c) => c.name));
    for (const c of ["f_temp", "m_temp", "f_pressure", "m_pressure"]) if (!verifyHave.has(c)) this.sql.exec(`ALTER TABLE verify_hours ADD COLUMN ${c} REAL`);
    // Flying activity per site and day (sources/flights.js): only sums, no pilot or device.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS flight_days (day TEXT NOT NULL, site TEXT NOT NULL, flights INTEGER NOT NULL, pilots INTEGER NOT NULL,
      minutes INTEGER NOT NULL, max_dist REAL, max_alt REAL, PRIMARY KEY (day, site))`);
    // Each flight on its own (sources/flights.js): a random id, the sums, whether it was counted, and OGN's positions
    // as JSON. No device or key.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS flights (id TEXT PRIMARY KEY, day TEXT NOT NULL, site TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
      minutes INTEGER NOT NULL, max_alt INTEGER, max_dist REAL, max_speed REAL, counted INTEGER NOT NULL, points TEXT NOT NULL)`);
    for (const index of INDEXES) this.sql.exec(index);
  }

  // The tables, made when missing. A field added to measurements.js gets its column here; the rows already stored get
  // null in it.
  createTables() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS snapshots (dataset TEXT PRIMARY KEY, body TEXT NOT NULL, updated TEXT NOT NULL) WITHOUT ROWID");
    this.sql.exec("CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID");
    // The forecast for each hour as it stood during that hour (sources/forecast.js), keyed by the time first: read and
    // pruned by time.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS forecast_hours (site TEXT NOT NULL, time TEXT NOT NULL, dir REAL, speed REAL, gust REAL,
      rain REAL, fetched TEXT NOT NULL, PRIMARY KEY (time, site)) WITHOUT ROWID`);
    const forecastHave = new Set(this.sql.exec("PRAGMA table_info(forecast_hours)").toArray().map((c) => c.name));
    for (const c of ["temp", "pressure"]) if (!forecastHave.has(c)) this.sql.exec(`ALTER TABLE forecast_hours ADD COLUMN ${c} REAL`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS measurements (source TEXT NOT NULL, station TEXT NOT NULL, time TEXT NOT NULL,
      ${COLUMNS.map((c) => `${c} REAL`).join(", ")}, extra TEXT, PRIMARY KEY (source, time, station)) WITHOUT ROWID`);
    const have = new Set(this.sql.exec("PRAGMA table_info(measurements)").toArray().map((c) => c.name));
    for (const c of COLUMNS) if (!have.has(c)) this.sql.exec(`ALTER TABLE measurements ADD COLUMN ${c} REAL`);
    if (!have.has("extra")) this.sql.exec("ALTER TABLE measurements ADD COLUMN extra TEXT");
  }

  // The recent track of each aircraft for «Piloter i lufta» (live.js mergeTrails), in memory only: lost when the object
  // is evicted, never written to SQLite.
  mergeLive(positions, now, keepMs) {
    this.live ??= new Map();
    return mergeTrails(this.live, positions, now, keepMs);
  }

  getSnapshot(dataset) {
    const rows = this.sql.exec("SELECT body FROM snapshots WHERE dataset = ?", dataset).toArray();
    return rows.length ? rows[0].body : null;
  }

  // The datasets with when each was last written (for the status, health.js).
  snapshotsFor(datasets) {
    const out = {};
    for (const d of datasets) {
      const rows = this.sql.exec("SELECT body, updated FROM snapshots WHERE dataset = ?", d).toArray();
      if (rows.length) out[d] = { updated: rows[0].updated, body: rows[0].body };
    }
    return out;
  }

  putSnapshot(dataset, body) {
    this.sql.exec("INSERT INTO snapshots (dataset, body, updated) VALUES (?, ?, ?) ON CONFLICT (dataset) DO UPDATE SET body = excluded.body, updated = excluded.updated",
      dataset, body, new Date().toISOString());
  }

  getState(key) {
    const rows = this.sql.exec("SELECT value FROM state WHERE key = ?", key).toArray();
    return rows.length ? JSON.parse(rows[0].value) : null;
  }

  putState(key, value) {
    this.sql.exec("INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
  }

  // «Meld fra» (report.js): the day's random salt for hashing the senders' addresses, made on first use. The salts and
  // counts of earlier days are deleted, so no address hash outlives its day.
  reportSalt(day) {
    this.pruneReports(day);
    let salt = this.getState(`report-salt-${day}`);
    if (!salt) {
      salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
      this.putState(`report-salt-${day}`, salt);
    }
    return salt;
  }

  // Deletes the salts and counts (with the address hashes) of every day but `day`. Called with each report, and once a
  // day on the schedule (index.js), so no hash outlives its day by more than the time to the next run.
  pruneReports(day) {
    this.sql.exec("DELETE FROM state WHERE (key LIKE 'reports-%' OR key LIKE 'report-salt-%') AND key NOT IN (?, ?)", `reports-${day}`, `report-salt-${day}`);
  }

  // Counts one report for the day and the sender, if both are under their limits: "ok", "limit" or "ip-limit". One
  // synchronous method in the Durable Object, so the read and the write cannot be split by another request.
  reserveReport(day, who, dailyLimit, perIpLimit) {
    const key = `reports-${day}`;
    const c = this.getState(key) ?? { n: 0, ips: {} };
    if (c.n >= dailyLimit) return "limit";
    if (who && (c.ips[who] ?? 0) >= perIpLimit) return "ip-limit";
    c.n += 1;
    if (who) c.ips[who] = (c.ips[who] ?? 0) + 1;
    this.putState(key, c);
    return "ok";
  }

  // Gives a reservation back (GitHub failed, so no issue was made).
  releaseReport(day, who) {
    const key = `reports-${day}`;
    const c = this.getState(key);
    if (!c || typeof c !== "object") return;
    c.n = Math.max(0, c.n - 1);
    if (who && c.ips[who]) c.ips[who] -= 1;
    this.putState(key, c);
  }

  // The same measurement can come back on several runs while the station has not reported anew: kept once.
  addMeasurements(rows) {
    for (const r of rows) {
      this.sql.exec(`INSERT OR IGNORE INTO measurements (source, station, time, ${COLUMNS.join(", ")}, extra) VALUES (${["?", "?", "?", ...COLUMNS.map(() => "?"), "?"].join(", ")})`,
        ...toRow(r));
    }
    for (const source of new Set(rows.map((r) => r.source))) {
      const recent = this.recent?.get(source);
      // As INSERT OR IGNORE: a row already kept stays (it comes last, so it wins in keepRecent).
      const added = rows.filter((r) => r.source === source).map((r) => fromRow(Object.fromEntries(toRow(r).map((v, i) => [ROW_KEYS[i], v]))));
      if (recent) this.keepRecent(source, recent.from, [...added, ...recent.rows.values()]);
    }
  }

  // The last hours of each source's measurements, which the stations dataset is built from every minute, are also kept in
  // memory (recent): read from SQLite once, then added to as they are stored, instead of RECENT_HOURS of rows read again
  // on each run (over a million rows a day). Lost when the object is evicted, and then read again.
  measurementsSince(source, since) {
    const recent = this.recent?.get(source);
    if (recent && recent.from <= since) return [...recent.rows.values()].filter((r) => r.time >= since).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    const rows = this.sql.exec(`${SELECT} WHERE source = ? AND time >= ? ORDER BY time`, source, since).toArray().map(fromRow);
    this.keepRecent(source, since, rows);
    return rows;
  }

  // The recent rows of a source from since, by station and time, without those older than RECENT_HOURS before the newest.
  keepRecent(source, since, rows) {
    this.recent ??= new Map();
    const newest = Date.parse(rows.reduce((t, r) => (r.time > t ? r.time : t), since));
    const cut = Number.isFinite(newest) ? new Date(newest - RECENT_HOURS * 3600000).toISOString() : since;
    const from = since > cut ? since : cut;
    this.recent.set(source, { from, rows: new Map(rows.filter((r) => r.time >= from).map((r) => [`${r.station}|${r.time}`, r])) });
  }

  measurementsBetween(source, from, to) {
    return this.sql.exec(`${SELECT} WHERE source = ? AND time >= ? AND time <= ? ORDER BY time`, source, from, to).toArray().map(fromRow);
  }

  oldestMeasurement(source) {
    const rows = this.sql.exec("SELECT MIN(time) AS time FROM measurements WHERE source = ?", source).toArray();
    return rows[0]?.time ?? null;
  }

  // The latest fetch during an hour replaces what an earlier one said for it.
  putForecastHours(hours) {
    for (const h of hours) {
      this.sql.exec(`INSERT INTO forecast_hours (site, time, dir, speed, gust, rain, temp, pressure, fetched) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (site, time) DO UPDATE SET dir = excluded.dir, speed = excluded.speed, gust = excluded.gust, rain = excluded.rain,
        temp = excluded.temp, pressure = excluded.pressure, fetched = excluded.fetched`,
        h.site, h.time, h.dir ?? null, h.speed ?? null, h.gust ?? null, h.rain ?? null, h.temp ?? null, h.pressure ?? null, h.fetched);
    }
  }

  forecastHoursSince(since) {
    return this.sql.exec("SELECT site, time, dir, speed, gust, rain, temp, pressure FROM forecast_hours WHERE time >= ? ORDER BY time", since).toArray();
  }

  pruneForecastHours(before) {
    this.sql.exec("DELETE FROM forecast_hours WHERE time < ?", before);
  }

  // An hour paired again (a late measurement) replaces what was stored for it.
  putVerifyHours(rows) {
    for (const r of rows) {
      this.sql.exec(`INSERT INTO verify_hours (site, station, time, f_dir, f_speed, f_gust, m_dir, m_speed, m_gust, n, f_temp, m_temp, f_pressure, m_pressure)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (site, station, time) DO UPDATE SET f_dir = excluded.f_dir, f_speed = excluded.f_speed, f_gust = excluded.f_gust,
        m_dir = excluded.m_dir, m_speed = excluded.m_speed, m_gust = excluded.m_gust, n = excluded.n,
        f_temp = excluded.f_temp, m_temp = excluded.m_temp, f_pressure = excluded.f_pressure, m_pressure = excluded.m_pressure`,
        r.site, r.station, r.time, r.f_dir, r.f_speed, r.f_gust, r.m_dir, r.m_speed, r.m_gust, r.n,
        r.f_temp ?? null, r.m_temp ?? null, r.f_pressure ?? null, r.m_pressure ?? null);
    }
  }

  verifyHoursSince(since) {
    return this.sql.exec("SELECT site, station, time, f_dir, f_speed, f_gust, m_dir, m_speed, m_gust, n, f_temp, m_temp, f_pressure, m_pressure FROM verify_hours WHERE time >= ? ORDER BY time", since).toArray();
  }

  pruneVerifyHours(before) {
    this.sql.exec("DELETE FROM verify_hours WHERE time < ?", before);
  }

  // The day's sums replace what an earlier run stored for the same day and site.
  putFlightDays(rows) {
    for (const r of rows) {
      this.sql.exec(`INSERT INTO flight_days (day, site, flights, pilots, minutes, max_dist, max_alt) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (day, site) DO UPDATE SET flights = excluded.flights, pilots = excluded.pilots, minutes = excluded.minutes,
        max_dist = excluded.max_dist, max_alt = excluded.max_alt`,
        r.day, r.site, r.flights, r.pilots, r.minutes, r.max_dist ?? null, r.max_alt ?? null);
    }
  }

  flightDays() {
    return this.sql.exec("SELECT day, site, flights, pilots, minutes, max_dist, max_alt FROM flight_days ORDER BY day").toArray();
  }

  // A day's row for a site removed (a flight that was not one, see flights.js CLEANUP).
  deleteFlightDay(day, site) {
    this.sql.exec("DELETE FROM flight_days WHERE day = ? AND site = ?", day, site);
  }

  // One flight (flights.js finish): the positions as JSON. The same id again replaces it.
  putFlight(f) {
    this.sql.exec(`INSERT OR REPLACE INTO flights (id, day, site, start, end, minutes, max_alt, max_dist, max_speed, counted, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      f.id, f.day, f.site, f.start, f.end, f.minutes, f.max_alt ?? null, f.max_dist ?? null, f.max_speed ?? null, f.counted ? 1 : 0, typeof f.points === "string" ? f.points : JSON.stringify(f.points));
  }

  flightsSince(day) {
    return this.sql.exec("SELECT id, day, site, start, end, minutes, max_alt, max_dist, max_speed, counted, points FROM flights WHERE day >= ? ORDER BY start DESC", day).toArray();
  }

  // Counted flights older than countedBefore and dropped ones older than droppedBefore (YYYY-MM-DD) go.
  pruneFlights(countedBefore, droppedBefore) {
    this.sql.exec("DELETE FROM flights WHERE (counted = 1 AND day < ?) OR (counted = 0 AND day < ?)", countedBefore, droppedBefore);
  }

  // A new, empty store (a lost or recreated Durable Object) reads the latest backup (backup.js) back in from the archive
  // (R2), so the history is back within a minute of starting, not the night after. Run every minute from index.js until
  // it has succeeded once (recorded in the health state, which a new store has not got either). Rows written since the
  // store was lost are kept (INSERT OR IGNORE). An archive that does not answer throws, so the next minute tries again;
  // an archive with no backup yet counts as done. Returns the rows read in per table, or null when done before.
  async restore(now) {
    const bucket = this.env.ARCHIVE;
    if (!bucket || this.getState("restore")) return null;
    const restored = {};
    for (const table of Object.keys(TABLES)) {
      const latest = await bucket.get(latestPath(table));
      if (!latest) continue;
      const rows = backupRows(await latest.text(), table);
      const sql = restoreSql(table);
      this.ctx.storage.transactionSync(() => { for (const r of rows) this.sql.exec(sql, ...r); });
      restored[table] = rows.length;
    }
    this.putState("restore", { at: new Date(now).toISOString(), rows: restored });
    return restored;
  }

  // The nightly backup (backup.js) to the archive (R2). Returns the rows written per table.
  async backup(day) {
    const bucket = this.env.ARCHIVE;
    if (!bucket) return null;
    const out = { day, rows: {} };
    for (const table of Object.keys(TABLES)) {
      const rows = this.sql.exec(`SELECT ${TABLES[table].join(", ")} FROM ${table}`).toArray();
      const body = backupBody(table, rows, day);
      await bucket.put(backupPath(table, day), body, JSON_META);
      await bucket.put(latestPath(table), body, JSON_META);
      await bucket.delete(backupPath(table, expiredDay(day)));
      out.rows[table] = rows.length;
    }
    this.putState("backup", { day, rows: out.rows });
    return out;
  }

  // A forecast grid (sources/grid.js, «grid» or «grid-wide»): fetched and built here, where a run may use far more CPU
  // than in the Worker, and stored as the dataset. A failure leaves the previous one and is thrown back to the run.
  async refreshGrid(name, sites, now) {
    if (!GRIDS[name]) throw new Error(`ukjent rutenett ${name}`);
    const body = await fetchGrid(name, sites, now);
    this.putSnapshot(name, JSON.stringify(body));
    return { points: body.elev.length, hours: body.times.length };
  }

  // The devices that must not be tracked, from OGN's device database (aprs.js fetchNoTrack), for the APRS reserve: fetched
  // here, where parsing the few MB may take the CPU it needs, once a day on the schedule (refreshNoTrack, so the list is
  // there before OGN goes down, as the database may go down with it) and kept in the state. noTrack: the kept list, or
  // fetched now when none is kept or it is over DDB_MAX_AGE_HOURS old and the database answers; when it does not, the
  // kept list is used up to DDB_MAX_KEEP_HOURS old. Without a list it throws, and the reserve gives nothing.
  async refreshNoTrack(now) {
    const ids = await fetchNoTrack();
    this.putState("ogn-notrack", { fetched: now, ids });
    return { devices: ids.length };
  }
  async noTrack(now) {
    const kept = this.getState("ogn-notrack");
    if (kept && now - kept.fetched < DDB_MAX_AGE_HOURS * 3600000) return kept.ids;
    try {
      await this.refreshNoTrack(now);
      return this.getState("ogn-notrack").ids;
    } catch (err) {
      if (kept && now - kept.fetched < DDB_MAX_KEEP_HOURS * 3600000) return kept.ids;
      throw err;
    }
  }

  prune(source, before) {
    this.sql.exec("DELETE FROM measurements WHERE source = ? AND time < ?", source, before);
  }
}
