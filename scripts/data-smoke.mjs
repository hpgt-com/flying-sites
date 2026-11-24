// Etter at datatjenesten er publisert (.github/workflows/data-worker.yml): venter til den nye versjonen har kjørt en
// av kildene som går med noen minutters mellomrom (stasjonene, varselet eller flyturene), vellykket etter
// publiseringen, og sjekker at et datasett blir servert. Avslutter med 1 hvis det ikke skjer innen MAX_WAIT_MS, og
// arbeidsflyten ruller da tilbake til versjonen som kjørte før. Én kilde er nok: sjekken er at den nye koden kjører,
// ikke at Holfuy eller MET er oppe akkurat nå (en god versjon ble en gang rullet tilbake fordi kilden var nede da).
//
//   node scripts/data-smoke.mjs <publisert, ISO-tid> [grunnadresse]

export const MAX_WAIT_MS = 6 * 60000;
const POLL_MS = 15000;

// Kildene der en vellykket kjøring etter publiseringen viser at den nye versjonen kjører (hver går etter
// tidsplanen innen noen minutter).
export const SMOKE_SOURCES = ["stations", "forecast", "flights"];

// Hva statusen (/v1/status.json) sier om kjøringene etter since: ferdig med ok når en av SMOKE_SOURCES har lyktes
// etter det. Feil etter since meldes, men er ikke endelige, siden en kjøring som avbrytes av selve publiseringen,
// kan feile én gang.
export function smokeVerdict(status, since) {
  const sources = status?.sources;
  if (!sources) return { done: false, reason: "ingen status ennå" };
  const errors = Object.entries(sources).filter(([, r]) => r?.errorAt && r.errorAt > since).map(([n, r]) => `${n}: ${r.error}`);
  const ran = SMOKE_SOURCES.find((n) => sources[n]?.ok && sources[n].ok > since);
  if (ran) return { done: true, ok: true, reason: `${ran} kjørte ${sources[ran].ok}`, errors };
  return { done: false, reason: "venter på første vellykkede kjøring etter publisering", errors };
}

async function main([since, base = "https://data.hpgt.com"]) {
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
