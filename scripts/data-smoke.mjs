// After the data service is published (.github/workflows/data-worker.yml): waits until the new version has run one of
// the sources that run every few minutes (the stations, the forecast or the flights) successfully after the publish,
// and checks that a dataset is served. Exits 1 if that does not happen within MAX_WAIT_MS, and the workflow then rolls
// back to the version that ran before. One source is enough: the check is that the new code runs, not that Holfuy or
// MET is up right now (a good version was once rolled back because the source was down at the time).
//
//   node scripts/data-smoke.mjs <published at, ISO time> [base address]

export const MAX_WAIT_MS = 6 * 60000;
const POLL_MS = 15000;

// The sources whose success after the publish shows the new version runs (each on the schedule within a few minutes).
export const SMOKE_SOURCES = ["stations", "forecast", "flights"];

// What the status (/v1/status.json) says about the runs after since: done with ok when one of SMOKE_SOURCES has
// succeeded after it. Errors after since are reported but not final, since a run cut off by the publish itself can
// fail once.
export function smokeVerdict(status, since) {
  const sources = status?.sources;
  if (!sources) return { done: false, reason: "ingen status ennå" };
  const errors = Object.entries(sources).filter(([, r]) => r?.errorAt && r.errorAt > since).map(([n, r]) => `${n}: ${r.error}`);
  const ran = SMOKE_SOURCES.find((n) => sources[n]?.ok && sources[n].ok > since);
  if (ran) return { done: true, ok: true, reason: `${ran} kjørte ${sources[ran].ok}`, errors };
  return { done: false, reason: "venter på første vellykkede kjøring etter publisering", errors };
}

async function main([since, base = "https://data.hpgt.workers.dev"]) {
  if (!Number.isFinite(Date.parse(since))) throw new Error("bruk: node scripts/data-smoke.mjs <ISO-tid> [adresse]");
  const start = Date.now();
  let last = null;
  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const r = await fetch(`${base}/v1/status.json`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      last = smokeVerdict(r.ok ? await r.json() : null, since);
    } catch (err) {
      last = { done: false, reason: `status: ${err.message}` };
    }
    console.log(`${new Date().toISOString()} ${last.reason}${last.errors?.length ? ` (feil: ${last.errors.join("; ")})` : ""}`);
    if (last.done) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  if (!last?.ok) throw new Error(`den nye versjonen kjørte ikke vellykket innen ${MAX_WAIT_MS / 60000} minutter`);
  const r = await fetch(`${base}/v1/forecast.json`, { signal: AbortSignal.timeout(15000) });
  const body = r.ok ? await r.json() : null;
  if (body?.dataset !== "forecast") throw new Error(`/v1/forecast.json svarte ${r.status}`);
  console.log("Datatjenesten svarer som den skal.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1); });
}
