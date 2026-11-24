// Lageret til datatjenesten: ett Durable Object med SQLite (gratisplanen), som tillater langt flere skrivinger per døgn
// enn KV. Det har datasettene slik de sendes (snapshots), tilstanden til hver kilde, stasjonsmålingene, og varselet for
// hver time slik det sto i løpet av den timen (forecast_hours, sources/forecast.js).
// Nås gjennom env.STORE (wrangler.toml). Metodene kalles over RPC fra index.js og kildene.

import { DurableObject } from "cloudflare:workers";
import { FIELDS } from "./measurements.js";
import { mergeTrails } from "./live.js";
import { fetchNoTrack, DDB_MAX_AGE_HOURS, DDB_MAX_KEEP_HOURS } from "./aprs.js";
import { INDEXES } from "./indexes.js";
import { fetchGrid, GRIDS } from "./sources/grid.js";
import { TABLES, JSON_META, backupPath, latestPath, expiredDay, backupBody, backupRows, restoreSql } from "./backup.js";

const COLUMNS = FIELDS.map((f) => f.key);
// En målingsrad slik den lagres: feltene som tall, extra som JSON-tekst.
// Stasjonen identifiseres med kilden og nummeret der (to leverandører kan bruke samme nummer), lagret som tekst.
const toRow = (r) => [r.source, String(r.station), r.time, ...COLUMNS.map((c) => r[c] ?? null), r.extra ? JSON.stringify(r.extra) : null];
const fromRow = (r) => ({ ...r, extra: r.extra ? JSON.parse(r.extra) : null });
const SELECT = `SELECT source, station, time, ${COLUMNS.join(", ")}, extra FROM measurements`;
const ROW_KEYS = ["source", "station", "time", ...COLUMNS, "extra"];
// Hvor mange timer med målinger per kilde som holdes i minnet (Store.measurementsSince): de 6 i stasjonsdatasettet
// (HISTORY_HOURS i kildene) og en margin.
export const RECENT_HOURS = 7;

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // snapshots, state, forecast_hours og measurements er WITHOUT ROWID-tabeller, med nøkler slik at ingen spørring
    // trenger en annen indeks. En skrevet rad telles da som én rad, ikke én for tabellen og én per indeks
    // (gratisplanen tillater 100 000 i døgnet). Alt i én transaksjon, så en start som feiler halvveis, lar tabellene
    // være som de var.
    ctx.storage.transactionSync(() => this.createTables());
    // Varslet mot målt, per sted og ferdig time (sources/verify.js), beholdt i et år.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS verify_hours (site TEXT NOT NULL, station TEXT NOT NULL, time TEXT NOT NULL,
      f_dir REAL, f_speed REAL, f_gust REAL, m_dir REAL, m_speed REAL, m_gust REAL, n INTEGER, PRIMARY KEY (site, station, time))`);
    // Temperaturen og trykket kom senere (24.10.2026): legges til i lagre laget før det.
    const verifyHave = new Set(this.sql.exec("PRAGMA table_info(verify_hours)").toArray().map((c) => c.name));
    for (const c of ["f_temp", "m_temp", "f_pressure", "m_pressure"]) if (!verifyHave.has(c)) this.sql.exec(`ALTER TABLE verify_hours ADD COLUMN ${c} REAL`);
    // Flyaktivitet per sted og dag (sources/flights.js): bare summer, ingen pilot eller enhet.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS flight_days (day TEXT NOT NULL, site TEXT NOT NULL, flights INTEGER NOT NULL, pilots INTEGER NOT NULL,
      minutes INTEGER NOT NULL, max_dist REAL, max_alt REAL, PRIMARY KEY (day, site))`);
    // Hver flytur for seg (sources/flights.js): en tilfeldig ID, summene, om den ble telt, og posisjonene fra OGN som
    // JSON. Ingen enhet eller nøkkel.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS flights (id TEXT PRIMARY KEY, day TEXT NOT NULL, site TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
      minutes INTEGER NOT NULL, max_alt INTEGER, max_dist REAL, max_speed REAL, counted INTEGER NOT NULL, points TEXT NOT NULL)`);
    for (const index of INDEXES) this.sql.exec(index);
  }

  // Tabellene, laget når de mangler. Et felt som legges til i measurements.js, får kolonnen sin her. Radene som alt er
  // lagret, får null i den.
  createTables() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS snapshots (dataset TEXT PRIMARY KEY, body TEXT NOT NULL, updated TEXT NOT NULL) WITHOUT ROWID");
    this.sql.exec("CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID");
    // Varselet for hver time slik det sto i løpet av den timen (sources/forecast.js), med tiden først i nøkkelen: leses
    // og ryddes etter tid.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS forecast_hours (site TEXT NOT NULL, time TEXT NOT NULL, dir REAL, speed REAL, gust REAL,
      rain REAL, fetched TEXT NOT NULL, PRIMARY KEY (time, site)) WITHOUT ROWID`);
    const forecastHave = new Set(this.sql.exec("PRAGMA table_info(forecast_hours)").toArray().map((c) => c.name));
    for (const c of ["temp", "pressure"]) if (!forecastHave.has(c)) this.sql.exec(`ALTER TABLE forecast_hours ADD COLUMN ${c} REAL`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS measurements (source TEXT NOT NULL, station TEXT NOT NULL, time TEXT NOT NULL,
      ${COLUMNS.map((c) => `${c} REAL`).join(", ")}, extra TEXT, PRIMARY KEY (source, time, station)) WITHOUT ROWID`);
    const have = new Set(this.sql.exec("PRAGMA table_info(measurements)").toArray().map((c) => c.name));
    for (const c of COLUMNS) if (!have.has(c)) this.sql.exec(`ALTER TABLE measurements ADD COLUMN ${c} REAL`);
    if (!have.has("extra")) this.sql.exec("ALTER TABLE measurements ADD COLUMN extra TEXT");
  }

  // Det siste sporet til hvert luftfartøy for «Piloter i lufta» (live.js mergeTrails), bare i minnet: tapes når
  // objektet kastes ut, og skrives aldri til SQLite.
  mergeLive(positions, now, keepMs) {
    this.live ??= new Map();
    return mergeTrails(this.live, positions, now, keepMs);
  }

  getSnapshot(dataset) {
    const rows = this.sql.exec("SELECT body FROM snapshots WHERE dataset = ?", dataset).toArray();
    return rows.length ? rows[0].body : null;
  }

  // Datasettene med når hvert sist ble skrevet (for statusen, health.js).
  snapshotsFor(datasets) {
    const out = {};
    for (const d of datasets) {
      const rows = this.sql.exec("SELECT body, updated FROM snapshots WHERE dataset = ?", d).toArray();
      if (rows.length) out[d] = { updated: rows[0].updated, body: rows[0].body };
    }
    return out;
  }

  putSnapshot(dataset, body) {
    this.sql.exec("INSERT INTO snapshots (dataset, body, updated) VALUES (?, ?, ?) ON CONFLICT (dataset) DO UPDATE SET body = excluded.body, updated = excluded.updated",
      dataset, body, new Date().toISOString());
  }

  getState(key) {
    const rows = this.sql.exec("SELECT value FROM state WHERE key = ?", key).toArray();
    return rows.length ? JSON.parse(rows[0].value) : null;
  }

  putState(key, value) {
    this.sql.exec("INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
  }

  // «Meld fra» (report.js): dagens tilfeldige salt for å hashe adressene til avsenderne, laget ved første bruk. Saltene
  // og tellingene fra tidligere dager slettes, så ingen adressehash lever lenger enn dagen sin.
  reportSalt(day) {
    this.pruneReports(day);
    let salt = this.getState(`report-salt-${day}`);
    if (!salt) {
      salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
      this.putState(`report-salt-${day}`, salt);
    }
    return salt;
  }

  // Sletter saltene og tellingene (med adressehashene) for alle dager unntatt `day`. Kalles ved hver rapport, og én
  // gang i døgnet i timeplanen (index.js), så ingen hash lever lenger enn dagen sin pluss tiden til neste kjøring.
  pruneReports(day) {
    this.sql.exec("DELETE FROM state WHERE (key LIKE 'reports-%' OR key LIKE 'report-salt-%') AND key NOT IN (?, ?)", `reports-${day}`, `report-salt-${day}`);
  }

  // Teller én rapport for dagen og avsenderen, hvis begge er under grensene sine: "ok", "limit" eller "ip-limit". Én
  // synkron metode i Durable Object-et, så lesingen og skrivingen ikke kan deles av en annen forespørsel.
  reserveReport(day, who, dailyLimit, perIpLimit) {
    const key = `reports-${day}`;
    const c = this.getState(key) ?? { n: 0, ips: {} };
    if (c.n >= dailyLimit) return "limit";
    if (who && (c.ips[who] ?? 0) >= perIpLimit) return "ip-limit";
    c.n += 1;
    if (who) c.ips[who] = (c.ips[who] ?? 0) + 1;
    this.putState(key, c);
    return "ok";
  }

  // Gir en reservasjon tilbake (GitHub feilet, så ingen sak ble laget).
  releaseReport(day, who) {
    const key = `reports-${day}`;
    const c = this.getState(key);
    if (!c || typeof c !== "object") return;
    c.n = Math.max(0, c.n - 1);
    if (who && c.ips[who]) c.ips[who] -= 1;
    this.putState(key, c);
  }

  // Samme måling kan komme igjen i flere kjøringer mens stasjonen ikke har rapportert på nytt: den beholdes én gang.
  addMeasurements(rows) {
    for (const r of rows) {
      this.sql.exec(`INSERT OR IGNORE INTO measurements (source, station, time, ${COLUMNS.join(", ")}, extra) VALUES (${["?", "?", "?", ...COLUMNS.map(() => "?"), "?"].join(", ")})`,
        ...toRow(r));
    }
    for (const source of new Set(rows.map((r) => r.source))) {
      const recent = this.recent?.get(source);
      // Som INSERT OR IGNORE: en rad som alt er beholdt, blir stående (den kommer sist, så den vinner i keepRecent).
      const added = rows.filter((r) => r.source === source).map((r) => fromRow(Object.fromEntries(toRow(r).map((v, i) => [ROW_KEYS[i], v]))));
      if (recent) this.keepRecent(source, recent.from, [...added, ...recent.rows.values()]);
    }
  }

  // De siste timene med målinger for hver kilde, som stasjonsdatasettet bygges fra hvert minutt, holdes også i minnet
  // (recent). De leses fra SQLite én gang og fylles på etter hvert som de lagres, i stedet for at RECENT_HOURS timer
  // med rader leses på nytt i hver kjøring (over en million rader i døgnet). Tapes når objektet kastes ut, og leses da
  // på nytt.
  measurementsSince(source, since) {
    const recent = this.recent?.get(source);
    if (recent && recent.from <= since) return [...recent.rows.values()].filter((r) => r.time >= since).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    const rows = this.sql.exec(`${SELECT} WHERE source = ? AND time >= ? ORDER BY time`, source, since).toArray().map(fromRow);
    this.keepRecent(source, since, rows);
    return rows;
  }

  // De siste radene for en kilde fra since, etter stasjon og tid, uten dem som er eldre enn RECENT_HOURS timer før den
  // nyeste.
  keepRecent(source, since, rows) {
    this.recent ??= new Map();
    const newest = Date.parse(rows.reduce((t, r) => (r.time > t ? r.time : t), since));
    const cut = Number.isFinite(newest) ? new Date(newest - RECENT_HOURS * 3600000).toISOString() : since;
    const from = since > cut ? since : cut;
    this.recent.set(source, { from, rows: new Map(rows.filter((r) => r.time >= from).map((r) => [`${r.station}|${r.time}`, r])) });
  }

  measurementsBetween(source, from, to) {
    return this.sql.exec(`${SELECT} WHERE source = ? AND time >= ? AND time <= ? ORDER BY time`, source, from, to).toArray().map(fromRow);
  }

  oldestMeasurement(source) {
    const rows = this.sql.exec("SELECT MIN(time) AS time FROM measurements WHERE source = ?", source).toArray();
    return rows[0]?.time ?? null;
  }

  // Den siste hentingen i løpet av en time erstatter det en tidligere henting sa om den.
  putForecastHours(hours) {
    for (const h of hours) {
      this.sql.exec(`INSERT INTO forecast_hours (site, time, dir, speed, gust, rain, temp, pressure, fetched) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (site, time) DO UPDATE SET dir = excluded.dir, speed = excluded.speed, gust = excluded.gust, rain = excluded.rain,
        temp = excluded.temp, pressure = excluded.pressure, fetched = excluded.fetched`,
        h.site, h.time, h.dir ?? null, h.speed ?? null, h.gust ?? null, h.rain ?? null, h.temp ?? null, h.pressure ?? null, h.fetched);
    }
  }

  forecastHoursSince(since) {
    return this.sql.exec("SELECT site, time, dir, speed, gust, rain, temp, pressure FROM forecast_hours WHERE time >= ? ORDER BY time", since).toArray();
  }

  pruneForecastHours(before) {
    this.sql.exec("DELETE FROM forecast_hours WHERE time < ?", before);
  }

  // En time som pares på nytt (en sen måling), erstatter det som var lagret for den.
  putVerifyHours(rows) {
    for (const r of rows) {
      this.sql.exec(`INSERT INTO verify_hours (site, station, time, f_dir, f_speed, f_gust, m_dir, m_speed, m_gust, n, f_temp, m_temp, f_pressure, m_pressure)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (site, station, time) DO UPDATE SET f_dir = excluded.f_dir, f_speed = excluded.f_speed, f_gust = excluded.f_gust,
        m_dir = excluded.m_dir, m_speed = excluded.m_speed, m_gust = excluded.m_gust, n = excluded.n,
        f_temp = excluded.f_temp, m_temp = excluded.m_temp, f_pressure = excluded.f_pressure, m_pressure = excluded.m_pressure`,
        r.site, r.station, r.time, r.f_dir, r.f_speed, r.f_gust, r.m_dir, r.m_speed, r.m_gust, r.n,
        r.f_temp ?? null, r.m_temp ?? null, r.f_pressure ?? null, r.m_pressure ?? null);
    }
  }

  verifyHoursSince(since) {
    return this.sql.exec("SELECT site, station, time, f_dir, f_speed, f_gust, m_dir, m_speed, m_gust, n, f_temp, m_temp, f_pressure, m_pressure FROM verify_hours WHERE time >= ? ORDER BY time", since).toArray();
  }

  pruneVerifyHours(before) {
    this.sql.exec("DELETE FROM verify_hours WHERE time < ?", before);
  }

  // Dagens summer erstatter det en tidligere kjøring lagret for samme dag og sted.
  putFlightDays(rows) {
    for (const r of rows) {
      this.sql.exec(`INSERT INTO flight_days (day, site, flights, pilots, minutes, max_dist, max_alt) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (day, site) DO UPDATE SET flights = excluded.flights, pilots = excluded.pilots, minutes = excluded.minutes,
        max_dist = excluded.max_dist, max_alt = excluded.max_alt`,
        r.day, r.site, r.flights, r.pilots, r.minutes, r.max_dist ?? null, r.max_alt ?? null);
    }
  }

  flightDays() {
    return this.sql.exec("SELECT day, site, flights, pilots, minutes, max_dist, max_alt FROM flight_days ORDER BY day").toArray();
  }

  // Fjerner raden for en dag på et sted (en flytur som ikke var det, se flights.js CLEANUP).
  deleteFlightDay(day, site) {
    this.sql.exec("DELETE FROM flight_days WHERE day = ? AND site = ?", day, site);
  }

  // Én flytur (flights.js finish): posisjonene som JSON. Samme ID på nytt erstatter den.
  putFlight(f) {
    this.sql.exec(`INSERT OR REPLACE INTO flights (id, day, site, start, end, minutes, max_alt, max_dist, max_speed, counted, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      f.id, f.day, f.site, f.start, f.end, f.minutes, f.max_alt ?? null, f.max_dist ?? null, f.max_speed ?? null, f.counted ? 1 : 0, typeof f.points === "string" ? f.points : JSON.stringify(f.points));
  }

  flightsSince(day) {
    return this.sql.exec("SELECT id, day, site, start, end, minutes, max_alt, max_dist, max_speed, counted, points FROM flights WHERE day >= ? ORDER BY start DESC", day).toArray();
  }

  // Flyturer eldre enn before (YYYY-MM-DD) fjernes, og alle som ikke er telt (beholdt før 27.10.2026: biler og
  // turgåere).
  pruneFlights(before) {
    this.sql.exec("DELETE FROM flights WHERE counted = 0 OR day < ?", before);
  }

  // Et nytt, tomt lager (et tapt eller gjenskapt Durable Object) leser den siste sikkerhetskopien (backup.js) inn igjen
  // fra arkivet (R2). Da er historikken tilbake innen et minutt etter start, ikke natten etter. Kjøres hvert minutt fra
  // index.js til det har lyktes én gang (lagret i helsetilstanden, som et nytt lager heller ikke har). Rader skrevet
  // etter at lageret ble tapt, beholdes (INSERT OR IGNORE). Et arkiv som ikke svarer, gir en feil, så neste minutt
  // prøver igjen. Et arkiv uten sikkerhetskopi ennå regnes som ferdig. Gir radene som ble lest inn per tabell, eller
  // null når det er gjort før.
  async restore(now) {
    const bucket = this.env.ARCHIVE;
    if (!bucket || this.getState("restore")) return null;
    const restored = {};
    for (const table of Object.keys(TABLES)) {
      const latest = await bucket.get(latestPath(table));
      if (!latest) continue;
      const rows = backupRows(await latest.text(), table);
      const sql = restoreSql(table);
      this.ctx.storage.transactionSync(() => { for (const r of rows) this.sql.exec(sql, ...r); });
      restored[table] = rows.length;
    }
    this.putState("restore", { at: new Date(now).toISOString(), rows: restored });
    return restored;
  }

  // Sikkerhetskopien om natten (backup.js) til arkivet (R2). Gir radene som ble skrevet per tabell.
  async backup(day) {
    const bucket = this.env.ARCHIVE;
    if (!bucket) return null;
    const out = { day, rows: {} };
    for (const table of Object.keys(TABLES)) {
      const rows = this.sql.exec(`SELECT ${TABLES[table].join(", ")} FROM ${table}`).toArray();
      const body = backupBody(table, rows, day);
      await bucket.put(backupPath(table, day), body, JSON_META);
      await bucket.put(latestPath(table), body, JSON_META);
      await bucket.delete(backupPath(table, expiredDay(day)));
      out.rows[table] = rows.length;
    }
    this.putState("backup", { day, rows: out.rows });
    return out;
  }

  // Et varselrutenett (sources/grid.js, «grid» eller «grid-wide»): hentes og bygges her, der en kjøring kan bruke langt
  // mer CPU enn i Workeren, og lagres som datasettet. En feil lar det forrige bli stående og kastes tilbake til
  // kjøringen.
  async refreshGrid(name, sites, now) {
    if (!GRIDS[name]) throw new Error(`ukjent rutenett ${name}`);
    const body = await fetchGrid(name, sites, now);
    this.putSnapshot(name, JSON.stringify(body));
    return { points: body.elev.length, hours: body.times.length };
  }

  // Enhetene som ikke skal spores, fra OGNs enhetsregister (aprs.js fetchNoTrack), for APRS-reserven. Hentes her, der
  // tolkingen av noen MB kan få den CPU-en den trenger, én gang i døgnet i timeplanen (refreshNoTrack), og beholdes i
  // tilstanden. Da finnes listen før OGN går ned, siden registeret kan gå ned samtidig. noTrack: den lagrede listen,
  // eller hentet nå når ingen er lagret eller den er eldre enn DDB_MAX_AGE_HOURS timer og registeret svarer. Svarer det
  // ikke, brukes den lagrede listen til den er DDB_MAX_KEEP_HOURS timer gammel. Uten liste kastes en feil, og reserven
  // gir ingenting.
  async refreshNoTrack(now) {
    const ids = await fetchNoTrack();
    this.putState("ogn-notrack", { fetched: now, ids });
    return { devices: ids.length };
  }
  async noTrack(now) {
    const kept = this.getState("ogn-notrack");
    if (kept && now - kept.fetched < DDB_MAX_AGE_HOURS * 3600000) return kept.ids;
    try {
      await this.refreshNoTrack(now);
      return this.getState("ogn-notrack").ids;
    } catch (err) {
      if (kept && now - kept.fetched < DDB_MAX_KEEP_HOURS * 3600000) return kept.ids;
      throw err;
    }
  }

  prune(source, before) {
    this.sql.exec("DELETE FROM measurements WHERE source = ? AND time < ?", source, before);
  }
}
