// Åpne datafiler med flystedene, laget ved hver bygging: /flysteder.geojson og /flysteder.kml.
// Bare strukturerte data (posisjoner, retninger, nivå, kategorier, høyder, gangruter og tegningene),
// ikke stedstekstene, farene eller grunneierforhold. Farer i tegningen (style: hazard) er heller ikke med:
// de skal leses i sammenheng på stedssiden, der de holdes oppdatert. Tekstene bygger delvis på den gamle oversikten
// til Lars Sletten og hører hjemme på stedssidene. Lisens: CC BY 4.0, se LICENSE_DATA.

import { DIRECTIONS } from "./format.js";

export const DATA_LICENSE = {
  name: "CC BY 4.0",
  url: "https://creativecommons.org/licenses/by/4.0/deed.no",
  attribution: "HPGT flysteder (https://flysteder.hpgt.com)",
  note: "Veiledende data, ikke for navigasjon. Sjekk alltid stedssiden, IPPC og forholdene selv.",
};

const sorted = (list) => DIRECTIONS.filter((d) => (list ?? []).includes(d));
const point = (lat, lon) => ({ type: "Point", coordinates: [lon, lat] });

// Én FeatureCollection for alle stedene. `sites` er [{ data, url }] fra collections.sites,
// `siteUrl` er adressen til nettstedet (absolutte lenker i filen).
export function sitesToGeoJSON(sites, siteUrl, generated = new Date()) {
  const features = [];
  for (const { data: d, url } of sites) {
    const base = { site_id: d.id, site_name: d.name, site_url: new URL(url, siteUrl).href };
    const primary = sorted(d.wind_directions?.primary);
    const possible = sorted(d.wind_directions?.possible);

    // Hovedstarten med stedets retninger og fakta.
    features.push({
      type: "Feature",
      properties: {
        ...base,
        kind: "launch",
        main: true,
        name: d.name,
        directions_primary: primary,
        directions_possible: possible,
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
    // Starter med egen posisjon (launches[].lat/lon).
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
          length_km: r.lengthKm ?? null,
          elevation_gain_m: r.elevationGain ?? null,
          gpx_url: r.url ? new URL(r.url, siteUrl).href : null,
        },
        geometry: { type: "LineString", coordinates: r.line.map(([lat, lon]) => [lon, lat]) },
      });
    }
    // Tegningen (<id>-drawing.geojson): klubbens egne punkter, linjer og områder, uten farene.
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

function placemarkDescription(p) {
  const rows = [];
  if (p.kind === "launch" && p.main) {
    if (p.directions_primary.length) rows.push(`Hovedretning: ${p.directions_primary.join(", ")}`);
    if (p.directions_possible.length) rows.push(`Mulig: ${p.directions_possible.join(", ")}`);
    if (p.level) rows.push(`Nivå: ${p.level}`);
    if (p.elevation_m != null) rows.push(`Høyde: ${p.elevation_m} moh`);
  } else if (p.kind === "launch") {
    rows.push(`Retninger: ${p.directions.join(", ")}`);
  } else if (p.kind === "route" && p.length_km) {
    rows.push(`${String(p.length_km).replace(".", ",")} km`);
  }
  if (p.text) rows.push(p.text);
  rows.push(p.site_url);
  return rows.map(xml).join("<br>");
}

// KML for Google Earth, norgeskart.no og kartapper. Én mappe per sted.
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
      return `      <Placemark><name>${xml(p.name)}</name><styleUrl>#${style}</styleUrl><description><![CDATA[${placemarkDescription(p)}]]></description>${geometry}</Placemark>`;
    }).filter(Boolean).join("\n");
    return `    <Folder><name>${xml(site.name)}</name>\n${marks}\n    </Folder>`;
  }).join("\n");
  const l = collection.license;
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>HPGT flysteder</name>
    <description><![CDATA[${xml(`${l.attribution}. Lisens: ${l.name} (${l.url}). ${l.note} Laget ${collection.generated}.`)}]]></description>
    ${styles}
${folders}
  </Document>
</kml>
`;
}
