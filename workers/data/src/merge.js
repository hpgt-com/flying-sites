// Flere kilder sendt som ett datasett. Ren funksjon, testet i test/data-worker.test.js.

const DATASET = "stations";

// Stasjonsdatasettet fra Holfuys og METs: Holfuys stasjoner først, så METs, med den nyeste hentetiden, METs lisens og
// begge kildene nevnt. Bare den ene når den andre ikke har noe ennå. null når ingen av dem har noe.
export function mergeStations(holfuyBody, metBody) {
  const parts = [holfuyBody, metBody].filter(Boolean).map((b) => JSON.parse(b));
  if (!parts.length) return null;
  const merged = {
    dataset: DATASET,
    source: parts.map((p) => p.source).join(", "),
    fetched: parts.map((p) => p.fetched).sort().pop(),
    items: parts.flatMap((p) => (p.items ?? []).map((i) => ({ source: p.source, ...i }))),
  };
  const license = parts.map((p) => p.license).filter(Boolean);
  if (license.length) merged.license = license.join("; ");
  return JSON.stringify(merged);
}
