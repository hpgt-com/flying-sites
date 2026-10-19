// «Kan jeg fly her nå?» on the site page: a rough assessment for the launch from the MET forecast, using the same rules as
// the home page (wind.js). The verdict in large type, the next 12 hours as cards, and folded below the periods that may
// work and 48 hours as bars. The data is in #site-wind-data (site.njk). Without a forecast, or when it is too old or does
// not cover the current hour, the box says so instead of assessing. When the site has a weather station with a fresh
// measurement, the hour now is assessed from it as well (wind.js rateNow), and the box says so.
(function () {
  "use strict";

  var FS = window.FlyingSites;
  var W = window.FlyingSitesWind;
  var el = document.getElementById("site-wind");
  var data = FS && W && el ? FS.readJson("site-wind-data") : null;
  // The verdict chip in the image keeps its room until it is filled in (site.njk data-pending); without an assessment
  // it is taken away.
  var heroStatus = document.getElementById("hero-status");
  if (!data || !data.series) {
    if (heroStatus) { heroStatus.hidden = true; heroStatus.removeAttribute("data-pending"); }
    return;
  }

  var forecast = { fetched: data.fetched, times: data.times, sites: {} };
  forecast.sites[data.site.id] = data.series;
  // The symbol in the circle before each rating, so the rating does not rest on colour alone.
  var ICONS = { ok: "✓", maybe: "?", high: "!", no: "×", none: "–" };
  var block = el.closest(".block--now");
  // The same verdict as a chip in the image at the top (site.njk), so it is seen before scrolling. Not without an assessment.
  // Built with DOM methods, not innerHTML, so nothing from the data is parsed as HTML. The first part is the verdict:
  // the icon and the rating in large type.
  function show(rating, parts) {
    el.className = "site-wind site-wind--" + rating;
    if (block) block.setAttribute("data-rating", rating);
    var row = make("div", "site-wind__verdict");
    row.append(make("span", "site-wind__icon", ICONS[rating] || ICONS.none), make("span", "site-wind__word", parts[0]));
    row.firstChild.setAttribute("aria-hidden", "true");
    el.replaceChildren.apply(el, [row].concat(parts.slice(1).map(function (p) { return make(p[0] === "strong" ? "strong" : "span", p[2], p[1]); })));
    el.hidden = false;
    if (heroStatus) {
      heroStatus.hidden = rating === "none";
      heroStatus.removeAttribute("data-pending");
      heroStatus.setAttribute("data-rating", rating);
      heroStatus.querySelector(".hero__status-icon").textContent = ICONS[rating] || ICONS.none;
      heroStatus.querySelector(".hero__status-text").textContent = parts[0];
    }
  }

  // Today's sunrise and sunset at the launch, at the bottom of the box.
  function sun(now) {
    return ["span", W.sunText(W.osloParts(now).date, data.site.lat, data.site.lon), "site-wind__sun"];
  }

  function render() {
    var now = Date.now();
    if (W.isStale(forecast, data.rules, now)) {
      show("none", [FS.t("wind.staleSite"), ["span", FS.t("wind.staleSiteText")], sun(now)]);
      hideDetails();
      return;
    }
    var index = W.slotIndex(forecast.times, "0", now);
    var wind = W.windAt(forecast, data.site.id, index);
    if (!wind) {
      show("none", [FS.t("wind.noneNow"), ["span", FS.t("wind.noneNowText")], sun(now)]);
      hideDetails();
      return;
    }
    var m = measurement(now);
    var assessed = W.rateNow(data.site, wind, m && m.wind, data.rules, m && m.steady);
    var rating = assessed.result;
    renderCards(now);
    renderChart(now);
    renderWindows();
    var text = windText(wind, Math.round);
    var fcLine = FS.t("wind.windNow", { time: W.formatClock(Date.parse(forecast.times[index])) }) + ": " + text;
    var reasons = (rating.reasons.length ? rating.reasons.join(". ") + ". " : "") + (rating.note ? rating.note + " " : "");
    if (assessed.basis === "measured") {
      // Assessed from the station: what it measured first, then the forecast for the hour for comparison.
      show(rating.rating, [
        W.RATINGS[rating.rating].label,
        ["strong", FS.t("wind.measuredNow", { time: W.formatClock(Date.parse(m.item.time)), name: m.item.name }) + ": " + windText(m.wind, measuredValue)],
        ["span", reasons + FS.t("wind.basedOnMeasured", { forecast: text }) + " " + FS.t("wind.roughMeasured")],
        sun(now),
      ]);
      return;
    }
    show(rating.rating, [
      W.RATINGS[rating.rating].label,
      ["strong", fcLine],
      ["span", reasons + (assessed.unsteady ? FS.t(m.rising ? "wind.unsteadyRising" : "wind.unsteadyGusty", { name: m.item.name }) + " " : "") + FS.t("wind.roughNote")],
      sun(now),
    ]);
  }

  // «NØ 5 m/s, kast 8» (forecast, rounded) or «NØ 4,3 m/s, kast 7,2» (measured, as sent), with rain from the forecast.
  function windText(w, num) {
    return FS.DIRECTION_LABELS[W.directionCode(w.dir)] + " " + num(w.speed) + " m/s" +
      (w.gust != null ? ", " + FS.t("wind.gust", { g: num(w.gust) }) : "") +
      (w.rain != null && w.rain >= data.rules.rainMaybe ? ", " + FS.t("wind.rain", { rain: W.formatRain(w.rain) }) : "");
  }
  function measuredValue(v) { return ST ? ST.value(v) : String(v); }

  // The site's weather station (stations.js), when it has one: its latest measurement while it is fresh, and whether the
  // wind is steady (stations.js measurement).
  var ST = window.FlyingSitesStations;
  var stationItem = null;
  function measurement(now) { return ST && stationItem ? ST.measurement(stationItem, now) : null; }
  var stationEl = document.getElementById("station-now");
  if (ST && stationEl) {
    ST.watch(stationEl.getAttribute("data-url"), function (d) {
      stationItem = d.items.filter(function (i) { return i.site === data.site.id; })[0] || null;
      render();
    });
  }
  function hideDetails() {
    [cardsEl, cardsKeyEl, foldEl].forEach(function (n) { if (n) n.hidden = true; });
  }

  // The next 12 hours as cards: the hour, the rating symbol, a bar for the mean wind with a line for the gust, an arrow for
  // where the wind blows and the numbers. The current hour is marked.
  var cardsEl = document.getElementById("hour-cards");
  var cardsKeyEl = document.getElementById("hour-cards-key");
  var foldEl = document.getElementById("now-48");
  var CARD_MAX = 12;
  function renderCards(now) {
    if (!cardsEl) return;
    var start = W.slotIndex(forecast.times, "0", now);
    var items = [];
    for (var i = start; i >= 0 && i < Math.min(forecast.times.length, start + 12); i++) {
      var wind = W.windAt(forecast, data.site.id, i);
      if (!wind) continue;
      var rating = W.rateWind(data.site, wind, data.rules).rating;
      var li = make("li", "hour-card hour-card--" + rating + (i === start ? " hour-card--now" : ""));
      var bar = make("span", "hour-card__bar");
      var fill = bar.appendChild(make("i"));
      fill.style.height = Math.min(100, (wind.speed / CARD_MAX) * 100) + "%";
      if (wind.gust != null) bar.appendChild(make("b")).style.bottom = Math.min(100, (wind.gust / CARD_MAX) * 100) + "%";
      var arrow = make("span", "hour-card__arrow", "↓");
      arrow.style.transform = "rotate(" + Math.round(wind.dir) + "deg)";
      arrow.setAttribute("aria-hidden", "true");
      var numbers = make("span", "hour-card__wind", FS.DIRECTION_LABELS[W.directionCode(wind.dir)] + " " + Math.round(wind.speed));
      if (wind.gust != null) numbers.appendChild(make("small", "", "(" + Math.round(wind.gust) + ")"));
      var icon = make("span", "hour-card__icon", ICONS[rating]);
      icon.setAttribute("aria-hidden", "true");
      var hour = make("span", "hour-card__hour", W.formatClock(Date.parse(forecast.times[i])).slice(0, 2));
      li.append(hour, icon, bar, arrow, numbers, make("span", "visually-hidden", W.RATINGS[rating].label));
      items.push(li);
    }
    cardsEl.replaceChildren.apply(cardsEl, items);
    cardsEl.hidden = cardsKeyEl.hidden = !items.length;
    if (foldEl) foldEl.hidden = false;
  }

  // The next 48 hours as bars: height is the mean wind, the light top is the gust, the colour is the assessment for
  // that hour, and an arrow every third hour shows where the wind comes from. Heights are set through element.style,
  // which the CSP allows.
  var chartEl = document.getElementById("wind-chart");
  var MAX_MS = 14;
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function renderChart(now) {
    if (!chartEl) return;
    var start = W.slotIndex(forecast.times, "0", now);
    if (start < 0) { chartEl.hidden = true; return; }
    var bars = make("div", "wind-chart__bars");
    var axis = make("div", "wind-chart__axis");
    var end = Math.min(forecast.times.length, start + 48);
    for (var i = start; i < end; i++) {
      var ms = Date.parse(forecast.times[i]);
      var wind = W.windAt(forecast, data.site.id, i);
      var col = make("span", "wind-chart__col" + (i === start ? " wind-chart__col--now" : ""));
      if (wind) {
        var rating = W.rateWind(data.site, wind, data.rules).rating;
        var gust = make("span", "wind-chart__gust wind-chart--" + rating);
        gust.style.height = Math.min(100, ((wind.gust != null ? wind.gust : wind.speed) / MAX_MS) * 100) + "%";
        var bar = make("span", "wind-chart__bar wind-chart--" + rating);
        bar.style.height = Math.min(100, (wind.speed / MAX_MS) * 100) + "%";
        col.append(gust, bar);
        if ((i - start) % 3 === 0) {
          var arrow = make("span", "wind-chart__arrow", "↓");
          arrow.style.transform = "rotate(" + Math.round(wind.dir) + "deg)";
          col.append(arrow);
        }
      }
      bars.append(col);
      var hour = W.osloParts(ms).hour;
      axis.append(make("span", "wind-chart__tick", hour % 6 === 0 ? String(hour).padStart(2, "0") : ""));
    }
    var key = make("p", "wind-chart__key", FS.t("wind.chartKey"));
    chartEl.setAttribute("role", "img");
    chartEl.setAttribute("aria-label", FS.t("wind.chartLabel"));
    chartEl.replaceChildren(bars, axis, key);
    chartEl.hidden = false;
  }

  // The periods in daylight the next two days that may work («Kan passe» or «Usikkert»), as chips.
  var windowsEl = document.getElementById("wind-windows");
  function renderWindows() {
    if (!windowsEl) return;
    var days = W.dayWindows(forecast, data.site, data.rules, data.site.lat, data.site.lon);
    var dayName = new Intl.DateTimeFormat(FS.lang === "en" ? "en-GB" : "nb-NO", { weekday: "short", timeZone: "Europe/Oslo" });
    var items = [];
    Object.keys(days).sort().slice(0, 2).forEach(function (date) {
      days[date].forEach(function (w) {
        var li = make("li", "wind-windows__item wind-windows--" + w.rating, FS.t("wind.window", {
          day: dayName.format(w.start), from: W.formatClock(w.start), to: W.formatClock(w.end), rating: W.RATINGS[w.rating].label.toLowerCase(),
        }));
        items.push(li);
      });
    });
    if (!items.length) items.push(make("li", "wind-windows__none", FS.t("wind.noWindows")));
    windowsEl.replaceChildren.apply(windowsEl, items);
    windowsEl.hidden = false;
  }

  render();
  // The space kept for the box while it was empty (site.njk, styles.css) is no longer needed.
  if (block) block.classList.remove("block--now-wait");
  // A newer forecast for this launch from the data service (workers/data), when the page's own is older.
  W.fetchNewerForecast(data.live, forecast, function (newer) {
    forecast = { fetched: newer.fetched, updated: newer.updated, times: newer.times, sites: {} };
    forecast.sites[data.site.id] = newer.sites[data.site.id];
    render();
  });
  // The current hour and the forecast's age change while the page is open.
  setInterval(render, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) render(); });
})();
