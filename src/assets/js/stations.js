// Measured wind from the weather stations, from the data service (workers/data, /v1/stations.json): on the home map as
// the layer «Værstasjoner», as «Målt vind nå» in the Vær tab, and on the site page of the station's flying site.
// Refetched every minute while the page is in view. The checks and texts are plain functions, tested in
// test/stations.test.js; the drawing uses DOM methods only, so nothing from the data is read as HTML.
// Loaded after common.js and wind.js, and exposed as window.FlyingSitesStations.
(function () {
  "use strict";

  var REFRESH_MS = 60000;
  // A measurement older than this is shown as old (the station may be down), and not as the wind now.
  var OLD_MINUTES = 30;
  var SVG_NS = "http://www.w3.org/2000/svg";

  var text = function (key, vars) {
    var FS = globalThis.FlyingSites;
    return FS && FS.t ? FS.t(key, vars) : key;
  };
  function useText(fn) { text = fn; }
  var W = function () { return globalThis.FlyingSitesWind; };

  var isNum = function (v) { return typeof v === "number" && Number.isFinite(v); };
  var okNum = function (v) { return v === null || isNum(v); };

  // Only data in the expected shape is used: items with an id, a name, and numbers or null where numbers belong.
  function isStationsData(d) {
    if (!d || d.dataset !== "stations" || !Array.isArray(d.items)) return false;
    return d.items.every(function (i) {
      return i && (typeof i.id === "number" || typeof i.id === "string") && typeof i.name === "string" &&
        (i.time === null || (typeof i.time === "string" && Number.isFinite(Date.parse(i.time)))) &&
        (i.wind === null || (typeof i.wind === "object" && okNum(i.wind.dir) && okNum(i.wind.speed) && okNum(i.wind.gust) && (i.wind.min === undefined || okNum(i.wind.min)))) &&
        okNum(i.temperature) && ["humidity", "pressure", "rain"].every(function (k) { return i[k] === undefined || okNum(i[k]); }) && okNum(i.lat) && okNum(i.lon) &&
        Array.isArray(i.history) && i.history.every(function (r) {
          return Array.isArray(r) && typeof r[0] === "string" && okNum(r[1]) && okNum(r[2]) && okNum(r[3]) && (r[4] === undefined || okNum(r[4]));
        });
    });
  }

  function ageMinutes(item, now) {
    return item.time ? Math.max(0, Math.round((now - Date.parse(item.time)) / 60000)) : null;
  }
  function isOld(item, now) {
    var age = ageMinutes(item, now);
    return age === null || age > OLD_MINUTES;
  }

  // A value as the station sent it, with the page's decimal separator: 4.4 → «4,4», 7 → «7». Not rounded to whole
  // numbers, so the page shows what was measured.
  function value(v) {
    var FS = globalThis.FlyingSites;
    if (!isNum(v)) return "";
    return Number.isInteger(v) ? String(v) : FS.formatNumber(v, Math.min(2, (String(v).split(".")[1] || "").length));
  }

  // «SV 225°», the direction the wind comes from as the compass point and the degrees as measured.
  function dirText(dir) {
    return isNum(dir) ? globalThis.FlyingSites.DIRECTION_LABELS[W().directionCode(dir)] + " " + Math.round(dir) + "°" : "";
  }

  // «SV 225°, 4,4 m/s, kast 7,2», with the numbers as measured, or null without wind.
  function windText(item) {
    var w = item.wind;
    if (!w || !isNum(w.speed)) return null;
    var dir = dirText(w.dir);
    return (dir ? dir + ", " : "") + text("stations.speed", { speed: value(w.speed) }) + (isNum(w.gust) ? text("stations.gust", { gust: value(w.gust) }) : "");
  }

  // «for 3 min siden», «Nå nettopp», or «Gammel måling, kl. 13.05» when it is old.
  function ageText(item, now) {
    var age = ageMinutes(item, now);
    if (age === null) return text("stations.noData");
    if (age > OLD_MINUTES) return text("stations.old", { time: W().formatClock(Date.parse(item.time)) });
    return age < 1 ? text("stations.justNow") : text("stations.minutesAgo", { n: age });
  }

  // Temperature, humidity, pressure and rain (when it rains), those the station has, as measured: «6,2 °C · 81 % · 1012,4 hPa».
  function otherText(item) {
    var parts = [];
    if (isNum(item.temperature)) parts.push(value(item.temperature) + " °C");
    if (isNum(item.humidity)) parts.push(value(item.humidity) + " %");
    if (isNum(item.pressure)) parts.push(value(item.pressure) + " hPa");
    if (isNum(item.rain) && item.rain > 0) parts.push(value(item.rain) + " mm");
    return parts.join(" · ");
  }

  function holfuyUrl(item) { return "https://holfuy.com/en/weather/" + encodeURIComponent(String(item.id)); }

  // A link to the station at Holfuy, in a new tab, which screen readers are told (as the external() macro does).
  function stationLink(item, cls) {
    var a = make("a", cls, item.name);
    a.href = holfuyUrl(item);
    a.target = "_blank";
    a.rel = "noopener";
    a.appendChild(make("span", "visually-hidden", " " + (globalThis.FlyingSites.opensNewTab || "")));
    return a;
  }

  // --- Drawing ---
  function make(tag, cls, content) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (content != null) n.textContent = content;
    return n;
  }
  function svgEl(tag, attrs, parent) {
    var n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  // Rows from the history with a mean wind: [time ms, dir, speed, gust, min], oldest first.
  function chartRows(item) {
    return item.history.filter(function (r) { return isNum(r[2]); })
      .map(function (r) { return [Date.parse(r[0]), r[1], r[2], isNum(r[3]) ? r[3] : null, isNum(r[4]) ? r[4] : null]; });
  }

  // The scale of the chart: 0 up to a round number above the highest gust, with 2, 5 or 10 m/s between the lines.
  function scale(max) {
    var step = max <= 8 ? 2 : max <= 20 ? 5 : 10;
    return { top: Math.max(4, Math.ceil(max / step) * step), step: step };
  }

  // The launch directions of a flying site ({ primary, possible }), from the page: the site page has its own (site-data), the
  // home page all sites (sites-data). Null for a station that is not on a flying site.
  var siteDirs = null;
  function launchDirs(siteId) {
    var FS = globalThis.FlyingSites;
    if (!siteId || !FS || !FS.readJson) return null;
    if (!siteDirs) {
      siteDirs = {};
      (FS.readJson("sites-data") || []).forEach(function (s) { siteDirs[s.id] = { primary: s.primary, possible: s.possible }; });
      var one = FS.readJson("site-data"), page = document.getElementById("station-now");
      if (one && one.wind_directions && page) siteDirs[page.getAttribute("data-site")] = one.wind_directions;
    }
    return siteDirs[siteId] || null;
  }

  // «startretning», «mulig retning» or «utenfor startretningene»: where the measured wind is on the site's wind rose.
  function launchText(dir, dirs) {
    if (!isNum(dir) || !dirs) return "";
    return text("stations.launch_" + globalThis.FlyingSites.directionType({ primary: dirs.primary || [], possible: dirs.possible || [] }, W().directionCode(dir)));
  }

  // The wind rose, as on the site page: the site's launch directions in the sectors (all blank for a station that is not
  // on a flying site), with the measured wind as an arrow across it in the direction the wind blows.
  function compass(dir, dirs) {
    var FS = globalThis.FlyingSites, L = FS.DIRECTION_LABELS;
    var svg = svgEl("svg", { class: "rose station-compass", viewBox: "-14 -14 188 188", "aria-hidden": "true" });
    FS.DIRECTIONS.forEach(function (code, i) {
      var type = dirs ? FS.directionType({ primary: dirs.primary || [], possible: dirs.possible || [] }, code) : "none";
      svgEl("path", { d: FS.ROSE_PATHS[i], class: "sector sector--" + type }, svg);
    });
    [["N", 80, 0], ["E", 166, 80], ["S", 80, 160], ["W", -6, 80]].forEach(function (p) {
      svgEl("text", { class: "station-compass__label", x: p[1], y: p[2] }, svg).textContent = L[p[0]];
    });
    if (isNum(dir)) {
      var g = svgEl("g", { transform: "rotate(" + Math.round(dir) + " 80 80)" }, svg);
      // The arrow twice: wide in the card colour under it, so it stands out on both blank and filled sectors.
      ["station-compass__halo", "station-compass__arrow"].forEach(function (cls) {
        var a = svgEl("g", { class: cls }, g);
        svgEl("line", { x1: 80, y1: 26, x2: 80, y2: 112 }, a);
        svgEl("path", { d: "M80 140l-16-28h32z" }, a);
      });
    } else {
      svgEl("circle", { cx: 80, cy: 80, r: 9, class: "rose__center" }, svg);
    }
    return svg;
  }

  // The wind now: the compass and the numbers as measured, «4,4 m/s» large, then «kast 7,2 · min 2» and «SV 225°».
  function windNow(item) {
    var w = item.wind || {};
    var box = make("div", "station-now__wind");
    var dirs = launchDirs(item.site);
    box.appendChild(compass(w.dir, dirs));
    var nums = make("div", "station-now__nums");
    nums.appendChild(make("strong", "station-now__speed", text("stations.speed", { speed: value(w.speed) })));
    var more = [];
    if (isNum(w.gust)) more.push(text("stations.gustValue", { gust: value(w.gust) }));
    if (isNum(w.min)) more.push(text("stations.minValue", { min: value(w.min) }));
    if (more.length) nums.appendChild(make("span", "station-now__more", more.join(" · ")));
    if (isNum(w.dir)) {
      var where = launchText(w.dir, dirs);
      nums.appendChild(make("span", "station-now__dir", text("stations.from", { dir: dirText(w.dir) }) + (where ? " · " + where : "")));
    }
    box.appendChild(nums);
    return box;
  }

  // One measurement in words, for the tooltip and for screen readers: «kl. 14.05: SV 225°, 4,4 m/s, kast 7,2, min 2».
  function rowText(r) {
    var wind = windText({ wind: { dir: r[1], speed: r[2], gust: r[3] } });
    return text("stations.at", { time: W().formatClock(r[0]) }) + ": " + wind + (isNum(r[4]) ? text("stations.min", { min: value(r[4]) }) : "");
  }

  // The last hours as a chart: the span from the lowest wind to the gusts as a light band, the mean wind as a line on it,
  // where the wind came from as arrows along the top, and the hours along the bottom. Pointer and arrow keys show each
  // measurement with its numbers. Gaps of more than 20 minutes without measurements are left open.
  function chart(item) {
    var rows = chartRows(item);
    if (rows.length < 2) return null;
    var Wd = 320, H = 150, left = 26, right = 8, top = 22, bottom = 20;
    var t1 = rows[rows.length - 1][0], t0 = Math.min(rows[0][0], t1 - 3600000);
    var high = Math.max.apply(null, rows.map(function (r) { return isNum(r[3]) ? r[3] : r[2]; }));
    var sc = scale(high);
    var x = function (t) { return left + (t - t0) / Math.max(1, t1 - t0) * (Wd - left - right); };
    var y = function (v) { return H - bottom - v / sc.top * (H - top - bottom); };
    var f = function (n) { return n.toFixed(1); };

    var svg = svgEl("svg", { class: "station-graph__svg", viewBox: "0 0 " + Wd + " " + H, tabindex: "0", role: "img" });
    // The lines of the scale, with m/s at the left.
    for (var v = 0; v <= sc.top; v += sc.step) {
      svgEl("line", { class: v ? "station-graph__grid" : "station-graph__base", x1: left, x2: Wd - right, y1: f(y(v)), y2: f(y(v)) }, svg);
      svgEl("text", { class: "station-graph__ylabel", x: left - 5, y: f(y(v) + 4) }, svg).textContent = String(v);
    }
    // Whole hours along the bottom (the hour in Oslo; whole hours are the same in UTC).
    for (var h = Math.ceil(t0 / 3600000) * 3600000; h <= t1; h += 3600000) {
      if (x(h) - left < 8) continue;
      svgEl("line", { class: "station-graph__tick", x1: f(x(h)), x2: f(x(h)), y1: H - bottom, y2: H - bottom + 4 }, svg);
      var hour = W().osloParts(h).hour;
      svgEl("text", { class: "station-graph__xlabel", x: f(x(h)), y: H - 4 }, svg).textContent = (hour < 10 ? "0" : "") + hour;
    }
    // Runs of measurements without long gaps.
    var runs = [[rows[0]]];
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] - rows[i - 1][0] > 20 * 60000) runs.push([]);
      runs[runs.length - 1].push(rows[i]);
    }
    runs.forEach(function (run) {
      var upper = run.map(function (r) { return f(x(r[0])) + "," + f(y(isNum(r[3]) ? r[3] : r[2])); });
      var lower = run.slice().reverse().map(function (r) { return f(x(r[0])) + "," + f(y(isNum(r[4]) ? r[4] : r[2])); });
      if (run.length > 1) svgEl("polygon", { class: "station-graph__band", points: upper.concat(lower).join(" ") }, svg);
      svgEl(run.length > 1 ? "polyline" : "circle", run.length > 1
        ? { class: "station-graph__mean", points: run.map(function (r) { return f(x(r[0])) + "," + f(y(r[2])); }).join(" ") }
        : { class: "station-graph__dot", cx: f(x(run[0][0])), cy: f(y(run[0][2])), r: 2 }, svg);
    });
    // Where the wind came from, one arrow per half hour (the measurement nearest the middle of it).
    for (var a = t0; a < t1; a += 1800000) {
      var mid = Math.min(a + 900000, t1), best = null;
      rows.forEach(function (r) { if (isNum(r[1]) && r[0] >= a && r[0] < a + 1800000 && (!best || Math.abs(r[0] - mid) < Math.abs(best[0] - mid))) best = r; });
      if (best) svgEl("path", { class: "station-graph__arrow", d: "M0 -6l4 9-4-2.5-4 2.5z",
        transform: "translate(" + f(x(best[0])) + " 10) rotate(" + Math.round(best[1] + 180) + ")" }, svg);
    }
    // The measurement shown by pointer or keys.
    var cross = svgEl("line", { class: "station-graph__cross", y1: top - 4, y2: H - bottom, visibility: "hidden" }, svg);
    var dot = svgEl("circle", { class: "station-graph__focus", r: 4, visibility: "hidden" }, svg);

    var means = rows.map(function (r) { return r[2]; });
    var hours = Math.max(1, Math.round((t1 - t0) / 3600000));
    svg.setAttribute("aria-label", text("stations.chartLabel", { hours: hours, lo: value(Math.min.apply(null, means)),
      hi: value(Math.max.apply(null, means)), gust: value(high) }) + " " + text("stations.chartKeys"));

    var wrap = make("figure", "station-graph");
    var tip = make("p", "station-graph__tip");
    tip.setAttribute("aria-live", "polite");
    tip.hidden = true;
    var legend = make("figcaption", "station-graph__legend");
    legend.append(make("span", "station-graph__key station-graph__key--mean", text("stations.legendMean")),
      make("span", "station-graph__key station-graph__key--band", text("stations.legendBand")));
    wrap.append(svg, tip, legend);

    var index = -1;
    function show(n) {
      index = Math.max(0, Math.min(rows.length - 1, n));
      var r = rows[index], cx = f(x(r[0]));
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx);
      dot.setAttribute("cx", cx); dot.setAttribute("cy", f(y(r[2])));
      cross.setAttribute("visibility", "visible"); dot.setAttribute("visibility", "visible");
      tip.textContent = rowText(r);
      tip.hidden = false;
      var share = x(r[0]) / Wd;
      tip.style.left = (share * 100).toFixed(1) + "%";
      tip.style.transform = "translateX(-" + Math.round(Math.min(100, Math.max(0, (share - 0.15) / 0.7 * 100))) + "%)";
    }
    function hide() {
      index = -1;
      cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden");
      tip.hidden = true;
    }
    function nearest(clientX) {
      var box = svg.getBoundingClientRect(), t = t0 + ((clientX - box.left) / box.width * Wd - left) / (Wd - left - right) * (t1 - t0), best = 0;
      rows.forEach(function (r, n) { if (Math.abs(r[0] - t) < Math.abs(rows[best][0] - t)) best = n; });
      return best;
    }
    svg.addEventListener("pointermove", function (e) { show(nearest(e.clientX)); });
    svg.addEventListener("pointerdown", function (e) { show(nearest(e.clientX)); });
    svg.addEventListener("pointerleave", function () { if (document.activeElement !== svg) hide(); });
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", function (e) {
      var step = { ArrowLeft: -1, ArrowRight: 1, PageUp: -12, PageDown: 12 }[e.key];
      if (e.key === "Home") show(0);
      else if (e.key === "End") show(rows.length - 1);
      else if (e.key === "Escape") hide();
      else if (step) show(index < 0 ? rows.length - 1 : index + step);
      else return;
      e.preventDefault();
    });
    return wrap;
  }

  // Where the measurement comes from: «Kilde: Holfuy, stasjon 490», with the source as a link to the station there.
  function sourceLine(item) {
    var p = make("p", "station__source", text("stations.source", { source: "" }).trim() + " ");
    var a = stationLink(item);
    a.firstChild.textContent = item.source || "Holfuy";
    p.append(a, document.createTextNode(text("stations.stationId", { id: String(item.id) })));
    return p;
  }

  // A station as a card: the name (to Holfuy) and how old the measurement is, the wind now with the compass, the rest,
  // and the chart of the last hours. An old measurement shows only its age and the chart. As li in the Vær tab, as div
  // on the site page (with «Målt nå på» before the name), as div in the map's popup (without the chart on small maps).
  function card(item, nowMs, tag, sitePage, noChart) {
    var old = isOld(item, nowMs);
    var el = make(tag, "station" + (old ? " station--old" : ""));
    var head = make("div", "station__head");
    var name = make("span", "station__title");
    if (sitePage) name.appendChild(document.createTextNode(text("stations.siteNow", { name: "" }).trim() + " "));
    name.appendChild(stationLink(item, "station__name"));
    head.append(name, make("span", "station__age", ageText(item, nowMs)));
    el.appendChild(head);
    if (!old && item.wind && isNum(item.wind.speed)) el.appendChild(windNow(item));
    var other = otherText(item);
    if (other && !old) el.appendChild(make("span", "station__other", other));
    var graph = !noChart && chart(item);
    if (graph) el.appendChild(graph);
    el.appendChild(sourceLine(item));
    return el;
  }
  function listItem(item, nowMs) { return card(item, nowMs, "li", false); }

  // Fetches the stations now and every minute while the page is in view, and calls done(data) with each new answer in
  // the right shape. On errors nothing happens, and the page keeps what it has.
  function watch(url, done) {
    if (!url || typeof fetch !== "function") return;
    var last = null;
    function load() {
      if (document.hidden) return;
      fetch(url, { credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!isStationsData(d) || d.fetched === last) return;
          last = d.fetched;
          // Each station carries the source of the data set, for the card's source line.
          d.items.forEach(function (i) { if (typeof i.source !== "string") i.source = typeof d.source === "string" ? d.source : ""; });
          done(d);
        })
        .catch(function () {});
    }
    load();
    setInterval(load, REFRESH_MS);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
  }

  // The site page: the station on this flying site (item.site), as a line in «Kan jeg fly her nå?» with the station's name
  // as a link to Holfuy, and the Holfuy button among the weather links. Nothing when the site has no station.
  var siteEl = typeof document !== "undefined" && document.getElementById("station-now");
  if (siteEl) {
    var linkEl = document.getElementById("station-link");
    watch(siteEl.getAttribute("data-url"), function (data) {
      var now = Date.now(), site = siteEl.getAttribute("data-site");
      var item = data.items.filter(function (i) { return i.site === site; })[0];
      siteEl.hidden = !item;
      if (linkEl) linkEl.hidden = !item;
      if (!item) return;
      if (linkEl) linkEl.href = holfuyUrl(item);
      siteEl.replaceChildren(card(item, now, "div", true));
    });
  }

  globalThis.FlyingSitesStations = {
    OLD_MINUTES: OLD_MINUTES,
    isStationsData: isStationsData,
    ageMinutes: ageMinutes,
    isOld: isOld,
    windText: windText,
    ageText: ageText,
    otherText: otherText,
    holfuyUrl: holfuyUrl,
    stationLink: stationLink,
    value: value,
    dirText: dirText,
    scale: scale,
    compass: compass,
    launchText: launchText,
    listItem: listItem,
    card: card,
    chart: chart,
    make: make,
    watch: watch,
    useText: useText,
  };
})();
