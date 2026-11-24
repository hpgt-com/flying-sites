// Flyaktivitet per sted (datasettet «flights»): hvor mange flyturer paraglidere tar fra hvert flysted, fra
// sanntidsdataene til Open Glider Network (live.js fetchLive), med noen minutters mellomrom i timeplanen. En flytur
// begynner når en pilot ses i lufta etter å ha landet, så flere turer samme dag av samme pilot telles hver for seg
// (løftet på Sollifjellet, et nytt forsøk etter en tidlig landing). Landet: sett stå stille LANDED_RUNS kjøringer på
// rad, eller ikke hørt på GAP_MINUTES minutter, med mindre piloten da fortsatt var AIRBORNE_M meter eller mer over
// bakken (Kartverkets høydemodell, groundAt). En som står stille i vinden, eller flyr høyt ut av rekkevidden til
// mottakerne og kommer tilbake, er fortsatt på samme tur. Hver tur telles for stedet nærmest der den først ble sett
// (der den startet, så nær som dataene viser), hvis et sted er innenfor RADIUS_KM. En tur som først ses langt fra alle
// steder (på gjennomreise), telles ikke. Per sted og dag beholdes bare summer (store.js flight_days): turer, piloter
// (hver telt én gang om dagen), minutter i lufta, lengst fra starten og høyest. For å skille dagens piloter fra
// hverandre holdes de under en nøkkel laget av enhets-ID-en og et tilfeldig salt for dagen (tilstanden
// «flights-today»), med bare den siste posisjonen i lufta for hver pilot. Ved første kjøring en ny dag kastes de gamle
// nøklene, posisjonene og saltet, så ingen enhets-ID eller spor beholdes. OGNs regler
// (glidernet.org/ogn-data-usage) følges som i live.js. Bare piloter der appen eller varioen sender til OGN, telles
// (pgpilot, FANET-varioer, FLARM). Testet i test/data-worker.test.js.

import { fetchLive, SOURCE, LICENSE } from "../live.js";

export const DATASET = "flights";
export const RADIUS_KM = 5;
// I lufta: beveger seg med MIN_SPEED m/s over bakken, eller stiger eller synker med MIN_CLIMB m/s (soaring mot vinden
// kan gå sakte over bakken), men aldri fortere enn MAX_SPEED m/s (80 km/t): det er en bil med appen på. En pilot som
// står på starten med appen på, er ingen av delene.
export const MIN_SPEED = 3;
export const MIN_CLIMB = 0.5;
export const MAX_SPEED = 22;
// En tur telles først når piloten er sett AIRBORNE_START_M meter eller mer over bakken (Kartverkets høydemodell, som
// for landing). En bil, en sykkel eller en gåtur med appen på beveger seg, men holder seg på bakken. Til da venter
// turen, med minuttene sine, og forkastes hvis piloten lander først. Uten høyden til bakken (ikke svar fra Kartverket,
// utenfor Norge, ingen høyde fra enheten) telles den etter PENDING_RUNS kjøringer, som før.
export const AIRBORNE_START_M = 50;
export const PENDING_RUNS = 3;
// Hver telt tur beholdes også for seg (lageret flights, datasettet «flight-log»): stedet, start og slutt, summene og
// posisjonene fra OGN, én per kjøring. Ingen enhet, ingen nøkkel: en tilfeldig ID. Vises på /flyaktivitet/ og
// stedssiden. En tur som aldri ble sett AIRBORNE_START_M meter over bakken (en bil, en sykkel eller en gåtur med appen
// på), beholdes ikke i det hele tatt. Turene beholdes i TRACK_DAYS dager, summene for alltid.
export const LOG_DATASET = "flight-log";
export const TRACK_DAYS = 120;
// Økes når de lagrede turene må ryddes og datasettet lages på nytt én gang (2: bilene som før ble beholdt som
// forkastet, fjernes).
const LOG_VERSION = 2;
// Posisjoner eldre enn dette utelates, så en pilot som har landet, ikke fortsatt telles som i lufta.
export const FRESH_SECONDS = 180;
// Landet: sett på bakken så mange kjøringer på rad (én kan være et øyeblikk med sakte, flat flyging), eller ikke hørt
// på GAP_MINUTES minutter (utenfor rekkevidden til mottakerne, eller appen slått av etter landing), og i begge
// tilfeller mindre enn AIRBORNE_M meter over bakken der piloten sist ble sett. En pilot som ikke er hørt på mer enn
// MAX_GAP_MINUTES minutter, har landet uansett høyde. Uten høyden til bakken (Kartverket svarte ikke, eller utenfor
// Norge) betyr en stans eller et opphold landet.
export const LANDED_RUNS = 2;
export const GAP_MINUTES = 15;
export const MAX_GAP_MINUTES = 120;
export const AIRBORNE_M = 100;
const ELEVATION_API = "https://ws.geonorge.no/hoydedata/v1/punkt";
const STATE = "flights-today";
const rad = Math.PI / 180;
const round1 = (v) => Math.round(v * 10) / 10;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Datoen i Norge (YYYY-MM-DD), så en dag er en norsk dag.
const DAY = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" });
export function osloDay(ms) { return DAY.format(new Date(ms)); }

