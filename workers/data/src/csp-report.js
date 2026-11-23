// CSP violation reports from the site's pages: POST /v1/csp-report, named by report-uri and report-to (Reporting-Endpoints)
// in the headers of flysteder.hpgt.com (src/headers.njk). Both the enforced Content-Security-Policy and the
// Content-Security-Policy-Report-Only with Trusted Types send here.
//
// Nothing is stored: each report becomes one short line in the Worker's log (Observability), with only the directive,
// whether it was enforced or only reported, what was blocked reduced to scheme and host or a keyword, the page's path
// on flysteder.hpgt.com without query string, and for Trusted Types the name of the sink. Never the address, user agent,
// referrer, full addresses or the sample (the code or text that was blocked, which may hold what someone typed).
// Reports from other pages than flysteder.hpgt.com are dropped.
//
// The body is read up to MAX_BODY bytes whatever Content-Length says, and at most MAX_REPORTS reports from one request
// are logged. Each address may send 30 requests a minute (the rate limit binding CSP_LIMIT in wrangler.toml),
// counted by Cloudflare under a hash of the address that is never logged or stored. Tested in test/csp-report.test.js.

export const MAX_BODY = 16384;
export const MAX_REPORTS = 20;
export const SITE_HOST = "flysteder.hpgt.com";
const TYPES = { "application/csp-report": "legacy", "application/reports+json": "reporting" };
// The keywords browsers give as the blocked resource, logged as they are.
const KEYWORDS = new Set(["inline", "eval", "wasm-eval", "trusted-types-sink", "trusted-types-policy", "self"]);

// The body as text, or null when it is larger than max bytes. Read from the stream, so a missing or false
// Content-Length makes no difference.
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

// The directive's name: effectiveDirective, or the first word of the legacy violated-directive.
export function directiveOf(r) {
  const d = (str(r.effectiveDirective) || str(r["effective-directive"]) || str(r["violated-directive"])).trim().split(/\s+/)[0].toLowerCase();
  return /^[a-z][a-z-]{0,39}$/.test(d) ? d : "other";
}

// What was blocked: a keyword, or scheme and host for a web address (no path, no query), or only the scheme.
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
  // Extensions and other schemes: the scheme alone (an extension's id says something about the browser).
  return /^[a-z][a-z0-9+.-]{0,30}:$/.test(url.protocol) ? url.protocol.slice(0, -1) : "other";
}

// The page's path on flysteder.hpgt.com without query string or fragment, or null for any other page.
export function pathOf(value) {
  let url;
  try { url = new URL(str(value)); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== SITE_HOST) return null;
  return /^\/[\w\-./~]{0,150}$/.test(url.pathname) ? url.pathname : "(annen)";
}

// For Trusted Types: the sink's name before «|» in the sample (as «Element innerHTML»). The rest of the sample is the
// content that was assigned, and is never kept.
export function sinkOf(sample) {
  const s = str(sample);
  const at = s.indexOf("|");
  if (at < 1) return null;
  const sink = s.slice(0, at).trim();
  return /^[A-Za-z][\w.]{0,40}( [\w.]{1,40})?$/.test(sink) ? sink : null;
}

// One report reduced to its log line, or null when it is not about a page on the site. r: the legacy «csp-report»
// object or the Reporting API's body; url: the Reporting API's report.url, when the body has no documentURL.
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

// The reports in a body: the legacy {"csp-report": {...}}, or the Reporting API's array of reports.
export function reportsIn(kind, body) {
  if (kind === "legacy") return body && typeof body === "object" && body["csp-report"] ? [{ r: body["csp-report"] }] : [];
  if (!Array.isArray(body)) return [];
  return body.filter((x) => x && x.type === "csp-violation").map((x) => ({ r: x.body, url: x.url }));
}

// The key the rate limit counts under: a hash of the address, never the address itself.
async function limitKey(ip) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`csp-report|${ip}`));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The answer to POST /v1/csp-report (the method is checked in index.js): 204 for reports read (logged or dropped),
// 415 for another content type, 413 for a body over MAX_BODY, 400 for one that is not JSON, 429 over the rate limit.
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
