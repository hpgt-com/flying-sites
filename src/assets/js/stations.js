// Measured wind from the weather stations, from the data service (workers/data, /v1/stations.json): on the home map as
// the layers «Klubbens værstasjoner» and «METs værstasjoner», as «Målt vind nå» in the Vær tab, and on the site page of the station's flying site.
// Refetched every minute while the page is in view. The checks and texts are plain functions, tested in
// test/stations.test.js; the drawing uses DOM methods only, so nothing from the data is read as HTML.
// Loaded after common.js and wind.js, and exposed as window.FlyingSitesStations.
(function () {
  "use strict";

  var REFRESH_MS = 60000;
  // A measurement older than this is shown as old (the station may be down), and not as the wind now. The club's Holfuy
  // stations send every minute or two; MET's stations mostly once an hour, and Frost has them some minutes after, so theirs
  // are old only after OLD_MINUTES_MET.
  var OLD_MINUTES = 30;
  var OLD_MINUTES_MET = 90;
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
  function oldMinutes(item) { return isHolfuy(item) ? OLD_MINUTES : OLD_MINUTES_MET; }
  function isOld(item, now) {
    var age = ageMinutes(item, now);
    return age === null || age > oldMinutes(item);
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
    if (age > oldMinutes(item)) return text("stations.old", { time: W().formatClock(Date.parse(item.time)) });
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

  // The station's own page at its source: the address the data service gives (url), or Holfuy's for a Holfuy station
  // from before it gave one. null when the source has no page per station (MET).
  function isHolfuy(item) { return !item.source || /holfuy/i.test(item.source); }

  // The club's stations (Holfuy, where we fly) first, then MET's (in the area, often by the sea or at an airport), each in
  // its own order: { club: [...], met: [...] }.
  function groups(items) {
    return { club: items.filter(isHolfuy), met: items.filter(function (i) { return !isHolfuy(i); }) };
  }
  function holfuyUrl(item) { return "https://holfuy.com/en/weather/" + encodeURIComponent(String(item.id)); }
  function stationUrl(item) {
    if (typeof item.url === "string" && /^https:\/\//.test(item.url)) return item.url;
    return isHolfuy(item) ? holfuyUrl(item) : null;
  }

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
  // `hours` hours after this one, and past: what the forecast said for the hours before (when the data service has them).
  // Null without a forecast for the site.
  function forecastFrom(forecast, siteId, now, hours) {
    var Wn = W();
    if (!forecast || !siteId || !forecast.sites || !forecast.sites[siteId] || !Wn) return null;
    var i = Wn.slotIndex(forecast.times, "0", now);
    if (i < 0) return null;
    var at = function (k) { var w = Wn.windAt(forecast, siteId, k); return w ? { time: Date.parse(forecast.times[k]), dir: w.dir, speed: w.speed, gust: w.gust } : null; };
    var next = [];
    for (var k = i + 1; k < forecast.times.length && next.length < hours; k++) { var w = at(k); if (w) next.push(w); }
    // The forecast as it stood during the hours before this one (the data service's past), in the same shape.
    var start = Date.parse(forecast.times[i]);
    var past = ((forecast.past && forecast.past[siteId]) || []).filter(function (r) {
      return Array.isArray(r) && typeof r[0] === "string" && Date.parse(r[0]) < start && isNum(r[2]) && okNum(r[1]) && okNum(r[3]);
    }).map(function (r) { return { time: Date.parse(r[0]), dir: r[1], speed: r[2], gust: r[3] }; });
    return { now: at(i), next: next, past: past };
  }

  // A station's latest measurement for the assessment of the hour now (wind.js rateNow), while it is at most FRESH_MINUTES
  // old: { item, wind, steady, rising }, where steady means the wind over the last half hour is neither rising nor gusty,
  // which a measurement that is better than the forecast needs to count. Null without a fresh measurement.
  var FRESH_MINUTES = 15;
  function measurement(item, now) {
    if (!item || !item.wind || !isNum(item.wind.speed) || !isNum(item.wind.dir)) return null;
    var age = ageMinutes(item, now);
    if (age === null || age > FRESH_MINUTES) return null;
    var c = character(change(item, 30));
    return {
      item: item,
      wind: { dir: item.wind.dir, speed: item.wind.speed, gust: isNum(item.wind.gust) ? item.wind.gust : null },
      steady: !!c && c.kind !== "turbulent" && c.trend !== "rising",
      rising: !!c && c.trend === "rising",
    };
  }

  // --- Rating and table rows (the weather page and the Vær tab) ---
  // The wind rules (src/_data/windRules.json), given by the page: the home page from its forecast data, the weather page
  // from its own.
  var rules = null;
  function useRules(r) { rules = r || null; }
  // The symbol in each rating chip, so the rating does not rest on colour alone (as on the home page).
  var ICONS = { ok: "✓", maybe: "?", high: "!", no: "×" };

  function hasWind(item, now) { return !isOld(item, now) && !!item.wind && isNum(item.wind.speed); }
  // The id of a station's card on the weather page, «stasjon-490».
  function anchor(item) { return "stasjon-" + String(item.id).replace(/[^\w-]/g, ""); }

  // A rough assessment of the measured wind, with the same rules as the forecast (wind.js): for a station on a flying site
  // against the site's launch directions and limits; for a station that is not, only the strength (too much wind or too
  // strong gusts), since without launch directions it cannot say that it may work. { rating, reasons } or null.
  function assess(item, now) {
    if (!rules || !hasWind(item, now)) return null;
    var w = item.wind, site = siteInfo(item.site);
    var wind = { dir: w.dir, speed: w.speed, gust: isNum(w.gust) ? w.gust : null };
    if (site) return W().rateWind({ primary: site.primary || [], possible: site.possible || [], maxWind: site.maxWind == null ? null : site.maxWind }, wind, rules);
    if (!isNum(w.dir)) return null;
    var r = W().rateWind({ primary: globalThis.FlyingSites.DIRECTIONS, possible: [], maxWind: null }, wind, rules);
    return r.rating === "high" ? r : null;
  }
  function ratingChip(r) {
    var el = make("span", "rating-chip rating-chip--" + r.rating);
    var icon = make("span", null, ICONS[r.rating]);
    icon.setAttribute("aria-hidden", "true");
    el.append(icon, document.createTextNode(W().RATINGS[r.rating].label));
    return el;
  }

  // One station as a row, a link to `href` (its card): the site's wind rose with the measured arrow, the name, the rating
  // chip, the site, the source, height and age, the direction against the launch directions, and on the right the wind (gust), the
  // change over `minutes` and how even the wind is. compact (the Vær tab, about as tall as the site cards beside it): the
  // change without the period on screen (the note under the list gives it), so the right column stays narrow.
  function row(item, now, minutes, href, compact) {
    var li = make("li");
    var a = make("a", "weather-row" + (hasWind(item, now) ? "" : " weather-row--old"));
    a.href = href;
    var site = siteInfo(item.site), w = item.wind || {};
    a.appendChild(compass(hasWind(item, now) ? w.dir : null, site));
    var rating = assess(item, now);
    if (rating) a.setAttribute("data-rating", rating.rating);
    var info = make("span", "weather-row__info");
    info.appendChild(make("strong", "weather-row__name", item.name));
    if (rating) info.appendChild(ratingChip(rating));
    // Compact: the source and height are left to the weather page, and the direction comes beside the chip (CSS).
    var sub = make("span", "weather-row__sub", (compact ? [site && site.name ? text("stations.site", { name: site.name }) : "", ageText(item, now)]
      : [site && site.name ? text("stations.site", { name: site.name }) : "", item.source || "", altitudeText(item), ageText(item, now)]).filter(Boolean).join(" · "));
    if (!compact) info.appendChild(sub);
    if (hasWind(item, now) && isNum(w.dir)) {
      var where = launchText(w.dir, site);
      info.appendChild(make("span", "weather-row__dir", dirText(w.dir) + (where ? " · " + where : "")));
    }
    if (compact) info.appendChild(sub);
    a.appendChild(info);
    if (hasWind(item, now)) {
      var ch = change(item, minutes), c = character(ch);
      var nums = make("span", "weather-row__nums");
      nums.appendChild(make("strong", "weather-row__wind", value(w.speed) + (isNum(w.gust) ? " (" + value(w.gust) + ")" : "")));
      if (ch && isNum(ch.speed)) {
        var full = text("stations.change", { v: signed(ch.speed), period: text("stations.period_" + minutes) });
        var changeEl = nums.appendChild(make("span", "weather-row__change", compact ? null : full));
        if (compact) {
          var shown = changeEl.appendChild(make("span", null, signed(ch.speed)));
          shown.setAttribute("aria-hidden", "true");
          changeEl.appendChild(make("span", "visually-hidden", full));
        }
      }
      if (c) nums.appendChild(make("span", "weather-row__char", text("stations.char_" + c.kind) + text("stations.trend_" + c.trend)));
      a.appendChild(nums);
    }
    li.appendChild(a);
    return li;
  }

  // How far (km) a station is from the nearest launch the page knows (sites-data), for the order of MET's table; Infinity
  // when unknown, so those come last.
  function nearestKm(item, list) {
    if (!isNum(item.lat) || !isNum(item.lon)) return Infinity;
    return list.reduce(function (best, s) {
      if (!isNum(s.lat) || !isNum(s.lon)) return best;
      var d = Math.hypot((s.lat - item.lat) * 111.32, (s.lon - item.lon) * 111.32 * Math.cos(item.lat * Math.PI / 180));
      return Math.min(best, d);
    }, Infinity);
  }

  // MET's stations as a small folded table under the club's (the Vær tab, the weather page): there are many, and they say
  // little about the wind at the launches, so they get no cards. One row per station: name and height, the wind (gust), the
  // direction and when it was measured. open: whether it was open before the page was redrawn. Null without MET stations.
  function metTable(items, now, open) {
    var FS = globalThis.FlyingSites, launches = FS && FS.readJson ? FS.readJson("sites-data") || [] : [];
    var met = groups(items).met.map(function (i) { return { item: i, km: nearestKm(i, launches) }; })
      .sort(function (a, b) { return a.km - b.km; }).map(function (e) { return e.item; });
    if (!met.length) return null;
    var box = make("details", "met-stations");
    box.open = !!open;
    box.appendChild(make("summary", null, text("stations.metTitle") + " (" + met.length + ")"));
    box.appendChild(make("p", "met-stations__note", text("stations.metNote")));
    var table = box.appendChild(make("table", "met-stations__table"));
    var head = table.appendChild(make("thead")).appendChild(make("tr"));
    ["metStation", "metWind", "metDir", "metTime"].forEach(function (k) { head.appendChild(make("th", null, text("stations." + k))).scope = "col"; });
    var body = table.appendChild(make("tbody"));
    met.forEach(function (item) {
      var tr = body.appendChild(make("tr", hasWind(item, now) ? null : "met-stations__old"));
      var name = tr.appendChild(make("th", null, item.name));
      name.scope = "row";
      var alt = altitudeText(item);
      if (alt) name.appendChild(make("small", null, alt));
      var w = item.wind || {};
      tr.appendChild(make("td", "met-stations__num", hasWind(item, now) ? value(w.speed) + (isNum(w.gust) ? " (" + value(w.gust) + ")" : "") : "–"));
      tr.appendChild(make("td", null, hasWind(item, now) ? dirText(w.dir) : ""));
      tr.appendChild(make("td", null, item.time ? W().formatClock(Date.parse(item.time)) : ""));
    });
    return box;
  }

  // The station's name as a link to its page at the source, in a new tab, which screen readers are told (as the external()
  // macro does); just the name when the source has no such page.
  function stationLink(item, cls) {
    var url = stationUrl(item);
    if (!url) return make("span", cls, item.name);
    var a = make("a", cls, item.name);
    a.href = url;
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
  // fc (optional, the weather page's «Målt mot varslet»): the forecast, [{ time, speed, gust }], drawn dashed, with a line at
  // the latest measurement; hours before it are what the forecast said then. The forecast is hourly and holds from its time.
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
    // The forecast as steps (each hour holds for the hour), dashed: the mean wind and, lighter, the gusts. Hours before the
    // latest measurement (what the forecast said then) lie over the measurements, for comparison.
    if (fc.length) {
      var steps = function (key) {
        return fc.filter(function (p) { return isNum(p[key]); }).map(function (p) {
          var a = Math.max(p.time, t0), b = p.time + 3600000;
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

  // Where the measurement comes from: «Kilde: Holfuy, stasjon 490» or «Kilde: MET Norge, stasjon SN84970», with the source
  // as a link to the station there when it has a page.
  function sourceLine(item) {
    var p = make("p", "station__source", text("stations.source", { source: "" }).trim() + " ");
    var a = stationLink(item);
    a.firstChild.textContent = item.source || "Holfuy";
    p.append(a, document.createTextNode(text("stations.stationId", { id: String(item.id) })));
    return p;
  }

  // A station as a card: the name (to Holfuy) and how old the measurement is, the wind now with the compass, the rest,
  // and the chart of the last hours. An old measurement shows only its age and the chart. On the site page (with «Målt nå
  // på» before the name), and in the map's popup (without the chart on small maps).
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

  // The stations as a map layer «Værstasjoner» (on by default): a compass dial with an arrow for where the wind blows, and
  // the mean wind and the gust as measured («4,4 (7,2)»), dimmed when the measurement is old. A tap shows the station's
  // card, with the chart when the map is tall enough for it. Used on the home map and the site page's map. onData(data, now)
  // is called with each new answer, for the page's own use (the list in the Vær tab).
  // The stations on a map: the club's and MET's in their own layers, as small round markers with the mean wind (or the
  // temperature, chosen with «Vind | Temp» on the map) and a notch on the edge pointing where the wind blows. Zoomed out,
  // markers that would overlap are thinned: the club's always stay, then MET's with the strongest wind (thin()). Zoomed
  // in (LABEL_ZOOM), a label beside each shows the wind and gust as measured, or the temperature.
  var THIN_ZOOM = 12, LABEL_ZOOM = 11, THIN_PX = 34, MODE_KEY = "fs-station-mode";
  function readMode() { try { return localStorage.getItem(MODE_KEY) === "temp" ? "temp" : "wind"; } catch (e) { return "wind"; } }
  function saveMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* private window: not remembered */ } }

  // The marker's HTML, from numbers only. mode: "wind" or "temp".
  function markerHtml(item, now, mode) {
    var old = isOld(item, now), w = item.wind || {};
    var hasW = !old && isNum(w.speed), hasT = !old && isNum(item.temperature);
    var tag = isHolfuy(item) ? "" : '<span class="station-marker__tag">MET</span>';
    if (mode === "temp") {
      return '<span class="station-marker__dial">' + (hasT ? Math.round(item.temperature) + "°" : "–") + "</span>" +
        '<span class="station-marker__label">' + tag + (hasT ? value(item.temperature) + " °C" : "–") + "</span>";
    }
    // The notch: the whole marker turned by the direction, with the notch at the bottom (where a wind from north blows).
    var notch = hasW && isNum(w.dir) ? '<span class="station-marker__notch" style="transform: rotate(' + Math.round(w.dir) + 'deg)"></span>' : "";
    return notch + '<span class="station-marker__dial">' + (hasW ? Math.round(w.speed) : "–") + "</span>" +
      '<span class="station-marker__label">' + tag + (hasW ? value(w.speed) + (isNum(w.gust) ? " <small>(" + value(w.gust) + ")</small>" : "") : "–") + "</span>";
  }
  function markerClass(item, now, mode) {
    var cold = mode === "temp" && !isOld(item, now) && isNum(item.temperature) && item.temperature <= 0;
    return "station-marker" + (isHolfuy(item) ? "" : " station-marker--met") + (isOld(item, now) ? " station-marker--old" : "") +
      (mode === "temp" ? " station-marker--temp" : "") + (cold ? " station-marker--cold" : "");
  }
  // Which markers to show at this zoom: all from THIN_ZOOM; below, greedily from the most important, leaving out those
  // within THIN_PX of one already shown. entries: [{ item, latlng }]; project: latlng → point. Returns a Set of entries.
  function thinned(entries, zoom, project) {
    var keep = new Set();
    if (zoom >= THIN_ZOOM) { entries.forEach(function (e) { keep.add(e); }); return keep; }
    var speed = function (e) { return e.item.wind && isNum(e.item.wind.speed) ? e.item.wind.speed : -1; };
    var order = entries.slice().sort(function (a, b) {
      return (isHolfuy(b.item) - isHolfuy(a.item)) || speed(b) - speed(a);
    });
    var shown = [];
    order.forEach(function (e) {
      var p = project(e.latlng);
      if (isHolfuy(e.item) || shown.every(function (q) { return Math.abs(q.x - p.x) > THIN_PX || Math.abs(q.y - p.y) > THIN_PX; })) {
        keep.add(e);
        shown.push(p);
      }
    });
    return keep;
  }

  function addMapLayer(map, url, onData) {
    var L = globalThis.L, FS = globalThis.FlyingSites;
    if (!L || !url || !map.layersControl) return null;
    // Two layers, so MET's stations (in the area, mostly hourly) can be turned off and are not mistaken for the club's.
    // MET's layer is added when the first MET station comes.
    var layer = L.layerGroup().addTo(map), metLayer = null;
    map.layersControl.addOverlay(layer, FS.layerLabel(map, "stations", text("stations.layer")));
    function metGroup() {
      if (!metLayer) {
        metLayer = L.layerGroup().addTo(map);
        map.layersControl.addOverlay(metLayer, FS.layerLabel(map, "stations-met", text("stations.layerMet")));
      }
      return metLayer;
    }
    var mode = readMode(), entries = [], lastNow = Date.now();
    // A station placed at its site's launch (no position of its own) is drawn up and to the right of the point, so it does
    // not cover the launch's own marker.
    function icon(item, now, atLaunch) {
      var met = !isHolfuy(item), size = met ? 26 : 30;
      return L.divIcon({ className: markerClass(item, now, mode), html: markerHtml(item, now, mode),
        iconSize: [size, size], iconAnchor: atLaunch ? [-12, size + 12] : [size / 2, size / 2], popupAnchor: atLaunch ? [12 + size / 2, -size - 12] : [0, -size / 2] });
    }
    function thin() {
      var keep = thinned(entries, map.getZoom(), function (ll) { return map.latLngToLayerPoint(ll); });
      entries.forEach(function (e) {
        var group = isHolfuy(e.item) ? layer : metGroup();
        if (keep.has(e)) { if (!group.hasLayer(e.marker)) group.addLayer(e.marker); }
        else if (group.hasLayer(e.marker)) group.removeLayer(e.marker);
      });
    }
    function labels() { map.getContainer().classList.toggle("map--station-labels", map.getZoom() >= LABEL_ZOOM); }
    map.on("zoomend", function () { thin(); labels(); });
    labels();

    // «Vind | Temp»: what the markers show. Added with the first data, remembered in this browser.
    var modeControl = null;
    function addModeControl() {
      var Ctl = L.Control.extend({ options: { position: "topright" }, onAdd: function () {
        var box = L.DomUtil.create("div", "leaflet-bar station-mode");
        box.setAttribute("role", "group");
        box.setAttribute("aria-label", text("stations.modeLabel"));
        ["wind", "temp"].forEach(function (m) {
          var b = L.DomUtil.create("button", "station-mode__btn", box);
          b.type = "button";
          b.textContent = text("stations.mode_" + m);
          b.setAttribute("aria-pressed", String(mode === m));
          b.addEventListener("click", function () {
            mode = m;
            saveMode(m);
            box.querySelectorAll("button").forEach(function (x, k) { x.setAttribute("aria-pressed", String(["wind", "temp"][k] === m)); });
            entries.forEach(function (e) { e.marker.setIcon(icon(e.item, lastNow, e.atLaunch)); });
          });
        });
        L.DomEvent.disableClickPropagation(box);
        return box;
      } });
      modeControl = new Ctl().addTo(map);
    }

    watch(url, function (data) {
      var now = Date.now();
      lastNow = now;
      layer.clearLayers();
      if (metLayer) metLayer.clearLayers();
      entries = [];
      data.items.forEach(function (item) {
        var at = position(item);
        if (!at) return;
        var box = card(item, now, "div", false, map.getSize().y < 600);
        box.classList.add("station-popup");
        var atLaunch = !(isNum(item.lat) && isNum(item.lon));
        // MET's stations under everything else (the launches, the club's stations), so they never cover them.
        var marker = L.marker(at, { icon: icon(item, now, atLaunch), keyboard: true, title: item.name, zIndexOffset: isHolfuy(item) ? 500 : -1000 })
          .bindPopup(box, { autoPanPaddingTopLeft: [60, 90], autoPanPaddingBottomRight: [20, 110] });
        entries.push({ item: item, latlng: L.latLng(at), marker: marker, atLaunch: atLaunch });
      });
      thin();
      if (!modeControl && entries.length) addModeControl();
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
      // The «Holfuy» button among the weather links, only for a Holfuy station.
      if (linkEl) linkEl.hidden = !item || !isHolfuy(item);
      if (!item) return;
      if (linkEl && isHolfuy(item)) linkEl.href = stationUrl(item);
      siteEl.replaceChildren(card(item, now, "div", true));
    });
  }

  globalThis.FlyingSitesStations = {
    OLD_MINUTES: OLD_MINUTES,
    OLD_MINUTES_MET: OLD_MINUTES_MET,
    thinned: thinned,
    markerHtml: markerHtml,
    groups: groups,
    metTable: metTable,
    isHolfuy: isHolfuy,
    isStationsData: isStationsData,
    ageMinutes: ageMinutes,
    isOld: isOld,
    windText: windText,
    ageText: ageText,
    otherText: otherText,
    holfuyUrl: holfuyUrl,
    stationUrl: stationUrl,
    stationLink: stationLink,
    value: value,
    dirText: dirText,
    scale: scale,
    compass: compass,
    measurement: measurement,
    useRules: useRules,
    hasWind: hasWind,
    anchor: anchor,
    assess: assess,
    ratingChip: ratingChip,
    row: row,
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
    card: card,
    chart: chart,
    make: make,
    watch: watch,
    useText: useText,
  };
})();
