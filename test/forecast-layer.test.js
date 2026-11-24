// Tester for «Prognose» på kartet på forsiden (src/assets/js/forecast-layer.js). Kjør med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom, html } from "./helpers/dom.mjs";

installDom();
globalThis.FlyingSites = { formatNumber: (n, d) => Number(n).toFixed(d || 0).replace(".", ","), DIRECTION_LABELS: { N: "N", NE: "NØ", E: "Ø", SE: "SØ", S: "S", SW: "SV", W: "V", NW: "NV" } };
await import("../src/assets/js/forecast-layer.js");
const FC = globalThis.FlyingSitesForecast;
const texts = { "forecast.ms": "{v} m/s", "forecast.masl": "{m} moh", "forecast.mm": "{v} mm", "forecast.dew": "duggpunkt {v}", "forecast.noThermal": "ingen", "forecast.cu": "Cu" };
FC.useText((key, vars) => (texts[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k]));

const T0 = Date.UTC(2026, 9, 21, 10) / 1000;
// Et nett med 2 × 2 punkter, to timer: ett punkt på sjøen, tre på land; verdiene per punkt er like begge timene.
function grid(over = {}) {
  const per = (v) => [[v, v], [v, v], [v, v], [v, v]];
  return {
    dataset: "grid", lat0: 68.5, lon0: 16, dLat: 0.1, dLon: 0.25, rows: 2, cols: 2, times: [T0, T0 + 3600], elev: [0, 300, 600, 900],
    values: { T: per(14), Td: per(6), ws: per(3.2), wd: per(225), ws9: per(7.4), wd9: per(250), blh: per(1200), cl: per(10), pr: per(0), sw: per(600) },
    ...over,
  };
}

test("bare data med forventet form brukes", () => {
  assert.equal(FC.isGridData(grid()), true);
  assert.equal(FC.isGridData(grid({ dataset: "grid-wide" })), true);
  assert.equal(FC.isGridData(grid({ dataset: "stations" })), false);
  assert.equal(FC.isGridData(grid({ rows: 3 })), false);
  assert.equal(FC.isGridData(grid({ elev: [0, 1, 2] })), false);
  const bad = grid();
  bad.values.T[1][0] = "14";
  assert.equal(FC.isGridData(bad), false);
  const missing = grid();
  delete missing.values.sw;
  assert.equal(FC.isGridData(missing), false);
  const nulls = grid();
  nulls.values.blh[2][1] = null;
  assert.equal(FC.isGridData(nulls), true);
});

test("timen som inneholder et tidspunkt, og ingenting utenfor timene", () => {
  const g = grid();
  assert.equal(FC.hourIndex(g, T0 * 1000), 0);
  assert.equal(FC.hourIndex(g, T0 * 1000 + 3599999), 0);
  assert.equal(FC.hourIndex(g, (T0 + 3600) * 1000 + 60000), 1);
  assert.equal(FC.hourIndex(g, T0 * 1000 - 1), -1);
  assert.equal(FC.hourIndex(g, (T0 + 7200) * 1000), -1);
});

test("punkter rad for rad fra sør", () => {
  assert.deepEqual(FC.pointAt(grid(), 0), { lat: 68.5, lon: 16 });
  assert.deepEqual(FC.pointAt(grid(), 3), { lat: 68.6, lon: 16.25 });
});

test("termikkstyrke, topp og skybase: bare land, Cu når basen er under toppen", () => {
  const g = grid();
  const sea = FC.hourAt(g, 0, 0);
  assert.equal(sea.land, false);
  assert.equal(sea.w, 0);
  assert.equal(sea.top, null);
  const land = FC.hourAt(g, 1, 0);
  // w* = cbrt(9,81 / 287,15 · 240 / 1200 · 1200) ≈ 2,0 m/s
  assert.equal(land.w, 2);
  assert.equal(land.top, 1500);
  // 300 + 125 × 8 = 1300, under toppen: Cu
  assert.equal(land.base, 1300);
  assert.equal(land.cu, true);
  const dry = grid();
  dry.values.Td = dry.values.Td.map(() => [-6, -6]);
  const blue = FC.hourAt(dry, 1, 0);
  assert.equal(blue.base, 2800);
  assert.equal(blue.cu, false);
  const weak = grid();
  weak.values.blh = weak.values.blh.map(() => [100, 100]);
  assert.equal(FC.hourAt(weak, 1, 0).w, 0);
});

