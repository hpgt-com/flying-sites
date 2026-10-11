// Tests for the drawing for the 3D view (lib/drawing.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateDrawing } from "../lib/drawing.js";

const launch = { lat: 68.80389, lon: 16.36667 };
const drawing = (features) => ({ type: "FeatureCollection", features });
const feature = (properties, geometry) => ({ type: "Feature", properties, geometry });

test("the drawing for Sollifjellet is valid", () => {
  const file = new URL("../src/sites/sollifjellet/sollifjellet-drawing.geojson", import.meta.url);
  assert.deepEqual(validateDrawing(JSON.parse(fs.readFileSync(file, "utf8")), launch), []);
});

test("text, launch edge with arrow and hazard area are valid", () => {
  assert.deepEqual(validateDrawing(drawing([
    feature({ kind: "label", title: "Masta", text: "Trakteffekt" }, { type: "Point", coordinates: [16.377, 68.806] }),
    feature({ kind: "path", style: "launch", arrow: true }, { type: "LineString", coordinates: [[16.375, 68.806], [16.378, 68.807]] }),
    feature({ kind: "area", style: "hazard", title: "Rotor" },
      { type: "Polygon", coordinates: [[[16.37, 68.80], [16.38, 68.80], [16.38, 68.81], [16.37, 68.80]]] }),
  ]), launch), []);
});

test("unknown kind, wrong geometry, invalid style and missing title stop the build", () => {
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

test("direction_arc is optional but must have valid values", () => {
  const ok = { ...drawing([]), direction_arc: { center: [16.367, 68.804], radius: 300 } };
  assert.deepEqual(validateDrawing(ok, launch), []);
  const bad = { ...drawing([]), direction_arc: { center: [68.804, 16.367], radius: 5000, farge: "gul" } };
  const errors = validateDrawing(bad, launch).join("\n");
  assert.match(errors, /direction_arc.center/);
  assert.match(errors, /direction_arc.radius/);
  assert.match(errors, /ukjent nøkkel `direction_arc.farge`/);
});

test("swapped lon and lat stop the build", () => {
  const errors = validateDrawing(drawing([
    feature({ kind: "label", title: "Feil" }, { type: "Point", coordinates: [68.806, 16.377] }),
  ]), launch);
  assert.match(errors[0], /mer enn 10 km fra starten/);
});
