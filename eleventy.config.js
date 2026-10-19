import fs from "node:fs";
import * as yaml from "js-yaml";
import { HtmlBasePlugin } from "@11ty/eleventy";
import {
  DIRECTIONS, directionLabel, directionWord, directionType, sortDirections, formatNumber, formatDate, feetToMeters,
  formatLimit, limitMasl, categoryDirections, searchPlaces,
} from "./lib/format.js";
import { validateSite } from "./lib/validation.js";
import { statusSummary } from "./lib/status.js";
import { assetUrl } from "./lib/assets.js";
import { airspaceProfile } from "./lib/airspace-profile.js";
import { fmt, localeUrl } from "./lib/i18n.js";

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(HtmlBasePlugin);

  // GPX files are copied with the same path. Images are not copied: lib/images.js generates display sizes
  // without metadata in _site/img/, so the originals (with EXIF) are never published.
  // Walking routes sit next to the site pages: src/sites/<id>/*.gpx becomes /flysteder/<id>/*.gpx.
  eleventyConfig.addPassthroughCopy({ "src/sites": "flysteder" }, { filter: ["**/*.gpx"] });
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy({ "node_modules/leaflet/dist": "assets/leaflet" });
  eleventyConfig.addPassthroughCopy({ "node_modules/leaflet.markercluster/dist/leaflet.markercluster.js": "assets/leaflet-markercluster/leaflet.markercluster.js" });
  // Fonts from Fontsource (SIL OFL 1.1), Latin subset and used weights only. @font-face is in src/assets/css/fonts.css.
  for (const [pkg, weights] of [["barlow", [400, 600]], ["barlow-condensed", [700]]]) {
    for (const w of weights) {
      eleventyConfig.addPassthroughCopy({ [`node_modules/@fontsource/${pkg}/files/${pkg}-latin-${w}-normal.woff2`]: `assets/fonts/${pkg}-latin-${w}-normal.woff2` });
    }
    eleventyConfig.addPassthroughCopy({ [`node_modules/@fontsource/${pkg}/LICENSE`]: `assets/fonts/LICENSE-${pkg}.txt` });
  }
  // Airspace from openAIP for the map layer (npm run airspace). Loaded only when someone turns on an airspace layer.
  eleventyConfig.addPassthroughCopy({ "src/_data/cache/airspace/region.geojson": "assets/airspace.geojson" });

  eleventyConfig.ignores.add("src/_data/cache/**");
  // Translated site texts (index.en.md etc.) are not pages of their own. They are read by lib/translations.js.
  eleventyConfig.ignores.add("src/sites/*/index.*.md");
  eleventyConfig.addWatchTarget("./lib/");
  // On Windows the file watcher misses files that are rewritten (sed, git checkout, some editors).
  // Polling is a little slower but catches every change. Only affects `npm start`.
  eleventyConfig.setChokidarConfig({ usePolling: true, interval: 500 });

  eleventyConfig.addCollection("sites", (api) => {
    // Site pages exist in every language (pagination in sites.11tydata.js). The collection has one page per site,
    // the Norwegian one. Links to other languages are made with localeUrl.
    const sites = api.getFilteredByGlob("src/sites/*/index.md").filter((s) => (s.data.language?.code ?? "nb") === "nb");
    const errors = sites.flatMap((s) => {
      // Raw front matter, so validation only sees the keys from the site file.
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(s.inputPath, "utf8"));
      return validateSite(s.data, s.inputPath, fm ? yaml.load(fm[1]) : null);
    });
    if (errors.length) {
      throw new Error(`Ugyldige stedsfiler:\n  - ${errors.join("\n  - ")}`);
    }
    return sites.sort((a, b) => a.data.name.localeCompare(b.data.name, "nb"));
  });

  eleventyConfig.addGlobalData("DIRECTIONS", DIRECTIONS);

  // The filters below follow the page language (lang), which Nunjucks provides in this.ctx.
  const langOf = (ctx) => ctx?.lang ?? "nb";
  eleventyConfig.addFilter("directionLabel", function (code) { return directionLabel(code, langOf(this.ctx)); });
  eleventyConfig.addFilter("directionLabels", function (list) { return sortDirections(list).map((c) => directionLabel(c, langOf(this.ctx))).join(", "); });
  eleventyConfig.addFilter("directionWord", function (code) { return directionWord(code, langOf(this.ctx)); });
  // Dictionary text with values filled in: {{ t.site.onFlightlog | fmt({ name: name }) }}.
  eleventyConfig.addFilter("fmt", (text, vars) => fmt(text, vars));
  // Internal URL in the page language (or the given language): {{ "/tarn/" | localeUrl }}.
  eleventyConfig.addFilter("localeUrl", function (url, code) { return localeUrl(url, code ?? langOf(this.ctx)); });
  eleventyConfig.addFilter("directionType", (code, windDirections) => directionType(windDirections, code));
  eleventyConfig.addFilter("sortDirections", sortDirections);
  // Version numbers on CSS/JS, so browsers fetch new files after a change (lib/assets.js).
  eleventyConfig.addFilter("asset", assetUrl);
  eleventyConfig.addFilter("formatNumber", function (n, decimals) { return formatNumber(n, decimals, langOf(this.ctx)); });
  // Distance in km between two points with lat and lon (great circle), for the glide from launch to landing.
  eleventyConfig.addFilter("distanceKm", (a, b) => {
    const r = Math.PI / 180;
    const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  });
  eleventyConfig.addFilter("formatDate", function (iso) { return formatDate(iso, langOf(this.ctx)); });
  eleventyConfig.addFilter("feetToMeters", feetToMeters);
  eleventyConfig.addFilter("formatLimit", function (limit) { return formatLimit(limit, langOf(this.ctx)); });
  eleventyConfig.addFilter("limitMasl", function (limit) { return limitMasl(limit, langOf(this.ctx)); });
  // Height profile from launch to the airspace floor (lib/airspace-profile.js): {{ ceiling | airspaceProfile(launch, landing) | safe }}.
  eleventyConfig.addFilter("airspaceProfile", function (ceiling, launchMasl, landingMasl) { return airspaceProfile(ceiling, launchMasl, landingMasl, langOf(this.ctx)); });
  eleventyConfig.addFilter("capitalizeFirst", (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s));
  eleventyConfig.addFilter("json", (v) => JSON.stringify(v).replace(/</g, "\\u003c"));

  // Extracts part of the rendered Markdown: "intro" (before the first h2) or an h2 section.
  // heading may be a list, e.g. ["Launch", "Start"] when the text may be translated or Norwegian.
  eleventyConfig.addFilter("section", (html, heading) => {
    if (!html) return "";
    const parts = String(html).split(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    if (heading === "intro") return parts[0].trim();
    const wanted = [].concat(heading).map((h) => String(h).toLowerCase());
    for (let i = 1; i < parts.length; i += 2) {
      if (wanted.includes(parts[i].trim().toLowerCase())) return (parts[i + 1] ?? "").trim();
    }
    return "";
  });

  // Summary for the maintenance status page /status/.
  eleventyConfig.addFilter("statusSummary", statusSummary);

  // What the front-page map and cards need about each site.
  // lang: the front page's language. Links go to the site page in the same language, and the intro is translated when available.
  // The sites for the weather page (vaer.njk): enough to place a station on its flying site, draw the site's wind rose
  // and link to it.
  eleventyConfig.addFilter("stationSites", function (sites, lang = "nb") {
    const url = eleventyConfig.getFilter("url");
    return sites.map((s) => ({
      id: s.data.id,
      name: s.data.name,
      url: url(localeUrl(s.url, lang)),
      lat: s.data.launch.lat,
      lon: s.data.launch.lon,
      primary: s.data.wind_directions?.primary ?? [],
      possible: s.data.wind_directions?.possible ?? [],
      maxWind: s.data.wind_limits?.max_wind ?? null,
      soarMinWind: s.data.wind_limits?.soar_min_wind ?? null,
    }));
  });

  eleventyConfig.addFilter("homeData", function (sites, lang = "nb") {
    const url = eleventyConfig.getFilter("url");
    const municipalities = new Set(sites.map((s) => s.data.municipality).filter(Boolean));
    return sites.map((s) => {
      const d = s.data;
      const tr = d.derived?.translations?.[lang];
      return {
        id: d.id,
        name: d.name,
        region: d.region ?? null,
        places: searchPlaces(d, municipalities),
        lat: d.launch.lat,
        lon: d.launch.lon,
        primary: d.wind_directions?.primary ?? [],
        possible: d.wind_directions?.possible ?? [],
        categories: d.categories ?? [],
        // Directions per category, from the launches (SPG launches only facing NØ–SV at Elgen).
        byCategory: categoryDirections(d),
        level: d.level ?? null,
        elevation: d.elevation?.launch_masl ?? null,
        maxWind: d.wind_limits?.max_wind ?? null,
        soarMinWind: d.wind_limits?.soar_min_wind ?? null,
        trainingSite: !!d.training_site,
        text: tr?.intro || d.derived?.intro || "",
        url: url(localeUrl(s.url, lang)),
        flightlogId: d.external?.flightlog_id ?? null,
        reviewed: !!(d.reviewed?.by && d.reviewed?.date),
      };
    });
  });

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    // Site texts are plain Markdown, with no template language.
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
    templateFormats: ["md", "njk", "11ty.js"],
    pathPrefix: process.env.PATH_PREFIX || "/",
  };
}
