// Finds broken internal links in the built site (_site/): href, src and srcset that point to a file that does not
// exist, or to an #anchor that is not on the target page. External links are not checked (no network).
// Used by scripts/check-links.mjs (npm run check:links) and the PR check.

import fs from "node:fs";
import path from "node:path";

const ATTR = /\s(href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const ID = /\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
// Links to other schemes (https:, mailto:, tel:, data:, javascript: …) and protocol-relative links are external.
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

// Every link in an HTML string, with srcset split into its URLs. Data inside <script> blocks (JSON) is left out.
export function extractLinks(html) {
  const links = [];
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => tag.slice(0, tag.indexOf(">") + 1));
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

// The file a link points to, relative to the site root, and its #anchor. null for external links.
// origin: the site's own address (links to it are checked like internal ones). prefix: PATH_PREFIX, e.g. "/flying-sites/".
export function resolveLink(link, fromPage, { origin = "", prefix = "/" } = {}) {
  let url = link.replace(/&amp;/g, "&");
  if (origin && url.startsWith(origin)) url = url.slice(origin.length) || "/";
  if (EXTERNAL.test(url)) return null;
  const [beforeHash, anchor = ""] = url.split("#");
  let target = beforeHash.split("?")[0];
  if (target === "") target = "/" + fromPage; // only #anchor: the same page
  else if (target.startsWith("/")) {
    const p = prefix.endsWith("/") ? prefix : prefix + "/";
    if (p !== "/" && target.startsWith(p)) target = "/" + target.slice(p.length);
  } else target = path.posix.join("/", path.posix.dirname(fromPage), target);
  const file = path.posix.normalize(decodeURIComponent(target)).replace(/^\/+/, "");
  return { file: target.endsWith("/") && file && !file.endsWith("/") ? file + "/" : file, anchor: decodeURIComponent(anchor) };
}

// The file that serves a path: /tarn/ and /tarn serve tarn/index.html.
function servedFile(siteDir, file) {
  const full = path.join(siteDir, file);
  if (file === "" || file.endsWith("/")) return path.join(full, "index.html");
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return path.join(full, "index.html");
  return full;
}

function htmlFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return htmlFiles(full, base);
    return e.name.endsWith(".html") ? [path.relative(base, full).split(path.sep).join("/")] : [];
  });
}

// Returns a list of { page, link, problem }. Empty when every internal link works.
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
