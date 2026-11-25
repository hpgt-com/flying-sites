// Trusted Types-policyene (src/assets/js/trusted-types.js): «default» slipper bare gjennom HTML-en Leaflet lager, og
// «fs-script-url» bare skriptadressene sidene laster. Fila kjøres i en sandkasse med en enkel trustedTypes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function load() {
  const policies = {};
  const sandbox = {
    URL,
    TypeError,
    location: { href: "https://flysteder.hpgt.com/flysteder/heia/", origin: "https://flysteder.hpgt.com" },
    trustedTypes: { createPolicy: (name, rules) => (policies[name] = rules) },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync("src/assets/js/trusted-types.js", "utf8"), sandbox);
  return { policies, api: sandbox.FSTrustedTypes };
}

test("trusted-types: default slipper gjennom HTML-en Leaflet lager", () => {
  const html = load().policies.default.createHTML;
  for (const s of [
    "<svg/>",
    " Satellitt",
    "5 km",
    "",
    '<span aria-hidden="true">+</span>',
    '<span aria-hidden="true">&#x2212;</span>',
    '<span aria-hidden="true">&#215;</span>',
    '<input type="radio" class="leaflet-control-layers-selector" name="leaflet-base-layers_42" checked="checked"/>',
    '<a href="https://leafletjs.com">Leaflet</a> <span aria-hidden="true">|</span> &copy; <a href="https://www.kartverket.no/">Kartverket</a>, Piloter: <a href="https://www.glidernet.org" target="_blank" rel="noopener">Open Glider Network</a> (ODbL)',
  ]) assert.equal(html(s), s, s);
});

test("trusted-types: default blokkerer annen HTML", () => {
  const html = load().policies.default.createHTML;
  for (const s of [
    "<img src=x onerror=alert(1)>",
    '<a href="javascript:alert(1)">x</a>',
    '<a href="http://example.org">x</a>',
    '<a href="https://example.org" onclick="alert(1)">x</a>',
    '<a href="https://example.org"><b>x</b></a>',
    '<span aria-hidden="true">x</span>',
    "<script>alert(1)</script>",
    '<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>',
  ]) assert.equal(html(s), null, s);
});

test("trusted-types: skriptadressene sidene laster, og ingen andre", () => {
  const url = load().policies["fs-script-url"].createScriptURL;
  for (const s of [
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    "/sw.js",
    "/assets/js/live.js?v=5ad5c6fb",
    "/assets/js/forecast-layer.js",
  ]) assert.equal(url(s), s, s);
  for (const s of [
    "https://challenges.cloudflare.com/turnstile/v0/api.js",
    "https://example.org/sw.js",
    "/sw.js?x=1",
    "/assets/js/live.js?v=1&x=2",
    "/uploads/evil.js",
    "data:text/javascript,alert(1)",
  ]) assert.throws(() => url(s), TypeError, s);
});

test("trusted-types: uten Trusted Types i nettleseren gir hjelperen adressen tilbake", () => {
  const sandbox = { URL, TypeError, location: { href: "https://flysteder.hpgt.com/" } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync("src/assets/js/trusted-types.js", "utf8"), sandbox);
  assert.equal(sandbox.FSTrustedTypes.scriptURL("/sw.js"), "/sw.js");
});
