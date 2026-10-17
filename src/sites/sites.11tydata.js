import fs from "node:fs";
import path from "node:path";
import { processRoute } from "../../lib/gpx.js";
import { lastModified } from "../../lib/git.js";
import { sourceLabel, groupLaunches, formatDate } from "../../lib/format.js";
import { dict, fmt, localeUrl } from "../../lib/i18n.js";
import { readTranslations, overlay, introText, TRANSLATABLE } from "../../lib/translations.js";
import { processImage } from "../../lib/images.js";
import { listSiteImages, featuredImages, imageCaption, imageAlt } from "../../lib/site-images.js";
import { readCachedAirspace, ceilingOverLaunch, applyManualAirspace } from "../../lib/airspace.js";
import { readDrawing } from "../../lib/drawing.js";

// The intro (text before the first ##) as plain text, for the card on the home page.
function readIntro(inputPath) {
  return introText(fs.readFileSync(inputPath, "utf8").replace(/^---[\s\S]*?\n---\s*/, ""));
}

// One line with the site's sources, for the bottom of the site page, separated by «|».
function describeSources(data, routes, airspace, lang) {
  const t = dict(lang).sources;
  const lines = [];
  const add = (what, source) => source && lines.push(`${what}: ${sourceLabel(source, lang)}`);
  const unique = (list) => [...new Set((list ?? []).map((x) => x.source))].map((x) => sourceLabel(x, lang)).join(", ");
  add(t.launch, data.launch?.source);
  add(t.heights, data.elevation?.source);
  add(t.directions, data.wind_directions?.source);
  add(t.landing, unique(data.landings));
  add(t.parking, unique(data.parking));
  if (airspace) lines.push(fmt(t.airspaceFetched, { date: formatDate(airspace.fetched, lang) }));
  else add(t.airspace, unique(data.airspace));
  if (routes.length) {
    const elevationSources = [...new Set(routes.map((r) => r.elevationSource).filter(Boolean))];
    lines.push(t.route + (elevationSources.length ? fmt(t.routeHeights, { sources: elevationSources.join("/") }) : ""));
  }
  return lines.join(" | ");
}

// The same sources as a short list of names, for one line at the bottom of the site page: «Flightlog, Kartverket,
// openAIP, GPS-spor og lokalkunnskap». The details per field are in describeSources, folded below it.
function shortSources(data, routes, airspace, lang) {
  const t = dict(lang).sources;
  const keys = [data.launch?.source, data.elevation?.source, data.wind_directions?.source,
    ...(data.landings ?? []).map((x) => x.source), ...(data.parking ?? []).map((x) => x.source),
    ...(airspace ? [] : (data.airspace ?? []).map((x) => x.source))]
    .filter(Boolean).flatMap((k) => String(k).split("/"));
  if (airspace) keys.push("openaip");
  if (routes.length) keys.push("gpx", ...routes.map((r) => r.elevationSource).filter(Boolean).map((x) => String(x).toLowerCase()));
  // Fixed order, so the line reads the same on every page. Values without a short name (manual) are left out.
  const names = [...new Set(keys)].filter((k) => t.short[k]).sort((a, b) => Object.keys(t.short).indexOf(a) - Object.keys(t.short).indexOf(b)).map((k) => t.short[k]);
  if (names.length < 2) return names.join("");
  return names.slice(0, -1).join(", ") + " " + t.and + " " + names.at(-1);
}

