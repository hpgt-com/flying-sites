// Sjekker at alle interne lenker i det bygde nettstedet virker (lib/link-check.js). Kjøres etter bygging:
//
//   npm run build && npm run check:links
//
// Feiler med en liste over brutte lenker. Eksterne lenker sjekkes ikke.

import site from "../src/_data/site.js";
import { checkLinks } from "../lib/link-check.js";

const problems = checkLinks("_site", { origin: site.url, prefix: process.env.PATH_PREFIX || "/" });
for (const { page, link, problem } of problems) console.error(`${page}: ${link} (${problem})`);
if (problems.length) {
  console.error(`\n${problems.length} brutte lenker.`);
  process.exit(1);
}
console.log("Alle interne lenker virker.");
