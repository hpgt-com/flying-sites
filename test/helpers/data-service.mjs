// A stand-in for Cloudflare around the data service (workers/data), for the tests: the Durable Object's SQLite on
// node:sqlite, R2, the Cache API, and the sources' answers (MET, Holfuy, Frost, Open-Meteo, OGN, Kartverket) made up for
// the time the clock says. It counts what the free plan counts per day: calls to the Durable Object, and rows read and
// written in it. Rows read are estimated from SQLite's query plan: a scan reads the whole table, a search through an
// index the rows in the index's range. Rows written count once for the table and once per index on it, as Cloudflare
// counts them. Used by test/data-quota.test.js.

import { DatabaseSync } from "node:sqlite";

export function sqliteStorage() {
  const db = new DatabaseSync(":memory:");
  const stats = { rowsRead: 0, rowsWritten: 0, statements: 0, byQuery: {} };
  const tally = (q, r, w) => { const k = q.replace(/\s+/g, " ").slice(0, 90); const e = (stats.byQuery[k] ??= { n: 0, read: 0, written: 0 }); e.n++; e.read += r; e.written += w; };
  const plans = new Map();
  const count = (sql, params = []) => db.prepare(sql).get(...params).n;
  const indexes = (table) => count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND tbl_name = ?", [table]);

  // The rows a SELECT, UPDATE or DELETE reads, from its plan, counted before it runs.
  function rowsRead(query, params) {
    const table = (query.match(/\b(?:FROM|UPDATE)\s+(\w+)/i) ?? [])[1];
    if (!table) return 0;
    if (!plans.has(query)) plans.set(query, db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...params.map(() => null)).map((r) => r.detail));
    const step = plans.get(query).find((d) => new RegExp(`^(SCAN|SEARCH) ${table}\\b`).test(d));
    if (!step || step.startsWith("SCAN")) return count(`SELECT COUNT(*) AS n FROM ${table}`);
    // MIN or MAX of an indexed column reads one row.
    if (/\b(MIN|MAX)\(/i.test(query)) return 1;
    const used = [...(step.match(/\(([^)]*)\)\s*$/)?.[1] ?? "").matchAll(/(\w+)[=<>]/g)].map((m) => m[1]);
    const at = query.search(/\bWHERE\b/i);
    let p = (query.slice(0, at).match(/\?/g) ?? []).length;
    const terms = [];
    const where = query.slice(at + 5).split(/\b(?:ORDER BY|LIMIT|GROUP BY)\b/i)[0];
    for (const m of where.matchAll(/(\w+)\s*(=|>=|<=|<|>)\s*\?/g)) terms.push({ col: m[1], op: m[2], value: params[p++] });
    const use = terms.filter((t) => used.includes(t.col));
    return count(`SELECT COUNT(*) AS n FROM ${table}${use.length ? " WHERE " + use.map((t) => `${t.col} ${t.op} ?`).join(" AND ") : ""}`, use.map((t) => t.value));
  }

  const sql = {
    exec(query, ...params) {
      stats.statements++;
      const q = query.trim();
      let rows = [];
      if (/^(SELECT|PRAGMA)/i.test(q)) {
        const r = /^SELECT/i.test(q) ? rowsRead(q, params) : 0;
        stats.rowsRead += r;
        tally(q, r, 0);
        rows = db.prepare(q).all(...params);
      } else if (/^(INSERT|UPDATE|DELETE)/i.test(q)) {
        const table = (q.match(/\b(?:INTO|UPDATE|FROM)\s+(\w+)/i) ?? [])[1];
        const r = /^INSERT/i.test(q) ? 1 : rowsRead(q, params);
        const { changes } = db.prepare(q).run(...params);
        const w = Number(changes) * (1 + indexes(table));
        stats.rowsRead += r;
        stats.rowsWritten += w;
        tally(q, r, w);
      } else {
        db.exec(q);
      }
      return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
    },
  };
  const storage = {
    sql,
    transactionSync(fn) {
      db.exec("BEGIN");
      try { const out = fn(); db.exec("COMMIT"); return out; } catch (err) { db.exec("ROLLBACK"); throw err; }
    },
  };
  return { db, stats, storage };
}

// The store as the Worker reaches it: every method call is one request to the Durable Object, and what comes back is a
// copy, as over RPC.
export function rpcStub(object, calls) {
  return new Proxy(object, {
    get(target, key) {
      const v = target[key];
      if (typeof v !== "function") return v;
      return async (...args) => {
        calls[key] = (calls[key] ?? 0) + 1;
        const out = await v.apply(target, structuredClone(args));
        return out === undefined ? out : structuredClone(out);
      };
    },
  });
}

export function fakeR2() {
  const files = new Map();
  const ops = { put: 0, get: 0, delete: 0 };
  return {
    files, ops,
    async put(key, body) { ops.put++; files.set(key, typeof body === "string" ? body : String(body)); },
    async get(key) { ops.get++; return files.has(key) ? { text: async () => files.get(key) } : null; },
    async delete(key) { ops.delete++; files.delete(key); },
  };
}

