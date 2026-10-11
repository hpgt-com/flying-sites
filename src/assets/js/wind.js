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

  // The forecast is too old when it was fetched more than maxForecastAgeHours ago, e.g. because the scheduled
  // build has stopped. No assessment is shown then.
  function isStale(forecast, rules, now) {
    var fetched = Date.parse(forecast && forecast.fetched);
    return !Number.isFinite(fetched) || now - fetched > rules.maxForecastAgeHours * HOUR;
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
    var index = current + Number(slot);
    return index < ms.length ? index : -1;
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
  // site: { primary, possible, maxWind }. maxWind is the site's own limit (wind_limits.max_wind), otherwise null.
  // wind: { dir, speed, gust }.
  function rateWind(site, wind, rules) {
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

  // «0,3 mm» with the language's decimal separator.
  function formatRain(mm) {
    return (Math.round(mm * 10) / 10).toFixed(1).replace(".", meta().decimal) + " mm";
  }

  // Wind (and next-hour precipitation) for a site at a forecast index, or null when the site has no forecast
  // (fetch failed). rain is null when the forecast has no precipitation (older forecast or far ahead).
  function windAt(forecast, id, index) {
    var series = forecast && forecast.sites && forecast.sites[id];
    var row = series && index >= 0 ? series[index] : null;
    return row ? { dir: row[0], speed: row[1], gust: row[2], rain: row[3] != null ? row[3] : null } : null;
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
    slotIndex: slotIndex,
    directionCode: directionCode,
    rateWind: rateWind,
    windAt: windAt,
    formatRain: formatRain,
    sunTimes: sunTimes,
    sunText: sunText,
    dayWindows: dayWindows,
    useText: useText,
  };
})();
