// Målt vind fra værstasjonene, fra datatjenesten (workers/data, /v1/stations.json): på forsidekartet som
// lagene «Klubbens værstasjoner» og «METs værstasjoner», som «Målt vind nå» i Vær-fanen, og på stedssiden for
// flystedet til stasjonen.
// Hentes på nytt hvert minutt mens siden er synlig. Sjekkene og tekstene er rene funksjoner, testet i
// test/stations.test.js; tegningen bruker bare DOM-metoder, så ingenting fra dataene leses som HTML.
// Lastes etter common.js og wind.js, og gjøres tilgjengelig som window.FlyingSitesStations.
(function () {
  "use strict";

  var REFRESH_MS = 60000;
  // En måling som er eldre enn dette, vises som gammel (stasjonen kan være nede), og ikke som vinden nå. Klubbens
  // Holfuy-stasjoner sender hvert minutt eller annethvert; METs stasjoner stort sett én gang i timen, og Frost har dem
  // noen minutter etter, så deres blir gamle først etter OLD_MINUTES_MET.
  var OLD_MINUTES = 30;
  var OLD_MINUTES_MET = 90;
  // Trendlinjen på kortene (stedssiden, forsiden) går over så mange minutter; på værsiden kan du velge.
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

  // Bare data i forventet form brukes: elementer med id, navn, og tall eller null der det skal være tall.
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

  // En verdi slik stasjonen sendte den, med desimaltegnet til siden: 4.4 → «4,4», 7 → «7». Ikke rundet av til hele
  // tall, så siden viser det som ble målt.
  function value(v) {
    var FS = globalThis.FlyingSites;
    if (!isNum(v)) return "";
    return Number.isInteger(v) ? String(v) : FS.formatNumber(v, Math.min(2, (String(v).split(".")[1] || "").length));
  }

  // «SV 225°», retningen vinden kommer fra, som kompassretning og gradene slik de ble målt.
  function dirText(dir) {
    return isNum(dir) ? globalThis.FlyingSites.DIRECTION_LABELS[W().directionCode(dir)] + " " + Math.round(dir) + "°" : "";
  }

  // «SV 225°, 4,4 m/s, kast 7,2», med tallene slik de ble målt, eller null uten vind.
  function windText(item) {
    var w = item.wind;
    if (!w || !isNum(w.speed)) return null;
    var dir = dirText(w.dir);
    return (dir ? dir + ", " : "") + text("stations.speed", { speed: value(w.speed) }) + (isNum(w.gust) ? text("stations.gust", { gust: value(w.gust) }) : "");
  }

  // «for 3 min siden», «Nå nettopp», eller «Gammel måling, kl. 13.05» når den er gammel.
  function ageText(item, now) {
    var age = ageMinutes(item, now);
    if (age === null) return text("stations.noData");
    if (age > oldMinutes(item)) return text("stations.old", { time: W().formatClock(Date.parse(item.time)) });
    return age < 1 ? text("stations.justNow") : text("stations.minutesAgo", { n: age });
  }

  // Temperatur, fuktighet, trykk og regn (når det regner), de stasjonen har, som målt: «6,2 °C · 81 % · 1012,4 hPa».
  function otherText(item) {
    var parts = [];
    if (isNum(item.temperature)) parts.push(value(item.temperature) + " °C");
    if (isNum(item.humidity)) parts.push(value(item.humidity) + " %");
    if (isNum(item.pressure)) parts.push(value(item.pressure) + " hPa");
    if (isNum(item.rain) && item.rain > 0) parts.push(value(item.rain) + " mm");
    return parts.join(" · ");
  }

  // «460 moh», høyden over havet til stasjonen fra kilden, eller "" når den ikke sender den.
  function altitudeText(item) { return isNum(item.altitude) ? text("stations.masl", { m: Math.round(item.altitude) }) : ""; }

  // Laveste og høyeste temperatur i historikken (de siste timene), { min, max, hours }, eller null når stasjonen ikke
  // sender temperatur (rader uten en sjette verdi, fra før datatjenesten tok vare på den).
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

  // Stasjonens egen side hos kilden: adressen datatjenesten gir (url), eller Holfuys for en Holfuy-stasjon
  // fra før den ga en. null når kilden ikke har en side per stasjon (MET).
  function isHolfuy(item) { return !item.source || /holfuy/i.test(item.source); }

  // Klubbens stasjoner (Holfuy, der vi flyr) først, så METs (i området, ofte ved sjøen eller på en flyplass), hver i
  // sin egen rekkefølge: { club: [...], met: [...] }.
  function groups(items) {
    return { club: items.filter(isHolfuy), met: items.filter(function (i) { return !isHolfuy(i); }) };
  }
  function holfuyUrl(item) { return "https://holfuy.com/en/weather/" + encodeURIComponent(String(item.id)); }
  function stationUrl(item) {
    if (typeof item.url === "string" && /^https:\/\//.test(item.url)) return item.url;
    return isHolfuy(item) ? holfuyUrl(item) : null;
  }

  // --- Endring over en periode (værsiden) ---
  // Hvordan vinden har endret seg de siste `minutes`: den siste målingen mot den som er nærmest så lenge før, og
  // over målingene imellom det høyeste kastet og hvor langt kastene i snitt ligger over middelvinden.
  // { speed, gust, dir (grader, korteste vei, + med klokka), spread, maxGust, minutes } med null for det som mangler,
  // eller null uten to målinger i perioden.
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

  // «▲ +0,8», «▼ −0,4» eller «● 0»: en endring med pil og fortegn, så den ikke vises med farge alene.
  function signed(v) {
    if (!isNum(v)) return "";
    if (v === 0) return "● 0";
    return (v > 0 ? "▲ +" : "▼ −") + value(Math.abs(v));
  }

  // Hvor jevn vinden er, ut fra hvor langt kastene i snitt ligger over middelvinden: "steady" under 2,5 m/s, "gusty"
  // under 4, ellers "turbulent". Og om middelvinden øker eller avtar: "stable" innenfor ±0,5 m/s.
  function character(ch) {
    if (!ch || !isNum(ch.spread)) return null;
    return {
      kind: ch.spread < 2.5 ? "steady" : ch.spread < 4 ? "gusty" : "turbulent",
      trend: !isNum(ch.speed) || Math.abs(ch.speed) < 0.5 ? "stable" : ch.speed > 0 ? "rising" : "falling",
    };
  }

  // Prognosen for et flysted fra timen nå: { now: { dir, speed, gust }, next: [{ time, dir, speed, gust }] } for
  // `hours` timer etter denne, og past: hva prognosen sa for timene før (når datatjenesten har dem).
  // Null uten prognose for stedet.
  function forecastFrom(forecast, siteId, now, hours) {
    var Wn = W();
    if (!forecast || !siteId || !forecast.sites || !forecast.sites[siteId] || !Wn) return null;
    var i = Wn.slotIndex(forecast.times, "0", now);
    if (i < 0) return null;
    var at = function (k) { var w = Wn.windAt(forecast, siteId, k); return w ? { time: Date.parse(forecast.times[k]), dir: w.dir, speed: w.speed, gust: w.gust } : null; };
    var next = [];
    for (var k = i + 1; k < forecast.times.length && next.length < hours; k++) { var w = at(k); if (w) next.push(w); }
    // Prognosen slik den sto i timene før denne (past fra datatjenesten), i samme form.
    var start = Date.parse(forecast.times[i]);
    var past = ((forecast.past && forecast.past[siteId]) || []).filter(function (r) {
      return Array.isArray(r) && typeof r[0] === "string" && Date.parse(r[0]) < start && isNum(r[2]) && okNum(r[1]) && okNum(r[3]);
    }).map(function (r) { return { time: Date.parse(r[0]), dir: r[1], speed: r[2], gust: r[3] }; });
    return { now: at(i), next: next, past: past };
  }

  // Den siste målingen fra en stasjon til vurderingen av timen nå (wind.js rateNow), så lenge den er høyst FRESH_MINUTES
  // gammel: { item, wind, steady, rising }, der steady betyr at vinden den siste halvtimen verken øker eller er byget,
  // som en måling som er bedre enn prognosen, trenger for å telle. Null uten en fersk måling.
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

  // --- Vurdering og tabellrader (værsiden og Vær-fanen) ---
  // Vindreglene (src/_data/windRules.json), som siden gir: forsiden fra prognosedataene sine, værsiden
  // fra sine egne.
  var rules = null;
  function useRules(r) { rules = r || null; }
  // Symbolet i hver vurderingsbrikke, så vurderingen ikke hviler på farge alene (som på forsiden).
  var ICONS = { ok: "✓", maybe: "?", high: "!", no: "×" };

  function hasWind(item, now) { return !isOld(item, now) && !!item.wind && isNum(item.wind.speed); }
  // id-en til kortet for en stasjon på værsiden, «stasjon-490».
  function anchor(item) { return "stasjon-" + String(item.id).replace(/[^\w-]/g, ""); }

  // En grov vurdering av den målte vinden, med de samme reglene som prognosen (wind.js): for en stasjon på et flysted
  // mot startretningene og grensene til stedet; for en stasjon som ikke er det, bare styrken (for mye vind eller for
  // kraftige kast), siden den uten startretninger ikke kan si at det kan passe. { rating, reasons } eller null.
  function assess(item, now) {
    if (!rules || !hasWind(item, now)) return null;
    var w = item.wind, site = siteInfo(item.site);
    var wind = { dir: w.dir, speed: w.speed, gust: isNum(w.gust) ? w.gust : null };
    if (site) return W().rateWind({ primary: site.primary || [], possible: site.possible || [], maxWind: site.maxWind == null ? null : site.maxWind, soarMinWind: site.soarMinWind == null ? null : site.soarMinWind }, wind, rules);
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

  // Én stasjon som en rad, en lenke til `href` (kortet): vindrosen til stedet med den målte pilen, navnet,
  // vurderingsbrikken, stedet, kilden, høyde og alder, retningen mot startretningene, og til høyre vinden (kast),
  // endringen over `minutes` og hvor jevn vinden er. compact (Vær-fanen, omtrent like høy som stedskortene ved siden
  // av): endringen uten perioden på skjermen (merknaden under listen oppgir den), så den høyre kolonnen holder seg smal.
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
    // Kompakt: kilden og høyden overlates til værsiden, og retningen kommer ved siden av brikken (CSS).
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

  // Hvor langt (km) en stasjon er fra det nærmeste startstedet siden kjenner (sites-data), for rekkefølgen i METs
  // tabell; Infinity når det er ukjent, så de kommer sist.
  function nearestKm(item, list) {
    if (!isNum(item.lat) || !isNum(item.lon)) return Infinity;
    return list.reduce(function (best, s) {
      if (!isNum(s.lat) || !isNum(s.lon)) return best;
      var d = Math.hypot((s.lat - item.lat) * 111.32, (s.lon - item.lon) * 111.32 * Math.cos(item.lat * Math.PI / 180));
      return Math.min(best, d);
    }, Infinity);
  }

  // METs stasjoner som en liten sammenbrettet tabell under klubbens (Vær-fanen, værsiden): de er mange, og de sier
  // lite om vinden på startstedene, så de får ingen kort. Én rad per stasjon: navn og høyde, vinden (kast),
  // retningen og når den ble målt. open: om den var åpen før siden ble tegnet på nytt. Null uten METs stasjoner.
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

  // Navnet på stasjonen som en lenke til siden dens hos kilden, i en ny fane, som skjermlesere får beskjed om (slik
  // external()-makroen gjør); bare navnet når kilden ikke har en slik side.
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

  // --- Tegning ---
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

  // Rader fra historikken med middelvind: [time ms, dir, speed, gust, min, temperature], eldste først.
  function chartRows(item) {
    return item.history.filter(function (r) { return isNum(r[2]); })
      .map(function (r) { return [Date.parse(r[0]), r[1], r[2], isNum(r[3]) ? r[3] : null, isNum(r[4]) ? r[4] : null, isNum(r[5]) ? r[5] : null]; });
  }

  // Skalaen på grafen: 0 opp til et rundt tall over det høyeste kastet, med 2, 5 eller 10 m/s mellom linjene.
  function scale(max) {
    var step = max <= 8 ? 2 : max <= 20 ? 5 : 10;
    return { top: Math.max(4, Math.ceil(max / step) * step), step: step };
  }

  // Flystedet til en stasjon, fra siden: startretningene (primary, possible) og posisjonen til startstedet
  // (lat, lon), og navnet og adressen der siden har dem. Stedssiden har sitt eget sted (site-data), forsiden
  // og værsiden alle steder (sites-data). Null for en stasjon
  // som ikke står på et flysted, eller et sted siden ikke kjenner.
  var sites = null;
  function siteInfo(siteId) {
    var FS = globalThis.FlyingSites;
    if (!siteId || !FS || !FS.readJson) return null;
    if (!sites) {
      sites = {};
      (FS.readJson("sites-data") || []).forEach(function (s) { sites[s.id] = { primary: s.primary, possible: s.possible, lat: s.lat, lon: s.lon, name: s.name, url: s.url, maxWind: s.maxWind == null ? null : s.maxWind, soarMinWind: s.soarMinWind == null ? null : s.soarMinWind }; });
      var one = FS.readJson("site-data"), page = document.getElementById("station-now");
      if (one && page) {
        var dirs = one.wind_directions || {}, launch = one.launch || {};
        sites[page.getAttribute("data-site")] = { primary: dirs.primary, possible: dirs.possible, lat: launch.lat, lon: launch.lon };
      }
    }
    return sites[siteId] || null;
  }
  var launchDirs = siteInfo;

  // Hvor en stasjon skal vises på et kart: sin egen posisjon fra kilden, ellers startstedet til flystedet (stasjonen
  // står ved startstedet), ellers ingen steder ([lat, lon] eller null).
  function position(item) {
    if (isNum(item.lat) && isNum(item.lon)) return [item.lat, item.lon];
    var site = siteInfo(item.site);
    return site && isNum(site.lat) && isNum(site.lon) ? [site.lat, site.lon] : null;
  }

  // «startretning», «mulig retning» eller «utenfor startretningene»: hvor den målte vinden er på vindrosen til stedet.
  function launchText(dir, dirs) {
    if (!isNum(dir) || !dirs) return "";
    return text("stations.launch_" + globalThis.FlyingSites.directionType({ primary: dirs.primary || [], possible: dirs.possible || [] }, W().directionCode(dir)));
  }

  // Vindrosen, som på stedssiden: startretningene til stedet i sektorene (alle blanke for en stasjon som ikke
  // står på et flysted), med den målte vinden som en pil tvers over i retningen vinden blåser.
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
      // Pilen to ganger: bred i kortfargen under, så den skiller seg ut på både blanke og fylte sektorer.
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

  // Vinden nå: kompasset og tallene slik de ble målt, «4,4 m/s» stort, så «kast 7,2 · min 2» og «SV 225°».
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

  // Én måling i ord, for verktøytipset og for skjermlesere: «kl. 14.05: SV 225°, 4,4 m/s, kast 7,2, min 2».
  function rowText(r) {
    var wind = windText({ wind: { dir: r[1], speed: r[2], gust: r[3] } });
    return text("stations.at", { time: W().formatClock(r[0]) }) + ": " + wind + (isNum(r[4]) ? text("stations.min", { min: value(r[4]) }) : "") +
      (isNum(r[5]) ? ", " + value(r[5]) + " °C" : "");
  }

  // De siste timene som en graf: spennet fra den laveste vinden til kastene som et lyst bånd, middelvinden som en
  // linje på det, hvor vinden kom fra som piler langs toppen, og timene langs bunnen. Peker og piltaster viser hver
  // måling med tallene. Hull på mer enn 20 minutter uten målinger står åpne.
  // fc (valgfri, «Målt mot varslet» på værsiden): prognosen, [{ time, speed, gust }], tegnet stiplet, med en linje
  // ved den siste målingen; timene før den er det prognosen sa da. Prognosen er per time og gjelder fra sin tid.
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

    // Temperaturen, når stasjonen sender den, i en egen stripe under på den samme tidslinjen (egen skala i °C, så
    // grafen aldri har to skalaer ved siden av hverandre).
    var temps = rows.filter(function (r) { return isNum(r[5]); });
    var tTop = H + 14, tH = 44, Ht = temps.length >= 2 ? tTop + tH + 6 : H;
    var svg = svgEl("svg", { class: "station-graph__svg", viewBox: "0 0 " + Wd + " " + Ht, tabindex: "0", role: "img" });
    // Perioden endringen regnes over (værsiden), som et lyst område til høyre.
    if (periodMinutes) {
      var p0 = Math.max(t0, tLast - periodMinutes * 60000);
      svgEl("rect", { class: "station-graph__period", x: f(x(p0)), y: top, width: f(x(tLast) - x(p0)), height: H - top - bottom }, svg);
    }
    // Linjene i skalaen, med m/s til venstre.
    for (var v = 0; v <= sc.top; v += sc.step) {
      svgEl("line", { class: v ? "station-graph__grid" : "station-graph__base", x1: left, x2: Wd - right, y1: f(y(v)), y2: f(y(v)) }, svg);
      svgEl("text", { class: "station-graph__ylabel", x: left - 5, y: f(y(v) + 4) }, svg).textContent = String(v);
    }
    // Hele timer langs bunnen (timen i Oslo; hele timer er de samme i UTC).
    for (var h = Math.ceil(t0 / 3600000) * 3600000; h <= t1; h += 3600000) {
      if (x(h) - left < 8) continue;
      svgEl("line", { class: "station-graph__tick", x1: f(x(h)), x2: f(x(h)), y1: H - bottom, y2: H - bottom + 4 }, svg);
      var hour = W().osloParts(h).hour;
      svgEl("text", { class: "station-graph__xlabel", x: f(x(h)), y: H - 4 }, svg).textContent = (hour < 10 ? "0" : "") + hour;
    }
    // Serier av målinger uten lange hull.
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
    // Prognosen som trapper (hver time gjelder for timen), stiplet: middelvinden og, lysere, kastene. Timene før
    // den siste målingen (det prognosen sa da) ligger over målingene, til sammenligning.
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
    // Hvor vinden kom fra, én pil per halvtime (målingen nærmest midten av den).
    for (var a = t0; a < t1; a += 1800000) {
      var mid = Math.min(a + 900000, t1), best = null;
      rows.forEach(function (r) { if (isNum(r[1]) && r[0] >= a && r[0] < a + 1800000 && (!best || Math.abs(r[0] - mid) < Math.abs(best[0] - mid))) best = r; });
      if (best) svgEl("path", { class: "station-graph__arrow", d: "M0 -6l4 9-4-2.5-4 2.5z",
        transform: "translate(" + f(x(best[0])) + " 10) rotate(" + Math.round(best[1] + 180) + ")" }, svg);
    }
    // Målingen som vises med peker eller taster.
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

  // Hvor målingen kommer fra: «Kilde: Holfuy, stasjon 490» eller «Kilde: MET Norge, stasjon SN84970», med kilden
  // som lenke til stasjonen der når den har en side.
  function sourceLine(item) {
    var p = make("p", "station__source", text("stations.source", { source: "" }).trim() + " ");
    var a = stationLink(item);
    a.firstChild.textContent = item.source || "Holfuy";
    p.append(a, document.createTextNode(text("stations.stationId", { id: String(item.id) })));
    return p;
  }

  // En stasjon som et kort: navnet (til Holfuy) og hvor gammel målingen er, vinden nå med kompasset, resten,
  // og grafen for de siste timene. En gammel måling viser bare alderen og grafen. På stedssiden (med «Målt nå
  // på» foran navnet), og i popupen i kartet (uten grafen på små kart).
  // sitePage: true på stedssiden («Målt nå på …»), eller avstanden i km for en stasjon i nærheten («Målt nå 1,3 km
  // unna, på …»).
  function card(item, nowMs, tag, sitePage, noChart) {
    var old = isOld(item, nowMs);
    var el = make(tag, "station" + (old ? " station--old" : ""));
    var head = make("div", "station__head");
    var name = make("span", "station__title");
    if (sitePage) {
      var lead = isNum(sitePage) ? text("stations.nearNow", { km: value(sitePage), name: "" }) : text("stations.siteNow", { name: "" });
      name.appendChild(document.createTextNode(lead.trim() + " "));
    }
    name.appendChild(stationLink(item, "station__name"));
    head.append(name, make("span", "station__age", [altitudeText(item), ageText(item, nowMs)].filter(Boolean).join(" · ")));
    el.appendChild(head);
    if (!old && item.wind && isNum(item.wind.speed)) {
      el.appendChild(windNow(item));
      // Trenden den siste halvtimen: «Siste 30 min: ▲ +0,8 · Jevn vind, øker».
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

  // Stasjonene som kartlaget «Værstasjoner» (på som standard): en kompasskive med en pil for hvor vinden blåser, og
  // middelvinden og kastet slik de ble målt («4,4 (7,2)»), dempet når målingen er gammel. Et trykk viser kortet til
  // stasjonen, med grafen når kartet er høyt nok. Brukes på forsidekartet og kartet på stedssiden. onData(data, now)
  // kalles med hvert nye svar, til sidens eget bruk (listen i Vær-fanen).
  // Stasjonene på et kart: klubbens og METs i hvert sitt lag, som små runde markører med middelvinden (eller
  // temperaturen, valgt med «Vind | Temp» på kartet) og et hakk i kanten som peker dit vinden blåser. Zoomet ut
  // tynnes markører som ville overlappet: klubbens blir alltid stående, så METs med sterkest vind (thin()). Zoomet
  // inn (LABEL_ZOOM) viser en etikett ved hver vind og kast slik de ble målt, eller temperaturen.
  var THIN_ZOOM = 12, LABEL_ZOOM = 11, THIN_PX = 34, MODE_KEY = "fs-station-mode";
  function readMode() { try { return localStorage.getItem(MODE_KEY) === "temp" ? "temp" : "wind"; } catch (e) { return "wind"; } }
  function saveMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* private window: not remembered */ } }

  // Innholdet i markøren som et fragment, bare fra tall. mode: "wind" eller "temp".
  function markerContent(item, now, mode) {
    var old = isOld(item, now), w = item.wind || {};
    var hasW = !old && isNum(w.speed), hasT = !old && isNum(item.temperature);
    var out = document.createDocumentFragment(), label = make("span", "station-marker__label");
    if (!isHolfuy(item)) label.appendChild(make("span", "station-marker__tag", "MET"));
    if (mode === "temp") {
      label.append(hasT ? value(item.temperature) + " °C" : "–");
      out.append(make("span", "station-marker__dial", hasT ? Math.round(item.temperature) + "°" : "–"), label);
      return out;
    }
    // Hakket: hele markøren dreid etter retningen, med hakket nederst (der en vind fra nord blåser).
    if (hasW && isNum(w.dir)) {
      var notch = out.appendChild(make("span", "station-marker__notch"));
      notch.setAttribute("data-dir", String(Math.round(w.dir)));
    }
    if (!hasW) label.append("–");
    else if (!isNum(w.gust)) label.append(value(w.speed));
    else label.append(value(w.speed) + " ", make("small", null, "(" + value(w.gust) + ")"));
    out.append(make("span", "station-marker__dial", hasW ? String(Math.round(w.speed)) : "–"), label);
    return out;
  }
  function markerClass(item, now, mode) {
    var cold = mode === "temp" && !isOld(item, now) && isNum(item.temperature) && item.temperature <= 0;
    return "station-marker" + (isHolfuy(item) ? "" : " station-marker--met") + (isOld(item, now) ? " station-marker--old" : "") +
      (mode === "temp" ? " station-marker--temp" : "") + (cold ? " station-marker--cold" : "");
  }
  // Hvilke markører som skal vises på denne zoomen: alle fra THIN_ZOOM; under det grådig fra den viktigste, uten dem
  // innenfor THIN_PX fra en som alt vises. entries: [{ item, latlng }]; project: latlng → punkt. Gir et Set med entries.
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
    // To lag, så METs stasjoner (i området, mest én gang i timen) kan slås av og ikke forveksles med klubbens.
    // Laget for MET legges til når den første MET-stasjonen kommer.
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
    // Dreiningen av hakket settes på elementet når markøren er på kartet, ikke i HTML-en: siden tillater ingen
    // innebygde stiler (CSP style-src 'self').
    function turnNotch(marker) {
      var el = marker.getElement(), notch = el && el.querySelector(".station-marker__notch");
      if (notch) notch.style.transform = "rotate(" + notch.getAttribute("data-dir") + "deg)";
    }
    // En stasjon som er plassert ved startstedet til stedet sitt (ingen egen posisjon), tegnes opp og til høyre for
    // punktet, så den ikke dekker markøren til selve startstedet.
    function icon(item, now, atLaunch) {
      var met = !isHolfuy(item), size = met ? 26 : 30;
      var shown = mode;
      return FS.divIcon({ className: markerClass(item, now, shown), content: function () { return markerContent(item, now, shown); },
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

    // «Vind | Temp»: hva markørene viser. Legges til med de første dataene, huskes i denne nettleseren.
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
            entries.forEach(function (e) { e.marker.setIcon(icon(e.item, lastNow, e.atLaunch)); turnNotch(e.marker); });
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
        // METs stasjoner under alt annet (startstedene, klubbens stasjoner), så de aldri dekker dem.
        var marker = L.marker(at, { icon: icon(item, now, atLaunch), keyboard: true, title: item.name, zIndexOffset: isHolfuy(item) ? 500 : -1000 })
          .bindPopup(box, { autoPanPaddingTopLeft: [60, 90], autoPanPaddingBottomRight: [20, 110] });
        marker.on("add", function () { turnNotch(marker); });
        entries.push({ item: item, latlng: L.latLng(at), marker: marker, atLaunch: atLaunch });
      });
      thin();
      if (!modeControl && entries.length) addModeControl();
      if (onData) onData(data, now);
    });
    return layer;
  }


  // Henter stasjonene nå og hvert minutt mens siden er synlig, og kaller done(data) med hvert nye svar i
  // riktig form. Ved feil skjer ingenting, og siden beholder det den har.
  // Én henteløkke per adresse, delt av alt på siden som følger med på den (kortet på stedssiden og kartet der).
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
          // Hver stasjon har med seg kilden til datasettet, for kildelinjen på kortet.
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

  // --- Hvor godt prognosen traff (verifiseringen i datatjenesten) ---
  // Under så mange timer sier tallene lite, så bare hvor langt innsamlingen har kommet, vises.
  var VERIFY_MIN_HOURS = 24;
  function verifyStrength(v) {
    if (Math.abs(v) < 0.3) return text("stations.vAbout");
    return text(v > 0 ? "stations.vStronger" : "stations.vWeaker", { v: value(Math.abs(v)) });
  }
  // «1,2 °C varmere enn varslet», «0,8 hPa lavere enn varslet», eller omtrent som varslet innenfor en halv enhet.
  function verifyDiff(v, more, less) {
    if (Math.abs(v) < 0.5) return text("stations.vAbout");
    return text(v > 0 ? more : less, { v: value(Math.abs(v)) });
  }
  // Linjene for oppsummeringen av ett sted (workers/data/src/sources/verify.js), som ren tekst: [] uten en.
  function verifyLines(s, days) {
    if (!s || !isNum(s.hours)) return [];
    if (s.hours < VERIFY_MIN_HOURS) return [text("stations.vCollecting", { n: s.hours, min: VERIFY_MIN_HOURS })];
    var lines = [text("stations.vMean", { days: days, hours: s.hours, strength: verifyStrength(s.bias), mae: value(s.mae) })];
    if (isNum(s.gustBias)) lines.push(text("stations.vGust", { strength: verifyStrength(s.gustBias) }));
    if (isNum(s.dirHit)) lines.push(text("stations.vDir", { pct: Math.round(s.dirHit * 100) }));
    // Temperaturen og trykket, der stasjonen måler dem (Heia begge, de fleste stasjoner ingen av dem).
    if (isNum(s.tempBias) && isNum(s.tempMae) && s.tempHours >= VERIFY_MIN_HOURS) lines.push(text("stations.vTemp", { strength: verifyDiff(s.tempBias, "stations.vWarmer", "stations.vColder"), mae: value(s.tempMae) }));
    if (isNum(s.pressureBias) && isNum(s.pressureMae) && s.pressureHours >= VERIFY_MIN_HOURS) lines.push(text("stations.vPressure", { strength: verifyDiff(s.pressureBias, "stations.vHigher", "stations.vLower"), mae: value(s.pressureMae) }));
    var worst = Object.keys(s.sectors || {}).sort(function (a, b) { return Math.abs(s.sectors[b].bias) - Math.abs(s.sectors[a].bias); })[0];
    if (worst && Math.abs(s.sectors[worst].bias) >= 1) lines.push(text("stations.vSector", { dir: globalThis.FlyingSites.DIRECTION_LABELS[worst], v: signed(s.sectors[worst].bias) }));
    return lines;
  }
  // En blokk med overskriften og linjene for `siteId`, eller null når datatjenesten ikke har noe for det. nearName:
  // navnet på stasjonen når den står i nærheten og ikke på stedet, sagt under overskriften.
  function verifyBlock(data, siteId, nearName) {
    var s = data && data.sites && data.sites[siteId];
    var lines = verifyLines(s, data && data.days);
    if (!lines.length) return null;
    if (nearName) lines.unshift(text("stations.vNear", { name: nearName }));
    var box = make("div", "station-verify");
    box.appendChild(make("strong", "station-verify__title", text("stations.vTitle")));
    lines.forEach(function (l) { box.appendChild(make("span", null, l)); });
    // Hva tallene betyr, sammenbrettet.
    var help = make("details", "help-fold");
    help.appendChild(make("summary", null, text("help.howToRead")));
    help.appendChild(make("p", null, text("stations.vExplain")));
    box.appendChild(help);
    return box;
  }
  // Henter verifiseringen én gang (den endres to ganger i timen), og kaller done(data) når den har riktig form.
  var verifyCache = {};
  function loadVerification(url, done) {
    if (!url || typeof fetch !== "function") return;
    if (!verifyCache[url]) {
      verifyCache[url] = fetch(url, { credentials: "omit" }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return d && d.dataset === "verification" && d.sites && typeof d.sites === "object" ? d : null; })
        .catch(function () { return null; });
    }
    verifyCache[url].then(function (d) { if (d) done(d); });
  }

  // Oppføringen til stasjonen for et flysted i nærheten ({ site, km }), eller null.
  function nearOf(item, siteId) {
    var list = Array.isArray(item.near) ? item.near : [];
    for (var k = 0; k < list.length; k++) if (list[k] && list[k].site === siteId && isNum(list[k].km)) return list[k];
    return null;
  }

  // Stedssiden: stasjonen på dette flystedet (item.site), ellers en i nærheten (item.near), som et kort med
  // navnet på stasjonen som lenke til Holfuy, og Holfuy-knappen blant værlenkene. Ingenting når stedet har ingen av dem.
  // En stasjon i nærheten vises med stedets egen vindrose og hvor langt unna den er.
  var siteEl = typeof document !== "undefined" && document.getElementById("station-now");
  if (siteEl) {
    var linkEl = document.getElementById("station-link");
    watch(siteEl.getAttribute("data-url"), function (data) {
      var now = Date.now(), site = siteEl.getAttribute("data-site");
      var item = data.items.filter(function (i) { return i.site === site; })[0];
      var near = null;
      if (!item) {
        item = data.items.filter(function (i) { return nearOf(i, site); })[0];
        near = item ? nearOf(item, site) : null;
      }
      siteEl.hidden = !item;
      // «Holfuy»-knappen blant værlenkene, bare for en Holfuy-stasjon.
      if (linkEl) linkEl.hidden = !item || !isHolfuy(item);
      if (!item) return;
      if (linkEl && isHolfuy(item)) linkEl.href = stationUrl(item);
      siteEl.replaceChildren(near ? card(Object.assign({}, item, { site: site }), now, "div", near.km) : card(item, now, "div", true));
      // Hvor godt prognosen har truffet her, under kortet.
      loadVerification(siteEl.getAttribute("data-verify-url"), function (v) {
        var block = verifyBlock(v, site, near ? item.name : null);
        var old = siteEl.querySelector(".station-verify");
        if (old) old.remove();
        if (block) siteEl.appendChild(block);
      });
    });
  }

  globalThis.FlyingSitesStations = {
    OLD_MINUTES: OLD_MINUTES,
    OLD_MINUTES_MET: OLD_MINUTES_MET,
    thinned: thinned,
    markerContent: markerContent,
    groups: groups,
    metTable: metTable,
    verifyLines: verifyLines,
    verifyBlock: verifyBlock,
    nearOf: nearOf,
    loadVerification: loadVerification,
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
