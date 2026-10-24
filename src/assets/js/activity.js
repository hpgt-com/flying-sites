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

  function init() {
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

  globalThis.FlyingSitesActivity = { summarize: summarize, useText: useText };
  if (typeof document !== "undefined" && document.getElementById) init();
})();
