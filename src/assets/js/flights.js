// «Flyaktivitet» on the site page (site.njk, #flights): how many flights the Open Glider Network has seen paragliders
// make from this site, from the data service (/v1/flights.json, workers/data/src/sources/flights.js). The sums as three
// numbers (flights, days with flying, hours in the air), the farthest from launch and the highest, and the flights per
// month for the last 12 months as bars once there is more than one month. Only pilots who send their position to OGN
// are counted, which the note under says. The section stays hidden when the data service
// cannot be reached. Built with DOM methods only. Exposed as window.FlyingSitesFlights; tested in test/flights.test.js.
(function () {
  "use strict";

  var MONTHS = 12;
  var text = function (key, vars) { var FS = globalThis.FlyingSites; return FS && FS.t ? FS.t(key, vars) : key; };
  var plural = function (key, n) { var FS = globalThis.FlyingSites; return FS && FS.tn ? FS.tn(key, n) : key; };
  function useText(fn, pluralFn) { text = fn; if (pluralFn) plural = pluralFn; }
  var isNum = function (v) { return typeof v === "number" && Number.isFinite(v); };
  function lang() { return globalThis.FlyingSites && globalThis.FlyingSites.lang === "en" ? "en-GB" : "nb-NO"; }
  function number(n, digits) { var FS = globalThis.FlyingSites; return FS && FS.formatNumber ? FS.formatNumber(n, digits) : String(n); }

  // Only data in the expected shape.
  function isFlightsData(d) {
    if (!d || d.dataset !== "flights" || typeof d.since !== "string" || !d.sites || typeof d.sites !== "object") return false;
    return Object.keys(d.sites).every(function (k) {
      var s = d.sites[k];
      return s && isNum(s.flights) && isNum(s.days) && isNum(s.pilots) && isNum(s.minutes) && s.months && typeof s.months === "object" &&
        Object.keys(s.months).every(function (m) { return /^\d{4}-\d{2}$/.test(m) && isNum(s.months[m].flights) && isNum(s.months[m].days); });
    });
  }

  // The last MONTHS months up to the month of `now` (YYYY-MM, oldest first), with the flights and days of each.
  function lastMonths(site, now) {
    var d = new Date(now), out = [];
    var y = d.getUTCFullYear(), m = d.getUTCMonth();
    for (var k = MONTHS - 1; k >= 0; k--) {
      var mm = m - k, yy = y;
      while (mm < 0) { mm += 12; yy--; }
      var key = yy + "-" + String(mm + 1).padStart(2, "0");
      var v = (site && site.months[key]) || { flights: 0, days: 0 };
      out.push({ key: key, flights: v.flights, days: v.days });
    }
    return out;
  }
  function dateText(day) {
    return new Intl.DateTimeFormat(lang(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
  }
  function monthText(key, style) {
    return new Intl.DateTimeFormat(lang(), { month: style, timeZone: "UTC" }).format(new Date(key + "-15T12:00:00Z")).replace(".", "");
  }
  // «Lengst fra start 12,3 km · høyest 1850 moh · sist 19. okt. 2026», the parts there are.
  function detailText(site) {
    var parts = [];
    if (site.maxDist > 0) parts.push(text("flights.farthest", { km: number(site.maxDist, 1) }));
    if (isNum(site.maxAlt)) parts.push(text("flights.highest", { m: site.maxAlt }));
    if (site.last) parts.push(text("flights.last", { date: dateText(site.last) }));
    return parts.join(" · ");
  }

  function make(tag, cls, content) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (content != null) n.textContent = content;
    return n;
  }
  function stat(value, unit, label) {
    var div = make("div");
    div.appendChild(make("strong", null, String(value)));
    if (unit) { div.appendChild(document.createTextNode(" ")); div.appendChild(make("span", null, unit)); }
    div.appendChild(make("small", null, label));
    return div;
  }
  // The flights per month as bars, the highest labelled; each bar says its month and numbers to screen readers and on hover.
  // titleKey: the words for each bar (default flights.barTitle, with the month, flights and days).
  function chart(months, titleKey) {
    var max = Math.max.apply(null, months.map(function (m) { return m.flights; }));
    var list = make("ol", "flights-chart");
    list.setAttribute("aria-label", text("flights.chartLabel"));
    months.forEach(function (m) {
      var li = make("li", "flights-chart__month");
      var words = text(titleKey || "flights.barTitle", { month: monthText(m.key, "long"), flights: m.flights, days: m.days });
      li.title = words;
      var bar = make("span", "flights-chart__bar");
      bar.style.height = (max ? Math.round((m.flights / max) * 100) : 0) + "%";
      bar.setAttribute("aria-hidden", "true");
      if (m.flights === max && max > 0) bar.appendChild(make("span", "flights-chart__value", String(m.flights)));
      var col = make("span", "flights-chart__col");
      col.setAttribute("aria-hidden", "true");
      col.appendChild(bar);
      li.appendChild(col);
      li.appendChild(make("span", "flights-chart__label", monthText(m.key, "short")));
      li.lastChild.setAttribute("aria-hidden", "true");
      li.appendChild(make("span", "visually-hidden", words));
      list.appendChild(li);
    });
    return list;
  }

  // The section's content for one site: [nodes].
  function render(data, siteId, now) {
    var site = data.sites[siteId];
    var out = [];
    if (!site || !site.flights) {
      out.push(make("p", null, text("flights.none")));
    } else {
      var stats = make("div", "access-stats flights-stats");
      stats.setAttribute("role", "group");
      stats.setAttribute("aria-label", text("flights.statsLabel"));
      stats.appendChild(stat(site.flights, null, plural("flights.flights", site.flights)));
      stats.appendChild(stat(site.days, null, plural("flights.days", site.days)));
      var hours = site.minutes / 60;
      stats.appendChild(stat(hours < 10 ? number(Math.round(hours * 10) / 10, 1) : Math.round(hours), text("flights.hoursUnit"), text("flights.airtime")));
      out.push(stats);
      var details = detailText(site);
      if (details) out.push(make("p", "flights-details", details));
      var months = lastMonths(site, now);
      if (months.filter(function (m) { return m.flights > 0; }).length > 1) out.push(chart(months));
    }
    // How the flights are counted, folded.
    var help = make("details", "help-fold");
    help.appendChild(make("summary", null, text("help.howCounted")));
    help.appendChild(make("p", "flights-note", text("flights.note", { date: dateText(data.since) })));
    out.push(help);
    return out;
  }

  function init() {
    var box = document.getElementById("flights");
    if (!box || typeof fetch !== "function") return;
    var body = box.querySelector(".flights");
    fetch(box.getAttribute("data-url"), { credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!isFlightsData(d)) return;
        render(d, box.getAttribute("data-site"), Date.now()).forEach(function (n) { body.appendChild(n); });
        box.hidden = false;
      })
      .catch(function () {});
  }

  globalThis.FlyingSitesFlights = { isFlightsData: isFlightsData, lastMonths: lastMonths, detailText: detailText, chart: chart, render: render, useText: useText };
  if (typeof document !== "undefined" && document.getElementById) init();
})();
