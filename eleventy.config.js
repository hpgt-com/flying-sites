import fs from "node:fs";
import * as yaml from "js-yaml";
import { HtmlBasePlugin } from "@11ty/eleventy";
import {
  DIRECTIONS, directionLabel, directionWord, directionType, sortDirections, formatNumber, formatDate, feetToMeters,
} from "./lib/format.js";
import { validateSite } from "./lib/validation.js";
import { statusSummary } from "./lib/status.js";

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(HtmlBasePlugin);

  // GPX kopieres med samme sti. Bildene kopieres ikke: lib/images.js lager visningsstørrelser
  // uten metadata i _site/img/, så originalene (med EXIF) aldri publiseres.
  eleventyConfig.addPassthroughCopy("src/flysteder/**/*.gpx");
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy({ "node_modules/leaflet/dist": "assets/leaflet" });

  eleventyConfig.ignores.add("src/_data/cache/**");
  eleventyConfig.addWatchTarget("./lib/");
  // På Windows mister filovervåkingen filer som skrives på nytt (sed, git checkout, enkelte editorer).
  // Polling er litt tregere, men fanger alle endringer. Gjelder bare `npm start`.
  eleventyConfig.setChokidarConfig({ usePolling: true, interval: 500 });

  eleventyConfig.addCollection("sites", (api) => {
    const sites = api.getFilteredByGlob("src/flysteder/*/index.md");
    const errors = sites.flatMap((s) => {
      // Rå front matter, så valideringen ser bare nøklene fra stedsfilen.
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(s.inputPath, "utf8"));
      return validateSite(s.data, s.inputPath, fm ? yaml.load(fm[1]) : null);
    });
    if (errors.length) {
      throw new Error(`Ugyldige stedsfiler:\n  - ${errors.join("\n  - ")}`);
    }
    return sites.sort((a, b) => a.data.name.localeCompare(b.data.name, "nb"));
  });

  eleventyConfig.addGlobalData("DIRECTIONS", DIRECTIONS);

  eleventyConfig.addFilter("directionLabel", directionLabel);
  eleventyConfig.addFilter("directionLabels", (list) => sortDirections(list).map(directionLabel).join(", "));
  eleventyConfig.addFilter("directionWord", directionWord);
  eleventyConfig.addFilter("directionType", (code, windDirections) => directionType(windDirections, code));
  eleventyConfig.addFilter("sortDirections", sortDirections);
  eleventyConfig.addFilter("formatNumber", formatNumber);
  eleventyConfig.addFilter("formatDate", formatDate);
  eleventyConfig.addFilter("feetToMeters", feetToMeters);
  eleventyConfig.addFilter("capitalizeFirst", (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s));
  eleventyConfig.addFilter("json", (v) => JSON.stringify(v).replace(/</g, "\\u003c"));

  // Plukker ut en del av den ferdige Markdown-teksten: "intro" (før første h2) eller en h2-seksjon.
  eleventyConfig.addFilter("section", (html, heading) => {
    if (!html) return "";
    const parts = String(html).split(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    if (heading === "intro") return parts[0].trim();
    for (let i = 1; i < parts.length; i += 2) {
      if (parts[i].trim().toLowerCase() === heading.toLowerCase()) return (parts[i + 1] ?? "").trim();
    }
    return "";
  });

  // Oversikt til vedlikeholdssiden /status/.
  eleventyConfig.addFilter("statusSummary", statusSummary);

  // Det forsidekartet og kortet trenger om hvert sted.
  eleventyConfig.addFilter("homeData", function (sites) {
    const url = eleventyConfig.getFilter("url");
    return sites.map((s) => {
      const d = s.data;
      return {
        id: d.id,
        name: d.name,
        lat: d.launch.lat,
        lon: d.launch.lon,
        primary: d.wind_directions?.primary ?? [],
        possible: d.wind_directions?.possible ?? [],
        categories: d.categories ?? [],
        level: d.level ?? null,
        trainingSite: !!d.training_site,
        text: d.derived?.intro ?? "",
        url: d.derived?.hasPage && s.url ? url(s.url) : null,
        flightlogId: d.external?.flightlog_id ?? null,
        reviewed: !!(d.reviewed?.by && d.reviewed?.date),
      };
    });
  });

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    // Stedstekstene er ren Markdown, uten malspråk.
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
    templateFormats: ["md", "njk"],
    pathPrefix: process.env.PATH_PREFIX || "/",
  };
}
