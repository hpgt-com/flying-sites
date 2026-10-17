// «Vind nå» on the site page: a rough assessment for the launch from the MET forecast, using the same rules as the home
// page (wind.js). The data is in #site-wind-data (site.njk). Without a forecast, or when it is too old or does not
// cover the current hour, the box says so instead of assessing.
(function () {
  "use strict";

  var FS = window.FlyingSites;
  var W = window.FlyingSitesWind;
  var el = document.getElementById("site-wind");
  var data = FS && W && el ? FS.readJson("site-wind-data") : null;
  if (!data || !data.series) return;

  var forecast = { fetched: data.fetched, times: data.times, sites: {} };
  forecast.sites[data.site.id] = data.series;
  // Built with DOM methods, not innerHTML, so nothing from the data is parsed as HTML.
  function show(rating, parts) {
    el.className = "site-wind site-wind--" + rating;
    el.replaceChildren.apply(el, parts.map(function (p) {
      var node = document.createElement(p[0]);
      if (p[2]) node.className = p[2];
      node.textContent = p[1];
      return node;
    }));
    el.hidden = false;
  }

  // Today's sunrise and sunset at the launch, at the bottom of the box.
  function sun(now) {
    return ["span", W.sunText(W.osloParts(now).date, data.site.lat, data.site.lon), "site-wind__sun"];
  }

  function render() {
    var now = Date.now();
    if (W.isStale(forecast, data.rules, now)) {
      show("none", [["strong", FS.t("wind.staleSite")], ["span", FS.t("wind.staleSiteText")], sun(now)]);
      return;
    }
    var index = W.slotIndex(forecast.times, "0", now);
    var wind = W.windAt(forecast, data.site.id, index);
    if (!wind) {
      show("none", [["strong", FS.t("wind.noneNow")], ["span", FS.t("wind.noneNowText")], sun(now)]);
      return;
    }
    var rating = W.rateWind(data.site, wind, data.rules);
    renderChart(now);
    renderWindows();
    renderLaunches(wind, rating.rating);
    var text = FS.DIRECTION_LABELS[W.directionCode(wind.dir)] + " " + Math.round(wind.speed) + " m/s" +
      (wind.gust != null ? ", " + FS.t("wind.gust", { g: Math.round(wind.gust) }) : "") +
      (wind.rain != null && wind.rain >= data.rules.rainMaybe ? ", " + FS.t("wind.rain", { rain: W.formatRain(wind.rain) }) : "");
    show(rating.rating, [
      ["span", FS.t("wind.windNow", { time: W.formatClock(Date.parse(forecast.times[index])) }), "site-wind__time"],
      ["strong", W.RATINGS[rating.rating].label + ": " + text],
      ["span", (rating.reasons.length ? rating.reasons.join(". ") + ". " : "") + FS.t("wind.roughNote")],
      sun(now),
    ]);
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

  // Startplasser: the wind now, and for each group of launches whether the wind comes from one of its directions.
  var launchNowEl = document.getElementById("launch-now");
  function renderLaunches(wind, rating) {
    var code = wind ? W.directionCode(wind.dir) : null;
    if (launchNowEl) {
      launchNowEl.hidden = !wind;
      if (wind) launchNowEl.textContent = FS.t("wind.launchNow", { text: W.RATINGS[rating].label + ", " + FS.DIRECTION_LABELS[code] + " " + Math.round(wind.speed) + " m/s" });
    }
    document.querySelectorAll(".launch-list li[data-dirs]").forEach(function (li) {
      var chip = li.querySelector(".launch-list__now");
      if (!chip) return;
      var fits = wind && li.getAttribute("data-dirs").split(" ").indexOf(code) !== -1;
      var r = fits ? rating : "no";
      chip.className = "launch-list__now launch-list__now--" + r;
      chip.textContent = fits ? W.RATINGS[rating].label : FS.t("wind.notNow");
      chip.hidden = !wind;
    });
  }

  render();
  // The current hour and the forecast's age change while the page is open.
  setInterval(render, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) render(); });
})();
