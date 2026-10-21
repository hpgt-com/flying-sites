// What the pages do in a browser, checked on the built site in Chromium (Playwright). Run after the build:
//
//   npm run build && npm run check:behaviour
//
// Each scenario is something that has broken before or matters most when it does: the weather stations and pilots on the
// map stay where Leaflet puts them when the map is zoomed (they slid away on mobile, 19.10.2026), the layer «Piloter i
// lufta» draws the pilots, the pages work when the data service is down, «Meld fra» checks and sends the form, and a
// site page opened before works offline. The data service and Turnstile are answered here (test/fixtures/), and every
// other request to another host is blocked, so the check needs no network and gives the same result every time.
// CHROMIUM_PATH: a Chromium already installed (otherwise the one from `npx playwright install chromium`).

import fs from "node:fs";
import { chromium, devices } from "playwright";
import { serveSite } from "./site-server.mjs";

const DATA = "https://data.hpgt.workers.dev";
const MOBILE = { ...devices["Pixel 7"], colorScheme: "light" };

// The stations as the data service gave them, moved to now so none is too old to show.
function stationsNow() {
  const d = JSON.parse(fs.readFileSync("test/fixtures/stations.json", "utf8"));
  const newest = Math.max(...d.items.map((i) => Date.parse(i.time ?? 0)));
  const shift = (t) => new Date(Date.parse(t) + Date.now() - 60000 - newest).toISOString();
  for (const i of d.items) {
    if (i.time) i.time = shift(i.time);
    for (const r of i.history) r[0] = shift(r[0]);
  }
  return { ...d, fetched: new Date().toISOString() };
}

// Three paragliders over Heia, the newest positions now.
function liveNow() {
  const at = (s) => new Date(Date.now() - s * 1000).toISOString();
  const items = [1, 2, 3].map((n) => ({
    id: `dd000${n}`, name: n === 3 ? null : `Pilot ${n}`, lat: 68.759 + n * 0.004, lon: 16.51 + n * 0.006, alt: 700 + n * 80,
    track: 90 * n, speed: 9.5, climb: n - 1.5, type: 7, time: at(5 * n),
    trail: [[68.755 + n * 0.004, 16.5 + n * 0.006, 0.5], [68.757 + n * 0.004, 16.505 + n * 0.006, 1.2], [68.759 + n * 0.004, 16.51 + n * 0.006, n - 1.5]],
  }));
  return { dataset: "live", source: "Open Glider Network", license: "ODbL, Open Glider Network", fetched: at(0), items };
}

// A forecast grid (/v1/grid.json, /v1/grid-wide.json) over the home region from the hour going on, for 30 hours: land
// with thermals inland, sea in the west, wind from the south-west getting stronger to the north, rain in one corner.
function gridNow(name) {
  const wide = name === "grid-wide", dLat = wide ? 0.2 : 0.1, dLon = wide ? 0.5 : 0.25;
  const lat0 = wide ? 67.8 : 68.4, lon0 = wide ? 14 : 15.5, rows = 9, cols = 9;
  const hour0 = Math.floor(Date.now() / 3600000) * 3600;
  const times = Array.from({ length: 30 }, (_, k) => hour0 + k * 3600);
  const n = rows * cols, elev = [], values = { T: [], Td: [], ws: [], wd: [], ws9: [], wd9: [], blh: [], cl: [], pr: [], sw: [] };
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    elev.push(c < 2 ? 0 : 100 + c * 60);
    const each = (f) => times.map((t, k) => f(k));
    values.T.push(each((k) => 10 + c * 0.5 - (k % 24 > 12 ? 4 : 0)));
    values.Td.push(each(() => 4));
    values.ws.push(each(() => 2 + r * 0.6));
    values.wd.push(each(() => 225));
    values.ws9.push(each(() => 4 + r * 1.5));
    values.wd9.push(each(() => 240));
    values.blh.push(each(() => 400 + c * 150));
    values.cl.push(each(() => (r === 0 && c < 3 ? 90 : 10)));
    values.pr.push(each(() => (r > 6 && c > 6 ? 1.4 : 0)));
    values.sw.push(each(() => 550));
  }
  return { dataset: name, source: "Open-Meteo", license: "CC BY 4.0, Open-Meteo", fetched: new Date().toISOString(), lat0, lon0, dLat, dLon, rows, cols, times, elev, values };
}

// The MET forecast as the data service gives it, from the hour going on, so the home page has a timeline also when it
// is built without one (the PR check skips it): a light south-westerly at Heia.
function forecastNow() {
  const hour0 = Math.floor(Date.now() / 3600000) * 3600000;
  const times = Array.from({ length: 30 }, (_, k) => new Date(hour0 + k * 3600000).toISOString().replace(".000", ""));
  const now = new Date().toISOString();
  return { dataset: "forecast", license: "CC BY 4.0, MET Norway", product: "locationforecast", fetched: now, updated: now, source: "MET Norway",
    times, sites: { heia: times.map(() => [225, 3, 5, 0]) }, past: {} };
}

