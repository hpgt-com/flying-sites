// «Vinden nå – kan det passe?» på stedssiden: en grov vurdering for starten ut fra MET-varselet, med de samme
// reglene som forsiden (wind.js). Dommen med stor skrift, de neste 12 timene som kort, og foldet under periodene som
// kan passe og 48 timer som søyler. Dataene ligger i #site-wind-data (site.njk). Uten varsel, eller når det er for
// gammelt eller ikke dekker inneværende time, sier boksen det i stedet for å vurdere. Når stedet har en værstasjon med
// fersk måling, vurderes timen nå også ut fra den (wind.js rateNow), og boksen sier det.
(function () {
  "use strict";

  var FS = window.FlyingSites;
  var W = window.FlyingSitesWind;
  var el = document.getElementById("site-wind");
  var data = FS && W && el ? FS.readJson("site-wind-data") : null;
  // Dommen som merke i bildet holder av plassen til den er fylt inn (site.njk data-pending). Uten vurdering
  // fjernes den.
  var heroStatus = document.getElementById("hero-status");
  if (!data || !(data.series || data.live)) {
    if (heroStatus) { heroStatus.hidden = true; heroStatus.removeAttribute("data-pending"); }
    return;
  }

  // Varselet som er bygd inn i siden, eller null til datatjenesten har svart (bygget hadde ikke noe).
  var forecast = null, failed = false;
  if (data.series) {
    forecast = { fetched: data.fetched, updated: data.updated, times: data.times, sites: {} };
    forecast.sites[data.site.id] = data.series;
  }
  // Symbolet i sirkelen foran hver vurdering, så vurderingen ikke hviler på farge alene.
  var ICONS = { ok: "✓", maybe: "?", high: "!", no: "×", none: "–" };
  var block = el.closest(".block--now");
  // Samme dom som merke i bildet øverst (site.njk), så den ses før man ruller. Ikke uten vurdering.
  // Bygd med DOM-metoder, ikke innerHTML, så ingenting fra dataene tolkes som HTML. Den første delen er dommen:
  // ikonet og vurderingen med stor skrift.
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

  // Soloppgang og solnedgang i dag ved starten, nederst i boksen.
  function sun(now) {
    return ["span", W.sunText(W.osloParts(now).date, data.site.lat, data.site.lon), "site-wind__sun"];
  }

  function render() {
    var now = Date.now();
    // Ikke noe varsel ennå: det hentes, eller, når datatjenesten ikke svarte, det samme som et for gammelt varsel.
    if (!forecast && !failed) {
      show("none", [FS.t("wind.loading"), sun(now)]);
      hideDetails();
      return;
    }
    if (!forecast || W.isStale(forecast, data.rules, now)) {
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
      // Vurdert ut fra stasjonen: det den målte først, så varselet for timen til sammenligning.
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

  // «NØ 5 m/s, kast 8» (varsel, avrundet) eller «NØ 4,3 m/s, kast 7,2» (målt, som sendt), med regn fra varselet.
  function windText(w, num) {
    return FS.DIRECTION_LABELS[W.directionCode(w.dir)] + " " + num(w.speed) + " m/s" +
      (w.gust != null ? ", " + FS.t("wind.gust", { g: num(w.gust) }) : "") +
      (w.rain != null && w.rain >= data.rules.rainMaybe ? ", " + FS.t("wind.rain", { rain: W.formatRain(w.rain) }) : "");
  }
  function measuredValue(v) { return ST ? ST.value(v) : String(v); }

  // Værstasjonen til stedet (stations.js), når det har en: siste måling mens den er fersk, og om
  // vinden er jevn (stations.js measurement).
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

  // De neste 12 timene som kort: timen, vurderingssymbolet, en stolpe for middelvinden med en strek for kastet, en pil
  // for hvor vinden blåser, og tallene. Inneværende time er markert.
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

  // De neste 48 timene som søyler: høyden er middelvinden, den lyse toppen er kastet, fargen er vurderingen for
  // den timen, og en pil hver tredje time viser hvor vinden kommer fra. Høydene settes gjennom element.style,
  // som CSP tillater.
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

  // Periodene i dagslys de neste to dagene som kan passe («Kan passe» eller «Usikkert»), som merker.
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
  // Plassen som ble holdt av til boksen mens den var tom (site.njk, styles.css), trengs ikke lenger.
  if (block) block.classList.remove("block--now-wait");
  // Et nyere varsel for denne starten fra datatjenesten (workers/data): med en gang, hvert tiende minutt mens siden er
  // synlig, og når den blir synlig eller kommer på nett igjen (wind.js watchForecast). Bare et som har denne starten,
  // erstatter sidens eget varsel mens det fortsatt kan brukes.
  W.watchForecast(data.live, function () { return forecast && !W.isStale(forecast, data.rules, Date.now()) ? forecast : null; }, function (newer) {
    forecast = { fetched: newer.fetched, updated: newer.updated, times: newer.times, sites: {} };
    forecast.sites[data.site.id] = newer.sites[data.site.id] || null;
    render();
  }, data.site.id, function () {
    if (!forecast && !failed) { failed = true; render(); }
  });
  // Inneværende time og alderen på varselet endrer seg mens siden er åpen.
  setInterval(render, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) render(); });
})();
