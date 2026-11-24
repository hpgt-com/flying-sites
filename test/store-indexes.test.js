// Lagerets spørringer på tid (workers/data/src/store.js) bruker en indeks (indexes.js), så en kjøring leser bare radene
// den ber om og ikke hele tabellen: gratisplanen tillater 5 millioner rows_read i døgnet. Kjør med `npm test`.
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
// SQL-en til hver sql.exec i store.js, med delene den bygger satt inn. De som bygges fra et tabellnavn
// (sikkerhetskopien), utelates.
const statements = [...source.matchAll(/sql\.exec\(\s*(?:"([^"]+)"|`([^`]+)`)/g)].map((m) => (m[1] ?? m[2])
  .replace("${SELECT}", `SELECT source, station, time, ${COLUMNS.join(", ")}, extra FROM measurements`)
  .replace(/\s+/g, " ")).filter((s) => !s.includes("${"));

// Lagerets tabeller slik Durable Object lager dem, med eller uten indeksene i indexes.js.
function database(withIndexes) {
  const { db, storage } = sqliteStorage();
  new Store({ storage }, {});
  if (!withIndexes) for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").all()) db.exec(`DROP INDEX ${name}`);
  return db;
}

// Spørringene som velger rader etter tid: de siste timene, en dag, den eldste, og det som er eldre enn dagene som
// beholdes.
const byTime = statements.filter((s) => /^(SELECT|DELETE)/.test(s) && /\btime\b/.test(s.split(/\bWHERE\b/)[1] ?? ""));

// Hvordan SQLite ville kjørt den: detaljen for hvert steg, som «SEARCH measurements USING INDEX … (source=? AND
// time>?)».
const plan = (db, sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array((sql.match(/\?/g) ?? []).length).fill(null)).map((r) => r.detail);
const readsByTime = (steps) => steps.some((d) => /USING (PRIMARY KEY|(COVERING )?INDEX \w+) \((source=\? AND )?time[<>=]/.test(d));

test("lageret har spørringer etter tid å sjekke", () => {
  assert.ok(byTime.length >= 6, `fant ${byTime.length}`);
  assert.ok(byTime.some((s) => s.includes("FROM measurements")) && byTime.some((s) => s.includes("FROM forecast_hours")) && byTime.some((s) => s.includes("FROM verify_hours")));
});

test("hver spørring etter tid finner radene sine gjennom en nøkkel eller en indeks på tiden", () => {
  const db = database(true);
  for (const sql of byTime) {
    const steps = plan(db, sql);
    // MIN(time) for én kilde leser den første raden i nøkkelen.
    const ok = readsByTime(steps) || (/MIN\(time\)/.test(sql) && steps.some((d) => /USING PRIMARY KEY \(source=\?\)/.test(d)));
    assert.ok(ok, `${sql}\n  ${steps.join("\n  ")}`);
  }
});

test("uten indeksen leser spørringene på verifiseringstimene hele tabellen", () => {
  const db = database(false);
  const needIndex = byTime.filter((sql) => /\bverify_hours\b/.test(sql));
  assert.ok(needIndex.length >= 2);
  assert.ok(needIndex.every((sql) => !readsByTime(plan(db, sql))));
});