export default {
  layout: "site.njk",
  pagination: { data: "languages", size: 1, alias: "language" },
  eleventyComputed: {
    permalink: (data) => localeUrl(`/flysteder/${data.id}/`, data.language.code),
    // Values computed at build time. Never written back to the site file.
    derived: async (data) => {
      const inputPath = data.page.inputPath;
      const dir = path.dirname(inputPath);
      const lang = data.language?.code ?? "nb";
      // The translations (index.<lang>.md), and the one for this page's language. null in Norwegian, or when missing.
      const translations = readTranslations(inputPath);
      const tr = lang === "nb" ? null : translations[lang] ?? null;
      const trData = tr?.data ?? {};
      // The site file's text fields with the translation laid over them. The template uses these instead of hazards etc.
      const local = {
        hazards: overlay(data.hazards, trData.hazards, TRANSLATABLE.hazards),
        launches: overlay(data.launches, trData.launches, TRANSLATABLE.launches),
        landings: overlay(data.landings, trData.landings, TRANSLATABLE.landings),
        // A bare «Parkering» is the default name, and is shown in the page's language.
        parking: overlay(data.parking, trData.parking, TRANSLATABLE.parking)
          .map((p) => (p && p.name === "Parkering" && lang !== "nb" ? { ...p, name: dict(lang).site.parking } : p)),
        links: overlay(data.links, trData.links, TRANSLATABLE.links),
        airspace: overlay(data.airspace, trData.airspace, TRANSLATABLE.airspace),
        access: { ...data.access, ...Object.fromEntries(["parking_text", "route_text"].filter((k) => trData.access?.[k]).map((k) => [k, trData.access[k]])) },
        season: trData.season || data.season,
      };
      const routeNames = overlay(data.access?.routes, trData.routes, TRANSLATABLE.routes).map((r) => r.name);
      const routes = [];
      for (const [i, r] of (data.access?.routes ?? []).entries()) {
        if (!r.file) continue;
        const gpx = await processRoute(dir, data.id, r.file);
        routes.push({
          ...gpx,
          name: routeNames[i] ?? r.name,
          // Time from the GPX when the file has timestamps, otherwise the walking time given in the site file.
          walkTimeMin: gpx.movingTimeMin ?? r.walk_time_min ?? null,
          walkTimeFromGpx: gpx.movingTimeMin !== null,
          url: `/flysteder/${data.id}/${r.file}`,
        });
      }
      // All images in the folder, identified by file name (lib/site-images.js), in display order.
      // The page shows the first overview, launch and landing image. The rest are shown in the lightbox.
      const found = listSiteImages(dir, data.id).images;
      const featured = featuredImages(found);
      const images = [];
      for (const [index, img] of found.entries()) {
        const slot = featured.indexOf(img);
        const alt = imageAlt(img, data.name, lang);
        const processed = await processImage(dir, img.file, {
          alt,
          outputDir: data.eleventy.directories.output,
          // The Bilder block in the right column (site.njk): the first image large across the whole column, the next two
          // at half width below. On mobile the page is at most 640 px wide.
          sizes: slot === 0 ? "(min-width: 1024px) 400px, (min-width: 640px) 608px, 100vw" : "(min-width: 1024px) 200px, (min-width: 640px) 304px, 50vw",
        });
        images.push({ ...processed, ...img, index, alt, caption: imageCaption(img, lang), featured: slot !== -1 });
      }

      // Airspace fetched from openAIP with `npm run airspace`. null if the site has not been fetched yet.
      const cached = readCachedAirspace(data.id);
      const airspace = cached ? { ...cached, airspaces: applyManualAirspace(cached.airspaces, local.airspace) } : null;

      return {
        routes,
        images,
        airspace,
        airspaceCeiling: airspace ? ceilingOverLaunch(airspace.airspaces, data.elevation?.launch_masl) : null,
        lastModified: lastModified(inputPath),
        sources: describeSources(data, routes, airspace, lang),
        sourcesShort: shortSources(data, routes, airspace, lang),
        intro: tr?.intro || readIntro(inputPath),
        launchGroups: groupLaunches(local.launches),
        local,
        // Translated text for this page (html with ## Launch etc.), or null: the Norwegian text is shown then.
        translation: tr ? { html: tr.html, outdated: tr.outdated } : null,
        // All translations, for the home page (the intro) and the status page.
        translations: Object.fromEntries(Object.entries(translations).map(([code, x]) => [code, { intro: x.intro, outdated: x.outdated }])),
        // The drawing for the 3D view, or null. Validated in lib/validation.js.
        drawing: (() => { try { return readDrawing(dir, data.id); } catch { return null; } })(),
      };
    },
  },
};
