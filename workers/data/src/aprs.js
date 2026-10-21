// The reserve for «Piloter i lufta» and the flying activity when OGN's web map (live.glidernet.org, live.js) does not
// answer: the same positions read straight from OGN's APRS servers, the stream every receiver and app (pgpilot too)
// sends to and the web map itself reads. A read-only connection (passcode -1) with an area filter for the sites' area
// (live.js bounds) is kept open for a few seconds, the time it takes to hear every aircraft in the air at least once,
// and each aircraft's newest position is kept. Only paragliders (aircraft type 7), as from the web map.
// OGN's rules (glidernet.org/ogn-data-usage), which the web map follows for us and must be followed here instead: a
// device that must not be tracked, by the no-tracking flag in its message or «tracked: N» in OGN's device database
// (DDB), is left out, and no device is identified (every name is null, shown as unknown). The database's list of devices
// that must not be tracked is fetched in the store once a day (Store.refreshNoTrack, a few MB, more CPU than a Worker run
// has) and kept, so it is there when OGN goes down; without it the reserve gives nothing rather than risk showing one. Tested in test/data-worker.test.js.

import { bounds, MAX_AGE_SECONDS, PARAGLIDER } from "./live.js";

export const APRS_HOST = "aprs.glidernet.org";
// The port for a client's own filter (10152 is the whole world's stream).
export const APRS_PORT = 14580;
// Over HTTPS, and over HTTP as OGN's own client asks for it if that fails.
export const DDB_URLS = ["https://ddb.glidernet.org/download/?j=1", "http://ddb.glidernet.org/download/?j=1"];
// How long the list from the device database is used before it is fetched again.
export const DDB_MAX_AGE_HOURS = 24;
// The database has tens of thousands of devices; an answer with far fewer is taken as broken, not as the list.
const DDB_MIN_DEVICES = 1000;
const FEET = 0.3048, KNOTS = 0.5144;

// The area filter: a/north/west/south/east.
export function aprsFilter(sites) {
  const b = bounds(sites);
  return `a/${b.n.toFixed(2)}/${b.w.toFixed(2)}/${b.s.toFixed(2)}/${b.e.toFixed(2)}`;
}

export function loginLine(sites) {
  return `user HPGTFS pass -1 vers hpgt-flysteder 1.0 filter ${aprsFilter(sites)}\r\n`;
}

// The time of a position, hhmmss UTC, on the day of now (or the day before, for a time just after midnight's other side).
function positionTime(hhmmss, now) {
  const d = new Date(now);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +hhmmss.slice(0, 2), +hhmmss.slice(2, 4), +hhmmss.slice(4, 6));
  if (t > now + 300000) t -= 86400000;
  return t;
}

// Degrees from APRS's ddmm.mm (or dddmm.mm), with the extra thousandth of a minute from «!Wab!».
const degrees = (deg, min, extra, sign) => (Number(deg) + (Number(min) + extra / 1000) / 60) * (sign === "S" || sign === "W" ? -1 : 1);

// One line of the stream as an item in the same shape as live.js parseLive gives (id = the device address in lower-case
// hex, name always null), or null: comments and server lines, other messages than aircraft positions, other aircraft
// than paragliders, devices that must not be tracked (the flag, or in noTrack: a Set of addresses in upper-case hex), and
// positions older than MAX_AGE_SECONDS.
//   FLRDDA5BA>OGFLR,qAS,Rx:/160829h6847.41N/01622.03E'342/049/A=005524 !W52! id1EDDA5BA -454fpm -1.1rot 8.8dB
const POSITION = /^[A-Z0-9]{3,9}>[A-Z0-9]+,[^:]*:[/@](\d{6})h(\d{2})(\d{2}\.\d{2})([NS]).(\d{3})(\d{2}\.\d{2})([EW]).(?:(\d{3})\/(\d{3}))?\/A=(-?\d{5,6})(.*)$/;
export function parseAprsLine(line, now = Date.now(), noTrack = new Set()) {
  const m = POSITION.exec(String(line).trim());
  if (!m) return null;
  const comment = m[11];
  const id = /\bid([0-9A-F]{2})([0-9A-F]{6})\b/.exec(comment);
  if (!id) return null;
  // The detail byte, STttttaa: stealth, no tracking, the aircraft type, the address type.
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
    // A course of 0 with no speed is APRS's «not known».
    track: course === null || (course === 0 && !knots) ? null : course % 360,
    speed: knots === null ? null : Math.round(knots * KNOTS * 10) / 10,
    climb: climb ? Math.round((Number(climb[1]) * FEET) / 60 * 10) / 10 : null,
    type, time: new Date(t).toISOString(),
  };
}

// Listens to the stream for the sites' area for `seconds`, and returns each aircraft's newest position, newest first.
// connect: Cloudflare's connect (cloudflare:sockets), or a stand-in in the tests.
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

// From OGN's device database (DDB_URLS, { devices: [{ device_id, tracked, ... }] }): the addresses (upper-case hex) of
// the devices that must not be tracked. Throws when neither address answers with something that looks like the database.
export async function fetchNoTrack(fetchFn = fetch) {
  let r, error;
  for (const url of DDB_URLS) {
    try {
      r = await fetchFn(url, { headers: { "user-agent": "hpgt-flysteder/1.0 (https://flysteder.hpgt.com)" }, signal: AbortSignal.timeout(20000) });
      if (r.ok) break;
      error = new Error(`OGN-registeret svarte ${r.status}`);
    } catch (err) { error = err; }
    r = null;
  }
  if (!r) throw error;
  const devices = (await r.json())?.devices;
  if (!Array.isArray(devices) || devices.length < DDB_MIN_DEVICES || !devices.every((d) => typeof d?.device_id === "string")) {
    throw new Error("OGN-registeret ga et uventet svar");
  }
  return devices.filter((d) => d.tracked !== "Y").map((d) => d.device_id.toUpperCase());
}
