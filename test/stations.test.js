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

// History rows every 5 minutes up to NOW: [time, dir, speed, gust, min].
const hist = (n, f) => Array.from({ length: n }, (_, i) => { const t = NOW - (n - 1 - i) * 300000; return [new Date(t).toISOString(), ...f(i)]; });

test("the change over a period: mean wind, gust, turning, gust spread and highest gust", () => {
  const it = item({ history: hist(13, (i) => [350 + i * 2, 3 + i * 0.1, 5 + i * 0.2, 2]) });
  const ch = ST.change(it, 30);
  assert.equal(ch.speed, 0.6, "3,6 now against 3,0 30 minutes before");
  assert.equal(ch.gust, 1.2);
  assert.equal(ch.dir, 12, "the shortest way across north: 362 − 350");
  assert.equal(ch.maxGust, 7.4);
  assert.equal(ch.spread, 2.9, "gusts 2,6–3,2 above the mean wind over the last 30 minutes, 2,9 on average");
  assert.equal(ST.change(item({ history: [] }), 30), null);
});

test("a change with an arrow and a sign, not by colour alone", () => {
  assert.equal(ST.signed(0.8), "▲ +0,8");
  assert.equal(ST.signed(-0.4), "▼ −0,4");
  assert.equal(ST.signed(0), "● 0");
  assert.equal(ST.signed(null), "");
});

test("how even the wind is, and whether it rises or falls", () => {
  assert.deepEqual(ST.character({ spread: 1.8, speed: 0.2 }), { kind: "steady", trend: "stable" });
  assert.deepEqual(ST.character({ spread: 3.1, speed: 1.2 }), { kind: "gusty", trend: "rising" });
  assert.deepEqual(ST.character({ spread: 5, speed: -0.9 }), { kind: "turbulent", trend: "falling" });
  assert.equal(ST.character({ spread: null, speed: 1 }), null);
});

test("the forecast for the station's site from this hour", () => {
  const times = [0, 1, 2, 3].map((h) => new Date(Date.parse("2026-10-18T15:00:00Z") + h * 3600000).toISOString());
  const forecast = { times, sites: { heia: [[40, 4, 7, 0], [45, 5, 8, 0], null, [50, 6, 9, 0]] } };
  const fc = ST.forecastFrom(forecast, "heia", NOW, 6);
  assert.deepEqual(fc.now, { time: Date.parse(times[0]), dir: 40, speed: 4, gust: 7 });
  assert.deepEqual(fc.next.map((p) => p.speed), [5, 6], "hours without wind are left out");
  assert.equal(ST.forecastFrom(forecast, "dale", NOW, 6), null);
  assert.equal(ST.forecastFrom(null, "heia", NOW, 6), null);
});

test("the lowest and highest temperature over the last hours", () => {
  const it = item({ history: hist(13, (i) => [200, 4, 6, 2, 3 + i * 0.25]) });
  assert.deepEqual(ST.temperatureRange(it), { min: 3, max: 6, hours: 1 });
  assert.equal(ST.temperatureRange(item({ history: hist(13, () => [200, 4, 6, 2]) })), null, "older rows without temperature");
});

test("the forecast's past hours for «Målt mot varslet», only those before this hour and in the right shape", () => {
  const times = [0, 1].map((h) => new Date(Date.parse("2026-10-18T15:00:00Z") + h * 3600000).toISOString());
  const past = { heia: [["2026-10-18T13:00:00Z", 30, 3, 6], ["2026-10-18T14:00:00Z", 35, "x", 6], ["2026-10-18T15:00:00Z", 40, 4, 7]] };
  const fc = ST.forecastFrom({ times, sites: { heia: [[40, 4, 7, 0], [45, 5, 8, 0]] }, past }, "heia", NOW, 6);
  assert.deepEqual(fc.past, [{ time: Date.parse("2026-10-18T13:00:00Z"), dir: 30, speed: 3, gust: 6 }]);
});

test("the station's page at its source: the data service's address, Holfuy's for older Holfuy items, none for MET", () => {
  assert.equal(ST.stationUrl(item({ url: "https://holfuy.com/en/weather/490" })), "https://holfuy.com/en/weather/490");
  assert.equal(ST.stationUrl(item({ source: "Holfuy" })), "https://holfuy.com/en/weather/490");
  assert.equal(ST.stationUrl(item({ id: "SN84970", source: "MET Norge", url: null })), null);
  assert.equal(ST.stationUrl(item({ url: "javascript:alert(1)", source: "MET Norge" })), null, "only https addresses");
});

test("MET's stations, which mostly measure once an hour, are old only after 90 minutes; the club's after 30", () => {
  const at = (min) => new Date(NOW - min * 60000).toISOString();
  assert.equal(ST.isOld(item({ time: at(45) }), NOW), true, "Holfuy (no source given) after 45 min");
  assert.equal(ST.isOld(item({ time: at(45), source: "Holfuy" }), NOW), true);
  assert.equal(ST.isOld(item({ time: at(45), source: "MET Norge", id: "SN84970" }), NOW), false);
  assert.equal(ST.isOld(item({ time: at(95), source: "MET Norge", id: "SN84970" }), NOW), true);
  assert.equal(ST.ageText(item({ time: at(45), source: "MET Norge" }), NOW), "for 45 min siden");
});

test("the club's stations first, then MET's, each in the order given", () => {
  const items = [item({ id: "SN2", source: "MET Norge" }), item({ id: 490, source: "Holfuy" }), item({ id: "SN1", source: "MET Norge" }), item({ id: 820 })];
  const g = ST.groups(items);
  assert.deepEqual(g.club.map((i) => i.id), [490, 820]);
  assert.deepEqual(g.met.map((i) => i.id), ["SN2", "SN1"]);
});
