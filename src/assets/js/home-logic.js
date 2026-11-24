// Logikken på forsiden uten DOM: søk, filtrene, oppsummeringen av vurderingene, tekstene for tider og
// vinduer, og tilstanden i URL-hashen. Brukes av home.js. Ren, så den kan testes (test/home-logic.test.js).
// Lastes som et vanlig skript etter wind.js og eksponeres som window.FlyingSitesHome.
(function () {
  "use strict";

  var W = globalThis.FlyingSitesWind;
  var DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  var LEVELS = ["PP2", "PP3", "PP4", "PP5"];
  var DAY = 86400000;

  // Tekster fra ordboka for sidens språk (FlyingSites.t i common.js). Testene setter dem med useText.
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

  // --- Søk på navn og sted ---
  // Små bokstaver og uten aksenter. Æ, ø og å kan skrives på alle vanlige måter uten norsk tastatur:
  // «kvaefjord» og «kvafjord» finner Kvæfjord, «hoegfjellet» og «hogfjellet» Høgfjellet, «blaahatten» og
  // «blahatten» Blåhatten. Navn og søk normaliseres likt (æ, ae → a; ø, oe → o; å, aa → a),
  // så det kan gi et ekstra treff, men aldri miste ett. Mellomrom og bindestreker teller ikke. Treffer hvor som helst
  // i navnet («solli» → Sollifjellet), eller i kommunen eller regionen («kvæfjord», «lofoten»). Navn
  // og steder sjekkes hver for seg, så et søk ikke kan treffe over skjøten mellom dem.
  function searchKey(s) {
    return String(s || "").toLowerCase()
      .replace(/æ/g, "a").replace(/ø/g, "o").replace(/å/g, "a")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[\s\-–]+/g, "")
      .replace(/ae/g, "a").replace(/oe/g, "o").replace(/aa/g, "a");
  }
  // Nøklene et sted finnes på: navnet og stedene (kommune, region).
  function searchKeys(site) {
    return [site.name].concat(site.places || []).map(searchKey);
  }
  function nameMatches(site, q) {
    var key = searchKey(q);
    return !key || site.searchKeys.some(function (k) { return k.indexOf(key) !== -1; });
  }

  // "match", "unknown", "nowind" eller "no" for et sted mot filtrene ({ directions, level, category, q }). Nivåfilteret
  // viser steder for valgt nivå og lavere (en PP3-pilot kan fly PP2-steder). Steder uten registrert nivå
  // skjules ikke, men får "unknown" og vises for seg, siden de fleste steder ikke har nivå ennå og et tomt
  // resultat ellers ville sett ut som «ingen steder». Med forslag fra varselet på (o.suggest, «Vis bare steder
  // som kan passe») dempes steder vurdert til «Passer ikke» eller «For mye vind» (o.assessment), som når man velger
  // retning. «Kan passe» og «Usikkert» blir stående. Steder uten varsel (o.windAssessed, men ingen vurdering)
  // forsvinner ikke, men får "nowind" og vises for seg under «Mangler varsel – ikke vurdert». o.ignoreSuggest
  // ser bort fra forslagsbryteren (til tellingen av hva de andre filtrene gir).
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

  // --- Oppsummeringen av vurderingene ---
  // Vurderingene av stedene i ids ({ id: assessment }) summert: hvor mange som fikk hver vurdering, hvorfor de som
  // ikke passet, ikke gjorde det, den vanligste vindretningen, og median, laveste og høyeste vind. total: hvor mange
  // steder det er i alt, så oppsummeringen vet at lista er filtrert. null uten noen vurdering.
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
      // Årsak fra koden (wind.js), ikke teksten, så det virker på alle språk.
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
  // Hvorfor ingen steder passer: regn, kast, vind eller retningen, det som stoppet flest av dem.
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

  // «SV 5 m/s, kast 9, regn 1,2 mm (målt)». labels: retningsnavnene etter kode (FlyingSites.DIRECTION_LABELS).
  function windText(wind, rules, labels) {
    return labels[W.directionCode(wind.dir)] + " " + Math.round(wind.speed) + " m/s, " +
      (wind.gust != null ? text("wind.gust", { g: Math.round(wind.gust) }) : text("wind.gustUnknown")) +
      (wind.rain != null && wind.rain >= rules.rainMaybe ? ", " + text("wind.rain", { rain: W.formatRain(wind.rain) }) : "") +
      (wind.measured ? " (" + text("home.measured") + ")" : "");
  }

  // --- Tider ---
  // «i dag kl. 08:47», eller «16.10 kl. 23:47» for en annen dag.
  function whenText(iso, now) {
    var ms = Date.parse(iso);
    var today = W.osloParts(now).date, day = W.osloParts(ms).date;
    return (day === today ? text("wind.today") : day.slice(8, 10) + "." + day.slice(5, 7)) + " " + text("wind.at", { time: W.formatClock(ms) });
  }
  // «kl. 17.00», «i morgen kl. 09.00» eller «søn. kl. 13.00» for varseltimen ved index (home.js sier «nå» selv).
  function whenLabel(forecast, index, now) {
    var ms = Date.parse(forecast.times[index]);
    var day = W.osloParts(ms).date, today = W.osloParts(now).date, time = W.formatClock(ms);
    if (day === today) return text("home.whenToday", { time: time });
    if (day === W.osloParts(now + DAY).date) return text("home.whenTomorrow", { time: time });
    return text("home.whenDay", { day: dayFormat("short").format(ms).replace(/\.$/, "") + ".", time: time });
  }
  // Dagen vindusstripene viser: i dag, eller i morgen fra kl. 20 norsk tid, når dagslyset i dag er over.
  function stripDate(now) {
    var p = W.osloParts(now);
    return p.hour >= 20 ? W.osloParts(now + DAY).date : p.date;
  }
  function hourLabel(ms) { var h = W.osloParts(ms).hour; return (h < 10 ? "0" : "") + h; }
  // «08–13 kan passe» for et vindu ({ start, end, rating }). Et vindu til midnatt slutter på «24».
  function windowText(w) {
    var end = W.osloParts(w.end).hour === 0 ? "24" : hourLabel(w.end);
    return hourLabel(w.start) + "–" + end + " " + W.RATINGS[w.rating].label.toLowerCase();
  }
  // Neste vindu blant stedene etter at: tidligste start, «Kan passe» før «Usikkert» i samme time, som
  // { site, start, rating }, eller null. windowsFor(site) gir vinduene til stedet per dag (wind.js dayWindows).
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
  // «Neste vindu: Dale lørdag kl. 08, kan passe.», eller at varselet ikke har noe.
  function nextWindowText(best, now) {
    if (!best) return text("summary.noNextWindow");
    var p = W.osloParts(best.start);
    var day = p.date === W.osloParts(now).date ? text("home.windowsToday").toLowerCase()
      : p.date === W.osloParts(now + DAY).date ? text("home.windowsTomorrow").toLowerCase() : dayFormat("long").format(best.start);
    return text("summary.nextWindow", { site: best.site.name, day: day, hour: hourLabel(best.start), rating: W.RATINGS[best.rating].label.toLowerCase() });
  }

  // --- Tilstanden i URL-hashen ---
  // «direction=W,NW&level=PP3&wind=3&forslag=1&q=solli&site=sollifjellet» for tilstanden: filter { directions, level,
  // category, q }, windSlot («0» nå, timer fram, eller «off»), windOn (et varsel som ikke er for gammelt), suggest og
  // valgt sted. Tiden utelates når den er nå, forslaget når vinden er av, så en vanlig visning gir en
  // tom hash.
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
  // Hashen lest tilbake: { directions (bare kjente koder), level, category, wind, suggest, q, site }. Ukjente nivåer,
  // kategorier og steder må kalleren sjekke mot siden.
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
