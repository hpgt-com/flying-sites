// Tests for the wind assessment (src/assets/js/wind.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { t } from "../lib/i18n.js";

await import("../src/assets/js/wind.js");
const W = globalThis.FlyingSitesWind;
// Norwegian strings from the dictionary (src/_i18n/nb.json), as on the site.
W.useText((key, vars) => t(`js.${key}`, "nb", vars ?? {}));
const rules = JSON.parse(fs.readFileSync(new URL("../src/_data/windRules.json", import.meta.url), "utf8"));

const site = { primary: ["SW", "W"], possible: ["S"], maxWind: null };
const rate = (wind, s = site) => W.rateWind(s, wind, rules);

// Forecast with one value per hour from `start` (ISO, UTC).
function hourly(start, hours) {
  const t0 = Date.parse(start);
  return Array.from({ length: hours }, (_, i) => new Date(t0 + i * 3600000).toISOString().replace(".000Z", "Z"));
}

test("main direction, moderate wind and small gusts give «Kan passe»", () => {
  assert.deepEqual(rate({ dir: 247, speed: 4, gust: 6 }), { rating: "ok", reasons: [], codes: [] });
});

test("missing gusts never improve the assessment", () => {
  const r = rate({ dir: 247, speed: 6, gust: null });
  assert.equal(r.rating, "maybe");
  assert.match(r.reasons.join(), /mangler kast/);
});

test("gusts more than maxGustSpread above the mean wind give «Usikkert»", () => {
  assert.equal(rate({ dir: 247, speed: 3, gust: 3 + rules.maxGustSpread + 1 }).rating, "maybe");
});

test("gusts above maxGust give «For mye vind» even with low mean wind", () => {
  assert.equal(rate({ dir: 247, speed: 5, gust: rules.maxGust + 1 }).rating, "high");
});

test("mean wind above the common limit gives «For mye vind»", () => {
  assert.equal(rate({ dir: 247, speed: rules.maxWind + 0.5, gust: rules.maxWind + 1 }).rating, "high");
});

test("the site's own limit is used instead of the common limit", () => {
  const local = { ...site, maxWind: 5 };
  const r = rate({ dir: 247, speed: 6, gust: 7 }, local);
  assert.equal(r.rating, "high");
  assert.match(r.reasons[0], /grensen for stedet \(5 m\/s\)/);
  assert.equal(rate({ dir: 247, speed: 4.5, gust: 6 }, local).rating, "ok");
});

test("light wind gives «Usikkert», because the direction is uncertain", () => {
  const r = rate({ dir: 247, speed: rules.minWind - 0.5, gust: 2 });
  assert.equal(r.rating, "maybe");
  assert.match(r.reasons.join(), /Svak vind/);
});

test("possible direction gives «Usikkert», wrong direction gives «Passer ikke»", () => {
  assert.equal(rate({ dir: 180, speed: 4, gust: 5 }).rating, "maybe");
  assert.equal(rate({ dir: 90, speed: 4, gust: 5 }).rating, "no");
});

test("a direction near the edge of a sector that is not a main direction gives «Usikkert»", () => {
  // SW is 225°, the sector runs from 202.5° to 247.5°, and W (270°) is also a main direction.
  assert.equal(rate({ dir: 205, speed: 4, gust: 5 }).rating, "maybe"); // near S (possible)
  assert.equal(rate({ dir: 250, speed: 4, gust: 5 }).rating, "ok"); // between SW and W, both main directions
  assert.equal(rate({ dir: 288, speed: 4, gust: 5 }).rating, "maybe"); // near NW (not suitable)
  assert.equal(rate({ dir: 225, speed: 4, gust: 5 }).rating, "ok");
});

test("directions around north are handled correctly (355° and 5° are N)", () => {
  assert.equal(W.directionCode(355), "N");
  assert.equal(W.directionCode(5), "N");
  assert.equal(W.directionCode(-10), "N");
  assert.equal(W.directionCode(360), "N");
});

