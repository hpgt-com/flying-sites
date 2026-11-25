// En minimal statisk server for det bygde nettstedet (_site/), for sjekkene som kjører det i en nettleser
// (check-a11y.mjs, check-behaviour.mjs): /tarn/ gir tarn/index.html. Ingenting utenfor _site/ serveres. stop() kutter
// også de åpne forbindelsene, så en side kan testes som uten nett.
//
// HTML-sidene får Trusted Types-direktivene fra CSP-en i _site/_headers (require-trusted-types-for og trusted-types),
// så sjekkene kjører med Trusted Types håndhevet som i drift. Resten av CSP-en har sidene i <meta>.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2", ".geojson": "application/geo+json", ".gpx": "application/gpx+xml", ".webmanifest": "application/manifest+json" };

// Trusted Types-direktivene i Content-Security-Policy for /* i _headers, eller null når fila eller direktivene mangler.
export function trustedTypesPolicy(dir) {
  const file = path.join(dir, "_headers");
  if (!fs.existsSync(file)) return null;
  let all = false;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (/^\S/.test(line)) { all = line.trim() === "/*"; continue; }
    const m = all && line.match(/^\s+Content-Security-Policy:\s*(.*)$/);
    if (!m) continue;
    const tt = m[1].split(";").map((d) => d.trim()).filter((d) => /^(require-trusted-types-for|trusted-types)\b/.test(d));
    return tt.length ? tt.join("; ") : null;
  }
  return null;
}

export async function serveSite(dir = path.resolve("_site")) {
  const sockets = new Set();
  const tt = trustedTypesPolicy(dir);
  const server = http.createServer((req, res) => {
    let file = path.join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    const headers = { "content-type": TYPES[path.extname(file)] || "application/octet-stream" };
    if (tt && file.endsWith(".html")) headers["content-security-policy"] = tt;
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise((resolve) => { server.close(() => resolve()); for (const s of sockets) s.destroy(); }),
  };
}