// The answers from outside: the data service (stations and pilots from the fixtures, the rest as «no data yet», so the
// pages use what is built in, or everything 503 when down), Turnstile as a stand-in that passes at once, and nothing else.
async function answer(context, origin, { down = false, reports = [], forecast = false } = {}) {
  await context.route("**/*", async (route) => {
    const req = route.request();
    // Compared by origin, not as text: «https://data.hpgt.workers.dev.example» is another host.
    const url = new URL(req.url());
    if (url.origin === origin) return route.continue();
    if (url.origin === DATA && url.pathname === "/v1/report") {
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST" } });
      reports.push(JSON.parse(req.postData() ?? "{}"));
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ok: true, issue: 200, url: "https://github.com/hpgt-com/flying-sites/issues/200" }) });
    }
    if (url.origin === DATA) {
      const path = url.pathname;
      const body = down ? null : path === "/v1/stations.json" ? stationsNow() : path === "/v1/live.json" ? liveNow()
        : path === "/v1/forecast.json" && forecast ? forecastNow() : path === "/v1/grid.json" ? gridNow("grid") : path === "/v1/grid-wide.json" ? gridNow("grid-wide") : null;
      return route.fulfill({ status: body ? 200 : 503, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body ?? { error: "no data yet" }) });
    }
    if (url.origin === "https://challenges.cloudflare.com" && url.pathname.startsWith("/turnstile/")) {
      return route.fulfill({ contentType: "text/javascript", body: "window.turnstile = { render: function (el, o) { setTimeout(function () { o.callback('test-token'); }, 10); return 'w1'; }, reset: function () {} };" });
    }
    return route.abort();
  });
}

// Errors thrown in the page. Failed loads of blocked hosts and the 503s are expected and not counted.
function watchErrors(page, errors) {
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
}

// Each marker on the map where Leaflet has put it: its box on the screen at the position in its transform (plus the icon
// anchor's margin), within a pixel. Returns the markers that are not.
function misplaced(page) {
  return page.evaluate(() => [...document.querySelectorAll(".leaflet-marker-pane > .leaflet-marker-icon")].flatMap((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return [];
    const m = new DOMMatrixReadOnly(cs.transform === "none" ? undefined : cs.transform);
    const pane = el.parentElement.getBoundingClientRect(), box = el.getBoundingClientRect();
    const dx = box.left - (pane.left + m.m41 + parseFloat(cs.marginLeft || 0));
    const dy = box.top - (pane.top + m.m42 + parseFloat(cs.marginTop || 0));
    return Math.abs(dx) > 1 || Math.abs(dy) > 1 ? [`${el.className.split(" ").find((c) => c.endsWith("-marker")) ?? "marker"} ${cs.position} (${Math.round(dx)}, ${Math.round(dy)})`] : [];
  }));
}

// A layer's box in the map's layer list, by its whole label («Prognose: termikk» is not «Prognose: termikktopp …»).
function layerBox(page, label) {
  return page.locator(".leaflet-control-layers-overlays label").filter({ has: page.getByText(label, { exact: true }) }).locator("input");
}
// Turns a layer on, if it is off.
async function layerOn(page, label) {
  const box = layerBox(page, label);
  if (!(await box.isChecked())) await box.evaluate((el) => el.click());
}

async function zoom(page, dir) {
  await page.locator(dir > 0 ? ".leaflet-control-zoom-in" : ".leaflet-control-zoom-out").first().click();
  await page.waitForTimeout(700);
}

