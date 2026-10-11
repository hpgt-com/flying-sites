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

  render();
  // The current hour and the forecast's age change while the page is open.
  setInterval(render, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) render(); });
})();
