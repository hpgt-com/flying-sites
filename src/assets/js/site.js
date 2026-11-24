// Stedssiden: kart med start, landing, parkering og gangruter, og høydeprofil.
(function () {
  "use strict";

  var FS = window.FlyingSites;

  // På mobil starter punktene i kartet, startene etter retning, bildene og lenkene foldet, så siden blir
  // kortere. De er åpne i HTML-en, så desktop og sider uten JavaScript viser alt.
  if (window.matchMedia("(max-width: 1023px)").matches) {
    document.querySelectorAll("details[data-fold-mobile]").forEach(function (d) { d.open = false; });
  }
  // En lenke til en del som er foldet (fra lenkeraden eller en adresse med #), åpner den, så innholdet vises.
  function openTarget(id) {
    var el = id && document.getElementById(id);
    var fold = el && el.closest("details");
    if (fold && !fold.open) fold.open = true;
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (a) openTarget(decodeURIComponent(a.getAttribute("href").slice(1)));
  });
  openTarget(decodeURIComponent(location.hash.slice(1)));

  // Lenkeraden til delene av siden: delen som er synlig, markeres, og raden ruller så lenken synes.
  // Delen regnes som synlig når overskriften har passert under raden.
  var nav = document.querySelector(".section-nav");
  if (nav) {
    var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));
    var targets = links.map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); });
    var current = null, queued = false;
    var mark = function () {
      queued = false;
      // Delen med overskriften nærmest over linjen. Ikke bare den siste i lista: på desktop går høyre
      // kolonne («Før du starter», Bilder, Lenker) ved siden av den venstre, så rekkefølgen på skjermen er ikke listas.
      var line = nav.getBoundingClientRect().bottom + 24, on = -1, best = -Infinity;
      targets.forEach(function (el, i) {
        var top = el ? el.getBoundingClientRect().top : Infinity;
        if (top <= line && top > best) { best = top; on = i; }
      });
      // Nederst på siden kan de siste delene være for korte til å nå linjen. Da gjelder den laveste overskriften.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        best = -Infinity;
        targets.forEach(function (el, i) {
          var top = el ? el.getBoundingClientRect().top : Infinity;
          if (top < window.innerHeight && top > best) { best = top; on = i; }
        });
      }
      if (on === current) return;
      current = on;
      links.forEach(function (a, i) {
        if (i === on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
      });
      var link = links[on];
      if (link) nav.scrollTo({ left: link.offsetLeft - nav.clientWidth / 2 + link.offsetWidth / 2, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    };
    window.addEventListener("scroll", function () { if (!queued) { queued = true; requestAnimationFrame(mark); } }, { passive: true });
    mark();
  }

  var data = FS.readJson("site-data");

  // Sol på hver start i dag (wind.js sunOnLaunchText), ut fra retningene starten tar vind fra, som en linje under
  // teksten om starten. Regnes ut her, så siden ikke blir utdatert mellom byggene. Merknaden under lista sier
  // at tidene ikke tar hensyn til skygge fra terrenget.
  var W = window.FlyingSitesWind;
  var launchList = document.querySelector(".launch-list");
  if (W && data && data.launch && launchList) {
    var today = W.osloParts(Date.now()).date;
    launchList.querySelectorAll("li[data-dirs]").forEach(function (li) {
      var dirs = (li.getAttribute("data-dirs") || "").split(" ").filter(Boolean);
      var texts = li.querySelector(".launch-list__texts");
      if (!dirs.length || !texts) return;
      var line = document.createElement("span");
      line.className = "launch-list__sun";
      line.textContent = W.sunOnLaunchText(today, data.launch.lat, data.launch.lon, dirs);
      texts.append(line);
    });
    var note = launchList.parentElement.querySelector(".launch-list__note");
    if (note && launchList.querySelector(".launch-list__sun")) note.hidden = false;
  }
  // «Målt nå» (værstasjonen, stations.js) kommer etter «Vinden nå – kan det passe?» i HTML-en, som er mobilrekkefølgen.
  // På desktop flyttes den øverst i høyre kolonne, under «Før du starter», der grafen får fornuftig størrelse og
  // venstre kolonne ikke må vente på den.
  var stationBlock = document.getElementById("station-now");
  var asideEl = document.querySelector(".site-page__aside");
  if (stationBlock && asideEl) {
    var stationHome = stationBlock.nextElementSibling;
    var desktop = window.matchMedia("(min-width: 1100px)");
    var placeStation = function () {
      if (desktop.matches) asideEl.insertBefore(stationBlock, asideEl.firstChild);
      else stationHome.parentNode.insertBefore(stationBlock, stationHome);
    };
    placeStation();
    desktop.addEventListener("change", placeStation);
  }

  var mapEl = document.getElementById("site-map");
  if (!data || !mapEl) return;

  // Kartet og høydeprofilen settes opp når de nærmer seg skjermen, ikke når siden lastes. På mobil
  // ligger de lenger ned, og å sette opp kartet (og hente flisene) koster tid og data som kanskje ikke trengs.
  // Luftromsvarselet: siden kan være bygd før sjekken ble gammel, så nettleseren sjekker igjen.
  document.querySelectorAll("[data-airspace-checked]").forEach(function (el) {
    var checked = Date.parse(el.getAttribute("data-airspace-checked") + "T00:00:00Z");
    var limit = Number(el.getAttribute("data-stale-days")) || 45;
    if (!checked || (Date.now() - checked) / 86400000 > limit) el.hidden = false;
  });

  var started = false;
  function start() {
    if (started) return;
    started = true;
    setup();
  }
  var watched = [mapEl, document.getElementById("elevation-profile")].filter(Boolean);
  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      if (!entries.some(function (e) { return e.isIntersecting; })) return;
      observer.disconnect();
      start();
    }, { rootMargin: "600px 0px" });
    watched.forEach(function (el) { observer.observe(el); });
  } else {
    start();
  }

  function setup() {
    var ACCENT = "#C24A12";
    // Gangruten må synes på både lyse og mørke kart (mørk modus, se styles.css).
    function inkColor() { return FS.isDark() ? "#F3F5F4" : "#1C2B33"; }
    var INK = inkColor();
    // Musehjulet zoomer bare med Ctrl/Cmd (FS.wheelNeedsCtrl under).
    var map = FS.createMap(mapEl, { scrollWheelZoom: true });
    var bounds = [];
    var routeLines = [];

    function squareIcon(className, text) {
      return FS.divIcon({ className: "map-icon " + className, content: text ? function () { return document.createTextNode(text); } : null, iconSize: [22, 22], iconAnchor: [11, 11] });
    }
    // Innholdet i en popup: tittelen i fet skrift, og teksten på neste linje.
    function popupContent(title, text) {
      return function () { return FS.frag(FS.h("strong", null, title), text ? [FS.h("br"), text] : null); };
    }

    (data.routes || []).forEach(function (route) {
      var line = L.polyline(route.line, { color: INK, weight: 4, dashArray: "2 8", lineCap: "round", opacity: 0.9 }).addTo(map);
      line.bindTooltip(document.createTextNode(FS.t("site.route") + (route.name ? " " + route.name : "")), { sticky: true });
      routeLines.push(line);
      route.line.forEach(function (p) { bounds.push(p); });
    });

    document.addEventListener("themechange", function () {
      INK = inkColor();
      routeLines.forEach(function (line) { line.setStyle({ color: INK }); });
    });

    // --- Punkter: starter, landing, parkering og nummererte punkter ---
    // Alle ligger i ett lag. Punkter som ville overlappet, slås sammen til én boks med de samme symbolene
    // i liten størrelse (prikk med antall starter, blink, P, nummer), så kartet ikke blir et virvar av
    // overlappende symboler. Et trykk på boksen zoomer inn til de skilles. Fra CLUSTER_OFF_ZOOM vises alt
    // hver for seg, også punkter på nøyaktig samme sted (som et nummer på en start:
    // nummeret plasseres da over prikken). Typen symbol står i options.kind.
    var CLUSTER_OFF_ZOOM = 16;
    var POINT_ORDER = { launch: 0, landing: 1, parking: 2, pin: 3 };
    function comboIcon(cluster) {
      var children = cluster.getAllChildMarkers();
      var launches = children.filter(function (m) { return m.options.kind === "launch"; }).length;
      if (launches === children.length) return launchIcon(launches);
      children.sort(function (a, b) {
        return POINT_ORDER[a.options.kind] - POINT_ORDER[b.options.kind] || (a.options.n || 0) - (b.options.n || 0);
      });
      var parts = [], names = [], launchDone = false;
      children.forEach(function (m) {
        var o = m.options;
        if (o.kind === "launch") {
          if (launchDone) return;
          launchDone = true;
          parts.push(["map-combo__launch", launches > 1 ? launches : ""]);
          names.push(launches > 1 ? FS.t("site.launchN", { n: launches }) : FS.t("site.launch"));
          return;
        }
        if (o.kind === "landing") parts.push(["map-symbol map-symbol--landing" + (o.alternative ? " map-symbol--alt" : ""), ""]);
        else if (o.kind === "parking") parts.push(["map-icon map-icon--parking", "P"]);
        else parts.push(["drawing-pin" + (o.hazard ? " drawing-pin--hazard" : ""), o.n]);
        names.push(o.title);
      });
      var title = FS.t("site.zoomIn", { names: names.join(", ") });
      // parts: [class, text] per symbol.
      return FS.divIcon({
        className: "map-combo-anchor",
        content: function () {
          return FS.h("span", { class: "map-combo", title: title }, parts.map(function (part) { return FS.h("span", { class: part[0] }, part[1]); }));
        },
        iconSize: [0, 0],
      });
    }
    var pointLayer = L.markerClusterGroup({
      // Boksene er bredere enn prikkene, så når man zoomer langt ut, slås flere sammen.
      maxClusterRadius: function (zoom) { return zoom <= 13 ? 80 : 32; },
      disableClusteringAtZoom: CLUSTER_OFF_ZOOM,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: false,
      spiderfyOnMaxZoom: false,
      iconCreateFunction: comboIcon,
    }).addTo(map);
    // Et trykk på boksen zoomer ett steg inn når punktene da skilles, ellers rett til CLUSTER_OFF_ZOOM
    // (punkter nesten på samme sted), så det trengs få trykk og kartet ikke zoomer for tett inn.
    pointLayer.on("clusterclick", function (ev) {
      var b = ev.layer.getBounds(), next = map.getZoom() + 1;
      var spread = map.project(b.getNorthWest(), next).distanceTo(map.project(b.getSouthEast(), next));
      map.setView(b.getCenter(), spread >= 34 ? next : Math.max(next, CLUSTER_OFF_ZOOM));
    });

    (data.parking || []).forEach(function (p) {
      var name = p.name || FS.t("site.parking");
      L.marker([p.lat, p.lon], { icon: squareIcon("map-icon--parking", "P"), title: name, alt: name, kind: "parking" })
        .bindTooltip(document.createTextNode(name), { direction: "top", offset: [0, -10] })
        .addTo(pointLayer);
      bounds.push([p.lat, p.lon]);
    });

    // Landing som blink, alternativ landing i grått. Utseendet står i styles.css (.map-symbol).
    (data.landings || []).forEach(function (landing) {
      var isAlternative = landing.primary === false;
      var name = landing.name || (isAlternative ? FS.t("site.altLanding") : FS.t("site.landing"));
      var icon = FS.divIcon({ className: "map-symbol map-symbol--landing" + (isAlternative ? " map-symbol--alt" : ""), iconSize: [26, 26], iconAnchor: [13, 13] });
      L.marker([landing.lat, landing.lon], { icon: icon, title: name, alt: name, kind: "landing", alternative: isAlternative })
        .bindTooltip(document.createTextNode(name), { direction: "top", offset: [0, -12] })
        .addTo(pointLayer);
      bounds.push([landing.lat, landing.lon]);
    });

    // --- Starter som blå prikker ---
    // Retningene vises med de gule buene, så startene er bare prikker, som er lettere å se.
    // Hvilke starter som tegnes, bestemmes av launchPoints() i common.js. Starter så nær hverandre at
    // prikkene ville overlappet, slås sammen til én prikk med antallet (eller en boks med de andre
    // punktene, se over). Zoomer man inn, eller trykker på den, deles de. Retningene står i
    // etiketten ved hover eller trykk.
    function launchIcon(count) {
      return FS.divIcon({
        className: "map-symbol map-symbol--launch-dot",
        content: count > 1 ? function () { return FS.h("span", { class: "map-symbol__count" }, count); } : null,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
    }
    FS.launchPoints(data).forEach(function (p) {
      L.marker([p.lat, p.lon], { icon: launchIcon(1), title: p.label, alt: p.label, zIndexOffset: 1000, kind: "launch" })
        .bindTooltip(document.createTextNode(p.label), { direction: "top", offset: [0, -10] })
        .addTo(pointLayer);
      bounds.push([p.lat, p.lon]);
    });

    // --- Retningsbuer ---
    // Hvilke sider av fjellet stedet passer for, sett ovenfra: gule buer med pil og retning, som de gule
    // strekene på de tegnede oversiktsbildene. Regnes ut fra stedsfilen (directionArcs i common.js).
    // Under rosene, så startene kan trykkes på.
    var arcPane = map.createPane("arcs");
    arcPane.style.zIndex = 450;
    arcPane.style.pointerEvents = "none";
    var ll = function (p) { return [p[1], p[0]]; };
    // Buen holdes minst ARC_MIN_PX på skjermen, og pil og retningsetikett regnes i piksler, så den
    // er lesbar når man zoomer litt ut. Lenger ut enn ARC_MIN_ZOOM (ca. 28 m per piksel, hele
    // fjellet noen få piksler) ville buene dekke kilometer rundt en prikk, så de tegnes ikke i det hele tatt.
    // Tegnes på nytt når zoomen endres.
    var ARC_MIN_PX = 60;
    var ARC_MIN_ZOOM = 11;
    var arcLayer = L.layerGroup().addTo(map);
    function metersPerPixel() { return 40075016 * Math.cos(data.launch.lat * Math.PI / 180) / (256 * Math.pow(2, map.getZoom())); }
    function drawArcs() {
      arcLayer.clearLayers();
      if (map.getZoom() < ARC_MIN_ZOOM) return;
      var mpp = metersPerPixel();
      FS.directionArcs(data, { minRadius: ARC_MIN_PX * mpp, arrow: 26 * mpp }).forEach(function (arc) {
        var line = arc.pts.map(ll), stem = [arc.mid, FS.offset(arc.center, arc.bearing, arc.radius + 16 * mpp)].map(ll);
        var head = FS.arrowHead(arc.tip, arc.bearing, 12 * mpp).map(ll);
        var opts = { pane: "arcs", interactive: false, lineCap: "round", lineJoin: "round" };
        L.polyline(line, Object.assign({ color: "#1C2B33", weight: 9 }, opts)).addTo(arcLayer);
        L.polyline(stem, Object.assign({ color: "#1C2B33", weight: 6 }, opts)).addTo(arcLayer);
        L.polyline(line, Object.assign({ color: arc.color, weight: 5.5 }, opts)).addTo(arcLayer);
        L.polyline(stem, Object.assign({ color: arc.color, weight: 3 }, opts)).addTo(arcLayer);
        L.polygon(head, Object.assign({ color: "#1C2B33", weight: 1.5, fillColor: arc.color, fillOpacity: 1 }, opts)).addTo(arcLayer);
        L.marker(ll(FS.offset(arc.center, arc.bearing, arc.radius + 40 * mpp)), {
          icon: FS.divIcon({ className: "arc-label-anchor", content: function () { return FS.h("span", { class: "arc-label" }, arc.label); }, iconSize: [0, 0] }),
          interactive: false, keyboard: false, pane: "arcs",
        }).addTo(arcLayer);
      });
    }
    map.on("zoomend", drawArcs);
    // Kartet må også få plass til buene når det zoomer til innholdet.
    FS.directionArcs(data).forEach(function (arc) { arc.pts.forEach(function (p) { bounds.push(ll(p)); }); });

    // --- Tegningen (<id>-drawing.geojson) ---
    // Linjer og flater (flyrute, startkant, fare) under punktene. Farger som i lib/drawing.js.
    var STYLE_COLORS = { flight: ACCENT, hazard: "#B7791F", info: "#2E5E6E", launch: "#F2B705", landing: "#1C2B33" };
    var features = (data.drawing && data.drawing.features) || [];
    features.forEach(function (f) {
      var p = f.properties || {};
      var color = STYLE_COLORS[p.style] || (p.kind === "area" ? STYLE_COLORS.hazard : STYLE_COLORS.flight);
      var layer = null;
      if (p.kind === "path") {
        var line = f.geometry.coordinates.map(ll);
        L.polyline(line, { pane: "arcs", color: "#1C2B33", weight: 7, opacity: 0.8, interactive: false }).addTo(map);
        layer = L.polyline(line, { color: color, weight: 4, dashArray: p.dashed ? "8 7" : null, lineCap: "round" }).addTo(map);
        if (p.arrow && line.length > 1) {
          var c = f.geometry.coordinates, a = c[c.length - 2], b = c[c.length - 1];
          var bearing = Math.atan2((b[0] - a[0]) * Math.cos(b[1] * Math.PI / 180), b[1] - a[1]) * 180 / Math.PI;
          L.polygon(FS.arrowHead(b, bearing, 40).map(ll), { color: "#1C2B33", weight: 1.5, fillColor: color, fillOpacity: 1, interactive: false }).addTo(map);
        }
      } else if (p.kind === "area") {
        layer = L.polygon(f.geometry.coordinates[0].map(ll), { color: color, weight: 2.5, fillColor: color, fillOpacity: 0.2 }).addTo(map);
      }
      if (layer && p.title) layer.bindPopup(popupContent(p.title, p.text));
    });

    // Nummererte punkter, med de samme numrene som lista under kartet. Et trykk på et punkt viser teksten og
    // markerer det i lista. Et trykk i lista flytter kartet dit og viser teksten. En fare er en lys rute med rød kant.
    var labels = features.filter(function (f) { return f.properties && f.properties.kind === "label" && f.properties.title; });
    var pinMarkers = labels.map(function (f, i) {
      var p = f.properties, n = i + 1, hazard = p.style === "hazard";
      return L.marker(ll(f.geometry.coordinates), {
        icon: FS.divIcon({ className: "drawing-pin" + (hazard ? " drawing-pin--hazard" : ""), content: function () { return document.createTextNode(String(n)); }, iconSize: [26, 26], iconAnchor: [13, 36] }),
        title: n + ". " + p.title, alt: n + ". " + p.title, zIndexOffset: 1100, kind: "pin", n: n, hazard: hazard,
      }).bindPopup(popupContent(n + ". " + p.title, p.text), { offset: [0, -24] })
        .on("click", function () { selectPoint(n); })
        .addTo(pointLayer);
    });
    function selectPoint(n) {
      document.querySelectorAll(".drawing-list li").forEach(function (li) { li.classList.toggle("is-selected", li.getAttribute("data-n") === String(n)); });
    }
    document.querySelectorAll(".drawing-list button[data-n]").forEach(function (button) {
      button.addEventListener("click", function () {
        var n = Number(button.getAttribute("data-n")), m = pinMarkers[n - 1];
        if (!m) return;
        selectPoint(n);
        mapEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
        // Ligger punktet i en boks, zoomes det inn til det vises alene.
        map.setView(m.getLatLng(), Math.max(map.getZoom(), 15), { animate: false });
        if (pointLayer.getVisibleParent(m) !== m) map.setView(m.getLatLng(), CLUSTER_OFF_ZOOM, { animate: false });
        m.openPopup();
      });
    });

    // Musehjulet ruller siden, og zoomer kartet bare med Ctrl/Cmd (common.js).
    FS.wheelNeedsCtrl(map);

    // Zoomer så hele stedet vises: starter, landing, parkering, gangruter og retningsbuer.
    function fitAll() {
      if (bounds.length > 1) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15, animate: false });
      else map.setView([data.launch.lat, data.launch.lon], 14, { animate: false });
      // Buene holdes minst ARC_MIN_PX og kan da bli større enn innholdet. Får de ikke plass,
      // zoomes det ut til de får det, med plass til retningsetikettene (høyst to ganger).
      for (var i = 0; i < 3; i++) {
        drawArcs();
        if (!arcLayer.getLayers().length) break;
        var arcBounds = L.latLngBounds([]);
        arcLayer.eachLayer(function (layer) { arcBounds.extend(layer.getBounds ? layer.getBounds() : layer.getLatLng()); });
        // Retningsetikettene sitter utenfor buen, og zoomknappene dekker venstre hjørne, så det trengs mer plass.
        var inner = L.latLngBounds(map.containerPointToLatLng([90, 60]), map.containerPointToLatLng(map.getSize().subtract([60, 50])));
        if (inner.contains(arcBounds)) break;
        map.fitBounds(arcBounds.extend(L.latLngBounds(bounds)), { paddingTopLeft: [90, 60], paddingBottomRight: [60, 50], maxZoom: 15, animate: false });
      }
    }
    FS.fitWhenVisible(map, mapEl, fitAll);

    // «Vis hele stedet» og fullskjerm under zoomknappene (common.js).
    FS.addViewControls(map, mapEl, fitAll, FS.t("site.showWholeSite"));
    // Værstasjonene som et lag, som på forsidekartet (stations.js), fra de samme dataene som «Målt nå» på siden.
    var stationNow = document.getElementById("station-now");
    if (window.FlyingSitesStations && stationNow) window.FlyingSitesStations.addMapLayer(map, stationNow.getAttribute("data-url"));
    // «Piloter i lufta» (live.js), av til det slås på i laglista.
    FS.lazyOverlays(map, mapEl.getAttribute("data-live-script"), [{ key: "live", label: FS.t("live.layer"), attribution: FS.t("live.credit") }], function (layers) {
      window.FlyingSitesLive.addMapLayer(map, mapEl.getAttribute("data-live-url"), layers.live);
    });
    // «Kraftlinjer og hindre» (common.js), av til det slås på i laglista.
    FS.addObstacleLayer(map, mapEl.getAttribute("data-obstacles-url"));

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
    // Markøren for posisjonen langs ruten er mørk, ikke oransje (det er satt av til fare og vind).
    var positionMarker = L.circleMarker([0, 0], { radius: 8, color: "#1C2B33", weight: 4, fillColor: "#FFFFFF", fillOpacity: 1, interactive: false });

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
      // Bygd med DOM-kall, ikke innerHTML, så ingen tekst noen gang leses som markup.
      svg.replaceChildren();
      function add(tag, attrs, text) {
        var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
        Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
        if (text != null) node.textContent = text;
        svg.appendChild(node);
      }
      [hi, mid].forEach(function (v) {
        add("line", { class: "profile__grid", x1: LEFT, x2: width - RIGHT, y1: y(v).toFixed(1), y2: y(v).toFixed(1) });
      });
      [lo, mid, hi].forEach(function (v) {
        add("text", { class: "profile__axis", x: LEFT - 6, y: (y(v) + 4).toFixed(1), "text-anchor": "end" }, String(Math.round(v)));
      });
      add("text", { class: "profile__axis", x: LEFT, y: HEIGHT - 8 }, "0 km");
      add("text", { class: "profile__axis", x: width - RIGHT, y: HEIGHT - 8, "text-anchor": "end" }, FS.formatNumber(total / 1000, 1) + " km");
      add("text", { class: "profile__axis", x: 4, y: TOP - 2 }, FS.t("site.masl"));
      add("path", { class: "profile__area", d: area });
      add("path", { class: "profile__line", d: line });
      add("path", { class: "profile__steep", d: steep });
      add("line", { class: "profile__cursor-line", y1: TOP, y2: HEIGHT - BOTTOM });
      add("circle", { class: "profile__cursor", r: 6 });
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
      readouts.elevation.textContent = Math.round(q[1]) + " " + FS.t("site.masl");
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
        svg.replaceChildren();
        summaryEl.textContent = FS.t("site.noProfile");
        return;
      }
      slider.max = String(route.profile.length - 1);
      var steepM = route.steepM >= 50 ? roundTo(route.steepM, 50) : roundTo(route.steepM, 10);
      var text = FS.t("site.profileSummary", { km: FS.formatNumber(route.lengthKm, 1), from: Math.round(route.fromMasl), to: Math.round(route.toMasl) });
      text += steepM > 0 ? FS.t("site.steep", { m: steepM }) : FS.t("site.noSteep");
      text += route.elevationSource === "Kartverket" ? FS.t("site.heightsKartverket") : FS.t("site.heightsGps");
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
  }
})();