export function distanceKm(a, b) {
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Stedet nærmest posisjonen, innenfor RADIUS_KM, eller null.
export function nearestSite(sites, pos) {
  let best = null, km = RADIUS_KM;
  for (const s of sites) { const d = distanceKm(s, pos); if (d <= km) { best = s; km = d; } }
  return best;
}

export function isFlying(item) {
  if (isNum(item.speed) && item.speed > MAX_SPEED) return false;
  return (isNum(item.speed) && item.speed >= MIN_SPEED) || (isNum(item.climb) && Math.abs(item.climb) >= MIN_CLIMB);
}

// Nøkkelen en pilot telles under i dag: de første 16 hex-sifrene av SHA-256 av dagens salt og enhets-ID-en.
export async function pilotKey(salt, id) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${id}`));
  return [...new Uint8Array(hash).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Pilotene der høyden over bakken trengs i denne kjøringen, som [key, lat, lon]: de som har stått stille lenge nok til
// å ha landet (der de står), de som høres igjen etter et opphold (der de sist ble sett i lufta), og de der turen venter
// (der de er nå, under nøkkelen med ":now", siden oppholdet kan spørre etter samme pilot).
export function needsGround(day, items, now) {
  const out = [];
  for (const item of items) {
    const p = day.pilots[item.key], t = Date.parse(item.time);
    if (!p || !p.flying || t <= p.last || now - t > FRESH_SECONDS * 1000) continue;
    if (!isFlying(item)) { if (p.still + 1 >= LANDED_RUNS) out.push([item.key, item.lat, item.lon]); continue; }
    if (t - p.last > GAP_MINUTES * 60000 && t - p.last <= MAX_GAP_MINUTES * 60000 && p.pos) out.push([item.key, p.pos[0], p.pos[1]]);
    if (p.pending) out.push([item.key + ":now", item.lat, item.lon]);
  }
  return out;
}

// Om en høyde (moh.) er AIRBORNE_M meter eller mer over bakkens høyde (m), når begge er kjent.
const airborne = (alt, ground) => isNum(alt) && isNum(ground) && alt - ground >= AIRBORNE_M;

const flightId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
// Pilotens åpne tur er slutt. Den går til dagens liste over ferdige turer (skrevet til lageret av run) når den ble sett
// i lufta (venter ikke lenger). En tur som aldri ble noe av, eller langt fra alle steder (uten spor), beholdes ikke.
function finish(day, p) {
  const t = p.track;
  p.track = null;
  if (!t || !t.points.length || p.pending) return;
  (day.finished ??= []).push({ id: t.id, day: day.day, site: t.site, start: t.start, end: t.points[t.points.length - 1][0], minutes: t.minutes,
    max_alt: t.maxAlt, max_dist: t.maxDist, max_speed: t.maxSpeed, counted: 1, points: t.points });
}
// Piloter som ikke er hørt på MAX_GAP_MINUTES minutter, har landet (observe ser bare dem som høres), og turene deres
// avsluttes. Med now = Infinity (dagen er over) avsluttes alle åpne turer. Gir om noe ble endret.
export function sweep(day, now) {
  let changed = false;
  for (const p of Object.values(day.pilots)) {
    if (!p.flying || now - p.last <= MAX_GAP_MINUTES * 60000) continue;
    finish(day, p);
    p.flying = false;
    p.pending = null;
    changed = true;
  }
  return changed;
}

// Legger det som ses nå (items med key, fra parseLive) til dagen ({ pilots: { key: { last, flying, still, pos, site,
// minutes, dist, alt, flights, pending } } }). En pilot som ses i lufta etter landing, begynner en ny tur, for stedet
// nærmest der den først ses. Hver ny posisjon i lufta legger `minutes` (tiden mellom kjøringene) til stedet for turen,
// med lengst fra stedet og høyest. Turen venter ({ minutes, dist, alt, runs }) til piloten ses AIRBORNE_START_M meter
// over bakken (se over). Da telles turen og minuttene. pos: den siste posisjonen i lufta ([lat, lon, alt]), bare for
// dagen. ground: { key: høyden til bakken i m } for pilotene needsGround nevnte. flights: { site: n },
// minutes/dist/alt: { site: … }. Gir om noe ble endret.
export function observe(day, items, sites, now, minutes, ground = {}) {
  let changed = false;
  for (const item of items) {
    const t = Date.parse(item.time);
    if (now - t > FRESH_SECONDS * 1000) continue;
    let p = day.pilots[item.key];
    if (p && t <= p.last) continue;
    if (!isFlying(item)) {
      // På bakken: bare de som har fløyet i dag, følges, til de ses landet. Å stå stille høyt over bakken er å henge i
      // vinden, og tellingen begynner på nytt. Landet mens turen venter: aldri i lufta.
      if (p && p.flying && ++p.still >= LANDED_RUNS) {
        if (airborne(item.alt, ground[item.key])) p.still = 0;
        else { finish(day, p); p.flying = false; p.pending = null; }
      }
      if (p) { p.last = t; changed = true; }
      continue;
    }
    if (!p) p = day.pilots[item.key] = { last: 0, flying: false, still: 0, pos: null, site: null, flights: {}, minutes: {}, dist: {}, alt: {}, pending: null, track: null };
    const gap = t - p.last;
    const sameFlight = p.flying && (gap <= GAP_MINUTES * 60000 || (gap <= MAX_GAP_MINUTES * 60000 && p.pos && airborne(p.pos[2], ground[item.key])));
    if (!sameFlight) {
      if (p.flying) finish(day, p);
      p.site = nearestSite(sites, item)?.id ?? null;
      p.pending = p.site ? { minutes: 0, dist: 0, alt: null, runs: 0 } : null;
      p.track = p.site ? { id: flightId(), site: p.site, start: item.time, minutes: 0, maxAlt: null, maxDist: 0, maxSpeed: 0, points: [] } : null;
    }
    p.flying = true;
    p.still = 0;
    p.last = t;
    p.pos = [item.lat, item.lon, isNum(item.alt) ? Math.round(item.alt) : null];
    const site = p.site && sites.find((s) => s.id === p.site);
    if (site && p.track) {
      const tr = p.track;
      tr.points.push([item.time, Number(item.lat.toFixed(5)), Number(item.lon.toFixed(5)), isNum(item.alt) ? Math.round(item.alt) : null, isNum(item.speed) ? item.speed : null, isNum(item.climb) ? item.climb : null]);
      tr.minutes += minutes;
      tr.maxDist = Math.max(tr.maxDist, round1(distanceKm(site, item)));
      if (isNum(item.alt)) tr.maxAlt = Math.max(tr.maxAlt ?? 0, Math.round(item.alt));
      if (isNum(item.speed)) tr.maxSpeed = Math.max(tr.maxSpeed, item.speed);
    }
    if (site) {
      const sums = p.pending ?? { minutes: p.minutes[site.id] ?? 0, dist: p.dist[site.id] ?? 0, alt: p.alt[site.id] ?? null };
      sums.minutes += minutes;
      sums.dist = Math.max(sums.dist, round1(distanceKm(site, item)));
      if (isNum(item.alt)) sums.alt = Math.max(sums.alt ?? 0, Math.round(item.alt));
      if (p.pending) {
        const g = ground[item.key + ":now"];
        const known = isNum(g) && isNum(item.alt);
        if ((known && item.alt - g >= AIRBORNE_START_M) || (!known && ++p.pending.runs >= PENDING_RUNS)) {
          p.flights[site.id] = (p.flights[site.id] ?? 0) + 1;
          p.minutes[site.id] = (p.minutes[site.id] ?? 0) + sums.minutes;
          p.dist[site.id] = Math.max(p.dist[site.id] ?? 0, sums.dist);
          if (isNum(sums.alt)) p.alt[site.id] = Math.max(p.alt[site.id] ?? 0, sums.alt);
          p.pending = null;
        }
      } else {
        p.minutes[site.id] = sums.minutes;
        p.dist[site.id] = sums.dist;
        if (isNum(sums.alt)) p.alt[site.id] = sums.alt;
      }
    }
    changed = true;
  }
  return changed;
}

// Høyden til bakken (m) i hvert punkt ([key, lat, lon]) fra Kartverkets høydemodell, som { key: m }, i én forespørsel.
// Et punkt uten svar (utenfor Norge, eller Kartverket nede) utelates.
export async function groundAt(points) {
  if (!points.length) return {};
  const url = new URL(ELEVATION_API);
  url.searchParams.set("koordsys", "4258");
  url.searchParams.set("geojson", "false");
  url.searchParams.set("punkter", JSON.stringify(points.map(([, lat, lon]) => [Number(lon.toFixed(5)), Number(lat.toFixed(5))])));
  try {
    const r = await fetch(url, { headers: { "user-agent": "hpgt-flysteder/1.0 (https://flysteder.hpgt.com)" }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`Kartverket svarte ${r.status}`);
    const d = await r.json();
    const out = {};
    points.forEach(([key], i) => { const z = d?.punkter?.[i]?.z; if (isNum(z)) out[key] = z; });
    return out;
  } catch (err) {
    console.warn(`flights: ${err.message}`);
    return {};
  }
}

// Dagen summert per sted: [{ day, site, flights, pilots, minutes, max_dist, max_alt }].
export function dayRows(day) {
  const sites = {};
  for (const p of Object.values(day.pilots)) {
    for (const [id, n] of Object.entries(p.flights)) {
      const s = (sites[id] ??= { day: day.day, site: id, flights: 0, pilots: 0, minutes: 0, max_dist: 0, max_alt: null });
      s.flights += n;
      s.pilots++;
      s.minutes += p.minutes[id] ?? 0;
      s.max_dist = Math.max(s.max_dist, p.dist[id] ?? 0);
      if (isNum(p.alt[id])) s.max_alt = Math.max(s.max_alt ?? 0, p.alt[id]);
    }
  }
  return Object.values(sites);
}

// Datasettet fra alle de lagrede dagene. Per sted: turene, dagene med flyging, pilotene (en pilot telt én gang om
// dagen), minuttene i lufta, lengst fra starten og høyest, den siste dagen, det samme per måned (YYYY-MM), og turene
// og minuttene for hver dag de siste RECENT_DAYS dagene (recent, etter dato). Da kan en side telle i dag og de siste
// 30 dagene etter sin egen klokke.
export const RECENT_DAYS = 31;
export function buildFlights(rows, since, now = Date.now()) {
  const sites = {};
  const from = osloDay(now - (RECENT_DAYS - 1) * 86400000);
  for (const r of rows) {
    const s = (sites[r.site] ??= { flights: 0, days: 0, pilots: 0, minutes: 0, maxDist: 0, maxAlt: null, last: null, months: {}, recent: {} });
    if (r.day >= from) s.recent[r.day] = { flights: r.flights, minutes: r.minutes };
    const m = (s.months[r.day.slice(0, 7)] ??= { flights: 0, days: 0, pilots: 0, minutes: 0 });
    for (const x of [s, m]) { x.flights += r.flights; x.days++; x.pilots += r.pilots; x.minutes += r.minutes; }
    s.maxDist = Math.max(s.maxDist, r.max_dist ?? 0);
    if (isNum(r.max_alt)) s.maxAlt = Math.max(s.maxAlt ?? 0, r.max_alt);
    if (!s.last || r.day > s.last) s.last = r.day;
  }
  return { dataset: DATASET, source: SOURCE, license: LICENSE, fetched: new Date(now).toISOString(), since, sites };
}

// Turene de siste RECENT_DAYS dagene, nyeste først, hver med posisjonene sine
// ([time, lat, lon, alt, speed m/s, climb m/s]).
export function buildFlightLog(rows, now = Date.now()) {
  const flights = rows.map((r) => ({ id: r.id, day: r.day, site: r.site, start: r.start, end: r.end, minutes: r.minutes, maxAlt: r.max_alt ?? null,
    maxDist: r.max_dist ?? null, maxSpeed: r.max_speed ?? null, counted: r.counted === 1, points: typeof r.points === "string" ? JSON.parse(r.points) : r.points }))
    .sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
  return { dataset: LOG_DATASET, source: SOURCE, license: LICENSE, fetched: new Date(now).toISOString(), days: RECENT_DAYS, flights };
}

// Dagens ferdige turer skrives til lageret, og de gamle ryddes bort. Gir hvor mange som ble skrevet.
async function flushFinished(store, day, now) {
  const list = day.finished ?? [];
  for (const f of list) await store.putFlight(f);
  day.finished = [];
  if (list.length) await store.pruneFlights(osloDay(now - TRACK_DAYS * 86400000));
  return list.length;
}

// Engangsrydding: en bil på E6 forbi Bjerkvik med appen på ble telt som den første turen fra Haugfjellet 25. oktober
// 2026 (27 km på 18 minutter, 179 moh.), før reglene over. Fjernes én gang (flagget i tilstanden viser det). Slett
// dette og bruken i run() når det har kjørt i tjenesten.
export const CLEANUP = { day: "2026-10-25", site: "haugfjellet", flag: "flights-cleanup-2026-10-25" };
async function cleanup(store, day) {
  if (await store.getState(CLEANUP.flag)) return false;
  await store.deleteFlightDay(CLEANUP.day, CLEANUP.site);
  if (day.day === CLEANUP.day) {
    for (const p of Object.values(day.pilots)) {
      for (const k of ["flights", "minutes", "dist", "alt"]) delete p[k][CLEANUP.site];
      if (p.site === CLEANUP.site) p.pending = null;
    }
  }
  await store.putState(CLEANUP.flag, { at: new Date().toISOString() });
  return true;
}

// Én kjøring: det OGN hører nå, legges til dagen. Når noe er endret (eller en ny dag har begynt), lagres dagens summer
// og datasettet. minutes: tiden mellom kjøringene (schedule.js).
export async function run(store, sites, now = Date.now(), minutes = 2) {
  const items = await fetchLive(sites, now, { store });
  if (items.via) console.log(`flights: ${items.length} fra OGNs APRS-strøm (kartet svarte ikke)`);
  const today = osloDay(now);
  let day = await store.getState(STATE);
  let changed = false, written = 0;
  if (!day || day.day !== today) {
    // Den gamle dagen er over: de åpne turene slutter nå og skrives med dagens dato.
    if (day) { sweep(day, Infinity); written += await flushFinished(store, day, now); }
    day = { day: today, salt: crypto.randomUUID(), pilots: {}, finished: [] };
    changed = true;
  }
  if (await cleanup(store, day)) changed = true;
  const keyed = await Promise.all(items.map(async (i) => ({ ...i, key: await pilotKey(day.salt, i.id) })));
  const ground = await groundAt(needsGround(day, keyed, now));
  const seen = observe(day, keyed, sites, now, minutes, ground);
  if (sweep(day, now) || seen) {
    await store.putFlightDays(dayRows(day));
    changed = true;
  }
  written += await flushFinished(store, day, now);
  let since = await store.getState("flights-since");
  if (!since) { since = today; await store.putState("flights-since", since); changed = true; }
  if (!changed) return;
  await store.putState(STATE, day);
  await store.putSnapshot(DATASET, JSON.stringify(buildFlights(await store.flightDays(), since, now)));
  const built = await store.getState("flight-log-built");
  if (written || built?.version !== LOG_VERSION) {
    if (built?.version !== LOG_VERSION) await store.pruneFlights(osloDay(now - TRACK_DAYS * 86400000));
    await store.putSnapshot(LOG_DATASET, JSON.stringify(buildFlightLog(await store.flightsSince(osloDay(now - (RECENT_DAYS - 1) * 86400000)), now)));
    await store.putState("flight-log-built", { at: new Date(now).toISOString(), version: LOG_VERSION });
  }
}