const scenarios = {
  async "Kartet: værstasjoner og piloter står der Leaflet setter dem, også etter zoom (mobil)"(browser, origin) {
    const context = await browser.newContext(MOBILE);
    await answer(context, origin);
    const page = await context.newPage();
    const errors = [];
    watchErrors(page, errors);
    await page.goto(`${origin}/`, { waitUntil: "load" });
    await page.locator(".station-marker").first().waitFor({ state: "attached", timeout: 15000 });
    await layerOn(page, "Piloter i lufta");
    await page.locator(".live-marker").first().waitFor({ state: "attached", timeout: 15000 });
    const problems = [];
    for (const step of [0, 1, 1, -1, -1, -1]) {
      if (step) await zoom(page, step);
      const off = await misplaced(page);
      if (off.length) problems.push(`etter zoom ${step}: ${off.slice(0, 5).join("; ")}${off.length > 5 ? ` og ${off.length - 5} til` : ""}`);
    }
    const counts = await page.evaluate(() => ({ stations: document.querySelectorAll(".station-marker").length, live: document.querySelectorAll(".live-marker").length }));
    await context.close();
    if (counts.stations < 5) problems.push(`bare ${counts.stations} stasjoner på kartet`);
    return [...problems, ...errors];
  },

  async "«Piloter i lufta»: pilotene og forklaringen vises når laget slås på, og forsvinner når det slås av"(browser, origin) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await answer(context, origin);
    const page = await context.newPage();
    const errors = [];
    watchErrors(page, errors);
    await page.goto(`${origin}/flysteder/heia/`, { waitUntil: "load" });
    const problems = [];
    if (await page.locator(".live-marker").count()) problems.push("piloter vises før laget er slått på");
    await layerOn(page, "Piloter i lufta");
    await page.locator(".live-marker").nth(2).waitFor({ state: "attached", timeout: 15000 }).catch(() => problems.push("ikke tre piloter på kartet"));
    if (!(await page.locator(".live-legend").count())) problems.push("ingen forklaring på stigning og synk");
    await page.locator(".leaflet-control-layers-overlays label", { hasText: "Piloter i lufta" }).locator("input").evaluate((el) => el.click());
    await page.waitForTimeout(300);
    if (await page.locator(".live-marker").count()) problems.push("pilotene ble stående etter at laget ble slått av");
    await context.close();
    return [...problems, ...errors];
  },

  async "«Prognose»: termikk, topp, vind og forklaringen vises, følger tidslinjen, og forsvinner når lagene slås av"(browser, origin) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await answer(context, origin, { forecast: true });
    const page = await context.newPage();
    const errors = [];
    watchErrors(page, errors);
    await page.goto(`${origin}/`, { waitUntil: "load" });
    const problems = [];
    await page.locator("#timeline-range").waitFor({ timeout: 15000 }).catch(() => problems.push("ingen tidslinje"));
    for (const label of ["Prognose: termikk", "Prognose: termikktopp og skybase", "Prognose: vind"]) await layerOn(page, label);
    await page.locator(".fc-barb").first().waitFor({ state: "attached", timeout: 15000 }).catch(() => problems.push("ingen vindfjær på kartet"));
    if (!(await page.locator(".leaflet-overlay-pane canvas").count())) problems.push("ingen termikkruter på kartet");
    if (!(await page.locator(".fc-top").count())) problems.push("ingen termikktopp på kartet");
    if (!(await page.locator(".fc-legend .fc-legend__bar").count())) problems.push("ingen skala for termikken");
    const before = await page.locator(".fc-legend__status").textContent();
    // A few hours on in the timeline: the legend's time follows.
    await page.locator("#timeline-range").evaluate((el) => { el.value = "3"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.waitForTimeout(200);
    const after = await page.locator(".fc-legend__status").textContent();
    if (before === after) problems.push(`prognosen fulgte ikke tidslinjen (${after})`);
    // The barbs at the ground are weaker than at 750 m: the numbers change.
    const at750 = await page.locator(".fc-barb b").allTextContents();
    await page.locator(".fc-legend [data-level=ground]").click();
    const atGround = await page.locator(".fc-barb b").allTextContents();
    if (at750.join() === atGround.join()) problems.push("vind ved bakken viser det samme som 750 m");
    await zoom(page, 1);
    const off = await misplaced(page);
    if (off.length) problems.push(`etter zoom: ${off.slice(0, 5).join("; ")}`);
    // A tap in the map gives the numbers for the nearest point.
    // Where nothing else is on top: not a site, a control or the timeline.
    const spot = await page.evaluate(() => {
      const box = document.querySelector("#home-map").getBoundingClientRect();
      for (let fy = 0.3; fy < 0.8; fy += 0.05) for (let fx = 0.2; fx < 0.8; fx += 0.05) {
        const x = box.left + box.width * fx, y = box.top + box.height * fy, el = document.elementFromPoint(x, y);
        if (el && (el.matches("canvas, .leaflet-container, .leaflet-tile") || el.closest(".fc-label"))) return { x, y };
      }
      return null;
    });
    if (spot) await page.mouse.click(spot.x, spot.y);
    await page.locator(".fc-popup").waitFor({ timeout: 3000 }).catch(() => problems.push("ingen tall når kartet trykkes"));
    for (const label of ["Prognose: termikk", "Prognose: termikktopp og skybase", "Prognose: vind"]) {
      await layerBox(page, label).evaluate((el) => el.click());
    }
    await page.waitForTimeout(300);
    if (await page.locator(".fc-barb, .fc-top, .fc-legend").count()) problems.push("prognosen ble stående etter at lagene ble slått av");
    await context.close();
    return [...problems, ...errors];
  },

  async "Sidene virker når datatjenesten er nede"(browser, origin) {
    const context = await browser.newContext(MOBILE);
    await answer(context, origin, { down: true });
    const page = await context.newPage();
    const errors = [];
    watchErrors(page, errors);
    const problems = [];
    for (const url of ["/", "/flysteder/heia/", "/vaer/", "/flyaktivitet/"]) {
      await page.goto(`${origin}${url}`, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      if (!(await page.locator("h1").first().isVisible())) problems.push(`${url}: ingen overskrift`);
    }
    // The site page's map is set up when it comes near the screen.
    await page.goto(`${origin}/flysteder/heia/`, { waitUntil: "load" });
    await page.locator("#site-map").scrollIntoViewIfNeeded();
    await page.locator("#site-map.leaflet-container").waitFor({ timeout: 5000 }).catch(() => problems.push("stedssiden har ikke kart"));
    await context.close();
    return [...problems, ...errors];
  },

  async "«Meld fra»: for kort tekst stoppes, en gyldig melding sendes med Turnstile-svaret og lenker til saken"(browser, origin) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const reports = [];
    await answer(context, origin, { reports });
    const page = await context.newPage();
    const errors = [];
    watchErrors(page, errors);
    await page.goto(`${origin}/meld-fra/`, { waitUntil: "load" });
    const problems = [];
    const form = page.locator("#report-form");
    await form.locator("textarea[name=message]").fill("kort");
    await form.locator(".report__send").click();
    if (!(await page.locator(".report__status--error").count())) problems.push("for kort tekst ga ingen feilmelding");
    if (reports.length) problems.push("for kort tekst ble sendt");
    await page.waitForTimeout(200);
    await form.locator("textarea[name=message]").fill("Det er kommet en ny vaier over landingen ved Heia.");
    await form.locator(".report__send").click();
    await page.locator(".report__status--ok a").waitFor({ timeout: 5000 }).catch(() => problems.push("ingen takk med lenke til saken"));
    const sent = reports[0];
    if (!sent) problems.push("ingenting ble sendt");
    else {
      if (sent.token !== "test-token") problems.push(`Turnstile-svaret ble ikke sendt med (${sent.token})`);
      if (!sent.message?.includes("vaier")) problems.push("meldingen mangler i det som ble sendt");
      if (!sent.kind) problems.push("typen mangler i det som ble sendt");
    }
    const href = await page.locator(".report__status--ok a").getAttribute("href").catch(() => null);
    if (href && href !== "https://github.com/hpgt-com/flying-sites/issues/200") problems.push(`lenken går til ${href}`);
    await context.close();
    return [...problems, ...errors];
  },
};

