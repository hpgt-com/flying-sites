// Tests for the restore drill's checks (lib/restore-drill.js). Run with `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import { expectedRows, drillVerdict } from "../lib/restore-drill.js";
import { backupBody } from "../workers/data/src/backup.js";

const files = {
  flight_days: backupBody("flight_days", [{ day: "2026-10-18", site: "heia", flights: 4, pilots: 3, minutes: 120, max_dist: 3.1, max_alt: 950 }, { day: "2026-10-19", site: "heia", flights: 1, pilots: 1, minutes: 20, max_dist: 1, max_alt: 600 }], "2026-10-23"),
  verify_hours: backupBody("verify_hours", [], "2026-10-23"),
  flights: backupBody("flights", [], "2026-10-23"),
};

test("drill: the rows each backup file holds", () => {
  assert.deepEqual(expectedRows(files), { flight_days: 2, verify_hours: 0, flights: 0 });
  assert.throws(() => expectedRows({ flight_days: files.flight_days }), /verify_hours: mangler/);
  assert.throws(() => expectedRows({ flight_days: files.verify_hours, verify_hours: files.verify_hours, flights: files.flights }), /feil format/);
});

test("drill: the verdict from the status", () => {
  const expected = { flight_days: 2, verify_hours: 0, flights: 0 };
  assert.equal(drillVerdict(null, expected).done, false);
  assert.equal(drillVerdict({ sources: {} }, expected).done, false, "not recorded yet");
  const ok = { sources: { restore: { tried: "t", ok: "t", lastMs: 120 } }, backup: { restored: { rows: { flight_days: 2, verify_hours: 0, flights: 0 } } } };
  assert.deepEqual(drillVerdict(ok, expected), { done: true, ok: true, reason: "lest inn flight_days: 2, verify_hours: 0, flights: 0 på 120 ms" });
  const failed = { sources: { restore: { tried: "t", errorAt: "t", error: "R2 nede" } }, backup: { restored: null } };
  assert.deepEqual(drillVerdict(failed, expected), { done: true, ok: false, reason: "innlesingen feilet: R2 nede" });
  // A table the store did not record was not read at all, even when nothing was expected from it.
  const short = { sources: { restore: { tried: "t", ok: "t" } }, backup: { restored: { rows: { flight_days: 1 } } } };
  assert.deepEqual(drillVerdict(short, expected), { done: true, ok: false, reason: "rader lest inn stemmer ikke: flight_days: 1 av 2, verify_hours: 0 av 0, flights: 0 av 0" });
});
