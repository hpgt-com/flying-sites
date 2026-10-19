// Tests for «Piloter i lufta» on the maps (src/assets/js/live.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.FlyingSites = { formatNumber: (n, d) => Number(n).toFixed(d || 0).replace(".", ",") };
await import("../src/assets/js/live.js");
const LV = globalThis.FlyingSitesLive;
const texts = { "live.alt": "{m} m", "live.type_paraglider": "Paraglider", "live.type_other": "Luftfartøy" };
LV.useText((key, vars) => (texts[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k]));

const item = (over = {}) => ({ id: "dd1234ab", name: null, lat: 68.8, lon: 16.5, alt: 1240.4, track: 90, speed: 8.3, climb: 1.24, type: 7, time: "2026-10-19T09:00:00.000Z", ...over });

test("only data in the expected shape is used", () => {
  assert.equal(LV.isLiveData({ dataset: "live", items: [item()] }), true);
  assert.equal(LV.isLiveData({ dataset: "live", items: [item({ id: "<b>" })] }), false);
  assert.equal(LV.isLiveData({ dataset: "live", items: [item({ alt: "1240" })] }), false);
  assert.equal(LV.isLiveData({ dataset: "stations", items: [] }), false);
});

test("the label: height and climb with a sign; the type in words", () => {
  assert.equal(LV.labelText(item()), "1240 m · +1,2");
  assert.equal(LV.labelText(item({ climb: -0.8 })), "1240 m · −0,8");
  assert.equal(LV.labelText(item({ climb: 0.02, alt: null })), "0");
  assert.equal(LV.typeText(item()), "Paraglider");
  assert.equal(LV.typeText(item({ type: 0 })), "Luftfartøy");
});
