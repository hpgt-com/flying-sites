// Tests for the link check of the built site (lib/link-check.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractLinks, resolveLink, checkLinks } from "../lib/link-check.js";

function site(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "links-"));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

test("finds href, src and every URL in srcset, but not data in script blocks", () => {
  const html = `<a href="/tarn/">x</a><img src="a.jpg" srcset="/img/a-400.webp 400w, /img/a-800.webp 800w">
    <script type="application/json">{"url":"/missing/"}</script><script src="/assets/js/site.js"></script>`;
  assert.deepEqual(extractLinks(html), ["/tarn/", "a.jpg", "/img/a-400.webp", "/img/a-800.webp", "/assets/js/site.js"]);
  // End tags with a space or in capitals still end the block, and links after it are found.
  assert.deepEqual(extractLinks(`<SCRIPT>{"u":"/x/"}</SCRIPT ><a href="/a/">a</a><script>{"u":"/y/"}</script\n><a href='/b/'>b</a>`), ["/a/", "/b/"]);
});

test("external links are skipped, and the site's own address and the path prefix are removed", () => {
  assert.equal(resolveLink("https://yr.no/", "index.html"), null);
  assert.equal(resolveLink("mailto:post@hpgt.com", "index.html"), null);
  assert.equal(resolveLink("//unpkg.com/x.js", "index.html"), null);
  assert.deepEqual(resolveLink("https://flysteder.hpgt.com/tarn/", "index.html", { origin: "https://flysteder.hpgt.com" }), { file: "tarn/", anchor: "" });
  assert.deepEqual(resolveLink("/flying-sites/tarn/#evenes", "index.html", { prefix: "/flying-sites/" }), { file: "tarn/", anchor: "evenes" });
  assert.deepEqual(resolveLink("../img/a.jpg?v=2", "flysteder/elgen/index.html"), { file: "flysteder/img/a.jpg", anchor: "" });
  assert.deepEqual(resolveLink("#kart", "en/index.html"), { file: "en/index.html", anchor: "kart" });
});

test("a link to a page that only exists in Norwegian is caught (/en/luftrom/)", () => {
  const dir = site({
    "luftrom/index.html": "<p>flyttet</p>",
    "en/towers/index.html": "<h2 id='evenes'>Evenes</h2>",
    "en/sites/elgen/index.html": `<a href="/en/luftrom/">Tower</a><a href="/en/towers/#evenes">ok</a><a href="/en/towers/#bardufoss">no</a><a href="/luftrom">ok</a>`,
  });
  assert.deepEqual(checkLinks(dir), [
    { page: "en/sites/elgen/index.html", link: "/en/luftrom/", problem: "finnes ikke" },
    { page: "en/sites/elgen/index.html", link: "/en/towers/#bardufoss", problem: "ankeret finnes ikke" },
  ]);
});
