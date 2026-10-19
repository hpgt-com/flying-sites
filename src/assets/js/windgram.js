// «Vind over starten» on the site page: the wind at heights above the launch hour by hour, with the rows under it for
// the wind at the launch, the gusts near the ground, the thermals, the clouds and the rain, from Open-Meteo. The grid is
// computed at build time (lib/windgram.js) and stored in #windgram-data; the data service has the same grid
// (workers/data/src/sources/windgram.js) every half hour, and it replaces the built one when newer.
// Drawn as SVG: the heights to scale in metres from just under the ground, each cell coloured by the site's wind rules
// (below the minimum pale, suitable green, near the limit yellow, above red) with an arrow where the wind blows and the
// speed. The thermals are a line: solid up to the cloud base (what a pilot can use), dashed above it (in cloud). The
// height axis and the row names stay put at the left while the hours scroll sideways, on a phone and on a wide screen
// alike. Built with DOM methods only, nothing from the data is parsed as HTML. The section stays hidden until there is
// a grid. Exposed as window.FlyingSitesWindgram (the pure helpers); tested in test/windgram.test.js.
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var CW = 34, TOP = 14, BOT = 290, MTOP = 2600, AXIS_W = 66;
  // The rows under the grid (y in the drawing).
  var Y = { hour: BOT + 16, day: BOT + 30, launch: BOT + 40, gust: BOT + 80, thermal: BOT + 110, clouds: BOT + 140, rain: BOT + 184, end: BOT + 222 };
  var CLOUD = "M-8,3 C-11,3 -11,-3 -7,-3 C-6,-7 0,-8 2,-4 C6,-6 10,-2 7,1 C9,3 7,4 6,3 Z";
  var ARROW = "M0,-5.5 L4,3.5 L0,1.3 L-4,3.5 Z";

  // The class of a speed by the site's rules: calm, ok, maybe, high or storm.
  function speedClass(speed, rules) {
    if (speed < rules.minWind) return "calm";
    if (speed <= rules.maxWind - 2) return "ok";
    if (speed <= rules.maxWind) return "maybe";
    if (speed <= rules.maxGust) return "high";
    return "storm";
  }
  // The gusts near the ground: plain, near the limit (over the site's max wind) or over the max gust.
  function gustClass(gust, rules) { return gust > rules.maxGust ? "high" : gust > rules.maxWind ? "maybe" : "calm"; }
  // How high the thermals go that a pilot can use: to the boundary layer, or to the cloud base when it is lower. { top
  // (m a.s.l.), over (m over the launch, rounded to 50), capped (the clouds are the ceiling) }, or null without a top.
  function usableThermal(blh, cloudBase, launch) {
    if (blh == null) return null;
    var capped = cloudBase != null && cloudBase < blh;
    var top = capped ? cloudBase : blh;
    return { top: top, over: launch == null ? null : Math.round((top - launch) / 50) * 50, capped: capped };
  }

  function svg(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, String(attrs[k]));
    if (parent) parent.appendChild(n);
    return n;
  }
  function text(parent, x, y, value, cls, anchor) {
    var t = svg("text", { x: x, y: y, class: cls, "text-anchor": anchor || null }, parent);
    t.textContent = String(value);
    return t;
  }
  function node(tag, className, value) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (value != null) n.textContent = String(value);
    return n;
  }

  function init() {
    var FS = window.FlyingSites, W = window.FlyingSitesWind;
    var el = document.getElementById("windgram-grid");
    var box = document.getElementById("windgram");
    var page = FS && W && el ? FS.readJson("windgram-data") : null;
    if (!page) return;
    var rules = page.rules;
    var t = function (key, vars) { return FS.t("windgram." + key, vars); };
    var num = function (v, d) { return FS.formatNumber(v, d || 0); };
    var sun = {};
    function isNight(ms) {
      var date = W.osloParts(ms).date;
      var s = sun[date] || (sun[date] = W.sunTimes(date, page.lat, page.lon));
      if (s.polar) return s.polar === "night";
      return ms < s.rise || ms > s.set;
    }

    // Draws the grid and the rows. false when there are no hours left.
    function render(data) {
      if (!data || !data.times || !data.times.length) return false;
      // Only hours from now on (the build or the data service can be some hours old).
      var now = Date.now(), first = 0;
      while (first < data.times.length - 1 && data.times[first + 1] <= now) first++;
      if (data.times[first] + 3600000 <= now) return false;
      var cols = [];
      for (var i = first; i < data.times.length; i++) cols.push(i);
      var launch = data.launch, ground = Math.min(data.elevation == null ? launch : data.elevation, launch == null ? Infinity : launch);
      // The height axis starts just under the ground, so the heights that matter get the room.
      var base = Math.max(0, Math.floor((ground - 80) / 50) * 50), top = launch != null && launch > 1500 ? 3000 : MTOP;
      var y = function (m) { return Math.round((BOT - ((m - base) / (top - base)) * (BOT - TOP)) * 10) / 10; };
      var rows = [];
      data.heights.forEach(function (h, k) { if (h >= (launch == null ? ground : launch) && h <= top - 100) rows.push({ h: h, k: k }); });
      var launchK = data.heights.indexOf(launch);
      var width = cols.length * CW + 4;

      // The axis at the left: heights, the launch and the names of the rows.
      var axis = svg("svg", { class: "windgram__axis", width: AXIS_W, height: Y.end, viewBox: "0 0 " + AXIS_W + " " + Y.end, "aria-hidden": "true" });
      text(axis, AXIS_W - 4, 10, t("masl"), "windgram__muted", "end");
      for (var m = Math.ceil((ground + 50) / 500) * 500; m <= top - 100; m += 500) text(axis, AXIS_W - 4, y(m) + 4, m, "windgram__muted", "end");
      if (launch != null) text(axis, AXIS_W - 4, y(launch) + 4, t("launchShort"), "windgram__strong", "end");
      [["atLaunch", Y.launch + 20, "windgram__strong"], ["gust", Y.gust + 15], ["thermal", Y.thermal + 15], ["cloudsHigh", Y.clouds + 9, "windgram__small"],
        ["cloudsMid", Y.clouds + 21, "windgram__small"], ["cloudsLow", Y.clouds + 33, "windgram__small"], ["rain", Y.rain + 19]].forEach(function (r) {
        text(axis, AXIS_W - 4, r[1], t(r[0]), r[2] || "windgram__label", "end");
      });

      var chart = svg("svg", { class: "windgram__svg", width: width, height: Y.end, viewBox: "0 0 " + width + " " + Y.end, role: "img", "aria-label": t("chartLabel") });
      for (m = Math.ceil((ground + 50) / 500) * 500; m <= top - 100; m += 500) svg("line", { x1: 0, x2: width, y1: y(m), y2: y(m), class: "windgram__grid" }, chart);
      var blhLine = [], usableLine = [];
      cols.forEach(function (i, j) {
        var x = 2 + j * CW, mid = x + CW / 2, night = isNight(data.times[i]);
        var g = svg("g", {}, chart);
        // Each cell of the grid.
        rows.forEach(function (row, n) {
          var c = data.cells[i][row.k];
          if (!c) return;
          var lo = n === 0 ? ground : (rows[n - 1].h + row.h) / 2, up = n + 1 < rows.length ? (row.h + rows[n + 1].h) / 2 : top;
          var yt = y(up), yb = y(lo), cls = speedClass(c[1], rules);
          svg("rect", { x: x + 1, y: yt + 1, width: CW - 2, height: Math.max(1, yb - yt - 2), rx: 3, class: "windgram__cell windgram--" + cls }, g);
          if (yb - yt >= 24 && n > 0) {
            var yc = (yt + yb) / 2;
            svg("path", { d: ARROW, transform: "translate(" + mid + "," + (yc - 4) + ") rotate(" + ((Number(c[0]) + 180) % 360) + ")", class: "windgram__arrow" }, g);
            text(g, mid, yc + 10, Math.round(c[1]), "windgram__value", "middle");
          }
        });
        if (night) svg("rect", { x: x, y: TOP, width: CW, height: BOT - TOP, class: "windgram__night" }, g);
        // The thermals: the boundary layer, and what a pilot can use of it.
        var th = usableThermal(data.blh[i], data.cloudBase[i], launch);
        if (th) { blhLine.push(mid + "," + y(Math.min(data.blh[i], top))); usableLine.push(mid + "," + y(Math.min(th.top, top))); }
        var cb = data.cloudBase[i];
        if (cb != null && cb > base && cb < top) svg("path", { d: CLOUD, transform: "translate(" + mid + "," + y(cb) + ")", class: "windgram__cloudbase" }, g);
        // The hour, and the day at the first hour and at midnight.
        var parts = W.osloParts(data.times[i]);
        text(g, mid, Y.hour, parts.hour, night ? "windgram__muted" : "windgram__strong", "middle");
        if (j === 0 || parts.hour === "00") {
          text(g, x + 3, Y.day, parts.date === W.osloParts(now).date ? t("today") : parts.date.slice(8, 10) + "." + parts.date.slice(5, 7) + ".", "windgram__muted");
          if (j > 0) svg("line", { x1: x, x2: x, y1: TOP, y2: Y.end - 4, class: "windgram__midnight" }, g);
        }
        // At the launch: colour, arrow and speed.
        var lw = launchK >= 0 ? data.cells[i][launchK] : null;
        if (lw) {
          svg("rect", { x: x + 2, y: Y.launch, width: CW - 4, height: 32, rx: 6, class: "windgram__cell windgram--" + speedClass(lw[1], rules) }, g);
          svg("path", { d: ARROW, transform: "translate(" + mid + "," + (Y.launch + 10) + ") rotate(" + ((Number(lw[0]) + 180) % 360) + ")", class: "windgram__arrow" }, g);
          text(g, mid, Y.launch + 27, Math.round(lw[1]), "windgram__value windgram__strong", "middle");
        }
        // The gusts near the ground.
        var gust = data.gust && data.gust[i];
        if (gust != null) {
          svg("rect", { x: x + 2, y: Y.gust, width: CW - 4, height: 22, rx: 6, class: "windgram__pill windgram__pill--" + gustClass(gust, rules) }, g);
          text(g, mid, Y.gust + 15, Math.round(gust), "windgram__value windgram__strong", "middle");
        }
        // The thermals over the launch, on yellow as strong as the sun.
        svg("rect", { x: x + 2, y: Y.thermal, width: CW - 4, height: 22, rx: 6, class: "windgram__pill" }, g);
        var sw = data.sun && data.sun[i];
        if (sw) svg("rect", { x: x + 2, y: Y.thermal, width: CW - 4, height: 22, rx: 6, class: "windgram__sun", "fill-opacity": Math.min(1, sw / 250).toFixed(2) }, g);
        var over = th && th.over != null && th.over >= 100;
        text(g, mid, Y.thermal + 15, over ? "+" + th.over : "–", "windgram__small windgram__strong", "middle");
        if (over && th.capped) svg("path", { d: CLOUD, transform: "translate(" + (x + 27) + "," + (Y.thermal + 3) + ") scale(0.4)", class: "windgram__cloudbase" }, g);
        // The clouds in three layers, darker for more.
        var cl = (data.clouds && data.clouds[i]) || [];
        [2, 1, 0].forEach(function (layer, n) {
          svg("rect", { x: x + 2, y: Y.clouds + n * 12, width: CW - 4, height: 10, rx: 2, class: "windgram__cloudcover", "fill-opacity": ((cl[layer] || 0) / 100 * 0.85).toFixed(2) }, g);
        });
        // The rain, mm in the hour.
        var mm = data.rain && data.rain[i];
        svg("rect", { x: x + 2, y: Y.rain, width: CW - 4, height: 30, rx: 4, class: "windgram__pill" }, g);
        if (mm > 0) {
          var bh = Math.max(3, Math.min(mm, 3) / 3 * 30);
          svg("rect", { x: x + 2, y: Y.rain + 30 - bh, width: CW - 4, height: bh, rx: 3, class: "windgram__rainbar" }, g);
        }
        text(g, mid, Y.rain + 25, mm > 0 ? num(mm, 1) : "·", mm > 1 ? "windgram__small windgram__onbar" : "windgram__small", "middle");
        // The whole hour in words, on hover.
        var hit = svg("rect", { x: x, y: 0, width: CW, height: Y.end, class: "windgram__hit" }, g);
        svg("title", {}, hit).textContent = t("hourTitle", {
          hour: parts.hour,
          launch: lw ? FS.DIRECTION_LABELS[W.directionCode(Number(lw[0]))] + " " + Math.round(lw[1]) : "–",
          gust: gust == null ? "–" : Math.round(gust),
          thermal: over ? "+" + th.over + (th.capped ? " " + t("toCloudBase") : "") : "–",
          rain: mm == null ? "–" : num(mm, 1),
        });
      });
      // The ground, the launch and the thermal lines over the cells.
      svg("rect", { x: 0, y: y(ground), width: width, height: BOT - y(ground), class: "windgram__ground" }, chart);
      if (launch != null) svg("line", { x1: 0, x2: width, y1: y(launch) - 1, y2: y(launch) - 1, class: "windgram__launch" }, chart);
      svg("polyline", { points: blhLine.join(" "), class: "windgram__incloud" }, chart);
      svg("polyline", { points: usableLine.join(" "), class: "windgram__thermal" }, chart);

      var scroll = node("div", "windgram__scroll");
      scroll.tabIndex = 0;
      scroll.setAttribute("role", "region");
      scroll.setAttribute("aria-label", t("region"));
      scroll.appendChild(chart);
      el.replaceChildren(axis, scroll);
      el.hidden = false;
      legend();
      if (box) box.hidden = false;
      return true;
    }

    // What the colours, lines and rows mean, under the drawing (once).
    function legend() {
      if (!box || box.querySelector(".windgram__legend")) return;
      var r = rules, wrap = node("div", "windgram__legend");
      var scale = node("ul", "windgram__scale");
      [["calm", t("scaleCalm", { min: r.minWind })], ["ok", t("scaleOk", { min: r.minWind, ok: r.maxWind - 2 })], ["maybe", t("scaleMaybe", { ok: r.maxWind - 2, max: r.maxWind })],
        ["high", t("scaleHigh", { max: r.maxWind, gust: r.maxGust })], ["storm", t("scaleStorm", { gust: r.maxGust })]].forEach(function (s) {
        scale.appendChild(node("li", "windgram__swatch windgram--" + s[0], s[1]));
      });
      wrap.appendChild(scale);
      var keys = node("ul", "windgram__keys");
      [["thermal", "legendThermal"], ["incloud", "legendInCloud"], ["cloud", "legendCloudBase"], ["launch", "legendLaunch"], ["arrow", "legendArrow"]].forEach(function (k) {
        var li = keys.appendChild(node("li"));
        li.appendChild(node("span", "windgram__key windgram__key--" + k[0])).setAttribute("aria-hidden", "true");
        li.appendChild(document.createTextNode(t(k[1])));
      });
      wrap.appendChild(keys);
      wrap.appendChild(node("p", "windgram__notes", t("notes", { gust: r.maxGust, max: r.maxWind })));
      el.insertAdjacentElement("afterend", wrap);
    }

    render(page);
    // The data service's grid, when it is newer than the one in the page (or the page has none).
    if (page.live && typeof fetch === "function") {
      fetch(page.live, { credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var grid = d && d.sites && d.sites[page.site];
          if (!grid || (page.fetched && !(Date.parse(d.fetched) > Date.parse(page.fetched)))) return;
          render(grid);
        })
        .catch(function () {});
    }
  }

  globalThis.FlyingSitesWindgram = { speedClass: speedClass, gustClass: gustClass, usableThermal: usableThermal };
  if (typeof document !== "undefined" && document.getElementById) init();
})();
