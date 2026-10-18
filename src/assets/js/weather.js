// The weather page (vaer.njk): all the weather stations, first as a table, then a card per station with the change over the
// chosen period, the wind rose of its flying site, the chart of the last hours, and «Målt mot varslet» with the forecast for
// the site. Everything is built with DOM methods (stations.js), so nothing from the data is read as HTML. Refreshed every
// minute (stations.js watch); the forecast is fetched from the data service every ten minutes.
(function () {
  "use strict";

  var FS = window.FlyingSites, W = window.FlyingSitesWind, ST = window.FlyingSitesStations;
  var cardsEl = document.getElementById("weather-cards");
  if (!FS || !W || !ST || !cardsEl) return;
  var rowsEl = document.getElementById("weather-rows");
  var statusEl = document.getElementById("weather-status");
  var t = FS.t, make = ST.make, value = ST.value;
  var isNum = function (v) { return typeof v === "number" && Number.isFinite(v); };

  var period = 30, sort = "name", data = null, forecast = null;
  var rules = FS.readJson("weather-rules");
  // The symbol in each rating chip, so the rating does not rest on colour alone (as on the home page).
  var ICONS = { ok: "✓", maybe: "?", high: "!", no: "×" };

  // A rough assessment of the measured wind, with the same rules as the forecast (wind.js): for a station on a flying site
  // against the site's launch directions and limits; for a station that is not, only the strength (too much wind or too
  // strong gusts), since without launch directions it cannot say that it may work. { rating, reasons } or null.
  function assess(item, now) {
    if (!rules || !hasWind(item, now)) return null;
    var w = item.wind, site = ST.siteInfo(item.site);
    var wind = { dir: w.dir, speed: w.speed, gust: isNum(w.gust) ? w.gust : null };
    if (site) return W.rateWind({ primary: site.primary || [], possible: site.possible || [], maxWind: site.maxWind }, wind, rules);
    if (!isNum(w.dir)) return null;
    var all = { primary: FS.DIRECTIONS, possible: [], maxWind: null };
    var r = W.rateWind(all, wind, rules);
    return r.rating === "high" ? r : null;
  }
  function chip(r) {
    var el = make("span", "rating-chip rating-chip--" + r.rating);
    var icon = make("span", null, ICONS[r.rating]);
    icon.setAttribute("aria-hidden", "true");
    el.append(icon, document.createTextNode(W.RATINGS[r.rating].label));
    return el;
  }
  // The «Målt mot varslet» parts that are open, so they stay open when the page is redrawn.
  var openVs = {};

  function periodText() { return t("stations.period_" + period); }
  function anchor(item) { return "stasjon-" + String(item.id).replace(/[^\w-]/g, ""); }
  function hasWind(item, now) { return !ST.isOld(item, now) && item.wind && isNum(item.wind.speed); }

  // «▲ +0,8 siste 30 min», or nothing without a change.
  function changeText(v) { return isNum(v) ? t("stations.change", { v: ST.signed(v), period: periodText() }) : ""; }
  function characterText(ch) {
    var c = ST.character(ch);
    return c ? t("stations.char_" + c.kind) + t("stations.trend_" + c.trend) : "";
  }

  // --- The table: one row per station, a link to its card below ---
  function row(item, now) {
    var li = make("li");
    var a = make("a", "weather-row" + (hasWind(item, now) ? "" : " weather-row--old"));
    a.href = "#" + anchor(item);
    var site = ST.siteInfo(item.site), w = item.wind || {};
    a.appendChild(ST.compass(hasWind(item, now) ? w.dir : null, site));
    var rating = assess(item, now);
    if (rating) a.setAttribute("data-rating", rating.rating);
    var info = make("span", "weather-row__info");
    info.appendChild(make("strong", "weather-row__name", item.name));
    if (rating) info.appendChild(chip(rating));
    info.appendChild(make("span", "weather-row__sub", [site && site.name ? t("stations.site", { name: site.name }) : "", ST.altitudeText(item), ST.ageText(item, now)].filter(Boolean).join(" · ")));
    if (hasWind(item, now) && isNum(w.dir)) {
      var where = ST.launchText(w.dir, site);
      info.appendChild(make("span", "weather-row__dir", ST.dirText(w.dir) + (where ? " · " + where : "")));
    }
    a.appendChild(info);
    if (hasWind(item, now)) {
      var ch = ST.change(item, period);
      var nums = make("span", "weather-row__nums");
      nums.appendChild(make("strong", "weather-row__wind", value(w.speed) + (isNum(w.gust) ? " (" + value(w.gust) + ")" : "")));
      if (ch && isNum(ch.speed)) nums.appendChild(make("span", "weather-row__change", changeText(ch.speed)));
      var c = characterText(ch);
      if (c) nums.appendChild(make("span", "weather-row__char", c));
      a.appendChild(nums);
    }
    li.appendChild(a);
    return li;
  }

  // --- The card ---
  function tile(label, big, lines) {
    var el = make("div", "weather-tile");
    el.appendChild(make("span", "weather-tile__label", label));
    el.appendChild(make("strong", "weather-tile__big", big));
    lines.forEach(function (l) { if (l) el.appendChild(make("span", "weather-tile__line", l)); });
    return el;
  }

  // «Målt mot varslet»: the wind, gusts and direction now against the forecast for this hour, the chart with the forecast
  // after the latest measurement, and the next hours. Folded, since it is for those who want to look closer.
  function versus(item, site) {
    var fc = ST.forecastFrom(forecast, item.site, Date.now(), 6);
    var box = make("details", "weather-vs");
    box.open = !!openVs[item.id];
    box.addEventListener("toggle", function () { openVs[item.id] = box.open; });
    box.appendChild(make("summary", null, t("stations.vsTitle")));
    if (!fc || !fc.now) {
      box.appendChild(make("p", "muted", t("stations.noForecast")));
      return box;
    }
    var w = item.wind || {}, f = fc.now;
    var grid = make("div", "weather-vs__grid");
    function line(label, m, fv, diff) {
      grid.append(make("span", "weather-vs__label", label), make("span", null, t("stations.vsRow", { m: m, f: fv })), make("strong", null, diff));
    }
    if (isNum(w.speed) && isNum(f.speed)) line(t("stations.windTile"), value(w.speed), value(f.speed), ST.signed(Math.round((w.speed - f.speed) * 10) / 10));
    if (isNum(w.gust) && isNum(f.gust)) line(t("stations.gustTile"), value(w.gust), value(f.gust), ST.signed(Math.round((w.gust - f.gust) * 10) / 10));
    if (isNum(w.dir) && isNum(f.dir)) {
      var turn = Math.round(((w.dir - f.dir + 540) % 360) - 180);
      line(t("stations.dirTile"), ST.dirText(w.dir), ST.dirText(f.dir), (turn > 0 ? "+" : turn < 0 ? "−" : "") + Math.abs(turn) + "°");
    }
    box.appendChild(grid);
    var graph = ST.chart(item, null, [f].concat(fc.next));
    if (graph) {
      graph.querySelector(".station-graph__legend").appendChild(make("span", "station-graph__key station-graph__key--fc", t("stations.legendFc")));
      box.appendChild(graph);
    }
    if (fc.next.length) {
      box.appendChild(make("strong", "weather-vs__next-title", t("stations.nextTitle")));
      var next = make("ul", "weather-next");
      fc.next.forEach(function (p) {
        var li = make("li");
        li.appendChild(make("span", "weather-next__time", W.formatClock(p.time)));
        if (isNum(p.dir)) li.appendChild(ST.compass(p.dir, site));
        li.appendChild(make("strong", null, value(Math.round(p.speed * 10) / 10)));
        if (isNum(p.gust)) li.appendChild(make("span", "weather-next__gust", "(" + value(Math.round(p.gust * 10) / 10) + ")"));
        next.appendChild(li);
      });
      box.appendChild(next);
    }
    box.appendChild(make("p", "muted weather-vs__note", t("stations.vsNote")));
    return box;
  }

  function card(item, now) {
    var site = ST.siteInfo(item.site), w = item.wind || {};
    var el = make("article", "station weather-card" + (hasWind(item, now) ? "" : " station--old"));
    el.id = anchor(item);
    el.tabIndex = -1;
    var head = make("div", "station__head");
    var h = make("h2", "weather-card__name");
    h.appendChild(ST.stationLink(item, "station__name"));
    head.append(h, make("span", "station__age", [ST.altitudeText(item), ST.ageText(item, now)].filter(Boolean).join(" · ")));
    el.appendChild(head);
    if (site && site.url) {
      var s = make("a", "weather-card__site", t("stations.site", { name: site.name }));
      s.href = site.url;
      el.appendChild(s);
    }
    var rating = assess(item, now);
    if (rating) {
      el.setAttribute("data-rating", rating.rating);
      var verdict = make("p", "weather-card__verdict");
      verdict.appendChild(chip(rating));
      verdict.appendChild(make("span", "muted", (rating.reasons.length ? rating.reasons.join(". ") + ". " : "") + t("weather.roughMeasured")));
      el.appendChild(verdict);
    }
    if (hasWind(item, now)) {
      var ch = ST.change(item, period);
      var tiles = make("div", "weather-tiles");
      var left = make("div", "weather-tiles__col");
      left.appendChild(tile(t("stations.windTile"), t("stations.speed", { speed: value(w.speed) }), [ch && changeText(ch.speed)]));
      left.appendChild(tile(t("stations.gustTile"), isNum(w.gust) ? t("stations.speed", { speed: value(w.gust) }) : "–", [
        ch && changeText(ch.gust),
        ch && isNum(ch.maxGust) ? t("stations.maxMin", { max: value(ch.maxGust), min: isNum(w.min) ? value(w.min) : "–" }) : "",
      ]));
      tiles.appendChild(left);
      var dirTile = make("div", "weather-tile weather-tile--dir");
      dirTile.appendChild(make("span", "weather-tile__label", t("stations.dirTile")));
      dirTile.appendChild(ST.compass(w.dir, site));
      if (isNum(w.dir)) {
        dirTile.appendChild(make("strong", "weather-tile__dir", ST.dirText(w.dir)));
        var where = ST.launchText(w.dir, site);
        if (where) dirTile.appendChild(make("span", "weather-tile__line weather-tile__where", where));
        if (ch && isNum(ch.dir)) dirTile.appendChild(make("span", "weather-tile__line", t("stations.turned", { v: (ch.dir > 0 ? "+" : ch.dir < 0 ? "−" : "") + Math.abs(ch.dir), period: periodText() })));
      }
      tiles.appendChild(dirTile);
      el.appendChild(tiles);
      var c = characterText(ch);
      if (c) {
        var charEl = make("p", "weather-char");
        charEl.append(make("strong", null, c), make("span", "muted", t("stations.charText", { v: value(ch.spread), period: periodText() })));
        el.appendChild(charEl);
      }
      var other = ST.otherText(item);
      if (other) el.appendChild(make("span", "station__other", other));
      var temps = ST.temperatureText(item);
      if (temps) el.appendChild(make("span", "station__other", temps));
    }
    var graph = ST.chart(item, period);
    if (graph) el.appendChild(graph);
    if (item.site && site) el.appendChild(versus(item, site));
    el.appendChild(ST.sourceLine(item));
    return el;
  }

  function sorted(items, now) {
    var list = items.slice();
    if (sort === "wind") {
      var speed = function (i) { return hasWind(i, now) ? i.wind.speed : -1; };
      list.sort(function (a, b) { return speed(b) - speed(a); });
    } else {
      list.sort(function (a, b) { return a.name.localeCompare(b.name, FS.lang); });
    }
    return list;
  }

  function render() {
    if (!data) return;
    var now = Date.now(), items = sorted(data.items, now);
    statusEl.hidden = true;
    rowsEl.replaceChildren.apply(rowsEl, items.map(function (i) { return row(i, now); }));
    cardsEl.replaceChildren.apply(cardsEl, items.map(function (i) { return card(i, now); }));
  }

  function choose(groupId, attr, apply) {
    var group = document.getElementById(groupId);
    if (!group) return;
    group.addEventListener("click", function (ev) {
      var b = ev.target.closest("button[" + attr + "]");
      if (!b) return;
      group.querySelectorAll("button[" + attr + "]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      apply(b.getAttribute(attr));
      render();
    });
  }
  choose("period", "data-period", function (v) { period = Number(v); });
  choose("sort", "data-sort", function (v) { sort = v; });

  ST.watch(cardsEl.getAttribute("data-url"), function (d) { data = d; render(); });
  // Without an answer after a while, say so; the page keeps trying every minute.
  setTimeout(function () { if (!data) statusEl.textContent = t("weather.failed"); }, 15000);

  var forecastUrl = cardsEl.getAttribute("data-forecast-url");
  function loadForecast() { W.fetchNewerForecast(forecastUrl, forecast, function (f) { forecast = f; render(); }); }
  loadForecast();
  setInterval(loadForecast, 10 * 60 * 1000);
})();
