// Tests for the home page's logic without the DOM (src/assets/js/home-logic.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { t } from "../lib/i18n.js";

await import("../src/assets/js/wind.js");
await import("../src/assets/js/home-logic.js");
const W = globalThis.FlyingSitesWind;
const H = globalThis.FlyingSitesHome;
// Norwegian strings from the dictionary (src/_i18n/nb.json), as on the site.
const nb = (key, vars) => t(`js.${key}`, "nb", vars ?? {});
W.useText(nb);
H.useText(nb);
const rules = JSON.parse(fs.readFileSync(new URL("../src/_data/windRules.json", import.meta.url), "utf8"));
const LABELS = { N: "N", NE: "NØ", E: "Ø", SE: "SØ", S: "S", SW: "SV", W: "V", NW: "NV" };

const site = (o) => ({ id: "x", name: "X", places: [], primary: ["S"], possible: [], categories: ["PG"], level: "", ...o, searchKeys: H.searchKeys({ name: "X", places: [], ...o }) });

test("search: æ, ø and å in every common spelling, anywhere in the name or the place, never across the join", () => {
  assert.equal(H.searchKey("Kvæfjord"), "kvafjord");
  for (const q of ["kvaefjord", "kvafjord", "KVÆFJORD", "kvæ fjord"]) assert.equal(H.searchKey(q), "kvafjord", q);
  assert.equal(H.searchKey("Høgfjellet"), H.searchKey("hoegfjellet"));
  assert.equal(H.searchKey("Blåhatten"), H.searchKey("blaahatten"));
  assert.equal(H.searchKey("Sollifjellet – Harstad"), "sollifjelletharstad");
  const s = site({ name: "Sollifjellet", places: ["Harstad", "Troms"] });
  assert.ok(H.nameMatches(s, "solli"));
  assert.ok(H.nameMatches(s, "harstad"));
  assert.ok(H.nameMatches(s, ""));
  assert.ok(!H.nameMatches(s, "fjelletharstad"), "name and place are separate keys");
  assert.ok(!H.nameMatches(s, "narvik"));
});

test("filters: direction, category, level and the suggestion switch", () => {
  const none = { directions: [], level: "", category: "", q: "" };
  const s = site({ primary: ["S", "SW"], possible: ["W"], categories: ["PG"], level: "PP3" });
  assert.equal(H.matchSite(s, none), "match");
  assert.equal(H.matchSite(s, { ...none, directions: ["W"] }), "match", "a possible direction counts");
  assert.equal(H.matchSite(s, { ...none, directions: ["N", "E"] }), "no");
  assert.equal(H.matchSite(s, { ...none, category: "SPG" }), "no");
  assert.equal(H.matchSite(s, { ...none, level: "PP4" }), "match", "a PP4 pilot can fly a PP3 site");
  assert.equal(H.matchSite(s, { ...none, level: "PP2" }), "no");
  assert.equal(H.matchSite(site({ level: "" }), { ...none, level: "PP3" }), "unknown", "no level registered: shown separately");
  assert.equal(H.matchSite(s, { ...none, q: "y" }), "no");
  const no = { rating: "no" }, ok = { rating: "ok" };
  assert.equal(H.matchSite(s, none, { suggest: true, assessment: no }), "no");
  assert.equal(H.matchSite(s, none, { suggest: true, assessment: no, ignoreSuggest: true }), "match");
  assert.equal(H.matchSite(s, none, { suggest: true, assessment: ok }), "match");
  assert.equal(H.matchSite(s, none, { suggest: true, windAssessed: true }), "nowind", "no forecast for the site");
  assert.equal(H.matchSite(s, none, { suggest: false, windAssessed: true }), "match");
});

test("summary: the counts, the reasons, the most common direction and the median wind", () => {
  const a = (rating, dir, speed, gust, code) => ({ rating, wind: { dir, speed, gust }, codes: [code] });
  const assessments = { a: a("ok", 225, 4, 7, "ok"), b: a("high", 230, 9, 14, "gust"), c: a("no", 90, 3, null, "direction"), d: a("maybe", 220, 6, 9, "maybe") };
  const sum = H.summarize(assessments, ["a", "b", "c", "d", "e"], 10);
  assert.deepEqual(sum.counts, { ok: 1, maybe: 1, high: 1, no: 1 });
  assert.equal(sum.total, 4);
  assert.equal(sum.missing, 1, "e has no assessment");
  assert.equal(sum.filtered, true, "five of ten sites");
  assert.equal(sum.dir, "SW");
  assert.deepEqual([sum.speed, sum.minSpeed, sum.maxSpeed, sum.gust], [6, 3, 9, 14]);
  assert.equal(sum.highByGust, 1);
  assert.equal(H.summarize({}, ["a"], 1), null);
  // Why nothing fits: the most common stopper.
  const reason = (counts, extra) => H.noneReason({ counts, noByRain: 0, highByGust: 0, highByLocal: 0, ...extra }, rules);
  assert.equal(reason({ ok: 0, maybe: 0, high: 0, no: 3 }, { noByRain: 3 }), "Det er meldt regn.");
  assert.equal(reason({ ok: 0, maybe: 0, high: 3, no: 1 }, { highByGust: 2 }), `Kastene er for kraftige (grensen er ${rules.maxGust} m/s).`);
  assert.equal(reason({ ok: 0, maybe: 0, high: 3, no: 1 }), `Det er for mye vind (grensen er ${rules.maxWind} m/s, lavere på noen steder).`);
  assert.equal(reason({ ok: 0, maybe: 0, high: 1, no: 3 }), "Vindretningen passer ikke for startene våre.");
});

