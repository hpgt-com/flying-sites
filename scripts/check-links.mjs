// Checks that every internal link in the built site works (lib/link-check.js). Run after the build:
//
//   npm run build && npm run check:links
//
// Fails with a list of broken links. External links are not checked.

import site from "../src/_data/site.js";
import { checkLinks } from "../lib/link-check.js";

const problems = checkLinks("_site", { origin: site.url, prefix: process.env.PATH_PREFIX || "/" });
for (const { page, link, problem } of problems) console.error(`${page}: ${link} (${problem})`);
if (problems.length) {
  console.error(`\n${problems.length} brutte lenker.`);
  process.exit(1);
}
console.log("Alle interne lenker virker.");
