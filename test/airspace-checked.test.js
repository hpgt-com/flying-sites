import { test } from "node:test";
import assert from "node:assert/strict";
import { airspaceAgeDays, readAirspaceChecked, AIRSPACE_STALE_DAYS } from "../lib/airspace.js";

test("airspace check: age in whole days since the check", () => {
  const now = Date.parse("2026-12-06T12:00:00Z");
  assert.equal(airspaceAgeDays("2026-10-22", now), 45);
  assert.equal(airspaceAgeDays("2026-12-06", now), 0);
  assert.equal(airspaceAgeDays(null, now), null);
});

test("airspace check: stale after the limit, a monthly check is well within it", () => {
  assert.ok(AIRSPACE_STALE_DAYS > 31, "a monthly check must not count as stale");
  assert.ok(airspaceAgeDays("2026-10-22", Date.parse("2026-12-07T00:00:00Z")) > AIRSPACE_STALE_DAYS);
});

test("airspace check: checked.json in the cache has a valid date", () => {
  assert.match(readAirspaceChecked(), /^\d{4}-\d{2}-\d{2}$/);
});
