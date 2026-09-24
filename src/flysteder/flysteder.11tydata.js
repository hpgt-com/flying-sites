import fs from "node:fs";
import path from "node:path";
import { processRoute } from "../../lib/gpx.js";
import { lastModified } from "../../lib/git.js";
import { sourceLabel } from "../../lib/format.js";
import { processImage } from "../../lib/images.js";
import { readCachedAirspace, ceilingOverLaunch } from "../../lib/airspace.js";
import site from "../_data/site.js";

// Ingressen (teksten før første ##) som ren tekst, til kortet på forsiden.
function readIntro(inputPath) {
  const raw = fs.readFileSync(inputPath, "utf8").replace(/^---[\s\S]*?\n---\s*/, "");
  return raw
    .split(/^## /m)[0]
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Én linje med kildene for stedet, til bunnen av stedssiden.
function describeSources(data, routes, airspace) {
  const lines = [];
  const add = (what, source) => source && lines.push(`${what}: ${sourceLabel(source)}`);
  const unique = (list) => [...new Set((list ?? []).map((x) => x.source))].map(sourceLabel).join(", ");
  add("Startkoordinat", data.launch?.source);
  add("Høyder", data.elevation?.source);
  add("Retninger", data.wind_directions?.source);
  add("Landing", unique(data.landings));
  add("Parkering", unique(data.parking));
  if (airspace) lines.push(`Luftrom: openAIP (CC BY-NC 4.0), hentet ${airspace.fetched.split("-").reverse().join(".")}`);
  else add("Luftrom", unique(data.airspace));
  if (routes.length) {
    const elevationSources = [...new Set(routes.map((r) => r.elevationSource).filter(Boolean))];
    lines.push(`Gangrute: logget tur (GPX)${elevationSources.length ? `, høyder fra ${elevationSources.join("/")}` : ""}`);
  }
  return lines.join(". ") + (lines.length ? "." : "");
}

export default {
  layout: "site.njk",
  eleventyComputed: {
    permalink: (data) => (site.publishedSites.includes(data.id) ? `/flysteder/${data.id}/` : false),
    // Verdier som regnes ut ved bygging. Skrives aldri tilbake til stedsfilen.
    derived: async (data) => {
      const inputPath = data.page.inputPath;
      const dir = path.dirname(inputPath);
      const routes = [];
      for (const r of data.access?.routes ?? []) {
        if (!r.file) continue;
        const gpx = await processRoute(dir, data.id, r.file);
        routes.push({
          ...gpx,
          name: r.name,
          // Tid fra GPX når filen har tidsstempler, ellers oppgitt gåtid i stedsfilen.
          walkTimeMin: gpx.movingTimeMin ?? r.walk_time_min ?? null,
          walkTimeFromGpx: gpx.movingTimeMin !== null,
          url: `/flysteder/${data.id}/${r.file}`,
        });
      }
      // Bildene lages bare for steder med egen side.
      const hasPage = site.publishedSites.includes(data.id);
      const images = {};
      const IMAGE_ALT = {
        overview: `Oversiktsbilde over ${data.name} med starter og landing tegnet inn`,
        launch: `Startområdet på ${data.name}`,
        landing: `Landingen ved ${data.name}`,
        air: `${data.name} sett fra luften`,
      };
      for (const field of hasPage ? Object.keys(IMAGE_ALT) : []) {
        const file = data.images?.[field];
        if (!file) continue;
        images[field] = await processImage(dir, data.id, field, file, {
          alt: IMAGE_ALT[field],
          outputDir: data.eleventy.directories.output,
          // Oversikten fyller venstre kolonne. De andre er småbilder i tre kolonner nederst.
          sizes: field === "overview" ? "(min-width: 1024px) 700px, 100vw" : "(min-width: 1024px) 220px, (min-width: 640px) 33vw, 100vw",
        });
      }

      // Luftrom hentet fra openAIP med `npm run airspace`. null hvis stedet ikke er hentet ennå.
      const airspace = readCachedAirspace(data.id);

      return {
        routes,
        images,
        airspace,
        airspaceCeiling: airspace ? ceilingOverLaunch(airspace.airspaces, data.elevation?.launch_masl) : null,
        lastModified: lastModified(inputPath),
        sources: describeSources(data, routes, airspace),
        intro: readIntro(inputPath),
        hasPage,
      };
    },
  },
};