test("rain from rainNo gives «Passer ikke», even when the wind is suitable", () => {
  const r = rate({ dir: 247, speed: 4, gust: 6, rain: rules.rainNo });
  assert.equal(r.rating, "no");
  assert.match(r.reasons[0], /^Regn meldt \(0,5 mm\)$/);
});

test("light precipitation gives at most «Usikkert», and no or missing precipitation changes nothing", () => {
  const r = rate({ dir: 247, speed: 4, gust: 6, rain: rules.rainMaybe });
  assert.equal(r.rating, "maybe");
  assert.match(r.reasons.join(), /Litt nedbør meldt \(0,1 mm\)/);
  assert.equal(rate({ dir: 247, speed: 4, gust: 6, rain: 0 }).rating, "ok");
  assert.equal(rate({ dir: 247, speed: 4, gust: 6, rain: null }).rating, "ok");
});

test("too much wind takes precedence over rain", () => {
  assert.equal(rate({ dir: 247, speed: rules.maxWind + 1, gust: 12, rain: 2 }).rating, "high");
});

test("precipitation is read from the forecast, and an older forecast without precipitation gives rain null", () => {
  const forecast = { times: ["2026-10-05T12:00:00Z"], sites: { a: [[247, 4, 6, 1.2]], b: [[247, 4, 6]] } };
  assert.equal(W.windAt(forecast, "a", 0).rain, 1.2);
  assert.equal(W.windAt(forecast, "b", 0).rain, null);
  assert.equal(W.formatRain(1.24), "1,2 mm");
});

test("a forecast older than maxForecastAgeHours is too old", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  const fetched = (h) => ({ fetched: new Date(now - h * 3600000).toISOString() });
  assert.equal(W.isStale(fetched(1), rules, now), false);
  assert.equal(W.isStale(fetched(rules.maxForecastAgeHours + 0.1), rules, now), true);
  assert.equal(W.isStale({ fetched: "tull" }, rules, now), true);
});

test("«nå» finds the current hour, and +3/+6 hours from it", () => {
  const times = hourly("2026-10-04T10:00:00Z", 48);
  const now = Date.parse("2026-10-04T12:40:00Z");
  assert.equal(W.slotIndex(times, "0", now), 2);
  assert.equal(W.slotIndex(times, "3", now), 5);
  assert.equal(W.slotIndex(times, "6", now), 8);
  assert.equal(W.slotIndex(times, "off", now), -1);
});

test("the timeline on the home page: any number of hours from now, as far as the forecast goes", () => {
  const times = hourly("2026-10-04T10:00:00Z", 48);
  const now = Date.parse("2026-10-04T12:40:00Z");
  assert.equal(W.slotIndex(times, "20", now), 22);
  assert.equal(W.slotIndex(times, "45", now), 47);
  assert.equal(W.slotIndex(times, "46", now), -1);
});

test("«nå» moves to the next hour when the hour changes (the home page then redraws)", () => {
  const times = hourly("2026-10-04T10:00:00Z", 48);
  // 11:50 and 12:10 UTC: same choice, but a different hour in the forecast.
  assert.equal(W.slotIndex(times, "0", Date.parse("2026-10-04T11:50:00Z")), 1);
  assert.equal(W.slotIndex(times, "0", Date.parse("2026-10-04T12:10:00Z")), 2);
  assert.equal(W.slotIndex(times, "3", Date.parse("2026-10-04T11:50:00Z")), 4);
  assert.equal(W.slotIndex(times, "3", Date.parse("2026-10-04T12:10:00Z")), 5);
});

test("an expired forecast gives no «nå», even though the last hour is in the past", () => {
  const times = hourly("2026-10-01T10:00:00Z", 48);
  assert.equal(W.slotIndex(times, "0", Date.parse("2026-10-04T12:00:00Z")), -1);
  // The last hour is valid for one hour, no longer.
  const last = Date.parse(times.at(-1));
  assert.equal(W.slotIndex(times, "0", last + 30 * 60000), 47);
  assert.equal(W.slotIndex(times, "0", last + 61 * 60000), -1);
  assert.equal(W.slotIndex(times, "3", last), -1);
});