test("lave skyer og nedbør", () => {
  const g = grid();
  g.values.cl = g.values.cl.map(() => [95, 95]);
  g.values.Td = g.values.Td.map(() => [13, 13]);
  g.values.pr = g.values.pr.map(() => [1.2, 0.1]);
  const h = FC.hourAt(g, 2, 0);
  assert.equal(h.low, true);
  assert.equal(h.rain, true);
  assert.equal(FC.hourAt(g, 2, 1).rain, false);
});

test("termikkfargene starter på 1 m/s", () => {
  assert.deepEqual([0, 0.9, 1, 1.6, 2.2, 2.7, 3.5, null].map(FC.scaleKey), [null, null, "t1", "t2", "t3", "t4", "t5", null]);
});

test("vindfjær som på RASP: halv 2,5, hel 5, vimpel 25, en ring for stille", () => {
  const barb = (dir, speed) => html(FC.barbSvg(dir, speed));
  // Strekene i fjæren ved siden av staven.
  const count = (svg) => svg.match(/class="fc-barb__line" d="([^"]*)"/)[1].split("M").length - 2;
  assert.match(barb(90, 0.5), /fc-barb__calm/);
  assert.equal(FC.barbSvg(null, 3), null);
  // 7,5 m/s: én hel og én halv fjær, ved siden av staven.
  assert.equal(count(barb(90, 7.5)), 2);
  assert.match(barb(90, 7.5), /rotate\(90\)/);
  assert.equal(FC.barbSvg(90, 7.5).namespaceURI, "http://www.w3.org/2000/svg");
  // 27,5 m/s: en vimpel og en halv fjær.
  const strong = barb(0, 27.5);
  assert.match(strong, /fc-barb__flag/);
  assert.equal(count(strong), 1);
  assert.doesNotMatch(barb(0, 10), /fc-barb__flag/);
});

test("popupens linjer: tall og retninger, bare det som er kjent", () => {
  const rows = Object.fromEntries(FC.popupRows(FC.hourAt(grid(), 1, 0)));
  assert.equal(rows["forecast.thermal"], "2,0 m/s");
  assert.equal(rows["forecast.top"], "1300 moh");
  assert.equal(rows["forecast.base"], "1300 moh · Cu");
  assert.equal(rows["forecast.temp"], "+14° · duggpunkt +6°");
  assert.equal(rows["forecast.windGround"], "SV 3,2 m/s");
  assert.equal(rows["forecast.wind750"], "V 7,4 m/s");
  const sea = Object.fromEntries(FC.popupRows(FC.hourAt(grid(), 0, 0)));
  assert.equal(sea["forecast.thermal"], "ingen");
  assert.equal(sea["forecast.top"], undefined);
  assert.equal(FC.formatTemp(-2.6), "−3°");
  assert.equal(FC.formatTemp(0.2), "0°");
});

test("etikettene med fjær: stablet på siden vinden blåser mot, klar av stasjonen", () => {
  const rows = [{ size: [30, 16] }, { size: [44, 20] }];
  // Fra sør: staven peker ned, stabelen går opp.
  const south = FC.stackAt(180, rows);
  assert.equal(south.x, 0);
  assert.ok(south.y[1] + 10 <= -8, `bunnen av stabelen ved ${south.y[1] + 10}`);
  assert.ok(south.y[0] < south.y[1]);
  // Fra vest: stabelen går til høyre, med venstre kant klar av stasjonen.
  const west = FC.stackAt(270, rows);
  assert.ok(west.x - 22 >= 8, `venstre kant ved ${west.x - 22}`);
  // Uten vind: på punktet.
  assert.deepEqual(FC.stackAt(null, rows), { x: 0, y: [-10, 8] });
});