test("wind text: direction, wind, gust, rain and measured", () => {
  assert.equal(H.windText({ dir: 225, speed: 4.4, gust: 7.6 }, rules, LABELS), "SV 4 m/s, kast 8");
  assert.equal(H.windText({ dir: 0, speed: 2, gust: null }, rules, LABELS), "N 2 m/s, kast ukjent");
  assert.equal(H.windText({ dir: 90, speed: 3, gust: 5, rain: rules.rainMaybe, measured: true }, rules, LABELS), `Ø 3 m/s, kast 5, regn ${W.formatRain(rules.rainMaybe)} (målt)`);
});

test("times: when the forecast was fetched, the hour chosen, the strip's day and the hour labels", () => {
  const now = Date.parse("2026-10-09T10:30:00Z"); // 12:30 in Norway
  assert.equal(H.whenText("2026-10-09T06:47:00Z", now), "i dag kl. 08.47");
  assert.equal(H.whenText("2026-10-07T21:47:00Z", now), "07.10 kl. 23.47");
  const forecast = { times: ["2026-10-09T15:00:00Z", "2026-10-10T07:00:00Z", "2026-10-11T11:00:00Z"] };
  assert.equal(H.whenLabel(forecast, 0, now), "kl. 17.00");
  assert.equal(H.whenLabel(forecast, 1, now), "i morgen kl. 09.00");
  assert.equal(H.whenLabel(forecast, 2, now), "søn. kl. 13.00");
  assert.equal(H.stripDate(Date.parse("2026-10-09T17:59:00Z")), "2026-10-09", "19:59 in Norway: still today");
  assert.equal(H.stripDate(Date.parse("2026-10-09T18:00:00Z")), "2026-10-10", "20:00 in Norway: tomorrow");
  assert.equal(H.hourLabel(Date.parse("2026-10-09T06:00:00Z")), "08");
  assert.equal(H.windowText({ start: Date.parse("2026-10-09T06:00:00Z"), end: Date.parse("2026-10-09T11:00:00Z"), rating: "ok" }), "08–13 kan passe");
  assert.equal(H.windowText({ start: Date.parse("2026-10-09T20:00:00Z"), end: Date.parse("2026-10-09T22:00:00Z"), rating: "maybe" }), "22–24 usikkert", "to midnight");
});

test("next window: the earliest start, «Kan passe» before «Usikkert» at the same hour, as a sentence", () => {
  const now = Date.parse("2026-10-09T10:30:00Z");
  const h = (iso) => Date.parse(iso);
  const dale = { id: "dale", name: "Dale" }, heia = { id: "heia", name: "Heia" };
  const windows = {
    dale: { "2026-10-10": [{ start: h("2026-10-10T06:00:00Z"), end: h("2026-10-10T10:00:00Z"), rating: "maybe" }] },
    heia: { "2026-10-09": [{ start: h("2026-10-09T05:00:00Z"), end: h("2026-10-09T08:00:00Z"), rating: "ok" }], "2026-10-10": [{ start: h("2026-10-10T06:00:00Z"), end: h("2026-10-10T09:00:00Z"), rating: "ok" }] },
  };
  const best = H.nextWindow([dale, heia], now, (s) => windows[s.id]);
  assert.deepEqual({ site: best.site.id, rating: best.rating }, { site: "heia", rating: "ok" }, "this morning's window is past; tomorrow 08 at both, ok wins");
  assert.equal(H.nextWindowText(best, now), "Neste vindu: Heia i morgen kl. 08, kan passe.");
  assert.equal(H.nextWindowText(H.nextWindow([dale], h("2026-10-09T05:00:00Z"), (s) => windows[s.id]), h("2026-10-09T05:00:00Z")), "Neste vindu: Dale i morgen kl. 08, usikkert.");
  assert.equal(H.nextWindowText(H.nextWindow([dale], now, () => ({ "2026-10-11": [{ start: h("2026-10-11T07:00:00Z"), end: h("2026-10-11T09:00:00Z"), rating: "ok" }] })), now), "Neste vindu: Dale søndag kl. 09, kan passe.");
  assert.equal(H.nextWindowText(null, now), "Ingen vindu i varselet de neste dagene.");
  assert.equal(H.nextWindow([dale], h("2026-10-12T00:00:00Z"), (s) => windows[s.id]), null);
});

test("the hash: the state written and read back, nothing when the view is plain", () => {
  const plain = { filter: { directions: [], level: "", category: "", q: "" }, windSlot: "0", windOn: true, suggest: false, site: null };
  assert.equal(H.hashFor(plain), "");
  const state = { filter: { directions: ["W", "NW"], level: "PP3", category: "PG", q: " solli " }, windSlot: "3", windOn: true, suggest: true, site: "sollifjellet" };
  const hash = H.hashFor(state);
  assert.equal(hash, "direction=W%2CNW&level=PP3&category=PG&wind=3&forslag=1&q=solli&site=sollifjellet");
  assert.deepEqual(H.parseHash("#" + hash), { directions: ["W", "NW"], level: "PP3", category: "PG", wind: "3", suggest: true, q: "solli", site: "sollifjellet" });
  assert.equal(H.hashFor({ ...state, windOn: false }), "direction=W%2CNW&level=PP3&category=PG&forslag=1&q=solli&site=sollifjellet", "no time without a usable forecast");
  assert.equal(H.hashFor({ ...state, windSlot: "off" }), "direction=W%2CNW&level=PP3&category=PG&wind=off&q=solli&site=sollifjellet", "no suggestion with the wind off");
  assert.deepEqual(H.parseHash("direction=W,XX,,N&wind=tomorrow"), { directions: ["W", "N"], level: "", category: "", wind: "tomorrow", suggest: false, q: "", site: null }, "unknown directions dropped");
  assert.deepEqual(H.parseHash(""), { directions: [], level: "", category: "", wind: "0", suggest: false, q: "", site: null });
});
