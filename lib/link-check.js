// Finner brutte interne lenker i det bygde nettstedet (_site/): href, src og srcset som peker til en fil som ikke
// finnes, eller til et #anker som ikke er på målsiden. Eksterne lenker sjekkes ikke (ikke noe nettverk).
// Brukes av scripts/check-links.mjs (npm run check:links) og sjekken av PR-er.

import fs from "node:fs";
import path from "node:path";

const ATTR = /\s(href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const ID = /\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
// Lenker med andre skjemaer (https:, mailto:, tel:, data:, javascript: …) og protokollrelative lenker er eksterne.
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

// HTML-en med innholdet i hver <script>-blokk fjernet, men med åpningstaggene igjen (for src). Et vanlig søk
// i stedet for et regulært uttrykk, så alle former av slutttaggen teller («</script>», «</SCRIPT >»).
export function withoutScriptBodies(html) {
  const lower = html.toLowerCase();
  let out = "";
  let i = 0;
  for (;;) {
    const start = lower.indexOf("<script", i);
    const open = start < 0 ? -1 : lower.indexOf(">", start);
    if (open < 0) return out + html.slice(i);
    out += html.slice(i, open + 1);
    const close = lower.indexOf("</script", open);
    if (close < 0) return out;
    i = close;
  }
}

// Alle lenker i en HTML-tekst, med srcset delt opp i adressene sine. Data i <script>-blokker (JSON) utelates.
export function extractLinks(html) {
  const links = [];
  const markup = withoutScriptBodies(html);
  for (const m of markup.matchAll(ATTR)) {
    const value = (m[2] ?? m[3]).trim();
    if (m[1].toLowerCase() === "srcset") links.push(...value.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean));
    else if (value) links.push(value);
  }
  return links;
}

export function extractIds(html) {
  return new Set([...html.matchAll(ID)].map((m) => m[1] ?? m[2]));
}

// Filen en lenke peker til, relativt til roten av nettstedet, og #ankeret. null for eksterne lenker.
// origin: nettstedets egen adresse (lenker dit sjekkes som interne). prefix: PATH_PREFIX, f.eks. "/flying-sites/".
export function resolveLink(link, fromPage, { origin = "", prefix = "/" } = {}) {
  let url = link.replace(/&amp;/g, "&");
  if (origin && url.startsWith(origin)) url = url.slice(origin.length) || "/";
  if (EXTERNAL.test(url)) return null;
  const [beforeHash, anchor = ""] = url.split("#");
  let target = beforeHash.split("?")[0];
  if (target === "") target = "/" + fromPage; // bare #anker: samme side
  else if (target.startsWith("/")) {
    const p = prefix.endsWith("/") ? prefix : prefix + "/";
    if (p !== "/" && target.startsWith(p)) target = "/" + target.slice(p.length);
  } else target = path.posix.join("/", path.posix.dirname(fromPage), target);
  const file = path.posix.normalize(decodeURIComponent(target)).replace(/^\/+/, "");
  return { file: target.endsWith("/") && file && !file.endsWith("/") ? file + "/" : file, anchor: decodeURIComponent(anchor) };
}

// Filen som svarer for en sti: /tarn/ og /tarn gir tarn/index.html.
function servedFile(siteDir, file) {
  const full = path.join(siteDir, file);
  if (file === "" || file.endsWith("/")) return path.join(full, "index.html");
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return path.join(full, "index.html");
  return full;
}

export function htmlFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return htmlFiles(full, base);
    return e.name.endsWith(".html") ? [path.relative(base, full).split(path.sep).join("/")] : [];
  });
}

// Gir en liste med { page, link, problem }. Tom når alle interne lenker virker.
export function checkLinks(siteDir, options = {}) {
  const problems = [];
  const idCache = new Map();
  const ids = (file) => {
    if (!idCache.has(file)) idCache.set(file, extractIds(fs.readFileSync(file, "utf8")));
    return idCache.get(file);
  };
  for (const page of htmlFiles(siteDir)) {
    const html = fs.readFileSync(path.join(siteDir, page), "utf8");
    for (const link of new Set(extractLinks(html))) {
      const target = resolveLink(link, page, options);
      if (!target) continue;
      const file = servedFile(siteDir, target.file);
      if (!fs.existsSync(file)) problems.push({ page, link, problem: "finnes ikke" });
      else if (target.anchor && file.endsWith(".html") && !ids(file).has(target.anchor)) problems.push({ page, link, problem: "ankeret finnes ikke" });
    }
  }
  return problems;
}
