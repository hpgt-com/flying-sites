// Tester for grupperingen av starter under «Start» på stedssiden (lib/format.js). Kjøres med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLaunches, searchPlaces } from "../lib/format.js";

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

test("retninger per kategori følger startene for kategorien", async () => {
  const { categoryDirections } = await import("../lib/format.js");
  const elgen = {
    categories: ["PG", "SPG"],
    wind_directions: { primary: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], possible: [] },
    launches: [
      { directions: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], categories: ["PG"] },
      { directions: ["NE", "E", "SE", "S", "SW"], categories: ["SPG"] },
    ],
  };
  const r = categoryDirections(elgen);
  assert.deepEqual(r.SPG, { primary: ["NE", "E", "SE", "S", "SW"], possible: [] });
  assert.equal(r.PG.primary.length, 8);
  // Start uten egne kategorier gjelder alle stedets kategorier, og retninger utenfor wind_directions tas ikke med.
  const solli = {
    categories: ["PG", "SPG"],
    wind_directions: { primary: ["N", "E"], possible: ["S"] },
    launches: [{ directions: ["N", "S"] }, { directions: ["W"], categories: ["SPG"] }],
  };
  assert.deepEqual(categoryDirections(solli).SPG, { primary: ["N"], possible: ["S"] });
  assert.deepEqual(categoryDirections({ categories: ["PG"], launches: [] }), {});
});

test("formatering følger språket", async () => {
  const { formatNumber, formatDate, directionLabel, formatLimit } = await import("../lib/format.js");
  assert.equal(formatNumber(3.45, 1), "3,5");
  assert.equal(formatNumber(3.45, 1, "en"), "3.5");
  assert.equal(formatDate("2026-10-06"), "06.10.2026");
  assert.equal(formatDate("2026-10-06", "en"), "6 Oct 2026");
  assert.equal(directionLabel("NE"), "NØ");
  assert.equal(directionLabel("NE", "en"), "NE");
  assert.equal(formatLimit({ ref: "GND", value: 0 }, "en"), "ground");
});

test("søket finner en start på kommunen og regioner som ikke er kommunenavn", () => {
  const municipalities = new Set(["Harstad", "Kvæfjord", "Flakstad"]);
  // «Kvæfjord» i regionen «Harstad og Kvæfjord» skal ikke gi treff på en start i Harstad.
  assert.deepEqual(searchPlaces({ municipality: "Harstad", region: "Harstad og Kvæfjord" }, municipalities), ["Harstad"]);
  assert.deepEqual(searchPlaces({ municipality: "Kvæfjord", region: "Harstad og Kvæfjord" }, municipalities), ["Kvæfjord"]);
  assert.deepEqual(searchPlaces({ municipality: "Flakstad", region: "Lofoten" }, municipalities), ["Flakstad", "Lofoten"]);
  assert.deepEqual(searchPlaces({ municipality: "Flakstad" }, municipalities), ["Flakstad"]);
});
