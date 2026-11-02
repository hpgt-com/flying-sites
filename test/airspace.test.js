import { test } from "node:test";
import assert from "node:assert/strict";
import { applyManualAirspace } from "../lib/airspace.js";
import { fetchRegion } from "../lib/airspace.js";

const fetched = [
  { name: "Evenes TMA", type: "TMA", lower: { value: 4500, unit: "FT", ref: "MSL" } },
  { name: "Evenes CTR", type: "CTR", lower: { value: 0, unit: "FT", ref: "GND" } },
];

test("name and note match on type and lower limit", () => {
  const out = applyManualAirspace(fetched, [{ name: "Evenes TMA1", type: "TMA", lower: { value: 4500, unit: "FT" }, note: "Klasse D." }]);
  assert.equal(out[0].name, "Evenes TMA1");
  assert.equal(out[0].note, "Klasse D.");
  assert.equal(out[1].note, undefined);
});

test("a line with only name and note matches the airspace with the same name", () => {
  const out = applyManualAirspace(fetched, [{ name: "Evenes CTR", nearby: true, note: "Ring tårnet." }]);
  assert.equal(out[1].note, "Ring tårnet.");
  assert.equal(out[0].note, undefined);
});

test("a line with a type does not match on name alone", () => {
  const out = applyManualAirspace(fetched, [{ name: "Evenes CTR", type: "TMA", lower: { value: 2500, unit: "FT" }, note: "x" }]);
  assert.equal(out[1].note, undefined);
});

test("openAIP: a refused key gives openAIP's own reason and a hint about OPENAIP_API_KEY", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Forbidden: API key expired", { status: 403 });
  try {
    await assert.rejects(() => fetchRegion(68.9, 17.3, 1000, "k"), /openAIP svarte 403: Forbidden: API key expired\. Sjekk at OPENAIP_API_KEY/);
    globalThis.fetch = async () => new Response('<!doctype html><title>403</title>403 Forbidden<a href="https://api.core.openaip.net/cdn-cgi/content?id=x">', { status: 403 });
    await assert.rejects(() => fetchRegion(68.9, 17.3, 1000, "k"), /fra Cloudflare foran openAIP: .*ikke på grunn av nøkkelen/, "a Cloudflare block is told apart from a bad key");
    globalThis.fetch = async () => new Response("", { status: 500 });
    await assert.rejects(() => fetchRegion(68.9, 17.3, 1000, "k"), (e) => e.message === "openAIP svarte 500.");
  } finally {
    globalThis.fetch = realFetch;
  }
});
