import { test } from "node:test";
import assert from "node:assert/strict";
import { airspaceAgeDays, readAirspaceChecked, AIRSPACE_STALE_DAYS } from "../lib/airspace.js";

test("luftromssjekk: alder i hele dager siden sjekken", () => {
  const now = Date.parse("2026-12-06T12:00:00Z");
  assert.equal(airspaceAgeDays("2026-10-22", now), 45);
  assert.equal(airspaceAgeDays("2026-12-06", now), 0);
  assert.equal(airspaceAgeDays(null, now), null);
});

test("luftromssjekk: utdatert etter grensen, en månedlig sjekk er godt innenfor", () => {
  assert.ok(AIRSPACE_STALE_DAYS > 31, "en månedlig sjekk skal ikke regnes som utdatert");
  assert.ok(airspaceAgeDays("2026-10-22", Date.parse("2026-12-07T00:00:00Z")) > AIRSPACE_STALE_DAYS);
});

test("luftromssjekk: checked.json i cachen har en gyldig dato", () => {
  assert.match(readAirspaceChecked(), /^\d{4}-\d{2}-\d{2}$/);
});