// Last, since it stops the server: a site page opened once is shown from the service worker when the network is gone.
async function offline(browser, server) {
  const context = await browser.newContext(MOBILE);
  await answer(context, server.origin);
  const page = await context.newPage();
  const errors = [];
  watchErrors(page, errors);
  const problems = [];
  await page.goto(`${server.origin}/flysteder/heia/`, { waitUntil: "load" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The service worker takes over the page, and the page is stored on the next visit to it.
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(async () => (await caches.keys()).length > 0 && (await Promise.all((await caches.keys()).map(async (k) => (await caches.open(k)).match(location.href)))).some(Boolean), null, { timeout: 15000 })
    .catch(() => problems.push("stedssiden ble ikke lagret"));
  await server.stop();
  await page.reload({ waitUntil: "load" }).catch((e) => problems.push(`siden lastet ikke uten nett: ${e.message.split("\n")[0]}`));
  if (!(await page.locator("#site-name").isVisible().catch(() => false))) problems.push("ingen overskrift uten nett");
  await page.locator("#offline-saved:not([hidden])").waitFor({ timeout: 6000 }).catch(() => problems.push("«Lagret på enheten» vises ikke uten nett"));
  await context.close();
  return [...problems, ...errors];
}

const server = await serveSite();
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let failed = 0;
async function run(name, fn) {
  let problems;
  try { problems = await fn(); } catch (err) { problems = [err.message.split("\n")[0]]; }
  if (problems.length) failed++;
  console[problems.length ? "error" : "log"](`${problems.length ? "FEIL" : "ok  "} ${name}`);
  for (const p of problems) console.error(`     ${p}`);
}
try {
  for (const [name, fn] of Object.entries(scenarios)) await run(name, () => fn(browser, server.origin));
  await run("Uten nett: en stedsside som er åpnet før, vises fra enheten med «Lagret på enheten»", () => offline(browser, server));
} finally {
  await browser.close();
  await server.stop().catch(() => {});
}
if (failed) {
  console.error(`\n${failed} av ${Object.keys(scenarios).length + 1} scenarier feilet.`);
  process.exit(1);
}
console.log(`\nAlle ${Object.keys(scenarios).length + 1} scenarier virker.`);
