// Serving several sources as one dataset. Pure, tested in test/data-worker.test.js.

const DATASET = "stations";

// The stations dataset from Holfuy's and MET's: Holfuy's stations first, then MET's, with the newest fetch time, MET's
// licence and both sources named. Either alone when the other has nothing yet; null when neither has.
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
