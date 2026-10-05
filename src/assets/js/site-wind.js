// «Vind nå» på stedssiden: grov vurdering for starten fra MET-varselet, med samme regler som forsiden
// (wind.js). Dataene ligger i #site-wind-data (site.njk). Uten varsel, eller når varselet er for gammelt
// eller ikke dekker timen nå, sier boksen det i stedet for å vurdere.
(function () {
  "use strict";

  var FS = window.FlyingSites;
  var W = window.FlyingSitesWind;
  var el = document.getElementById("site-wind");
  var data = FS && W && el ? FS.readJson("site-wind-data") : null;
  if (!data || !data.series) return;

  var forecast = { fetched: data.fetched, times: data.times, sites: {} };
  forecast.sites[data.site.id] = data.series;
  // Bygges med DOM-metoder, ikke innerHTML, så ingenting fra dataene tolkes som HTML.
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

  function render() {
    var now = Date.now();
    if (W.isStale(forecast, data.rules, now)) {
      show("none", [["strong", "Varselet er for gammelt"], ["span", "Vindvurderingen er slått av til siden er oppdatert. Sjekk Yr eller Windy."]]);
      return;
    }
    var index = W.slotIndex(forecast.times, "0", now);
    var wind = W.windAt(forecast, data.site.id, index);
    if (!wind) {
      show("none", [["strong", "Ingen vindvurdering nå"], ["span", "Varselet dekker ikke timen nå. Sjekk Yr eller Windy."]]);
      return;
    }
    var rating = W.rateWind(data.site, wind, data.rules);
    var text = FS.DIRECTION_LABELS[W.directionCode(wind.dir)] + " " + Math.round(wind.speed) + " m/s" +
      (wind.gust != null ? ", kast " + Math.round(wind.gust) : "");
    show(rating.rating, [
      ["span", "Vind nå, kl. " + W.formatClock(Date.parse(forecast.times[index])), "site-wind__time"],
      ["strong", W.RATINGS[rating.rating].label + ": " + text],
      ["span", (rating.reasons.length ? rating.reasons.join(". ") + ". " : "") + "Grov vurdering fra MET-varselet, sjekk alltid selv."],
    ]);
  }

  render();
  // Timen og varselets alder endrer seg mens siden står åpen.
  setInterval(render, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) render(); });
})();
