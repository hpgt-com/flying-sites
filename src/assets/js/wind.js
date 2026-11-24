// Vind- og regnvurdering ut fra MET-varselet: hvilken tid i varselet som gjelder, om varselet er for gammelt,
// og en grov vurdering per start. Ren logikk uten DOM, så den kan testes (test/wind.test.js).
// Lastes som et vanlig skript på forsiden og stedssidene og eksponeres som window.FlyingSitesWind.
// Reglene står i src/_data/windRules.json. Vurderingen sier aldri «OK å fly».
(function () {
  "use strict";

  var DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  var HOUR = 3600000;
  var DAY = 24 * HOUR;
  var TIME_ZONE = "Europe/Oslo";

  // Tekstene kommer fra ordboka for sidens språk (FlyingSites.t i common.js, fra src/_i18n/<lang>.json).
  // Testene setter dem med useText. Uten ordbok returneres nøkkelen.
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
  // Stedene ligger i Norge, så «i morgen kl. 12» og klokkeslett vises alltid i norsk tid,
  // uansett tidssonen til den som ser på.
  var osloFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });

  // { date: "2026-10-04", hour: 14, minute: 5 } i norsk tid.
  function osloParts(ms) {
    var p = {};
    osloFormat.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + "-" + p.month + "-" + p.day, hour: Number(p.hour), minute: Number(p.minute) };
  }

  // Datoen etter (kalenderdag, så sommertid ikke gir feil dag).
  function nextDate(date) {
    var d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + 1));
    return d.toISOString().slice(0, 10);
  }

  // «14.05» i norsk tid (skilletegnet fra ordboka: «14:05» på engelsk).
  function formatClock(ms) {
    var p = osloParts(ms);
    return (p.hour < 10 ? "0" : "") + p.hour + meta().clockSep + (p.minute < 10 ? "0" : "") + p.minute;
  }

  // Varselet er for gammelt når det ble hentet for mer enn maxForecastAgeHours siden (datatjenesten eller bygget har
  // stoppet), når MET-kjøringen det kommer fra, er eldre enn maxModelAgeHours (hentet nylig, men fra en gammel
  // kjøring), eller når en av tidene er fram i tid (feil klokke eller feil data). Da vises ingen vurdering.
  var FUTURE_SLACK = 15 * 60000;
  function isStale(forecast, rules, now) {
    var fetched = Date.parse(forecast && forecast.fetched);
    if (!Number.isFinite(fetched) || fetched > now + FUTURE_SLACK || now - fetched > rules.maxForecastAgeHours * HOUR) return true;
    var updated = Date.parse(forecast.updated);
    return Number.isFinite(updated) && (updated > now + FUTURE_SLACK || now - updated > (rules.maxModelAgeHours || 12) * HOUR);
  }

  // --- Varselet fra datatjenesten ---
  // Sidene har med varselet fra bygget, som GitHub kan bygge sent. Datatjenesten (workers/data)
  // henter MET med noen minutters mellomrom, og sidene bruker varselet derfra når det er nyere. Bare et varsel i riktig
  // form (timer som tider, i rekkefølge uten gjentakelser, en rad per time med tall eller null) og nyere enn sidens. En
  // start som mangler i det (tjenesten utelater en start den ikke har hentet nylig), får bare ingen vurdering. Den
  // hindrer ikke det ferske varselet for de andre. needSite: en start kandidaten må ha (stedssiden), med mindre siden
  // ikke har noe eget varsel å beholde.
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

  // Henter varselet fra datatjenesten og kaller done(forecast) bare når isNewerForecast holder. Ved feil
  // (offline, tjenesten nede, ikke svar på 15 s) kaller den fail() om den er gitt, og siden beholder det den har.
  function fetchNewerForecast(url, current, done, needSite, fail) {
    if (!url || typeof fetch !== "function") return;
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    fetch(url, ctrl ? { credentials: "omit", signal: ctrl.signal } : { credentials: "omit" })
      .then(function (r) { clearTimeout(timer); return r.ok ? r.json() : null; })
      .then(function (f) { if (isNewerForecast(f, current, needSite)) done(f); else if (!f && fail) fail(); })
      .catch(function () { clearTimeout(timer); if (fail) fail(); });
  }

  // Holder varselet på en side ferskt: henter med en gang, hvert REFRESH_MS mens siden er synlig, når siden blir
  // synlig igjen, og når nettet kommer tilbake. current(): varselet siden har nå (eller null).
  var REFRESH_MS = 10 * 60000;
  function watchForecast(url, current, done, needSite, fail) {
    if (!url || typeof fetch !== "function") return;
    var busy = false;
    function load() {
      if (busy || (typeof document !== "undefined" && document.hidden)) return;
      busy = true;
      fetchNewerForecast(url, current(), function (f) { busy = false; done(f); }, needSite, function () { busy = false; if (fail) fail(); });
      // Ledig også når svaret ikke var nyere (da kalles verken done eller fail).
      setTimeout(function () { busy = false; }, 16000);
    }
    load();
    setInterval(load, REFRESH_MS);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
    if (typeof window !== "undefined") window.addEventListener("online", load);
  }

  // Indeksen i varselet for valgt tid, eller -1 når varselet ikke dekker den.
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
    // Inneværende time. Varselet har én verdi per time, som gjelder én time fra sin tid.
    var current = -1;
    ms.forEach(function (x, i) { if (x <= now) current = i; });
    if (current < 0 || now - ms[current] >= HOUR) return -1;
    // Timen så mange timer fram, funnet på tiden (ikke ved å telle rader, så en manglende time gir -1, ikke en senere).
    var target = ms[current] + Number(slot) * HOUR;
    for (var j = current; j < ms.length; j++) if (ms[j] === target) return j;
    return -1;
  }

  // Hvor lenge verdien ved indeks i i varselet gjelder (ms): til neste tid, en time eller, lenger fram, 6 timer
  // (lib/weather/met.js). Den siste like lenge som den før.
  function stepAt(times, i) {
    if (i + 1 < times.length) return Date.parse(times[i + 1]) - Date.parse(times[i]);
    return i > 0 ? Date.parse(times[i]) - Date.parse(times[i - 1]) : HOUR;
  }

  // Tidene i varselet fra timen nå, som timer fra den: [{ index, hours }]. Tom når det ikke dekker nå.
  function hoursAhead(times, now) {
    var current = slotIndex(times, "0", now);
    if (current < 0) return [];
    var start = Date.parse(times[current]);
    return times.slice(current).map(function (t, k) { return { index: current + k, hours: Math.round((Date.parse(t) - start) / HOUR) }; });
  }

  // Timene i ahead (hoursAhead) nærmest hours. Et steg på én time fra `from` (timene som er valgt nå,
  // slik piltastene på glideren gir) som havner på samme tid, går videre til den neste i den retningen, så tastene også
  // flytter seg gjennom 6-timerssteget.
  function nearestHours(ahead, hours, from) {
    if (!ahead.length) return 0;
    var best = 0;
    ahead.forEach(function (a, k) { if (Math.abs(a.hours - hours) < Math.abs(ahead[best].hours - hours)) best = k; });
    if (from != null && ahead[best].hours === from && Math.abs(hours - from) === 1) best = Math.max(0, Math.min(ahead.length - 1, best + (hours > from ? 1 : -1)));
    return ahead[best].hours;
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

  // Sjekker og renser én time med vind før den vurderes. Retning og middelvind må være ekte tall
  // (retning 0–360, vind ikke negativ), ellers har timen ingen gyldig vind og null returneres. Uten dette smetter en
  // manglende eller ødelagt verdi (undefined, NaN, en streng) forbi alle grenser, siden sammenligninger med den
  // alltid er usanne, og timen kunne blitt «Kan passe». Kast og nedbør som ikke er gyldige tall,
  // regnes som manglende, noe som aldri gjør vurderingen bedre (manglende kast gir høyst «Usikkert»).
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

  // reasons: [[code, values], ...]. Returnerer både tekster og koder, så siden kan telle årsaker uten å lese teksten.
  function result(rating, reasons) {
    return {
      rating: rating,
      reasons: reasons.map(function (r) { return text("reasons." + r[0], r[1]); }),
      codes: reasons.map(function (r) { return r[0]; }),
    };
  }

  // Grov vurdering for ett sted: { rating: ok|maybe|high|no, reasons: [text, ...], codes: [code, ...] }.
  // Mangler noe (kast), eller er noe usikkert, blir det aldri bedre enn «Usikkert».
  // site: { primary, possible, maxWind, soarMinWind }. maxWind er stedets egen grense (wind_limits.max_wind), ellers
  // null. soarMinWind (wind_limits.soar_min_wind): hvor mye vind som trengs for å holde seg oppe (soare) der. Den
  // endrer aldri vurderingen, siden stedet kan flys uten (en tur ned). Under den får resultatet bare en merknad om det.
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
    // De som kaller, får vinden fra windAt, som allerede utelater ugyldige timer. Kommer en ugyldig time likevel
    // hit, blir den aldri bedre enn «Passer ikke».
    var wind = cleanWind(rawWind);
    if (!wind) return result("no", [["noData"]]);
    var hasOwnLimit = site.maxWind != null;
    var limit = hasOwnLimit ? site.maxWind : rules.maxWind;
    if (wind.speed > limit) {
      return result("high", [[hasOwnLimit ? "overSiteLimit" : "overLimit", { limit: limit }]]);
    }
    if (wind.gust != null && wind.gust > rules.maxGust) return result("high", [["gust", { limit: rules.maxGust }]]);
    // Regn: man flyr ikke med våt vinge. Mye regn neste time gir «Passer ikke», lett regn i beste fall «Usikkert».
    // Manglende nedbør i varselet påvirker ikke vurderingen.
    if (wind.rain != null && wind.rain >= rules.rainNo) return result("no", [["rain", { rain: formatRain(wind.rain) }]]);

    var type = directionType(site, directionCode(wind.dir));
    if (type === "none") return result("no", [["direction"]]);

    var reasons = [];
    if (type === "possible") reasons.push(["possible"]);
    // Retningen rundes til åtte sektorer. Er vinden nær kanten mot en retning som ikke er
    // en hovedretning, er det usikkert hvilken side den havner på.
    else if (directionType(site, directionCode(wind.dir - rules.sectorMargin)) !== "primary" ||
      directionType(site, directionCode(wind.dir + rules.sectorMargin)) !== "primary") {
      reasons.push(["edge"]);
    }
    if (wind.rain != null && wind.rain >= rules.rainMaybe) reasons.push(["someRain", { rain: formatRain(wind.rain) }]);
    // Svak vind er ikke en årsak i seg selv: med riktig retning er en tur ned fortsatt en tur.
    if (wind.gust == null) reasons.push(["noGust"]);
    else if (wind.gust - wind.speed > rules.maxGustSpread) reasons.push(["gustSpread", { spread: rules.maxGustSpread }]);
    return result(reasons.length ? "maybe" : "ok", reasons);
  }

  // Vurderingen for timen nå når stedet har en værstasjon med fersk måling (stations.js): den målte
  // vinden vurderes med de samme reglene (med regnet fra varselet, som stasjonen ikke gir). En måling som er
  // strengere enn varselet, gjelder alltid. En som er bedre, gjelder bare når vinden er jevn (ikke økende og ikke
  // byig, avgjort av den som kaller), siden et stille øyeblikk i økende eller byig vind sier lite om neste minutter.
  // { result (som rateWind), basis: "measured" | "forecast", unsteady (true når en bedre måling ikke ble brukt) }.
  function rateNow(site, fcWind, measured, rules, steady) {
    var fc = rateWind(site, fcWind, rules);
    if (!measured || measured.speed == null) return { result: fc, basis: "forecast", unsteady: false };
    var m = rateWind(site, { dir: measured.dir, speed: measured.speed, gust: measured.gust, rain: fcWind ? fcWind.rain : null }, rules);
    if (RATINGS[m.rating].order >= RATINGS[fc.rating].order || steady) return { result: m, basis: "measured", unsteady: false };
    return { result: fc, basis: "forecast", unsteady: true };
  }

  // «0,3 mm» med språkets desimaltegn.
  function formatRain(mm) {
    return (Math.round(mm * 10) / 10).toFixed(1).replace(".", meta().decimal) + " mm";
  }

  // Vind (og nedbør neste time) for et sted ved en indeks i varselet, eller null når stedet ikke har varsel
  // (hentingen feilet) eller timen ikke har gyldig vind (se cleanWind): siden viser da «Ingen varsel» i stedet for
  // et tall. rain er null når varselet ikke har nedbør (eldre varsel eller langt fram).
  function windAt(forecast, id, index) {
    var series = forecast && forecast.sites && forecast.sites[id];
    var row = series && index >= 0 ? series[index] : null;
    return row ? cleanWind({ dir: row[0], speed: row[1], gust: row[2], rain: row[3] }) : null;
  }

  // Soloppgang og solnedgang for en kalenderdag ("2026-10-09") på et sted, med standardformelen for soloppgang
  // (sola 0,833° under horisonten, med brytning og soldisken). Nøyaktig på et par minutter,
  // nok til å vise klokkeslettet. { rise, set } i millisekunder, eller { polar: "day" } for midnattssol og
  // { polar: "night" } for mørketid, når sola ikke går ned eller ikke kommer opp den dagen.
  function sunTimes(date, lat, lon) {
    var rad = Math.PI / 180;
    var noon = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 12);
    var n = Math.round(noon / DAY + 2440587.5 - 2451545 + 0.0008); // dager siden 1. januar 2000
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

  // «Sola opp 07.37, ned 17.46.» for dagen, eller midnattssol / mørketid.
  function sunText(date, lat, lon) {
    var sun = sunTimes(date, lat, lon);
    if (sun.polar) return text("wind.sunPolar" + (sun.polar === "day" ? "Day" : "Night"));
    return text("wind.sun", { rise: formatClock(sun.rise), set: formatClock(sun.set) });
  }

  // Solas posisjon på et tidspunkt: høyde over horisonten og asimut (0 = nord, 90 = øst, 180 = sør), i
  // grader. De samme tilnærmingene som sunTimes (uten brytning), nøyaktig på omtrent en grad.
  function sunPosition(ms, lat, lon) {
    var rad = Math.PI / 180;
    var d = ms / DAY - 10957.5; // dager siden 1. januar 2000, kl. 12.00 UTC
    var m = (357.5291 + 0.98560028 * d) % 360;
    var c = 1.9148 * Math.sin(m * rad) + 0.02 * Math.sin(2 * m * rad) + 0.0003 * Math.sin(3 * m * rad);
    var lambda = (m + c + 180 + 102.9372) % 360;
    var dec = Math.asin(Math.sin(lambda * rad) * Math.sin(23.4397 * rad));
    var ra = Math.atan2(Math.sin(lambda * rad) * Math.cos(23.4397 * rad), Math.cos(lambda * rad));
    var hourAngle = ((280.16 + 360.9856235 * d + lon) % 360) * rad - ra;
    var elevation = Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(hourAngle));
    // Målt fra sør mot vest, så 180 legges til for å regne fra nord.
    var azimuth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(lat * rad) - Math.tan(dec) * Math.cos(lat * rad));
    return { elevation: elevation / rad, azimuth: (azimuth / rad + 540) % 360 };
  }

  // Når sola skinner på en start i løpet av en kalenderdag: starten vender mot retningene den tar vind fra, og
  // sola er på den når den står mer enn 3° over horisonten og mindre enn 60° til siden for en av de retningene.
  // Skygge fra terrenget er ikke kjent, så det er en grov pekepinn. [[from, to]] i norske timer på døgnet (desimal,
  // målt hvert 10. minutt), tom når sola ikke når den. Med midnattssol kan en periode gå forbi
  // midnatt, som [22, 26] for 22–02.
  var SUN_MIN_ELEVATION = 3;
  var SUN_MAX_ASIDE = 60;
  function sunOnLaunch(date, lat, lon, directions) {
    var facing = directions.map(function (code) { return DIRECTIONS.indexOf(code) * 45; }).filter(function (a) { return a >= 0; });
    if (!facing.length) return [];
    var midnight = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
    var offset = osloParts(midnight + 12 * HOUR).hour - 12; // norsk tid er UTC+1 eller +2
    var periods = [];
    var on = false;
    for (var tenth = 0; tenth <= 24 * 6; tenth++) {
      var hour = tenth / 6;
      var sun = sunPosition(midnight + (hour - offset) * HOUR, lat, lon);
      var lit = sun.elevation > SUN_MIN_ELEVATION && facing.some(function (a) {
        var diff = Math.abs(((sun.azimuth - a) % 360 + 540) % 360 - 180);
        return diff <= SUN_MAX_ASIDE;
      });
      if (lit && !on) periods.push([hour, hour]);
      if (lit) periods[periods.length - 1][1] = hour;
      on = lit;
    }
    // En periode som slutter ved midnatt, og en som starter ved midnatt, er den samme, over midnatt.
    if (periods.length > 1 && periods[0][0] === 0 && periods[periods.length - 1][1] === 24) {
      periods[periods.length - 1][1] = 24 + periods.shift()[1];
    }
    return periods;
  }

  // «Sol på starten ca. kl. 09–15.», «... kl. 09–12 og 15–18.» eller «Lite sol på starten i dag.» Hele timer.
  function sunOnLaunchText(date, lat, lon, directions) {
    var periods = sunOnLaunch(date, lat, lon, directions).map(function (p) {
      return [Math.round(p[0]), Math.round(p[1])];
    }).filter(function (p) { return p[1] > p[0]; });
    if (!periods.length) return text("wind.sunOnNone");
    var two = function (h) { h = h % 24; return (h < 10 ? "0" : "") + h; };
    var hours = periods.map(function (p) { return two(p[0]) + "\u2013" + two(p[1]); }).join(text("wind.sunOnJoin"));
    return text("wind.sunOn", { hours: hours });
  }

  // Dagsoversikt for et sted: for hver dag i varselet, periodene i dagslys der vurderingen er «Kan passe»
  // eller «Usikkert», som [{ start, end, rating }] (millisekunder, end er slutten på siste time, eller på siste
  // 6-timerssteg lenger fram). Timer i mørket
  // utelates. Med midnattssol gjelder hele døgnet, i mørketid 10–14, når det er lysest. Hver periode
  // har også vinden: dir (vanligste retning), min og max (middelvind, m/s) og gust (høyeste kast).
  // { "2026-10-09": [...] }, bare dager med minst én periode.
  function dayWindows(forecast, site, rules, lat, lon) {
    var series = forecast && forecast.sites && forecast.sites[site.id];
    if (!series) return {};
    var days = {};
    var suns = {};
    forecast.times.forEach(function (time, i) {
      var ms = Date.parse(time);
      var p = osloParts(ms);
      var sun = suns[p.date] || (suns[p.date] = sunTimes(p.date, lat, lon));
      var step = stepAt(forecast.times, i);
      var light = sun.polar === "day" ? true : sun.polar === "night" ? p.hour >= 10 && p.hour < 14 : ms + step > sun.rise && ms < sun.set;
      var wind = windAt(forecast, site.id, i);
      if (!light || !wind) return;
      var rating = rateWind(site, wind, rules).rating;
      if (rating !== "ok" && rating !== "maybe") return;
      var list = days[p.date] || (days[p.date] = []);
      var last = list[list.length - 1];
      if (!(last && last.rating === rating && last.end === ms)) list.push(last = { start: ms, rating: rating, winds: [] });
      last.end = ms + step;
      last.winds.push(wind);
    });
    // Vinden i hver periode: vanligste retning, laveste og høyeste middelvind og høyeste kast (null når ukjent).
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
    stepAt: stepAt,
    hoursAhead: hoursAhead,
    nearestHours: nearestHours,
    directionCode: directionCode,
    rateWind: rateWind,
    rateNow: rateNow,
    windAt: windAt,
    formatRain: formatRain,
    sunTimes: sunTimes,
    sunText: sunText,
    sunPosition: sunPosition,
    sunOnLaunch: sunOnLaunch,
    sunOnLaunchText: sunOnLaunchText,
    dayWindows: dayWindows,
    useText: useText,
  };
})();
