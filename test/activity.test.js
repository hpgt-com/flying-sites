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

test("the flight log: only the expected shape is used, and the rows carry the site's name", () => {
  const log = { dataset: "flight-log", flights: [
    { id: "ab12cd34ef56", day: "2026-10-19", site: "heia", start: "2026-10-19T10:04:00.000Z", end: "2026-10-19T10:22:00.000Z", minutes: 18, maxAlt: 1200, maxDist: 5.3, maxSpeed: 12.5, counted: true, points: [["2026-10-19T10:04:00.000Z", 68.8, 16.5, 500, 8, 1]] },
    { id: "0123456789ab", day: "2026-10-18", site: "ukjent", start: "2026-10-18T09:00:00.000Z", end: "2026-10-18T09:10:00.000Z", minutes: 10, maxAlt: 70, maxDist: 27.4, maxSpeed: 25, counted: false, points: [] },
  ] };
  assert.equal(AC.isFlightLog(log), true);
  assert.equal(AC.isFlightLog({ dataset: "flight-log", flights: [{ id: "<script>", site: "heia", start: "x", minutes: 1, points: [] }] }), false, "an id that is not hex is refused");
  assert.equal(AC.isFlightLog({ dataset: "flights", flights: [] }), false);
  const rows = AC.logRows(log, sites);
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.day, r.minutes]), [["ab12cd34ef56", "Heia", "2026-10-19", 18]], "a flight not counted (from before) is left out");
});
