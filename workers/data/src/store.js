// The data service's store: one Durable Object with SQLite (free plan), which allows far more writes per day than KV.
// Holds the datasets as they are served (snapshots), each source's own state, and the station measurements.
// Reached through env.STORE (wrangler.toml); the methods are called over RPC from index.js and the sources.

import { DurableObject } from "cloudflare:workers";

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS snapshots (dataset TEXT PRIMARY KEY, body TEXT NOT NULL, updated TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS measurements (station INTEGER NOT NULL, time TEXT NOT NULL, dir REAL, speed REAL,
      gust REAL, min REAL, temperature REAL, PRIMARY KEY (station, time))`);
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
      this.sql.exec("INSERT OR IGNORE INTO measurements (station, time, dir, speed, gust, min, temperature) VALUES (?, ?, ?, ?, ?, ?, ?)",
        r.station, r.time, r.dir, r.speed, r.gust, r.min, r.temperature);
    }
  }

  measurementsSince(since) {
    return this.sql.exec("SELECT station, time, dir, speed, gust, min, temperature FROM measurements WHERE time >= ? ORDER BY time", since).toArray();
  }

  prune(before) {
    this.sql.exec("DELETE FROM measurements WHERE time < ?", before);
  }
}
