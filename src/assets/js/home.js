// Forsiden: filtre, kart med vindroser, vindvurdering fra varselet, kort for valgt sted og liste.
(function () {
  "use strict";

  var FS = window.FlyingSites;
  var sites = FS.readJson("sites-data") || [];
  var LEVELS = ["PP2", "PP3", "PP4", "PP5"];
  var filter = { direction: "", level: "", category: "" };
  var selectedId = null;
  var markers = {};

  // Nivåfilteret viser steder for valgt nivå og lavere (en PP3-pilot kan fly PP2-steder).
  function matches(site) {
    if (filter.direction && site.primary.indexOf(filter.direction) === -1 && site.possible.indexOf(filter.direction) === -1) return false;
    if (filter.level && (!site.level || LEVELS.indexOf(site.level) > LEVELS.indexOf(filter.level))) return false;
    if (filter.category && site.categories.indexOf(filter.category) === -1) return false;
    return true;
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
  // Grov vurdering per start og tidspunkt: retning mot stedets retninger, middelvind og kast.
  // Reglene ligger i src/_data/windRules.json. Siden sier aldri «OK å fly».
  var fc = FS.readJson("forecast-data") || {};
  var forecast = fc.forecast || null;
  var rules = fc.rules || { maxWind: 7, maxGustSpread: 4 };
  var windSlot = forecast ? "0" : "off";
  var RATINGS = {
    ok: { label: "Kan passe", order: 0 },
    maybe: { label: "Usikkert", order: 1 },
    high: { label: "For mye vind", order: 2 },
    no: { label: "Passer ikke", order: 3 },
  };
  var SLOT_LABELS = { "0": "nå", "3": "om 3 t", "6": "om 6 t", tomorrow: "i morgen kl. 12" };

  // Indeks i varselet for valgt tidspunkt, ut fra klokka hos den som ser på siden.
  function slotIndex() {
    if (!forecast || windSlot === "off") return -1;
    var times = forecast.times.map(Date.parse);
    if (windSlot === "tomorrow") {
      var t = new Date();
      t.setDate(t.getDate() + 1);
      t.setHours(12, 0, 0, 0);
      var best = -1, bestDiff = Infinity;
      times.forEach(function (x, i) { var d = Math.abs(x - t.getTime()); if (d < bestDiff) { bestDiff = d; best = i; } });
      return bestDiff <= 3600000 ? best : -1;
    }
    var now = Date.now(), current = 0;
    times.forEach(function (x, i) { if (x <= now) current = i; });
    var index = current + Number(windSlot);
    return index < times.length ? index : -1;
  }

  function windAt(site, index) {
    var series = forecast && forecast.sites[site.id];
    return series && index >= 0 ? { dir: series[index][0], speed: series[index][1], gust: series[index][2] } : null;
  }

  function directionCode(degrees) {
    return FS.DIRECTIONS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
  }

  function rateWind(site, wind) {
    if (wind.speed > rules.maxWind) return "high";
    var type = FS.directionType(site, directionCode(wind.dir));
    if (type === "primary") return wind.gust != null && wind.gust - wind.speed > rules.maxGustSpread ? "maybe" : "ok";
    return type === "possible" ? "maybe" : "no";
  }

  function windText(wind) {
    return FS.DIRECTION_LABELS[directionCode(wind.dir)] + " " + Math.round(wind.speed) + " m/s" +
      (wind.gust != null ? ", kast " + Math.round(wind.gust) : "");
  }

  // Vurdering for alle stedene på valgt tidspunkt: { id: { wind, rating } }, eller null når vind er av.
  function assessAll() {
    var index = slotIndex();
    if (index < 0) return null;
    var result = {};
    sites.forEach(function (site) {
      var wind = windAt(site, index);
      if (wind) result[site.id] = { wind: wind, rating: rateWind(site, wind) };
    });
    return result;
  }

  // --- Kart ---
  var mapEl = document.getElementById("home-map");
  var map = FS.createMap(mapEl);
  FS.addAirspaceLayers(map, mapEl.getAttribute("data-airspace-url"));
  var bounds = [];

  // Pilen står på siden vinden kommer fra og peker inn mot starten, som vinden som blåser inn i rosen.
  function markerIcon(site, assessment) {
    var ring = assessment ? " rose-marker__ring--" + assessment.rating : "";
    var arrow = assessment ? '<span class="wind-arrow" style="transform: rotate(' + assessment.wind.dir + 'deg)"></span>' : "";
    return L.divIcon({
      className: "rose-marker",
      html: '<span class="rose-marker__ring' + ring + '">' + FS.roseSvg(site, 24, false) + arrow + "</span>",
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  }

  sites.forEach(function (site) {
    var marker = L.marker([site.lat, site.lon], { icon: markerIcon(site, null), title: site.name, alt: site.name, keyboard: true, riseOnHover: true });
    marker.bindTooltip(site.name, { direction: "top", offset: [0, -14] });
    marker.on("click", function () { select(site.id, "map"); });
    marker.addTo(map);
    markers[site.id] = marker;
    bounds.push([site.lat, site.lon]);
  });
  FS.fitWhenVisible(map, mapEl, function () {
    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
  });

  // --- Kort for valgt sted ---
  var cardEl = document.getElementById("selected");
  var emptyCardHtml = cardEl.innerHTML;
  function showCard(site, assessment) {
    var e = FS.escapeHtml;
    var html =
      '<div class="selected__top">' + FS.roseSvg(site, 84, true) +
      '<div class="selected__info"><h2 class="selected__name">' + e(site.name) + "</h2>" +
      '<div class="directions">' + directionBadges(site) + "</div>" +
      '<div class="tags">' + tags(site) + "</div></div></div>";
    if (assessment) {
      html += '<p class="selected__wind"><span class="wind-dot wind-dot--' + assessment.rating + '"></span>' +
        "Vind " + SLOT_LABELS[windSlot] + ": " + windText(assessment.wind) + ". <strong>" + RATINGS[assessment.rating].label + "</strong></p>";
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
      map.panTo([site.lat, site.lon]);
      if (window.matchMedia("(max-width: 1099px)").matches) cardEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // --- Filtre og liste ---
  var listEl = document.getElementById("results-list");
  var titleEl = document.getElementById("results-title");
  var noResultsEl = document.getElementById("no-results");
  var windLegendEl = document.getElementById("wind-legend");
  var originalOrder = Array.prototype.slice.call(listEl.children);

  function update() {
    var assessments = assessAll();
    var count = 0;
    sites.forEach(function (site) {
      var ok = matches(site);
      if (ok) count++;
      var assessment = assessments && assessments[site.id];
      var marker = markers[site.id];
      if (marker) {
        marker.setIcon(markerIcon(site, assessment));
        var el = marker.getElement();
        if (el) {
          el.classList.toggle("rose-marker--dimmed", !ok);
          el.classList.toggle("rose-marker--selected", site.id === selectedId);
        }
        var order = assessment ? 3 - RATINGS[assessment.rating].order : 0;
        marker.setZIndexOffset(site.id === selectedId ? 1000 : (ok ? 500 : 0) + order * 10);
      }
      var li = listEl.querySelector('[data-id="' + site.id + '"]');
      if (li) {
        li.hidden = !ok;
        var button = li.querySelector("button");
        button.classList.toggle("results__item--selected", site.id === selectedId);
        li.querySelector(".directions").innerHTML = directionBadges(site);
        var windEl = button.querySelector(".results__wind");
        if (!windEl) {
          windEl = document.createElement("span");
          windEl.className = "results__wind";
          button.appendChild(windEl);
        }
        windEl.hidden = !assessment;
        windEl.innerHTML = assessment
          ? '<span class="wind-dot wind-dot--' + assessment.rating + '"></span>' + windText(assessment.wind) + " · " + RATINGS[assessment.rating].label
          : "";
      }
      if (site.id === selectedId) showCard(site, assessment);
    });

    // Med vind på sorteres listen etter vurdering, ellers alfabetisk som fra bygget.
    var items = originalOrder.slice();
    if (assessments) {
      items.sort(function (a, b) {
        var ra = assessments[a.getAttribute("data-id")], rb = assessments[b.getAttribute("data-id")];
        return (ra ? RATINGS[ra.rating].order : 9) - (rb ? RATINGS[rb.rating].order : 9) || originalOrder.indexOf(a) - originalOrder.indexOf(b);
      });
    }
    items.forEach(function (li) { listEl.appendChild(li); });
    if (windLegendEl) windLegendEl.hidden = !assessments;

    var filtered = filter.direction || filter.level || filter.category;
    titleEl.textContent = (count === 1 ? "1 flysted" : count + " flysteder") + (filtered ? " passer" : "");
    noResultsEl.hidden = count !== 0;
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
    if (!buttons.length) return;
    var match = Array.prototype.find.call(buttons, function (b) { return b.getAttribute("data-wind") === value; }) ||
      Array.prototype.find.call(buttons, function (b) { return b.getAttribute("data-wind") === "0"; });
    windSlot = match.getAttribute("data-wind");
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", b === match ? "true" : "false"); });
  }

  document.getElementById("filters").addEventListener("click", function (ev) {
    var button = ev.target.closest("button[data-filter], button[data-wind]");
    if (!button) return;
    if (button.hasAttribute("data-wind")) setWind(button.getAttribute("data-wind"));
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
    if (forecast && windSlot !== "0") params.set("wind", windSlot);
    if (selectedId) params.set("site", selectedId);
    var hash = params.toString();
    history.replaceState(null, "", hash ? "#" + hash : location.pathname + location.search);
  }

  function readHash() {
    var params = new URLSearchParams(location.hash.slice(1));
    ["direction", "level", "category"].forEach(function (type) { setFilter(type, params.get(type) || ""); });
    setWind(params.get("wind") || "0");
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
