// Tester for vindvurderingen (src/assets/js/wind.js). Kjør med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { t } from "../lib/i18n.js";

await import("../src/assets/js/wind.js");
const W = globalThis.FlyingSitesWind;
// Norske tekster fra ordboka (src/_i18n/nb.json), som på siden.
W.useText((key, vars) => t(`js.${key}`, "nb", vars ?? {}));
const rules = JSON.parse(fs.readFileSync(new URL("../src/_data/windRules.json", import.meta.url), "utf8"));

const site = { primary: ["SW", "W"], possible: ["S"], maxWind: null };
const rate = (wind, s = site) => W.rateWind(s, wind, rules);

// Varsel med én verdi per time fra `start` (ISO, UTC).
function hourly(start, hours) {
  const t0 = Date.parse(start);
  return Array.from({ length: hours }, (_, i) => new Date(t0 + i * 3600000).toISOString().replace(".000Z", "Z"));
}

test("hovedretning, moderat vind og små kast gir «Kan passe»", () => {
  assert.deepEqual(rate({ dir: 247, speed: 4, gust: 6 }), { rating: "ok", reasons: [], codes: [] });
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

test("middelvind over den felles grensen gir «For mye vind»", () => {
  assert.equal(rate({ dir: 247, speed: rules.maxWind + 0.5, gust: rules.maxWind + 1 }).rating, "high");
});

test("stedets egen grense brukes i stedet for den felles grensen", () => {
  const local = { ...site, maxWind: 5 };
  const r = rate({ dir: 247, speed: 6, gust: 7 }, local);
  assert.equal(r.rating, "high");
  assert.match(r.reasons[0], /grensen for stedet \(5 m\/s\)/);
  assert.equal(rate({ dir: 247, speed: 4.5, gust: 6 }, local).rating, "ok");
});

test("svak vind fra riktig retning er «Passer», uten grunn eller merknad", () => {
  const r = rate({ dir: 247, speed: rules.minWind - 0.5, gust: 2 });
  assert.equal(r.rating, "ok");
  assert.deepEqual(r.reasons, []);
  assert.equal(r.note, undefined);
});

test("mulig retning gir «Usikkert», feil retning gir «Passer ikke»", () => {
  assert.equal(rate({ dir: 180, speed: 4, gust: 5 }).rating, "maybe");
  assert.equal(rate({ dir: 90, speed: 4, gust: 5 }).rating, "no");
});

test("en retning nær kanten av en sektor som ikke er hovedretning, gir «Usikkert»", () => {
  // SW er 225°, sektoren går fra 202,5° til 247,5°, og W (270°) er også en hovedretning.
  assert.equal(rate({ dir: 205, speed: 4, gust: 5 }).rating, "maybe"); // nær S (mulig)
  assert.equal(rate({ dir: 250, speed: 4, gust: 5 }).rating, "ok"); // mellom SW og W, begge hovedretninger
  assert.equal(rate({ dir: 288, speed: 4, gust: 5 }).rating, "maybe"); // nær NW (passer ikke)
  assert.equal(rate({ dir: 225, speed: 4, gust: 5 }).rating, "ok");
});

test("retninger rundt nord håndteres riktig (355° og 5° er N)", () => {
  assert.equal(W.directionCode(355), "N");
  assert.equal(W.directionCode(5), "N");
  assert.equal(W.directionCode(-10), "N");
  assert.equal(W.directionCode(360), "N");
});

test("nedbør fra rainNo gir «Passer ikke», selv når vinden passer", () => {
  const r = rate({ dir: 247, speed: 4, gust: 6, rain: rules.rainNo });
  assert.equal(r.rating, "no");
  assert.match(r.reasons[0], /^Regn meldt \(0,5 mm\)$/);
});

test("lett nedbør gir høyst «Usikkert», og ingen eller manglende nedbør endrer ingenting", () => {
  const r = rate({ dir: 247, speed: 4, gust: 6, rain: rules.rainMaybe });
  assert.equal(r.rating, "maybe");
  assert.match(r.reasons.join(), /Litt nedbør meldt \(0,1 mm\)/);
  assert.equal(rate({ dir: 247, speed: 4, gust: 6, rain: 0 }).rating, "ok");
  assert.equal(rate({ dir: 247, speed: 4, gust: 6, rain: null }).rating, "ok");
});

test("for mye vind går foran nedbør", () => {
  assert.equal(rate({ dir: 247, speed: rules.maxWind + 1, gust: 12, rain: 2 }).rating, "high");
});

test("nedbør leses fra varselet, og et eldre varsel uten nedbør gir rain null", () => {
  const forecast = { times: ["2026-10-05T12:00:00Z"], sites: { a: [[247, 4, 6, 1.2]], b: [[247, 4, 6]] } };
  assert.equal(W.windAt(forecast, "a", 0).rain, 1.2);
  assert.equal(W.windAt(forecast, "b", 0).rain, null);
  assert.equal(W.formatRain(1.24), "1,2 mm");
});

test("et varsel eldre enn maxForecastAgeHours er for gammelt", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  const fetched = (h) => ({ fetched: new Date(now - h * 3600000).toISOString() });
  assert.equal(W.isStale(fetched(1), rules, now), false);
  assert.equal(W.isStale(fetched(rules.maxForecastAgeHours + 0.1), rules, now), true);
  assert.equal(W.isStale({ fetched: "tull" }, rules, now), true);
  assert.equal(W.isStale({ fetched: "2099-01-01T00:00:00Z" }, rules, now), true, "hentet i framtiden");
  const model = (h) => ({ ...fetched(0.2), updated: new Date(now - h * 3600000).toISOString() });
  assert.equal(W.isStale(model(2), rules, now), false);
  assert.equal(W.isStale(model(48), rules, now), true, "hentet nylig, men fra en modellkjøring som er to dager gammel");
  assert.equal(W.isStale(model(-1), rules, now), true, "en modellkjøring i framtiden");
});

test("«nå» finner timen som pågår, og +3/+6 timer fra den", () => {
  const times = hourly("2026-10-04T10:00:00Z", 48);
  const now = Date.parse("2026-10-04T12:40:00Z");
  assert.equal(W.slotIndex(times, "0", now), 2);
  assert.equal(W.slotIndex(times, "3", now), 5);
  assert.equal(W.slotIndex(times, "6", now), 8);
  assert.equal(W.slotIndex(times, "off", now), -1);
  // En manglende time (12, 13, 15, 16): +3 fra 12 er 15, og +1 fra 13 finnes ikke, så ingen senere time vises i stedet.
  const gap = ["2026-10-04T12:00:00Z", "2026-10-04T13:00:00Z", "2026-10-04T15:00:00Z", "2026-10-04T16:00:00Z"];
  assert.equal(W.slotIndex(gap, "3", Date.parse("2026-10-04T12:10:00Z")), 2);
  assert.equal(W.slotIndex(gap, "1", Date.parse("2026-10-04T13:10:00Z")), -1);
});

test("tidslinjen på forsiden: et hvilket som helst antall timer fra nå, så langt varselet rekker", () => {
  const times = hourly("2026-10-04T10:00:00Z", 48);
  const now = Date.parse("2026-10-04T12:40:00Z");
  assert.equal(W.slotIndex(times, "20", now), 22);
  assert.equal(W.slotIndex(times, "45", now), 47);
  assert.equal(W.slotIndex(times, "46", now), -1);
});

test("«nå» flytter seg til neste time når timen skifter (forsiden tegnes da på nytt)", () => {
  const times = hourly("2026-10-04T10:00:00Z", 48);
  // 11:50 og 12:10 UTC: samme valg, men en annen time i varselet.
  assert.equal(W.slotIndex(times, "0", Date.parse("2026-10-04T11:50:00Z")), 1);
  assert.equal(W.slotIndex(times, "0", Date.parse("2026-10-04T12:10:00Z")), 2);
  assert.equal(W.slotIndex(times, "3", Date.parse("2026-10-04T11:50:00Z")), 4);
  assert.equal(W.slotIndex(times, "3", Date.parse("2026-10-04T12:10:00Z")), 5);
});

test("et utløpt varsel gir ingen «nå», selv om den siste timen er passert", () => {
  const times = hourly("2026-10-01T10:00:00Z", 48);
  assert.equal(W.slotIndex(times, "0", Date.parse("2026-10-04T12:00:00Z")), -1);
  // Den siste timen gjelder i én time, ikke lenger.
  const last = Date.parse(times.at(-1));
  assert.equal(W.slotIndex(times, "0", last + 30 * 60000), 47);
  assert.equal(W.slotIndex(times, "0", last + 61 * 60000), -1);
  assert.equal(W.slotIndex(times, "3", last), -1);
});

test("«i morgen kl. 12» er norsk tid, også rett etter midnatt", () => {
  // Sommertid (UTC+2): 12:00 norsk tid er 10:00 UTC.
  const summer = hourly("2026-06-10T12:00:00Z", 48);
  const s = W.slotIndex(summer, "tomorrow", Date.parse("2026-06-10T22:30:00Z")); // 00:30 norsk tid 11. juni
  assert.equal(summer[s], "2026-06-12T10:00:00Z");
  const s2 = W.slotIndex(summer, "tomorrow", Date.parse("2026-06-10T21:30:00Z")); // 23:30 norsk tid 10. juni
  assert.equal(summer[s2], "2026-06-11T10:00:00Z");
  // Vintertid (UTC+1): 12:00 norsk tid er 11:00 UTC.
  const winter = hourly("2026-12-01T00:00:00Z", 48);
  const w = W.slotIndex(winter, "tomorrow", Date.parse("2026-12-01T23:15:00Z")); // 00:15 norsk tid 2. desember
  assert.equal(w, -1); // 3. desember kl. 12:00 er utenfor de 48 timene
  const w2 = W.slotIndex(winter, "tomorrow", Date.parse("2026-12-01T08:00:00Z"));
  assert.equal(winter[w2], "2026-12-02T11:00:00Z");
});

test("«i morgen kl. 12» over skiftet til vintertid", () => {
  // Klokka stilles tilbake natt til 25. oktober 2026. 12:00 norsk tid 25. oktober er 11:00 UTC.
  const times = hourly("2026-10-24T00:00:00Z", 48);
  const i = W.slotIndex(times, "tomorrow", Date.parse("2026-10-24T09:00:00Z"));
  assert.equal(times[i], "2026-10-25T11:00:00Z");
});

test("ugyldig vind er aldri «Kan passe»", () => {
  // Sammenligninger med undefined, NaN eller en streng er alltid false, så slike verdier slapp før forbi alle grenser.
  for (const speed of [undefined, null, NaN, Infinity, "5", -1]) {
    const r = rate({ dir: 247, speed, gust: 3 });
    assert.equal(r.rating, "no", `fart ${String(speed)}`);
    assert.deepEqual(r.codes, ["noData"]);
    assert.match(r.reasons.join(), /Mangler gyldige vinddata/);
  }
  for (const dir of [undefined, null, NaN, "247", -10, 400]) {
    assert.equal(rate({ dir, speed: 4, gust: 6 }).rating, "no", `retning ${String(dir)}`);
  }
  assert.equal(rate(null).rating, "no");
});

test("ugyldige kast og ugyldig nedbør regnes som manglende", () => {
  // Et ødelagt kast behandles som et manglende: i beste fall «Usikkert», aldri «Kan passe».
  for (const gust of [NaN, "6", -2]) {
    const r = rate({ dir: 247, speed: 4, gust });
    assert.equal(r.rating, "maybe", `kast ${String(gust)}`);
    assert.deepEqual(r.codes, ["noGust"]);
  }
  // Ødelagt nedbør ignoreres, som manglende nedbør.
  assert.equal(rate({ dir: 247, speed: 4, gust: 6, rain: NaN }).rating, "ok");
});

test("timer uten gyldig vind gir ingen vind, så siden viser «Ingen varsel»", () => {
  const forecast = { sites: { a: [[247, null, 5, 0], [null, 4, 5, 0], [247, 4, null, null], [247, 4, 5, -1]] } };
  assert.equal(W.windAt(forecast, "a", 0), null);
  assert.equal(W.windAt(forecast, "a", 1), null);
  assert.deepEqual(W.windAt(forecast, "a", 2), { dir: 247, speed: 4, gust: null, rain: null });
  assert.deepEqual(W.windAt(forecast, "a", 3), { dir: 247, speed: 4, gust: 5, rain: null });
});

test("tider vises i norsk tid", () => {
  assert.equal(W.formatClock(Date.parse("2026-06-10T22:05:00Z")), "00.05");
  assert.equal(W.formatClock(Date.parse("2026-12-10T08:30:00Z")), "09.30");
});

test("steder uten varsel eller med hull i det gir ingen vind", () => {
  const forecast = { sites: { a: [[200, 4, 5], null] } };
  assert.deepEqual(W.windAt(forecast, "a", 0), { dir: 200, speed: 4, gust: 5, rain: null });
  assert.equal(W.windAt(forecast, "a", 1), null);
  assert.equal(W.windAt(forecast, "b", 0), null);
  assert.equal(W.windAt(forecast, "a", -1), null);
});

test("soloppgang og solnedgang i Harstad, med midnattssol og mørketid", () => {
  const clock = (ms) => W.formatClock(ms);
  const oct = W.sunTimes("2026-10-09", 68.8, 16.3);
  // Rundt 07:37 og 17:45 denne dagen. Formelen er nøyaktig til et par minutter, så testen tillater 4.
  assert.ok(Math.abs(oct.rise - Date.parse("2026-10-09T05:37:00Z")) < 4 * 60000, clock(oct.rise));
  assert.ok(Math.abs(oct.set - Date.parse("2026-10-09T15:45:00Z")) < 4 * 60000, clock(oct.set));
  assert.deepEqual(W.sunTimes("2026-06-21", 68.8, 16.3), { polar: "day" });
  assert.deepEqual(W.sunTimes("2026-12-15", 68.8, 16.3), { polar: "night" });
  assert.equal(W.sunText("2026-12-15", 68.8, 16.3), "Mørketid, sola kommer ikke over horisonten.");
  assert.match(W.sunText("2026-10-09", 68.8, 16.3), /^Sola opp 07\.3\d, ned 17\.4\d\.$/);
});

test("sunPosition: høyde og asimut ved sann middag og midnatt", () => {
  // Harstad, 21. juni: sann middag omtrent 10:55 UTC, sola 90 − 68,8 + 23,4 = 44,6° høyt i sør; ved sann midnatt 23,4 −
  // 21,2 = 2,2° over horisonten i nord.
  const noon = W.sunPosition(Date.parse("2026-06-21T10:55:00Z"), 68.8, 16.3);
  assert.ok(Math.abs(noon.elevation - 44.6) < 1, String(noon.elevation));
  assert.ok(Math.abs(noon.azimuth - 180) < 2, String(noon.azimuth));
  const midnight = W.sunPosition(Date.parse("2026-06-21T22:55:00Z"), 68.8, 16.3);
  assert.ok(Math.abs(midnight.elevation - 2.2) < 1, String(midnight.elevation));
  assert.ok(midnight.azimuth > 358 || midnight.azimuth < 2, String(midnight.azimuth));
  // 9. oktober, soloppgang omtrent 07:37 i øst-sørøst (sunTimes over), sola 15° høyt midt på dagen.
  const rise = W.sunPosition(Date.parse("2026-10-09T05:37:00Z"), 68.8, 16.3);
  assert.ok(Math.abs(rise.elevation) < 1.5, String(rise.elevation));
  assert.ok(rise.azimuth > 100 && rise.azimuth < 110, String(rise.azimuth));
});

test("sunOnLaunch: når sola står på en start, ut fra retningene", () => {
  // En sørstart i oktober får sol midt på dagen, en nordstart ikke i det hele tatt, og en start med startplasser mot
  // øst og vest får den om morgenen og ettermiddagen.
  const south = W.sunOnLaunch("2026-10-09", 68.8, 16.3, ["S"]);
  assert.equal(south.length, 1);
  assert.ok(south[0][0] > 8 && south[0][0] < 10 && south[0][1] > 16 && south[0][1] < 17.5, JSON.stringify(south));
  assert.deepEqual(W.sunOnLaunch("2026-10-09", 68.8, 16.3, ["N"]), []);
  assert.equal(W.sunOnLaunch("2026-10-09", 68.8, 16.3, ["E", "W"]).length, 2);
  assert.deepEqual(W.sunOnLaunch("2026-12-15", 68.8, 16.3, ["S"]), []);
  assert.deepEqual(W.sunOnLaunch("2026-10-09", 68.8, 16.3, []), []);
  // Midnattssol lenger nord: en nordstart har sol over midnatt, som én periode forbi 24.
  const north = W.sunOnLaunch("2026-06-21", 70.5, 23, ["N"]);
  assert.equal(north.length, 1);
  assert.ok(north[0][0] > 18 && north[0][1] > 24 && north[0][1] < 30, JSON.stringify(north));
  assert.equal(W.sunOnLaunchText("2026-10-09", 68.8, 16.3, ["S"]), "Sol på starten ca. kl. 09–17.");
  assert.equal(W.sunOnLaunchText("2026-10-09", 68.8, 16.3, ["E", "W"]), "Sol på starten ca. kl. 09–11 og 15–17.");
  assert.equal(W.sunOnLaunchText("2026-06-21", 70.5, 23, ["N"]), "Sol på starten ca. kl. 20–05.");
  assert.equal(W.sunOnLaunchText("2026-10-09", 68.8, 16.3, ["N"]), "Lite sol på starten i dag.");
});

test("dagsplanen slår sammen timer med samme vurdering og hopper over mørke timer", () => {
  const times = hourly("2026-10-09T00:00:00Z", 24);
  const good = [247, 4, 6, 0], unsure = [247, 6, null, 0], wrong = [90, 4, 6, 0];
  // Norsk tid er UTC+2 i oktober. Sola er oppe omtrent 07:37–17:46 i Harstad.
  const rows = times.map((t, i) => (i >= 8 && i < 11 ? good : i === 11 ? unsure : i >= 12 && i < 14 ? good : wrong));
  rows[2] = good; // 04:00 norsk tid, mørkt
  const forecast = { times, sites: { x: rows } };
  const days = W.dayWindows(forecast, { id: "x", ...site }, rules, 68.8, 16.3);
  assert.deepEqual(Object.keys(days), ["2026-10-09"]);
  assert.deepEqual(days["2026-10-09"].map((w) => [W.formatClock(w.start), W.formatClock(w.end), w.rating]), [
    ["10.00", "13.00", "ok"], ["13.00", "14.00", "maybe"], ["14.00", "16.00", "ok"],
  ]);
  const first = days["2026-10-09"][0];
  assert.deepEqual([first.dir, first.min, first.max, first.gust], ["SW", 4, 4, 6]);
  assert.equal(days["2026-10-09"][1].gust, null); // kast mangler i varselet
});

test("et varsel fra datatjenesten brukes når det er nyere og har riktig form; en start som mangler, har bare ingen", () => {
  const page = { fetched: "2026-10-18T12:00:00Z", times: ["2026-10-18T12:00:00Z"], sites: { a: [[200, 5, 9, 0]], b: [null] } };
  const live = { fetched: "2026-10-18T15:00:00Z", times: ["2026-10-18T15:00:00Z", "2026-10-18T16:00:00Z"], sites: { a: [[200, 5, 9, 0], null], b: [[180, 3, null, null], [180, 3, 6, 0.2]] } };
  assert.equal(W.isNewerForecast(live, page), true);
  assert.equal(W.isNewerForecast(live, null), true);
  assert.equal(W.isNewerForecast({ ...live, fetched: "2026-10-18T11:00:00Z" }, page), false, "eldre");
  assert.equal(W.isNewerForecast({ ...live, sites: { a: live.sites.a } }, page), true, "en manglende start stopper ikke de andre");
  assert.equal(W.isNewerForecast({ ...live, sites: { a: live.sites.a } }, page, "b"), false, "stedssiden trenger sin egen start");
  assert.equal(W.isNewerForecast({ ...live, sites: { a: live.sites.a } }, null, "b"), true, "med mindre den ikke har noe varsel å beholde");
  assert.equal(W.isNewerForecast({ ...live, times: [live.times[1], live.times[0]] }, page), false, "timer i feil rekkefølge");
  assert.equal(W.isNewerForecast({ ...live, times: [live.times[0], live.times[0]] }, page), false, "en time to ganger");
  assert.equal(W.isNewerForecast({ ...live, sites: { ...live.sites, b: [[180, 3, 6, 0]] } }, page), false, "feil lengde");
  assert.equal(W.isNewerForecast({ ...live, sites: { ...live.sites, b: [["<b>", 3, 6, 0], null] } }, page), false, "tekst i en rad");
  assert.equal(W.isNewerForecast({ error: "no forecast yet" }, page), false);
  assert.equal(W.isNewerForecast(null, page), false);
});

test("timen nå med en måling: en strengere måling teller alltid", () => {
  const fc = { dir: 247, speed: 4, gust: 6, rain: 0 };
  const r = W.rateNow(site, fc, { dir: 247, speed: rules.maxWind + 2, gust: rules.maxWind + 4 }, rules, false);
  assert.equal(r.basis, "measured");
  assert.equal(r.result.rating, "high");
});

test("timen nå med en måling: en bedre måling teller bare når vinden er jevn", () => {
  const fc = { dir: 247, speed: rules.maxWind + 2, gust: rules.maxWind + 4, rain: 0 };
  const calm = { dir: 247, speed: 4, gust: 6 };
  assert.deepEqual([W.rateNow(site, fc, calm, rules, true).basis, W.rateNow(site, fc, calm, rules, true).result.rating], ["measured", "ok"]);
  const unsteady = W.rateNow(site, fc, calm, rules, false);
  assert.deepEqual([unsteady.basis, unsteady.result.rating, unsteady.unsteady], ["forecast", "high", true]);
});

test("timen nå med en måling beholder varselets nedbør, og virker uten måling", () => {
  const fc = { dir: 247, speed: 4, gust: 6, rain: rules.rainNo + 1 };
  assert.equal(W.rateNow(site, fc, { dir: 247, speed: 4, gust: 6 }, rules, true).result.rating, "no", "nedbør stasjonen ikke ser");
  assert.equal(W.rateNow(site, fc, null, rules, true).basis, "forecast");
});

test("vind for å holde seg oppe (soar_min_wind) er bare en merknad: lik vurdering, ingenting ved for mye vind", () => {
  const soar = { ...site, soarMinWind: 4 };
  const light = { dir: 247, speed: 3, gust: 4 };
  assert.equal(rate(light, soar).rating, rate(light).rating, "stedet kan fortsatt flys (en nedflyging)");
  assert.equal(rate(light, soar).note, "Under 4 m/s: nok til en tur ned, men trolig for lite til å henge her.");
  assert.equal(rate({ dir: 247, speed: 5, gust: 6 }, soar).note, undefined);
  assert.equal(rate(light).note, undefined, "ingen merknad uten feltet");
  assert.equal(rate({ dir: 90, speed: 3, gust: 4 }, soar).note, undefined, "ingen merknad når retningen uansett ikke passer");
});

// Hver time fra start, deretter hver 6. time (slik MET gir det lenger fram).
function hourlyThenSix(start, hours, sixes) {
  const times = hourly(start, hours);
  const last = Date.parse(times.at(-1));
  for (let k = 1; k <= sixes; k++) times.push(new Date(last + k * 6 * 3600000).toISOString().replace(".000Z", "Z"));
  return times;
}

test("tidene framover som timer fra nå, hver gjelder til den neste, 6-timersstegene nås med piltastene", () => {
  const times = hourlyThenSix("2026-10-21T10:00:00Z", 4, 2);
  const now = Date.parse("2026-10-21T11:20:00Z");
  const ahead = W.hoursAhead(times, now);
  assert.deepEqual(ahead.map((a) => [a.index, a.hours]), [[1, 0], [2, 1], [3, 2], [4, 8], [5, 14]]);
  assert.deepEqual([0, 3, 4, 5].map((i) => W.stepAt(times, i) / 3600000), [1, 6, 6, 6], "den siste like lang som den før");
  assert.equal(W.nearestHours(ahead, 6), 8, "dratt til 6 timer: nærmeste tid");
  assert.equal(W.nearestHours(ahead, 4), 2);
  assert.equal(W.nearestHours(ahead, 3, 2), 8, "ett steg videre fra siste time: videre til 6-timerssteget");
  assert.equal(W.nearestHours(ahead, 9, 8), 14);
  assert.equal(W.nearestHours(ahead, 7, 8), 2, "og tilbake");
  assert.equal(W.slotIndex(times, "8", now), 4, "timene funnet igjen etter tid");
  assert.deepEqual(W.hoursAhead(times, Date.parse("2026-10-20T10:00:00Z")), [], "dekker ikke nå");
});

test("dagsoversikten regner et 6-timerssteg som seks timer", () => {
  const times = hourlyThenSix("2026-10-24T10:00:00Z", 2, 2);
  const forecast = { times, sites: { x: times.map(() => [240, 4, 6, 0]) } };
  const days = W.dayWindows(forecast, { id: "x", ...site }, rules, 68.8, 16.3);
  // 10 og 11 UTC, så 17 UTC (etter solnedgang, utelatt): 11 UTC teller til 17.
  assert.deepEqual(days["2026-10-24"].map((w) => [new Date(w.start).toISOString(), new Date(w.end).toISOString()]), [["2026-10-24T10:00:00.000Z", "2026-10-24T17:00:00.000Z"]]);
});
