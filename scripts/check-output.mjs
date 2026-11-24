// Sjekker det bygde nettstedet for feil fra maler og skript, som «[object Object]» (lib/output-check.js). Kjøres etter bygging:
//
//   npm run build && npm run check:output
//
// Feiler med en liste over sidene og hva som ble funnet.

import { checkOutput } from "../lib/output-check.js";

const problems = checkOutput("_site");
for (const { page, problem, text } of problems) console.error(`${page}: ${problem} («${text}»)`);
if (problems.length) {
  console.error(`\n${problems.length} feil i de bygde sidene.`);
  process.exit(1);
}
console.log("Ingen malfeil i de bygde sidene.");
