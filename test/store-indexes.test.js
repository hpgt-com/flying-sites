// The store's queries on the time (workers/data/src/store.js) use an index (indexes.js), so a run reads only the rows it
// asks for and not the whole table: the free plan allows 5 million rows_read a day. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { FIELDS } from "../workers/data/src/measurements.js";

register("./helpers/cloudflare-loader.mjs", import.meta.url);
const { sqliteStorage } = await import("./helpers/data-service.mjs");
const { Store } = await import("../workers/data/src/store.js");

const source = readFileSync(new URL("../workers/data/src/store.js", import.meta.url), "utf8");
const COLUMNS = FIELDS.map((f) => f.key);
// The SQL of each sql.exec in store.js, with the parts it builds put in. Those built from a table name (the backup)
// are left out.
const statements = [...source.matchAll(/sql\.exec\(\s*(?:"([^"]+)"|`([^`]+)`)/g)].map((m) => (m[1] ?? m[2])
  .replace("${SELECT}", `SELECT source, station, time, ${COLUMNS.join(", ")}, extra FROM measurements`)
  .replace(/\s+/g, " ")).filter((s) => !s.includes("${"));

// The store's tables as the Durable Object makes them, with or without the indexes in indexes.js.
function database(withIndexes) {
  const { db, storage } = sqliteStorage();
  new Store({ storage }, {});
  if (!withIndexes) for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").all()) db.exec(`DROP INDEX ${name}`);
  return db;
}

// The queries that pick rows by time: the last hours, a day, the oldest, and what is older than the days kept.
const byTime = statements.filter((s) => /^(SELECT|DELETE)/.test(s) && /\btime\b/.test(s.split(/\bWHERE\b/)[1] ?? ""));

// How SQLite would run it: each step's detail, such as «SEARCH measurements USING INDEX … (source=? AND time>?)».
const plan = (db, sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array((sql.match(/\?/g) ?? []).length).fill(null)).map((r) => r.detail);
const readsByTime = (steps) => steps.some((d) => /USING (PRIMARY KEY|(COVERING )?INDEX \w+) \((source=\? AND )?time[<>=]/.test(d));

test("the store has queries by time to check", () => {
  assert.ok(byTime.length >= 6, `found ${byTime.length}`);
  assert.ok(byTime.some((s) => s.includes("FROM measurements")) && byTime.some((s) => s.includes("FROM forecast_hours")) && byTime.some((s) => s.includes("FROM verify_hours")));
});

test("every query by time finds its rows through a key or an index on the time", () => {
  const db = database(true);
  for (const sql of byTime) {
    const steps = plan(db, sql);
    // MIN(time) for one source reads the first row of the key.
    const ok = readsByTime(steps) || (/MIN\(time\)/.test(sql) && steps.some((d) => /USING PRIMARY KEY \(source=\?\)/.test(d)));
    assert.ok(ok, `${sql}\n  ${steps.join("\n  ")}`);
  }
});

test("without the index the queries on the verification hours read the whole table", () => {
  const db = database(false);
  const needIndex = byTime.filter((sql) => /\bverify_hours\b/.test(sql));
  assert.ok(needIndex.length >= 2);
  assert.ok(needIndex.every((sql) => !readsByTime(plan(db, sql))));
});
