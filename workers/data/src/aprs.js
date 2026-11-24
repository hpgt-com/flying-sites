// Reserven for «Piloter i lufta» og flyaktiviteten når OGNs nettkart (live.glidernet.org, live.js) ikke svarer: de
// samme posisjonene lest rett fra OGNs APRS-servere. Det er strømmen alle mottakere og apper (også pgpilot) sender til,
// og som nettkartet selv leser. En tilkobling som bare leser (passcode -1), med et områdefilter for stedenes område
// (live.js bounds), holdes åpen noen sekunder. Det er tiden det tar å høre hvert luftfartøy i lufta minst én gang. Den
// nyeste posisjonen for hvert luftfartøy beholdes. Bare paraglidere (luftfartøytype 7), som fra nettkartet.
// OGNs regler (glidernet.org/ogn-data-usage), som nettkartet følger for oss, må følges her i stedet. En enhet som ikke
// skal spores, etter flagget i meldingen eller «tracked: N» i OGNs enhetsregister (DDB), utelates. Ingen enhet
// identifiseres (alle navn er null og vises som ukjent). Registerets liste over enheter som ikke skal spores, hentes i
// lageret én gang i døgnet (Store.refreshNoTrack; noen MB, mer CPU enn en Worker-kjøring har) og beholdes, så den
// finnes når OGN er nede. Uten listen gir reserven ingenting heller enn å risikere å vise en slik enhet.
// Testet i test/data-worker.test.js.

import { bounds, MAX_AGE_SECONDS, PARAGLIDER } from "./live.js";

export const APRS_HOST = "aprs.glidernet.org";
// Porten for en klients eget filter (10152 er strømmen for hele verden).
export const APRS_PORT = 14580;
// Enhetsregisteret som CSV (JSON-adressen, download/?j=1, sender hit siden oktober 2026). Bare over HTTPS: en liste
// hentet over HTTP kan endres underveis, og den avgjør hvem som vises.
export const DDB_URL = "https://ddb.glidernet.org/download/ddb-cache.csv";
// Hvor lenge listen fra enhetsregisteret brukes før den hentes på nytt.
export const DDB_MAX_AGE_HOURS = 24;
// Hvor lenge en lagret liste fortsatt brukes når registeret ikke svarer. Etter det gir reserven ingenting: en pilot som
// ba OGN om ikke å bli sporet etter at listen ble hentet, skal ikke vises.
export const DDB_MAX_KEEP_HOURS = 7 * 24;
// Registeret har titusenvis av enheter. Et svar med langt færre regnes som feil, ikke som listen.
const DDB_MIN_DEVICES = 1000;
const FEET = 0.3048, KNOTS = 0.5144;

// Områdefilteret: a/nord/vest/sør/øst.
export function aprsFilter(sites) {
  const b = bounds(sites);
  return `a/${b.n.toFixed(2)}/${b.w.toFixed(2)}/${b.s.toFixed(2)}/${b.e.toFixed(2)}`;
}

export function loginLine(sites) {
  return `user HPGTFS pass -1 vers hpgt-flysteder 1.0 filter ${aprsFilter(sites)}\r\n`;
}

// Tiden for en posisjon, hhmmss UTC, på dagen til now (eller dagen før, for en tid like før midnatt).
function positionTime(hhmmss, now) {
  const d = new Date(now);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +hhmmss.slice(0, 2), +hhmmss.slice(2, 4), +hhmmss.slice(4, 6));
  if (t > now + 300000) t -= 86400000;
  return t;
}

// Grader fra APRS-formatet ddmm.mm (eller dddmm.mm), med den ekstra tusendelen av et minutt fra «!Wab!».
const degrees = (deg, min, extra, sign) => (Number(deg) + (Number(min) + extra / 1000) / 60) * (sign === "S" || sign === "W" ? -1 : 1);

