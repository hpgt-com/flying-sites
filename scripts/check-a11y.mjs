// Accessibility check of the built site with axe-core in Chromium (Playwright). Run after the build:
//
//   npm run build && npm run check:a11y
//
// Serves _site/ on a local port and checks a few pages that cover the templates, in light and dark mode. Only
// findings with impact «serious» or «critical» fail the check; the rest are listed. Requests to other hosts (map
// tiles, Yr, statistics) are blocked, so the check needs no network and gives the same result every time.
// CHROMIUM_PATH: a Chromium already installed (otherwise the one from `npx playwright install chromium`).

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const SITE_DIR = path.resolve("_site");
const PAGES = ["/", "/en/", "/flysteder/sollifjellet/", "/tarn/", "/om/", "/status/", "/vaer/"];
const FAIL_ON = new Set(["serious", "critical"]);
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2", ".geojson": "application/geo+json", ".gpx": "application/gpx+xml" };

// A minimal static server for _site/: /tarn/ serves tarn/index.html. Nothing outside _site/ is served.
const server = http.createServer((req, res) => {
  let file = path.join(SITE_DIR, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(SITE_DIR)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let failures = 0;
try {
  for (const colorScheme of ["light", "dark"]) {
    // bypassCSP: the pages only allow their own scripts, and axe is injected from outside.
    const context = await browser.newContext({ colorScheme, bypassCSP: true, viewport: { width: 1280, height: 900 } });
    await context.route("**/*", (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
    const page = await context.newPage();
    for (const url of PAGES) {
      await page.goto(origin + url, { waitUntil: "load" });
      await page.evaluate(axeSource);
      const { violations } = await page.evaluate(() => window.axe.run(document, { resultTypes: ["violations"] }));
      for (const v of violations) {
        const fail = FAIL_ON.has(v.impact);
        if (fail) failures++;
        console[fail ? "error" : "log"](`${fail ? "FEIL" : "info"} ${url} (${colorScheme}) ${v.impact} ${v.id}: ${v.help} (${v.nodes.length} element)`);
        if (fail) for (const n of v.nodes.slice(0, 5)) console.error(`    ${n.target.join(" ")}`);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (failures) {
  console.error(`\n${failures} funn med alvorlighet serious eller critical.`);
  process.exit(1);
}
console.log(`Ingen alvorlige funn på ${PAGES.length} sider (lys og mørk modus).`);
