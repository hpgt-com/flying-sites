// «Flyaktivitet» (/flyaktivitet/): the flights from all the flying sites, from the data service (/v1/flights.json,
// workers/data/src/sources/flights.js), counted from the Open Glider Network. Today and the last 30 days are counted by
// this page's own clock from the days the data service sends (recent), so they are right even when nobody has flown for
// a while: four numbers, who is in the air today, the sites used most in the last 30 days, the flights per month for all
// sites together (flights.js chart, once more than one month has flying), and every site since the counting began. The
// site names and links come from the page (#sites-data). Built with DOM methods only. Exposed as
// window.FlyingSitesActivity; tested in test/activity.test.js.
(function () {
  "use strict";

  var RECENT = 30;
  var text = function (key, vars) { var FS = globalThis.FlyingSites; return FS && FS.t ? FS.t(key, vars) : key; };
  function useText(fn) { text = fn; }
  var DAY = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" });
  function osloDay(ms) { return DAY.format(new Date(ms)); }

  // The numbers for the page: { today: [rows], recent: [rows], all: [rows], totals, months } where a row is a site with
  // its name and link and its flights, days, minutes, farthest, highest and last day (for the period), most flights first.
  // sites: [{ id, name, url }] from the page; a site the page does not know is shown by its id, without a link.
  function summarize(data, sites, now) {
    var info = {};
    (sites || []).forEach(function (s) { info[s.id] = s; });
    var today = osloDay(now), from = osloDay(now - (RECENT - 1) * 86400000);
    var rows = { today: [], recent: [], all: [] }, months = {}, totals = { today: 0, recent: 0, recentSites: 0, recentMinutes: 0 };
    Object.keys(data.sites).forEach(function (id) {
      var s = data.sites[id], base = { id: id, name: (info[id] && info[id].name) || id, url: info[id] ? info[id].url : null };
      var recent = { flights: 0, days: 0, minutes: 0, last: null };
      Object.keys(s.recent || {}).forEach(function (day) {
        if (day < from || day > today) return;
        var d = s.recent[day];
        recent.flights += d.flights; recent.days++; recent.minutes += d.minutes;
        if (!recent.last || day > recent.last) recent.last = day;
        if (day === today) rows.today.push(Object.assign({}, base, { flights: d.flights }));
      });
      if (recent.flights) {
        rows.recent.push(Object.assign({}, base, recent));
        totals.recent += recent.flights; totals.recentSites++; totals.recentMinutes += recent.minutes;
      }
      if (s.flights) rows.all.push(Object.assign({}, base, { flights: s.flights, days: s.days, minutes: s.minutes, maxDist: s.maxDist, maxAlt: s.maxAlt, last: s.last }));
      Object.keys(s.months || {}).forEach(function (m) {
        var t = (months[m] = months[m] || { flights: 0, days: 0 });
        t.flights += s.months[m].flights;
      });
    });
    var byFlights = function (a, b) { return b.flights - a.flights || a.name.localeCompare(b.name, "nb"); };
    rows.today.sort(byFlights); rows.recent.sort(byFlights); rows.all.sort(byFlights);
    totals.today = rows.today.reduce(function (n, r) { return n + r.flights; }, 0);
    return { today: rows.today, recent: rows.recent, all: rows.all, totals: totals, months: months };
  }

  function make(tag, cls, content) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (content != null) n.textContent = String(content);
    return n;
  }
  function hoursText(minutes) {
    var FS = globalThis.FlyingSites, h = minutes / 60;
    return h < 10 ? FS.formatNumber(Math.round(h * 10) / 10, 1) : String(Math.round(h));
  }
  function dateText(day, withYear) {
    var lang = globalThis.FlyingSites && globalThis.FlyingSites.lang === "en" ? "en-GB" : "nb-NO";
    return new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: withYear ? "numeric" : undefined, timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
  }
  function siteCell(row) {
    var th = make("th");
    th.scope = "row";
    if (row.url) { var a = th.appendChild(make("a", null, row.name)); a.href = row.url; } else th.textContent = row.name;
    return th;
  }
  // A table of rows; columns: [[label key, (row) => text]].
  function table(rows, columns, caption) {
    var wrap = make("div", "activity-table-wrap");
    var t = wrap.appendChild(make("table", "activity-table"));
    t.appendChild(make("caption", "visually-hidden", caption));
    var tr = t.appendChild(make("thead")).appendChild(make("tr"));
    var head = tr.appendChild(make("th", null, text("activity.colSite")));
    head.scope = "col";
    columns.forEach(function (c) { var th = tr.appendChild(make("th", null, text("activity." + c[0]))); th.scope = "col"; });
    var body = t.appendChild(make("tbody"));
    rows.forEach(function (r) {
      var row = body.appendChild(make("tr"));
      row.appendChild(siteCell(r));
      columns.forEach(function (c) { row.appendChild(make("td", null, c[1](r))); });
    });
    return wrap;
  }
  function stat(value, label) {
    var div = make("div");
    div.appendChild(make("strong", null, value));
    div.appendChild(make("small", null, label));
    return div;
  }

  // The page's content: [nodes].
  function render(data, sites, now) {
    var FS = globalThis.FlyingSites, FL = globalThis.FlyingSitesFlights, sum = summarize(data, sites, now), out = [];
    var note = make("p", "activity-note", text("flights.note", { date: dateText(data.since, true) }));
    if (!sum.all.length) { out.push(make("p", null, text("activity.none")), note); return out; }
    var stats = make("div", "access-stats activity-stats");
    stats.setAttribute("role", "group");
    stats.setAttribute("aria-label", text("activity.statsLabel"));
    stats.appendChild(stat(sum.totals.today, text("activity.today")));
    stats.appendChild(stat(sum.totals.recent, text("activity.recent")));
    stats.appendChild(stat(sum.totals.recentSites, text("activity.recentSites")));
    stats.appendChild(stat(hoursText(sum.totals.recentMinutes), text("activity.recentHours")));
    out.push(stats);
    if (sum.today.length) out.push(make("p", "activity-today", text("activity.todayList", { list: sum.today.map(function (r) { return r.name + " " + r.flights; }).join(" · ") })));

    out.push(make("h2", null, text("activity.recentTitle")));
    out.push(sum.recent.length ? table(sum.recent, [
      ["colFlights", function (r) { return r.flights; }], ["colDays", function (r) { return r.days; }],
      ["colHours", function (r) { return hoursText(r.minutes); }], ["colLast", function (r) { return dateText(r.last); }],
    ], text("activity.recentTitle")) : make("p", null, text("activity.noneRecent")));

    var months = FL.lastMonths({ months: sum.months }, now);
    if (months.filter(function (m) { return m.flights > 0; }).length > 1) {
      out.push(make("h2", null, text("activity.monthsTitle")));
      out.push(FL.chart(months, "activity.barTitle"));
    }

    out.push(make("h2", null, text("activity.allTitle", { date: dateText(data.since, true) })));
    out.push(table(sum.all, [
      ["colFlights", function (r) { return r.flights; }], ["colDays", function (r) { return r.days; }],
      ["colHours", function (r) { return hoursText(r.minutes); }],
      ["colFarthest", function (r) { return r.maxDist > 0 ? FS.formatNumber(r.maxDist, 1) + " km" : "–"; }],
      ["colHighest", function (r) { return r.maxAlt != null ? text("activity.masl", { m: r.maxAlt }) : "–"; }],
      ["colLast", function (r) { return dateText(r.last); }],
    ], text("activity.allTitle", { date: dateText(data.since, true) })));
    out.push(note);
    return out;
  }

  // «Siste turer»: the flight log (/v1/flight-log.json), one row per flight, newest first; a chosen flight is drawn on
  // a map (Leaflet, common.js createMap) with OGN's positions, below the table. A link #tur-<id> opens that flight.
  function isFlightLog(d) {
    return !!(d && d.dataset === "flight-log" && Array.isArray(d.flights) && d.flights.every(function (f) {
      return f && typeof f.id === "string" && /^[0-9a-f]{6,16}$/.test(f.id) && typeof f.site === "string" && typeof f.start === "string" && typeof f.minutes === "number" && Array.isArray(f.points);
    }));
  }
  function timeText(iso) {
    var lang = globalThis.FlyingSites && globalThis.FlyingSites.lang === "en" ? "en-GB" : "nb-NO";
    return new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Oslo" }).format(new Date(iso));
  }
  function logRows(data, sites) {
    var info = {};
    (sites || []).forEach(function (s) { info[s.id] = s; });
    return data.flights.filter(function (f) { return f.counted !== false; }).map(function (f) {
      return { id: f.id, name: (info[f.site] && info[f.site].name) || f.site, url: null, site: f.site, day: f.day || f.start.slice(0, 10), start: f.start, minutes: f.minutes,
        maxAlt: f.maxAlt, maxDist: f.maxDist, maxSpeed: f.maxSpeed, counted: f.counted !== false, points: f.points };
    });
  }
  // The height curve of a flight: height against time since takeoff from OGN's positions (one every other minute), the
  // top marked. The pointer on the curve (mouse or finger) marks the time and height there and the spot on the map.
  var SVG = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs, parent) {
    var el = document.createElementNS(SVG, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(el);
    return el;
  }
  function heightCurve(holder, f, onPoint) {
    var FS = globalThis.FlyingSites;
    var pts = f.points.filter(function (p) { return typeof p[3] === "number" && typeof p[0] === "string"; });
    if (pts.length < 2) return;
    var t0 = Date.parse(f.points[0][0]), T = function (p) { return (Date.parse(p[0]) - t0) / 1000; };
    var tEnd = Math.max(T(pts[pts.length - 1]), 60), alts = pts.map(function (p) { return p[3]; });
    var aMin = Math.min.apply(null, alts), aMax = Math.max.apply(null, alts), pad = Math.max(50, (aMax - aMin) * 0.1);
    aMin = Math.max(0, Math.floor((aMin - pad) / 50) * 50); aMax = Math.ceil((aMax + pad) / 50) * 50;
    var W = 600, H = 180, L = 46, R = 10, Tp = 14, B = 24;
    var PX = function (t) { return L + (W - L - R) * t / tEnd; }, PY = function (a) { return Tp + (H - Tp - B) * (1 - (a - aMin) / (aMax - aMin)); };
    var wrap = holder.appendChild(make("div", "activity-log-curve"));
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "activity-curve", role: "img", "aria-label": text("activity.curveLabel") }, wrap);
    var step = aMax - aMin <= 400 ? 100 : aMax - aMin <= 1000 ? 200 : 500;
    for (var a = Math.ceil(aMin / step) * step; a <= aMax; a += step) {
      svgEl("line", { x1: L, x2: W - R, y1: PY(a).toFixed(1), y2: PY(a).toFixed(1), class: "activity-curve__grid" }, svg);
      svgEl("text", { x: L - 6, y: (PY(a) + 4).toFixed(1), "text-anchor": "end" }, svg).textContent = FS.formatNumber(a);
    }
    var tstep = tEnd <= 1200 ? 300 : tEnd <= 3600 ? 600 : tEnd <= 7200 ? 900 : tEnd <= 14400 ? 1800 : 3600;
    for (var tt = 0; tt <= tEnd; tt += tstep) svgEl("text", { x: PX(tt).toFixed(1), y: H - 6, "text-anchor": "middle" }, svg).textContent = hm(Math.round(tt / 60));
    var line = pts.map(function (p) { return PX(T(p)).toFixed(1) + " " + PY(p[3]).toFixed(1); });
    svgEl("path", { d: "M" + line.join("L") + "L" + PX(T(pts[pts.length - 1])).toFixed(1) + " " + PY(aMin).toFixed(1) + "L" + PX(T(pts[0])).toFixed(1) + " " + PY(aMin).toFixed(1) + "Z", class: "activity-curve__area" }, svg);
    svgEl("path", { d: "M" + line.join("L"), class: "activity-curve__line" }, svg);
    var top = 0; pts.forEach(function (p, i) { if (p[3] > pts[top][3]) top = i; });
    svgEl("circle", { cx: PX(T(pts[top])).toFixed(1), cy: PY(pts[top][3]).toFixed(1), r: 4, class: "activity-curve__top" }, svg);
    svgEl("text", { x: PX(T(pts[top])).toFixed(1), y: (PY(pts[top][3]) - 8).toFixed(1), "text-anchor": "middle", class: "activity-curve__label" }, svg).textContent = text("activity.masl", { m: FS.formatNumber(pts[top][3]) });
    var cursor = svgEl("line", { x1: 0, x2: 0, y1: Tp, y2: H - B, class: "activity-curve__cursor", visibility: "hidden" }, svg);
    var label = svgEl("text", { x: 0, y: Tp + 10, class: "activity-curve__label", visibility: "hidden" }, svg);
    svgEl("rect", { x: L, y: Tp, width: W - L - R, height: H - Tp - B, fill: "transparent" }, svg);
    function at(clientX) {
      var box = svg.getBoundingClientRect(), x = (clientX - box.left) / box.width * W;
      var t = Math.max(0, Math.min(tEnd, (x - L) / (W - L - R) * tEnd)), best = 0;
      pts.forEach(function (p, i) { if (Math.abs(T(p) - t) < Math.abs(T(pts[best]) - t)) best = i; });
      var p = pts[best], px = PX(T(p));
      cursor.setAttribute("x1", px.toFixed(1)); cursor.setAttribute("x2", px.toFixed(1)); cursor.setAttribute("visibility", "visible");
      label.textContent = hm(Math.round(T(p) / 60)) + " · " + text("activity.masl", { m: FS.formatNumber(p[3]) }) + (typeof p[4] === "number" ? " · " + FS.formatNumber(Math.round(p[4] * 3.6)) + " km/h" : "");
      label.setAttribute("x", (px > W * 0.7 ? px - 6 : px + 6).toFixed(1)); label.setAttribute("text-anchor", px > W * 0.7 ? "end" : "start"); label.setAttribute("visibility", "visible");
      onPoint(p);
    }
    svg.addEventListener("pointermove", function (e) { at(e.clientX); });
    svg.addEventListener("pointerdown", function (e) { at(e.clientX); });
    svg.addEventListener("pointerleave", function () { cursor.setAttribute("visibility", "hidden"); label.setAttribute("visibility", "hidden"); onPoint(null); });
    wrap.appendChild(make("p", "activity-note", text("activity.curveNote")));
  }
  function hm(min) { return Math.floor(min / 60) + ":" + String(min % 60).padStart(2, "0"); }
  function flightMap(holder, f) {
    var FS = globalThis.FlyingSites, L = globalThis.L;
    if (!L || !FS.createMap) return;
    var el = holder.appendChild(make("div", "activity-log-map"));
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", text("activity.mapLabel"));
    var map = FS.createMap(el, { scrollWheelZoom: false });
    var latlngs = f.points.filter(function (p) { return typeof p[1] === "number" && typeof p[2] === "number"; }).map(function (p) { return [p[1], p[2]]; });
    if (!latlngs.length) return;
    L.polyline(latlngs, { color: "#1C2B33", weight: 5, opacity: 0.85 }).addTo(map);
    L.polyline(latlngs, { color: "#FFD23F", weight: 2.5 }).addTo(map);
    f.points.forEach(function (p, i) {
      if (typeof p[1] !== "number") return;
      var first = i === 0, last = i === f.points.length - 1;
      L.circleMarker([p[1], p[2]], { radius: first || last ? 6 : 3.5, color: "#fff", weight: 1.5, fillColor: first ? "#1E8A4C" : last ? "#C24A12" : "#2E5E6E", fillOpacity: 1 })
        .bindTooltip(text("activity.pointTitle", { time: timeText(p[0]), alt: p[3] != null ? FS.formatNumber(p[3]) : "?", kmh: p[4] != null ? FS.formatNumber(Math.round(p[4] * 3.6)) : "?" }))
        .addTo(map);
    });
    if (latlngs.length > 1) map.fitBounds(latlngs, { padding: [24, 24], maxZoom: 14 }); else map.setView(latlngs[0], 13);
    var cursor = L.circleMarker(latlngs[0], { radius: 9, color: "#fff", weight: 3, fillColor: "#1C2B33", fillOpacity: 1 });
    heightCurve(holder, f, function (p) {
      if (!p) { map.removeLayer(cursor); return; }
      cursor.setLatLng([p[1], p[2]]);
      if (!map.hasLayer(cursor)) cursor.addTo(map);
    });
  }
  function renderLogDetail(holder, f) {
    var FS = globalThis.FlyingSites;
    holder.replaceChildren();
    var card = holder.appendChild(make("div", "activity-log-detail"));
    card.id = "tur-" + f.id;
    var head = card.appendChild(make("div", "activity-log-head"));
    head.appendChild(make("h3", null, text("activity.logDetail", { site: f.name, date: dateText(f.day, true), time: timeText(f.start), minutes: f.minutes,
      alt: f.maxAlt != null ? FS.formatNumber(f.maxAlt) : "?", km: f.maxDist != null ? FS.formatNumber(f.maxDist, 1) : "?", kmh: f.maxSpeed != null ? FS.formatNumber(Math.round(f.maxSpeed * 3.6)) : "?", n: f.points.length })));
    var close = head.appendChild(make("button", "btn btn--small", text("activity.logClose")));
    close.type = "button";
    close.addEventListener("click", function () { holder.replaceChildren(); });
    flightMap(card, f);
    card.scrollIntoView({ block: "nearest" });
  }
  function renderLog(data, sites) {
    var FS = globalThis.FlyingSites, rows = logRows(data, sites), out = [];
    if (!rows.length) { out.push(make("p", "muted", text("activity.logNone"))); return out; }
    var wrap = table(rows.slice(0, 60), [
      ["colStart", function (r) { return dateText(r.day) + " " + timeText(r.start); }], ["colMinutes", function (r) { return r.minutes; }],
      ["colHighest", function (r) { return r.maxAlt != null ? text("activity.masl", { m: r.maxAlt }) : "–"; }],
      ["colFarthest", function (r) { return r.maxDist != null ? FS.formatNumber(r.maxDist, 1) + " km" : "–"; }],
    ], text("activity.logTitle"));
    var detail = make("div", "activity-log-holder");
    var trs = wrap.querySelectorAll("tbody tr");
    rows.slice(0, 60).forEach(function (r, i) {
      var tr = trs[i];
      tr.className = "activity-log-row";
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      var open = function () { renderLogDetail(detail, r); };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); } });
    });
    out.push(wrap, detail);
    var wanted = /^#tur-([0-9a-f]+)$/.exec(location.hash || "");
    if (wanted) { var f = rows.filter(function (r) { return r.id === wanted[1]; })[0]; if (f) setTimeout(function () { renderLogDetail(detail, f); }, 0); }
    return out;
  }
  function initLog() {
    var box = document.getElementById("activity-log"), body = document.getElementById("activity-log-body");
    var FS = globalThis.FlyingSites;
    if (!box || !body || !FS || typeof fetch !== "function") return;
    fetch(box.getAttribute("data-url"), { credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!isFlightLog(d)) return;
        body.replaceChildren.apply(body, renderLog(d, FS.readJson("sites-data") || []));
        box.hidden = false;
      })
      .catch(function () {});
  }

  function init() {
    initLog();
    var box = document.getElementById("activity");
    var FS = globalThis.FlyingSites, FL = globalThis.FlyingSitesFlights;
    if (!box || !FS || !FL || typeof fetch !== "function") return;
    fetch(box.getAttribute("data-url"), { credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!FL.isFlightsData(d)) throw new Error("bad data");
        box.replaceChildren.apply(box, render(d, FS.readJson("sites-data") || [], Date.now()));
      })
      .catch(function () { box.replaceChildren(make("p", null, text("activity.failed"))); });
  }

  globalThis.FlyingSitesActivity = { summarize: summarize, isFlightLog: isFlightLog, logRows: logRows, useText: useText };
  if (typeof document !== "undefined" && document.getElementById) init();
})();
