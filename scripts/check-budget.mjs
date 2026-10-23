// Performance budget for the built site, in Chromium (Playwright). Run after the build:
//
//   npm run build && npm run check:budget
//
// Serves _site/ on a local port and loads a few pages that cover the templates, on a phone-sized screen, with the
// service worker off and every other host blocked (map tiles, the data service, statistics), so the numbers are the
// site's own and the same every time. For each page: the bytes of the site's own files by kind (HTML, CSS, JS, fonts,
// images, data), the number of requests, the number of DOM nodes, and the layout shift (CLS) during the first seconds.
// Each is measured against BUDGET, set a little above what the site uses today, so a change that makes a page much
// heavier or shiftier fails the PR check instead of reaching the visitors. Raise a budget on purpose, in the same PR as
// the change that needs it, and say why. Bytes are uncompressed (the local server does not compress); GitHub Pages
// sends gzip, so visitors get about a third over the wire.
// CHROMIUM_PATH: a Chromium already installed (otherwise the one from `npx playwright install chromium`).

import { chromium, devices } from "playwright";
import { serveSite } from "./site-server.mjs";

const PAGES = ["/", "/flysteder/sollifjellet/", "/vaer/", "/en/"];
// Per page: bytes by kind (KB, uncompressed), requests, DOM nodes, CLS. The home page's nodes move with the day's
// forecast (a window strip per site with windows), so its budget has room for that. A kind missing from a page's budget is not
// checked for it.
const BUDGET = {
  "/": { html: 140, css: 165, js: 440, font: 80, image: 20, data: 10, requests: 30, nodes: 2300, cls: 0.05 },
  "/flysteder/sollifjellet/": { html: 100, css: 165, js: 440, font: 80, image: 140, data: 10, requests: 32, nodes: 3400, cls: 0.1 },
  "/vaer/": { html: 50, css: 150, js: 170, font: 80, image: 10, data: 10, requests: 20, nodes: 300, cls: 0.05 },
  "/en/": { html: 140, css: 165, js: 440, font: 80, image: 20, data: 10, requests: 30, nodes: 2300, cls: 0.05 },
};
const KINDS = { document: "html", stylesheet: "css", script: "js", font: "font", image: "image", fetch: "data", xhr: "data", manifest: "data", other: "data" };

const server = await serveSite();
const origin = server.origin;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let failures = 0;
const rows = [];
try {
  for (const url of PAGES) {
    const context = await browser.newContext({ ...devices["Pixel 7"], serviceWorkers: "block" });
    await context.route("**/*", (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
    // The layout shift, summed as Chrome's CLS does for a short page view (shifts after the visitor's own input left out).
    await context.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    });
    const page = await context.newPage();
    const bytes = { html: 0, css: 0, js: 0, font: 0, image: 0, data: 0 };
    let requests = 0;
    const pending = [];
    page.on("requestfinished", (req) => {
      requests++;
      pending.push(req.response().then((res) => res?.body()).then((body) => { bytes[KINDS[req.resourceType()] ?? "data"] += body?.length ?? 0; }).catch(() => {}));
    });
    await page.goto(origin + url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await Promise.all(pending);
    const nodes = await page.evaluate(() => document.getElementsByTagName("*").length);
    const cls = await page.evaluate(() => Math.round(window.__cls * 1000) / 1000);
    const measured = { ...Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, Math.round(v / 1024)])), requests, nodes, cls };
    const over = Object.entries(BUDGET[url] ?? {}).filter(([k, limit]) => measured[k] > limit).map(([k, limit]) => `${k} ${measured[k]} > ${limit}`);
    if (over.length) failures++;
    rows.push({ url, ...measured, over: over.join(", ") });
    await context.close();
  }
} finally {
  await browser.close();
  await server.stop();
}
console.table(rows.map(({ url, html, css, js, font, image, data, requests, nodes, cls, over }) => ({ side: url, "HTML KB": html, "CSS KB": css, "JS KB": js, "fonter KB": font, "bilder KB": image, "data KB": data, forespørsler: requests, noder: nodes, CLS: cls, "over budsjett": over || "" })));
if (failures) {
  console.error(`\n${failures} av ${PAGES.length} sider er over budsjettet (scripts/check-budget.mjs BUDGET). Gjør siden lettere, eller hev budsjettet med en begrunnelse i PR-en.`);
  process.exit(1);
}
console.log(`Alle ${PAGES.length} sider innenfor budsjettet.`);
