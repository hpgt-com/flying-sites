// Tests for «Flyaktivitet» on the site page (src/assets/js/flights.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.FlyingSites = { lang: "nb", formatNumber: (n, d) => Number(n).toFixed(d || 0).replace(".", ",") };
await import("../src/assets/js/flights.js");
const FL = globalThis.FlyingSitesFlights;
const texts = { "flights.farthest": "Lengst fra start {km} km", "flights.highest": "høyest {m} moh", "flights.last": "sist {date}" };
FL.useText((key, vars) => (texts[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k]));

const data = {
  dataset: "flights", since: "2026-09-01",
  sites: { heia: { flights: 8, days: 2, pilots: 4, minutes: 94, maxDist: 7.5, maxAlt: 1400, last: "2026-10-18",
    months: { "2026-09": { flights: 5, days: 1, pilots: 3, minutes: 90 }, "2026-10": { flights: 3, days: 1, pilots: 1, minutes: 4 } } } },
};

test("only data in the expected shape is used", () => {
  assert.equal(FL.isFlightsData(data), true);
  assert.equal(FL.isFlightsData({ ...data, dataset: "live" }), false);
  assert.equal(FL.isFlightsData({ ...data, sites: { heia: { ...data.sites.heia, flights: "8" } } }), false);
  assert.equal(FL.isFlightsData({ ...data, sites: { heia: { ...data.sites.heia, months: { "<b>": { flights: 1, days: 1 } } } } }), false);
});

test("the last 12 months up to now, oldest first, empty months as nought", () => {
  const months = FL.lastMonths(data.sites.heia, Date.parse("2026-10-19T10:00:00Z"));
  assert.equal(months.length, 12);
  assert.equal(months[0].key, "2025-11");
  assert.deepEqual(months.slice(-2), [{ key: "2026-09", flights: 5, days: 1 }, { key: "2026-10", flights: 3, days: 1 }]);
  assert.equal(months[5].flights, 0);
});

test("the details line: farthest, highest and the last day, only the parts there are", () => {
  assert.equal(FL.detailText(data.sites.heia), "Lengst fra start 7,5 km · høyest 1400 moh · sist 18. okt. 2026");
  assert.equal(FL.detailText({ maxDist: 0, maxAlt: null, last: null }), "");
});
