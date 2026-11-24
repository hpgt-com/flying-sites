// Forsiden: filtre, kart med vindroser, vindvurdering fra prognosen for tidspunktet valgt på tidslinjen, det
// valgte stedet og listen. På mobil blir kartet stående øverst på skjermen og krymper mens listen ruller.
(function () {
  "use strict";

  var FS = window.FlyingSites;
  // Logikken uten DOM (home-logic.js): søk, filtre, oppsummering, tekster og hashen.
  var H = window.FlyingSitesHome;
  var sites = FS.readJson("sites-data") || [];
  // directions: vindretningene valgt i filterrosen. Et sted treffer når det passer for én av dem.
  var filter = { directions: [], level: "", category: "", q: "" };
  var MOBILE = window.matchMedia("(max-width: 1099px)");

  // --- Søk på navn og sted (home-logic.js searchKey) ---
  sites.forEach(function (site) {
    site.searchKeys = H.searchKeys(site);
    site.all = { primary: site.primary, possible: site.possible };
  });

  // Med en kategori valgt gjelder startstedene for den kategorien: SPG på Elgen starter bare NØ–SV, selv om
  // PG starter i alle retninger. site.primary/possible byttes ut, så retningsfilteret, vindrosen og
  // vindvurderingen bruker de samme retningene. Uten kategori, eller uten egne startsteder, gjelder hele stedet.
  function applyCategory() {
    sites.forEach(function (site) {
      var own = filter.category && site.byCategory && site.byCategory[filter.category];
      site.primary = own ? own.primary : site.all.primary;
      site.possible = own ? own.possible : site.all.possible;
    });
  }
  var selectedId = null;
  var markers = {};

  // "match", "unknown", "nowind" eller "no" for et sted mot filtrene og forslagsbryteren (home-logic.js matchSite).
  var suggest = false;
  function matches(site, assessment, windAssessed, ignoreSuggest) {
    return H.matchSite(site, filter, { suggest: suggest, assessment: assessment, windAssessed: windAssessed, ignoreSuggest: ignoreSuggest });
  }
  // Grupper som vises for seg nederst i listen og litt dempet i kartet.
  var WEAK = { unknown: true, nowind: true };

  // Startretningene til stedet som merker (en liste med elementer).
  function directionBadges(site) {
    return FS.DIRECTIONS.filter(function (code) { return FS.directionType(site, code) !== "none"; })
      .map(function (code) {
        var active = filter.directions.indexOf(code) !== -1 ? " direction--active" : "";
        return FS.h("span", { class: "direction direction--" + FS.directionType(site, code) + active }, FS.DIRECTION_LABELS[code]);
      });
  }

  // Nivå, kategorier og status for gjennomgang som merkelapper (en liste med elementer).
  function tags(site) {
    var tag = function (cls, text) { return FS.h("span", { class: cls }, text); };
    var list = [site.level ? tag("tag", site.level) : tag("tag tag--missing", FS.t("home.levelNotSet"))];
    if (site.trainingSite) list.push(tag("tag", FS.t("home.trainingSite")));
    site.categories.forEach(function (c) { list.push(tag("tag", FS.t("categories." + c))); });
    if (!site.reviewed) list.push(tag("tag tag--warning", FS.t("home.notReviewed")));
    return list;
  }

  // --- Vindvurdering fra METs prognose ---
  // Logikken ligger i wind.js. Her velges tidspunktet, og resultatet vises i kartet, listen og kortet.
  var W = window.FlyingSitesWind;
  var RATINGS = W.RATINGS;
  var fc = FS.readJson("forecast-data") || {};
  var rules = fc.rules;
  var forecast = fc.forecast || null;
  var forecastStatusEl = document.getElementById("forecast-status");
  // Er prognosen for gammel (det planlagte bygget har stoppet, eller siden er lagret i nettleseren),
  // slås vindvurderingen av med en forklaring. Alderen sjekkes på nytt før hver vurdering, når du
  // kommer tilbake til fanen og hvert minutt, så en fane som står åpen i timevis, ikke viser gamle vurderinger.
  var stale = false;
  // Det valgte tidspunktet som timer fra nå ("0", "1" … så langt prognosen rekker), fra tidslinjen. "off" uten
  // prognose, eller når den er for gammel.
  var windSlot = forecast ? "0" : "off";
  var windIndex = -1; // prognoseindeks for det valgte tidspunktet, settes av assessAll()
  var dayShort = new Intl.DateTimeFormat(FS.lang === "nb" ? "nb-NO" : "en-GB", { weekday: "short", timeZone: "Europe/Oslo" });
  // «nå», «kl. 17.00», «i morgen kl. 09.00» eller «søn. kl. 13.00», for prognosetimen ved index.
  function whenLabel(index) {
    return windSlot === "0" ? FS.t("home.whenNow") : H.whenLabel(forecast, index, Date.now());
  }
  // «i dag kl. 08:47», eller «16.10 kl. 23:47» for en annen dag.
  function whenText(iso) { return H.whenText(iso, Date.now()); }
  function fetchedText() { return whenText(forecast.fetched); }

  // Gir true når prognosen akkurat har blitt for gammel, så den som kaller, kan tegne siden på nytt.
  function checkStale() {
    if (!forecast || stale || !W.isStale(forecast, rules, Date.now())) return false;
    stale = true;
    windSlot = "off";
    suggest = false;
    if (timelineEl) timelineEl.hidden = true;
    if (suggestButton) suggestButton.hidden = true;
    forecastStatusEl.replaceChildren(FS.h("strong", null, FS.t("wind.staleTitle")), " " + FS.t("wind.staleHome", { when: fetchedText() }));
    return true;
  }

  // Tekst under vindvelgeren: når prognosen ble hentet, og hvilket tidspunkt vurderingen gjelder.
  function updateForecastStatus(index) {
    if (!forecast || stale) return;
    // METs egen oppdateringstid (modellkjøringen) når prognosen har den, i tillegg til når den ble hentet.
    var text = (Number.isFinite(Date.parse(forecast.updated))
      ? FS.t("wind.fetchedUpdated", { updated: whenText(forecast.updated), when: fetchedText() })
      : FS.t("wind.fetched", { when: fetchedText() })) + sunLine(index);
    if (windSlot === "off") forecastStatusEl.replaceChildren(text);
    else if (index < 0) forecastStatusEl.replaceChildren(FS.h("strong", null, FS.t("wind.notCovered")), " " + text);
    else forecastStatusEl.replaceChildren(FS.t("wind.showingWhen", { when: whenLabel(index) }) + (W.stepAt(forecast.times, index) > 3600000 ? " " + FS.t("home.coarse") : "") + " " + text);
  }
  // Soloppgang og solnedgang midt i hjemregionen, for dagen som vises (i dag når vind er av). Forskjellen
  // mellom startstedene i regionen er noen få minutter.
  function sunLine(index) {
    if (!bounds.length) return "";
    var lat = 0, lon = 0;
    bounds.forEach(function (b) { lat += b[0] / bounds.length; lon += b[1] / bounds.length; });
    var date = W.osloParts(index >= 0 ? Date.parse(forecast.times[index]) : Date.now()).date;
    return " " + W.sunText(date, lat, lon);
  }

  // --- Oppsummering ---
  // Vinden i området (vanligste retning, median middelvind, høyeste kast) og hvor mange steder som får
  // hver vurdering, med den vanligste grunnen. Forklarer hvorfor ingen steder passer en dag med mye vind.
  var summaryEl = document.getElementById("wind-summary");
  // ids: stedene oppsummeringen dekker (de som treffer filtrene).
  // Vurderingene av stedene i ids summert (home-logic.js summarize), eller null uten noen.
  function summarize(assessments, ids) { return H.summarize(assessments, ids, sites.length); }
  function places(n) { return FS.tn("summary.places", n); }
  function maybeLabel(n) { return FS.tn("summary.maybe", n); }
  function renderSummary(sum) {
    if (!summaryEl) return;
    summaryEl.hidden = !sum;
    if (!sum) { summaryEl.replaceChildren(); return; }
    var c = sum.counts, parts = [];
    if (c.ok) parts.push(c.ok + " " + FS.t("summary.ok"));
    if (c.maybe) parts.push(c.maybe + " " + maybeLabel(c.maybe));
    if (c.high) {
      var why = [];
      if (sum.highByGust) why.push(FS.t("summary.highByGust", { n: sum.highByGust }));
      if (sum.highByLocal) why.push(FS.t("summary.highByLocal", { n: sum.highByLocal }));
      parts.push(c.high + " " + FS.t("summary.high") + (why.length ? " (" + why.join(", ") + ")" : ""));
    }
    if (c.no - sum.noByRain) parts.push((c.no - sum.noByRain) + " " + FS.t("summary.wrongDirection"));
    if (sum.noByRain) parts.push(sum.noByRain + " " + FS.t("summary.rain"));
    var wind = FS.t("summary.wind", {
      dir: FS.DIRECTION_LABELS[sum.dir],
      speed: Math.round(sum.minSpeed) === Math.round(sum.maxSpeed) ? Math.round(sum.speed) : Math.round(sum.minSpeed) + "–" + Math.round(sum.maxSpeed),
      gust: sum.gust != null ? FS.t("summary.gustUpTo", { g: Math.round(sum.gust) }) : "",
    });
    // Som i prototypen: vindlinje, fargestolpe med fordelingen og antall per vurdering med fargede prikker.
    // Detaljene (kast, stedets egen grense, manglende prognose) står i verktøytipset til linjen.
    var detail = places(sum.total) + (sum.filtered ? FS.t("summary.matchingFilters") : "") + ": " + parts.join(", ") + "." +
      (sum.missing ? " " + FS.t("summary.missingNotAssessed", { places: places(sum.missing) }) : "");
    // [rating, count, text]. «Passer ikke» deles i feil retning og regn, så grunnen vises.
    var order = [["ok", c.ok, FS.t("summary.ok")], ["maybe", c.maybe, maybeLabel(c.maybe)], ["high", c.high, FS.t("summary.high")],
      ["no", c.no - sum.noByRain, FS.t("summary.wrongDirection")], ["no", sum.noByRain, FS.t("summary.rain")]];
    var bar = order.map(function (o) {
      return o[1] ? FS.h("span", { class: "wind-bar__part wind-dot--" + o[0], "data-grow": o[1] }) : null;
    });
    var chips = order.map(function (o) {
      return o[1] ? FS.h("span", null, FS.h("span", { class: "wind-dot wind-dot--" + o[0] }), o[1] + " " + o[2]) : null;
    });
    var p = function (cls, text) { return FS.h("p", { class: cls }, text); };
    summaryEl.replaceChildren(FS.frag(
      p("wind-summary__wind", wind),
      FS.h("div", { class: "wind-bar", role: "img", "aria-label": detail, title: detail }, bar),
      sum.filtered ? p("wind-summary__scope", FS.t("summary.scope", { places: places(sum.total + sum.missing) })) : null,
      FS.h("p", { class: "wind-summary__counts" }, chips),
      sum.missing ? p("wind-summary__missing", FS.t("summary.missing", { places: places(sum.missing) })) : null,
      c.ok + c.maybe === 0 ? p("wind-summary__none", FS.t("summary.noneCanWork") + " " + noneReason(sum) + (sum.next ? " " + sum.next : "")) : null));
    // Bredden på delene settes på elementene, ikke som innebygde stiler: siden tillater ingen (CSP style-src 'self').
    summaryEl.querySelectorAll(".wind-bar__part").forEach(function (el) { el.style.flexGrow = el.getAttribute("data-grow"); });
  }
  // Pillen på kartet: hvor mange steder som kan passe på det valgte tidspunktet, med den beste vurderingen, og den
  // vanligste retningen («✓ 3 kan passe · mest NV»). Detaljene åpnes under. Uten vind: hvor mange steder som vises.
  var statusEl = document.getElementById("map-status");
  var statusTextEl = document.getElementById("map-count");
  var statusSubEl = document.getElementById("map-status-sub");
  var statusIconEl = statusEl && statusEl.querySelector(".map-status__icon");
  var ICONS = { ok: "✓", maybe: "?", high: "!", no: "×" };
  var RATING_KEYS = { ok: "ok", maybe: "maybe", high: "high", no: "no" };
  var DIRECTION_KEYS = { N: "N", NE: "NE", E: "E", SE: "SE", S: "S", SW: "SW", W: "W", NW: "NW" };
  function renderStatus(sum, shownText) {
    if (!statusEl) return;
    var rating = null, text = shownText;
    if (sum) {
      var c = sum.counts;
      rating = c.ok ? "ok" : c.maybe ? "maybe" : c.high ? "high" : "no";
      text = c.ok ? c.ok + " " + FS.t("summary.ok") : c.maybe ? c.maybe + " " + maybeLabel(c.maybe) : FS.t("home.statusNone");
    }
    statusEl.className = "map-status__pill" + (rating ? " map-status__pill--" + rating : "");
    statusIconEl.textContent = rating ? ICONS[rating] : "";
    statusIconEl.hidden = !rating;
    statusTextEl.textContent = text;
    // Kort på mobil («mest NV»), med vinden også på PC («Mest V 2–8 m/s, kast 14»).
    statusSubEl.textContent = !sum ? "" : MOBILE.matches ? " · " + FS.t("home.statusMostly", { dir: FS.DIRECTION_LABELS[sum.dir] })
      : FS.t("home.statusWind", {
        dir: FS.DIRECTION_LABELS[sum.dir],
        speed: Math.round(sum.minSpeed) === Math.round(sum.maxSpeed) ? Math.round(sum.speed) : Math.round(sum.minSpeed) + "–" + Math.round(sum.maxSpeed),
        gust: sum.gust != null ? FS.t("home.statusGust", { g: Math.round(sum.gust) }) : "",
      });
  }
  var infoEl = document.getElementById("map-info");
  function setInfoOpen(open) {
    if (!statusEl || !infoEl) return;
    statusEl.setAttribute("aria-expanded", String(open));
    infoEl.hidden = !open;
  }
  if (statusEl) {
    statusEl.addEventListener("click", function () {
      var open = statusEl.getAttribute("aria-expanded") !== "true";
      if (open) FS.track("map/status");
      setInfoOpen(open);
    });
    document.addEventListener("click", function (ev) { if (!ev.target.closest(".map-status")) setInfoOpen(false); });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !infoEl.hidden) { setInfoOpen(false); statusEl.focus(); } });
  }

  // Hovedgrunnen til at ingen steder passer, i én setning.
  function noneReason(sum) { return H.noneReason(sum, rules); }
  function windText(wind) { return H.windText(wind, rules, FS.DIRECTION_LABELS); }

  // Den ferske målingen fra værstasjonen på et sted (stations.js), eller null. stationData er siste svar fra
  // datatjenesten, satt av addStations nedenfor.
  var stationData = null;
  function stationMeasurement(siteId, now) {
    var ST = window.FlyingSitesStations;
    if (!ST || !stationData) return null;
    var item = stationData.items.filter(function (i) { return i.site === siteId; })[0];
    return item ? ST.measurement(item, now) : null;
  }

  // Vurdering for alle steder på det valgte tidspunktet: { id: { wind, rating, reasons } }, eller null når vind er av
  // eller prognosen ikke dekker tidspunktet. Steder uten prognose (hentingen feilet) mangler i resultatet.
  function assessAll() {
    checkStale();
    if (!forecast || stale) return null;
    if (windSlot === "off") { updateForecastStatus(-1); return null; }
    var index = W.slotIndex(forecast.times, windSlot, Date.now());
    windIndex = index;
    updateForecastStatus(index);
    if (index < 0) return null;
    var result = {}, now = Date.now();
    sites.forEach(function (site) {
      var wind = W.windAt(forecast, site.id, index);
      if (!wind) return;
      // «Nå» for et sted med værstasjon: den ferske målingen teller som på stedssiden (wind.js rateNow), og vinden
      // som vises, er da den målte, merket «målt».
      var m = windSlot === "0" ? stationMeasurement(site.id, now) : null;
      var assessed = W.rateNow(site, wind, m && m.wind, rules, m && m.steady);
      var rating = assessed.result;
      if (assessed.basis === "measured") wind = { dir: m.wind.dir, speed: m.wind.speed, gust: m.wind.gust, rain: wind.rain, measured: true };
      result[site.id] = { wind: wind, rating: rating.rating, reasons: rating.reasons, codes: rating.codes };
    });
    return result;
  }

  // --- Kart ---
  var mapEl = document.getElementById("home-map");
  var map = FS.createMap(mapEl, { warmZoomOut: true });
  FS.addAirspaceLayers(map, mapEl.getAttribute("data-airspace-url"));
  FS.addObstacleLayer(map, mapEl.getAttribute("data-obstacles-url"));
  FS.addRadarLayer(map);
  addStations();
  // På PC fyller kartet kolonnen sin og ingenting ruller, så hjulet zoomer. Ellers ruller hjulet siden,
  // og Ctrl/Cmd + hjul zoomer (common.js).
  FS.wheelNeedsCtrl(map, function () { return MOBILE.matches; });
  // Krediteringen ligger under kartet, på én linje, så den ikke dekker det lille kartet på mobil eller tidslinjen.
  var attributionEl = map.attributionControl.getContainer();
  attributionEl.classList.add("map-attribution");
  document.getElementById("home-map-wrap").appendChild(attributionEl);
  // Kartet åpner over startstedene i hjemregionen (site.homeRegion), ikke over alle steder, så et sted langt
  // unna ikke zoomer kartet ut. Steder utenfor er i listen og søket.
  var homeRegion = mapEl.getAttribute("data-home-region");
  var bounds = [];

  // Pilen står på siden vinden kommer fra og peker inn mot startstedet, som vind som blåser inn i rosen.
  // Demping og valg ligger i className, så de overlever når markøren tas ut av og inn i en klynge igjen.
  // match: "match", "unknown" (nivå ikke satt), "nowind" (mangler prognose) eller "no", se matches().
  // Rosen i markøren (46 px med ring, så den er lett å se): den samme rosen som på kortet og stedssiden. Med vind
  // på fylles sektoren vinden kommer fra, med vurderingsfargen ut til ringen (roseSvg i common.js).
  function markerRose(site, assessment) {
    return FS.roseSvg(site, 40, false, assessment ? { code: W.directionCode(assessment.wind.dir), rating: assessment.rating, edge: true } : null);
  }
  // Middelvind og kast under navnet, «5 (8) m/s», når det er zoomet nok inn til at navnene vises. Retningen er i rosen.
  function markerWind(assessment) {
    if (!assessment) return null;
    var w = assessment.wind;
    return FS.h("span", { class: "rose-marker__wind" }, FS.t("wind.mapWind", { speed: Math.round(w.speed), gust: w.gust != null ? Math.round(w.gust) : "?" }));
  }
  function markerIcon(site, assessment, match, selected) {
    var ring = assessment ? " rose-marker__ring--" + assessment.rating : "";
    return FS.divIcon({
      className: "rose-marker" + (match === "no" ? " rose-marker--dimmed" : WEAK[match] ? " rose-marker--unknown" : "") +
        (selected ? " rose-marker--selected" : ""),
      content: function () {
        return FS.frag(FS.h("span", { class: "rose-marker__ring" + ring }, markerRose(site, assessment)),
          FS.h("span", { class: "rose-marker__name" }, site.name, markerWind(assessment)));
      },
      iconSize: [46, 46],
      iconAnchor: [23, 23],
    });
  }

  // Startsteder som overlapper i kartet, slås sammen til en klynge med et antall.
  // Antallet er steder som treffer filteret, eller steder uten nivå når ingen treffer helt.
  // Med vind på får ringen fargen til den beste vurderingen blant dem som telles.
  var markerState = {}; // id: { match, rating, selected }, oppdateres i update()
  function clusterIcon(cluster) {
    var children = cluster.getAllChildMarkers();
    var counts = { match: 0, unknown: 0, no: 0 }, best = { match: null, unknown: null }, selected = false;
    children.forEach(function (m) {
      var st = markerState[m.options.siteId] || { match: "match" };
      var group = WEAK[st.match] ? "unknown" : st.match;
      if (st.selected) selected = true;
      counts[group]++;
      if (group === "no" || !st.rating) return;
      if (!best[group] || RATINGS[st.rating].order < RATINGS[best[group]].order) best[group] = st.rating;
    });
    var shown = counts.match ? "match" : counts.unknown ? "unknown" : "no";
    var rating = best[shown];
    var ring = rating ? " rose-marker__ring--" + rating : "";
    return FS.divIcon({
      className: "rose-marker site-cluster" + (shown === "no" ? " rose-marker--dimmed" : shown === "unknown" ? " rose-marker--unknown" : "") +
        (selected ? " rose-marker--selected" : ""),
      content: function () { return FS.h("span", { class: "rose-marker__ring site-cluster__ring" + ring }, shown === "no" ? children.length : counts[shown]); },
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }
  var cluster = L.markerClusterGroup({
    // Minst like stor som en stedsmarkør (46 px), så en markør og en klynge aldri overlapper uten å slås sammen (det
    // ga en klynge med bare en stripe å trykke på).
    maxClusterRadius: 48,
    showCoverageOnHover: false,
    spiderfyDistanceMultiplier: 1.6,
    iconCreateFunction: clusterIcon,
  }).addTo(map);
  // «Flysteder» som et lag, så kartet kan vise bare været. Det som hører til stedene (statusen, linjen om
  // det valgte stedet, tidslinjen, kortet), skjules sammen med det.
  map.layersControl.addOverlay(cluster, FS.layerLabel(map, "sites", FS.t("map.layerSites")));
  var homeMapEl = mapEl.closest(".home__map");
  map.on("overlayadd overlayremove", function (ev) {
    if (ev.layer === cluster && homeMapEl) homeMapEl.classList.toggle("home__map--no-sites", ev.type === "overlayremove");
  });

  sites.forEach(function (site) {
    var marker = L.marker([site.lat, site.lon], { icon: markerIcon(site, null, "match", false), title: site.name, alt: site.name, keyboard: true, riseOnHover: true, siteId: site.id });
    marker.bindTooltip(document.createTextNode(site.name), { direction: "top", offset: [0, -14] });
    marker.on("click", function () { FS.track("map/select/" + site.id, site.name); select(site.id, "map"); });
    cluster.addLayer(marker);
    markers[site.id] = marker;
    if (site.region === homeRegion) bounds.push([site.lat, site.lon]);
  });
  // Uten steder i hjemregionen dekker kartet alle steder.
  if (!bounds.length) sites.forEach(function (site) { bounds.push([site.lat, site.lon]); });
  // Stedsnavn under rosene når det er zoomet tett inn.
  var NAMES_ZOOM = 11;
  function toggleNames() { mapEl.classList.toggle("map--names", map.getZoom() >= NAMES_ZOOM); }
  map.on("zoomend", toggleNames);

  function fitAllSites() {
    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], animate: false });
  }

  // --- Tilbake fra en stedsside: samme visning som før ---
  // Posisjonen og zoomen i kartet, og tilstanden i adressen (filtre, tid, søk, valgt sted), tas vare på for
  // økten (sessionStorage) og brukes igjen når besøkeren kommer tilbake fra en stedsside («‹ Alle flysteder», eller
  // tilbakeknappen når nettleseren ikke beholdt siden): kartet og listen er da som de ble forlatt, ikke
  // hjemregionen. Et nytt besøk, eller et fra et annet sted, starter som før.
  var VIEW_KEY = "fs-home-view";
  function saveView() {
    try {
      var c = map.getCenter();
      sessionStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom(), hash: location.hash }));
    } catch (e) { /* no view yet, or storage off */ }
  }
  function cameBackFromSite() {
    var nav = performance.getEntriesByType ? performance.getEntriesByType("navigation")[0] : null;
    if (nav && nav.type === "back_forward") return true;
    try {
      var ref = new URL(document.referrer);
      return ref.origin === location.origin && /\/(flysteder|sites)\/[^/]+\/?$/.test(ref.pathname);
    } catch (e) { return false; }
  }
  var restoredView = null;
  if (cameBackFromSite()) {
    try { restoredView = JSON.parse(sessionStorage.getItem(VIEW_KEY)); } catch (e) { /* storage off */ }
    if (!restoredView || typeof restoredView.lat !== "number" || typeof restoredView.lng !== "number" || typeof restoredView.zoom !== "number") restoredView = null;
    else if (!location.hash && typeof restoredView.hash === "string" && restoredView.hash) history.replaceState(null, "", restoredView.hash);
  }
  map.on("moveend", saveView);
  FS.fitWhenVisible(map, mapEl, function () {
    if (restoredView) map.setView([restoredView.lat, restoredView.lng], restoredView.zoom, { animate: false });
    else fitAllSites();
  });
  // «Vis flysteder i Harstad og Kvæfjord» og fullskjerm under zoomknappene, som på stedssiden.
  FS.addViewControls(map, mapEl, fitAllSites, FS.t("home.showSitesIn", { region: homeRegion }));
  // «Piloter i lufta» (live.js) og «Prognose» (forecast-layer.js): av til de slås på i lagvelgeren, og skriptene
  // deres hentes først da (FS.lazyOverlays). Prognoselagene følger tidspunktet på tidslinjen (update()).
  FS.lazyOverlays(map, mapEl.getAttribute("data-live-script"), [{ key: "live", label: FS.t("live.layer"), attribution: FS.t("live.credit") }], function (layers) {
    window.FlyingSitesLive.addMapLayer(map, mapEl.getAttribute("data-live-url"), layers.live);
  });
  var forecastLayers = null;
  // De fem lagene, som LAYERS i forecast-layer.js, med navnene sine i lagvelgeren.
  var FORECAST_LAYERS = {
    thermal: FS.t("forecast.layer_thermal"), top: FS.t("forecast.layer_top"), wind: FS.t("forecast.layer_wind"),
    temp: FS.t("forecast.layer_temp"), cloud: FS.t("forecast.layer_cloud"),
  };
  FS.lazyOverlays(map, mapEl.getAttribute("data-forecast-script"), Object.keys(FORECAST_LAYERS).map(function (key) {
    return { key: "forecast-" + key, label: FORECAST_LAYERS[key], attribution: FS.t("forecast.credit") };
  }), function (layers) {
    var existing = {};
    Object.keys(FORECAST_LAYERS).forEach(function (key) { existing[key] = layers["forecast-" + key]; });
    forecastLayers = window.FlyingSitesForecast.addMapLayers(map, { close: mapEl.getAttribute("data-grid-url"), wide: mapEl.getAttribute("data-grid-wide-url") }, existing);
    if (forecastLayers) forecastLayers.setTime(forecastTime());
  });

  // --- Kort for det valgte stedet ---
  var cardEl = document.getElementById("selected");
  // Den tomme tilstanden bygges med DOM-metoder (ikke innerHTML fra siden selv), så ingen tekst tolkes som HTML.
  var EMPTY_CARD_TEXT = FS.t("home.emptyCard");
  function resetCard() {
    var p = document.createElement("p");
    p.className = "muted selected__empty";
    p.textContent = EMPTY_CARD_TEXT;
    cardEl.replaceChildren(p);
    cardEl.classList.remove("selected--active");
    if (noteEl) { noteEl.hidden = true; noteEl.replaceChildren(); }
  }
  function showCard(site, assessment, windOn) {
    var h = FS.h, p = function (cls, text) { return h("p", { class: cls }, text); };
    var parts = [
      h("button", { type: "button", class: "selected__close", "data-close-card": true, "aria-label": FS.t("home.closeCard", { name: site.name }) }, "×"),
      h("div", { class: "selected__top" },
        FS.roseSvg(site, 84, true, assessment ? { code: W.directionCode(assessment.wind.dir), rating: assessment.rating } : null),
        h("div", { class: "selected__info" },
          h("h2", { class: "selected__name" }, site.name),
          site.elevation != null ? p("selected__elev", FS.t("home.launchMasl", { m: site.elevation })) : null,
          h("div", { class: "directions" }, directionBadges(site)),
          h("div", { class: "tags" }, tags(site)))),
    ];
    if (assessment) {
      parts.push(h("p", { class: "selected__wind" }, h("span", { class: "wind-dot wind-dot--" + assessment.rating }),
        FS.t("home.windAt", { when: whenLabel(windIndex) }) + windText(assessment.wind) + ". ", h("strong", null, RATINGS[assessment.rating].label)));
      if (assessment.reasons.length) parts.push(p("selected__reasons", assessment.reasons.join(". ") + "."));
      if (assessment.note) parts.push(p("selected__reasons", assessment.note));
      if (site.maxWind != null && assessment.codes.indexOf("overSiteLimit") === -1) parts.push(p("selected__reasons", FS.t("home.siteLimit", { limit: site.maxWind })));
    } else if (windOn) {
      parts.push(p("selected__wind muted", FS.t("home.noForecastNow")));
    }
    if (site.text) parts.push(p("selected__text", site.text));
    parts.push(h("a", { class: "btn btn--primary btn--wide", href: site.url }, FS.t("home.seeSite")));
    if (site.flightlogId) {
      parts.push(h("a", { class: "btn btn--wide", href: "https://flightlog.org/fl.html?l=1&a=22&country_id=160&start_id=" + encodeURIComponent(site.flightlogId),
        target: "_blank", rel: "noopener" }, FS.t("home.seeFlightlog"), FS.externalMark()));
    }
    cardEl.replaceChildren(FS.frag(parts));
    cardEl.classList.add("selected--active");
    showNote(site, assessment);
  }
  // Mobil: én linje på kartet om det valgte stedet, med en lenke til stedssiden. Kortet er for PC (CSS).
  var noteEl = document.getElementById("map-note");
  function showNote(site, assessment) {
    if (!noteEl) return;
    noteEl.replaceChildren(
      FS.h("span", null, FS.h("strong", null, site.name), assessment ? " · " + windText(assessment.wind) + " · " + RATINGS[assessment.rating].label : null),
      FS.h("a", { href: site.url, "aria-label": FS.t("home.seeName", { name: site.name }) }, FS.t("home.see")));
    noteEl.hidden = false;
  }

  // origin: "map" (en rose i kartet), "list" (listen) eller "pick" (søketreff, dagsplanen).
  function select(id, origin) {
    var site = sites.find(function (s) { return s.id === id; });
    if (!site) return;
    var mobile = MOBILE.matches;
    // I fullskjerm ligger listen bak kartet: stedet vises i linjen på kartet (med lenken til siden), og
    // siden bak blir som den er.
    var fullscreen = mapEl.classList.contains("map--fullscreen");
    // Et nytt trykk på det valgte stedet åpner stedssiden: i kartet (også i fullskjerm), og i listen på mobil.
    // Det første trykket viser det i kartet og listen.
    if (id === selectedId && (origin === "map" || (origin === "list" && mobile))) {
      FS.track(origin + "/open/" + id);
      // Lenken ligger i siden fra bygget (index.njk), så adressen kommer aldri fra skriptet.
      var link = listEl.querySelector('[data-id="' + id + '"] .results__open');
      if (link) link.click();
      return;
    }
    selectedId = id;
    // En rose trykket i kartet viser stedet i listen, også når det ligger lenger ned enn de første.
    if (origin === "map" && mobile && !fullscreen) listExpanded = true;
    update();
    writeHash();
    if (origin !== "map") {
      // Er stedet i en klynge, zoomes det inn til markøren vises.
      cluster.zoomToShowLayer(markers[id], function () { map.panTo([site.lat, site.lon]); });
    }
    if (origin === "map" && mobile && !fullscreen) scrollToItem(id);
  }
  // Mobil: ruller listen så stedet står rett under kartet og søkefeltet, som blir stående øverst. Posisjonen
  // måles før kartet gjøres lite: det lille kartet beholder den gamle høyden som marg under, så listen ikke
  // flytter seg, men høyden animeres og ville blitt målt halvveis. --map-h følger klassen med en gang.
  function scrollToItem(id) {
    var li = listEl.querySelector('[data-id="' + id + '"]');
    if (!li || li.hidden || !homeEl) return;
    var y = li.getBoundingClientRect().top + window.scrollY;
    homeEl.classList.add("home--small");
    var mapH = parseFloat(getComputedStyle(homeEl).getPropertyValue("--map-h")) || 0;
    var bar = document.getElementById("filters");
    var top = y - mapH - (bar ? bar.offsetHeight : 0) - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: REDUCED_MOTION.matches ? "auto" : "smooth" });
  }
  var REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

  // --- Filtre og liste ---
  var listEl = document.getElementById("results-list");
  var titleEl = document.getElementById("results-title");
  var noResultsEl = document.getElementById("no-results");
  var windLegendEl = document.getElementById("wind-legend");
  var moreEl = document.getElementById("results-more");
  var homeEl = document.querySelector(".home");
  var LIST_LIMIT = 5;
  var listExpanded = false;
  if (moreEl) moreEl.addEventListener("click", function () {
    listExpanded = true;
    FS.track("list/show-all");
    update();
    // Fokus på det første stedet som var skjult, så tastatur- og skjermleserbrukere fortsetter der.
    var next = listEl.querySelectorAll("li[data-id]:not([hidden]) button")[LIST_LIMIT];
    if (next) next.focus();
  });
  var originalOrder = Array.prototype.slice.call(listEl.children);

  // Overskrifter i listen for steder uten prognose (forslag på) og uten nivå (nivåfilter på).
  var GROUP_ORDER = { match: 0, nowind: 1, unknown: 2 };
  var headingEls = {};
  ["nowind", "unknown"].forEach(function (g) {
    var el = document.createElement("li");
    el.className = "results__group";
    el.hidden = true;
    headingEls[g] = el;
  });
  function heading(g, n) {
    var nowind = g === "nowind";
    return FS.frag(
      FS.h("h3", { class: "results__group-title" }, nowind ? FS.t("home.groupNoWind", { n: n }) : FS.t("home.groupNoLevel", { n: n })),
      FS.h("p", { class: "muted" }, nowind ? FS.t("home.groupNoWindText") : FS.t("home.groupNoLevelText", { level: filter.level })));
  }

  // --- Flyvinduer per sted ---
  // dayWindows (wind.js) per sted, for stripen i listen og «neste vindu». Lagres per prognoseobjekt, siden
  // update() kjører ved hver flytting på tidslinjen og vinduene bare endres med prognosen.
  var windowsCache = { forecast: null, bySite: {} };
  function siteWindows(site) {
    if (windowsCache.forecast !== forecast) windowsCache = { forecast: forecast, bySite: {} };
    var w = windowsCache.bySite[site.id];
    if (!w) w = windowsCache.bySite[site.id] = W.dayWindows(forecast, site, rules, site.lat, site.lon);
    return w;
  }
  var stripDate = H.stripDate, windowText = H.windowText;
  // En stripe under vurderingen i raden til et sted: dagens 24 timer, farget der stedet kan passe (grønt) eller er
  // usikkert (gult) i dagslys, med et merke ved timen valgt på tidslinjen når det er den dagen. Slik viser listen
  // når et sted passer, ikke bare om det passer på det valgte tidspunktet. Bygget med DOM-metoder; fargene settes på
  // elementet (ingen innebygde stiler i HTML-en).
  function renderWindowStrip(li, site, windOn) {
    var el = li.querySelector(".results__windows");
    if (!windOn || !forecast.sites[site.id]) { if (el) el.remove(); return; }
    var now = Date.now(), date = stripDate(now), today = W.osloParts(now).date;
    var windows = siteWindows(site)[date] || [];
    if (!el) {
      el = domEl("span", "results__windows");
      el.appendChild(domEl("span", "results__windows-text"));
      var bar = el.appendChild(domEl("span", "results__windows-bar"));
      bar.setAttribute("aria-hidden", "true");
      // Merker ved 06, 12 og 18, så timene kan leses av stolpen.
      [6, 12, 18].forEach(function (h) { var tick = bar.appendChild(domEl("span", "results__windows-tick")); tick.style.left = (h / 24 * 100) + "%"; });
      bar.appendChild(domEl("span", "results__windows-at"));
      li.querySelector(".results__body").appendChild(el);
    }
    var hourOf = function (ms) { var p = W.osloParts(ms); return p.date === date ? p.hour : p.date < date ? 0 : 24; };
    var stops = ["transparent 0%"];
    windows.forEach(function (w) {
      var a = (hourOf(w.start) / 24 * 100).toFixed(1) + "%", b = (hourOf(w.end) / 24 * 100).toFixed(1) + "%";
      stops.push("transparent " + a, BAR_COLORS[w.rating] + " " + a, BAR_COLORS[w.rating] + " " + b, "transparent " + b);
    });
    stops.push("transparent 100%");
    var barEl2 = el.querySelector(".results__windows-bar");
    barEl2.style.backgroundImage = "linear-gradient(90deg, " + stops.join(", ") + ")";
    // Den valgte timen, når tidslinjen står på denne dagen.
    var at = el.querySelector(".results__windows-at");
    var chosen = windIndex >= 0 ? W.osloParts(Date.parse(forecast.times[windIndex])) : null;
    at.hidden = !(chosen && chosen.date === date);
    if (!at.hidden) at.style.left = (chosen.hour / 24 * 100).toFixed(1) + "%";
    // «I morgen: 08–13 kan passe, 16–17 usikkert», det samme for skjermleseren og musen.
    var dayWord = date === today ? FS.t("home.windowsToday") : FS.t("home.windowsTomorrow");
    var text = windows.length ? FS.t("home.windows", { day: dayWord, list: windows.map(windowText).join(", ") }) : FS.t("home.noWindows", { day: dayWord });
    el.querySelector(".results__windows-text").textContent = text;
    el.title = text;
  }
  // Det neste vinduet blant stedene etter det valgte tidspunktet, i én setning («Neste vindu: Dale lørdag kl. 08, kan passe»),
  // eller at prognosen ikke har noe (home-logic.js nextWindow).
  function nextWindowText(ids, at) {
    var list = sites.filter(function (s) { return ids.indexOf(s.id) !== -1 && forecast.sites[s.id]; });
    return H.nextWindowText(H.nextWindow(list, at, siteWindows), Date.now());
  }

  // Tidspunktet prognoselagene viser: timen valgt på tidslinjen, eller nå når vindvurderingen er av.
  function forecastTime() {
    return windIndex >= 0 && windSlot !== "off" && forecast && !stale ? Date.parse(forecast.times[windIndex]) : Date.now();
  }
  function update() {
    applyCategory();
    var assessments = assessAll();
    if (forecastLayers) forecastLayers.setTime(forecastTime());
    var windOn = !!(forecast && !stale && windSlot !== "off");
    var counts = { match: 0, unknown: 0, nowind: 0, no: 0 };
    var matchById = {};
    sites.forEach(function (site) {
      var assessment = assessments && assessments[site.id];
      var match = matches(site, assessment, !!assessments);
      matchById[site.id] = match;
      counts[match]++;
      var marker = markers[site.id];
      if (marker) {
        marker.setIcon(markerIcon(site, assessment, match, site.id === selectedId));
        markerState[site.id] = { match: match, rating: assessment ? assessment.rating : null, selected: site.id === selectedId };
        var order = assessment ? 3 - RATINGS[assessment.rating].order : 0;
        var base = { match: 500, unknown: 250, nowind: 250, no: 0 }[match];
        marker.setZIndexOffset(site.id === selectedId ? 1000 : base + order * 10);
      }
      var li = listEl.querySelector('[data-id="' + site.id + '"]');
      if (li) {
        li.hidden = match === "no";
        var button = li.querySelector("button");
        button.classList.toggle("results__item--selected", site.id === selectedId);
        li.querySelector(".directions").replaceChildren(FS.frag(directionBadges(site)));
        // Den samme rosen som i kartet: vindsektoren i vurderingsfargen, og ringen. Vurderingen slås opp i en
        // fast liste, så bare kjente klassenavn havner i class-attributtet.
        var ringRating = assessment ? RATING_KEYS[assessment.rating] : null;
        var windCode = assessment ? DIRECTION_KEYS[W.directionCode(assessment.wind.dir)] : null;
        li.querySelector(".results__rose").replaceChildren(FS.h("span", { class: "results__ring" + (ringRating ? " results__ring--" + ringRating : "") },
          FS.roseSvg(site, 34, false, ringRating && windCode ? { code: windCode, rating: ringRating, edge: true } : null)));
        var windEl = button.querySelector(".results__wind");
        if (!windEl) {
          windEl = document.createElement("span");
          windEl.className = "results__wind";
          button.querySelector(".results__body").insertBefore(windEl, button.querySelector(".results__open"));
        }
        windEl.hidden = !assessment && !(assessments && windOn);
        // Vurderingen som en brikke med et symbol, så den ikke hviler på farge alene, og så vinden.
        if (assessment) {
          windEl.replaceChildren(FS.h("span", { class: "rating-chip rating-chip--" + assessment.rating },
            FS.h("span", { "aria-hidden": "true" }, ICONS[assessment.rating]), RATINGS[assessment.rating].label), windText(assessment.wind));
        } else windEl.replaceChildren(FS.t("home.noForecast"));
        renderWindowStrip(li, site, windOn && !!assessments);
      }
      if (site.id === selectedId) showCard(site, assessment, windOn);
    });

    cluster.refreshClusters();

    // Steder uten prognose og uten nivå kommer sist. Med vind på sorteres hver gruppe etter vurdering,
    // ellers alfabetisk som fra bygget.
    var items = originalOrder.slice();
    var group = function (li) { return GROUP_ORDER[matchById[li.getAttribute("data-id")]] || 0; };
    items.sort(function (a, b) {
      var ra = assessments && assessments[a.getAttribute("data-id")], rb = assessments && assessments[b.getAttribute("data-id")];
      return group(a) - group(b) ||
        (ra ? RATINGS[ra.rating].order : 9) - (rb ? RATINGS[rb.rating].order : 9) ||
        originalOrder.indexOf(a) - originalOrder.indexOf(b);
    });
    Object.keys(headingEls).forEach(function (g) {
      var el = headingEls[g];
      if (el.parentNode) listEl.removeChild(el);
      el.hidden = !counts[g];
      el.replaceChildren(counts[g] ? heading(g, counts[g]) : FS.frag());
    });
    var placed = {};
    items.forEach(function (li) {
      var g = matchById[li.getAttribute("data-id")];
      if (headingEls[g] && !placed[g]) { listEl.appendChild(headingEls[g]); placed[g] = true; }
      listEl.appendChild(li);
    });
    // Uten filtre eller søk vises de første LIST_LIMIT stedene (de best vurderte først), og «Vis alle 32» viser
    // resten, så listen ikke skyver alt annet langt ned. Resten er alltid i kartet.
    var filtered = filter.directions.length || filter.level || filter.category || filter.q || (suggest && assessments);
    var limited = !filtered && !listExpanded;
    var visible = items.filter(function (li) { return !li.hidden; });
    visible.forEach(function (li, i) { li.classList.toggle("results__li--more", limited && i >= LIST_LIMIT); });
    if (moreEl) {
      moreEl.hidden = !limited || visible.length <= LIST_LIMIT;
      moreEl.textContent = FS.t("home.showAll", { n: visible.length });
    }
    if (windLegendEl) windLegendEl.hidden = !assessments;

    var title = filtered
      ? FS.tn("home.matchFilters", counts.match)
      : FS.t("home.sites", { n: counts.match });
    if (counts.nowind) title += FS.t("home.withoutForecast", { n: counts.nowind });
    if (counts.unknown) title += FS.t("home.withoutLevel", { n: counts.unknown });
    titleEl.textContent = title;
    var shown = counts.match + counts.unknown + counts.nowind;
    var shownText = shown === sites.length
      ? FS.t("home.showingAll", { n: sites.length })
      : FS.t("home.showingSome", { shown: shown, n: sites.length });
    noResultsEl.hidden = counts.match + counts.unknown + counts.nowind !== 0;
    // Oppsummeringen følger retning, nivå, kategori og søk, men ikke «Bare steder som kan passe», som ellers
    // ville skjult det oppsummeringen forklarer.
    var scope = assessments ? sites.filter(function (s) { return matches(s, assessments[s.id], true, true) !== "no"; })
      .map(function (s) { return s.id; }) : [];
    var sum = assessments ? summarize(assessments, scope) : null;
    // Når ingen passer på det valgte tidspunktet: når det neste vinduet er, så svaret er «når», ikke bare «ikke nå».
    if (sum && sum.counts.ok + sum.counts.maybe === 0) sum.next = nextWindowText(scope, Date.parse(forecast.times[windIndex]));
    renderSummary(sum);
    renderStatus(sum, shownText);
    renderTimeline(scope.length ? scope : sites.filter(function (s) { return matches(s, null, false, true) !== "no"; }).map(function (s) { return s.id; }));
    // Tomt resultat med forslag på: si hvorfor, ikke bare at ingen passer.
    noResultsEl.textContent = suggest && sum && sum.counts.ok + sum.counts.maybe === 0
      ? FS.t("home.noneSuggest", { reason: noneReason(sum) + (sum.next ? " " + sum.next : "") })
      : filter.q && !sites.some(function (s) { return H.nameMatches(s, filter.q); })
        ? FS.t("home.noName", { q: filter.q.trim() })
        : FS.t("home.noResults");
    renderSearchHits();
    renderDayPlan();
    updateFiltersToggle(shown);
  }

  // «Filter»-knappen: hvor mange filtre som er valgt, som et antall. Den åpner retning, nivå, kategori og «Bare steder
  // som kan passe» som et panel fra bunnen av skjermen (mobil) eller brettet ut under (PC). «Vis 12 flysteder»,
  // bakgrunnen og Esc lukker det igjen.
  var filtersToggle = document.getElementById("filters-toggle");
  var filtersMore = document.getElementById("filters-more");
  var filtersDone = document.getElementById("filters-done");
  var filtersBackdrop = document.getElementById("filters-backdrop");
  var filtersClose = document.getElementById("filters-close");
  var filtersReset = document.getElementById("filters-reset");
  var chipsEl = document.getElementById("filter-chips");
  var directionChosenEl = document.getElementById("direction-chosen");
  var DESKTOP = window.matchMedia("(min-width: 1100px)");
  function updateFiltersToggle(shown) {
    if (!filtersToggle) return;
    var n = (filter.directions.length ? 1 : 0) + (filter.level ? 1 : 0) + (filter.category ? 1 : 0) + (suggest ? 1 : 0);
    var count = filtersToggle.querySelector(".filters-toggle__count");
    count.textContent = n ? String(n) : "";
    count.hidden = !n;
    if (filtersReset) filtersReset.hidden = !n;
    renderChips();
    if (filtersDone) filtersDone.textContent = FS.tn("home.showSites", shown);
    if (directionChosenEl) {
      directionChosenEl.textContent = filter.directions.length
        ? filter.directions.map(function (d) { return FS.DIRECTION_LABELS[d]; }).join(", ")
        : FS.t("home.allDirections");
    }
  }
  // De valgte filtrene som brikker under søket: én per retning, nivå, kategori og «Kan passe», hver fjernes med ✕.
  // Bygget med DOM-kall, så ingen tekst leses som markup.
  var SVG_NS = "http://www.w3.org/2000/svg";
  function chip(label, remove) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "filter-chip";
    button.setAttribute("aria-label", FS.t("home.removeFilter", { name: label }));
    button.appendChild(document.createTextNode(label));
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "14"); svg.setAttribute("height", "14"); svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M6 6l12 12M18 6L6 18");
    svg.appendChild(path);
    button.appendChild(svg);
    button.addEventListener("click", function () {
      var index = Array.prototype.indexOf.call(chipsEl.children, button);
      remove();
      update();
      writeHash();
      // Brikkene tegnes på nytt: fokus går til den på samme plass, eller tilbake til søket når ingen er igjen.
      var left = chipsEl.children;
      (left.length ? left[Math.min(index, left.length - 1)] : searchEl).focus();
    });
    return button;
  }
  function renderChips() {
    if (!chipsEl) return;
    var chips = filter.directions.map(function (d) {
      return chip(FS.DIRECTION_LABELS[d], function () { FS.track("filter/chip/direction"); setFilter("direction", d); });
    });
    ["level", "category"].forEach(function (type) {
      if (filter[type]) chips.push(chip(type === "category" ? FS.t("categories." + filter[type]) : filter[type], function () { FS.track("filter/chip/" + type); setFilter(type, ""); }));
    });
    if (suggest) chips.push(chip(FS.t("home.suggestChip"), function () { FS.track("filter/chip/suggest"); setSuggest(false); }));
    chipsEl.replaceChildren.apply(chipsEl, chips);
    chipsEl.hidden = !chips.length;
  }
  function resetFilters() {
    setDirections([]);
    setFilter("level", "");
    setFilter("category", "");
    setSuggest(false);
    update();
    writeHash();
  }

  // På mobil er panelet en modal dialog: role og aria-modal mens det er åpent, og Tab flytter bare mellom knappene.
  // På PC brettes det ut under søkefeltet, og siden kan fortsatt brukes.
  function isSheet() { return !DESKTOP.matches; }
  function setFiltersOpen(open) {
    filtersToggle.setAttribute("aria-expanded", String(open));
    filtersMore.classList.toggle("is-open", open);
    if (open && isSheet()) { filtersMore.setAttribute("role", "dialog"); filtersMore.setAttribute("aria-modal", "true"); }
    else { filtersMore.setAttribute("role", "group"); filtersMore.removeAttribute("aria-modal"); }
    if (filtersBackdrop) filtersBackdrop.hidden = !open;
    document.body.classList.toggle("sheet-open", open);
    if (open) (isSheet() && filtersDone ? filtersDone : filtersClose || filtersToggle).focus();
    else filtersToggle.focus();
  }
  function trapFocus(e) {
    var items = Array.prototype.filter.call(filtersMore.querySelectorAll("button, a[href], input"), function (el) {
      return !el.disabled && el.offsetParent !== null;
    });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !filtersMore.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !filtersMore.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }
  if (filtersToggle) {
    filtersToggle.addEventListener("click", function () { setFiltersOpen(filtersToggle.getAttribute("aria-expanded") !== "true"); });
    if (filtersDone) filtersDone.addEventListener("click", function () { setFiltersOpen(false); });
    if (filtersClose) filtersClose.addEventListener("click", function () { setFiltersOpen(false); });
    if (filtersReset) filtersReset.addEventListener("click", function () { FS.track("filter/reset"); resetFilters(); (isSheet() ? filtersDone : filtersClose).focus(); });
    if (filtersBackdrop) filtersBackdrop.addEventListener("click", function () { setFiltersOpen(false); });
    document.addEventListener("keydown", function (e) {
      if (filtersToggle.getAttribute("aria-expanded") !== "true") return;
      if (e.key === "Escape") setFiltersOpen(false);
      else if (e.key === "Tab" && isSheet()) trapFocus(e);
    });
  }

  // Søkefeltet filtrerer mens du skriver, sammen med de andre filtrene. Kartet zoomer til treffene
  // (litt forsinket, så det ikke hopper for hver bokstav). Enter med ett treff velger stedet, Esc tømmer.
  var searchEl = document.getElementById("site-search");
  var searchHitsEl = document.getElementById("search-hits");
  var searchTimer = null;
  var missTimer = null;
  var MAX_HITS = 6;
  // Opptil MAX_HITS treff som knapper under feltet. Flere treff: bare antallet, de er i listen.
  function renderSearchHits() {
    if (!searchHitsEl) return;
    var hits = filter.q.trim() ? visibleMatches() : [];
    searchHitsEl.hidden = !filter.q.trim();
    if (!hits.length) { searchHitsEl.replaceChildren(FS.frag(filter.q.trim() ? FS.h("p", { class: "muted" }, FS.t("home.noHits")) : null)); return; }
    searchHitsEl.replaceChildren(FS.frag(hits.length > MAX_HITS
      ? FS.h("p", { class: "muted" }, FS.t("home.manyHits", { n: hits.length }))
      : hits.map(function (s) { return FS.h("button", { type: "button", class: "pill", "data-select": s.id }, s.name); })));
  }
  function visibleMatches() {
    return sites.filter(function (s) { var li = listEl.querySelector('[data-id="' + s.id + '"]'); return li && !li.hidden; });
  }
  function fitToMatches() {
    var hits = visibleMatches();
    if (!filter.q || !hits.length) return;
    if (hits.length === 1) map.setView([hits[0].lat, hits[0].lon], Math.max(map.getZoom(), 12));
    else map.fitBounds(hits.map(function (s) { return [s.lat, s.lon]; }), { padding: [40, 40], maxZoom: 12 });
  }
  function setSearch(value) {
    filter.q = value || "";
    if (searchEl && searchEl.value !== filter.q) searchEl.value = filter.q;
  }
  if (searchEl) {
    searchEl.addEventListener("input", function () {
      setSearch(searchEl.value);
      update();
      writeHash();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(fitToMatches, 350);
      // Søk uten treff telles når du slutter å skrive, men bare som et tall: søketeksten sendes aldri.
      // Folk skriver alt mulig i et søkefelt (navn, adresser), og en teller uten informasjonskapsler er fortsatt
      // en tredjepart.
      clearTimeout(missTimer);
      missTimer = setTimeout(function () {
        if (filter.q.trim().length >= 3 && !visibleMatches().length) FS.track("search/no-hits");
      }, 2000);
    });
    searchEl.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && searchEl.value) {
        ev.preventDefault();
        setSearch("");
        update();
        writeHash();
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        var hits = visibleMatches();
        if (hits.length === 1) { clearTimeout(searchTimer); select(hits[0].id, "pick"); }
      }
    });
  }
  if (searchHitsEl) {
    searchHitsEl.addEventListener("click", function (ev) {
      var button = ev.target.closest("button[data-select]");
      if (button) { clearTimeout(searchTimer); select(button.getAttribute("data-select"), "pick"); }
    });
  }

  // --- Dagsplan («Når kan det passe?») ---
  // For i dag og de neste dagene i prognosen: stedene som treffer filtrene (retning, nivå, kategori, søk), med
  // periodene i dagslys der vurderingen er «Kan passe» eller «Usikkert» (dayWindows i wind.js). Steder med
  // flest timer som passer, kommer først. Bygget med DOM-metoder, så ingenting fra dataene tolkes som HTML.
  var dayPlanEl = document.getElementById("day-plan");
  var dayPlanDaysEl = document.getElementById("day-plan-days");
  var DAY_PLAN_DAYS = 3, DAY_PLAN_SHOWN = 6;
  var dayFormat = new Intl.DateTimeFormat(FS.lang === "nb" ? "nb-NO" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Oslo" });
  function domEl(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = String(text);
    return n;
  }
  var hourLabel = H.hourLabel;
  function windowChip(w) {
    var end = W.osloParts(w.end).hour === 0 ? "24" : hourLabel(w.end);
    // «10–18 SV 3–5 (7)»: perioden, vanligste retning, middelvind fra–til og høyeste kast.
    var chip = domEl("span", "day-plan__time day-plan__time--" + w.rating);
    chip.appendChild(domEl("strong", "", hourLabel(w.start) + "–" + end));
    var speed = w.min === w.max ? String(w.min) : w.min + "–" + w.max;
    chip.appendChild(domEl("span", "day-plan__wind", FS.DIRECTION_LABELS[w.dir] + " " + speed + (w.gust != null ? " (" + w.gust + ")" : "")));
    chip.title = RATINGS[w.rating].label + ": " + FS.t("dayPlan.windTitle", { dir: FS.DIRECTION_LABELS[w.dir], speed: speed, gust: w.gust != null ? w.gust : "?" });
    return chip;
  }
  function siteRow(entry) {
    var li = domEl("li", "day-plan__site");
    var button = li.appendChild(domEl("button", "day-plan__name", entry.site.name));
    button.type = "button";
    button.setAttribute("data-select", entry.site.id);
    var times = li.appendChild(domEl("span", "day-plan__times"));
    entry.windows.forEach(function (w) { times.appendChild(windowChip(w)); });
    return li;
  }
  function renderDayPlan() {
    if (!dayPlanEl) return;
    if (!forecast || stale) { dayPlanEl.hidden = true; return; }
    var now = Date.now();
    var today = W.osloParts(now).date;
    var tomorrow = W.osloParts(now + 86400000).date;
    var perSite = sites.filter(function (s) { return matches(s, null, false, true) !== "no"; }).map(function (s) {
      return { site: s, days: W.dayWindows(forecast, s, rules, s.lat, s.lon) };
    });
    var dates = [];
    forecast.times.forEach(function (t) { var d = W.osloParts(Date.parse(t)).date; if (d >= today && dates.indexOf(d) === -1) dates.push(d); });
    dayPlanDaysEl.replaceChildren();
    dates.slice(0, DAY_PLAN_DAYS).forEach(function (date) {
      var entries = perSite.map(function (e) {
        var windows = (e.days[date] || []).filter(function (w) { return w.end > now; });
        var hours = function (rating) { return windows.reduce(function (n, w) { return n + (w.rating === rating ? (w.end - w.start) / 3600000 : 0); }, 0); };
        return { site: e.site, windows: windows, ok: hours("ok"), maybe: hours("maybe") };
      }).filter(function (e) { return e.windows.length; });
      entries.sort(function (a, b) { return b.ok - a.ok || b.maybe - a.maybe || a.site.name.localeCompare(b.site.name); });
      var good = entries.filter(function (e) { return e.ok; });
      var unsure = entries.filter(function (e) { return !e.ok; });
      var day = dayPlanDaysEl.appendChild(domEl("div", "day-plan__day"));
      var label = date === today ? FS.t("dayPlan.today") : date === tomorrow ? FS.t("dayPlan.tomorrow") : dayFormat.format(Date.parse(date + "T12:00:00Z"));
      day.appendChild(domEl("h3", "day-plan__date", label.charAt(0).toUpperCase() + label.slice(1)));
      // Prognosen slutter midt på dagen: si det, så «07–10» ikke ser ut som om det bare passer til 10.
      var lastTime = Date.parse(forecast.times[forecast.times.length - 1]) + W.stepAt(forecast.times, forecast.times.length - 1);
      if (W.osloParts(lastTime - 1).date === date && W.osloParts(lastTime).hour < 20) {
        day.appendChild(domEl("p", "muted day-plan__partial", FS.t("dayPlan.partial", { time: hourLabel(lastTime) })));
      }
      if (!good.length) day.appendChild(domEl("p", "muted", FS.t("dayPlan.none")));
      var list = day.appendChild(domEl("ul", "day-plan__list"));
      good.slice(0, DAY_PLAN_SHOWN).forEach(function (e) { list.appendChild(siteRow(e)); });
      if (good.length > DAY_PLAN_SHOWN) {
        var more = day.appendChild(domEl("details", "day-plan__more"));
        more.appendChild(domEl("summary", "", FS.t("dayPlan.more", { n: good.length - DAY_PLAN_SHOWN })));
        var rest = more.appendChild(domEl("ul", "day-plan__list"));
        good.slice(DAY_PLAN_SHOWN).forEach(function (e) { rest.appendChild(siteRow(e)); });
      }
      if (unsure.length) {
        var maybe = day.appendChild(domEl("details", "day-plan__more"));
        maybe.appendChild(domEl("summary", "", FS.t("dayPlan.maybeOnly", { n: unsure.length })));
        var mlist = maybe.appendChild(domEl("ul", "day-plan__list"));
        unsure.forEach(function (e) { mlist.appendChild(siteRow(e)); });
      }
    });
    dayPlanEl.hidden = !dates.length;
  }
  if (dayPlanDaysEl) {
    dayPlanDaysEl.addEventListener("click", function (ev) {
      var button = ev.target.closest("button[data-select]");
      if (!button) return;
      FS.track("day-plan/select/" + button.getAttribute("data-select"));
      select(button.getAttribute("data-select"), "pick");
    });
  }

  // Setter et filter og markerer riktig knapp. Ukjente verdier (f.eks. fra en gammel lenke) gir «Alle». Retning veksler:
  // en sektor slår den retningen av eller på, og «Alle» tømmer dem. Flere retninger kan være på samtidig.
  function setFilter(type, value) {
    var buttons = document.querySelectorAll('button[data-filter="' + type + '"]');
    var known = function (v) { return Array.prototype.some.call(buttons, function (b) { return b.getAttribute("data-value") === v; }); };
    if (type === "direction") {
      var list = filter.directions.filter(function (d) { return d !== value; });
      if (value && known(value) && list.length === filter.directions.length) list.push(value);
      setDirections(value ? list : []);
      return;
    }
    value = known(value) ? value : "";
    filter[type] = value;
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-value") === value ? "true" : "false"); });
  }
  function setDirections(list) {
    filter.directions = FS.DIRECTIONS.filter(function (d) { return list.indexOf(d) !== -1; });
    document.querySelectorAll('button[data-filter="direction"]').forEach(function (b) {
      var v = b.getAttribute("data-value");
      b.setAttribute("aria-pressed", String(v ? filter.directions.indexOf(v) !== -1 : !filter.directions.length));
    });
  }

  // Tidspunktet som timer fra nå. Gamle lenker kan ha «tomorrow» (12:00 i morgen) eller «off», som gir nærmeste gyldige.
  // Lenger fram har prognosen et tidspunkt hver 6. time, så timene rundes til nærmeste tidspunkt den har (from:
  // timene valgt nå, så å gå én time om gangen flytter videre til det neste).
  function setWind(value, from) {
    if (!forecast || stale) return;
    var now = Date.now(), ahead = W.hoursAhead(forecast.times, now);
    var tomorrow = value === "tomorrow" ? W.slotIndex(forecast.times, "tomorrow", now) : -1;
    var hours = tomorrow >= 0 ? ahead.filter(function (a) { return a.index === tomorrow; }).map(function (a) { return a.hours; })[0] : parseInt(value, 10);
    windSlot = String(Number.isFinite(hours) && hours > 0 ? W.nearestHours(ahead, hours, from) : 0);
  }

  // Forslagsbryteren virker bare med en prognose. Teksten følger det valgte tidspunktet («nå», «kl. 17.00» …).
  var suggestButton = document.querySelector("button[data-suggest]");
  function setSuggest(on) {
    suggest = !!(on && suggestButton && forecast && !stale);
    if (!suggestButton) return;
    var windOn = windSlot !== "off";
    suggestButton.hidden = !forecast || stale;
    suggestButton.setAttribute("aria-pressed", String(suggest && windOn));
    var index = windOn ? W.slotIndex(forecast.times, windSlot, Date.now()) : -1;
    suggestButton.textContent = FS.t("home.suggest") + (index >= 0 ? " " + whenLabel(index) : "");
  }

  var FILTER_NAMES = { direction: "direction", level: "level", category: "category" };
  filtersMore.addEventListener("click", function (ev) {
    var button = ev.target.closest("button[data-filter], button[data-suggest]");
    if (!button) return;
    // Hendelsesnavnene er like på alle språk, så tallene i GoatCounter kan summeres.
    if (button.hasAttribute("data-suggest")) FS.track("filter/suggest/" + (suggest ? "off" : "on"));
    else FS.track("filter/" + FILTER_NAMES[button.getAttribute("data-filter")] + "/" + (button.getAttribute("data-value") || "all"));
    if (button.hasAttribute("data-suggest")) setSuggest(!suggest);
    else setFilter(button.getAttribute("data-filter"), button.getAttribute("data-value"));
    update();
    writeHash();
  });

  // --- Tidslinje: tidspunktet for vindvurderingen ---
  // «Nå» og en glidebryter over timene i prognosen. Sporet er farget time for time med den beste vurderingen blant
  // stedene som treffer filtrene, så du ser når det kan passe, med ukedagen ved hver midnatt.
  var timelineEl = document.getElementById("timeline");
  var rangeEl = document.getElementById("timeline-range");
  var timeEl = document.getElementById("timeline-time");
  var nowButton = document.getElementById("timeline-now");
  var barEl = document.getElementById("timeline-bar");
  var daysEl = document.getElementById("timeline-days");
  var BAR_COLORS = { ok: "var(--wind-ok)", maybe: "var(--wind-maybe)", high: "var(--wind-high)", no: "var(--wind-no)" };
  function renderTimeline(ids) {
    if (!timelineEl) return;
    var now = Date.now(), ahead = forecast && !stale ? W.hoursAhead(forecast.times, now) : [];
    timelineEl.hidden = !ahead.length;
    if (!ahead.length) return;
    // Glidebryteren og sporet i timer, så 6-timerssteget lenger fram tar den plassen tiden deres gjør.
    var max = ahead[ahead.length - 1].hours;
    var total = max + W.stepAt(forecast.times, ahead[ahead.length - 1].index) / 3600000;
    rangeEl.max = String(max);
    rangeEl.value = windSlot;
    var index = W.slotIndex(forecast.times, windSlot, now);
    // «kl. 13.00» også for nå (knappen sier «Nå»), med dagen når det ikke er i dag.
    var label = windSlot === "0" ? FS.t("home.whenToday", { time: W.formatClock(Date.parse(forecast.times[index])) }) : whenLabel(index);
    timeEl.textContent = label;
    rangeEl.setAttribute("aria-valuetext", label);
    nowButton.setAttribute("aria-pressed", String(windSlot === "0"));
    var stops = [], days = [], coarse = null;
    var byId = {};
    sites.forEach(function (s) { byId[s.id] = s; });
    var pct = function (h) { return (h / total * 100).toFixed(2) + "%"; };
    ahead.forEach(function (a) {
      var best = null;
      ids.forEach(function (id) {
        var wind = W.windAt(forecast, id, a.index);
        if (!wind) return;
        var r = W.rateWind(byId[id], wind, rules).rating;
        if (!best || RATINGS[r].order < RATINGS[best].order) best = r;
      });
      var step = W.stepAt(forecast.times, a.index) / 3600000;
      if (step > 1 && coarse === null) coarse = a.hours;
      var color = best ? BAR_COLORS[best] : "var(--line)";
      stops.push(color + " " + pct(a.hours), color + " " + pct(a.hours + step));
    });
    // Ukedagen ved hver midnatt i Norge, uansett hvor den faller mellom tidspunktene i prognosen.
    var start = Date.parse(forecast.times[ahead[0].index]);
    for (var h = 1; h <= max; h++) {
      var ms = start + h * 3600000;
      if (W.osloParts(ms).hour !== 0) continue;
      var day = document.createElement("span");
      day.style.left = pct(h);
      day.textContent = dayShort.format(ms).replace(/\.$/, "");
      days.push(day);
    }
    barEl.style.background = "linear-gradient(90deg, " + stops.join(", ") + ")";
    // Fra der prognosen bare har et tidspunkt hver 6. time (ingen kast): stripet, med sin egen tekst for musen.
    var coarseEl = null;
    if (coarse !== null) {
      coarseEl = document.createElement("span");
      coarseEl.className = "timeline__coarse";
      coarseEl.style.left = pct(coarse);
      coarseEl.title = FS.t("home.coarse");
    }
    barEl.replaceChildren.apply(barEl, coarseEl ? [coarseEl] : []);
    daysEl.replaceChildren.apply(daysEl, days);
  }
  function setTime(value, track, from) {
    setWind(String(value), from);
    setSuggest(suggest);
    update();
    writeHash();
    if (track) FS.track("filter/wind/" + windSlot);
  }
  if (rangeEl) {
    rangeEl.addEventListener("input", function () { setTime(rangeEl.value, false, Number(windSlot)); });
    rangeEl.addEventListener("change", function () { FS.track("filter/wind/" + windSlot); });
    nowButton.addEventListener("click", function () { setTime(0, true); });
  }

  // Lukk kortet for det valgte stedet (på PC ligger det oppå kartet).
  cardEl.addEventListener("click", function (ev) {
    if (!ev.target.closest("[data-close-card]")) return;
    selectedId = null;
    resetCard();
    update();
    writeHash();
  });

  // --- Faner: Flysteder og Vær ---
  // Bytter innholdet i venstre kolonne (under kartet på mobil). Kartet blir alltid stående. Piltastene bytter fane.
  var TAB_NAMES = { "tab-sites": "sites", "tab-weather": "weather" };
  var tabButtons = Array.prototype.slice.call(document.querySelectorAll('.home-tabs [role="tab"]'));
  function showTab(button, focus) {
    tabButtons.forEach(function (b) {
      var on = b === button;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      document.getElementById(b.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) button.focus();
  }
  tabButtons.forEach(function (b, i) {
    b.addEventListener("click", function () { FS.track("tab/" + TAB_NAMES[b.id]); showTab(b); });
    b.addEventListener("keydown", function (ev) {
      var step = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
      if (step) { ev.preventDefault(); showTab(tabButtons[(i + step + tabButtons.length) % tabButtons.length], true); }
    });
  });

  // --- Tilstand i adressen ---
  // Filtre, søk, vindtid og valgt sted lagres i adressen (#direction=W,NW&level=PP3&wind=3&q=solli&site=sollifjellet),
  // så tilbakeknappen og delte lenker gir samme visning. replaceState, så hvert klikk ikke blir et steg i historikken.
  function writeHash() {
    var hash = H.hashFor({ filter: filter, windSlot: windSlot, windOn: !!(forecast && !stale), suggest: suggest, site: selectedId });
    history.replaceState(null, "", hash ? "#" + hash : location.pathname + location.search);
    saveView();
  }

  function readHash() {
    var state = H.parseHash(location.hash);
    setDirections(state.directions);
    setFilter("level", state.level);
    setFilter("category", state.category);
    setWind(state.wind);
    setSuggest(state.suggest);
    setSearch(state.q);
    selectedId = sites.some(function (s) { return s.id === state.site; }) ? state.site : null;
    if (!selectedId) {
      resetCard();
    }
    update();
    writeHash(); // fjerner ukjente verdier fra adressen
  }

  window.addEventListener("hashchange", readHash);

  // --- Mobil: kartet øverst ---
  // Kartet blir stående øverst på skjermen (CSS, position: sticky). Det krymper når listen er rullet litt, og
  // vokser igjen nær toppen. To terskler, så det ikke flimrer imellom. Under søk er det enda mindre, så
  // treffene har plass over tastaturet.
  function onScroll() {
    if (!MOBILE.matches) return;
    var y = window.scrollY;
    if (y > 200) homeEl.classList.add("home--small");
    else if (y < 20) homeEl.classList.remove("home--small");
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  if (searchEl) {
    searchEl.addEventListener("focus", function () { if (MOBILE.matches) homeEl.classList.add("home--search"); });
    // Forsinket, så et trykk på et søketreff ikke går tapt når oppsettet endres.
    searchEl.addEventListener("blur", function () { setTimeout(function () { homeEl.classList.remove("home--search"); }, 150); });
  }

  listEl.addEventListener("click", function (ev) {
    var button = ev.target.closest("button[data-select]");
    if (button) select(button.getAttribute("data-select"), "list");
  });

  // Når du kommer tilbake til en fane som har stått åpen, og hvert minutt: tegn på nytt når prognosen har
  // blitt for gammel, eller når det valgte tidspunktet peker på en annen time i prognosen (timeskifte for
  // «nå», «om 3 t» og «om 6 t», midnatt for «i morgen»).
  function recheck() {
    if (checkStale()) { update(); writeHash(); return; }
    if (forecast && !stale && windSlot !== "off" && W.slotIndex(forecast.times, windSlot, Date.now()) !== windIndex) update();
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) recheck(); });
  setInterval(recheck, 60 * 1000);

  // --- Værstasjoner (stations.js) ---
  // Den målte vinden som kartlagene «Klubbens værstasjoner» og «METs værstasjoner», og de samme stasjonene som korte
  // rader i Vær-fanen (endringen den siste halvtimen); grafene og resten er på værsiden, som hver rad lenker til.
  function addStations() {
    var ST = window.FlyingSitesStations;
    var stationsEl = document.getElementById("stations");
    var listEl2 = document.getElementById("station-list");
    if (!ST || !stationsEl) return;
    ST.useRules(rules);
    // Hver rad lenker til kortet for stasjonen på værsiden (lenken under listen gir adressen).
    var more = stationsEl.querySelector(".stations__more");
    var weatherUrl = more ? more.getAttribute("href") : "";
    var lastMeasured = null;
    ST.addMapLayer(map, stationsEl.getAttribute("data-url"), function (data, now) {
      stationData = data;
      // Stasjonene svarer hvert minutt, og update() tegner alle markørene, radene og klyngene på nytt, som er mye på
      // en telefon. Målingene går inn i vurderingen bare ved «Nå» (assessAll), så siden tegnes på nytt bare da,
      // og bare når en måling som teller, har endret seg (eller blitt gammel).
      var measured = windSlot === "0" ? JSON.stringify(data.items.filter(function (i) { return i.site; }).map(function (i) {
        var m = ST.measurement(i, now);
        return [i.site, m ? m.wind : null, m ? m.steady : null];
      })) : null;
      if (measured !== lastMeasured) { lastMeasured = measured; update(); }
      // Klubbens stasjoner som rader, i sin egen rekkefølge (Heia først); METs som en liten sammenbrettet tabell under.
      listEl2.replaceChildren.apply(listEl2, ST.groups(data.items).club.map(function (item) { return ST.row(item, now, 30, weatherUrl + "#" + ST.anchor(item), true); }));
      var oldMet = stationsEl.querySelector(".met-stations"), met = ST.metTable(data.items, now, oldMet && oldMet.open);
      if (oldMet) oldMet.remove();
      if (met) listEl2.after(met);
      stationsEl.hidden = !data.items.length;
    });
  }

  readHash();

  // En nyere prognose fra datatjenesten (workers/data), med en gang, hvert tiende minutt mens siden er synlig, og når
  // den blir synlig igjen eller kommer på nett (wind.js watchForecast). Den gir vurderingen tilbake når prognosen i
  // siden har blitt for gammel, og gir en til en side bygget uten prognose (delene som viser den, er i siden så lenge
  // det finnes en datatjeneste, index.njk).
  W.watchForecast(fc.live, function () { return forecast; }, function (newer) {
    var first = !forecast || stale;
    forecast = newer;
    if (first) { stale = false; windSlot = "0"; setSuggest(false); }
    update();
  });
})();
