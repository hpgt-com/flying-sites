// Tester for vindvurderingen (src/assets/js/wind.js). Kjøres med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

await import("../src/assets/js/wind.js");
const W = globalThis.FlyingSitesWind;
const rules = JSON.parse(fs.readFileSync(new URL("../src/_data/windRules.json", import.meta.url), "utf8"));

const site = { primary: ["SW", "W"], possible: ["S"], maxWind: null };
const rate = (wind, s = site) => W.rateWind(s, wind, rules);

// Varsel med én verdi per time fra `start` (ISO, UTC).
function hourly(start, hours) {
  const t0 = Date.parse(start);
  return Array.from({ length: hours }, (_, i) => new Date(t0 + i * 3600000).toISOString().replace(".000Z", "Z"));
}

test("hovedretning, passe vind og små kast gir «Kan passe»", () => {
  assert.deepEqual(rate({ dir: 247, speed: 4, gust: 6 }), { rating: "ok", reasons: [] });
});

test("manglende kast gjør aldri vurderingen bedre", () => {
  const r = rate({ dir: 247, speed: 6, gust: null });
  assert.equal(r.rating, "maybe");
  assert.match(r.reasons.join(), /mangler kast/);
});

test("kast mer enn maxGustSpread over middelvinden gir «Usikkert»", () => {
  assert.equal(rate({ dir: 247, speed: 3, gust: 3 + rules.maxGustSpread + 1 }).rating, "maybe");
});

test("kast over maxGust gir «For mye vind» selv med lav middelvind", () => {
  assert.equal(rate({ dir: 247, speed: 5, gust: rules.maxGust + 1 }).rating, "high");
});

test("middelvind over felles grense gir «For mye vind»", () => {
  assert.equal(rate({ dir: 247, speed: rules.maxWind + 0.5, gust: rules.maxWind + 1 }).rating, "high");
});

test("stedets egen grense brukes i stedet for felles grense", () => {
  const local = { ...site, maxWind: 5 };
  const r = rate({ dir: 247, speed: 6, gust: 7 }, local);
  assert.equal(r.rating, "high");
  assert.match(r.reasons[0], /grensen for stedet \(5 m\/s\)/);
  assert.equal(rate({ dir: 247, speed: 4.5, gust: 6 }, local).rating, "ok");
});

test("svak vind gir «Usikkert», fordi retningen er usikker", () => {
  const r = rate({ dir: 247, speed: rules.minWind - 0.5, gust: 2 });
  assert.equal(r.rating, "maybe");
  assert.match(r.reasons.join(), /Svak vind/);
});

test("mulig retning gir «Usikkert», feil retning gir «Passer ikke»", () => {
  assert.equal(rate({ dir: 180, speed: 4, gust: 5 }).rating, "maybe");
  assert.equal(rate({ dir: 90, speed: 4, gust: 5 }).rating, "no");
});

test("retning nær kanten mot en sektor som ikke er hovedretning gir «Usikkert»", () => {
  // SV er 225°, sektoren går fra 202,5° til 247,5°, og V (270°) er også hovedretning.
  assert.equal(rate({ dir: 205, speed: 4, gust: 5 }).rating, "maybe"); // nær S (mulig)
  assert.equal(rate({ dir: 250, speed: 4, gust: 5 }).rating, "ok"); // mellom SV og V, begge hovedretning
  assert.equal(rate({ dir: 288, speed: 4, gust: 5 }).rating, "maybe"); // nær NV (ikke egnet)
  assert.equal(rate({ dir: 225, speed: 4, gust: 5 }).rating, "ok");
});

test("retning rundt nord regnes riktig (355° og 5° er N)", () => {
  assert.equal(W.directionCode(355), "N");
  assert.equal(W.directionCode(5), "N");
  assert.equal(W.directionCode(-10), "N");
  assert.equal(W.directionCode(360), "N");
});

test("regn fra rainNo gir «Passer ikke», også når vinden passer", () => {
  const r = rate({ dir: 247, speed: 4, gust: 6, rain: rules.rainNo });
  assert.equal(r.rating, "no");
  assert.match(r.reasons[0], /^Regn meldt \(0,5 mm\)$/);
});

test("litt nedbør gir høyst «Usikkert», og ingen eller manglende nedbør endrer ingenting", () => {
  const r = rate({ dir: 247, speed: 4, gust: 6, rain: rules.rainMaybe });
  assert.equal(r.rating, "maybe");
  assert.match(r.reasons.join(), /Litt nedbør meldt \(0,1 mm\)/);
  assert.equal(rate({ dir: 247, speed: 4, gust: 6, rain: 0 }).rating, "ok");
  assert.equal(rate({ dir: 247, speed: 4, gust: 6, rain: null }).rating, "ok");
});

test("for mye vind går foran regn", () => {
  assert.equal(rate({ dir: 247, speed: rules.maxWind + 1, gust: 12, rain: 2 }).rating, "high");
});