export function fakeCache() {
  const entries = new Map();
  const stats = { hits: 0, misses: 0 };
  return {
    entries, stats,
    async match(req) { const r = entries.get(req.url); if (r) stats.hits++; else stats.misses++; return r ? r.clone() : undefined; },
    async put(req, res) { entries.set(req.url, res.clone()); },
  };
}

const iso = (ms) => new Date(ms).toISOString();
const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

// The sources' answers for the time clock.now. frostStations: how many of MET's stations are in the area.
export function fakeFetch(clock, sites, { frostStations = 30 } = {}) {
  const requests = {};
  const fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
    requests[url.host] = (requests[url.host] ?? 0) + 1;
    const now = clock.now;
    const hour = Math.floor(now / 3600000) * 3600000;
    if (url.host === "api.met.no") {
      const timeseries = Array.from({ length: 60 }, (_, i) => ({
        time: iso(hour + i * 3600000).replace(".000", ""),
        data: { instant: { details: { wind_from_direction: 230, wind_speed: 5, wind_speed_of_gust: 9 } }, next_1_hours: { details: { precipitation_amount: 0 } } },
      }));
      return json({ properties: { meta: { updated_at: iso(hour - 3600000) }, timeseries } });
    }
    if (url.host === "api.holfuy.com") {
      const t = iso(Math.floor(now / 60000) * 60000).slice(0, 19).replace("T", " ");
      const measurements = url.searchParams.get("s").split(",").map((id) => ({
        stationId: Number(id), stationName: `Holfuy ${id}`, dateTime: t, location: { latitude: 68.76, longitude: 16.5, altitude: 470 },
        wind: { speed: 4.2, gust: 6.1, min: 2.0, direction: 225 }, temperature: 6.5,
      }));
      return json({ measurements });
    }
    if (url.host === "frost.met.no" && url.pathname.startsWith("/sources")) {
      return json({ data: Array.from({ length: frostStations }, (_, i) => {
        const s = sites[i % sites.length];
        return { id: `SN${90000 + i}`, name: `STASJON ${i}`, geometry: { coordinates: [s.lon + 0.01, s.lat + 0.01] }, masl: 100 };
      }) });
    }
    if (url.host === "frost.met.no" && url.pathname.startsWith("/observations")) {
      const t = iso(Math.floor(now / 600000) * 600000);
      return json({ data: url.searchParams.get("sources").split(",").map((id) => ({
        sourceId: `${id}:0`, referenceTime: t,
        observations: [{ elementId: "wind_speed", value: 4 }, { elementId: "wind_from_direction", value: 200 }, { elementId: "max(wind_speed_of_gust PT10M)", value: 7 }, { elementId: "air_temperature", value: 5 }],
      })) });
    }
    if (url.host === "api.open-meteo.com") {
      // From midnight UTC, as Open-Meteo answers. Several points (the forecast grid) give a list, one answer per point.
      const day = Math.floor(now / 86400000) * 86400000;
      const time = Array.from({ length: 72 }, (_, i) => (day + i * 3600000) / 1000);
      const vars = (url.searchParams.get("hourly") ?? "").split(",");
      const one = (k) => ({ elevation: k % 3 ? 300 : 0, hourly: Object.fromEntries([["time", time], ...vars.map((v) => [v, time.map((t, i) => (v.includes("direction") ? 220 : 4 + (i % 5)))])]) });
      const lats = (url.searchParams.get("latitude") ?? "").split(",");
      return json(lats.length > 1 ? lats.map((_, k) => one(k)) : one(1));
    }
    if (url.host === "live.glidernet.org") {
      // Three paragliders over the first site between 10 and 16 UTC, none otherwise.
      const h = new Date(now).getUTCHours();
      const s = sites[0];
      const ms = h >= 10 && h < 16
        ? [1, 2, 3].map((n) => `<m a="${(s.lat + n * 0.002).toFixed(5)},${s.lon.toFixed(5)},P${n},Pilot ${n},${600 + n * 50},12:00:00,5,90,25,1.2,7,RX,F,abc00${n}"/>`).join("")
        : "";
      return new Response(`<?xml version="1.0"?><markers>${ms}</markers>`);
    }
    if (url.host === "ddb.glidernet.org") {
      // OGN's device database: 1200 devices, every hundredth not to be tracked.
      return json({ devices: Array.from({ length: 1200 }, (_, i) => ({ device_type: "F", device_id: i.toString(16).toUpperCase().padStart(6, "0"), tracked: i % 100 ? "Y" : "N", identified: "Y" })) });
    }
    if (url.host === "ws.geonorge.no") {
      const points = JSON.parse(url.searchParams.get("punkter") ?? "[]");
      return json({ punkter: points.map(() => ({ z: 100 })) });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch, requests };
}
