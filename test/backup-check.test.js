// Tester for sjekken av sikkerhetskopien utenfor Cloudflare (lib/backup-check.js). Kjør med `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import { checkBackups } from "../lib/backup-check.js";
import { backupBody } from "../workers/data/src/backup.js";

const NOW = Date.parse("2026-10-23T03:30:00Z");
const flights = (day) => backupBody("flight_days", [{ day: "2026-10-18", site: "heia", flights: 4, pilots: 3, minutes: 120, max_dist: 3.1, max_alt: 950 }], day);
const verify = (day) => backupBody("verify_hours", [], day);
const tracks = (day) => backupBody("flights", [], day);

test("sikkerhetskopi: begge tabellene fra i dag eller i går, med antall rader", () => {
  assert.deepEqual(checkBackups({ flight_days: flights("2026-10-23"), verify_hours: verify("2026-10-22"), flights: tracks("2026-10-23") }, NOW),
    ["flight_days: 1 rader fra 2026-10-23", "verify_hours: 0 rader fra 2026-10-22", "flights: 0 rader fra 2026-10-23"]);
});

test("sikkerhetskopi: en manglende, gammel, framtidig eller feil fil feiler med hva som er galt", () => {
  assert.throws(() => checkBackups({ flight_days: flights("2026-10-23") }, NOW), /verify_hours: latest.json mangler/);
  assert.throws(() => checkBackups({ flight_days: flights("2026-10-23"), verify_hours: verify("2026-10-23") }, NOW), /flights: latest.json mangler/);
  assert.throws(() => checkBackups({ flight_days: flights("2026-10-20"), verify_hours: verify("2026-10-23") , flights: tracks("2026-10-23") }, NOW), /flight_days: kopien er fra 2026-10-20, 3 dager gammel/);
  assert.throws(() => checkBackups({ flight_days: flights("2026-10-24"), verify_hours: verify("2026-10-23") , flights: tracks("2026-10-23") }, NOW), /flight_days: kopien er fra 2026-10-24/);
  assert.throws(() => checkBackups({ flight_days: flights("2026-10-23"), verify_hours: flights("2026-10-23") , flights: tracks("2026-10-23") }, NOW), /verify_hours: feil format/);
  assert.throws(() => checkBackups({ flight_days: "not json", verify_hours: verify("2026-10-23") , flights: tracks("2026-10-23") }, NOW), /JSON/);
});