// Én linje fra strømmen som et element med samme form som live.js parseLive gir (id = enhetsadressen i hex med små
// bokstaver, name alltid null), eller null for: kommentarer og serverlinjer, andre meldinger enn posisjoner fra
// luftfartøy, andre luftfartøy enn paraglidere, enheter som ikke skal spores (flagget, eller i noTrack: et Set med
// adresser i hex med store bokstaver) og posisjoner eldre enn MAX_AGE_SECONDS.
//   FLRDDA5BA>OGFLR,qAS,Rx:/160829h6847.41N/01622.03E'342/049/A=005524 !W52! id1EDDA5BA -454fpm -1.1rot 8.8dB
const POSITION = /^[A-Z0-9]{3,9}>[A-Z0-9]+,[^:]*:[/@](\d{6})h(\d{2})(\d{2}\.\d{2})([NS]).(\d{3})(\d{2}\.\d{2})([EW]).(?:(\d{3})\/(\d{3}))?\/A=(-?\d{5,6})(.*)$/;
export function parseAprsLine(line, now = Date.now(), noTrack = new Set()) {
  const m = POSITION.exec(String(line).trim());
  if (!m) return null;
  const comment = m[11];
  const id = /\bid([0-9A-F]{2})([0-9A-F]{6})\b/.exec(comment);
  if (!id) return null;
  // Detaljbyten, STttttaa: skjult, ingen sporing, luftfartøytypen, adressetypen.
  const detail = parseInt(id[1], 16);
  const type = (detail & 0x3c) >> 2;
  if (detail & 0x40 || type !== PARAGLIDER || noTrack.has(id[2])) return null;
  const t = positionTime(m[1], now);
  if (now - t > MAX_AGE_SECONDS * 1000) return null;
  const extra = /!W(\d)(\d)!/.exec(comment);
  const climb = /([+-]\d+)fpm/.exec(comment);
  const course = m[8] === undefined ? null : Number(m[8]), knots = m[9] === undefined ? null : Number(m[9]);
  return {
    id: id[2].toLowerCase(), name: null,
    lat: Math.round(degrees(m[2], m[3], extra ? +extra[1] : 0, m[4]) * 1e5) / 1e5,
    lon: Math.round(degrees(m[5], m[6], extra ? +extra[2] : 0, m[7]) * 1e5) / 1e5,
    alt: Math.round(Number(m[10]) * FEET),
    // Kurs 0 uten fart betyr «ukjent» i APRS.
    track: course === null || (course === 0 && !knots) ? null : course % 360,
    speed: knots === null ? null : Math.round(knots * KNOTS * 10) / 10,
    climb: climb ? Math.round((Number(climb[1]) * FEET) / 60 * 10) / 10 : null,
    type, time: new Date(t).toISOString(),
  };
}

// Lytter på strømmen for stedenes område i `seconds` sekunder, og gir den nyeste posisjonen for hvert luftfartøy,
// nyeste først. connect: Cloudflares connect (cloudflare:sockets), eller en erstatning i testene.
export async function listenAprs(sites, noTrack, { seconds = 20, now = Date.now(), connect } = {}) {
  connect ??= (await import("cloudflare:sockets")).connect;
  const socket = connect({ hostname: APRS_HOST, port: APRS_PORT });
  const newest = new Map();
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  let rest = "", timer;
  const done = new Promise((resolve) => { timer = setTimeout(resolve, seconds * 1000); });
  try {
    await writer.write(new TextEncoder().encode(loginLine(sites)));
    for (;;) {
      const r = await Promise.race([reader.read(), done.then(() => ({ done: true }))]);
      if (r.done) break;
      rest += decoder.decode(r.value, { stream: true });
      const lines = rest.split("\n");
      rest = lines.pop();
      for (const line of lines) {
        const item = parseAprsLine(line, now, noTrack);
        if (item && (!newest.has(item.id) || newest.get(item.id).time < item.time)) newest.set(item.id, item);
      }
    }
  } finally {
    clearTimeout(timer);
    await socket.close().catch(() => {});
  }
  return [...newest.values()].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

// Fra OGNs enhetsregister (DDB_URL): adressene (hex med store bokstaver) til enhetene som ikke skal spores. Registeret
// er CSV, én enhet per linje, med feltene i enkle anførselstegn:
//   #DEVICE_TYPE,DEVICE_ID,AIRCRAFT_MODEL,REGISTRATION,CN,TRACKED,IDENTIFIED
//   'F','DDA5BA','Paraglider','','','N','Y'
// Bare adressen og TRACKED leses, fra hver sin ende av linjen, så komma eller anførselstegn i modellen eller
// registreringen gjør ingenting. Den gamle JSON-formen ({ devices: [{ device_id, tracked }] }) leses fortsatt, i
// tilfelle OGN går tilbake til den. Kaster en feil når svaret ikke ser ut som registeret.
export async function fetchNoTrack(fetchFn = fetch) {
  const r = await fetchFn(DDB_URL, { headers: { "user-agent": "hpgt-flysteder/1.0 (https://flysteder.hpgt.com)" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`OGN-registeret svarte ${r.status}`);
  const text = await r.text();
  const devices = parseDdb(text);
  if (devices.length < DDB_MIN_DEVICES) throw new Error("OGN-registeret ga et uventet svar");
  return devices.filter((d) => d.tracked !== "Y").map((d) => d.id.toUpperCase());
}

// Enhetene i svaret fra registeret, CSV eller JSON, som [{ id, tracked }]. [] når det er ingen av delene.
export function parseDdb(text) {
  const s = String(text).trimStart();
  if (s.startsWith("{")) {
    let devices;
    try { devices = JSON.parse(s)?.devices; } catch { return []; }
    return Array.isArray(devices) && devices.every((d) => typeof d?.device_id === "string") ? devices.map((d) => ({ id: d.device_id, tracked: d.tracked })) : [];
  }
  const out = [];
  for (const line of s.split("\n")) {
    const m = /^'[^']*','([0-9A-Fa-f]{6})',.*,'([YN])','[YN]'\s*$/.exec(line);
    if (m) out.push({ id: m[1], tracked: m[2] });
  }
  return out;
}
