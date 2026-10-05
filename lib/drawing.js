// Tegningen til kartet på stedssiden: `<id>-drawing.geojson` i stedets mappe (valgfri).
// Erstatter de tegnede oversiktsbildene. Punkter, linjer og områder lagres som data, så de kan endres
// i en PR i stedet for å tegnes på nytt i et bildeprogram.
//
// Filen er en vanlig GeoJSON FeatureCollection (kan tegnes i geojson.io), med et valgfritt ekstra felt:
//   direction_arc: { center: [lon, lat], radius }   midten og radiusen (m) til retningsbuen, når den
//                                                   skal stå et annet sted enn det som regnes ut.
// Hvert objekt har `properties.kind`:
//   label  (Point)       nummerert punkt i kartet, med title og text i listen under kartet. style: hazard gir rød firkant.
//   path   (LineString)  linje. style: launch (gul startkant langs ryggen), flight (flyvei), hazard, info.
//                        dashed og arrow er true/false.
//   area   (Polygon)     område, for eksempel rotor eller synk. style: hazard | launch | landing | info.
// Start, landing, parkering, gangrute og pilene for hvilken retning hver start passer for, tegnes fra
// stedsfilen og skal ikke ligge i tegningen.

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

// Tegningen for et sted, eller null når stedet ikke har en.
export function readDrawing(dir, id) {
  const file = drawingFile(dir, id);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

const isPosition = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

// Feil i tegningen som tekst, tom liste når den er gyldig. `launch` brukes til å fange byttet lon/lat.
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
