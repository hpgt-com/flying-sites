// Tester for grupperingen av starter under «Start» på stedssiden (lib/format.js). Kjøres med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLaunches } from "../lib/format.js";

test("starter med samme retninger blir én linje med tekstene i rekkefølge", () => {
  const groups = groupLaunches([
    { directions: ["S", "SE", "E"], text: "Fra toppen." },
    { directions: ["N", "NE"], text: "Fra alpinbakken." },
    { directions: ["E", "S", "SE"], text: "Ved masta.", lat: 68.8, lon: 16.3 },
    { directions: ["NW"], text: "I anlegget." },
    { directions: ["NW"], text: "På ryggen." },
  ]);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0], { directions: ["S", "SE", "E"], categories: [], texts: ["Fra toppen.", "Ved masta."] });
  assert.deepEqual(groups[2].texts, ["I anlegget.", "På ryggen."]);
});

test("samme retninger med ulike kategorier holdes for seg", () => {
  const groups = groupLaunches([
    { directions: ["S"], categories: ["PG"], text: "PG." },
    { directions: ["S"], categories: ["SPG"], text: "SPG." },
  ]);
  assert.equal(groups.length, 2);
});

test("ingen starter gir tom liste", () => {
  assert.deepEqual(groupLaunches(undefined), []);
  assert.deepEqual(groupLaunches(null), []);
});
