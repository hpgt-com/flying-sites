// Checks the built site for template and script slips such as «[object Object]» (lib/output-check.js). Run after the build:
//
//   npm run build && npm run check:output
//
// Fails with a list of the pages and what was found.

import { checkOutput } from "../lib/output-check.js";

const problems = checkOutput("_site");
for (const { page, problem, text } of problems) console.error(`${page}: ${problem} («${text}»)`);
if (problems.length) {
  console.error(`\n${problems.length} feil i de bygde sidene.`);
  process.exit(1);
}
console.log("Ingen malfeil i de bygde sidene.");
