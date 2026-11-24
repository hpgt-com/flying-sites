// Minutter mellom kjøringene per kilde, i timeplanen som kjører hvert minutt (wrangler.toml). Stasjonene rapporterer
// hvert eller annethvert minutt, så de hentes hvert minutt (en måling som alt er lagret, beholdes én gang). Varselet
// endres omtrent én gang i timen, og hver kjøring henter 6 startsteder (sources/forecast.js). METs stasjoner
// rapporterer hvert tiende minutt (sources/frost.js). Høydevinden: 2 startsteder hvert tiende minutt
// (sources/windgram.js). Hvor godt varselet traff, regnes ut to ganger i timen fra det som alt er lagret
// (sources/verify.js). Paraglidere i lufta telles hvert minutt (sources/flights.js), så også en kort tur ses, og
// sporet til en tur har ett punkt i minuttet.
// Gjenopprettingen av et nytt, tomt lager fra den siste sikkerhetskopien (store.js restore) prøves hvert minutt til den
// har lyktes én gang. Det leser index.js fra helsetilstanden.
export const INTERVALS = { forecast: 5, stations: 1, met: 10, windgram: 10, verify: 30, flights: 1, backup: 1440, grid: 180, gridWide: 360, ognDdb: 1440, restore: 1 };
// Minuttet i intervallet hver kilde kjører på. Alle kildene kjører i samme kall, og gratisplanen gir ett kall 10 ms CPU
// til sammen. Derfor deler de tyngste (varselet, MET, høydevinden) aldri et minutt: varselet på :00 og :05, MET på :03,
// høydevinden på :07 (og så videre hvert tiende minutt), verifiseringen på :09 og :39.
// Flyaktiviteten er lett (ett lite svar fra OGN, for det meste tomt) og kjører hvert minutt. Sikkerhetskopien
// (backup.js) én gang i døgnet kl. 02:14 UTC, et minutt ingen annen tung kilde har. Arbeidet gjøres i lageret, ikke
// her. OGNs liste over enheter som ikke skal spores (for APRS-reserven, aprs.js) én gang i døgnet kl. 05:14 UTC, også
// i lageret. Varselrutenettene (sources/grid.js): det tette hver tredje time på :21 (00:21, 03:21 …), det store hver
// sjette på :51 (00:51, 06:51 …), så de aldri deler minutt mot Open-Meteo. Også de gjør arbeidet i lageret.
export const OFFSETS = { forecast: 0, stations: 0, met: 3, windgram: 7, verify: 9, flights: 0, backup: 134, grid: 21, gridWide: 51, ognDdb: 314, restore: 0 };

// Kildene som tar igjen et tapt minutt (Cloudflares Cron Triggers er best effort, og en kjøring kan hoppes over eller
// avbrytes): de daglige og varselrutenettene. For dem ville et tapt minutt ellers bety et døgn (eller timer) uten
// sikkerhetskopi, liste over enheter som ikke skal spores, eller rutenett. De andre kjører så ofte at neste minutt tar
// det igjen.
export const CATCH_UP = ["backup", "ognDdb", "grid", "gridWide"];

// Om kilden skal kjøre i det planlagte minuttet (scheduledTime i millisekunder), eller, for kildene i CATCH_UP, om den
// sist kjørte (lastTried, ISO-tid fra helsetilstanden, index.js) for mer enn ett intervall og ett minutt siden. En
// daglig kilde der siste kjøring feilet (failed, fra samme tilstand), prøves igjen etter RETRY_MINUTES minutter i
// stedet for et døgn senere. Da gir ikke en dårlig dag i den andre enden et døgn uten sikkerhetskopi eller liste over
// enheter som ikke skal spores. En kilde som fortsetter å feile, prøves likevel bare én gang i timen, ikke hvert
// minutt, fordi en feilet kjøring regnes som forsøkt.
export const RETRY_MINUTES = 60;
export function due(name, time, lastTried, failed) {
  if (Math.floor(time / 60000) % INTERVALS[name] === (OFFSETS[name] ?? 0)) return true;
  if (!CATCH_UP.includes(name) || !lastTried) return false;
  const wait = failed ? Math.min(RETRY_MINUTES, INTERVALS[name]) : INTERVALS[name];
  return time - Date.parse(lastTried) >= (wait + 1) * 60000;
}
