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
  // The trend line on the cards (the site page, the home page) is over this many minutes; the weather page lets you choose.
  var TREND_MINUTES = 30;
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
        okNum(i.temperature) && ["humidity", "pressure", "rain", "altitude"].every(function (k) { return i[k] === undefined || okNum(i[k]); }) && okNum(i.lat) && okNum(i.lon) &&
        Array.isArray(i.history) && i.history.every(function (r) {
          return Array.isArray(r) && typeof r[0] === "string" && okNum(r[1]) && okNum(r[2]) && okNum(r[3]) && (r[4] === undefined || okNum(r[4])) && (r[5] === undefined || okNum(r[5]));
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

  // «460 moh», the station's height above sea level from the source, or "" when it does not send it.
  function altitudeText(item) { return isNum(item.altitude) ? text("stations.masl", { m: Math.round(item.altitude) }) : ""; }

  // The lowest and highest temperature in the history (the last hours), { min, max, hours }, or null when the station does
  // not send temperature (rows without a sixth value, from before the data service kept it).
  function temperatureRange(item) {
    var rows = item.history.filter(function (r) { return isNum(r[5]); });
    if (rows.length < 2) return null;
    var temps = rows.map(function (r) { return r[5]; });
    return { min: Math.min.apply(null, temps), max: Math.max.apply(null, temps),
      hours: Math.max(1, Math.round((Date.parse(rows[rows.length - 1][0]) - Date.parse(rows[0][0])) / 3600000)) };
  }

  // «Siste 6 t: laveste 4,1 °C, høyeste 7 °C».
  function temperatureText(item) {
    var r = temperatureRange(item);
    return r ? text("stations.tempRange", { hours: r.hours, min: value(r.min), max: value(r.max) }) : "";
  }

  function holfuyUrl(item) { return "https://holfuy.com/en/weather/" + encodeURIComponent(String(item.id)); }

  // --- Change over a period (the weather page) ---
  // How the wind has changed over the last `minutes`: the latest measurement against the one closest to that long before,
  // and over the measurements in between the highest gust and how far the gusts lie above the mean wind on average.
  // { speed, gust, dir (degrees, the shortest way, + clockwise), spread, maxGust, minutes } with null for what is missing,
  // or null without two measurements in the period.
  function change(item, minutes) {
    var rows = chartRows(item);
    if (rows.length < 2) return null;
    var last = rows[rows.length - 1], from = last[0] - minutes * 60000;
    var part = rows.filter(function (r) { return r[0] >= from - 2 * 60000; });
    if (part.length < 2) return null;
    var first = part[0];
    var diff = function (a, b) { return isNum(a) && isNum(b) ? Math.round((a - b) * 10) / 10 : null; };
    var turn = isNum(last[1]) && isNum(first[1]) ? ((last[1] - first[1] + 540) % 360) - 180 : null;
    var withGust = part.filter(function (r) { return isNum(r[3]); });
    return {
      minutes: minutes,
      speed: diff(last[2], first[2]),
      gust: diff(last[3], first[3]),
      dir: turn === null ? null : Math.round(turn),
      spread: withGust.length ? Math.round(withGust.reduce(function (t, r) { return t + r[3] - r[2]; }, 0) / withGust.length * 10) / 10 : null,
      maxGust: withGust.length ? Math.max.apply(null, withGust.map(function (r) { return r[3]; })) : null,
    };
  }

  // «▲ +0,8», «▼ −0,4» or «● 0»: a change with an arrow and a sign, so it is not told by colour alone.
  function signed(v) {
    if (!isNum(v)) return "";
    if (v === 0) return "● 0";
    return (v > 0 ? "▲ +" : "▼ −") + value(Math.abs(v));
  }

  // How even the wind is, from how far the gusts lie above the mean wind on average: "steady" below 2.5 m/s, "gusty"
  // below 4, else "turbulent". And whether the mean wind rises or falls: "stable" within ±0.5 m/s.
  function character(ch) {
    if (!ch || !isNum(ch.spread)) return null;
    return {
      kind: ch.spread < 2.5 ? "steady" : ch.spread < 4 ? "gusty" : "turbulent",
      trend: !isNum(ch.speed) || Math.abs(ch.speed) < 0.5 ? "stable" : ch.speed > 0 ? "rising" : "falling",
    };
  }

  // The forecast for a flying site from the hour now: { now: { dir, speed, gust }, next: [{ time, dir, speed, gust }] } for
  // `hours` hours after this one, or null without a forecast for the site.
  function forecastFrom(forecast, siteId, now, hours) {
    var Wn = W();
    if (!forecast || !siteId || !forecast.sites || !forecast.sites[siteId] || !Wn) return null;
    var i = Wn.slotIndex(forecast.times, "0", now);
    if (i < 0) return null;
    var at = function (k) { var w = Wn.windAt(forecast, siteId, k); return w ? { time: Date.parse(forecast.times[k]), dir: w.dir, speed: w.speed, gust: w.gust } : null; };
    var next = [];
    for (var k = i + 1; k < forecast.times.length && next.length < hours; k++) { var w = at(k); if (w) next.push(w); }
    return { now: at(i), next: next };
  }

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

  // Rows from the history with a mean wind: [time ms, dir, speed, gust, min, temperature], oldest first.
  function chartRows(item) {
    return item.history.filter(function (r) { return isNum(r[2]); })
      .map(function (r) { return [Date.parse(r[0]), r[1], r[2], isNum(r[3]) ? r[3] : null, isNum(r[4]) ? r[4] : null, isNum(r[5]) ? r[5] : null]; });
  }

  // The scale of the chart: 0 up to a round number above the highest gust, with 2, 5 or 10 m/s between the lines.
  function scale(max) {
    var step = max <= 8 ? 2 : max <= 20 ? 5 : 10;
    return { top: Math.max(4, Math.ceil(max / step) * step), step: step };
  }

  // The flying site of a station, from the page: its launch directions (primary, possible) and the position of the launch
  // (lat, lon), and its name and address where the page has them. The site page has its own site (site-data), the home page
  // and the weather page all sites (sites-data). Null for a station
  // that is not on a flying site, or a site the page does not know.
  var sites = null;
  function siteInfo(siteId) {
    var FS = globalThis.FlyingSites;
    if (!siteId || !FS || !FS.readJson) return null;
    if (!sites) {
      sites = {};
      (FS.readJson("sites-data") || []).forEach(function (s) { sites[s.id] = { primary: s.primary, possible: s.possible, lat: s.lat, lon: s.lon, name: s.name, url: s.url, maxWind: s.maxWind == null ? null : s.maxWind }; });
      var one = FS.readJson("site-data"), page = document.getElementById("station-now");
      if (one && page) {
        var dirs = one.wind_directions || {}, launch = one.launch || {};
        sites[page.getAttribute("data-site")] = { primary: dirs.primary, possible: dirs.possible, lat: launch.lat, lon: launch.lon };
      }
    }
    return sites[siteId] || null;
  }
  var launchDirs = siteInfo;

  // Where to show a station on a map: its own position from the source, else the launch of its flying site (the station
  // stands at the launch), else nowhere ([lat, lon] or null).
  function position(item) {
    if (isNum(item.lat) && isNum(item.lon)) return [item.lat, item.lon];
    var site = siteInfo(item.site);
    return site && isNum(site.lat) && isNum(site.lon) ? [site.lat, site.lon] : null;
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
        svgEl("line", { x1: 80, y1: 36, x2: 80, y2: 108 }, a);
        svgEl("path", { d: "M80 130l-11-23h22z" }, a);
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
    return text("stations.at", { time: W().formatClock(r[0]) }) + ": " + wind + (isNum(r[4]) ? text("stations.min", { min: value(r[4]) }) : "") +
      (isNum(r[5]) ? ", " + value(r[5]) + " °C" : "");
  }

  // The last hours as a chart: the span from the lowest wind to the gusts as a light band, the mean wind as a line on it,
  // where the wind came from as arrows along the top, and the hours along the bottom. Pointer and arrow keys show each
  // measurement with its numbers. Gaps of more than 20 minutes without measurements are left open.
  // fc (optional, the weather page's «Målt mot varslet»): the forecast from this hour, [{ time, speed, gust }], drawn dashed
  // after the measurements, with a line at the latest measurement. The forecast is hourly and holds from its time.
  function chart(item, periodMinutes, fc) {
    var rows = chartRows(item);
    if (rows.length < 2) return null;
    fc = (fc || []).filter(function (p) { return p && isNum(p.speed); });
    var Wd = 320, H = 150, left = 26, right = 8, top = 22, bottom = 20;
    var tLast = rows[rows.length - 1][0];
    var t0 = Math.min(rows[0][0], tLast - 3600000);
    var t1 = fc.length ? Math.max(tLast, fc[fc.length - 1].time + 3600000) : tLast;
    var high = Math.max.apply(null, rows.map(function (r) { return isNum(r[3]) ? r[3] : r[2]; })
      .concat(fc.map(function (p) { return isNum(p.gust) ? p.gust : p.speed; })));
    var sc = scale(high);
    var x = function (t) { return left + (t - t0) / Math.max(1, t1 - t0) * (Wd - left - right); };
    var y = function (v) { return H - bottom - v / sc.top * (H - top - bottom); };
    var f = function (n) { return n.toFixed(1); };

    // The temperature, when the station sends it, in its own strip below on the same time line (its own scale in °C, so
    // the chart never has two scales side by side).
    var temps = rows.filter(function (r) { return isNum(r[5]); });
    var tTop = H + 14, tH = 44, Ht = temps.length >= 2 ? tTop + tH + 6 : H;
    var svg = svgEl("svg", { class: "station-graph__svg", viewBox: "0 0 " + Wd + " " + Ht, tabindex: "0", role: "img" });
    // The period the change is counted over (the weather page), as a light area at the right.
    if (periodMinutes) {
      var p0 = Math.max(t0, tLast - periodMinutes * 60000);
      svgEl("rect", { class: "station-graph__period", x: f(x(p0)), y: top, width: f(x(tLast) - x(p0)), height: H - top - bottom }, svg);
    }
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
    if (temps.length >= 2) {
      var tv = temps.map(function (r) { return r[5]; });
      var lo = Math.floor(Math.min.apply(null, tv)), hi = Math.ceil(Math.max.apply(null, tv));
      if (hi - lo < 2) { lo -= 1; hi += 1; }
      var ty = function (v) { return tTop + tH - (v - lo) / (hi - lo) * tH; };
      svgEl("text", { class: "station-graph__ttitle", x: left, y: tTop - 4 }, svg).textContent = text("stations.tempTitle");
      [lo, hi].forEach(function (v) {
        svgEl("line", { class: "station-graph__grid", x1: left, x2: Wd - right, y1: f(ty(v)), y2: f(ty(v)) }, svg);
        svgEl("text", { class: "station-graph__ylabel", x: left - 5, y: f(ty(v) + 4) }, svg).textContent = value(v) + "°";
      });
      var truns = [[temps[0]]];
      for (var k = 1; k < temps.length; k++) {
        if (temps[k][0] - temps[k - 1][0] > 20 * 60000) truns.push([]);
        truns[truns.length - 1].push(temps[k]);
      }
      truns.forEach(function (run) {
        if (run.length > 1) svgEl("polyline", { class: "station-graph__temp", points: run.map(function (r) { return f(x(r[0])) + "," + f(ty(r[5])); }).join(" ") }, svg);
      });
    }
    // The forecast as steps (each hour holds for the hour), dashed: the mean wind and, lighter, the gusts.
    if (fc.length) {
      var steps = function (key) {
        return fc.filter(function (p) { return isNum(p[key]); }).map(function (p) {
          var a = Math.max(p.time, tLast), b = p.time + 3600000;
          return b <= a ? "" : f(x(a)) + "," + f(y(p[key])) + " " + f(x(b)) + "," + f(y(p[key]));
        }).filter(Boolean).join(" ");
      };
      svgEl("polyline", { class: "station-graph__fc-gust", points: steps("gust") }, svg);
      svgEl("polyline", { class: "station-graph__fc", points: steps("speed") }, svg);
      svgEl("line", { class: "station-graph__now", x1: f(x(tLast)), x2: f(x(tLast)), y1: top - 4, y2: H - bottom }, svg);
    }
    // Where the wind came from, one arrow per half hour (the measurement nearest the middle of it).
    for (var a = t0; a < t1; a += 1800000) {
      var mid = Math.min(a + 900000, t1), best = null;
      rows.forEach(function (r) { if (isNum(r[1]) && r[0] >= a && r[0] < a + 1800000 && (!best || Math.abs(r[0] - mid) < Math.abs(best[0] - mid))) best = r; });
      if (best) svgEl("path", { class: "station-graph__arrow", d: "M0 -6l4 9-4-2.5-4 2.5z",
        transform: "translate(" + f(x(best[0])) + " 10) rotate(" + Math.round(best[1] + 180) + ")" }, svg);
    }
    // The measurement shown by pointer or keys.
    var cross = svgEl("line", { class: "station-graph__cross", y1: top - 4, y2: Ht > H ? Ht - 6 : H - bottom, visibility: "hidden" }, svg);
    var dot = svgEl("circle", { class: "station-graph__focus", r: 4, visibility: "hidden" }, svg);

    var means = rows.map(function (r) { return r[2]; });
    var hours = Math.max(1, Math.round((tLast - t0) / 3600000));
    svg.setAttribute("aria-label", text("stations.chartLabel", { hours: hours, lo: value(Math.min.apply(null, means)),
      hi: value(Math.max.apply(null, means)), gust: value(high) }) + " " + text("stations.chartKeys"));

    var wrap = make("figure", "station-graph");
    var tip = make("p", "station-graph__tip");
    tip.setAttribute("aria-live", "polite");
    tip.hidden = true;
    var legend = make("figcaption", "station-graph__legend");
    legend.append(make("span", "station-graph__key station-graph__key--mean", text("stations.legendMean")),
      make("span", "station-graph__key station-graph__key--band", text("stations.legendBand")));
    if (temps.length >= 2) legend.appendChild(make("span", "station-graph__key station-graph__key--temp", text("stations.tempTitle")));
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
    head.append(name, make("span", "station__age", [altitudeText(item), ageText(item, nowMs)].filter(Boolean).join(" · ")));
    el.appendChild(head);
    if (!old && item.wind && isNum(item.wind.speed)) {
      el.appendChild(windNow(item));
      // The trend over the last half hour: «Siste 30 min: ▲ +0,8 · Jevn vind, øker».
      var ch = change(item, TREND_MINUTES), c = character(ch);
      if (ch && c && isNum(ch.speed)) {
        el.appendChild(make("p", "station__trend", text("stations.trendLine", {
          minutes: TREND_MINUTES, change: signed(ch.speed), character: text("stations.char_" + c.kind) + text("stations.trend_" + c.trend),
        })));
      }
    }
    var other = otherText(item);
    if (other && !old) el.appendChild(make("span", "station__other", other));
    var temps = temperatureText(item);
    if (temps && !old) el.appendChild(make("span", "station__other", temps));
    var graph = !noChart && chart(item);
    if (graph) el.appendChild(graph);
    el.appendChild(sourceLine(item));
    return el;
  }
  function listItem(item, nowMs) { return card(item, nowMs, "li", false); }

  // The stations as a map layer «Værstasjoner» (on by default): a compass dial with an arrow for where the wind blows, and
  // the mean wind and the gust as measured («4,4 (7,2)»), dimmed when the measurement is old. A tap shows the station's
  // card, with the chart when the map is tall enough for it. Used on the home map and the site page's map. onData(data, now)
  // is called with each new answer, for the page's own use (the list in the Vær tab).
  function addMapLayer(map, url, onData) {
    var L = globalThis.L, FS = globalThis.FlyingSites;
    if (!L || !url || !map.layersControl) return null;
    var layer = L.layerGroup().addTo(map);
    map.layersControl.addOverlay(layer, FS.layerLabel(map, "stations", text("stations.layer")));
    // A station placed at its site's launch (no position of its own) is drawn up and to the right of the point, so it does
    // not cover the launch's own marker.
    function icon(item, now, atLaunch) {
      var old = isOld(item, now), w = item.wind;
      var has = w && isNum(w.speed) && !old;
      // Numbers only in the HTML: the direction as a rotation, the mean wind and the gust as measured.
      var arrow = has && isNum(w.dir)
        ? '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style="transform: rotate(' + Math.round(w.dir) + 'deg)"><path d="M12 3v13" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M12 22l-5-7h10z" fill="currentColor"/></svg>'
        : "";
      var nums = has ? value(w.speed) + (isNum(w.gust) ? " <small>(" + value(w.gust) + ")</small>" : "") : "–";
      return L.divIcon({ className: "station-marker" + (old ? " station-marker--old" : ""),
        html: '<span class="station-marker__dial">' + arrow + '</span><span class="station-marker__nums">' + nums + "</span>",
        iconSize: [88, 30], iconAnchor: atLaunch ? [-14, 44] : [15, 15], popupAnchor: atLaunch ? [29, -44] : [0, -14] });
    }
    watch(url, function (data) {
      var now = Date.now();
      layer.clearLayers();
      data.items.forEach(function (item) {
        var at = position(item);
        if (!at) return;
        var box = card(item, now, "div", false, map.getSize().y < 600);
        box.classList.add("station-popup");
        L.marker(at, { icon: icon(item, now, !(isNum(item.lat) && isNum(item.lon))), keyboard: true, title: item.name, zIndexOffset: 500 })
          .bindPopup(box, { autoPanPaddingTopLeft: [60, 90], autoPanPaddingBottomRight: [20, 110] }).addTo(layer);
      });
      if (onData) onData(data, now);
    });
    return layer;
  }

  // Fetches the stations now and every minute while the page is in view, and calls done(data) with each new answer in
  // the right shape. On errors nothing happens, and the page keeps what it has.
  // One fetch loop per address, shared by everything on the page that watches it (the site page's card and its map).
  var watchers = {};
  function watch(url, done) {
    if (!url || typeof fetch !== "function") return;
    if (watchers[url]) {
      watchers[url].callbacks.push(done);
      if (watchers[url].data) done(watchers[url].data);
      return;
    }
    var w = watchers[url] = { callbacks: [done], data: null };
    function load() {
      if (document.hidden) return;
      fetch(url, { credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!isStationsData(d) || (w.data && d.fetched === w.data.fetched)) return;
          // Each station carries the source of the data set, for the card's source line.
          d.items.forEach(function (i) { if (typeof i.source !== "string") i.source = typeof d.source === "string" ? d.source : ""; });
          w.data = d;
          w.callbacks.forEach(function (fn) { fn(d); });
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
    altitudeText: altitudeText,
    temperatureRange: temperatureRange,
    temperatureText: temperatureText,
    change: change,
    signed: signed,
    character: character,
    forecastFrom: forecastFrom,
    siteInfo: siteInfo,
    sourceLine: sourceLine,
    position: position,
    addMapLayer: addMapLayer,
    launchText: launchText,
    listItem: listItem,
    card: card,
    chart: chart,
    make: make,
    watch: watch,
    useText: useText,
  };
})();
