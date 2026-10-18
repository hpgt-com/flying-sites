// Tests for the weather stations on the pages (src/assets/js/stations.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.FlyingSites = {
  opensNewTab: "(åpnes i ny fane)",
  DIRECTION_LABELS: { N: "N", NE: "NØ", E: "Ø", SE: "SØ", S: "S", SW: "SV", W: "V", NW: "NV" },
  formatNumber: (n, d) => Number(n).toFixed(d || 0).replace(".", ","),
};
await import("../src/assets/js/wind.js");
await import("../src/assets/js/stations.js");
const ST = globalThis.FlyingSitesStations;
const texts = { "stations.min": ", min {min}", "stations.speed": "{speed} m/s", "stations.gust": ", kast {gust}", "stations.noData": "Ingen måling ennå",
  "stations.old": "Gammel måling, kl. {time}", "stations.justNow": "Nå nettopp", "stations.minutesAgo": "for {n} min siden" };
ST.useText((key, vars) => texts[key].replace(/\{(\w+)\}/g, (_, k) => vars[k]));
globalThis.FlyingSitesWind.useText((key) => key);

const NOW = Date.parse("2026-10-18T15:20:00Z");
const item = (over = {}) => ({ id: 490, name: "HPGT Heia", site: "heia", lat: 68.8, lon: 16.5, time: "2026-10-18T15:17:00.000Z",
  wind: { dir: 225, speed: 4.4, gust: 7.2, min: 2 }, temperature: 6.25, humidity: 81, pressure: 1012.4, rain: 0, history: [], ...over });

test("only data in the expected shape is used", () => {
  assert.equal(ST.isStationsData({ dataset: "stations", items: [item()] }), true);
  assert.equal(ST.isStationsData({ dataset: "stations", items: [item({ time: null, wind: null })] }), true);
  assert.equal(ST.isStationsData({ dataset: "forecast", items: [] }), false);
  assert.equal(ST.isStationsData({ dataset: "stations", items: [item({ wind: { dir: "<b>", speed: 1, gust: 2 } })] }), false);
  assert.equal(ST.isStationsData({ dataset: "stations", items: [item({ history: [["t", 1, "x", 3]] })] }), false);
  assert.equal(ST.isStationsData({ dataset: "stations", items: [item({ history: [["t", 1, 2, 3, 1], ["t", 1, 2, 3]] })] }), true);
  assert.equal(ST.isStationsData({ dataset: "stations", items: [item({ history: [["t", 1, 2, 3, "1"]] })] }), false);
  assert.equal(ST.isStationsData({ dataset: "stations", items: [item({ pressure: "1012" })] }), false);
  assert.equal(ST.isStationsData({ dataset: "stations", items: [item({ name: 5 })] }), false);
  assert.equal(ST.isStationsData(null), false);
});

test("the wind as measured: direction with degrees, mean and gust, not rounded", () => {
  assert.equal(ST.windText(item()), "SV 225°, 4,4 m/s, kast 7,2");
  assert.equal(ST.windText(item({ wind: { dir: null, speed: 3.6, gust: null, min: null } })), "3,6 m/s");
  assert.equal(ST.windText(item({ wind: { dir: 10, speed: 0.3, gust: 1, min: 0 } })), "N 10°, 0,3 m/s, kast 1");
  assert.equal(ST.windText(item({ wind: null })), null);
  assert.equal(ST.value(7), "7");
  assert.equal(ST.value(1012.4), "1012,4");
  assert.equal(ST.value(null), "");
});

test("the chart scale: 0 up to a round number above the highest gust", () => {
  assert.deepEqual(ST.scale(3.1), { top: 4, step: 2 });
  assert.deepEqual(ST.scale(7.2), { top: 8, step: 2 });
  assert.deepEqual(ST.scale(12.4), { top: 15, step: 5 });
  assert.deepEqual(ST.scale(23), { top: 30, step: 10 });
});

test("how old the measurement is, and old after 30 minutes", () => {
  assert.equal(ST.ageText(item(), NOW), "for 3 min siden");
  assert.equal(ST.ageText(item({ time: "2026-10-18T15:19:50.000Z" }), NOW), "Nå nettopp");
  assert.equal(ST.isOld(item(), NOW), false);
  assert.equal(ST.isOld(item({ time: "2026-10-18T14:40:00.000Z" }), NOW), true);
  assert.match(ST.ageText(item({ time: "2026-10-18T14:40:00.000Z" }), NOW), /^Gammel måling, kl\. /);
  assert.equal(ST.ageText(item({ time: null }), NOW), "Ingen måling ennå");
});

test("temperature, humidity, pressure and rain, only those the station has", () => {
  assert.equal(ST.otherText(item()), "6,25 °C · 81 % · 1012,4 hPa");
  assert.equal(ST.otherText(item({ humidity: null, pressure: null, rain: 1.2 })), "6,25 °C · 1,2 mm");
  assert.equal(ST.otherText(item({ temperature: null, humidity: null, pressure: null })), "");
});

test("the link to the station at Holfuy", () => {
  assert.equal(ST.holfuyUrl(item()), "https://holfuy.com/en/weather/490");
});
