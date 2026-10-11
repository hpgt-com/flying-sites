// The drawing for the map on the site page: `<id>-drawing.geojson` in the site's folder (optional).
// Replaces the hand-drawn overview images. Points, lines and areas are stored as data, so they can be
// changed in a PR instead of redrawn in an image editor.
//
// The file is a plain GeoJSON FeatureCollection (can be drawn in geojson.io), with one optional extra field:
//   direction_arc: { center: [lon, lat], radius }   centre and radius (m) of the direction arc, when it
//                                                   should be placed somewhere other than the computed spot.
// Each feature has `properties.kind`:
//   label  (Point)       numbered point on the map, with title and text in the list below the map. style: hazard gives a red square.
//   path   (LineString)  line. style: launch (yellow launch edge along the ridge), flight (flight path), hazard, info.
//                        dashed and arrow are true/false.
//   area   (Polygon)     area, e.g. rotor or sink. style: hazard | launch | landing | info.
// Launch, landing, parking, walking route and the arrows showing which direction each launch suits are drawn
// from the site file and do not belong in the drawing.

import fs from "node:fs";
import path from "node:path";

export const DRAWING_KINDS = {
  label: { geometry: "Point", styles: ["hazard"] },
  path: { geometry: "LineString", styles: ["launch", "flight", "hazard", "info"] },
  area: { geometry: "Polygon", styles: ["hazard", "launch", "landing", "info"] },
};
const PROPERTY_KEYS = ["kind", "title", "text", "style", "dashed", "arrow", "source"];
const ARC_KEYS = ["center", "radius"];

export function drawingFile(dir, id) {
  return path.join(dir, `${id}-drawing.geojson`);
}

// The drawing for a site, or null when the site has none.
export function readDrawing(dir, id) {
  const file = drawingFile(dir, id);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

const isPosition = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

// Errors in the drawing as text; an empty list when valid. `launch` is used to catch swapped lon/lat.
export function validateDrawing(drawing, launch) {
  const errors = [];
  if (!drawing || drawing.type !== "FeatureCollection" || !Array.isArray(drawing.features)) {
    return ["tegningen må være en GeoJSON FeatureCollection"];
  }
  const near = (p) => !launch || Math.hypot((p[1] - launch.lat) * 111, (p[0] - launch.lon) * 111 * Math.cos(launch.lat * Math.PI / 180)) <= 10;

  const arc = drawing.direction_arc;
  if (arc !== undefined) {
    if (!arc || typeof arc !== "object") errors.push("direction_arc må være { center, radius }");
    else {
      for (const key of Object.keys(arc)) if (!ARC_KEYS.includes(key)) errors.push(`ukjent nøkkel \`direction_arc.${key}\``);
      if (arc.center !== undefined && (!isPosition(arc.center) || !near(arc.center))) errors.push("direction_arc.center må være [lon, lat] nær starten");
      if (arc.radius !== undefined && !(arc.radius >= 50 && arc.radius <= 1500)) errors.push("direction_arc.radius må være mellom 50 og 1500 m");
    }
  }

  drawing.features.forEach((f, i) => {
    const where = `features[${i}]`;
    const p = f?.properties ?? {};
    const kind = DRAWING_KINDS[p.kind];
    if (!kind) return errors.push(`${where}: ukjent kind «${p.kind}» (gyldige: ${Object.keys(DRAWING_KINDS).join(", ")})`);
    for (const key of Object.keys(p)) if (!PROPERTY_KEYS.includes(key)) errors.push(`${where}: ukjent nøkkel \`${key}\``);
    if (f.geometry?.type !== kind.geometry) errors.push(`${where}: ${p.kind} må være ${kind.geometry}, ikke ${f.geometry?.type}`);
    if (p.kind === "label" && !p.title) errors.push(`${where}: label mangler title`);
    if (p.style !== undefined && !kind.styles.includes(p.style)) {
      errors.push(`${where}: ugyldig style «${p.style}» for ${p.kind}${kind.styles.length ? ` (gyldige: ${kind.styles.join(", ")})` : ""}`);
    }
    const c = f.geometry?.coordinates;
    const positions = f.geometry?.type === "Point" ? [c] : f.geometry?.type === "LineString" ? c : f.geometry?.type === "Polygon" ? (c ?? []).flat() : [];
    if (!Array.isArray(positions) || !positions.every(isPosition)) errors.push(`${where}: ugyldige koordinater`);
    else if (!positions.every(near)) errors.push(`${where}: ligger mer enn 10 km fra starten (byttet lon og lat?)`);
  });
  return errors;
}
