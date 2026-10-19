// Tests for the power lines and obstacles (lib/obstacles.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { siteBox, nveQueryUrl, nveFeatures, overpassQuery, osmFeatures, obstaclesGeoJSON, summary, NVE_LAYERS, NVE_WIND } from "../lib/obstacles.js";

const dale = { launch: { lat: 68.79472, lon: 16.11583 }, landings: [{ lat: 68.79613, lon: 16.11071 }, { name: "uten posisjon" }] };

test("the box: the launch and landings with the margin around them", () => {
  const b = siteBox(dale, 1000);
  assert.ok(b.s < 68.79472 - 0.0089 && b.s > 68.79472 - 0.0091);
  assert.ok(b.n > 68.79613 + 0.0089 && b.n < 68.79613 + 0.0091);
  assert.ok(b.w < 16.11071 - 0.024 && b.e > 16.11583 + 0.024, "wider in longitude this far north");
  assert.equal(siteBox({}), null);
});

test("the NVE query asks for the features in the box in WGS84", () => {
  const u = new URL(nveQueryUrl(NVE_LAYERS[2], { s: 1, w: 2, n: 3, e: 4 }));
  assert.match(u.pathname, /Nettanlegg4\/MapServer\/2\/query$/);
  assert.equal(u.searchParams.get("geometry"), "2,1,4,3");
  assert.equal(u.searchParams.get("outSR"), "4326");
});

test("NVE: overhead lines with voltage and owner, masts, and wind turbines in operation", () => {
  const lines = nveFeatures({ features: [
    { attributes: { objectid: 7, objekttype: "EL_Luftlinje", spenning_kv: 22, eier: "HÅLOGALAND KRAFT NETT AS" }, geometry: { paths: [[[16.111111, 68.791111], [16.12, 68.8]]] } },
    { attributes: { objectid: 8, objekttype: "EL_Jordkabel", spenning_kv: 22 }, geometry: { paths: [[[16, 68], [16.1, 68.1]]] } },
  ] }, NVE_LAYERS[2]);
  assert.equal(lines.length, 1, "the cable in the ground is left out");
  assert.deepEqual(lines[0].properties, { kind: "power", src: "nve", kv: 22, owner: "HÅLOGALAND KRAFT NETT AS" });
  assert.deepEqual(lines[0].geometry, { type: "LineString", coordinates: [[16.11111, 68.79111], [16.12, 68.8]] });
  assert.equal(lines[0].id, "nve/grid/2/7");

  const masts = nveFeatures({ features: [{ attributes: { objectid: 1, eier: "X", mastehoyde_m: 12 }, geometry: { x: 16.1, y: 68.8 } }] }, NVE_LAYERS[3]);
  assert.deepEqual(masts[0].properties, { kind: "pylon", src: "nve", height: 12 }, "the owner is on the line, not on each mast");
  assert.equal(masts[0].geometry.type, "Point");

  const wind = nveFeatures({ features: [
    { attributes: { objectid: 1, status: "D", anleggnavn: "Nygårdsfjellet" }, geometry: { x: 17.9, y: 68.5 } },
    { attributes: { objectid: 2, status: "P" }, geometry: { x: 17.9, y: 68.5 } },
  ] }, { service: NVE_WIND, layer: 4, kind: "wind" });
  assert.equal(wind.length, 1, "planned turbines are left out");
  assert.equal(wind[0].properties.name, "Nygårdsfjellet");
  assert.throws(() => nveFeatures({ error: { message: "Invalid query" } }, NVE_LAYERS[0]), /Invalid query/);
});

test("the Overpass query covers every box", () => {
  const q = overpassQuery([{ s: 1, w: 2, n: 3, e: 4 }, { s: 5, w: 6, n: 7, e: 8 }]);
  assert.match(q, /^\[out:json\]/);
  assert.match(q, /way\["power"="minor_line"\]\(1,2,3,4\);/);
  assert.match(q, /chair_lift/);
  assert.match(q, /\(5,6,7,8\)/);
});

test("OpenStreetMap: low voltage, lifts and masts, nothing else", () => {
  const f = osmFeatures({ elements: [
    { type: "way", id: 1, tags: { power: "minor_line" }, geometry: [{ lat: 68.8, lon: 16.36 }, { lat: 68.81, lon: 16.37 }] },
    { type: "way", id: 2, tags: { aerialway: "t-bar", name: "Sollifjellheisen" }, geometry: [{ lat: 68.8, lon: 16.36 }, { lat: 68.805, lon: 16.365 }] },
    { type: "way", id: 3, tags: { aerialway: "station" }, geometry: [{ lat: 68.8, lon: 16.36 }] },
    { type: "node", id: 4, lat: 68.8, lon: 16.4, tags: { man_made: "mast", "tower:type": "communication", height: "42 m" } },
    { type: "way", id: 5, tags: { man_made: "tower", "tower:type": "communication" }, geometry: [{ lat: 68, lon: 16 }, { lat: 68.002, lon: 16 }, { lat: 68.002, lon: 16.002 }, { lat: 68, lon: 16 }] },
    { type: "way", id: 6, tags: { highway: "track" }, geometry: [{ lat: 68, lon: 16 }] },
  ] });
  assert.deepEqual(f.map((x) => x.properties.kind), ["minor", "aerialway", "mast", "mast"]);
  assert.equal(f[1].properties.sub, "t-bar");
  assert.equal(f[1].properties.name, "Sollifjellheisen");
  assert.equal(f[2].properties.height, 42);
  assert.equal(f[3].geometry.type, "Point", "a mast drawn as an outline becomes a point");
  assert.equal(f[0].id, "osm/way/1");
});

test("the file: each feature once, in a fixed order, with the date and sources", () => {
  const a = { type: "Feature", id: "nve/grid/2/9", properties: { kind: "power" }, geometry: null };
  const b = { type: "Feature", id: "nve/grid/2/1", properties: { kind: "pylon" }, geometry: null };
  const g = obstaclesGeoJSON([a, b, a], { fetched: "2026-10-19", sources: ["nve"] });
  assert.deepEqual(g.features.map((f) => f.id), ["nve/grid/2/1", "nve/grid/2/9"]);
  assert.equal(g.fetched, "2026-10-19");
  assert.deepEqual(summary(g.features), { pylon: 1, power: 1 });
});
