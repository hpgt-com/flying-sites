// Wind and rain assessment from the MET forecast: which time in the forecast applies, whether the forecast is too old,
// and a rough assessment per launch. Pure logic without DOM, so it can be tested (test/wind.test.js).
// Loaded as a plain script on the home page and site pages and exposed as window.FlyingSitesWind.
// The rules are in src/_data/windRules.json. The assessment never says «OK å fly».
(function () {
  "use strict";

  var DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  var HOUR = 3600000;
  var DAY = 24 * HOUR;
  var TIME_ZONE = "Europe/Oslo";

  // Texts come from the dictionary for the page language (FlyingSites.t in common.js, from src/_i18n/<lang>.json).
  // Tests set them with useText. Without a dictionary, the key is returned.
  var text = function (key, vars) {
    var FS = globalThis.FlyingSites;
    return FS && FS.t ? FS.t(key, vars) : key;
  };
  function useText(fn) { text = fn; }
  function meta() {
    var FS = globalThis.FlyingSites;
    return (FS && FS.meta) || { decimal: ",", clockSep: "." };
  }

  function rating(code, order) {
    return { order: order, get label() { return text("ratings." + code); } };
  }
  var RATINGS = { ok: rating("ok", 0), maybe: rating("maybe", 1), high: rating("high", 2), no: rating("no", 3) };

  // --- Time ---
  // The sites are in Norway, so «tomorrow at 12» and times of day are always shown in Norwegian time,
  // whatever the viewer's time zone.
  var osloFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });

  // { date: "2026-10-04", hour: 14, minute: 5 } in Norwegian time.
  function osloParts(ms) {
    var p = {};
    osloFormat.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + "-" + p.month + "-" + p.day, hour: Number(p.hour), minute: Number(p.minute) };
  }

  // The following date (calendar day, so daylight saving time does not give the wrong day).
  function nextDate(date) {
    var d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + 1));
    return d.toISOString().slice(0, 10);
  }

  // «14.05» in Norwegian time (separator from the dictionary: «14:05» in English).
  function formatClock(ms) {
    var p = osloParts(ms);
    return (p.hour < 10 ? "0" : "") + p.hour + meta().clockSep + (p.minute < 10 ? "0" : "") + p.minute;
  }

  // The forecast is too old when it was fetched more than maxForecastAgeHours ago (the data service or the build has
  // stopped), when MET's model run it comes from is more than maxModelAgeHours old (fetched lately, but from an old
  // run), or when either time is in the future (a wrong clock or wrong data). No assessment is shown then.
  var FUTURE_SLACK = 15 * 60000;
  function isStale(forecast, rules, now) {
    var fetched = Date.parse(forecast && forecast.fetched);
    if (!Number.isFinite(fetched) || fetched > now + FUTURE_SLACK || now - fetched > rules.maxForecastAgeHours * HOUR) return true;
    var updated = Date.parse(forecast.updated);
    return Number.isFinite(updated) && (updated > now + FUTURE_SLACK || now - updated > (rules.maxModelAgeHours || 12) * HOUR);
  }

  // --- The forecast from the data service ---
  // The pages carry the forecast from the build, which GitHub may build late. The data service (workers/data)
  // fetches MET every few minutes, and the pages use its forecast when it is newer. Only a forecast in the right shape
  // (hours as times, in order without repeats, a row per hour with numbers or null) and newer than the page's. A launch
  // missing from it (the service leaves out a launch it has not fetched lately) only has no assessment; it does not
  // keep the fresh forecast from the others. needSite: a launch the candidate must have (the site page), unless the page
  // has no forecast of its own to keep.
  function isNewerForecast(candidate, current, needSite) {
    if (!candidate || !Array.isArray(candidate.times) || !candidate.sites || typeof candidate.sites !== "object") return false;
    if (!candidate.times.every(function (t, i, all) {
      return typeof t === "string" && Number.isFinite(Date.parse(t)) && (i === 0 || Date.parse(t) > Date.parse(all[i - 1]));
    })) return false;
    var n = candidate.times.length;
    var okRow = function (row) {
      return row === null || (Array.isArray(row) && row.length === 4 && row.every(function (v) { return v === null || typeof v === "number"; }));
    };
    var ids = Object.keys(candidate.sites);
    if (!ids.every(function (id) { var s = candidate.sites[id]; return Array.isArray(s) && s.length === n && s.every(okRow); })) return false;
    var fetched = Date.parse(candidate.fetched);
    if (!Number.isFinite(fetched)) return false;
    if (!current) return true;
    if (fetched <= Date.parse(current.fetched)) return false;
    return !needSite || ids.indexOf(needSite) !== -1;
  }

  // Fetches the forecast from the data service, and calls done(forecast) only when isNewerForecast holds. On any
  // error (offline, the service down, no answer in 15 s) it calls fail() if given, and the page keeps what it has.
  function fetchNewerForecast(url, current, done, needSite, fail) {
    if (!url || typeof fetch !== "function") return;
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    fetch(url, ctrl ? { credentials: "omit", signal: ctrl.signal } : { credentials: "omit" })
      .then(function (r) { clearTimeout(timer); return r.ok ? r.json() : null; })
      .then(function (f) { if (isNewerForecast(f, current, needSite)) done(f); else if (!f && fail) fail(); })
      .catch(function () { clearTimeout(timer); if (fail) fail(); });
  }

  // Keeps a page's forecast fresh: fetches at once, every REFRESH_MS while the page is in view, when the page comes
  // back into view, and when the connection comes back. current(): the forecast the page has now (or null).
  var REFRESH_MS = 10 * 60000;
  function watchForecast(url, current, done, needSite, fail) {
    if (!url || typeof fetch !== "function") return;
    var busy = false;
    function load() {
      if (busy || (typeof document !== "undefined" && document.hidden)) return;
      busy = true;
      fetchNewerForecast(url, current(), function (f) { busy = false; done(f); }, needSite, function () { busy = false; if (fail) fail(); });
      // Also free when the answer was not newer (neither done nor fail is called then).
      setTimeout(function () { busy = false; }, 16000);
    }
    load();
    setInterval(load, REFRESH_MS);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
    if (typeof window !== "undefined") window.addEventListener("online", load);
  }

  // Index in the forecast for the chosen time, or -1 when the forecast does not cover it.
  // slot: "0", "3", "6" (hours from now) or "tomorrow" (tomorrow at 12 Norwegian time).
  function slotIndex(times, slot, now) {
    if (!times || !times.length || slot === "off") return -1;
    var ms = times.map(Date.parse);
    if (slot === "tomorrow") {
      var date = nextDate(osloParts(now).date);
      for (var i = 0; i < ms.length; i++) {
        var p = osloParts(ms[i]);
        if (p.date === date && p.hour === 12) return i;
      }
      return -1;
    }
    // The current hour. The forecast has one value per hour, valid for one hour from its time.
    var current = -1;
    ms.forEach(function (x, i) { if (x <= now) current = i; });
    if (current < 0 || now - ms[current] >= HOUR) return -1;
    // The hour that many hours on, found by its time (not by counting rows, so a missing hour gives -1, not a later one).
    var target = ms[current] + Number(slot) * HOUR;
    for (var j = current; j < ms.length; j++) if (ms[j] === target) return j;
    return -1;
  }

  // --- Assessment ---
  function directionCode(degrees) {
    return DIRECTIONS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
  }

  function directionType(site, code) {
    if (site.primary.indexOf(code) !== -1) return "primary";
    if (site.possible.indexOf(code) !== -1) return "possible";
    return "none";
  }

  // Checks and cleans one hour of wind before it is assessed. Direction and mean wind must be real numbers
  // (direction 0–360, wind not negative), or the hour has no valid wind and null is returned. Without this, a
  // missing or broken value (undefined, NaN, a string) slips past every limit, since comparisons with it are
  // always false, and the hour could come out as «Kan passe». Gusts and precipitation that are not valid numbers
  // count as missing, which never makes the assessment better (missing gusts give at most «Usikkert»).
  function isNumber(x) { return typeof x === "number" && Number.isFinite(x); }
  function cleanWind(wind) {
    if (!wind || !isNumber(wind.dir) || wind.dir < 0 || wind.dir > 360 || !isNumber(wind.speed) || wind.speed < 0) return null;
    return {
      dir: wind.dir,
      speed: wind.speed,
      gust: isNumber(wind.gust) && wind.gust >= 0 ? wind.gust : null,
      rain: isNumber(wind.rain) && wind.rain >= 0 ? wind.rain : null,
    };
  }

  // reasons: [[code, values], ...]. Returns both texts and codes, so the page can count reasons without reading the text.
  function result(rating, reasons) {
    return {
      rating: rating,
      reasons: reasons.map(function (r) { return text("reasons." + r[0], r[1]); }),
      codes: reasons.map(function (r) { return r[0]; }),
    };
  }

  // Rough assessment for one site: { rating: ok|maybe|high|no, reasons: [text, ...], codes: [code, ...] }.
  // If anything is missing (gusts) or uncertain, it is never better than «Usikkert».
  // site: { primary, possible, maxWind, soarMinWind }. maxWind is the site's own limit (wind_limits.max_wind), otherwise
  // null. soarMinWind (wind_limits.soar_min_wind): how much wind it takes to stay up (soar) there. It never changes the
  // rating, since the site can be flown without it (a flight down); below it the result only carries a note saying so.
  // wind: { dir, speed, gust }.
  function rateWind(site, rawWind, rules) {
    var r = rateWindOnly(site, rawWind, rules);
    var w = cleanWind(rawWind);
    if (w && site.soarMinWind != null && w.speed < site.soarMinWind && (r.rating === "ok" || r.rating === "maybe")) {
      r.note = text("reasons.belowSoar", { limit: site.soarMinWind });
    }
    return r;
  }
  function rateWindOnly(site, rawWind, rules) {
    // Callers get the wind from windAt, which already leaves out invalid hours. If an invalid hour reaches this
    // point anyway, it is never better than «Passer ikke».
    var wind = cleanWind(rawWind);
    if (!wind) return result("no", [["noData"]]);
    var hasOwnLimit = site.maxWind != null;
    var limit = hasOwnLimit ? site.maxWind : rules.maxWind;
    if (wind.speed > limit) {
      return result("high", [[hasOwnLimit ? "overSiteLimit" : "overLimit", { limit: limit }]]);
    }
    if (wind.gust != null && wind.gust > rules.maxGust) return result("high", [["gust", { limit: rules.maxGust }]]);
    // Rain: you do not fly with a wet wing. Heavy rain next hour gives «Passer ikke», light rain at best «Usikkert».
    // Missing precipitation in the forecast does not affect the assessment.
    if (wind.rain != null && wind.rain >= rules.rainNo) return result("no", [["rain", { rain: formatRain(wind.rain) }]]);

    var type = directionType(site, directionCode(wind.dir));
    if (type === "none") return result("no", [["direction"]]);

    var reasons = [];
    if (type === "possible") reasons.push(["possible"]);
    // The direction is rounded to eight sectors. If the wind is near the edge towards a direction that is not
    // a primary direction, it is uncertain which side it falls on.
    else if (directionType(site, directionCode(wind.dir - rules.sectorMargin)) !== "primary" ||
      directionType(site, directionCode(wind.dir + rules.sectorMargin)) !== "primary") {
      reasons.push(["edge"]);
    }
    if (wind.rain != null && wind.rain >= rules.rainMaybe) reasons.push(["someRain", { rain: formatRain(wind.rain) }]);
    if (wind.speed < rules.minWind) reasons.push(["weak"]);
    if (wind.gust == null) reasons.push(["noGust"]);
    else if (wind.gust - wind.speed > rules.maxGustSpread) reasons.push(["gustSpread", { spread: rules.maxGustSpread }]);
    return result(reasons.length ? "maybe" : "ok", reasons);
  }

  // The assessment for the hour now when the site has a weather station with a fresh measurement (stations.js): the
  // measured wind is assessed with the same rules (with the forecast's rain, which the station does not give). A measurement
  // that is stricter than the forecast always counts. One that is better counts only when the wind is steady (not rising and
  // not gusty, decided by the caller), since a lull in rising or gusty wind says little about the next minutes.
  // { result (as rateWind), basis: "measured" | "forecast", unsteady (true when a better measurement was not used) }.
  function rateNow(site, fcWind, measured, rules, steady) {
    var fc = rateWind(site, fcWind, rules);
    if (!measured || measured.speed == null) return { result: fc, basis: "forecast", unsteady: false };
    var m = rateWind(site, { dir: measured.dir, speed: measured.speed, gust: measured.gust, rain: fcWind ? fcWind.rain : null }, rules);
    if (RATINGS[m.rating].order >= RATINGS[fc.rating].order || steady) return { result: m, basis: "measured", unsteady: false };
    return { result: fc, basis: "forecast", unsteady: true };
  }

  // «0,3 mm» with the language's decimal separator.
  function formatRain(mm) {
    return (Math.round(mm * 10) / 10).toFixed(1).replace(".", meta().decimal) + " mm";
  }

  // Wind (and next-hour precipitation) for a site at a forecast index, or null when the site has no forecast
  // (fetch failed) or the hour has no valid wind (see cleanWind): the page then shows «Ingen varsel» instead of
  // a number. rain is null when the forecast has no precipitation (older forecast or far ahead).
  function windAt(forecast, id, index) {
    var series = forecast && forecast.sites && forecast.sites[id];
    var row = series && index >= 0 ? series[index] : null;
    return row ? cleanWind({ dir: row[0], speed: row[1], gust: row[2], rain: row[3] }) : null;
  }

  // Sunrise and sunset for a calendar day ("2026-10-09") at a place, using the standard sunrise formula
  // (sun 0.833° below the horizon, accounting for refraction and the solar disc). Accurate to a couple of minutes,
  // enough to show the time. { rise, set } in milliseconds, or { polar: "day" } for midnight sun and { polar: "night" }
  // for polar night, when the sun does not set or does not rise that day.
  function sunTimes(date, lat, lon) {
    var rad = Math.PI / 180;
    var noon = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 12);
    var n = Math.round(noon / DAY + 2440587.5 - 2451545 + 0.0008); // days since 1 January 2000
    var jStar = n - lon / 360;
    var m = (357.5291 + 0.98560028 * jStar) % 360;
    var c = 1.9148 * Math.sin(m * rad) + 0.02 * Math.sin(2 * m * rad) + 0.0003 * Math.sin(3 * m * rad);
    var lambda = (m + c + 180 + 102.9372) % 360;
    var transit = 2451545 + jStar + 0.0053 * Math.sin(m * rad) - 0.0069 * Math.sin(2 * lambda * rad);
    var sinDec = Math.sin(lambda * rad) * Math.sin(23.4397 * rad);
    var cosDec = Math.cos(Math.asin(sinDec));
    var cosH = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDec) / (Math.cos(lat * rad) * cosDec);
    if (cosH < -1) return { polar: "day" };
    if (cosH > 1) return { polar: "night" };
    var h = Math.acos(cosH) / rad / 360;
    var toMs = function (jd) { return Math.round((jd - 2440587.5) * DAY); };
    return { rise: toMs(transit - h), set: toMs(transit + h) };
  }

  // «Sola opp 07.37, ned 17.46.» for the day, or midnight sun / polar night.
  function sunText(date, lat, lon) {
    var sun = sunTimes(date, lat, lon);
    if (sun.polar) return text("wind.sunPolar" + (sun.polar === "day" ? "Day" : "Night"));
    return text("wind.sun", { rise: formatClock(sun.rise), set: formatClock(sun.set) });
  }

  // Day overview for a site: for each day in the forecast, the daylight periods where the assessment is «Kan passe»
  // or «Usikkert», as [{ start, end, rating }] (milliseconds, end is the end of the last hour). Hours in darkness
  // are excluded. With midnight sun the whole day counts; in polar night 10–14, when it is lightest. Each period
  // also has the wind: dir (most common direction), min and max (mean wind, m/s) and gust (highest gust).
  // { "2026-10-09": [...] }, only days with at least one period.
  function dayWindows(forecast, site, rules, lat, lon) {
    var series = forecast && forecast.sites && forecast.sites[site.id];
    if (!series) return {};
    var days = {};
    var suns = {};
    forecast.times.forEach(function (time, i) {
      var ms = Date.parse(time);
      var p = osloParts(ms);
      var sun = suns[p.date] || (suns[p.date] = sunTimes(p.date, lat, lon));
      var light = sun.polar === "day" ? true : sun.polar === "night" ? p.hour >= 10 && p.hour < 14 : ms + HOUR > sun.rise && ms < sun.set;
      var wind = windAt(forecast, site.id, i);
      if (!light || !wind) return;
      var rating = rateWind(site, wind, rules).rating;
      if (rating !== "ok" && rating !== "maybe") return;
      var list = days[p.date] || (days[p.date] = []);
      var last = list[list.length - 1];
      if (!(last && last.rating === rating && last.end === ms)) list.push(last = { start: ms, rating: rating, winds: [] });
      last.end = ms + HOUR;
      last.winds.push(wind);
    });
    // Wind in each period: most common direction, lowest and highest mean wind and highest gust (null when unknown).
    Object.keys(days).forEach(function (date) {
      days[date].forEach(function (w) {
        var count = {};
        w.winds.forEach(function (x) { var c = directionCode(x.dir); count[c] = (count[c] || 0) + 1; });
        w.dir = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; })[0];
        var speeds = w.winds.map(function (x) { return Math.round(x.speed); });
        w.min = Math.min.apply(null, speeds);
        w.max = Math.max.apply(null, speeds);
        var gusts = w.winds.map(function (x) { return x.gust; }).filter(function (g) { return g != null; });
        w.gust = gusts.length ? Math.round(Math.max.apply(null, gusts)) : null;
        delete w.winds;
      });
    });
    return days;
  }

  globalThis.FlyingSitesWind = {
    RATINGS: RATINGS,
    osloParts: osloParts,
    formatClock: formatClock,
    isStale: isStale,
    isNewerForecast: isNewerForecast,
    fetchNewerForecast: fetchNewerForecast,
    watchForecast: watchForecast,
    slotIndex: slotIndex,
    directionCode: directionCode,
    rateWind: rateWind,
    rateNow: rateNow,
    windAt: windAt,
    formatRain: formatRain,
    sunTimes: sunTimes,
    sunText: sunText,
    dayWindows: dayWindows,
    useText: useText,
  };
})();
