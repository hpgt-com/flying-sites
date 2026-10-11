// Open data files with the sites, generated on every build: /flysteder.geojson and /flysteder.kml.
// Only structured data (positions, directions, level, categories, elevations, walking routes and drawings),
// not the site texts, hazards or landowner arrangements. Hazards in the drawing (style: hazard) are excluded too:
// they should be read in context on the site page, where they are kept up to date. The texts are partly based on
// Lars Sletten's old overview and belong on the site pages. License: CC BY 4.0, see LICENSE_DATA.

import { DIRECTIONS, directionLabel } from "./format.js";

export const DATA_LICENSE = {
  name: "CC BY 4.0",
  url: "https://creativecommons.org/licenses/by/4.0/deed.no",
  attribution: "HPGT flysteder (https://flysteder.hpgt.com)",
  note: "Veiledende data, ikke for navigasjon. Sjekk alltid stedssiden, IPPC og forholdene selv.",
};

const sorted = (list) => DIRECTIONS.filter((d) => (list ?? []).includes(d));
const point = (lat, lon) => ({ type: "Point", coordinates: [lon, lat] });
const round = (n, decimals = 0) => (n == null ? null : Math.round(n * 10 ** decimals) / 10 ** decimals);

// Launches by category and directions, without text or duplicate rows (two PG/SPG launches facing Ø–S become one).
function launchGroups(d) {
  const groups = new Map();
  for (const l of d.launches ?? []) {
    const g = { categories: l.categories ?? d.categories ?? [], directions: sorted(l.directions) };
    groups.set(JSON.stringify(g), g);
  }
  return [...groups.values()];
}

// One FeatureCollection for all sites. `sites` is [{ data, url }] from collections.sites,
// `siteUrl` is the website's base URL (for absolute links in the file).
export function sitesToGeoJSON(sites, siteUrl, generated = new Date()) {
  const features = [];
  for (const { data: d, url } of sites) {
    const base = { site_id: d.id, site_name: d.name, site_url: new URL(url, siteUrl).href, municipality: d.municipality ?? null };
    const primary = sorted(d.wind_directions?.primary);
    const possible = sorted(d.wind_directions?.possible);

    // The main launch with the site's directions and facts.
    features.push({
      type: "Feature",
      properties: {
        ...base,
        kind: "launch",
        main: true,
        name: d.name,
        directions_primary: primary,
        directions_possible: possible,
        // Launches by category and direction (as on the site page, without text): Elgen has PG in all directions and SPG facing NØ–SV.
        launch_groups: launchGroups(d),
        level: d.level ?? null,
        training_site: !!d.training_site,
        categories: d.categories ?? [],
        elevation_m: d.elevation?.launch_masl ?? null,
        height_difference_m: d.elevation?.difference_m ?? null,
        reviewed: !!(d.reviewed?.by && d.reviewed?.date),
        source: d.launch?.source ?? null,
      },
      geometry: point(d.launch.lat, d.launch.lon),
    });
    // Launches with their own position (launches[].lat/lon).
    for (const l of d.launches ?? []) {
      if (l.lat == null || l.lon == null) continue;
      features.push({
        type: "Feature",
        properties: {
          ...base,
          kind: "launch",
          main: false,
          name: `${d.name} (${sorted(l.directions).join(", ")})`,
          directions: sorted(l.directions),
          categories: l.categories ?? d.categories ?? [],
          source: l.source ?? null,
        },
        geometry: point(l.lat, l.lon),
      });
    }
    for (const l of d.landings ?? []) {
      features.push({
        type: "Feature",
        properties: { ...base, kind: "landing", name: l.name || "Landing", primary: l.primary !== false, source: l.source ?? null },
        geometry: point(l.lat, l.lon),
      });
    }
    for (const p of d.parking ?? []) {
      features.push({
        type: "Feature",
        properties: { ...base, kind: "parking", name: p.name || "Parkering", source: p.source ?? null },
        geometry: point(p.lat, p.lon),
      });
    }
    for (const r of d.derived?.routes ?? []) {
      if (!r.line?.length) continue;
      features.push({
        type: "Feature",
        properties: {
          ...base,
          kind: "route",
          name: r.name || "Gangrute",
          length_km: round(r.lengthKm, 1),
          elevation_gain_m: round(r.elevationGain),
          gpx_url: r.url ? new URL(r.url, siteUrl).href : null,
        },
        geometry: { type: "LineString", coordinates: r.line.map(([lat, lon]) => [lon, lat]) },
      });
    }
    // The drawing (<id>-drawing.geojson): the club's own points, lines and areas, without the hazards.
    for (const f of d.derived?.drawing?.features ?? []) {
      const p = f.properties ?? {};
      if (p.style === "hazard") continue;
      features.push({
        type: "Feature",
        properties: { ...base, kind: `drawing_${p.kind}`, name: p.title ?? null, text: p.text ?? null, style: p.style ?? null },
        geometry: f.geometry,
      });
    }
  }
  return {
    type: "FeatureCollection",
    name: "HPGT flysteder",
    generated: generated.toISOString(),
    license: DATA_LICENSE,
    features,
  };
}

const xml = (s) => String(s ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);
const coords = (list) => list.map(([lon, lat]) => `${lon},${lat}`).join(" ");
const STYLES = { launch: "1B6E80", landing: "1C2B33", parking: "2F6FB5", route: "1C2B33", drawing: "C24A12" };

