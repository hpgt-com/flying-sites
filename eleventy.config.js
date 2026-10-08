import fs from "node:fs";
import * as yaml from "js-yaml";
import { HtmlBasePlugin } from "@11ty/eleventy";
import {
  DIRECTIONS, directionLabel, directionWord, directionType, sortDirections, formatNumber, formatDate, feetToMeters,
  formatLimit, limitMasl, categoryDirections,
} from "./lib/format.js";
import { validateSite } from "./lib/validation.js";
import { statusSummary } from "./lib/status.js";
import { assetUrl } from "./lib/assets.js";
import { fmt, localeUrl } from "./lib/i18n.js";

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(HtmlBasePlugin);

  // GPX kopieres med samme sti. Bildene kopieres ikke: lib/images.js lager visningsstørrelser
  // uten metadata i _site/img/, så originalene (med EXIF) aldri publiseres.
  eleventyConfig.addPassthroughCopy("src/flysteder/**/*.gpx");
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy({ "node_modules/leaflet/dist": "assets/leaflet" });
  eleventyConfig.addPassthroughCopy({ "node_modules/leaflet.markercluster/dist/leaflet.markercluster.js": "assets/leaflet-markercluster/leaflet.markercluster.js" });
  // Fontene fra Fontsource (SIL OFL 1.1), bare latin og vektene som brukes. @font-face står i src/assets/css/fonts.css.
  for (const [pkg, weights] of [["barlow", [400, 500, 600]], ["barlow-condensed", [500, 600, 700]]]) {
    for (const w of weights) {
      eleventyConfig.addPassthroughCopy({ [`node_modules/@fontsource/${pkg}/files/${pkg}-latin-${w}-normal.woff2`]: `assets/fonts/${pkg}-latin-${w}-normal.woff2` });
    }
    eleventyConfig.addPassthroughCopy({ [`node_modules/@fontsource/${pkg}/LICENSE`]: `assets/fonts/LICENSE-${pkg}.txt` });
  }
  // Luftrom fra openAIP til kartlaget (npm run airspace). Lastes først når noen slår på et luftromslag.
  eleventyConfig.addPassthroughCopy({ "src/_data/cache/airspace/region.geojson": "assets/airspace.geojson" });

  eleventyConfig.ignores.add("src/_data/cache/**");
  // Oversatte stedstekster (index.en.md osv.) er ikke egne sider. De leses av lib/translations.js.
  eleventyConfig.ignores.add("src/flysteder/*/index.*.md");
  eleventyConfig.addWatchTarget("./lib/");
  // På Windows mister filovervåkingen filer som skrives på nytt (sed, git checkout, enkelte editorer).
  // Polling er litt tregere, men fanger alle endringer. Gjelder bare `npm start`.
  eleventyConfig.setChokidarConfig({ usePolling: true, interval: 500 });

  eleventyConfig.addCollection("sites", (api) => {
    // Stedssidene finnes på hvert språk (paginering i flysteder.11tydata.js). Samlingen har én side per sted,
    // den norske. Lenker til andre språk lages med localeUrl.
    const sites = api.getFilteredByGlob("src/flysteder/*/index.md").filter((s) => (s.data.language?.code ?? "nb") === "nb");
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

  // Filtrene under følger sidens språk (lang), som Nunjucks gir i this.ctx.
  const langOf = (ctx) => ctx?.lang ?? "nb";
  eleventyConfig.addFilter("directionLabel", function (code) { return directionLabel(code, langOf(this.ctx)); });
  eleventyConfig.addFilter("directionLabels", function (list) { return sortDirections(list).map((c) => directionLabel(c, langOf(this.ctx))).join(", "); });
  eleventyConfig.addFilter("directionWord", function (code) { return directionWord(code, langOf(this.ctx)); });
  // Tekst fra ordboken med verdier satt inn: {{ t.site.onFlightlog | fmt({ name: name }) }}.
  eleventyConfig.addFilter("fmt", (text, vars) => fmt(text, vars));
  // Intern adresse på sidens språk (eller språket som oppgis): {{ "/luftrom/" | localeUrl }}.
  eleventyConfig.addFilter("localeUrl", function (url, code) { return localeUrl(url, code ?? langOf(this.ctx)); });
  eleventyConfig.addFilter("directionType", (code, windDirections) => directionType(windDirections, code));
  eleventyConfig.addFilter("sortDirections", sortDirections);
  // Versjonsnummer på CSS/JS, så nettlesere henter nye filer etter en endring (lib/assets.js).
  eleventyConfig.addFilter("asset", assetUrl);
  eleventyConfig.addFilter("formatNumber", function (n, decimals) { return formatNumber(n, decimals, langOf(this.ctx)); });
  eleventyConfig.addFilter("formatDate", function (iso) { return formatDate(iso, langOf(this.ctx)); });
  eleventyConfig.addFilter("feetToMeters", feetToMeters);
  eleventyConfig.addFilter("formatLimit", function (limit) { return formatLimit(limit, langOf(this.ctx)); });
  eleventyConfig.addFilter("limitMasl", function (limit) { return limitMasl(limit, langOf(this.ctx)); });
  eleventyConfig.addFilter("capitalizeFirst", (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s));
  eleventyConfig.addFilter("json", (v) => JSON.stringify(v).replace(/</g, "\\u003c"));

  // Plukker ut en del av den ferdige Markdown-teksten: "intro" (før første h2) eller en h2-seksjon.
  // heading kan være en liste, for eksempel ["Launch", "Start"] når teksten kan være oversatt eller norsk.
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

  // Oversikt til vedlikeholdssiden /status/.
  eleventyConfig.addFilter("statusSummary", statusSummary);

  // Det forsidekartet og kortet trenger om hvert sted.
  // lang: forsidens språk. Lenkene går til stedssiden på samme språk, og ingressen er oversatt når den finnes.
  eleventyConfig.addFilter("homeData", function (sites, lang = "nb") {
    const url = eleventyConfig.getFilter("url");
    return sites.map((s) => {
      const d = s.data;
      const tr = d.derived?.translations?.[lang];
      return {
        id: d.id,
        name: d.name,
        region: d.region ?? null,
        lat: d.launch.lat,
        lon: d.launch.lon,
        primary: d.wind_directions?.primary ?? [],
        possible: d.wind_directions?.possible ?? [],
        categories: d.categories ?? [],
        // Retningene for hver kategori, fra startene (SPG starter bare mot NØ–SV på Elgen).
        byCategory: categoryDirections(d),
        level: d.level ?? null,
        elevation: d.elevation?.launch_masl ?? null,
        maxWind: d.wind_limits?.max_wind ?? null,
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
    // Stedstekstene er ren Markdown, uten malspråk.
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
    templateFormats: ["md", "njk", "11ty.js"],
    pathPrefix: process.env.PATH_PREFIX || "/",
  };
}
