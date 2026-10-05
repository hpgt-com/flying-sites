// Forsiden: filtre, kart med vindroser, vindvurdering fra varselet, kort for valgt sted og liste.
(function () {
  "use strict";

  var FS = window.FlyingSites;
  var sites = FS.readJson("sites-data") || [];
  var LEVELS = ["PP2", "PP3", "PP4", "PP5"];
  var filter = { direction: "", level: "", category: "" };
  var selectedId = null;
  var markers = {};

  // "match", "unknown" eller "no". Nivåfilteret viser steder for valgt nivå og lavere (en PP3-pilot kan
  // fly PP2-steder). Steder uten registrert nivå skjules ikke, men får "unknown" og vises for seg, siden
  // de fleste stedene ikke har nivå ennå og et tomt resultat ellers ville sett ut som «ingen steder».
  // Med forslag fra varselet på («Vis bare steder som kan passe») tones steder der vurderingen er
  // «Passer ikke» eller «For mye vind» ned, som når man velger en retning. «Kan passe» og «Usikkert» blir
  // stående. Steder uten varsel blir også stående, så ingen forsvinner fordi hentingen feilet.
  var suggest = false;
  function matches(site, assessment) {
    if (suggest && assessment && (assessment.rating === "no" || assessment.rating === "high")) return "no";
    if (filter.direction && site.primary.indexOf(filter.direction) === -1 && site.possible.indexOf(filter.direction) === -1) return "no";
    if (filter.category && site.categories.indexOf(filter.category) === -1) return "no";
    if (filter.level && !site.level) return "unknown";
    if (filter.level && LEVELS.indexOf(site.level) > LEVELS.indexOf(filter.level)) return "no";
    return "match";
  }

  function directionBadges(site) {
    return FS.DIRECTIONS.filter(function (code) { return FS.directionType(site, code) !== "none"; })
      .map(function (code) {
        var active = code === filter.direction ? " direction--active" : "";
        return '<span class="direction direction--' + FS.directionType(site, code) + active + '">' + FS.DIRECTION_LABELS[code] + "</span>";
      }).join("");
  }

  function tags(site) {
    var html = site.level ? '<span class="tag">' + site.level + "</span>" : '<span class="tag tag--missing">Nivå ikke satt</span>';
    if (site.trainingSite) html += '<span class="tag">Kursplass</span>';
    site.categories.forEach(function (c) { html += '<span class="tag">' + c + "</span>"; });
    if (!site.reviewed) html += '<span class="tag tag--warning">Ikke gjennomgått ennå</span>';
    return html;
  }

  // --- Vindvurdering fra MET-varselet ---
  // Logikken ligger i wind.js. Her velges tidspunkt, og resultatet vises i kart, liste og kort.
  var W = window.FlyingSitesWind;
  var RATINGS = W.RATINGS;
  var fc = FS.readJson("forecast-data") || {};
  var rules = fc.rules;
  var forecast = fc.forecast || null;
  var forecastStatusEl = document.getElementById("forecast-status");
  // Er varselet for gammelt (den planlagte byggingen har stoppet, eller siden er lagret i nettleseren),
  // slås vindvurderingen av, og det står hvorfor.
  var stale = forecast ? W.isStale(forecast, rules, Date.now()) : false;
  var windSlot = forecast && !stale ? "0" : "off";
  var windIndex = -1; // indeks i varselet for valgt tidspunkt, settes av assessAll()
  var SLOT_LABELS = { "0": "nå", "3": "om 3 t", "6": "om 6 t", tomorrow: "i morgen" };

  function fetchedText() {
    var fetched = Date.parse(forecast.fetched);
    var today = W.osloParts(Date.now()).date, day = W.osloParts(fetched).date;
    return (day === today ? "i dag" : day.slice(8, 10) + "." + day.slice(5, 7)) + " kl. " + W.formatClock(fetched);
  }

  if (forecast && stale) {
    var pills = document.querySelector("#filters [data-wind]").parentNode;
    pills.hidden = true;
    forecastStatusEl.innerHTML = "<strong>Varselet er for gammelt.</strong> Det ble hentet " + fetchedText() +
      ". Vindvurderingen er slått av til siden er oppdatert. Sjekk Yr eller Windy.";
  }

  // Tekst under vindvalget: når varselet ble hentet, og hvilket klokkeslett vurderingen gjelder.
  function updateForecastStatus(index) {
    if (!forecast || stale) return;
    var text = "Varsel fra MET hentet " + fetchedText() + ".";
    if (windSlot !== "off") {
      text = index < 0
        ? "<strong>Varselet dekker ikke dette tidspunktet.</strong> " + text
        : "Viser vind kl. " + W.formatClock(Date.parse(forecast.times[index])) + (windSlot === "tomorrow" ? " i morgen" : "") + ". " + text;
    }
    forecastStatusEl.innerHTML = text;
  }

  function windText(wind) {
    return FS.DIRECTION_LABELS[W.directionCode(wind.dir)] + " " + Math.round(wind.speed) + " m/s" +
      (wind.gust != null ? ", kast " + Math.round(wind.gust) : ", kast ukjent");
  }

  // Vurdering for alle stedene på valgt tidspunkt: { id: { wind, rating, reasons } }, eller null når vind er av
  // eller varselet ikke dekker tidspunktet. Steder uten varsel (hentingen feilet) mangler i resultatet.
  function assessAll() {
    if (!forecast || stale) return null;
    if (windSlot === "off") { updateForecastStatus(-1); return null; }
    var index = W.slotIndex(forecast.times, windSlot, Date.now());
    windIndex = index;
    updateForecastStatus(index);
    if (index < 0) return null;
    var result = {};
    sites.forEach(function (site) {
      var wind = W.windAt(forecast, site.id, index);
      if (!wind) return;
      var rating = W.rateWind(site, wind, rules);
      result[site.id] = { wind: wind, rating: rating.rating, reasons: rating.reasons };
    });
    return result;
  }

  // --- Kart ---
  var mapEl = document.getElementById("home-map");
  var map = FS.createMap(mapEl);
  FS.addAirspaceLayers(map, mapEl.getAttribute("data-airspace-url"));
  var bounds = [];

  // Pilen står på siden vinden kommer fra og peker inn mot starten, som vinden som blåser inn i rosen.
  // Nedtoning og valgt sted ligger i className, så det overlever når markøren tas ut av og inn i en klynge.
  // match: "match", "unknown" (nivå ikke satt) eller "no", se matches().
  function markerIcon(site, assessment, match, selected) {
    var ring = assessment ? " rose-marker__ring--" + assessment.rating : "";
    var arrow = assessment ? '<span class="wind-arrow" style="transform: rotate(' + assessment.wind.dir + 'deg)"></span>' : "";
    return L.divIcon({
      className: "rose-marker" + (match === "no" ? " rose-marker--dimmed" : match === "unknown" ? " rose-marker--unknown" : "") +
        (selected ? " rose-marker--selected" : ""),
      html: '<span class="rose-marker__ring' + ring + '">' + FS.roseSvg(site, 32, false) + arrow + "</span>" +
        '<span class="rose-marker__name">' + FS.escapeHtml(site.name) + "</span>",
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    });
  }

  // Starter som ligger oppå hverandre på kartet slås sammen til en klynge med antall.
  // Antallet teller steder som passer filteret, eller steder uten nivå når ingen passer helt.
  // Med vind på får ringen fargen til den beste vurderingen blant dem som telles.
  var markerState = {}; // id: { match, rating, selected }, oppdateres i update()
  function clusterIcon(cluster) {
    var children = cluster.getAllChildMarkers();
    var counts = { match: 0, unknown: 0, no: 0 }, best = { match: null, unknown: null }, selected = false;
    children.forEach(function (m) {
      var st = markerState[m.options.siteId] || { match: "match" };
      if (st.selected) selected = true;
      counts[st.match]++;
      if (st.match === "no" || !st.rating) return;
      if (!best[st.match] || RATINGS[st.rating].order < RATINGS[best[st.match]].order) best[st.match] = st.rating;
    });
    var shown = counts.match ? "match" : counts.unknown ? "unknown" : "no";
    var rating = best[shown];
    var ring = rating ? " rose-marker__ring--" + rating : "";
    return L.divIcon({
      className: "rose-marker site-cluster" + (shown === "no" ? " rose-marker--dimmed" : shown === "unknown" ? " rose-marker--unknown" : "") +
        (selected ? " rose-marker--selected" : ""),
      html: '<span class="rose-marker__ring site-cluster__ring' + ring + '">' + (shown === "no" ? children.length : counts[shown]) + "</span>",
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
  }
  var cluster = L.markerClusterGroup({
    maxClusterRadius: 32,
    showCoverageOnHover: false,
    spiderfyDistanceMultiplier: 1.6,
    iconCreateFunction: clusterIcon,
  }).addTo(map);

  sites.forEach(function (site) {
    var marker = L.marker([site.lat, site.lon], { icon: markerIcon(site, null, "match", false), title: site.name, alt: site.name, keyboard: true, riseOnHover: true, siteId: site.id });
    marker.bindTooltip(site.name, { direction: "top", offset: [0, -14] });
    marker.on("click", function () { select(site.id, "map"); });
    cluster.addLayer(marker);
    markers[site.id] = marker;
    bounds.push([site.lat, site.lon]);
  });
  // Stedsnavn under rosene når man har zoomet nært inn.
  var NAMES_ZOOM = 11;
  function toggleNames() { mapEl.classList.toggle("map--names", map.getZoom() >= NAMES_ZOOM); }
  map.on("zoomend", toggleNames);

  FS.fitWhenVisible(map, mapEl, function () {
    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
  });

  // --- Kort for valgt sted ---
  var cardEl = document.getElementById("selected");
  var emptyCardHtml = cardEl.innerHTML;
  function showCard(site, assessment, windOn) {
    var e = FS.escapeHtml;
    var html =
      '<div class="selected__top">' + FS.roseSvg(site, 84, true) +
      '<div class="selected__info"><h2 class="selected__name">' + e(site.name) + "</h2>" +
      '<div class="directions">' + directionBadges(site) + "</div>" +
      '<div class="tags">' + tags(site) + "</div></div></div>";
    if (assessment) {
      html += '<p class="selected__wind"><span class="wind-dot wind-dot--' + assessment.rating + '"></span>' +
        "Vind " + SLOT_LABELS[windSlot] + " (kl. " + W.formatClock(Date.parse(forecast.times[windIndex])) + "): " +
        windText(assessment.wind) + ". <strong>" + RATINGS[assessment.rating].label + "</strong></p>";
      if (assessment.reasons.length) html += '<p class="selected__reasons">' + e(assessment.reasons.join(". ")) + ".</p>";
      if (site.maxWind != null && assessment.reasons.join().indexOf("grensen for stedet") === -1) html += '<p class="selected__reasons">Stedets egen grense: ' + site.maxWind + " m/s.</p>";
    } else if (windOn) {
      html += '<p class="selected__wind muted">Ingen vindvarsel for stedet på dette tidspunktet.</p>';
    }
    if (site.text) html += '<p class="selected__text">' + e(site.text) + "</p>";
    html += '<a class="btn btn--primary btn--wide" href="' + e(site.url) + '">Se hele stedet</a>';
    if (site.flightlogId) {
      html += '<a class="btn btn--wide" href="https://flightlog.org/fl.html?l=1&amp;a=22&amp;country_id=160&amp;start_id=' +
        encodeURIComponent(site.flightlogId) + '" target="_blank" rel="noopener">Se på Flightlog' + FS.EXTERNAL_MARK + "</a>";
    }
    cardEl.innerHTML = html;
    cardEl.classList.add("selected--active");
  }

  function select(id, origin) {
    var site = sites.find(function (s) { return s.id === id; });
    if (!site) return;
    selectedId = id;
    update();
    writeHash();
    if (origin === "list") {
      // Ligger stedet i en klynge, zoomes det inn til markøren vises.
      cluster.zoomToShowLayer(markers[id], function () { map.panTo([site.lat, site.lon]); });
      if (window.matchMedia("(max-width: 1099px)").matches) cardEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // --- Filtre og liste ---
  var listEl = document.getElementById("results-list");
  var titleEl = document.getElementById("results-title");
  var noResultsEl = document.getElementById("no-results");
  var windLegendEl = document.getElementById("wind-legend");
  var originalOrder = Array.prototype.slice.call(listEl.children);

  // Overskrift i listen for steder uten nivå når nivåfilteret er på.
  var unknownHeadingEl = document.createElement("li");
  unknownHeadingEl.className = "results__group";
  unknownHeadingEl.hidden = true;

  function update() {
    var assessments = assessAll();
    var windOn = !!(forecast && !stale && windSlot !== "off");
    var counts = { match: 0, unknown: 0, no: 0 };
    var matchById = {};
    sites.forEach(function (site) {
      var assessment = assessments && assessments[site.id];
      var match = matches(site, assessment);
      matchById[site.id] = match;
      counts[match]++;
      var marker = markers[site.id];
      if (marker) {
        marker.setIcon(markerIcon(site, assessment, match, site.id === selectedId));
        markerState[site.id] = { match: match, rating: assessment ? assessment.rating : null, selected: site.id === selectedId };
        var order = assessment ? 3 - RATINGS[assessment.rating].order : 0;
        var base = { match: 500, unknown: 250, no: 0 }[match];
        marker.setZIndexOffset(site.id === selectedId ? 1000 : base + order * 10);
      }
      var li = listEl.querySelector('[data-id="' + site.id + '"]');
      if (li) {
        li.hidden = match === "no";
        var button = li.querySelector("button");
        button.classList.toggle("results__item--selected", site.id === selectedId);
        li.querySelector(".directions").innerHTML = directionBadges(site);
        var windEl = button.querySelector(".results__wind");
        if (!windEl) {
          windEl = document.createElement("span");
          windEl.className = "results__wind";
          button.appendChild(windEl);
        }
        windEl.hidden = !assessment && !(assessments && windOn);
        windEl.innerHTML = assessment
          ? '<span class="wind-dot wind-dot--' + assessment.rating + '"></span>' + windText(assessment.wind) + " · " + RATINGS[assessment.rating].label
          : "Ingen vindvarsel for stedet";
      }
      if (site.id === selectedId) showCard(site, assessment, windOn);
    });

    cluster.refreshClusters();

    // Steder uten nivå kommer til slutt. Med vind på sorteres hver gruppe etter vurdering, ellers alfabetisk som fra bygget.
    var items = originalOrder.slice();
    var group = function (li) { return matchById[li.getAttribute("data-id")] === "unknown" ? 1 : 0; };
    items.sort(function (a, b) {
      var ra = assessments && assessments[a.getAttribute("data-id")], rb = assessments && assessments[b.getAttribute("data-id")];
      return group(a) - group(b) ||
        (ra ? RATINGS[ra.rating].order : 9) - (rb ? RATINGS[rb.rating].order : 9) ||
        originalOrder.indexOf(a) - originalOrder.indexOf(b);
    });
    if (unknownHeadingEl.parentNode) listEl.removeChild(unknownHeadingEl);
    var headingPlaced = false;
    items.forEach(function (li) {
      if (group(li) && !headingPlaced) { listEl.appendChild(unknownHeadingEl); headingPlaced = true; }
      listEl.appendChild(li);
    });
    unknownHeadingEl.hidden = !counts.unknown;
    unknownHeadingEl.innerHTML = counts.unknown
      ? '<h3 class="results__group-title">Nivå ikke satt (' + counts.unknown + ")</h3>" +
        '<p class="muted">Nivå er ikke registrert for disse stedene ennå, så de kan passe eller ikke for ' + filter.level + ". Vurder selv.</p>"
      : "";
    if (windLegendEl) windLegendEl.hidden = !assessments;

    var filtered = filter.direction || filter.level || filter.category || (suggest && assessments);
    var title = filtered
      ? (counts.match === 1 ? "1 flysted passer filtrene" : counts.match + " flysteder passer filtrene")
      : counts.match + " flysteder";
    if (counts.unknown) title += ", " + counts.unknown + " uten nivå";
    titleEl.textContent = title;
    noResultsEl.hidden = counts.match + counts.unknown !== 0;
  }

  // Setter et filter og markerer riktig knapp. Ukjente verdier (f.eks. fra en gammel lenke) gir «Alle».
  function setFilter(type, value) {
    var buttons = document.querySelectorAll('button[data-filter="' + type + '"]');
    var find = function (v) { return Array.prototype.find.call(buttons, function (b) { return b.getAttribute("data-value") === v; }); };
    var match = find(value) || find("");
    value = match.getAttribute("data-value");
    filter[type] = value;
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", b === match ? "true" : "false"); });
  }

  function setWind(value) {
    var buttons = document.querySelectorAll("button[data-wind]");
    if (!buttons.length || stale) return;
    var match = Array.prototype.find.call(buttons, function (b) { return b.getAttribute("data-wind") === value; }) ||
      Array.prototype.find.call(buttons, function (b) { return b.getAttribute("data-wind") === "0"; });
    windSlot = match.getAttribute("data-wind");
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", b === match ? "true" : "false"); });
  }

  // Forslagsknappen virker bare når vind er på. Teksten følger valgt tidspunkt («nå», «om 3 t» …).
  var suggestButton = document.querySelector("button[data-suggest]");
  function setSuggest(on) {
    suggest = !!(on && suggestButton && forecast && !stale);
    if (!suggestButton) return;
    var windOn = windSlot !== "off";
    suggestButton.hidden = !forecast || stale;
    suggestButton.disabled = !windOn;
    suggestButton.setAttribute("aria-pressed", String(suggest && windOn));
    suggestButton.textContent = "Vis bare steder som kan passe" + (windSlot === "tomorrow" ? " i morgen kl. 12" : windOn ? " " + SLOT_LABELS[windSlot] : "");
    suggestButton.title = windOn ? "" : "Velg et tidspunkt for vind først";
  }

  document.getElementById("filters").addEventListener("click", function (ev) {
    var button = ev.target.closest("button[data-filter], button[data-wind], button[data-suggest]");
    if (!button) return;
    if (button.hasAttribute("data-suggest")) setSuggest(!suggest);
    else if (button.hasAttribute("data-wind")) { setWind(button.getAttribute("data-wind")); setSuggest(suggest); }
    else setFilter(button.getAttribute("data-filter"), button.getAttribute("data-value"));
    update();
    writeHash();
  });

  // --- Tilstand i adressen ---
  // Filtrene, vindtidspunktet og valgt sted lagres i adressen (#direction=NW&level=PP3&wind=3&site=sollifjellet),
  // så tilbakeknappen og delte lenker gir samme visning. replaceState, så hvert klikk ikke blir et steg i historikken.
  function writeHash() {
    var params = new URLSearchParams();
    ["direction", "level", "category"].forEach(function (type) { if (filter[type]) params.set(type, filter[type]); });
    if (forecast && !stale && windSlot !== "0") params.set("wind", windSlot);
    if (suggest && windSlot !== "off") params.set("forslag", "1");
    if (selectedId) params.set("site", selectedId);
    var hash = params.toString();
    history.replaceState(null, "", hash ? "#" + hash : location.pathname + location.search);
  }

  function readHash() {
    var params = new URLSearchParams(location.hash.slice(1));
    ["direction", "level", "category"].forEach(function (type) { setFilter(type, params.get(type) || ""); });
    setWind(params.get("wind") || "0");
    setSuggest(params.get("forslag") === "1");
    var site = params.get("site");
    selectedId = sites.some(function (s) { return s.id === site; }) ? site : null;
    if (!selectedId) {
      cardEl.innerHTML = emptyCardHtml;
      cardEl.classList.remove("selected--active");
    }
    update();
    writeHash(); // rydder bort ukjente verdier fra adressen
  }

  window.addEventListener("hashchange", readHash);

  listEl.addEventListener("click", function (ev) {
    var button = ev.target.closest("button[data-select]");
    if (button) select(button.getAttribute("data-select"), "list");
  });

  readHash();
})();
