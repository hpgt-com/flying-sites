// Stedssiden: kart med start, landing, parkering og gangruter, og høydeprofil.
(function () {
  "use strict";

  var FS = window.FlyingSites;
  var data = FS.readJson("site-data");
  var mapEl = document.getElementById("site-map");
  if (!data || !mapEl) return;

  var ACCENT = "#C24A12";
  // Gangruten må synes både på lyst og mørkt kart (mørk modus, se styles.css).
  function inkColor() { return FS.isDark() ? "#F3F5F4" : "#1C2B33"; }
  var INK = inkColor();
  var map = FS.createMap(mapEl, { scrollWheelZoom: false });
  var bounds = [];
  var routeLines = [];

  function squareIcon(className, text) {
    return L.divIcon({ className: "map-icon " + className, html: text || "", iconSize: [22, 22], iconAnchor: [11, 11] });
  }

  (data.routes || []).forEach(function (route) {
    var line = L.polyline(route.line, { color: INK, weight: 4, dashArray: "2 8", lineCap: "round", opacity: 0.9 }).addTo(map);
    line.bindTooltip("Gangrute" + (route.name ? " " + route.name : ""), { sticky: true });
    routeLines.push(line);
    route.line.forEach(function (p) { bounds.push(p); });
  });

  document.addEventListener("themechange", function () {
    INK = inkColor();
    routeLines.forEach(function (line) { line.setStyle({ color: INK }); });
  });

  (data.parking || []).forEach(function (p) {
    var name = p.name || "Parkering";
    L.marker([p.lat, p.lon], { icon: squareIcon("map-icon--parking", "P"), title: name, alt: name })
      .bindTooltip(name, { direction: "top", offset: [0, -10] })
      .addTo(map);
    bounds.push([p.lat, p.lon]);
  });

  // Landing som målskive, alternativ landing i grått. Utseendet ligger i styles.css (.map-symbol).
  (data.landings || []).forEach(function (landing) {
    var isAlternative = landing.primary === false;
    var name = landing.name || (isAlternative ? "Alternativ landing" : "Landing");
    var icon = L.divIcon({ className: "map-symbol map-symbol--landing" + (isAlternative ? " map-symbol--alt" : ""), iconSize: [26, 26], iconAnchor: [13, 13] });
    L.marker([landing.lat, landing.lon], { icon: icon, title: name, alt: name })
      .bindTooltip(name, { direction: "top", offset: [0, -12] })
      .addTo(map);
    bounds.push([landing.lat, landing.lon]);
  });

  // --- Starter som vindroser ---
  // Starter med egen posisjon (launches[].lat/lon) får hver sin rose med sine retninger. Hovedstarten
  // (launch) viser retningene til startene uten egen posisjon, eller alle retningene når ingen har det.
  // Har alle startene egen posisjon, tegnes ikke hovedstarten.
  // Starter som ligger så tett at rosene ville overlappet, slås sammen til én rose med alle retningene
  // og antallet starter. Zoomer man inn, eller trykker på den, deles de opp.
  var windDirections = data.wind_directions || { primary: [], possible: [] };
  function roseFor(directions) {
    return {
      primary: (windDirections.primary || []).filter(function (d) { return directions.indexOf(d) !== -1; }),
      possible: (windDirections.possible || []).filter(function (d) { return directions.indexOf(d) !== -1; }),
    };
  }
  function directionList(directions) {
    return FS.DIRECTIONS.filter(function (d) { return directions.indexOf(d) !== -1; })
      .map(function (d) { return FS.DIRECTION_LABELS[d]; }).join(", ");
  }
  function launchIcon(directions, count) {
    return L.divIcon({
      className: "map-symbol map-symbol--launch",
      html: FS.roseSvg(roseFor(directions), 30, false) + (count > 1 ? '<span class="map-symbol__count">' + count + "</span>" : ""),
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }
  var launchLayer = L.markerClusterGroup({
    maxClusterRadius: 40,
    showCoverageOnHover: false,
    spiderfyDistanceMultiplier: 1.8,
    iconCreateFunction: function (cluster) {
      var directions = [];
      cluster.getAllChildMarkers().forEach(function (m) {
        m.options.directions.forEach(function (d) { if (directions.indexOf(d) === -1) directions.push(d); });
      });
      return launchIcon(directions, cluster.getChildCount());
    },
  }).addTo(map);
  // Bare retninger stedet passer for (hovedretning eller mulig). Linjer som «ikke egnet, men mulig i
  // svak vind» skal ikke gi farge eller stå i merkelappen.
  function usable(directions) {
    var rose = roseFor(directions);
    return rose.primary.concat(rose.possible);
  }
  function addLaunch(lat, lon, directions, labelled) {
    directions = usable(directions);
    if (!directions.length) return;
    var label = "Start" + (labelled ? " " + directionList(directions) : "");
    L.marker([lat, lon], { icon: launchIcon(directions, 1), title: label, alt: label, zIndexOffset: 1000, directions: directions })
      .bindTooltip(label, { direction: "top", offset: [0, -18] })
      .addTo(launchLayer);
    bounds.push([lat, lon]);
  }
  var launches = data.launches || [];
  var placed = launches.filter(function (l) { return l.lat != null && l.lon != null; });
  if (!placed.length) {
    addLaunch(data.launch.lat, data.launch.lon, (windDirections.primary || []).concat(windDirections.possible || []), false);
  } else {
    var rest = [];
    launches.forEach(function (l) {
      if (l.lat == null) (l.directions || []).forEach(function (d) { if (rest.indexOf(d) === -1) rest.push(d); });
    });
    addLaunch(data.launch.lat, data.launch.lon, rest, true);
    placed.forEach(function (l) { addLaunch(l.lat, l.lon, l.directions || [], true); });
  }

  FS.fitWhenVisible(map, mapEl, function () {
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
    else map.setView([data.launch.lat, data.launch.lon], 14);
  });

  // --- Høydeprofil ---
  var profileEl = document.getElementById("elevation-profile");
  var routes = data.routes || [];
  if (!profileEl || !routes.some(function (r) { return r.profile; })) return;

  var svg = profileEl.querySelector(".profile__graph");
  var slider = profileEl.querySelector(".profile__slider");
  var readouts = {
    distance: profileEl.querySelector('[data-readout="distance"]'),
    elevation: profileEl.querySelector('[data-readout="elevation"]'),
    grade: profileEl.querySelector('[data-readout="grade"]'),
  };
  var summaryEl = profileEl.querySelector(".profile__summary");
  var positionMarker = L.circleMarker([0, 0], { radius: 8, color: ACCENT, weight: 4, fillColor: "#FFFFFF", fillOpacity: 1, interactive: false });

  // Marger i grafen, i piksler.
  var HEIGHT = 150, LEFT = 46, RIGHT = 12, TOP = 14, BOTTOM = 26;
  var activeRoute = 0, index = 0, scale = null;

  function roundTo(n, step) { return Math.round(n / step) * step; }

  function draw() {
    var route = routes[activeRoute];
    if (!route.profile) return;
    var p = route.profile;
    var width = Math.max(260, Math.round(svg.getBoundingClientRect().width || 350));
    svg.setAttribute("viewBox", "0 0 " + width + " " + HEIGHT);
    svg.removeAttribute("preserveAspectRatio");

    var min = Infinity, max = -Infinity;
    p.forEach(function (q) { if (q[1] < min) min = q[1]; if (q[1] > max) max = q[1]; });
    var step = max - min > 400 ? 100 : 50;
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    if (hi === lo) hi = lo + step;
    var total = p[p.length - 1][0];
    var x = function (d) { return LEFT + (d / total) * (width - LEFT - RIGHT); };
    var y = function (e) { return TOP + (1 - (e - lo) / (hi - lo)) * (HEIGHT - TOP - BOTTOM); };
    scale = { x: x, y: y, total: total, width: width };

    var line = p.map(function (q, i) { return (i ? "L" : "M") + x(q[0]).toFixed(1) + " " + y(q[1]).toFixed(1); }).join(" ");
    var area = line + " L" + x(total).toFixed(1) + " " + (HEIGHT - BOTTOM) + " L" + LEFT + " " + (HEIGHT - BOTTOM) + " Z";
    var steep = "";
    for (var i = 1; i < p.length; i++) {
      if (Math.abs((p[i][4] + p[i - 1][4]) / 2) > 25) {
        steep += "M" + x(p[i - 1][0]).toFixed(1) + " " + y(p[i - 1][1]).toFixed(1) + " L" + x(p[i][0]).toFixed(1) + " " + y(p[i][1]).toFixed(1) + " ";
      }
    }
    var mid = (lo + hi) / 2;
    var s = "";
    [hi, mid].forEach(function (v) {
      s += '<line class="profile__grid" x1="' + LEFT + '" x2="' + (width - RIGHT) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"></line>';
    });
    [lo, mid, hi].forEach(function (v) {
      s += '<text class="profile__axis" x="' + (LEFT - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + Math.round(v) + "</text>";
    });
    s += '<text class="profile__axis" x="' + LEFT + '" y="' + (HEIGHT - 8) + '">0 km</text>';
    s += '<text class="profile__axis" x="' + (width - RIGHT) + '" y="' + (HEIGHT - 8) + '" text-anchor="end">' + FS.formatNumber(total / 1000, 1) + " km</text>";
    s += '<text class="profile__axis" x="4" y="' + (TOP - 2) + '">moh</text>';
    s += '<path class="profile__area" d="' + area + '"></path>';
    s += '<path class="profile__line" d="' + line + '"></path>';
    s += '<path class="profile__steep" d="' + steep + '"></path>';
    s += '<line class="profile__cursor-line" y1="' + TOP + '" y2="' + (HEIGHT - BOTTOM) + '"></line>';
    s += '<circle class="profile__cursor" r="6"></circle>';
    svg.innerHTML = s;
    moveTo(index);
  }

  function moveTo(i) {
    var p = routes[activeRoute].profile;
    index = Math.max(0, Math.min(p.length - 1, i));
    var q = p[index];
    var cx = scale.x(q[0]).toFixed(1), cy = scale.y(q[1]).toFixed(1);
    var cursorLine = svg.querySelector(".profile__cursor-line");
    cursorLine.setAttribute("x1", cx); cursorLine.setAttribute("x2", cx);
    var cursor = svg.querySelector(".profile__cursor");
    cursor.setAttribute("cx", cx); cursor.setAttribute("cy", cy);
    slider.value = String(index);
    readouts.distance.textContent = FS.formatNumber(q[0] / 1000, 2) + " km";
    readouts.elevation.textContent = Math.round(q[1]) + " moh";
    readouts.grade.textContent = q[4] + " %";
    positionMarker.setLatLng([q[2], q[3]]);
    if (!map.hasLayer(positionMarker)) positionMarker.addTo(map);
  }

  function selectRoute(k) {
    activeRoute = k;
    index = 0;
    var route = routes[k];
    routeLines.forEach(function (l, j) { l.setStyle({ weight: j === k ? 5 : 3, opacity: j === k ? 1 : 0.55 }); });
    profileEl.querySelectorAll("[data-route]").forEach(function (b) {
      b.setAttribute("aria-selected", Number(b.getAttribute("data-route")) === k ? "true" : "false");
    });
    if (!route.profile) {
      svg.innerHTML = "";
      summaryEl.textContent = "Mangler høydedata for denne ruten.";
      return;
    }
    slider.max = String(route.profile.length - 1);
    var steepM = route.steepM >= 50 ? roundTo(route.steepM, 50) : roundTo(route.steepM, 10);
    var text = FS.formatNumber(route.lengthKm, 1) + " km fra " + Math.round(route.fromMasl) + " til " + Math.round(route.toMasl) + " moh. ";
    text += steepM > 0 ? "Ca. " + steepM + " m av turen er brattere enn 25 %. " : "Ingen partier er brattere enn 25 %. ";
    text += route.elevationSource === "Kartverket" ? "Høyder fra Kartverket." : "Høyder fra GPS i gangruten.";
    summaryEl.textContent = text;
    draw();
  }

  function fromPointer(ev) {
    var rect = svg.getBoundingClientRect();
    var px = ((ev.clientX - rect.left) / rect.width) * scale.width;
    var d = ((px - LEFT) / (scale.width - LEFT - RIGHT)) * scale.total;
    var p = routes[activeRoute].profile;
    var best = 0;
    for (var i = 1; i < p.length; i++) if (Math.abs(p[i][0] - d) < Math.abs(p[best][0] - d)) best = i;
    moveTo(best);
  }

  var dragging = false;
  svg.addEventListener("pointerdown", function (ev) { dragging = true; svg.setPointerCapture(ev.pointerId); fromPointer(ev); });
  svg.addEventListener("pointermove", function (ev) { if (dragging) fromPointer(ev); });
  svg.addEventListener("pointerup", function () { dragging = false; });
  svg.addEventListener("pointercancel", function () { dragging = false; });
  slider.addEventListener("input", function () { moveTo(Number(slider.value)); });
  profileEl.querySelectorAll("[data-route]").forEach(function (b) {
    b.addEventListener("click", function () { selectRoute(Number(b.getAttribute("data-route"))); });
  });
  var resizeTimer;
  window.addEventListener("resize", function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 100); });

  selectRoute(0);
})();
