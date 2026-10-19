// Tests for the page «Flyaktivitet» (src/assets/js/activity.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.FlyingSites = { lang: "nb", formatNumber: (n, d) => Number(n).toFixed(d || 0).replace(".", ",") };
await import("../src/assets/js/activity.js");
const AC = globalThis.FlyingSitesActivity;

const NOW = Date.parse("2026-10-19T12:00:00Z");
const data = {
  dataset: "flights", since: "2026-08-01",
  sites: {
    heia: { flights: 12, days: 5, pilots: 9, minutes: 600, maxDist: 8.2, maxAlt: 1500, last: "2026-10-19", months: { "2026-09": { flights: 7, days: 3 }, "2026-10": { flights: 5, days: 2 } },
      recent: { "2026-09-10": { flights: 2, minutes: 60 }, "2026-10-01": { flights: 2, minutes: 40 }, "2026-10-19": { flights: 3, minutes: 90 } } },
    sollifjellet: { flights: 4, days: 2, pilots: 4, minutes: 100, maxDist: 2, maxAlt: 900, last: "2026-10-18", months: { "2026-10": { flights: 4, days: 2 } },
      recent: { "2026-10-17": { flights: 1, minutes: 20 }, "2026-10-18": { flights: 3, minutes: 80 } } },
    gammel: { flights: 2, days: 1, pilots: 2, minutes: 30, maxDist: 1, maxAlt: null, last: "2026-08-02", months: { "2026-08": { flights: 2, days: 1 } }, recent: {} },
  },
};
const sites = [{ id: "heia", name: "Heia", url: "/flysteder/heia/" }, { id: "sollifjellet", name: "Sollifjellet", url: "/flysteder/sollifjellet/" }];

test("today and the last 30 days by the page's own clock, most flights first", () => {
  const s = AC.summarize(data, sites, NOW);
  assert.deepEqual(s.today.map((r) => [r.id, r.flights]), [["heia", 3]]);
  assert.equal(s.totals.today, 3);
  assert.deepEqual(s.recent.map((r) => [r.id, r.flights, r.days, r.minutes, r.last]), [["heia", 5, 2, 130, "2026-10-19"], ["sollifjellet", 4, 2, 100, "2026-10-18"]],
    "10 September is more than 30 days ago");
  assert.deepEqual(s.totals, { today: 3, recent: 9, recentSites: 2, recentMinutes: 230 });
  assert.deepEqual(s.all.map((r) => r.id), ["heia", "sollifjellet", "gammel"]);
  assert.equal(s.all[2].name, "gammel", "a site the page does not know is shown by its id");
  assert.equal(s.all[2].url, null);
  assert.deepEqual(s.months, { "2026-08": { flights: 2, days: 0 }, "2026-09": { flights: 7, days: 0 }, "2026-10": { flights: 9, days: 0 } });
});

test("the next day, today is empty and the window moves on", () => {
  const s = AC.summarize(data, sites, NOW + 86400000);
  assert.deepEqual(s.today, []);
  assert.equal(s.totals.recent, 9);
});
