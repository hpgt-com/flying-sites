// The restore drill's two steps (lib/restore-drill.js), run by .github/workflows/restore-drill.yml:
//
//   node scripts/restore-drill.mjs expected <dir>            rows per table in <dir>/<table>.json, as JSON on stdout
//   node scripts/restore-drill.mjs verdict <status url> <expected json> [max seconds]
//                                                            polls the status until the restore is recorded; exit 1 if wrong
import fs from "node:fs";
import path from "node:path";
import { TABLES } from "../workers/data/src/backup.js";
import { expectedRows, drillVerdict } from "../lib/restore-drill.js";

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "expected") {
  const files = {};
  for (const table of Object.keys(TABLES)) {
    const file = path.join(args[0], `${table}.json`);
    if (fs.existsSync(file)) files[table] = fs.readFileSync(file, "utf8");
  }
  console.log(JSON.stringify(expectedRows(files)));
} else if (cmd === "verdict") {
  const [url, expectedJson, maxSeconds = "240"] = args;
  const expected = JSON.parse(expectedJson);
  const until = Date.now() + Number(maxSeconds) * 1000;
  let verdict = { done: false, ok: false, reason: "ikke spurt" };
  while (Date.now() < until) {
    try {
      const r = await fetch(`${url}/v1/status.json`, { signal: AbortSignal.timeout(10000) });
      verdict = drillVerdict(r.ok ? await r.json() : null, expected);
    } catch (err) {
      verdict = { done: false, ok: false, reason: `status: ${err.message}` };
    }
    console.log(`${new Date().toISOString()} ${verdict.reason}`);
    if (verdict.done) break;
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  if (!verdict.ok) { console.error(`Gjenopprettingsøvelsen feilet: ${verdict.reason}`); process.exit(1); }
} else {
  console.error("Bruk: node scripts/restore-drill.mjs expected <mappe> | verdict <adresse> <forventet json> [sekunder]");
  process.exit(2);
}