test("nedbør leses fra varselet, og eldre varsel uten nedbør gir rain null", () => {
  const forecast = { times: ["2026-10-05T12:00:00Z"], sites: { a: [[247, 4, 6, 1.2]], b: [[247, 4, 6]] } };
  assert.equal(W.windAt(forecast, "a", 0).rain, 1.2);
  assert.equal(W.windAt(forecast, "b", 0).rain, null);
  assert.equal(W.formatRain(1.24), "1,2 mm");
});

test("varsel eldre enn maxForecastAgeHours er for gammelt", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  const fetched = (h) => ({ fetched: new Date(now - h * 3600000).toISOString() });
  assert.equal(W.isStale(fetched(1), rules, now), false);
  assert.equal(W.isStale(fetched(rules.maxForecastAgeHours + 0.1), rules, now), true);
  assert.equal(W.isStale({ fetched: "tull" }, rules, now), true);
});

test("«nå» finner timen som gjelder, og +3/+6 timer fra den", () => {
  const times = hourly("2026-10-04T10:00:00Z", 48);
  const now = Date.parse("2026-10-04T12:40:00Z");
  assert.equal(W.slotIndex(times, "0", now), 2);
  assert.equal(W.slotIndex(times, "3", now), 5);
  assert.equal(W.slotIndex(times, "6", now), 8);
  assert.equal(W.slotIndex(times, "off", now), -1);
});

test("«nå» flytter seg til neste time ved timeskifte (forsiden tegner da på nytt)", () => {
  const times = hourly("2026-10-04T10:00:00Z", 48);
  // 11.50 og 12.10 UTC: samme valg, men en annen time i varselet.
  assert.equal(W.slotIndex(times, "0", Date.parse("2026-10-04T11:50:00Z")), 1);
  assert.equal(W.slotIndex(times, "0", Date.parse("2026-10-04T12:10:00Z")), 2);
  assert.equal(W.slotIndex(times, "3", Date.parse("2026-10-04T11:50:00Z")), 4);
  assert.equal(W.slotIndex(times, "3", Date.parse("2026-10-04T12:10:00Z")), 5);
});

test("utløpt varsel gir ingen «nå», selv om siste time ligger i fortiden", () => {
  const times = hourly("2026-10-01T10:00:00Z", 48);
  assert.equal(W.slotIndex(times, "0", Date.parse("2026-10-04T12:00:00Z")), -1);
  // Siste time gjelder i én time, ikke lenger.
  const last = Date.parse(times.at(-1));
  assert.equal(W.slotIndex(times, "0", last + 30 * 60000), 47);
  assert.equal(W.slotIndex(times, "0", last + 61 * 60000), -1);
  assert.equal(W.slotIndex(times, "3", last), -1);
});

test("«i morgen kl. 12» er norsk tid, også like etter midnatt", () => {
  // Sommertid (UTC+2): kl. 12 norsk tid er 10:00 UTC.
  const summer = hourly("2026-06-10T12:00:00Z", 48);
  const s = W.slotIndex(summer, "tomorrow", Date.parse("2026-06-10T22:30:00Z")); // 00.30 norsk tid 11. juni
  assert.equal(summer[s], "2026-06-12T10:00:00Z");
  const s2 = W.slotIndex(summer, "tomorrow", Date.parse("2026-06-10T21:30:00Z")); // 23.30 norsk tid 10. juni
  assert.equal(summer[s2], "2026-06-11T10:00:00Z");
  // Vintertid (UTC+1): kl. 12 norsk tid er 11:00 UTC.
  const winter = hourly("2026-12-01T00:00:00Z", 48);
  const w = W.slotIndex(winter, "tomorrow", Date.parse("2026-12-01T23:15:00Z")); // 00.15 norsk tid 2. des
  assert.equal(w, -1); // 3. des kl. 12 er utenfor de 48 timene
  const w2 = W.slotIndex(winter, "tomorrow", Date.parse("2026-12-01T08:00:00Z"));
  assert.equal(winter[w2], "2026-12-02T11:00:00Z");
});

test("«i morgen kl. 12» over overgangen til vintertid", () => {
  // Natt til 25. oktober 2026 går klokka tilbake. Kl. 12 norsk tid 25. okt er 11:00 UTC.
  const times = hourly("2026-10-24T00:00:00Z", 48);
  const i = W.slotIndex(times, "tomorrow", Date.parse("2026-10-24T09:00:00Z"));
  assert.equal(times[i], "2026-10-25T11:00:00Z");
});

test("klokkeslett vises i norsk tid", () => {
  assert.equal(W.formatClock(Date.parse("2026-06-10T22:05:00Z")), "00.05");
  assert.equal(W.formatClock(Date.parse("2026-12-10T08:30:00Z")), "09.30");
});

test("steder uten varsel eller med hull i varselet gir ingen vind", () => {
  const forecast = { sites: { a: [[200, 4, 5], null] } };
  assert.deepEqual(W.windAt(forecast, "a", 0), { dir: 200, speed: 4, gust: 5, rain: null });
  assert.equal(W.windAt(forecast, "a", 1), null);
  assert.equal(W.windAt(forecast, "b", 0), null);
  assert.equal(W.windAt(forecast, "a", -1), null);
});
