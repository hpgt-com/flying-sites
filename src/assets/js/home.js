// Forsiden: filtre, kart med vindroser, vindvurdering fra varselet, kort for valgt sted og liste.
(function () {
  "use strict";

  var FS = window.FlyingSites;
  var sites = FS.readJson("sites-data") || [];
  var LEVELS = ["PP2", "PP3", "PP4", "PP5"];
  var filter = { direction: "", level: "", category: "", q: "" };

  // --- Søk etter navn ---
  // Små bokstaver, uten aksenter, og æ/ø/å skrevet som ae/o/a, så «saeter», «sæter» og «Sæter» finner
  // Sætertinden. Mellomrom og bindestrek teller ikke. Treff hvor som helst i navnet («solli» → Sollifjellet).
  function searchKey(s) {
    return String(s || "").toLowerCase()
      .replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[\s\-–]+/g, "");
  }
  sites.forEach(function (site) { site.searchKey = searchKey(site.name); });
  function nameMatches(site) { return !filter.q || site.searchKey.indexOf(searchKey(filter.q)) !== -1; }
  var selectedId = null;
  var markers = {};

  // "match", "unknown" eller "no". Nivåfilteret viser steder for valgt nivå og lavere (en PP3-pilot kan
  // fly PP2-steder). Steder uten registrert nivå skjules ikke, men får "unknown" og vises for seg, siden
  // de fleste stedene ikke har nivå ennå og et tomt resultat ellers ville sett ut som «ingen steder».
  // Med forslag fra varselet på («Vis bare steder som kan passe») tones steder der vurderingen er
  // «Passer ikke» eller «For mye vind» ned, som når man velger en retning. «Kan passe» og «Usikkert» blir
  // stående. Steder uten varsel (hentingen feilet for stedet) forsvinner ikke, men får "nowind" og vises
  // for seg under «Mangler varsel – ikke vurdert», så det ikke ser ut som de er vurdert.
  var suggest = false;
  function matches(site, assessment, windAssessed) {
    if (!nameMatches(site)) return "no";
    if (suggest && assessment && (assessment.rating === "no" || assessment.rating === "high")) return "no";
    if (filter.direction && site.primary.indexOf(filter.direction) === -1 && site.possible.indexOf(filter.direction) === -1) return "no";
    if (filter.category && site.categories.indexOf(filter.category) === -1) return "no";
    if (filter.level && site.level && LEVELS.indexOf(site.level) > LEVELS.indexOf(filter.level)) return "no";
    if (suggest && windAssessed && !assessment) return "nowind";
    if (filter.level && !site.level) return "unknown";
    return "match";
  }
  // Grupper som vises for seg nederst i listen og nedtonet litt i kartet.
  var WEAK = { unknown: true, nowind: true };

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
  // slås vindvurderingen av, og det står hvorfor. Alderen sjekkes på nytt før hver vurdering, når man
  // kommer tilbake til fanen og hvert minutt, så en fane som står åpen i timevis ikke viser gamle vurderinger.
  var stale = false;
  var windSlot = forecast ? "0" : "off";
  var windIndex = -1; // indeks i varselet for valgt tidspunkt, settes av assessAll()
  var SLOT_LABELS = { "0": "nå", "3": "om 3 t", "6": "om 6 t", tomorrow: "i morgen" };

  function fetchedText() {
    var fetched = Date.parse(forecast.fetched);
    var today = W.osloParts(Date.now()).date, day = W.osloParts(fetched).date;
    return (day === today ? "i dag" : day.slice(8, 10) + "." + day.slice(5, 7)) + " kl. " + W.formatClock(fetched);
  }

  // Gir true når varselet nettopp ble for gammelt, så kallet kan tegne siden på nytt.
  function checkStale() {
    if (!forecast || stale || !W.isStale(forecast, rules, Date.now())) return false;
    stale = true;
    windSlot = "off";
    suggest = false;
    var pills = document.querySelector("#filters [data-wind]");
    if (pills) pills.parentNode.hidden = true;
    if (suggestButton) suggestButton.hidden = true;
    forecastStatusEl.innerHTML = "<strong>Varselet er for gammelt.</strong> Det ble hentet " + fetchedText() +
      ". Vindvurderingen er slått av til siden er oppdatert. Last inn siden på nytt, eller sjekk Yr eller Windy.";
    return true;
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

  // --- Oppsummering ---
  // Vinden i området (vanligste retning, median middelvind, høyeste kast) og hvor mange steder som får
  // hver vurdering, med den vanligste årsaken. Forklarer hvorfor ingen steder passer en dag med mye vind.
  var summaryEl = document.getElementById("wind-summary");
  function summarize(assessments) {
    var list = Object.keys(assessments).map(function (id) { return assessments[id]; });
    if (!list.length) return null;
    var dirs = {}, speeds = [], maxGust = null;
    var counts = { ok: 0, maybe: 0, high: 0, no: 0 }, highByGust = 0, highByLocal = 0;
    list.forEach(function (a) {
      var code = W.directionCode(a.wind.dir);
      dirs[code] = (dirs[code] || 0) + 1;
      speeds.push(a.wind.speed);
      if (a.wind.gust != null && (maxGust == null || a.wind.gust > maxGust)) maxGust = a.wind.gust;
      counts[a.rating]++;
      if (a.rating === "high") {
        if (/^Kast/.test(a.reasons[0] || "")) highByGust++;
        else if (/stedet/.test(a.reasons[0] || "")) highByLocal++;
      }
    });
    speeds.sort(function (x, y) { return x - y; });
    var mainDir = Object.keys(dirs).sort(function (x, y) { return dirs[y] - dirs[x]; })[0];
    return { counts: counts, total: list.length, missing: sites.length - list.length, highByGust: highByGust, highByLocal: highByLocal,
      dir: mainDir, speed: speeds[Math.floor(speeds.length / 2)], minSpeed: speeds[0], maxSpeed: speeds[speeds.length - 1], gust: maxGust };
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function renderSummary(sum) {
    if (!summaryEl) return;
    summaryEl.hidden = !sum;
    if (!sum) { summaryEl.innerHTML = ""; return; }
    var c = sum.counts, parts = [];
    if (c.ok) parts.push(plural(c.ok, "kan passe", "kan passe"));
    if (c.maybe) parts.push(plural(c.maybe, "usikkert", "usikre"));
    if (c.high) {
      var why = [];
      if (sum.highByGust) why.push(sum.highByGust + " på grunn av kast");
      if (sum.highByLocal) why.push(sum.highByLocal + " over stedets egen grense");
      parts.push(c.high + " for mye vind" + (why.length ? " (" + why.join(", ") + ")" : ""));
    }
    if (c.no) parts.push(c.no + " feil retning");
    var wind = "Vind i området: mest " + FS.DIRECTION_LABELS[sum.dir] + ", " +
      (Math.round(sum.minSpeed) === Math.round(sum.maxSpeed) ? Math.round(sum.speed) : Math.round(sum.minSpeed) + "–" + Math.round(sum.maxSpeed)) + " m/s" +
      (sum.gust != null ? ", kast opptil " + Math.round(sum.gust) + " m/s" : "") + ".";
    var line = parts.length === 1 && sum.total > 1
      ? "Alle " + sum.total + " steder: " + parts[0].replace(/^\d+ /, "") + "."
      : plural(sum.total, "sted", "steder") + ": " + parts.join(", ") + ".";
    if (sum.missing) line += " " + plural(sum.missing, "sted", "steder") + " mangler varsel og er ikke vurdert.";
    summaryEl.innerHTML = "<p><strong>" + FS.escapeHtml(wind) + "</strong></p><p>" + FS.escapeHtml(line) + "</p>" +
      (c.ok + c.maybe === 0 ? '<p class="wind-summary__none">Ingen steder kan passe på dette tidspunktet. ' + FS.escapeHtml(noneReason(sum)) + "</p>" : "");
  }
  // Den viktigste grunnen til at ingen steder passer, i én setning.
  function noneReason(sum) {
    var c = sum.counts;
    if (c.high >= c.no) {
      return sum.highByGust > c.high / 2
        ? "Kastene er for kraftige (grensen er " + rules.maxGust + " m/s)."
        : "Det er for mye vind (grensen er " + rules.maxWind + " m/s, lavere på noen steder).";
    }
    return "Vindretningen passer ikke for startene våre.";
  }

  function windText(wind) {
    return FS.DIRECTION_LABELS[W.directionCode(wind.dir)] + " " + Math.round(wind.speed) + " m/s" +
      (wind.gust != null ? ", kast " + Math.round(wind.gust) : ", kast ukjent");
  }

  // Vurdering for alle stedene på valgt tidspunkt: { id: { wind, rating, reasons } }, eller null når vind er av
  // eller varselet ikke dekker tidspunktet. Steder uten varsel (hentingen feilet) mangler i resultatet.
  function assessAll() {
    checkStale();
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
  // match: "match", "unknown" (nivå ikke satt), "nowind" (mangler varsel) eller "no", se matches().
  function markerIcon(site, assessment, match, selected) {
    var ring = assessment ? " rose-marker__ring--" + assessment.rating : "";
    // Sektoren vinden kommer fra løftes ut i vurderingsfargen (roseSvg i common.js), i stedet for en vindpil.
    var wind = assessment ? { code: W.directionCode(assessment.wind.dir), rating: assessment.rating } : null;
    return L.divIcon({
      className: "rose-marker" + (match === "no" ? " rose-marker--dimmed" : WEAK[match] ? " rose-marker--unknown" : "") +
        (selected ? " rose-marker--selected" : ""),
      html: '<span class="rose-marker__ring' + ring + '">' + FS.roseSvg(site, 32, false, wind) + "</span>" +
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
      var group = WEAK[st.match] ? "unknown" : st.match;
      if (st.selected) selected = true;
      counts[group]++;
      if (group === "no" || !st.rating) return;
      if (!best[group] || RATINGS[st.rating].order < RATINGS[best[group]].order) best[group] = st.rating;
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

  function fitAllSites() {
    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], animate: false });
  }
  FS.fitWhenVisible(map, mapEl, fitAllSites);
  // «Vis alle flysteder» og fullskjerm under zoomknappene, som på stedssiden.
  FS.addViewControls(map, mapEl, fitAllSites, "Vis alle flysteder");

  // --- Kort for valgt sted ---
  var cardEl = document.getElementById("selected");
  var emptyCardHtml = cardEl.innerHTML;
  function showCard(site, assessment, windOn) {
    var e = FS.escapeHtml;
    var html =
      '<div class="selected__top">' + FS.roseSvg(site, 84, true, assessment ? { code: W.directionCode(assessment.wind.dir), rating: assessment.rating } : null) +
      '<div class="selected__info"><h2 class="selected__name">' + e(site.name) + "</h2>" +
      (site.elevation != null ? '<p class="selected__elev">Start ' + site.elevation + " moh</p>" : "") +
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
  var mapCountEl = document.getElementById("map-count");
  var windLegendEl = document.getElementById("wind-legend");
  var originalOrder = Array.prototype.slice.call(listEl.children);

  // Overskrifter i listen for steder uten varsel (forslag på) og uten nivå (nivåfilteret på).
  var GROUP_ORDER = { match: 0, nowind: 1, unknown: 2 };
  var headingEls = {};
  ["nowind", "unknown"].forEach(function (g) {
    var el = document.createElement("li");
    el.className = "results__group";
    el.hidden = true;
    headingEls[g] = el;
  });
  function headingHtml(g, n) {
    return g === "nowind"
      ? '<h3 class="results__group-title">Mangler varsel – ikke vurdert (' + n + ")</h3>" +
        '<p class="muted">Vindvarselet kunne ikke hentes for disse stedene, så de er ikke vurdert. Sjekk Yr eller Windy.</p>'
      : '<h3 class="results__group-title">Nivå ikke satt (' + n + ")</h3>" +
        '<p class="muted">Nivå er ikke registrert for disse stedene ennå, så de kan passe eller ikke for ' + filter.level + ". Vurder selv.</p>";
  }

  function update() {
    var assessments = assessAll();
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

    // Steder uten varsel og uten nivå kommer til slutt. Med vind på sorteres hver gruppe etter vurdering,
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
      el.innerHTML = counts[g] ? headingHtml(g, counts[g]) : "";
    });
    var placed = {};
    items.forEach(function (li) {
      var g = matchById[li.getAttribute("data-id")];
      if (headingEls[g] && !placed[g]) { listEl.appendChild(headingEls[g]); placed[g] = true; }
      listEl.appendChild(li);
    });
    if (windLegendEl) windLegendEl.hidden = !assessments;

    var filtered = filter.direction || filter.level || filter.category || filter.q || (suggest && assessments);
    var title = filtered
      ? (counts.match === 1 ? "1 flysted passer filtrene" : counts.match + " flysteder passer filtrene")
      : counts.match + " flysteder";
    if (counts.nowind) title += ", " + counts.nowind + " uten varsel";
    if (counts.unknown) title += ", " + counts.unknown + " uten nivå";
    titleEl.textContent = title;
    var shown = counts.match + counts.unknown + counts.nowind;
    if (mapCountEl) {
      mapCountEl.textContent = shown === sites.length
        ? "Viser alle " + sites.length + " flysteder"
        : "Viser " + shown + " av " + sites.length + " flysteder";
    }
    noResultsEl.hidden = counts.match + counts.unknown + counts.nowind !== 0;
    var sum = assessments ? summarize(assessments) : null;
    renderSummary(sum);
    // Tomt resultat med forslag på: si hvorfor, ikke bare at ingen passer.
    noResultsEl.textContent = suggest && sum && sum.counts.ok + sum.counts.maybe === 0
      ? "Ingen flysteder kan passe på dette tidspunktet. " + noneReason(sum) + " Slå av «Vis bare steder som kan passe» for å se alle."
      : filter.q && !sites.some(nameMatches)
        ? "Ingen flysteder heter noe med «" + filter.q.trim() + "»."
        : "Ingen flysteder passer filtrene.";
    renderSearchHits();
    updateFiltersToggle();
  }

  // Knappen for nivå og kategori på mobil: viser hvor mange som er valgt, og åpner/lukker dem.
  // Kompasset for retning står alltid synlig.
  var filtersToggle = document.getElementById("filters-toggle");
  var filtersMore = document.getElementById("filters-more");
  function updateFiltersToggle() {
    if (!filtersToggle) return;
    var n = ["level", "category"].filter(function (t) { return filter[t]; }).length;
    filtersToggle.innerHTML = "Nivå og kategori" + (n ? ' <span class="filters-toggle__count">' + n + " valgt</span>" : "");
  }
  if (filtersToggle) {
    filtersToggle.addEventListener("click", function () {
      var open = filtersToggle.getAttribute("aria-expanded") !== "true";
      filtersToggle.setAttribute("aria-expanded", String(open));
      filtersMore.classList.toggle("is-open", open);
    });
  }

  // Søkefeltet filtrerer mens man skriver, sammen med de andre filtrene. Kartet zoomer til treffene
  // (litt forsinket, så det ikke hopper for hver bokstav). Enter med ett treff velger stedet, Esc tømmer.
  var searchEl = document.getElementById("site-search");
  var searchHitsEl = document.getElementById("search-hits");
  var searchTimer = null;
  var MAX_HITS = 6;
  // Opptil MAX_HITS treff som knapper under feltet. Flere treff: bare antallet, de står i listen.
  function renderSearchHits() {
    if (!searchHitsEl) return;
    var hits = filter.q.trim() ? visibleMatches() : [];
    searchHitsEl.hidden = !filter.q.trim();
    if (!hits.length) { searchHitsEl.innerHTML = filter.q.trim() ? '<p class="muted">Ingen treff.</p>' : ""; return; }
    searchHitsEl.innerHTML = hits.length > MAX_HITS
      ? '<p class="muted">' + hits.length + " treff, se listen under kartet.</p>"
      : hits.map(function (s) {
          return '<button type="button" class="pill" data-select="' + FS.escapeHtml(s.id) + '">' + FS.escapeHtml(s.name) + "</button>";
        }).join("");
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
        if (hits.length === 1) { clearTimeout(searchTimer); select(hits[0].id, "list"); }
      }
    });
  }
  if (searchHitsEl) {
    searchHitsEl.addEventListener("click", function (ev) {
      var button = ev.target.closest("button[data-select]");
      if (button) { clearTimeout(searchTimer); select(button.getAttribute("data-select"), "list"); }
    });
  }

  // Setter et filter og markerer riktig knapp. Ukjente verdier (f.eks. fra en gammel lenke) gir «Alle».
  function setFilter(type, value) {
    var buttons = document.querySelectorAll('button[data-filter="' + type + '"]');
    var find = function (v) { return Array.prototype.find.call(buttons, function (b) { return b.getAttribute("data-value") === v; }); };
    var match = find(value) || find("");
    value = match.getAttribute("data-value");
    filter[type] = value;
    // Alle knapper med samme verdi markeres, i tilfelle samme filter finnes flere steder på siden.
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-value") === value ? "true" : "false"); });
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
    suggestButton.textContent = "Bare steder som kan passe" + (windSlot === "tomorrow" ? " i morgen kl. 12" : windOn ? " " + SLOT_LABELS[windSlot] : "");
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
  // Filtrene, søket, vindtidspunktet og valgt sted lagres i adressen (#direction=NW&level=PP3&wind=3&q=solli&site=sollifjellet),
  // så tilbakeknappen og delte lenker gir samme visning. replaceState, så hvert klikk ikke blir et steg i historikken.
  function writeHash() {
    var params = new URLSearchParams();
    ["direction", "level", "category"].forEach(function (type) { if (filter[type]) params.set(type, filter[type]); });
    if (forecast && !stale && windSlot !== "0") params.set("wind", windSlot);
    if (suggest && windSlot !== "off") params.set("forslag", "1");
    if (filter.q.trim()) params.set("q", filter.q.trim());
    if (selectedId) params.set("site", selectedId);
    var hash = params.toString();
    history.replaceState(null, "", hash ? "#" + hash : location.pathname + location.search);
  }

  function readHash() {
    var params = new URLSearchParams(location.hash.slice(1));
    ["direction", "level", "category"].forEach(function (type) { setFilter(type, params.get(type) || ""); });
    setWind(params.get("wind") || "0");
    setSuggest(params.get("forslag") === "1");
    setSearch(params.get("q") || "");
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

  // Kommer man tilbake til en fane som har stått åpen, og hvert minutt: tegn på nytt når varselet er
  // blitt for gammelt, eller når valgt tidspunkt peker på en annen time i varselet (timeskifte for
  // «nå», «om 3 t» og «om 6 t», midnatt for «i morgen»).
  function recheck() {
    if (checkStale()) { update(); writeHash(); return; }
    if (forecast && !stale && windSlot !== "off" && W.slotIndex(forecast.times, windSlot, Date.now()) !== windIndex) update();
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) recheck(); });
  setInterval(recheck, 60 * 1000);

  readHash();
})();
