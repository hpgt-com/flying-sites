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
        (i.wind === null || (typeof i.wind === "object" && okNum(i.wind.dir) && okNum(i.wind.speed) && okNum(i.wind.gust))) &&
        okNum(i.temperature) && okNum(i.lat) && okNum(i.lon) &&
        Array.isArray(i.history) && i.history.every(function (r) {
          return Array.isArray(r) && typeof r[0] === "string" && okNum(r[1]) && okNum(r[2]) && okNum(r[3]);
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

  // «SV 4 m/s, kast 7», «Stille» below 0.5 m/s, or null without wind.
  function windText(item) {
    var w = item.wind;
    if (!w || !isNum(w.speed)) return null;
    if (w.speed < 0.5) return text("stations.calm");
    var dir = isNum(w.dir) ? globalThis.FlyingSites.DIRECTION_LABELS[W().directionCode(w.dir)] + " " : "";
    return dir + text("stations.speed", { speed: Math.round(w.speed) }) + (isNum(w.gust) ? text("stations.gust", { gust: Math.round(w.gust) }) : "");
  }

  // «for 3 min siden», «for 2 t siden», or «gammel måling, kl. 13.05» when it is old.
  function ageText(item, now) {
    var age = ageMinutes(item, now);
    if (age === null) return text("stations.noData");
    if (age > OLD_MINUTES) return text("stations.old", { time: W().formatClock(Date.parse(item.time)) });
    return age < 1 ? text("stations.justNow") : text("stations.minutesAgo", { n: age });
  }

  // Temperature, humidity, pressure and rain, those the station has: «6 °C · 81 % · 1012 hPa».
  function otherText(item) {
    var FS = globalThis.FlyingSites;
    var parts = [];
    if (isNum(item.temperature)) parts.push(FS.formatNumber(item.temperature, 1) + " °C");
    if (isNum(item.humidity)) parts.push(Math.round(item.humidity) + " %");
    if (isNum(item.pressure)) parts.push(Math.round(item.pressure) + " hPa");
    if (isNum(item.rain) && item.rain > 0) parts.push(FS.formatNumber(item.rain, 1) + " mm");
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

  // The last hours as a small chart: the mean wind as a line and the gusts lighter above, with the highest value.
  function sparkline(item) {
    var rows = item.history.filter(function (r) { return isNum(r[2]); });
    if (rows.length < 2) return null;
    var width = 160, height = 36, t0 = Date.parse(rows[0][0]), t1 = Date.parse(rows[rows.length - 1][0]);
    var top = Math.max(5, Math.ceil(Math.max.apply(null, rows.map(function (r) { return isNum(r[3]) ? r[3] : r[2]; }))));
    var x = function (r) { return ((Date.parse(r[0]) - t0) / Math.max(1, t1 - t0) * (width - 2) + 1).toFixed(1); };
    var y = function (v) { return (height - 2 - (v / top) * (height - 4)).toFixed(1); };
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "station-chart");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("aria-hidden", "true");
    [["station-chart__gust", 3], ["station-chart__speed", 2]].forEach(function (line) {
      var points = rows.filter(function (r) { return isNum(r[line[1]]); }).map(function (r) { return x(r) + "," + y(r[line[1]]); });
      if (points.length < 2) return;
      var p = document.createElementNS(SVG_NS, "polyline");
      p.setAttribute("class", line[0]);
      p.setAttribute("points", points.join(" "));
      svg.appendChild(p);
    });
    var wrap = make("span", "station-chart-wrap");
    wrap.append(svg, make("span", "station-chart__max", text("stations.max", { v: top })));
    return wrap;
  }

  // One station in the Vær tab: the name (to Holfuy), the wind now, how old it is, the rest, and the last hours.
  function listItem(item, now) {
    var li = make("li", "station" + (isOld(item, now) ? " station--old" : ""));
    var head = make("div", "station__head");
    head.append(stationLink(item, "station__name"), make("span", "station__age", ageText(item, now)));
    li.appendChild(head);
    var wind = windText(item);
    if (wind && !isOld(item, now)) li.appendChild(make("strong", "station__wind", wind));
    var other = otherText(item);
    if (other && !isOld(item, now)) li.appendChild(make("span", "station__other", other));
    var chart = sparkline(item);
    if (chart) li.appendChild(chart);
    return li;
  }

  // Fetches the stations now and every minute while the page is in view, and calls done(data) with each new answer in
  // the right shape. On errors nothing happens, and the page keeps what it has.
  function watch(url, done) {
    if (!url || typeof fetch !== "function") return;
    var last = null;
    function load() {
      if (document.hidden) return;
      fetch(url, { credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (isStationsData(d) && d.fetched !== last) { last = d.fetched; done(d); } })
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
      var link = stationLink(item);
      if (linkEl) linkEl.href = holfuyUrl(item);
      var wind = windText(item), other = otherText(item);
      var rest = isOld(item, now) || !wind ? ageText(item, now) : wind + (other ? " · " + other : "") + " (" + ageText(item, now) + ")";
      siteEl.replaceChildren(document.createTextNode(text("stations.siteNow", { name: "" }).trim() + " "), link, document.createTextNode(": " + rest));
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
    listItem: listItem,
    make: make,
    watch: watch,
    useText: useText,
  };
})();
