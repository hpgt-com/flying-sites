// «Fra turlogger»: leser flylogger (IGC, og KML med tider) fra én eller flere mapper på din egen maskin og skriver
// bare summene per flysted til src/_data/logbook.json (lib/igc.js): turer per måned og den lengste, høyeste og
// fjerneste. Selve loggene, sporene og navnene i dem skrives aldri noe sted. Boksen på flystedssiden vises bare
// så lenge logbook.json finnes; den er utelatt til flere piloter har lagt inn logger. Kjør på nytt over alle mappene
// når det kommer nye logger (filen skrives på nytt hver gang); samme tur i en IGC- og en KML-fil telles én gang
// (IGC-en beholdes).
//
//   npm run logbook -- ~/turer [~/turer-fra-andre …]
//   npm run logbook -- --list ~/turer     (lister også filene uten tur, så du ser hvorfor)
//   npm run logbook -- --skip 2020-05-01_10-54 ~/turer     (utelater filene med dette i navnet; kan gjentas)
//
// Se over src/_data/logbook.json før du committer den.

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
      // IGC-en går foran en KML av samme tur (den har loggerens egne høyder).
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
