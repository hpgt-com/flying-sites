// The home page's logic without the DOM: search, the filters, the summary of the assessments, the texts for times and
// windows, and the state in the URL hash. Used by home.js; pure, so it can be tested (test/home-logic.test.js).
// Loaded as a plain script after wind.js and exposed as window.FlyingSitesHome.
(function () {
  "use strict";

  var W = globalThis.FlyingSitesWind;
  var DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  var LEVELS = ["PP2", "PP3", "PP4", "PP5"];
  var DAY = 86400000;

  // Texts from the dictionary for the page language (FlyingSites.t in common.js); tests set them with useText.
  var text = function (key, vars) {
    var FS = globalThis.FlyingSites;
    return FS && FS.t ? FS.t(key, vars) : key;
  };
  function useText(fn) { text = fn; }
  function lang() {
    var FS = globalThis.FlyingSites;
    return (FS && FS.lang) || "nb";
  }
  var formatters = {};
  function dayFormat(style) {
    var key = lang() + style;
    return formatters[key] || (formatters[key] = new Intl.DateTimeFormat(lang() === "nb" ? "nb-NO" : "en-GB", { weekday: style, timeZone: "Europe/Oslo" }));
  }

  // --- Search by name and place ---
  // Lowercase and without accents. Æ, ø and å can be typed in all common ways without a Norwegian keyboard:
  // «kvaefjord» and «kvafjord» find Kvæfjord, «hoegfjellet» and «hogfjellet» Høgfjellet, «blaahatten» and
  // «blahatten» Blåhatten. Name and query are normalised the same way (æ, ae → a; ø, oe → o; å, aa → a),
  // so it may give an extra hit, but never lose one. Spaces and hyphens do not count. Matches anywhere
  // in the name («solli» → Sollifjellet), or in the municipality or region («kvæfjord», «lofoten»). Names
  // and places are checked separately, so a query cannot match across the join between them.
  function searchKey(s) {
    return String(s || "").toLowerCase()
      .replace(/æ/g, "a").replace(/ø/g, "o").replace(/å/g, "a")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[\s\-–]+/g, "")
      .replace(/ae/g, "a").replace(/oe/g, "o").replace(/aa/g, "a");
  }
  // The keys a site is found by: its name and its places (municipality, region).
  function searchKeys(site) {
    return [site.name].concat(site.places || []).map(searchKey);
  }
  function nameMatches(site, q) {
    var key = searchKey(q);
    return !key || site.searchKeys.some(function (k) { return k.indexOf(key) !== -1; });
  }

  // "match", "unknown", "nowind" or "no" for a site against the filters ({ directions, level, category, q }). The level
  // filter shows sites for the selected level and lower (a PP3 pilot can fly PP2 sites). Sites without a registered
  // level are not hidden, but get "unknown" and are shown separately, since most sites do not have a level yet and an
  // empty result would otherwise look like «ingen steder». With forecast suggestions on (o.suggest, «Vis bare steder
  // som kan passe»), sites rated «Passer ikke» or «For mye vind» (o.assessment) are dimmed, as when choosing a
  // direction. «Kan passe» and «Usikkert» stay. Sites without a forecast (o.windAssessed but no assessment) do not
  // disappear, but get "nowind" and are shown separately under «Mangler varsel – ikke vurdert». o.ignoreSuggest
  // looks past the suggestion switch (for the count of what the other filters give).
  function matchSite(site, filter, o) {
    o = o || {};
    if (!nameMatches(site, filter.q)) return "no";
    var suggesting = o.suggest && !o.ignoreSuggest;
    if (suggesting && o.assessment && (o.assessment.rating === "no" || o.assessment.rating === "high")) return "no";
    if (filter.directions.length && !filter.directions.some(function (d) { return site.primary.indexOf(d) !== -1 || site.possible.indexOf(d) !== -1; })) return "no";
    if (filter.category && site.categories.indexOf(filter.category) === -1) return "no";
    if (filter.level && site.level && LEVELS.indexOf(site.level) > LEVELS.indexOf(filter.level)) return "no";
    if (suggesting && o.windAssessed && !o.assessment) return "nowind";
    if (filter.level && !site.level) return "unknown";
    return "match";
  }

  // --- The summary of the assessments ---
  // The assessments of the sites in ids ({ id: assessment }) summed up: how many got each rating, why the ones that
  // did not fit did not, the most common wind direction, and the median, lowest and highest wind. total: how many
  // sites there are in all, so the summary knows the list is filtered. null without any assessment.
  function summarize(assessments, ids, total) {
    var list = ids.filter(function (id) { return assessments[id]; }).map(function (id) { return assessments[id]; });
    if (!list.length) return null;
    var dirs = {}, speeds = [], maxGust = null;
    var counts = { ok: 0, maybe: 0, high: 0, no: 0 }, highByGust = 0, highByLocal = 0, noByRain = 0;
    list.forEach(function (a) {
      var code = W.directionCode(a.wind.dir);
      dirs[code] = (dirs[code] || 0) + 1;
      speeds.push(a.wind.speed);
      if (a.wind.gust != null && (maxGust == null || a.wind.gust > maxGust)) maxGust = a.wind.gust;
      counts[a.rating]++;
      // Reason from the code (wind.js), not the text, so it works in all languages.
      if (a.rating === "high") {
        if (a.codes[0] === "gust") highByGust++;
        else if (a.codes[0] === "overSiteLimit") highByLocal++;
      }
      if (a.rating === "no" && a.codes[0] === "rain") noByRain++;
    });
    speeds.sort(function (x, y) { return x - y; });
    var mainDir = Object.keys(dirs).sort(function (x, y) { return dirs[y] - dirs[x]; })[0];
    return { counts: counts, total: list.length, missing: ids.length - list.length, filtered: ids.length < total, highByGust: highByGust, highByLocal: highByLocal, noByRain: noByRain,
      dir: mainDir, speed: speeds[Math.floor(speeds.length / 2)], minSpeed: speeds[0], maxSpeed: speeds[speeds.length - 1], gust: maxGust };
  }
  // Why no site fits: rain, gusts, wind or the direction, whichever stopped most of them.
  function noneReason(sum, rules) {
    var c = sum.counts;
    if (sum.noByRain >= c.high && sum.noByRain >= c.no - sum.noByRain) return text("summary.reasonRain");
    if (c.high >= c.no) {
      return sum.highByGust > c.high / 2
        ? text("summary.reasonGust", { limit: rules.maxGust })
        : text("summary.reasonWind", { limit: rules.maxWind });
    }
    return text("summary.reasonDirection");
  }

  // «SV 5 m/s, kast 9, regn 1,2 mm (målt)»; labels: the direction labels by code (FlyingSites.DIRECTION_LABELS).
  function windText(wind, rules, labels) {
    return labels[W.directionCode(wind.dir)] + " " + Math.round(wind.speed) + " m/s, " +
      (wind.gust != null ? text("wind.gust", { g: Math.round(wind.gust) }) : text("wind.gustUnknown")) +
      (wind.rain != null && wind.rain >= rules.rainMaybe ? ", " + text("wind.rain", { rain: W.formatRain(wind.rain) }) : "") +
      (wind.measured ? " (" + text("home.measured") + ")" : "");
  }

  // --- Times ---
  // «i dag kl. 08:47», or «16.10 kl. 23:47» for another day.
  function whenText(iso, now) {
    var ms = Date.parse(iso);
    var today = W.osloParts(now).date, day = W.osloParts(ms).date;
    return (day === today ? text("wind.today") : day.slice(8, 10) + "." + day.slice(5, 7)) + " " + text("wind.at", { time: W.formatClock(ms) });
  }
  // «kl. 17.00», «i morgen kl. 09.00» or «søn. kl. 13.00», for the forecast hour at index (home.js says «nå» itself).
  function whenLabel(forecast, index, now) {
    var ms = Date.parse(forecast.times[index]);
    var day = W.osloParts(ms).date, today = W.osloParts(now).date, time = W.formatClock(ms);
    if (day === today) return text("home.whenToday", { time: time });
    if (day === W.osloParts(now + DAY).date) return text("home.whenTomorrow", { time: time });
    return text("home.whenDay", { day: dayFormat("short").format(ms).replace(/\.$/, "") + ".", time: time });
  }
  // The day the window strips show: today, or tomorrow from 20:00 in Norway, when today's daylight is over.
  function stripDate(now) {
    var p = W.osloParts(now);
    return p.hour >= 20 ? W.osloParts(now + DAY).date : p.date;
  }
  function hourLabel(ms) { var h = W.osloParts(ms).hour; return (h < 10 ? "0" : "") + h; }
  // «08–13 kan passe» for a window ({ start, end, rating }); a window to midnight ends at «24».
  function windowText(w) {
    var end = W.osloParts(w.end).hour === 0 ? "24" : hourLabel(w.end);
    return hourLabel(w.start) + "–" + end + " " + W.RATINGS[w.rating].label.toLowerCase();
  }
  // The next window among the sites after at: the earliest start, «Kan passe» before «Usikkert» at the same hour, as
  // { site, start, rating }, or null. windowsFor(site) gives the site's windows by day (wind.js dayWindows).
  function nextWindow(sites, at, windowsFor) {
    var best = null;
    sites.forEach(function (site) {
      var days = windowsFor(site);
      if (!days) return;
      Object.keys(days).forEach(function (date) {
        days[date].forEach(function (w) {
          if (w.start <= at) return;
          if (!best || w.start < best.start || (w.start === best.start && W.RATINGS[w.rating].order < W.RATINGS[best.rating].order)) best = { site: site, start: w.start, rating: w.rating };
        });
      });
    });
    return best;
  }
  // «Neste vindu: Dale lørdag kl. 08, kan passe.», or that the forecast has none.
  function nextWindowText(best, now) {
    if (!best) return text("summary.noNextWindow");
    var p = W.osloParts(best.start);
    var day = p.date === W.osloParts(now).date ? text("home.windowsToday").toLowerCase()
      : p.date === W.osloParts(now + DAY).date ? text("home.windowsTomorrow").toLowerCase() : dayFormat("long").format(best.start);
    return text("summary.nextWindow", { site: best.site.name, day: day, hour: hourLabel(best.start), rating: W.RATINGS[best.rating].label.toLowerCase() });
  }

  // --- The state in the URL hash ---
  // «direction=W,NW&level=PP3&wind=3&forslag=1&q=solli&site=sollifjellet» for the state: filter { directions, level,
  // category, q }, windSlot («0» now, hours ahead, or «off»), windOn (a forecast that is not too old), suggest and the
  // selected site. The time is left out when it is now, the suggestion when the wind is off, so a plain view gives an
  // empty hash.
  function hashFor(state) {
    var params = new URLSearchParams();
    var filter = state.filter;
    if (filter.directions.length) params.set("direction", filter.directions.join(","));
    ["level", "category"].forEach(function (type) { if (filter[type]) params.set(type, filter[type]); });
    if (state.windOn && state.windSlot !== "0") params.set("wind", state.windSlot);
    if (state.suggest && state.windSlot !== "off") params.set("forslag", "1");
    if (filter.q.trim()) params.set("q", filter.q.trim());
    if (state.site) params.set("site", state.site);
    return params.toString();
  }
  // The hash read back: { directions (known codes only), level, category, wind, suggest, q, site }. Unknown levels,
  // categories and sites are left for the caller to check against the page.
  function parseHash(hash) {
    var params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    return {
      directions: (params.get("direction") || "").split(",").filter(function (d) { return DIRECTIONS.indexOf(d) !== -1; }),
      level: params.get("level") || "", category: params.get("category") || "",
      wind: params.get("wind") || "0", suggest: params.get("forslag") === "1",
      q: params.get("q") || "", site: params.get("site") || null,
    };
  }

  globalThis.FlyingSitesHome = {
    searchKey: searchKey, searchKeys: searchKeys, nameMatches: nameMatches, matchSite: matchSite, LEVELS: LEVELS,
    summarize: summarize, noneReason: noneReason, windText: windText,
    whenText: whenText, whenLabel: whenLabel, stripDate: stripDate, hourLabel: hourLabel, windowText: windowText,
    nextWindow: nextWindow, nextWindowText: nextWindowText, hashFor: hashFor, parseHash: parseHash, useText: useText,
  };
})();
