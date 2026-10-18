// The data service's store: one Durable Object with SQLite (free plan), which allows far more writes per day than KV.
// Holds the datasets as they are served (snapshots), each source's own state, and the station measurements.
// Reached through env.STORE (wrangler.toml); the methods are called over RPC from index.js and the sources.

import { DurableObject } from "cloudflare:workers";
import { FIELDS } from "./measurements.js";

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
    this.sql.exec("CREATE TABLE IF NOT EXISTS measurements (source TEXT NOT NULL, station TEXT NOT NULL, time TEXT NOT NULL, PRIMARY KEY (source, station, time))");
    // A field added to measurements.js gets its column here; the rows already stored get null in it.
    const have = new Set(this.sql.exec("PRAGMA table_info(measurements)").toArray().map((c) => c.name));
    for (const c of COLUMNS) if (!have.has(c)) this.sql.exec(`ALTER TABLE measurements ADD COLUMN ${c} REAL`);
    if (!have.has("extra")) this.sql.exec("ALTER TABLE measurements ADD COLUMN extra TEXT");
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

  prune(source, before) {
    this.sql.exec("DELETE FROM measurements WHERE source = ? AND time < ?", source, before);
  }
}