// The KML file is in Norwegian, with Norwegian directions (NØ, SØ). The GeoJSON file uses the codes (NE, SE).
const dirs = (list) => (list ?? []).map((c) => directionLabel(c, "nb")).join(", ");
const GENERIC = /^(landing|parkering|gangrute)$/i;
const named = (prefix, name) => (name && !GENERIC.test(name) ? `${prefix}: ${name}` : prefix);

// The KML name states the site and what the point is, so the file can be read without the site page:
// «Elgen – start», «Elgen – start SPG (NØ, Ø, SØ)», «Elgen – hovedlanding: Aun», «Elgen – parkering: P kapellet».
function placemarkName(p) {
  const site = p.site_name;
  if (p.kind === "launch" && p.main) return `${site} – start`;
  if (p.kind === "launch") return `${site} – start ${p.categories.join("/")} (${dirs(p.directions)})`.replace("start  (", "start (");
  if (p.kind === "landing") return `${site} – ${named(p.primary ? "hovedlanding" : "alternativ landing", p.name)}`;
  if (p.kind === "parking") return `${site} – ${named("parkering", p.name)}`;
  if (p.kind === "route") return `${site} – ${named("gangrute", p.name)}`;
  return p.name ? `${site} – ${p.name}` : site;
}

function placemarkDescription(p) {
  const rows = [];
  if (p.kind === "launch" && p.main) {
    rows.push("Hovedstart. Starter med egne punkter i kartet står som egne punkter i filen.");
    if (p.directions_primary.length) rows.push(`Hovedretninger: ${dirs(p.directions_primary)}`);
    if (p.directions_possible.length) rows.push(`Mulige retninger: ${dirs(p.directions_possible)}`);
    for (const g of p.launch_groups ?? []) {
      if (g.directions.length) rows.push(`${g.categories.join("/") || "Start"}: ${dirs(g.directions)}`);
    }
    if (p.categories.length) rows.push(`Kategorier: ${p.categories.join(", ")}`);
    if (p.level) rows.push(`Nivå: ${p.level}`);
    if (p.elevation_m != null) rows.push(`Høyde: ${p.elevation_m} moh`);
  } else if (p.kind === "launch") {
    rows.push(`Egen start${p.categories.length ? ` for ${p.categories.join("/")}` : ""}. Retninger: ${dirs(p.directions)}`);
  } else if (p.kind === "landing") {
    rows.push(p.primary ? "Hovedlanding." : "Alternativ landing.");
  } else if (p.kind === "parking") {
    rows.push("Parkering.");
  } else if (p.kind === "route") {
    rows.push(`Gangrute fra parkering til start${p.length_km ? `, ${String(p.length_km).replace(".", ",")} km` : ""}${p.elevation_gain_m ? `, ${p.elevation_gain_m} høydemeter` : ""}.`);
  }
  if (p.text) rows.push(p.text);
  rows.push(`Se stedssiden: ${p.site_url}`);
  return rows.map(xml).join("<br>");
}

export const DATA_DOCS_URL = "https://github.com/hpgt-com/flying-sites/blob/main/docs/open-data.md";

// KML for Google Earth, norgeskart.no and map apps. One folder per site.
export function geoJSONToKML(collection) {
  const bySite = new Map();
  for (const f of collection.features) {
    const id = f.properties.site_id;
    if (!bySite.has(id)) bySite.set(id, { name: f.properties.site_name, features: [] });
    bySite.get(id).features.push(f);
  }
  const styles = Object.entries(STYLES).map(([id, color]) => {
    const abgr = `ff${color.slice(4, 6)}${color.slice(2, 4)}${color.slice(0, 2)}`.toLowerCase();
    return `<Style id="${id}"><IconStyle><color>${abgr}</color></IconStyle><LineStyle><color>${abgr}</color><width>3</width></LineStyle><PolyStyle><color>40${abgr.slice(2)}</color></PolyStyle></Style>`;
  }).join("\n    ");
  const folders = [...bySite.values()].map((site) => {
    const marks = site.features.map((f) => {
      const p = f.properties, g = f.geometry;
      const style = p.kind.startsWith("drawing") ? "drawing" : p.kind;
      let geometry;
      if (g.type === "Point") geometry = `<Point><coordinates>${g.coordinates.join(",")}</coordinates></Point>`;
      else if (g.type === "LineString") geometry = `<LineString><tessellate>1</tessellate><coordinates>${coords(g.coordinates)}</coordinates></LineString>`;
      else if (g.type === "Polygon") geometry = `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords(g.coordinates[0])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
      else return "";
      return `      <Placemark><name>${xml(placemarkName(p))}</name><styleUrl>#${style}</styleUrl><description><![CDATA[${placemarkDescription(p)}]]></description>${geometry}</Placemark>`;
    }).filter(Boolean).join("\n");
    return `    <Folder><name>${xml(site.name)}</name>\n${marks}\n    </Folder>`;
  }).join("\n");
  const l = collection.license;
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>HPGT flysteder</name>
    <description><![CDATA[${[
      "Flystedene til HPGT (Harstad), én mappe per sted. Hver mappe har hovedstarten (med retninger, kategorier, nivå og høyde), " +
        "starter med egne punkter, hovedlanding og alternative landinger, parkering og gangruter.",
      "Stedstekster, farer og grunneierforhold er ikke med. De står på stedssiden, som det lenkes til fra hvert punkt.",
      `Om formatet (engelsk): ${DATA_DOCS_URL}`,
      `${l.attribution}. Lisens: ${l.name} (${l.url}). ${l.note} Laget ${collection.generated}.`,
    ].map(xml).join("<br><br>")}]]></description>
    ${styles}
${folders}
  </Document>
</kml>
`;
}
