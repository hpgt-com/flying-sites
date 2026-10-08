import fs from "node:fs";
import path from "node:path";
import { processRoute } from "../../lib/gpx.js";
import { lastModified } from "../../lib/git.js";
import { sourceLabel, groupLaunches, formatDate } from "../../lib/format.js";
import { dict, fmt } from "../../lib/i18n.js";
import { readTranslations, overlay, introText, TRANSLATABLE } from "../../lib/translations.js";
import { processImage } from "../../lib/images.js";
import { listSiteImages, featuredImages, imageCaption, imageAlt } from "../../lib/site-images.js";
import { readCachedAirspace, ceilingOverLaunch, applyManualAirspace } from "../../lib/airspace.js";
import { readDrawing } from "../../lib/drawing.js";

// Ingressen (teksten før første ##) som ren tekst, til kortet på forsiden.
function readIntro(inputPath) {
  return introText(fs.readFileSync(inputPath, "utf8").replace(/^---[\s\S]*?\n---\s*/, ""));
}

// Én linje med kildene for stedet, til bunnen av stedssiden, skilt med «|».
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

export default {
  layout: "site.njk",
  pagination: { data: "languages", size: 1, alias: "language" },
  eleventyComputed: {
    permalink: (data) => `${data.language.prefix}/flysteder/${data.id}/`,
    // Verdier som regnes ut ved bygging. Skrives aldri tilbake til stedsfilen.
    derived: async (data) => {
      const inputPath = data.page.inputPath;
      const dir = path.dirname(inputPath);
      const lang = data.language?.code ?? "nb";
      // Oversettelsene (index.<språk>.md), og den for denne sidens språk. null på norsk, eller når den mangler.
      const translations = readTranslations(inputPath);
      const tr = lang === "nb" ? null : translations[lang] ?? null;
      const trData = tr?.data ?? {};
      // Tekstfeltene fra stedsfilen med oversettelsen lagt over. Malen bruker disse i stedet for hazards osv.
      const local = {
        hazards: overlay(data.hazards, trData.hazards, TRANSLATABLE.hazards),
        launches: overlay(data.launches, trData.launches, TRANSLATABLE.launches),
        landings: overlay(data.landings, trData.landings, TRANSLATABLE.landings),
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
          // Tid fra GPX når filen har tidsstempler, ellers oppgitt gåtid i stedsfilen.
          walkTimeMin: gpx.movingTimeMin ?? r.walk_time_min ?? null,
          walkTimeFromGpx: gpx.movingTimeMin !== null,
          url: `/flysteder/${data.id}/${r.file}`,
        });
      }
      // Alle bildene i mappen, funnet ut fra filnavnet (lib/site-images.js), i visningsrekkefølge.
      // Siden viser første oversiktsbilde, første start og første landing. Resten vises i bildevisningen.
      const found = listSiteImages(dir, data.id).images;
      const featured = featuredImages(found);
      const images = [];
      for (const [index, img] of found.entries()) {
        const slot = featured.indexOf(img);
        const alt = imageAlt(img, data.name, lang);
        const processed = await processImage(dir, img.file, {
          alt,
          outputDir: data.eleventy.directories.output,
          // Bilder-blokken i høyre kolonne (site.njk): det første bildet stort over hele kolonnen, de to neste
          // halvparten under. På mobil er siden høyst 640 px bred.
          sizes: slot === 0 ? "(min-width: 1024px) 400px, (min-width: 640px) 608px, 100vw" : "(min-width: 1024px) 200px, (min-width: 640px) 304px, 50vw",
        });
        images.push({ ...processed, ...img, index, alt, caption: imageCaption(img, lang), featured: slot !== -1 });
      }

      // Luftrom hentet fra openAIP med `npm run airspace`. null hvis stedet ikke er hentet ennå.
      const cached = readCachedAirspace(data.id);
      const airspace = cached ? { ...cached, airspaces: applyManualAirspace(cached.airspaces, local.airspace) } : null;

      return {
        routes,
        images,
        airspace,
        airspaceCeiling: airspace ? ceilingOverLaunch(airspace.airspaces, data.elevation?.launch_masl) : null,
        lastModified: lastModified(inputPath),
        sources: describeSources(data, routes, airspace, lang),
        intro: tr?.intro || readIntro(inputPath),
        launchGroups: groupLaunches(local.launches),
        local,
        // Oversatt tekst for denne siden (html med ## Launch osv.), eller null: da vises den norske teksten.
        translation: tr ? { html: tr.html, outdated: tr.outdated } : null,
        // Alle oversettelsene, til forsiden (ingressen) og statussiden.
        translations: Object.fromEntries(Object.entries(translations).map(([code, x]) => [code, { intro: x.intro, outdated: x.outdated }])),
        // Tegningen til 3D-visningen, eller null. Valideres i lib/validation.js.
        drawing: (() => { try { return readDrawing(dir, data.id); } catch { return null; } })(),
      };
    },
  },
};
