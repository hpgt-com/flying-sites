// Sjekker kopien av nattens sikkerhetskopi hos den andre leverandøren (.github/workflows/backup.yml): latest.json for
// hver tabell må kunne leses som en sikkerhetskopi av tabellen (backupRows i workers/data/src/backup.js) og være fra
// i dag eller i går (Workeren skriver den kl. 02:14 UTC, kopien tas kl. 03:30). Gir én linje per tabell til loggen,
// eller kaster en feil som sier hva som er galt, så arbeidsflyten feiler og åpner en sak. Ren funksjon; testes i
// test/backup-check.test.js.
import { TABLES, backupRows } from "../workers/data/src/backup.js";

export const MAX_AGE_DAYS = 1;

// files: { table: text }; now: millisekunder.
export function checkBackups(files, now) {
  const today = new Date(now).toISOString().slice(0, 10);
  const lines = [];
  for (const table of Object.keys(TABLES)) {
    const text = files[table];
    if (typeof text !== "string") throw new Error(`${table}: latest.json mangler i kopien`);
    const rows = backupRows(text, table);
    const day = JSON.parse(text).day;
    const age = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Math.round((Date.parse(today) - Date.parse(day)) / 86400000) : NaN;
    if (!(age >= 0 && age <= MAX_AGE_DAYS)) throw new Error(`${table}: kopien er fra ${day}, ${Number.isNaN(age) ? "ukjent alder" : `${age} dager gammel`} (grense ${MAX_AGE_DAYS})`);
    lines.push(`${table}: ${rows.length} rader fra ${day}`);
  }
  return lines;
}
