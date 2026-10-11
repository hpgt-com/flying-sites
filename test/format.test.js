// Tests for grouping launches under «Start» on the site page (lib/format.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLaunches, searchPlaces } from "../lib/format.js";

test("launches with the same directions become one line with the texts in order", () => {
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

test("the same directions with different categories are kept apart", () => {
  const groups = groupLaunches([
    { directions: ["S"], categories: ["PG"], text: "PG." },
    { directions: ["S"], categories: ["SPG"], text: "SPG." },
  ]);
  assert.equal(groups.length, 2);
});

test("no launches give an empty list", () => {
  assert.deepEqual(groupLaunches(undefined), []);
  assert.deepEqual(groupLaunches(null), []);
});

test("directions per category follow the launches for that category", async () => {
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
  // A launch without its own categories applies to all the site's categories, and directions outside wind_directions are left out.
  const solli = {
    categories: ["PG", "SPG"],
    wind_directions: { primary: ["N", "E"], possible: ["S"] },
    launches: [{ directions: ["N", "S"] }, { directions: ["W"], categories: ["SPG"] }],
  };
  assert.deepEqual(categoryDirections(solli).SPG, { primary: ["N"], possible: ["S"] });
  assert.deepEqual(categoryDirections({ categories: ["PG"], launches: [] }), {});
});

test("formatting follows the language", async () => {
  const { formatNumber, formatDate, directionLabel, formatLimit } = await import("../lib/format.js");
  assert.equal(formatNumber(3.45, 1), "3,5");
  assert.equal(formatNumber(3.45, 1, "en"), "3.5");
  assert.equal(formatDate("2026-10-06"), "06.10.2026");
  assert.equal(formatDate("2026-10-06", "en"), "6 Oct 2026");
  assert.equal(directionLabel("NE"), "NØ");
  assert.equal(directionLabel("NE", "en"), "NE");
  assert.equal(formatLimit({ ref: "GND", value: 0 }, "en"), "ground");
});

test("search finds a launch by municipality and by regions that are not municipality names", () => {
  const municipalities = new Set(["Harstad", "Kvæfjord", "Flakstad"]);
  // «Kvæfjord» in the region «Harstad og Kvæfjord» must not match a launch in Harstad.
  assert.deepEqual(searchPlaces({ municipality: "Harstad", region: "Harstad og Kvæfjord" }, municipalities), ["Harstad"]);
  assert.deepEqual(searchPlaces({ municipality: "Kvæfjord", region: "Harstad og Kvæfjord" }, municipalities), ["Kvæfjord"]);
  assert.deepEqual(searchPlaces({ municipality: "Flakstad", region: "Lofoten" }, municipalities), ["Flakstad", "Lofoten"]);
  assert.deepEqual(searchPlaces({ municipality: "Flakstad" }, municipalities), ["Flakstad"]);
});