test("«i morgen kl. 12» is Norwegian time, also just after midnight", () => {
  // Summer time (UTC+2): 12:00 Norwegian time is 10:00 UTC.
  const summer = hourly("2026-06-10T12:00:00Z", 48);
  const s = W.slotIndex(summer, "tomorrow", Date.parse("2026-06-10T22:30:00Z")); // 00:30 Norwegian time on 11 June
  assert.equal(summer[s], "2026-06-12T10:00:00Z");
  const s2 = W.slotIndex(summer, "tomorrow", Date.parse("2026-06-10T21:30:00Z")); // 23:30 Norwegian time on 10 June
  assert.equal(summer[s2], "2026-06-11T10:00:00Z");
  // Winter time (UTC+1): 12:00 Norwegian time is 11:00 UTC.
  const winter = hourly("2026-12-01T00:00:00Z", 48);
  const w = W.slotIndex(winter, "tomorrow", Date.parse("2026-12-01T23:15:00Z")); // 00:15 Norwegian time on 2 December
  assert.equal(w, -1); // 3 December at 12:00 is outside the 48 hours
  const w2 = W.slotIndex(winter, "tomorrow", Date.parse("2026-12-01T08:00:00Z"));
  assert.equal(winter[w2], "2026-12-02T11:00:00Z");
});

test("«i morgen kl. 12» across the switch to winter time", () => {
  // The clocks go back in the night to 25 October 2026. 12:00 Norwegian time on 25 Oct is 11:00 UTC.
  const times = hourly("2026-10-24T00:00:00Z", 48);
  const i = W.slotIndex(times, "tomorrow", Date.parse("2026-10-24T09:00:00Z"));
  assert.equal(times[i], "2026-10-25T11:00:00Z");
});

test("invalid wind is never «Kan passe»", () => {
  // Comparisons with undefined, NaN or a string are always false, so such values used to slip past every limit.
  for (const speed of [undefined, null, NaN, Infinity, "5", -1]) {
    const r = rate({ dir: 247, speed, gust: 3 });
    assert.equal(r.rating, "no", `speed ${String(speed)}`);
    assert.deepEqual(r.codes, ["noData"]);
    assert.match(r.reasons.join(), /Mangler gyldige vinddata/);
  }
  for (const dir of [undefined, null, NaN, "247", -10, 400]) {
    assert.equal(rate({ dir, speed: 4, gust: 6 }).rating, "no", `dir ${String(dir)}`);
  }
  assert.equal(rate(null).rating, "no");
});

test("invalid gusts and rain count as missing", () => {
  // A broken gust is treated like a missing one: at best «Usikkert», never «Kan passe».
  for (const gust of [NaN, "6", -2]) {
    const r = rate({ dir: 247, speed: 4, gust });
    assert.equal(r.rating, "maybe", `gust ${String(gust)}`);
    assert.deepEqual(r.codes, ["noGust"]);
  }
  // Broken precipitation is ignored, like missing precipitation.
  assert.equal(rate({ dir: 247, speed: 4, gust: 6, rain: NaN }).rating, "ok");
});

test("hours without valid wind give no wind, so the page shows «Ingen varsel»", () => {
  const forecast = { sites: { a: [[247, null, 5, 0], [null, 4, 5, 0], [247, 4, null, null], [247, 4, 5, -1]] } };
  assert.equal(W.windAt(forecast, "a", 0), null);
  assert.equal(W.windAt(forecast, "a", 1), null);
  assert.deepEqual(W.windAt(forecast, "a", 2), { dir: 247, speed: 4, gust: null, rain: null });
  assert.deepEqual(W.windAt(forecast, "a", 3), { dir: 247, speed: 4, gust: 5, rain: null });
});

test("times are shown in Norwegian time", () => {
  assert.equal(W.formatClock(Date.parse("2026-06-10T22:05:00Z")), "00.05");
  assert.equal(W.formatClock(Date.parse("2026-12-10T08:30:00Z")), "09.30");
});

test("sites without a forecast or with gaps in it give no wind", () => {
  const forecast = { sites: { a: [[200, 4, 5], null] } };
  assert.deepEqual(W.windAt(forecast, "a", 0), { dir: 200, speed: 4, gust: 5, rain: null });
  assert.equal(W.windAt(forecast, "a", 1), null);
  assert.equal(W.windAt(forecast, "b", 0), null);
  assert.equal(W.windAt(forecast, "a", -1), null);
});

