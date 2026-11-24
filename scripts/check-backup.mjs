// Sjekker kopien av nattens sikkerhetskopi hos den andre leverandøren (lib/backup-check.js): kjøres av
// .github/workflows/backup.yml med mappen latest.json-filene i kopien ble lastet ned til (<dir>/<table>/latest.json).
// Feiler med det som er galt.
//
//   node scripts/check-backup.mjs <dir>

import fs from "node:fs";
import path from "node:path";
import { TABLES } from "../workers/data/src/backup.js";
import { checkBackups } from "../lib/backup-check.js";

const dir = process.argv[2];
if (!dir) { console.error("Bruk: node scripts/check-backup.mjs <mappe>"); process.exit(2); }
const files = {};
for (const table of Object.keys(TABLES)) {
  const file = path.join(dir, table, "latest.json");
  if (fs.existsSync(file)) files[table] = fs.readFileSync(file, "utf8");
}
try {
  for (const line of checkBackups(files, Date.now())) console.log(line);
} catch (err) {
  console.error(`Kopien av sikkerhetskopien er ikke i orden: ${err.message}`);
  process.exit(1);
}
