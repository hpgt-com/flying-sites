// Tester for høydeprofilen under «Luftrom over start» (lib/airspace-profile.js). Kjør med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { airspaceProfile } from "../lib/airspace-profile.js";

const tma1 = { name: "Evenes TMA1", class: "D", lower: { value: 4500, unit: "FT", ref: "MSL" } };
const ceiling = (airspace, masl, launch) => ({ airspace, fromGround: false, masl, aboveLaunch: masl - launch });

test("viser høyden mellom start og luftrommets nedre grense", () => {
  const svg = airspaceProfile(ceiling(tma1, 1372, 563), 563, 213, "nb");
  assert.match(svg, /^<svg class="airspace-profile"/);
  assert.match(svg, />809 m</);
  assert.match(svg, />over start</);
  assert.match(svg, /Evenes TMA1 · Klasse D/);
  assert.match(svg, /fra 1372 moh \(4500 ft\)/);
  assert.match(svg, /Start 563 moh/);
  assert.match(svg, /Landing 213 moh/);
  assert.match(svg, /<title id="ap-title">Evenes TMA1 begynner 809 m over starten/);
});

test("en start over den nedre grensen vises som en advarsel", () => {
  const tma2 = { name: "Evenes TMA2", class: "D", lower: { value: 2500, unit: "FT", ref: "MSL" } };
  const svg = airspaceProfile(ceiling(tma2, 762, 1089), 1089, 4, "nb");
  assert.match(svg, />327 m</);
  assert.match(svg, /start over grensen/);
  assert.match(svg, /airspace-profile__gap--warn/);
});

test("følger sidens språk", () => {
  const svg = airspaceProfile(ceiling(tma1, 1372, 563), 563, 213, "en");
  assert.match(svg, />above launch</);
  assert.match(svg, /Launch 563 m asl/);
});

test("tegner ingenting uten tak, for luftrom fra bakken eller uten starthøyde", () => {
  assert.equal(airspaceProfile(null, 563, 213, "nb"), "");
  assert.equal(airspaceProfile({ airspace: tma1, fromGround: true, masl: null, aboveLaunch: null }, 563, 213, "nb"), "");
  assert.equal(airspaceProfile(ceiling(tma1, 1372, 563), undefined, 213, "nb"), "");
});

test("uten landingshøyde utelates landingen", () => {
  const svg = airspaceProfile(ceiling(tma1, 1372, 563), 563, null, "nb");
  assert.doesNotMatch(svg, /Landing/);
});

test("navn fra dataene escapes", () => {
  const svg = airspaceProfile(ceiling({ ...tma1, name: "<b>X</b>" }, 1372, 563), 563, 213, "nb");
  assert.doesNotMatch(svg, /<b>/);
  assert.match(svg, /&lt;b&gt;X&lt;\/b&gt;/);
});
