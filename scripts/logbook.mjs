// «Fra turlogger»: reads flight logs (IGC, and KML with times) from one or more folders on your own machine and writes
// only the sums per site to src/_data/logbook.json (lib/igc.js): flights per month and the longest, highest and
// farthest. The logs themselves, the tracks and the names in them are never written anywhere. The box on the site page
// shows only while logbook.json exists; it is left out until more pilots have added logs. Run it again over all the folders when logs are added (the
// file is written anew each time); the same flight in an IGC and a KML file counts once (the IGC is kept).
//
//   npm run logbook -- ~/turer [~/turer-fra-andre …]
//   npm run logbook -- --list ~/turer     (also lists the files without a flight, to see why)
//   npm run logbook -- --skip 2020-05-01_10-54 ~/turer     (leaves out the files whose name holds it; repeatable)
//
// Look over src/_data/logbook.json before committing it.

import fs from "node:fs";
import path from "node:path";
import { readSites } from "../lib/site-files.js";
import { parseIgc, parseKml, analyzeFlight, launchPoints, aggregate, flightKey } from "../lib/igc.js";

const OUT = "src/_data/logbook.json";
const list = process.argv.includes("--list");
const args = process.argv.slice(2), skip = [], folders = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--skip") skip.push(args[++i]);
  else if (args[i] !== "--list") folders.push(args[i]);
}
if (!folders.length) {
  console.error("Bruk: npm run logbook -- <mappe med IGC/KML> [flere mapper …]");
  process.exit(1);
}

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (/\.(igc|kml)$/i.test(e.name)) out.push(p);
  }
  return out;
}

const launches = launchPoints(readSites().map((s) => ({ id: s.id, launch: s.data.launch, launches: s.data.launches })));
const byKey = new Map();
let read = 0, noFlight = 0, failed = 0, skipped = 0;
const used = { igc: 0, kml: 0 }, without = [];
for (const folder of folders) {
  for (const file of files(folder)) {
    if (skip.some((s) => path.basename(file).includes(s))) { skipped++; continue; }
    read++;
    try {
      const text = fs.readFileSync(file, "utf8");
      const igc = /\.igc$/i.test(file);
      const flight = analyzeFlight(igc ? parseIgc(text) : parseKml(text), launches);
      if (!flight || !flight.date) { noFlight++; without.push(file); continue; }
      used[igc ? "igc" : "kml"]++;
      const key = flightKey(flight);
      // The IGC wins over a KML of the same flight (it has the logger's own heights).
      if (!byKey.has(key) || igc) byKey.set(key, flight);
    } catch {
      failed++;
    }
  }
}

const sums = aggregate([...byKey.values()]);
const body = { generated: new Date().toISOString().slice(0, 10), pilots: folders.length, ...sums };
fs.writeFileSync(OUT, JSON.stringify(body, null, 1) + "\n");
console.log(`Leste ${read} filer: ${byKey.size} turer (${sums.flights - sums.unattributed} fra kjente steder, ${sums.unattributed} andre steder), ${noFlight} uten tur, ${failed} som ikke kunne leses${skipped ? `, ${skipped} hoppet over (--skip)` : ""}.`);
console.log(`Turer funnet i ${used.igc} IGC- og ${used.kml} KML-filer (samme tur i begge telles én gang).`);
if (list && without.length) console.log("Uten tur (ingen tidspunkter, eller ingen bevegelse):\n" + without.map((f) => "  " + f).join("\n"));
else if (without.length) console.log("Kjør med --list for å se filene uten tur.");
console.log(Object.entries(sums.sites).sort((a, b) => b[1].flights - a[1].flights).map(([id, s]) => `  ${id}: ${s.flights}`).join("\n"));
console.log(`Skrev ${OUT}. Se over den før du committer.`);
