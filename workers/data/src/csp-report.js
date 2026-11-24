// CSP-brudd rapportert fra sidene: POST /v1/csp-report, oppgitt i report-uri og report-to (Reporting-Endpoints) i
// hodene til flysteder.hpgt.com (src/headers.njk). Både Content-Security-Policy som håndheves, og
// Content-Security-Policy-Report-Only med Trusted Types sender hit.
//
// Ingenting lagres. Hver rapport blir én kort linje i Workerens logg (Observability), med bare direktivet, om det ble
// håndhevet eller bare rapportert, det som ble blokkert (redusert til skjema og vert eller et nøkkelord), sidens sti på
// flysteder.hpgt.com uten spørrestreng, og for Trusted Types navnet på sinken. Aldri IP-adressen, nettleserinfo,
// referrer, hele adresser eller utdraget (koden eller teksten som ble blokkert, som kan inneholde det noen skrev).
// Rapporter fra andre sider enn flysteder.hpgt.com forkastes.
//
// Innholdet leses opptil MAX_BODY byte uansett hva Content-Length sier, og høyst MAX_REPORTS rapporter fra én
// forespørsel logges. Hver IP-adresse kan sende 30 forespørsler i minuttet (rate limit-bindingen CSP_LIMIT i
// wrangler.toml). Cloudflare teller dem under en hash av adressen, som aldri logges eller lagres. Testet i
// test/csp-report.test.js.

export const MAX_BODY = 16384;
export const MAX_REPORTS = 20;
export const SITE_HOST = "flysteder.hpgt.com";
const TYPES = { "application/csp-report": "legacy", "application/reports+json": "reporting" };
// Nøkkelordene nettlesere oppgir som den blokkerte ressursen. De logges som de er.
const KEYWORDS = new Set(["inline", "eval", "wasm-eval", "trusted-types-sink", "trusted-types-policy", "self"]);

// Innholdet som tekst, eller null når det er større enn max byte. Leses fra strømmen, så en manglende eller feil
// Content-Length gjør ingen forskjell.
export async function readLimited(request, max = MAX_BODY) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

const str = (v) => (typeof v === "string" ? v : "");

// Navnet på direktivet: effectiveDirective, eller det første ordet i den gamle violated-directive.
export function directiveOf(r) {
  const d = (str(r.effectiveDirective) || str(r["effective-directive"]) || str(r["violated-directive"])).trim().split(/\s+/)[0].toLowerCase();
  return /^[a-z][a-z-]{0,39}$/.test(d) ? d : "other";
}

// Det som ble blokkert: et nøkkelord, skjema og vert for en nettadresse (uten sti og spørrestreng), eller bare
// skjemaet.
export function blockedOf(value) {
  const v = str(value).trim();
  if (!v) return "none";
  const lower = v.toLowerCase();
  if (KEYWORDS.has(lower)) return lower;
  if (lower === "data" || lower.startsWith("data:")) return "data";
  if (lower === "blob" || lower.startsWith("blob:")) return "blob";
  let url;
  try { url = new URL(v); } catch { return "other"; }
  if (["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return `${url.protocol}//${url.host}`.slice(0, 120);
  // Utvidelser og andre skjemaer: bare skjemaet (ID-en til en utvidelse sier noe om nettleseren).
  return /^[a-z][a-z0-9+.-]{0,30}:$/.test(url.protocol) ? url.protocol.slice(0, -1) : "other";
}

// Sidens sti på flysteder.hpgt.com uten spørrestreng eller fragment, eller null for alle andre sider.
export function pathOf(value) {
  let url;
  try { url = new URL(str(value)); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== SITE_HOST) return null;
  return /^\/[\w\-./~]{0,150}$/.test(url.pathname) ? url.pathname : "(annen)";
}

// For Trusted Types: navnet på sinken foran «|» i utdraget (som «Element innerHTML»). Resten av utdraget er innholdet
// som ble tilordnet, og det beholdes aldri.
export function sinkOf(sample) {
  const s = str(sample);
  const at = s.indexOf("|");
  if (at < 1) return null;
  const sink = s.slice(0, at).trim();
  return /^[A-Za-z][\w.]{0,40}( [\w.]{1,40})?$/.test(sink) ? sink : null;
}

// Én rapport redusert til sin logglinje, eller null når den ikke gjelder en side på nettstedet. r: det gamle
// «csp-report»-objektet eller body fra Reporting API. url: report.url fra Reporting API, når body ikke har documentURL.
export function summarize(r, url) {
  if (!r || typeof r !== "object") return null;
  const path = pathOf(str(r.documentURL) || str(r["document-uri"]) || str(url));
  if (path === null) return null;
  const directive = directiveOf(r);
  const disposition = ["enforce", "report"].includes(r.disposition) ? r.disposition : "unknown";
  const blocked = blockedOf(r.blockedURL ?? r["blocked-uri"]);
  let line = `csp-report directive=${directive} disposition=${disposition} blocked=${blocked} path=${path}`;
  if (blocked === "trusted-types-sink" || directive === "require-trusted-types-for") {
    const sink = sinkOf(r.sample ?? r["script-sample"]);
    if (sink) line += ` sink="${sink}"`;
  }
  return line;
}

// Rapportene i innholdet: den gamle formen {"csp-report": {...}}, eller listen med rapporter fra Reporting API.
export function reportsIn(kind, body) {
  if (kind === "legacy") return body && typeof body === "object" && body["csp-report"] ? [{ r: body["csp-report"] }] : [];
  if (!Array.isArray(body)) return [];
  return body.filter((x) => x && x.type === "csp-violation").map((x) => ({ r: x.body, url: x.url }));
}

// Nøkkelen som rate limit teller under: en hash av adressen, aldri selve adressen.
async function limitKey(ip) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`csp-report|${ip}`));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Svaret på POST /v1/csp-report (metoden sjekkes i index.js): 204 for rapporter som er lest (logget eller forkastet),
// 415 for en annen innholdstype, 413 for innhold over MAX_BODY, 400 for innhold som ikke er JSON, 429 over grensen.
export async function handleCspReport(request, env, log = console.log) {
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const kind = TYPES[type];
  if (!kind) return 415;
  if (Number(request.headers.get("content-length")) > MAX_BODY) return 413;
  if (env.CSP_LIMIT) {
    const { success } = await env.CSP_LIMIT.limit({ key: await limitKey(request.headers.get("cf-connecting-ip") || "") });
    if (!success) return 429;
  }
  const text = await readLimited(request, MAX_BODY);
  if (text === null) return 413;
  let body;
  try { body = JSON.parse(text); } catch { return 400; }
  for (const { r, url } of reportsIn(kind, body).slice(0, MAX_REPORTS)) {
    const line = summarize(r, url);
    if (line) log(line);
  }
  return 204;
}
