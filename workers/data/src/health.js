// Helsen til datatjenesten, som /v1/status.json. For hver kilde: når den sist kjørte, når den sist lyktes og den siste
// feilen. For hvert datasett: når det sist ble skrevet, hvor gammelt det er og om det er innenfor grensen (MAX_AGE).
// Startstedene som mangler i varselet og i høydevinden, og den siste arkiverte dagen per stasjonskilde, er også med.
// Ingenting i den er hemmelig eller handler om en besøkende. Leses av timesjekken .github/workflows/health.yml, som
// åpner en sak når noe er for gammelt. Testet i test/data-worker.test.js.

// Minutter et datasett kan gå uten å bli skrevet før det regnes som for gammelt: noen tapte kjøringer av kilden
// (schedule.js), så én treg eller feilet kjøring gir ikke alarm. Flyturene skrives bare når noen er i lufta,
// verifiseringen to ganger i timen, og varselrutenettene hver tredje og sjette time.
export const MAX_AGE = { forecast: 60, stations: 15, windgram: 90, verification: 90, grid: 400, "grid-wide": 760 };

// En feilmelding slik den kan vises: adresser utelates (Holfuys adresse har nøkkelen i seg), og den holdes kort.
export const cleanError = (message) => String(message).replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[adresse]").replace(/[?&][^\s=]+=\S+/g, "").slice(0, 200);

// Kjøringene til kildene: { name: { tried, ok, error, errorAt, lastMs, avgMs, maxMs } }, fra den forrige og resultatene
// fra denne kjøringen ({ name: null ved suksess, feilmeldingen, eller { error, ms } med hvor lang tid kjøringen tok }).
// lastMs er den siste kjøringen, avgMs et glidende snitt (en femtedel av hver ny kjøring, så endringer gjennom dagen
// vises uten at én treg kjøring svinger det), maxMs den tregeste kjøringen i dag (nullstilles med dagen).
export function recordRuns(prev, results, now) {
  const out = { ...(prev ?? {}) };
  const at = new Date(now).toISOString();
  for (const [name, result] of Object.entries(results)) {
    const { error, ms } = result && typeof result === "object" ? result : { error: result, ms: null };
    const r = { ...out[name], tried: at, ...(error ? { error: cleanError(error), errorAt: at } : { ok: at }) };
    if (Number.isFinite(ms)) {
      r.lastMs = Math.round(ms);
      r.avgMs = Math.round(Number.isFinite(r.avgMs) ? r.avgMs + (ms - r.avgMs) / 5 : ms);
      const sameDay = typeof r.maxAt === "string" && r.maxAt.slice(0, 10) === at.slice(0, 10);
      if (!sameDay || ms > r.maxMs) { r.maxMs = Math.round(ms); r.maxAt = at; }
    }
    out[name] = r;
  }
  return out;
}

// Dager sikkerhetskopien om natten (store.js backup) kan ligge etter før det regnes som et problem. Én tapt kjøring gir
// ikke alarm.
export const BACKUP_MAX_DAYS = 2;

// Statusen. snapshots: { dataset: { updated, body } } som lagret. expected: { forecast: [ids], windgram: [ids] },
// startstedene hver skal ha. archive: { source: siste arkiverte dag }. backup: { day, rows } fra den siste
// sikkerhetskopien om natten, eller null når ingen er laget (da bare ok så lenge arkivet ikke er satt opp, uten
// env.ARCHIVE). restore: { at, rows } når dette lageret leste inn den siste sikkerhetskopien ved start (store.js
// restore), vist under backup som restored.
// Kilden som skriver et datasett, der navnet er et annet (index.js scheduled).
const SOURCE_OF = { verification: "verify", "grid-wide": "gridWide" };

export function buildStatus({ runs, snapshots, expected, archive, backup, restore, now }) {
  const datasets = {};
  let ok = true;
  for (const [name, max] of Object.entries(MAX_AGE)) {
    const snap = snapshots[name];
    const updated = snap?.updated ?? null;
    const age = updated ? Math.round((now - Date.parse(updated)) / 60000) : null;
    // Et datasett der kilden aldri har kjørt (en ny kilde, før første tur i timeplanen), venter. Det gir ikke alarm.
    const pending = !snap && !runs?.[SOURCE_OF[name] ?? name];
    const d = { updated, ageMinutes: age, maxAgeMinutes: max, ok: pending || (age !== null && age <= max), ...(pending ? { pending: true } : {}) };
    if (expected[name] && snap?.body) {
      let sites = {};
      try { sites = JSON.parse(snap.body).sites ?? {}; } catch { /* ikke JSON */ }
      d.missing = expected[name].filter((id) => !Object.hasOwn(sites, id));
    }
    if (!d.ok) ok = false;
    datasets[name] = d;
  }
  const today = new Date(now).toISOString().slice(0, 10);
  const backupDays = backup?.day ? Math.round((Date.parse(today) - Date.parse(backup.day)) / 86400000) : null;
  const b = backup === undefined ? null : { day: backup?.day ?? null, daysAgo: backupDays, maxDays: BACKUP_MAX_DAYS, ok: backupDays !== null && backupDays <= BACKUP_MAX_DAYS, restored: restore ?? null };
  if (b && !b.ok) ok = false;
  return { dataset: "status", fetched: new Date(now).toISOString(), ok, datasets, sources: runs ?? {}, archive, backup: b };
}
