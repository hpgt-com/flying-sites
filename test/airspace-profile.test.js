// Tests for the height profile under «Luftrom over start» (lib/airspace-profile.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { airspaceProfile } from "../lib/airspace-profile.js";

const tma1 = { name: "Evenes TMA1", class: "D", lower: { value: 4500, unit: "FT", ref: "MSL" } };
const ceiling = (airspace, masl, launch) => ({ airspace, fromGround: false, masl, aboveLaunch: masl - launch });

test("shows the height between launch and the airspace floor", () => {
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

test("a launch above the floor is shown as a warning", () => {
  const tma2 = { name: "Evenes TMA2", class: "D", lower: { value: 2500, unit: "FT", ref: "MSL" } };
  const svg = airspaceProfile(ceiling(tma2, 762, 1089), 1089, 4, "nb");
  assert.match(svg, />327 m</);
  assert.match(svg, /start over grensen/);
  assert.match(svg, /airspace-profile__gap--warn/);
});

test("follows the page language", () => {
  const svg = airspaceProfile(ceiling(tma1, 1372, 563), 563, 213, "en");
  assert.match(svg, />above launch</);
  assert.match(svg, /Launch 563 m asl/);
});

test("draws nothing without a ceiling, for airspace from the ground or without launch height", () => {
  assert.equal(airspaceProfile(null, 563, 213, "nb"), "");
  assert.equal(airspaceProfile({ airspace: tma1, fromGround: true, masl: null, aboveLaunch: null }, 563, 213, "nb"), "");
  assert.equal(airspaceProfile(ceiling(tma1, 1372, 563), undefined, 213, "nb"), "");
});

test("a missing landing height leaves out the landing", () => {
  const svg = airspaceProfile(ceiling(tma1, 1372, 563), 563, null, "nb");
  assert.doesNotMatch(svg, /Landing/);
});

test("names from the data are escaped", () => {
  const svg = airspaceProfile(ceiling({ ...tma1, name: "<b>X</b>" }, 1372, 563), 563, 213, "nb");
  assert.doesNotMatch(svg, /<b>/);
  assert.match(svg, /&lt;b&gt;X&lt;\/b&gt;/);
});
