import { test } from "node:test";
import assert from "node:assert/strict";
import { applyManualAirspace } from "../lib/airspace.js";

const fetched = [
  { name: "Evenes TMA", type: "TMA", lower: { value: 4500, unit: "FT", ref: "MSL" } },
  { name: "Evenes CTR", type: "CTR", lower: { value: 0, unit: "FT", ref: "GND" } },
];

test("name and note match on type and lower limit", () => {
  const out = applyManualAirspace(fetched, [{ name: "Evenes TMA1", type: "TMA", lower: { value: 4500, unit: "FT" }, note: "Klasse D." }]);
  assert.equal(out[0].name, "Evenes TMA1");
  assert.equal(out[0].note, "Klasse D.");
  assert.equal(out[1].note, undefined);
});

test("a line with only name and note matches the airspace with the same name", () => {
  const out = applyManualAirspace(fetched, [{ name: "Evenes CTR", nearby: true, note: "Ring tårnet." }]);
  assert.equal(out[1].note, "Ring tårnet.");
  assert.equal(out[0].note, undefined);
});

test("a line with a type does not match on name alone", () => {
  const out = applyManualAirspace(fetched, [{ name: "Evenes CTR", type: "TMA", lower: { value: 2500, unit: "FT" }, note: "x" }]);
  assert.equal(out[1].note, undefined);
});
