// Forsiden: filtre, kart med vindroser, kort for valgt sted og liste.
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

  // --- Kart ---
  var mapEl = document.getElementById("home-map");
  var map = FS.createMap(mapEl);
  var bounds = [];
  sites.forEach(function (site) {
    var icon = L.divIcon({
      className: "rose-marker",
      html: '<span class="rose-marker__ring">' + FS.roseSvg(site, 24, false) + "</span>",
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    var marker = L.marker([site.lat, site.lon], { icon: icon, title: site.name, alt: site.name, keyboard: true, riseOnHover: true });
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
  function showCard(site) {
    var e = FS.escapeHtml;
    var html =
      '<div class="selected__top">' + FS.roseSvg(site, 84, true) +
      '<div class="selected__info"><h2 class="selected__name">' + e(site.name) + "</h2>" +
      '<div class="directions">' + directionBadges(site) + "</div>" +
      '<div class="tags">' + tags(site) + "</div></div></div>";
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
    showCard(site);
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

  function update() {
    var count = 0;
    sites.forEach(function (site) {
      var ok = matches(site);
      if (ok) count++;
      var marker = markers[site.id];
      var el = marker && marker.getElement();
      if (el) {
        el.classList.toggle("rose-marker--dimmed", !ok);
        el.classList.toggle("rose-marker--selected", site.id === selectedId);
      }
      if (marker) marker.setZIndexOffset(site.id === selectedId ? 1000 : ok ? 500 : 0);
      var li = listEl.querySelector('[data-id="' + site.id + '"]');
      if (li) {
        li.hidden = !ok;
        li.querySelector("button").classList.toggle("results__item--selected", site.id === selectedId);
        li.querySelector(".directions").innerHTML = directionBadges(site);
      }
    });
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

  document.getElementById("filters").addEventListener("click", function (ev) {
    var button = ev.target.closest("button[data-filter]");
    if (!button) return;
    setFilter(button.getAttribute("data-filter"), button.getAttribute("data-value"));
    update();
    writeHash();
  });

  // --- Tilstand i adressen ---
  // Filtrene og valgt sted lagres i adressen (#direction=NW&level=PP3&site=sollifjellet), så tilbakeknappen
  // og delte lenker gir samme visning. replaceState, så hvert klikk ikke blir et steg i historikken.
  function writeHash() {
    var params = new URLSearchParams();
    ["direction", "level", "category"].forEach(function (type) { if (filter[type]) params.set(type, filter[type]); });
    if (selectedId) params.set("site", selectedId);
    var hash = params.toString();
    history.replaceState(null, "", hash ? "#" + hash : location.pathname + location.search);
  }

  function readHash() {
    var params = new URLSearchParams(location.hash.slice(1));
    ["direction", "level", "category"].forEach(function (type) { setFilter(type, params.get(type) || ""); });
    var site = params.get("site");
    selectedId = null;
    if (site) select(site, "hash");
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