test("sunrise and sunset in Harstad, with midnight sun and polar night", () => {
  const clock = (ms) => W.formatClock(ms);
  const oct = W.sunTimes("2026-10-09", 68.8, 16.3);
  // Around 07:37 and 17:45 on this day. The formula is accurate to a couple of minutes, so the test allows 4.
  assert.ok(Math.abs(oct.rise - Date.parse("2026-10-09T05:37:00Z")) < 4 * 60000, clock(oct.rise));
  assert.ok(Math.abs(oct.set - Date.parse("2026-10-09T15:45:00Z")) < 4 * 60000, clock(oct.set));
  assert.deepEqual(W.sunTimes("2026-06-21", 68.8, 16.3), { polar: "day" });
  assert.deepEqual(W.sunTimes("2026-12-15", 68.8, 16.3), { polar: "night" });
  assert.equal(W.sunText("2026-12-15", 68.8, 16.3), "Mørketid, sola kommer ikke over horisonten.");
  assert.match(W.sunText("2026-10-09", 68.8, 16.3), /^Sola opp 07\.3\d, ned 17\.4\d\.$/);
});

test("the day plan merges hours with the same assessment and skips dark hours", () => {
  const times = hourly("2026-10-09T00:00:00Z", 24);
  const good = [247, 4, 6, 0], unsure = [247, 6, null, 0], wrong = [90, 4, 6, 0];
  // Norwegian time is UTC+2 in October. The sun is up roughly 07:37–17:46 in Harstad.
  const rows = times.map((t, i) => (i >= 8 && i < 11 ? good : i === 11 ? unsure : i >= 12 && i < 14 ? good : wrong));
  rows[2] = good; // 04:00 Norwegian time, dark
  const forecast = { times, sites: { x: rows } };
  const days = W.dayWindows(forecast, { id: "x", ...site }, rules, 68.8, 16.3);
  assert.deepEqual(Object.keys(days), ["2026-10-09"]);
  assert.deepEqual(days["2026-10-09"].map((w) => [W.formatClock(w.start), W.formatClock(w.end), w.rating]), [
    ["10.00", "13.00", "ok"], ["13.00", "14.00", "maybe"], ["14.00", "16.00", "ok"],
  ]);
  const first = days["2026-10-09"][0];
  assert.deepEqual([first.dir, first.min, first.max, first.gust], ["SW", 4, 4, 6]);
  assert.equal(days["2026-10-09"][1].gust, null); // gusts missing from the forecast
});

test("a forecast from the data service is used only when it is newer, well formed and has every launch", () => {
  const page = { fetched: "2026-10-18T12:00:00Z", times: ["2026-10-18T12:00:00Z"], sites: { a: [[200, 5, 9, 0]], b: [null] } };
  const live = { fetched: "2026-10-18T15:00:00Z", times: ["2026-10-18T15:00:00Z", "2026-10-18T16:00:00Z"], sites: { a: [[200, 5, 9, 0], null], b: [[180, 3, null, null], [180, 3, 6, 0.2]] } };
  assert.equal(W.isNewerForecast(live, page), true);
  assert.equal(W.isNewerForecast(live, null), true);
  assert.equal(W.isNewerForecast({ ...live, fetched: "2026-10-18T11:00:00Z" }, page), false, "older");
  assert.equal(W.isNewerForecast({ ...live, sites: { a: live.sites.a } }, page), false, "a launch missing");
  assert.equal(W.isNewerForecast({ ...live, sites: { ...live.sites, b: [[180, 3, 6, 0]] } }, page), false, "wrong length");
  assert.equal(W.isNewerForecast({ ...live, sites: { ...live.sites, b: [["<b>", 3, 6, 0], null] } }, page), false, "text in a row");
  assert.equal(W.isNewerForecast({ error: "no forecast yet" }, page), false);
  assert.equal(W.isNewerForecast(null, page), false);
});
