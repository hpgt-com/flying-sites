// A minimal static server for the built site (_site/), for the checks that run it in a browser (check-a11y.mjs,
// check-behaviour.mjs): /tarn/ serves tarn/index.html. Nothing outside _site/ is served. stop() also cuts the open
// connections, so a page can be tested as offline.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2", ".geojson": "application/geo+json", ".gpx": "application/gpx+xml", ".webmanifest": "application/manifest+json" };

export async function serveSite(dir = path.resolve("_site")) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let file = path.join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise((resolve) => { server.close(() => resolve()); for (const s of sockets) s.destroy(); }),
  };
}
