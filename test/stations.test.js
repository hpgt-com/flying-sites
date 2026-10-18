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
const texts = { "stations.calm": "Stille", "stations.speed": "{speed} m/s", "stations.gust": ", kast {gust}", "stations.noData": "Ingen måling ennå",
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
  assert.equal(ST.isStationsData({ dataset: "stations", items: [item({ name: 5 })] }), false);
  assert.equal(ST.isStationsData(null), false);
});

test("the wind as direction, mean and gust, rounded, and «Stille» below 0.5 m/s", () => {
  assert.equal(ST.windText(item()), "SV 4 m/s, kast 7");
  assert.equal(ST.windText(item({ wind: { dir: null, speed: 3.6, gust: null, min: null } })), "4 m/s");
  assert.equal(ST.windText(item({ wind: { dir: 10, speed: 0.3, gust: 1, min: 0 } })), "Stille");
  assert.equal(ST.windText(item({ wind: null })), null);
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
  assert.equal(ST.otherText(item()), "6,3 °C · 81 % · 1012 hPa");
  assert.equal(ST.otherText(item({ humidity: null, pressure: null, rain: 1.25 })), "6,3 °C · 1,3 mm");
  assert.equal(ST.otherText(item({ temperature: null, humidity: null, pressure: null })), "");
});

test("the link to the station at Holfuy", () => {
  assert.equal(ST.holfuyUrl(item()), "https://holfuy.com/en/weather/490");
});
