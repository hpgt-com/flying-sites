import { test } from "node:test";
import assert from "node:assert/strict";
import { applyManualAirspace } from "../lib/airspace.js";

const fetched = [
  { name: "Evenes TMA", type: "TMA", lower: { value: 4500, unit: "FT", ref: "MSL" } },
  { name: "Evenes CTR", type: "CTR", lower: { value: 0, unit: "FT", ref: "GND" } },
];

test("navn og merknad treffer på type og nedre grense", () => {
  const out = applyManualAirspace(fetched, [{ name: "Evenes TMA1", type: "TMA", lower: { value: 4500, unit: "FT" }, note: "Klasse D." }]);
  assert.equal(out[0].name, "Evenes TMA1");
  assert.equal(out[0].note, "Klasse D.");
  assert.equal(out[1].note, undefined);
});

test("linje med bare navn og merknad treffer luftrommet med samme navn", () => {
  const out = applyManualAirspace(fetched, [{ name: "Evenes CTR", nearby: true, note: "Ring tårnet." }]);
  assert.equal(out[1].note, "Ring tårnet.");
  assert.equal(out[0].note, undefined);
});

test("linje med type treffer ikke bare på navn", () => {
  const out = applyManualAirspace(fetched, [{ name: "Evenes CTR", type: "TMA", lower: { value: 2500, unit: "FT" }, note: "x" }]);
  assert.equal(out[1].note, undefined);
});
