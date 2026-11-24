// Tester for værstasjonene på sidene (src/assets/js/stations.js). Kjør med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom, html } from "./helpers/dom.mjs";

installDom();
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

test("bare data med forventet form brukes", () => {
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

test("vinden slik den er målt: retning med grader, middel og kast, ikke avrundet", () => {
  assert.equal(ST.windText(item()), "SV 225°, 4,4 m/s, kast 7,2");
  assert.equal(ST.windText(item({ wind: { dir: null, speed: 3.6, gust: null, min: null } })), "3,6 m/s");
  assert.equal(ST.windText(item({ wind: { dir: 10, speed: 0.3, gust: 1, min: 0 } })), "N 10°, 0,3 m/s, kast 1");
  assert.equal(ST.windText(item({ wind: null })), null);
  assert.equal(ST.value(7), "7");
  assert.equal(ST.value(1012.4), "1012,4");
  assert.equal(ST.value(null), "");
});

test("skalaen i grafen: 0 opp til et rundt tall over det høyeste kastet", () => {
  assert.deepEqual(ST.scale(3.1), { top: 4, step: 2 });
  assert.deepEqual(ST.scale(7.2), { top: 8, step: 2 });
  assert.deepEqual(ST.scale(12.4), { top: 15, step: 5 });
  assert.deepEqual(ST.scale(23), { top: 30, step: 10 });
});

test("hvor gammel målingen er, og gammel etter 30 minutter", () => {
  assert.equal(ST.ageText(item(), NOW), "for 3 min siden");
  assert.equal(ST.ageText(item({ time: "2026-10-18T15:19:50.000Z" }), NOW), "Nå nettopp");
  assert.equal(ST.isOld(item(), NOW), false);
  assert.equal(ST.isOld(item({ time: "2026-10-18T14:40:00.000Z" }), NOW), true);
  assert.match(ST.ageText(item({ time: "2026-10-18T14:40:00.000Z" }), NOW), /^Gammel måling, kl\. /);
  assert.equal(ST.ageText(item({ time: null }), NOW), "Ingen måling ennå");
});

test("temperatur, fuktighet, trykk og nedbør, bare de stasjonen har", () => {
  assert.equal(ST.otherText(item()), "6,25 °C · 81 % · 1012,4 hPa");
  assert.equal(ST.otherText(item({ humidity: null, pressure: null, rain: 1.2 })), "6,25 °C · 1,2 mm");
  assert.equal(ST.otherText(item({ temperature: null, humidity: null, pressure: null })), "");
});

test("lenken til stasjonen hos Holfuy", () => {
  assert.equal(ST.holfuyUrl(item()), "https://holfuy.com/en/weather/490");
});

// Historikkrader hvert 5. minutt fram til NOW: [tid, retning, fart, kast, min].
const hist = (n, f) => Array.from({ length: n }, (_, i) => { const t = NOW - (n - 1 - i) * 300000; return [new Date(t).toISOString(), ...f(i)]; });

test("endringen over en periode: middelvind, kast, dreining, kastspenn og høyeste kast", () => {
  const it = item({ history: hist(13, (i) => [350 + i * 2, 3 + i * 0.1, 5 + i * 0.2, 2]) });
  const ch = ST.change(it, 30);
  assert.equal(ch.speed, 0.6, "3,6 nå mot 3,0 for 30 minutter siden");
  assert.equal(ch.gust, 1.2);
  assert.equal(ch.dir, 12, "korteste vei over nord: 362 − 350");
  assert.equal(ch.maxGust, 7.4);
  assert.equal(ch.spread, 2.9, "kast 2,6–3,2 over middelvinden de siste 30 minuttene, 2,9 i snitt");
  assert.equal(ST.change(item({ history: [] }), 30), null);
});

test("en endring med pil og fortegn, ikke bare med farge", () => {
  assert.equal(ST.signed(0.8), "▲ +0,8");
  assert.equal(ST.signed(-0.4), "▼ −0,4");
  assert.equal(ST.signed(0), "● 0");
  assert.equal(ST.signed(null), "");
});

test("hvor jevn vinden er, og om den øker eller avtar", () => {
  assert.deepEqual(ST.character({ spread: 1.8, speed: 0.2 }), { kind: "steady", trend: "stable" });
  assert.deepEqual(ST.character({ spread: 3.1, speed: 1.2 }), { kind: "gusty", trend: "rising" });
  assert.deepEqual(ST.character({ spread: 5, speed: -0.9 }), { kind: "turbulent", trend: "falling" });
  assert.equal(ST.character({ spread: null, speed: 1 }), null);
});

test("varselet for stasjonens sted fra denne timen", () => {
  const times = [0, 1, 2, 3].map((h) => new Date(Date.parse("2026-10-18T15:00:00Z") + h * 3600000).toISOString());
  const forecast = { times, sites: { heia: [[40, 4, 7, 0], [45, 5, 8, 0], null, [50, 6, 9, 0]] } };
  const fc = ST.forecastFrom(forecast, "heia", NOW, 6);
  assert.deepEqual(fc.now, { time: Date.parse(times[0]), dir: 40, speed: 4, gust: 7 });
  assert.deepEqual(fc.next.map((p) => p.speed), [5, 6], "timer uten vind utelates");
  assert.equal(ST.forecastFrom(forecast, "dale", NOW, 6), null);
  assert.equal(ST.forecastFrom(null, "heia", NOW, 6), null);
});

test("laveste og høyeste temperatur de siste timene", () => {
  const it = item({ history: hist(13, (i) => [200, 4, 6, 2, 3 + i * 0.25]) });
  assert.deepEqual(ST.temperatureRange(it), { min: 3, max: 6, hours: 1 });
  assert.equal(ST.temperatureRange(item({ history: hist(13, () => [200, 4, 6, 2]) })), null, "eldre rader uten temperatur");
});

test("varselets tidligere timer til «Målt mot varslet», bare de før denne timen og med riktig form", () => {
  const times = [0, 1].map((h) => new Date(Date.parse("2026-10-18T15:00:00Z") + h * 3600000).toISOString());
  const past = { heia: [["2026-10-18T13:00:00Z", 30, 3, 6], ["2026-10-18T14:00:00Z", 35, "x", 6], ["2026-10-18T15:00:00Z", 40, 4, 7]] };
  const fc = ST.forecastFrom({ times, sites: { heia: [[40, 4, 7, 0], [45, 5, 8, 0]] }, past }, "heia", NOW, 6);
  assert.deepEqual(fc.past, [{ time: Date.parse("2026-10-18T13:00:00Z"), dir: 30, speed: 3, gust: 6 }]);
});

test("stasjonens side hos kilden: datatjenestens adresse, Holfuys for eldre Holfuy-elementer, ingen for MET", () => {
  assert.equal(ST.stationUrl(item({ url: "https://holfuy.com/en/weather/490" })), "https://holfuy.com/en/weather/490");
  assert.equal(ST.stationUrl(item({ source: "Holfuy" })), "https://holfuy.com/en/weather/490");
  assert.equal(ST.stationUrl(item({ id: "SN84970", source: "MET Norge", url: null })), null);
  assert.equal(ST.stationUrl(item({ url: "javascript:alert(1)", source: "MET Norge" })), null, "bare https-adresser");
});

test("METs stasjoner, som stort sett måler én gang i timen, er gamle etter 90 minutter; klubbens etter 30", () => {
  const at = (min) => new Date(NOW - min * 60000).toISOString();
  assert.equal(ST.isOld(item({ time: at(45) }), NOW), true, "Holfuy (ingen kilde oppgitt) etter 45 min");
  assert.equal(ST.isOld(item({ time: at(45), source: "Holfuy" }), NOW), true);
  assert.equal(ST.isOld(item({ time: at(45), source: "MET Norge", id: "SN84970" }), NOW), false);
  assert.equal(ST.isOld(item({ time: at(95), source: "MET Norge", id: "SN84970" }), NOW), true);
  assert.equal(ST.ageText(item({ time: at(45), source: "MET Norge" }), NOW), "for 45 min siden");
});

test("klubbens stasjoner først, så METs, hver i oppgitt rekkefølge", () => {
  const items = [item({ id: "SN2", source: "MET Norge" }), item({ id: 490, source: "Holfuy" }), item({ id: "SN1", source: "MET Norge" }), item({ id: 820 })];
  const g = ST.groups(items);
  assert.deepEqual(g.club.map((i) => i.id), [490, 820]);
  assert.deepEqual(g.met.map((i) => i.id), ["SN2", "SN1"]);
});

test("kartet tynner ut stasjoner når det er zoomet ut: klubbens alltid, så METs med sterkest vind, ingen overlappende", () => {
  const e = (id, source, x, speed) => ({ item: item({ id, source, wind: { dir: 200, speed, gust: null } }), latlng: { x, y: 0 } });
  const entries = [e("SN1", "MET Norge", 0, 3), e("SN2", "MET Norge", 10, 9), e(490, "Holfuy", 5, 1), e("SN3", "MET Norge", 100, 2)];
  const keep = ST.thinned(entries, 9, (ll) => ll);
  assert.deepEqual(entries.filter((x) => keep.has(x)).map((x) => x.item.id), [490, "SN3"], "SN1 og SN2 overlapper klubbens stasjon");
  assert.equal(ST.thinned(entries, 12, (ll) => ll).size, 4, "alle fra zoom 12");
});

test("markøren viser vinden i hele m/s med et hakk for retningen, eller temperaturen", () => {
  globalThis.FlyingSites.formatNumber = (n, d) => Number(n).toFixed(d || 0).replace(".", ",");
  const wind = html(ST.markerContent(item({ source: "Holfuy" }), NOW, "wind"));
  assert.match(wind, /station-marker__notch" data-dir="225"/, "retningen som data, dreiningen settes på elementet (ingen innebygd stil)");
  assert.doesNotMatch(wind, /style=/);
  assert.match(wind, /station-marker__dial">4</);
  assert.match(wind, /station-marker__label">4,4 <small>\(7,2\)<\/small>/);
  const temp = html(ST.markerContent(item({ source: "MET Norge", temperature: -2.4 }), NOW, "temp"));
  assert.match(temp, /station-marker__dial">-2°/);
  assert.match(temp, />MET</);
  assert.doesNotMatch(temp, /notch/);
});

test("hvor godt varselet traff: samler først, deretter middelvind, kast, retning og verste sektor", () => {
  Object.assign(texts, { "stations.vCollecting": "Samler {n}/{min}", "stations.vMean": "{days} d, {hours} t: {strength} ({mae})", "stations.vGust": "Kast {strength}",
    "stations.vDir": "Retning {pct} %", "stations.vSector": "Verst {dir} {v}", "stations.vStronger": "{v} sterkere", "stations.vWeaker": "{v} svakere", "stations.vAbout": "som varslet" });
  assert.deepEqual(ST.verifyLines({ hours: 5 }, 30), ["Samler 5/24"]);
  assert.deepEqual(ST.verifyLines({ hours: 200, bias: 1.4, mae: 2.1, gustBias: -0.2, dirHit: 0.78, sectors: { SW: { hours: 40, bias: 2.3 }, N: { hours: 9, bias: -0.5 } } }, 30),
    ["30 d, 200 t: 1,4 sterkere (2,1)", "Kast som varslet", "Retning 78 %", "Verst SV ▲ +2,3"]);
  assert.deepEqual(ST.verifyLines(null, 30), []);
});

test("en stasjon i nærheten: funnet etter stedet og avstanden, bare med forventet form", () => {
  const heia = { id: 490, site: "heia", near: [{ site: "hinnstein", km: 1.3 }] };
  assert.deepEqual(ST.nearOf(heia, "hinnstein"), { site: "hinnstein", km: 1.3 });
  assert.equal(ST.nearOf(heia, "elgen"), null);
  assert.equal(ST.nearOf({ id: 820 }, "hinnstein"), null);
  assert.equal(ST.nearOf({ near: [{ site: "hinnstein", km: "1,3" }] }, "hinnstein"), null);
});
