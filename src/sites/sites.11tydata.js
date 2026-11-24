import fs from "node:fs";
import path from "node:path";
import { processRoute } from "../../lib/gpx.js";
import { lastModified } from "../../lib/git.js";
import { sourceLabel, groupLaunches, formatDate } from "../../lib/format.js";
import { dict, fmt, localeUrl } from "../../lib/i18n.js";
import { readTranslations, overlay, introText, TRANSLATABLE } from "../../lib/translations.js";
import { processImage } from "../../lib/images.js";
import { listSiteImages, featuredImages, imageCaption, imageAlt } from "../../lib/site-images.js";
import { readCachedAirspace, ceilingOverLaunch, applyManualAirspace, readAirspaceChecked, airspaceAgeDays, AIRSPACE_STALE_DAYS } from "../../lib/airspace.js";
import { readDrawing } from "../../lib/drawing.js";

// Innledningen (teksten før første ##) som ren tekst, til kortet på forsiden.
function readIntro(inputPath) {
  return introText(fs.readFileSync(inputPath, "utf8").replace(/^---[\s\S]*?\n---\s*/, ""));
}

// Én linje med stedets kilder, nederst på stedssiden, skilt med «|».
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
  if (airspace) lines.push(fmt(t.airspaceFetched, { checked: formatDate(airspace.checked ?? airspace.fetched, lang), date: formatDate(airspace.fetched, lang) }));
  else add(t.airspace, unique(data.airspace));
  if (routes.length) {
    const elevationSources = [...new Set(routes.map((r) => r.elevationSource).filter(Boolean))];
    lines.push(t.route + (elevationSources.length ? fmt(t.routeHeights, { sources: elevationSources.join("/") }) : ""));
  }
  return lines.join(" | ");
}

// De samme kildene som en kort liste med navn, til én linje nederst på stedssiden: «Flightlog, Kartverket,
// openAIP, GPS-spor og lokalkunnskap». Detaljene per felt står i describeSources, brettet under.
function shortSources(data, routes, airspace, lang) {
  const t = dict(lang).sources;
  const keys = [data.launch?.source, data.elevation?.source, data.wind_directions?.source,
    ...(data.landings ?? []).map((x) => x.source), ...(data.parking ?? []).map((x) => x.source),
    ...(airspace ? [] : (data.airspace ?? []).map((x) => x.source))]
    .filter(Boolean).flatMap((k) => String(k).split("/"));
  if (airspace) keys.push("openaip");
  if (routes.length) keys.push("gpx", ...routes.map((r) => r.elevationSource).filter(Boolean).map((x) => String(x).toLowerCase()));
  // Fast rekkefølge, så linja er lik på hver side. Verdier uten kortnavn (manual) utelates.
  const names = [...new Set(keys)].filter((k) => t.short[k]).sort((a, b) => Object.keys(t.short).indexOf(a) - Object.keys(t.short).indexOf(b)).map((k) => t.short[k]);
  if (names.length < 2) return names.join("");
  return names.slice(0, -1).join(", ") + " " + t.and + " " + names.at(-1);
}

export default {
  layout: "site.njk",
  pagination: { data: "languages", size: 1, alias: "language" },
  eleventyComputed: {
    permalink: (data) => localeUrl(`/flysteder/${data.id}/`, data.language.code),
    // Verdier som regnes ut ved bygging. Skrives aldri tilbake til stedsfilen.
    derived: async (data) => {
      const inputPath = data.page.inputPath;
      const dir = path.dirname(inputPath);
      const lang = data.language?.code ?? "nb";
      // Oversettelsene (index.<lang>.md), og den for sidens språk. null på norsk, eller når den mangler.
      const translations = readTranslations(inputPath);
      const tr = lang === "nb" ? null : translations[lang] ?? null;
      const trData = tr?.data ?? {};
      // Tekstfeltene i stedsfilen med oversettelsen lagt over. Malen bruker disse i stedet for hazards osv.
      const local = {
        hazards: overlay(data.hazards, trData.hazards, TRANSLATABLE.hazards),
        launches: overlay(data.launches, trData.launches, TRANSLATABLE.launches),
        landings: overlay(data.landings, trData.landings, TRANSLATABLE.landings),
        // En «Parkering» uten noe mer er standardnavnet, og vises på sidens språk.
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
          // Tid fra GPX-en når filen har tidsstempler, ellers gangtiden som er oppgitt i stedsfilen.
          walkTimeMin: gpx.movingTimeMin ?? r.walk_time_min ?? null,
          walkTimeFromGpx: gpx.movingTimeMin !== null,
          url: `/flysteder/${data.id}/${r.file}`,
        });
      }
      // Alle bildene i mappa, gjenkjent på filnavnet (lib/site-images.js), i visningsrekkefølge.
      // Siden viser det første oversikts-, start- og landingsbildet. Resten vises i lysboksen.
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
          // i halv bredde under. På mobil er siden høyst 640 px bred.
          sizes: slot === 0 ? "(min-width: 1024px) 400px, (min-width: 640px) 608px, 100vw" : "(min-width: 1024px) 200px, (min-width: 640px) 304px, 50vw",
        });
        images.push({ ...processed, ...img, index, alt, caption: imageCaption(img, lang), featured: slot !== -1 });
      }

      // Luftrom hentet fra openAIP med `npm run airspace`. null hvis stedet ikke er hentet ennå.
      const cached = readCachedAirspace(data.id);
      // checked: når det sist ble sjekket mot openAIP (også uten endringer); fetched: når det sist ble endret.
      const checked = readAirspaceChecked();
      const airspace = cached ? {
        ...cached,
        airspaces: applyManualAirspace(cached.airspaces, local.airspace),
        checked,
        stale: checked ? airspaceAgeDays(checked) > AIRSPACE_STALE_DAYS : true,
        staleDays: AIRSPACE_STALE_DAYS,
      } : null;

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
        // Oversatt tekst for denne siden (html med ## Launch osv.), eller null: da vises den norske teksten.
        translation: tr ? { html: tr.html, outdated: tr.outdated } : null,
        // Alle oversettelsene, til forsiden (innledningen) og statussiden.
        translations: Object.fromEntries(Object.entries(translations).map(([code, x]) => [code, { intro: x.intro, outdated: x.outdated }])),
        // Tegningen til 3D-visningen, eller null. Validert i lib/validation.js.
        drawing: (() => { try { return readDrawing(dir, data.id); } catch { return null; } })(),
      };
    },
  },
};
