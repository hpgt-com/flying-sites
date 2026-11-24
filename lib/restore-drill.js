// Gjenopprettingsøvelsen (.github/workflows/restore-drill.yml): koden til datatjenesten kjøres lokalt (wrangler dev,
// workerd) med de siste sikkerhetskopiene fra kopien hos den andre leverandøren lagt i dens lokale R2, tidsplanen
// utløses én gang, og lageret må ha lest inn igjen hver rad (restore i store.js), slik /v1/status.json melder under
// backup.restored. Ren funksjon; testes i test/restore-drill.test.js.
import { TABLES, backupRows } from "../workers/data/src/backup.js";

// Radene i sikkerhetskopien for hver tabell: { table: n }. Kaster en feil for en fil som ikke er en kopi av tabellen.
export function expectedRows(files) {
  const out = {};
  for (const table of Object.keys(TABLES)) {
    if (typeof files[table] !== "string") throw new Error(`${table}: mangler`);
    out[table] = backupRows(files[table], table).length;
  }
  return out;
}

// Om statusen viser at gjenopprettingen er gjort med radene som ventes: { done, ok, reason }. Ikke ferdig mens
// kjøringene i tidsplanen fortsatt registreres (gjenopprettingen registreres sammen med de andre, etter de trege
// kildene).
export function drillVerdict(status, expected) {
  const run = status?.sources?.restore;
  if (!run?.tried) return { done: false, ok: false, reason: "venter på at kjøringen er registrert" };
  if (!run.ok) return { done: true, ok: false, reason: `innlesingen feilet: ${run.error ?? "ukjent feil"}` };
  const rows = status?.backup?.restored?.rows ?? {};
  const wrong = Object.keys(expected).filter((t) => rows[t] !== expected[t]).map((t) => `${t}: ${rows[t] ?? 0} av ${expected[t]}`);
  if (wrong.length) return { done: true, ok: false, reason: `rader lest inn stemmer ikke: ${wrong.join(", ")}` };
  return { done: true, ok: true, reason: `lest inn ${Object.keys(expected).map((t) => `${t}: ${expected[t]}`).join(", ")} på ${run.lastMs ?? "?"} ms` };
}
