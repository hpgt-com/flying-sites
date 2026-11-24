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

  // GPX-filer kopieres med samme sti. Bilder kopieres ikke: lib/images.js lager visningsstørrelser uten
  // metadata i _site/img/, så originalene (med EXIF) aldri publiseres.
  // Gangveiene ligger ved siden av flystedssidene: src/sites/<id>/*.gpx blir /flysteder/<id>/*.gpx.
  eleventyConfig.addPassthroughCopy({ "src/sites": "flysteder" }, { filter: ["**/*.gpx"] });
  eleventyConfig.addPassthroughCopy("src/assets");
  // Svarhoder for nettstedet på Cloudflare (workers/site); GitHub Pages ser bort fra filen.
  // Bare det sidene laster: leaflet-src.js og leaflet-src.esm.js (omtrent 0,9 MB med kildekartene) utelates.
  eleventyConfig.addPassthroughCopy({
    "node_modules/leaflet/dist/leaflet.js": "assets/leaflet/leaflet.js",
    "node_modules/leaflet/dist/leaflet.css": "assets/leaflet/leaflet.css",
    "node_modules/leaflet/dist/images": "assets/leaflet/images",
  });
  eleventyConfig.addPassthroughCopy({ "node_modules/leaflet.markercluster/dist/leaflet.markercluster.js": "assets/leaflet-markercluster/leaflet.markercluster.js" });
  // Skrifter fra Fontsource (SIL OFL 1.1), bare latinsk utvalg og vektene som brukes. @font-face er i src/assets/css/fonts.css.
  for (const [pkg, weights] of [["barlow", [400, 600]], ["barlow-condensed", [700]]]) {
    for (const w of weights) {
      eleventyConfig.addPassthroughCopy({ [`node_modules/@fontsource/${pkg}/files/${pkg}-latin-${w}-normal.woff2`]: `assets/fonts/${pkg}-latin-${w}-normal.woff2` });
    }
    eleventyConfig.addPassthroughCopy({ [`node_modules/@fontsource/${pkg}/LICENSE`]: `assets/fonts/LICENSE-${pkg}.txt` });
  }
  // Luftrom fra openAIP for kartlaget (npm run airspace). Lastes bare når noen slår på et luftromslag.
  eleventyConfig.addPassthroughCopy({ "src/_data/cache/airspace/region.geojson": "assets/airspace.geojson" });
  // Kraftlinjer og hindre for kartlaget (npm run obstacles): indeksen og rutene. Lastes bare når noen slår på laget,
  // og da bare rutene som vises.
  eleventyConfig.addPassthroughCopy({ "src/_data/cache/obstacles": "assets/obstacles" });

  eleventyConfig.ignores.add("src/_data/cache/**");
  // Oversatte tekster om flystedene (index.en.md osv.) er ikke egne sider. De leses av lib/translations.js.
  eleventyConfig.ignores.add("src/sites/*/index.*.md");
  eleventyConfig.addWatchTarget("./lib/");
  // På Windows går filovervåkingen glipp av filer som skrives på nytt (sed, git checkout, noen redigeringsprogrammer).
  // Polling er litt tregere, men fanger alle endringer. Gjelder bare `npm start`.
  eleventyConfig.setChokidarConfig({ usePolling: true, interval: 500 });

  eleventyConfig.addCollection("sites", (api) => {
    // Flystedssidene finnes på alle språk (pagination i sites.11tydata.js). Samlingen har én side per flysted,
    // den norske. Lenker til andre språk lages med localeUrl.
    const sites = api.getFilteredByGlob("src/sites/*/index.md").filter((s) => (s.data.language?.code ?? "nb") === "nb");
    const errors = sites.flatMap((s) => {
      // Front matter slik den står i filen, så valideringen bare ser nøklene fra flystedsfilen.
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(s.inputPath, "utf8"));
      return validateSite(s.data, s.inputPath, fm ? yaml.load(fm[1]) : null);
    });
    if (errors.length) {
      throw new Error(`Ugyldige stedsfiler:\n  - ${errors.join("\n  - ")}`);
    }
    return sites.sort((a, b) => a.data.name.localeCompare(b.data.name, "nb"));
  });

  eleventyConfig.addGlobalData("DIRECTIONS", DIRECTIONS);

  // Filtrene under følger språket på siden (lang), som Nunjucks gir i this.ctx.
  const langOf = (ctx) => ctx?.lang ?? "nb";
  eleventyConfig.addFilter("directionLabel", function (code) { return directionLabel(code, langOf(this.ctx)); });
  eleventyConfig.addFilter("directionLabels", function (list) { return sortDirections(list).map((c) => directionLabel(c, langOf(this.ctx))).join(", "); });
  eleventyConfig.addFilter("directionWord", function (code) { return directionWord(code, langOf(this.ctx)); });
  // Tekst fra ordboken med verdier fylt inn: {{ t.site.onFlightlog | fmt({ name: name }) }}.
  eleventyConfig.addFilter("fmt", (text, vars) => fmt(text, vars));
  // Intern adresse på språket til siden (eller språket som oppgis): {{ "/tarn/" | localeUrl }}.
  eleventyConfig.addFilter("localeUrl", function (url, code) { return localeUrl(url, code ?? langOf(this.ctx)); });
  eleventyConfig.addFilter("directionType", (code, windDirections) => directionType(windDirections, code));
  eleventyConfig.addFilter("sortDirections", sortDirections);
  // Versjonsnumre på CSS/JS, så nettlesere henter nye filer etter en endring (lib/assets.js).
  eleventyConfig.addFilter("asset", assetUrl);
  eleventyConfig.addFilter("formatNumber", function (n, decimals) { return formatNumber(n, decimals, langOf(this.ctx)); });
  // Avstand i km mellom to punkter med lat og lon (storsirkel), for glidet fra start til landing.
  eleventyConfig.addFilter("distanceKm", (a, b) => {
    const r = Math.PI / 180;
    const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  });
  eleventyConfig.addFilter("formatDate", function (iso) { return formatDate(iso, langOf(this.ctx)); });
  eleventyConfig.addFilter("feetToMeters", feetToMeters);
  eleventyConfig.addFilter("formatLimit", function (limit) { return formatLimit(limit, langOf(this.ctx)); });
  eleventyConfig.addFilter("limitMasl", function (limit) { return limitMasl(limit, langOf(this.ctx)); });
  // Høydeprofil fra start til gulvet i luftrommet (lib/airspace-profile.js): {{ ceiling | airspaceProfile(launch, landing) | safe }}.
  eleventyConfig.addFilter("airspaceProfile", function (ceiling, launchMasl, landingMasl) { return airspaceProfile(ceiling, launchMasl, landingMasl, langOf(this.ctx)); });
  eleventyConfig.addFilter("capitalizeFirst", (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s));
  eleventyConfig.addFilter("json", (v) => JSON.stringify(v).replace(/</g, "\\u003c"));

  // Henter ut en del av den ferdige Markdown-teksten: "intro" (før første h2) eller en h2-seksjon.
  // heading kan være en liste, f.eks. ["Launch", "Start"] når teksten kan være oversatt eller norsk.
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

  // Sammendrag for vedlikeholdssiden /status/.
  eleventyConfig.addFilter("statusSummary", statusSummary);

  // Det kartet og kortene på forsiden trenger om hvert flysted.
  // lang: språket på forsiden. Lenkene går til flystedssiden på samme språk, og innledningen er oversatt når det finnes.
  // Flystedene til værsiden (vaer.njk): nok til å plassere en stasjon på flystedet sitt, tegne vindrosen til flystedet
  // og lenke dit.
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
        // Retninger per kategori, fra startene (SPG-starter bare mot NØ–SV på Elgen).
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
    // Tekstene om flystedene er ren Markdown, uten malspråk.
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
    templateFormats: ["md", "njk", "11ty.js"],
    pathPrefix: process.env.PATH_PREFIX || "/",
  };
}
