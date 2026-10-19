// The data service's store: one Durable Object with SQLite (free plan), which allows far more writes per day than KV.
// Holds the datasets as they are served (snapshots), each source's own state, the station measurements, and the forecast for
// each hour as it stood during that hour (forecast_hours, sources/forecast.js).
// Reached through env.STORE (wrangler.toml); the methods are called over RPC from index.js and the sources.

import { DurableObject } from "cloudflare:workers";
import { FIELDS } from "./measurements.js";
import { mergeTrails } from "./live.js";

const COLUMNS = FIELDS.map((f) => f.key);
// A measurement row as stored: the fields as numbers, extra as JSON text.
// The station is identified by its source and its number there (two providers can use the same number), kept as text.
const toRow = (r) => [r.source, String(r.station), r.time, ...COLUMNS.map((c) => r[c] ?? null), r.extra ? JSON.stringify(r.extra) : null];
const fromRow = (r) => ({ ...r, extra: r.extra ? JSON.parse(r.extra) : null });
const SELECT = `SELECT source, station, time, ${COLUMNS.join(", ")}, extra FROM measurements`;

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS snapshots (dataset TEXT PRIMARY KEY, body TEXT NOT NULL, updated TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS forecast_hours (site TEXT NOT NULL, time TEXT NOT NULL, dir REAL, speed REAL, gust REAL, rain REAL, fetched TEXT NOT NULL, PRIMARY KEY (site, time))");
    // Forecast against measured, per site and finished hour (sources/verify.js), kept for a year.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS verify_hours (site TEXT NOT NULL, station TEXT NOT NULL, time TEXT NOT NULL,
      f_dir REAL, f_speed REAL, f_gust REAL, m_dir REAL, m_speed REAL, m_gust REAL, n INTEGER, PRIMARY KEY (site, station, time))`);
    // Flying activity per site and day (sources/flights.js): only sums, no pilot or device.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS flight_days (day TEXT NOT NULL, site TEXT NOT NULL, pilots INTEGER NOT NULL,
      minutes INTEGER NOT NULL, max_dist REAL, max_alt REAL, PRIMARY KEY (day, site))`);
    let have = new Set(this.sql.exec("PRAGMA table_info(measurements)").toArray().map((c) => c.name));
    // The first version (18.10.2026) had no source, and the station and time as the key. Rebuilt once with (source,
    // station, time) as the key; the rows already there were all Holfuy's and keep their values.
    const old = have.size > 0 && !have.has("source");
    if (old) this.sql.exec("ALTER TABLE measurements RENAME TO measurements_v1");
    this.sql.exec("CREATE TABLE IF NOT EXISTS measurements (source TEXT NOT NULL, station TEXT NOT NULL, time TEXT NOT NULL, PRIMARY KEY (source, station, time))");
    // A field added to measurements.js gets its column here; the rows already stored get null in it.
    have = new Set(this.sql.exec("PRAGMA table_info(measurements)").toArray().map((c) => c.name));
    for (const c of COLUMNS) if (!have.has(c)) this.sql.exec(`ALTER TABLE measurements ADD COLUMN ${c} REAL`);
    if (!have.has("extra")) this.sql.exec("ALTER TABLE measurements ADD COLUMN extra TEXT");
    if (old) {
      this.sql.exec(`INSERT OR IGNORE INTO measurements (source, station, time, dir, speed, gust, min, temperature)
        SELECT 'holfuy', CAST(station AS TEXT), time, dir, speed, gust, min, temperature FROM measurements_v1`);
      this.sql.exec("DROP TABLE measurements_v1");
    }
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

  // The same measurement can come back on several runs while the station has not reported anew: kept once.
  addMeasurements(rows) {
    for (const r of rows) {
      this.sql.exec(`INSERT OR IGNORE INTO measurements (source, station, time, ${COLUMNS.join(", ")}, extra) VALUES (${["?", "?", "?", ...COLUMNS.map(() => "?"), "?"].join(", ")})`,
        ...toRow(r));
    }
  }

  measurementsSince(source, since) {
    return this.sql.exec(`${SELECT} WHERE source = ? AND time >= ? ORDER BY time`, source, since).toArray().map(fromRow);
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
      this.sql.exec(`INSERT INTO forecast_hours (site, time, dir, speed, gust, rain, fetched) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (site, time) DO UPDATE SET dir = excluded.dir, speed = excluded.speed, gust = excluded.gust, rain = excluded.rain, fetched = excluded.fetched`,
        h.site, h.time, h.dir ?? null, h.speed ?? null, h.gust ?? null, h.rain ?? null, h.fetched);
    }
  }

  forecastHoursSince(since) {
    return this.sql.exec("SELECT site, time, dir, speed, gust, rain FROM forecast_hours WHERE time >= ? ORDER BY time", since).toArray();
  }

  pruneForecastHours(before) {
    this.sql.exec("DELETE FROM forecast_hours WHERE time < ?", before);
  }

  // An hour paired again (a late measurement) replaces what was stored for it.
  putVerifyHours(rows) {
    for (const r of rows) {
      this.sql.exec(`INSERT INTO verify_hours (site, station, time, f_dir, f_speed, f_gust, m_dir, m_speed, m_gust, n) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (site, station, time) DO UPDATE SET f_dir = excluded.f_dir, f_speed = excluded.f_speed, f_gust = excluded.f_gust,
        m_dir = excluded.m_dir, m_speed = excluded.m_speed, m_gust = excluded.m_gust, n = excluded.n`,
        r.site, r.station, r.time, r.f_dir, r.f_speed, r.f_gust, r.m_dir, r.m_speed, r.m_gust, r.n);
    }
  }

  verifyHoursSince(since) {
    return this.sql.exec("SELECT site, station, time, f_dir, f_speed, f_gust, m_dir, m_speed, m_gust, n FROM verify_hours WHERE time >= ? ORDER BY time", since).toArray();
  }

  pruneVerifyHours(before) {
    this.sql.exec("DELETE FROM verify_hours WHERE time < ?", before);
  }

  // The day's sums replace what an earlier run stored for the same day and site.
  putFlightDays(rows) {
    for (const r of rows) {
      this.sql.exec(`INSERT INTO flight_days (day, site, pilots, minutes, max_dist, max_alt) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (day, site) DO UPDATE SET pilots = excluded.pilots, minutes = excluded.minutes, max_dist = excluded.max_dist, max_alt = excluded.max_alt`,
        r.day, r.site, r.pilots, r.minutes, r.max_dist ?? null, r.max_alt ?? null);
    }
  }

  flightDays() {
    return this.sql.exec("SELECT day, site, pilots, minutes, max_dist, max_alt FROM flight_days ORDER BY day").toArray();
  }

  prune(source, before) {
    this.sql.exec("DELETE FROM measurements WHERE source = ? AND time < ?", source, before);
  }
}
