// Tester for tegningen til 3D-visningen (lib/drawing.js). Kjøres med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateDrawing } from "../lib/drawing.js";

const launch = { lat: 68.80389, lon: 16.36667 };
const drawing = (features) => ({ type: "FeatureCollection", features });
const feature = (properties, geometry) => ({ type: "Feature", properties, geometry });

test("tegningen for Sollifjellet er gyldig", () => {
  const file = new URL("../src/flysteder/sollifjellet/sollifjellet-drawing.geojson", import.meta.url);
  assert.deepEqual(validateDrawing(JSON.parse(fs.readFileSync(file, "utf8")), launch), []);
});

test("tekst, startkant med pil og fareområde er gyldige", () => {
  assert.deepEqual(validateDrawing(drawing([
    feature({ kind: "label", title: "Masta", text: "Trakteffekt" }, { type: "Point", coordinates: [16.377, 68.806] }),
    feature({ kind: "path", style: "launch", arrow: true }, { type: "LineString", coordinates: [[16.375, 68.806], [16.378, 68.807]] }),
    feature({ kind: "area", style: "hazard", title: "Rotor" },
      { type: "Polygon", coordinates: [[[16.37, 68.80], [16.38, 68.80], [16.38, 68.81], [16.37, 68.80]]] }),
  ]), launch), []);
});

test("ukjent kind, feil geometri, ugyldig style og manglende title stopper bygget", () => {
  const errors = validateDrawing(drawing([
    feature({ kind: "pil" }, { type: "Point", coordinates: [16.37, 68.80] }),
    feature({ kind: "path" }, { type: "Point", coordinates: [16.37, 68.80] }),
    feature({ kind: "area", style: "gul" }, { type: "Polygon", coordinates: [[[16.37, 68.80], [16.38, 68.80], [16.37, 68.80]]] }),
    feature({ kind: "label", farge: "rød" }, { type: "Point", coordinates: [16.37, 68.80] }),
  ]), launch);
  assert.match(errors.join("\n"), /ukjent kind «pil»/);
  assert.match(errors.join("\n"), /path må være LineString/);
  assert.match(errors.join("\n"), /ugyldig style «gul»/);
  assert.match(errors.join("\n"), /label mangler title/);
  assert.match(errors.join("\n"), /ukjent nøkkel `farge`/);
});

test("direction_arc er valgfri, men må ha gyldige verdier", () => {
  const ok = { ...drawing([]), direction_arc: { center: [16.367, 68.804], radius: 300 } };
  assert.deepEqual(validateDrawing(ok, launch), []);
  const bad = { ...drawing([]), direction_arc: { center: [68.804, 16.367], radius: 5000, farge: "gul" } };
  const errors = validateDrawing(bad, launch).join("\n");
  assert.match(errors, /direction_arc.center/);
  assert.match(errors, /direction_arc.radius/);
  assert.match(errors, /ukjent nøkkel `direction_arc.farge`/);
});

test("byttet lon og lat stopper bygget", () => {
  const errors = validateDrawing(drawing([
    feature({ kind: "label", title: "Feil" }, { type: "Point", coordinates: [68.806, 16.377] }),
  ]), launch);
  assert.match(errors[0], /mer enn 10 km fra starten/);
});
