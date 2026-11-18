import { test } from "node:test";
import assert from "node:assert/strict";
import { applyManualAirspace } from "../lib/airspace.js";
import { fetchCountry, withinCircles } from "../lib/airspace.js";

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
    await assert.rejects(() => fetchCountry("NO", "k"), /openAIP svarte 403: Forbidden: API key expired\. Sjekk at OPENAIP_API_KEY/);
    globalThis.fetch = async () => new Response('<!doctype html><title>403</title>403 Forbidden<a href="https://api.core.openaip.net/cdn-cgi/content?id=x">', { status: 403 });
    await assert.rejects(() => fetchCountry("NO", "k"), /fra Cloudflare foran openAIP: .*ikke på grunn av nøkkelen/, "a Cloudflare block is told apart from a bad key");
    globalThis.fetch = async () => new Response("", { status: 500 });
    await assert.rejects(() => fetchCountry("NO", "k"), (e) => e.message === "openAIP svarte 500.");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("openAIP: the country is fetched page by page, without geographic query parameters", async () => {
  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const page = Number(new URL(url).searchParams.get("page"));
    const item = { _id: `a${page}`, name: `A${page}`, type: 7, lowerLimit: { value: 2500, unit: 1, referenceDatum: 1 }, geometry: { type: "Polygon", coordinates: [[[16, 68], [17, 68], [17, 69], [16, 68]]] } };
    return Response.json({ items: [item], totalPages: 2 });
  };
  try {
    const items = await fetchCountry("NO", "k");
    assert.equal(items.length, 2);
    assert.equal(urls.length, 2);
    for (const u of urls) {
      const q = new URL(u).searchParams;
      assert.equal(q.get("country"), "NO");
      assert.ok(!q.has("pos") && !q.has("dist") && !q.has("bbox"), "no geographic query parameters");
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("withinCircles keeps airspace inside or reaching into a circle, and drops the rest", () => {
  const square = (lon, lat) => ({ geometry: { type: "Polygon", coordinates: [[[lon, lat], [lon + 0.2, lat], [lon + 0.2, lat + 0.1], [lon, lat + 0.1], [lon, lat]]] } });
  const over = square(16.3, 68.75); // the launch is inside it
  const near = square(16.9, 68.8); // about 15 km east
  const far = square(23.0, 69.5); // Finnmark
  const circles = [{ center: { lat: 68.79, lon: 16.45 }, radiusKm: 20 }];
  assert.deepEqual(withinCircles([over, near, far], circles), [over, near]);
  assert.deepEqual(withinCircles([near], [{ center: { lat: 68.79, lon: 16.45 }, radiusKm: 5 }]), []);
});
