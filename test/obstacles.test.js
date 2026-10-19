// Tests for the power lines and obstacles (lib/obstacles.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { siteBox, regionBox, tileKey, featureTiles, nveQueryUrl, nveFeatures, overpassQuery, osmFeatures, obstacleTiles, obstaclesIndex, summary, NVE_LAYERS, NVE_WIND, TILE_LAT, TILE_LON } from "../lib/obstacles.js";

const dale = { launch: { lat: 68.79472, lon: 16.11583 }, landings: [{ lat: 68.79613, lon: 16.11071 }, { name: "uten posisjon" }] };

test("the box: the launch and landings with the margin around them", () => {
  const b = siteBox(dale, 1000);
  assert.ok(b.s < 68.79472 - 0.0089 && b.s > 68.79472 - 0.0091);
  assert.ok(b.n > 68.79613 + 0.0089 && b.n < 68.79613 + 0.0091);
  assert.ok(b.w < 16.11071 - 0.024 && b.e > 16.11583 + 0.024, "wider in longitude this far north");
  assert.equal(siteBox({}), null);
});

test("the region: the sites with the margin around them, out to whole tiles", () => {
  const r = regionBox([siteBox(dale), { s: 67.9, w: 13.0, n: 67.95, e: 13.1 }], 25000);
  assert.deepEqual(r, { s: 67.5, w: 12.0, n: 69.25, e: 17.0 });
  for (const v of [r.s, r.n]) assert.equal(Math.round(v / TILE_LAT) * TILE_LAT, v);
  for (const v of [r.w, r.e]) assert.equal(Math.round(v / TILE_LON) * TILE_LON, v);
  assert.equal(regionBox([]), null);
});

test("the tiles: a point in one, a line in every tile it crosses", () => {
  assert.equal(tileKey(68.79472, 16.11583), "275_32");
  assert.deepEqual(featureTiles({ type: "Point", coordinates: [16.11583, 68.79472] }), ["275_32"]);
  assert.deepEqual(featureTiles({ type: "LineString", coordinates: [[16.4, 68.7], [16.6, 68.8]] }).sort(), ["274_32", "274_33", "275_32", "275_33"]);
  assert.deepEqual(featureTiles({ type: "MultiLineString", coordinates: [[[16.1, 68.8], [16.2, 68.8]], [[14.1, 68.1], [14.2, 68.1]]] }), ["275_32", "272_28"]);
});

test("the NVE query asks for the features in the box in WGS84, a page at a time", () => {
  const u = new URL(nveQueryUrl(NVE_LAYERS[2], { s: 1, w: 2, n: 3, e: 4 }, 2000));
  assert.match(u.pathname, /Nettanlegg4\/MapServer\/2\/query$/);
  assert.equal(u.searchParams.get("geometry"), "2,1,4,3");
  assert.equal(u.searchParams.get("outSR"), "4326");
  assert.equal(u.searchParams.get("resultOffset"), "2000");
  assert.equal(u.searchParams.get("orderByFields"), "objectid");
  assert.ok(NVE_LAYERS.find((l) => l.kind === "pylon").nearSites, "the masts and poles only near the sites");
  assert.ok(NVE_LAYERS.filter((l) => l.kind !== "pylon").every((l) => !l.nearSites));
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
  assert.match(q, /\|yes\)\$/);
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
    { type: "way", id: 7, tags: { aerialway: "yes" }, geometry: [{ lat: 68.24, lon: 14.52 }, { lat: 68.25, lon: 14.53 }] },
  ] });
  assert.deepEqual(f.map((x) => x.properties.kind), ["minor", "aerialway", "mast", "mast", "aerialway"]);
  assert.equal(f[4].properties.sub, "yes", "a cable nobody has said more about is still an obstacle");
  assert.equal(f[1].properties.sub, "t-bar");
  assert.equal(f[1].properties.name, "Sollifjellheisen");
  assert.equal(f[2].properties.height, 42);
  assert.equal(f[3].geometry.type, "Point", "a mast drawn as an outline becomes a point");
  assert.equal(f[0].id, "osm/way/1");
});

test("the tiles and index: each feature once per tile, in a fixed order, with the date and sources", () => {
  const a = { type: "Feature", id: "nve/grid/2/9", properties: { kind: "power" }, geometry: { type: "LineString", coordinates: [[16.4, 68.8], [16.6, 68.8]] } };
  const b = { type: "Feature", id: "nve/grid/4/1", properties: { kind: "pylon" }, geometry: { type: "Point", coordinates: [16.45, 68.8] } };
  const tiles = obstacleTiles([a, b, a]);
  assert.deepEqual([...tiles.keys()], ["275_32", "275_33"]);
  assert.deepEqual(tiles.get("275_32").map((f) => f.id), ["nve/grid/2/9", "nve/grid/4/1"]);
  assert.deepEqual(tiles.get("275_33").map((f) => f.id), ["nve/grid/2/9"], "the line is in both tiles");
  const index = obstaclesIndex(tiles, { fetched: "2026-10-19", sources: ["nve"] });
  assert.deepEqual(index, { fetched: "2026-10-19", sources: ["nve"], tileLat: TILE_LAT, tileLon: TILE_LON, tiles: ["275_32", "275_33"] });
  assert.deepEqual(summary([a, b]), { power: 1, pylon: 1 });
});
