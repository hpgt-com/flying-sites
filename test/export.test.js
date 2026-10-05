// Tester for de åpne datafilene (lib/export.js). Kjøres med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sitesToGeoJSON, geoJSONToKML } from "../lib/export.js";

const site = {
  url: "/flysteder/testfjell/",
  data: {
    id: "testfjell", name: "Testfjell & co", level: "PP2", categories: ["PG"],
    wind_directions: { primary: ["S", "SW"], possible: ["W"] },
    launch: { lat: 68.8, lon: 16.4, source: "flightlog" },
    launches: [{ directions: ["N"], lat: 68.801, lon: 16.401, text: "Tekst som ikke skal med" }, { directions: ["S"], text: "Uten posisjon" }],
    landings: [{ name: "Myra", lat: 68.79, lon: 16.42, primary: true }],
    parking: [{ lat: 68.79, lon: 16.421 }],
    hazards: [{ title: "Rotor", text: "Skal ikke med" }],
    elevation: { launch_masl: 560, difference_m: 320 },
    derived: {
      routes: [{ name: null, lengthKm: 1.5, elevationGain: 330, url: "/flysteder/testfjell/testfjell-route.gpx", line: [[68.79, 16.42], [68.8, 16.4]] }],
      drawing: { type: "FeatureCollection", features: [
        { type: "Feature", properties: { kind: "label", title: "Masta", text: "Sendemast på toppen" }, geometry: { type: "Point", coordinates: [16.41, 68.805] } },
        { type: "Feature", properties: { kind: "label", title: "Trakteffekt", text: "Farlig i sterk vind", style: "hazard" }, geometry: { type: "Point", coordinates: [16.411, 68.805] } },
        { type: "Feature", properties: { kind: "area", title: "Rotorsone", style: "hazard" }, geometry: { type: "Polygon", coordinates: [[[16.41, 68.8], [16.42, 68.8], [16.42, 68.81], [16.41, 68.8]]] } },
      ] },
    },
  },
};
const geo = sitesToGeoJSON([site], "https://flysteder.hpgt.com", new Date("2026-10-05T08:00:00Z"));
const kinds = (k) => geo.features.filter((f) => f.properties.kind === k);

test("GeoJSON har lisens og alle typer, med [lon, lat]", () => {
  assert.equal(geo.license.name, "CC BY 4.0");
  assert.equal(kinds("launch").length, 2); // hovedstart + start med egen posisjon, ikke den uten posisjon
  assert.deepEqual(kinds("launch")[0].geometry.coordinates, [16.4, 68.8]);
  assert.deepEqual(kinds("launch")[0].properties.directions_primary, ["S", "SW"]);
  assert.equal(kinds("landing").length, 1);
  assert.equal(kinds("parking").length, 1);
  assert.deepEqual(kinds("route")[0].geometry.coordinates[0], [16.42, 68.79]);
  assert.equal(kinds("route")[0].properties.gpx_url, "https://flysteder.hpgt.com/flysteder/testfjell/testfjell-route.gpx");
  assert.equal(kinds("drawing_label").length, 1);
  assert.equal(kinds("drawing_label")[0].properties.name, "Masta");
  assert.equal(geo.features[0].properties.site_url, "https://flysteder.hpgt.com/flysteder/testfjell/");
});

test("stedstekster og farer er ikke med", () => {
  const json = JSON.stringify(geo);
  assert.doesNotMatch(json, /Tekst som ikke skal med|Uten posisjon|Skal ikke med|Rotor|Trakteffekt|Farlig|hazard/);
});

test("KML er gyldig og har én mappe per sted, med tegn escapet", () => {
  const kml = geoJSONToKML(geo);
  assert.match(kml, /^<\?xml/);
  assert.equal((kml.match(/<Folder>/g) || []).length, 1);
  assert.equal((kml.match(/<Placemark>/g) || []).length, geo.features.length);
  assert.match(kml, /Testfjell &amp; co/);
  assert.match(kml, /<coordinates>16.4,68.8<\/coordinates>/);
  assert.match(kml, /CC BY 4.0/);
});
