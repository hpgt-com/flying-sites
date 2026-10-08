// Vind- og regnvurdering fra MET-varselet: hvilket tidspunkt i varselet som gjelder, om varselet er for gammelt,
// og en grov vurdering per start. Ren logikk uten DOM, så den kan testes (test/wind.test.js).
// Lastes som vanlig skript på forsiden og stedssidene og legges på window.FlyingSitesWind.
// Reglene ligger i src/_data/windRules.json. Vurderingen sier aldri «OK å fly».
(function () {
  "use strict";

  var DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  var HOUR = 3600000;
  var TIME_ZONE = "Europe/Oslo";

  // Tekstene kommer fra ordboken for sidens språk (FlyingSites.t i common.js, fra src/_i18n/<språk>.json).
  // Testene setter dem med useText. Uten ordbok gis nøkkelen tilbake.
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

  // --- Tid ---
  // Stedene er i Norge, så «i morgen kl. 12» og klokkeslett vises alltid i norsk tid,
  // uansett hvilken tidssone den som ser på siden har.
  var osloFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });

  // { date: "2026-10-04", hour: 14, minute: 5 } i norsk tid.
  function osloParts(ms) {
    var p = {};
    osloFormat.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + "-" + p.month + "-" + p.day, hour: Number(p.hour), minute: Number(p.minute) };
  }

  // Datoen dagen etter (kalenderdag, så sommertid ikke gir feil dag).
  function nextDate(date) {
    var d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + 1));
    return d.toISOString().slice(0, 10);
  }

  // «14.05» i norsk tid (skilletegnet fra ordboken: «14:05» på engelsk).
  function formatClock(ms) {
    var p = osloParts(ms);
    return (p.hour < 10 ? "0" : "") + p.hour + meta().clockSep + (p.minute < 10 ? "0" : "") + p.minute;
  }

  // Varselet er for gammelt når det er hentet for mer enn maxForecastAgeHours siden, for eksempel fordi
  // den planlagte byggingen har stoppet. Da vises ingen vurdering.
  function isStale(forecast, rules, now) {
    var fetched = Date.parse(forecast && forecast.fetched);
    return !Number.isFinite(fetched) || now - fetched > rules.maxForecastAgeHours * HOUR;
  }

  // Indeks i varselet for valgt tidspunkt, eller -1 når varselet ikke dekker det.
  // slot: "0", "3", "6" (timer fra nå) eller "tomorrow" (i morgen kl. 12 norsk tid).
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
    // Timen som gjelder nå. Varselet har én verdi per time, så den gjelder i én time fra tidspunktet.
    var current = -1;
    ms.forEach(function (x, i) { if (x <= now) current = i; });
    if (current < 0 || now - ms[current] >= HOUR) return -1;
    var index = current + Number(slot);
    return index < ms.length ? index : -1;
  }

  // --- Vurdering ---
  function directionCode(degrees) {
    return DIRECTIONS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
  }

  function directionType(site, code) {
    if (site.primary.indexOf(code) !== -1) return "primary";
    if (site.possible.indexOf(code) !== -1) return "possible";
    return "none";
  }

  // reasons: [[kode, verdier], ...]. Gir tekstene og kodene, så siden kan telle årsaker uten å lese teksten.
  function result(rating, reasons) {
    return {
      rating: rating,
      reasons: reasons.map(function (r) { return text("reasons." + r[0], r[1]); }),
      codes: reasons.map(function (r) { return r[0]; }),
    };
  }

  // Grov vurdering for ett sted: { rating: ok|maybe|high|no, reasons: [tekst, ...], codes: [kode, ...] }.
  // Mangler noe (kast) eller er noe usikkert, blir det aldri bedre enn «Usikkert».
  // site: { primary, possible, maxWind }. maxWind er stedets egen grense (wind_limits.max_wind), ellers null.
  // wind: { dir, speed, gust }.
  function rateWind(site, wind, rules) {
    var hasOwnLimit = site.maxWind != null;
    var limit = hasOwnLimit ? site.maxWind : rules.maxWind;
    if (wind.speed > limit) {
      return result("high", [[hasOwnLimit ? "overSiteLimit" : "overLimit", { limit: limit }]]);
    }
    if (wind.gust != null && wind.gust > rules.maxGust) return result("high", [["gust", { limit: rules.maxGust }]]);
    // Regn: man flyr ikke med våt vinge. Mye regn neste time gir «Passer ikke», litt regn høyst «Usikkert».
    // Mangler nedbør i varselet, påvirker det ikke vurderingen.
    if (wind.rain != null && wind.rain >= rules.rainNo) return result("no", [["rain", { rain: formatRain(wind.rain) }]]);

    var type = directionType(site, directionCode(wind.dir));
    if (type === "none") return result("no", [["direction"]]);

    var reasons = [];
    if (type === "possible") reasons.push(["possible"]);
    // Retningen avrundes til åtte sektorer. Ligger vinden nær kanten mot en retning som ikke er
    // hovedretning, er det usikkert hvilken side den havner på.
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

  // «0,3 mm» med språkets desimaltegn.
  function formatRain(mm) {
    return (Math.round(mm * 10) / 10).toFixed(1).replace(".", meta().decimal) + " mm";
  }

  // Vind (og nedbør neste time) for et sted på en indeks i varselet, eller null når stedet mangler varsel
  // (hentingen feilet). rain er null når varselet ikke har nedbør (eldre varsel eller langt fram i tid).
  function windAt(forecast, id, index) {
    var series = forecast && forecast.sites && forecast.sites[id];
    var row = series && index >= 0 ? series[index] : null;
    return row ? { dir: row[0], speed: row[1], gust: row[2], rain: row[3] != null ? row[3] : null } : null;
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
    useText: useText,
  };
})();
