// Ytelsesbudsjett for det bygde nettstedet, i Chromium (Playwright). Kjøres etter bygging:
//
//   npm run build && npm run check:budget
//
// Serverer _site/ på en lokal port og laster noen sider som dekker malene, på en skjerm på størrelse med en
// telefon, med service workeren av og alle andre verter blokkert (kartfliser, datatjenesten, statistikk), så tallene
// er nettstedets egne og like hver gang. For hver side: bytene i nettstedets egne filer etter slag (HTML, CSS, JS,
// skrifter, bilder, data), antall forespørsler, antall DOM-noder og layoutforskyvningen (CLS) de første sekundene.
// Hvert tall måles mot BUDGET, satt litt over det nettstedet bruker i dag, så en endring som gjør en side mye tyngre
// eller mer urolig, stopper sjekken av PR-en i stedet for å nå de besøkende. Hev et budsjett med vilje, i samme PR
// som endringen som trenger det, og si hvorfor. Bytene er ukomprimerte (den lokale serveren komprimerer ikke);
// GitHub Pages sender gzip, så besøkende får omtrent en tredjedel over nettet.
// CHROMIUM_PATH: en Chromium som alt er installert (ellers den fra `npx playwright install chromium`).

import { chromium, devices } from "playwright";
import { serveSite } from "./site-server.mjs";

const PAGES = ["/", "/flysteder/sollifjellet/", "/vaer/", "/en/"];
// Per side: byte etter slag (KB, ukomprimert), forespørsler, DOM-noder, CLS. Nodene på forsiden varierer med dagens
// varsel (en stripe med flyvinduer per flysted som har vinduer), så budsjettet der har rom for det. Et slag som mangler
// i budsjettet for en side, sjekkes ikke for den.
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
    // Layoutforskyvningen, summert slik CLS i Chrome gjør for en kort sidevisning (uten forskyvninger etter egen input).
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
