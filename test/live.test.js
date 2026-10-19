// Tests for «Piloter i lufta» on the maps (src/assets/js/live.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.FlyingSites = { formatNumber: (n, d) => Number(n).toFixed(d || 0).replace(".", ",") };
await import("../src/assets/js/live.js");
const LV = globalThis.FlyingSitesLive;
const texts = { "live.alt": "{m} m" };
LV.useText((key, vars) => (texts[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k]));

const item = (over = {}) => ({ id: "dd1234ab", name: null, lat: 68.8, lon: 16.5, alt: 1240.4, track: 90, speed: 8.3, climb: 1.24, type: 7, time: "2026-10-19T09:00:00.000Z", ...over });

test("only data in the expected shape is used", () => {
  assert.equal(LV.isLiveData({ dataset: "live", items: [item()] }), true);
  assert.equal(LV.isLiveData({ dataset: "live", items: [item({ id: "<b>" })] }), false);
  assert.equal(LV.isLiveData({ dataset: "live", items: [item({ alt: "1240" })] }), false);
  assert.equal(LV.isLiveData({ dataset: "stations", items: [] }), false);
  assert.equal(LV.isLiveData({ dataset: "live", items: [item({ trail: [[68.8, 16.5, 1.2], [68.8, 16.5, null], [68.8, 16.5]] })] }), true);
  assert.equal(LV.isLiveData({ dataset: "live", items: [item({ trail: [[68.8, 16.5, "1.2"]] })] }), false);
});

test("the label: height and climb with a sign", () => {
  assert.equal(LV.labelText(item()), "1240 m · +1,2");
  assert.equal(LV.labelText(item({ climb: -0.8 })), "1240 m · −0,8");
  assert.equal(LV.labelText(item({ climb: 0.02, alt: null })), "0");
});

test("the track's colours: by the climb, gliding grey, and runs of one colour that share their end points", () => {
  assert.deepEqual([-4, -2, -1, 0.4, 0.5, 1.9, 2, null].map(LV.climbKey), ["sink2", "sink1", "glide", "glide", "lift1", "lift1", "lift2", "glide"]);
  const runs = LV.trailRuns([[1, 1, -1], [2, 2, 1], [3, 3, 1.4], [4, 4, -2]]);
  assert.deepEqual(runs, [{ key: "lift1", points: [[1, 1], [2, 2], [3, 3]] }, { key: "sink1", points: [[3, 3], [4, 4]] }]);
  assert.deepEqual(LV.trailRuns([[1, 1, 0]]), []);
});
