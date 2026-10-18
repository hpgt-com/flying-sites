// Shared by the home page and site pages: texts, map layers and wind rose.
(function () {
  "use strict";

  // --- Texts ---
  // The dictionary for the page language is in #i18n-data (base.njk, from src/_i18n/<lang>.json): t("home.seeSite"),
  // t("home.closeCard", { name: "Elgen" }). tn() picks singular or plural: tn("summary.places", 3).
  var I18N = readJson("i18n-data") || { meta: { decimal: ",", clockSep: "." }, directions: { labels: {} }, js: {} };
  function fill(text, vars) {
    return String(text == null ? "" : text).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; });
  }
  function lookup(path) {
    return path.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, I18N.js);
  }
  function t(path, vars) {
    var value = lookup(path);
    return value == null ? path : fill(value, vars);
  }
  function tn(path, n, vars) {
    var forms = lookup(path) || {};
    var v = vars || {};
    v.n = n;
    return fill(n === 1 ? forms.one : forms.other, v);
  }

  var DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  var DIRECTION_LABELS = I18N.directions.labels;

  // Same paths as the rose macro in src/_includes/macros.njk.
  var ROSE_PATHS = [
    "M58.8 21.7 A62 62 0 0 1 101.2 21.7 L85.5 65.0 A16 16 0 0 0 74.5 65.0Z",
    "M106.2 23.8 A62 62 0 0 1 136.2 53.8 L94.5 73.2 A16 16 0 0 0 86.8 65.5Z",
    "M138.3 58.8 A62 62 0 0 1 138.3 101.2 L95.0 85.5 A16 16 0 0 0 95.0 74.5Z",
    "M136.2 106.2 A62 62 0 0 1 106.2 136.2 L86.8 94.5 A16 16 0 0 0 94.5 86.8Z",
    "M101.2 138.3 A62 62 0 0 1 58.8 138.3 L74.5 95.0 A16 16 0 0 0 85.5 95.0Z",
    "M53.8 136.2 A62 62 0 0 1 23.8 106.2 L65.5 86.8 A16 16 0 0 0 73.2 94.5Z",
    "M21.7 101.2 A62 62 0 0 1 21.7 58.8 L65.0 74.5 A16 16 0 0 0 65.0 85.5Z",
    "M23.8 53.8 A62 62 0 0 1 53.8 23.8 L73.2 65.5 A16 16 0 0 0 65.5 73.2Z",
  ];

  // "primary" | "possible" | "none", like directionType in lib/format.js.
  function directionType(site, code) {
    if (site.primary.indexOf(code) !== -1) return "primary";
    if (site.possible.indexOf(code) !== -1) return "possible";
    return "none";
  }

  // wind (optional): { code, rating, edge } from the wind assessment. The sector the wind comes from is filled with
  // the rating colour, so you can see whether the wind hits a launch direction without a separate arrow. With edge (the
  // home page markers) it runs from the centre out to the ring around the rose; otherwise (the card) it is «lifted» out slightly.
  var LIFT = 8;
  function roseSvg(site, size, labels, wind) {
    var lift = wind && !wind.edge;
    var viewBox = labels ? "-12 -12 184 184" : lift ? (18 - LIFT) + " " + (18 - LIFT) + " " + (124 + 2 * LIFT) + " " + (124 + 2 * LIFT) : "18 18 124 124";
    var svg = '<svg class="rose" width="' + size + '" height="' + size + '" viewBox="' + viewBox + '" aria-hidden="true">';
    var lifted = "";
    DIRECTIONS.forEach(function (code, i) {
      if (wind && wind.code === code) {
        if (wind.edge) {
          // From the centre out to the edge (r = 62, where the ring around the marker is).
          var b0 = (i * 45 - 22.5 - 90) * Math.PI / 180, b1 = (i * 45 + 22.5 - 90) * Math.PI / 180;
          lifted = '<path d="M80 80 L' + (80 + 62 * Math.cos(b0)).toFixed(1) + " " + (80 + 62 * Math.sin(b0)).toFixed(1) +
            " A62 62 0 0 1 " + (80 + 62 * Math.cos(b1)).toFixed(1) + " " + (80 + 62 * Math.sin(b1)).toFixed(1) +
            ' Z" class="sector sector--wind sector--wind-edge sector--wind-' + wind.rating + '"></path>';
          return;
        }
        var a = i * 45 * Math.PI / 180;
        lifted = '<path d="' + ROSE_PATHS[i] + '" class="sector sector--wind sector--wind-' + wind.rating + '" transform="translate(' +
          (Math.sin(a) * LIFT).toFixed(1) + " " + (-Math.cos(a) * LIFT).toFixed(1) + ')"></path>';
        return;
      }
      svg += '<path d="' + ROSE_PATHS[i] + '" class="sector sector--' + directionType(site, code) + '"></path>';
    });
    svg += lifted;
    svg += '<circle cx="80" cy="80" r="9" class="rose__center"></circle>';
    if (labels) {
      // The letters come from the dictionary, so they are escaped like other text.
      var lab = function (code) { return escapeHtml(DIRECTION_LABELS[code]); };
      svg += '<text x="80" y="2" text-anchor="middle">' + lab("N") + '</text><text x="80" y="168" text-anchor="middle">' + lab("S") + "</text>" +
        '<text x="-4" y="85" text-anchor="middle">' + lab("W") + '</text><text x="164" y="85" text-anchor="middle">' + lab("E") + "</text>";
    }
    return svg + "</svg>";
  }

  // A tile in the lower layer is shown only once the tile above at the same spot has loaded. OpenTopoMap often loads faster
  // than Kartverket, so without this OpenTopoMap flashes up before Kartverket covers it. The lower layer has
  // maxNativeZoom 17, so at zoom 18 one lower tile covers four upper tiles.
  function showUnderlayAfter(top, under) {
    var native = under.options.maxNativeZoom;
    var ready = {};
    function underKey(c) {
      var dz = Math.max(0, c.z - native);
      return (c.x >> dz) + ":" + (c.y >> dz) + ":" + (c.z - dz);
    }
    top.on("tileload tileerror", function (ev) {
      var key = underKey(ev.coords);
      ready[key] = true;
      var tile = under._tiles && under._tiles[key];
      if (tile) tile.el.style.visibility = "";
    });
    under.on("tileloadstart", function (ev) {
      if (!ready[under._tileCoordsToKey(ev.coords)]) ev.tile.style.visibility = "hidden";
    });
  }

  // Hillshade from Kartverket's national elevation model (hoydedata.no, open data), on top of the base map. Shows
  // the mountainsides and which way they face. The service renders images for an extent, not ready-made tiles, so each
  // tile is requested with its own extent in Web Mercator. Norway only, transparent elsewhere. Off by default.
  var HILLSHADE_URL = "https://hoydedata.no/arcgis/rest/services/NHM_DTM_25833/ImageServer/exportImage";
  function hillshadeLayer() {
    var Layer = L.TileLayer.extend({
      getTileUrl: function (coords) {
        var size = this.getTileSize();
        var nw = this._map.unproject(coords.scaleBy(size), coords.z);
        var se = this._map.unproject(coords.scaleBy(size).add(size), coords.z);
        var a = L.CRS.EPSG3857.project(nw), b = L.CRS.EPSG3857.project(se);
        return HILLSHADE_URL + "?bbox=" + [a.x, b.y, b.x, a.y].map(Math.round).join(",") +
          "&bboxSR=3857&imageSR=3857&size=" + size.x + "," + size.y + "&format=png&transparent=true" +
          "&renderingRule=" + encodeURIComponent('{"rasterFunction":"skyggerelieff"}') + "&f=image";
      },
    });
    return new Layer("", { minZoom: 8, maxZoom: 18, opacity: 0.4, className: "hillshade-tiles", attribution: t("map.hillshadeAttribution") });
  }

  // Fixed English key for each map layer, so the statistics (map-layer/<key>) are the same in all languages.
  function layerLabel(map, key, label) {
    (map.layerKeys || (map.layerKeys = {}))[label] = key;
    return label;
  }

  // Touch screens: one finger scrolls the page, two fingers pan and zoom the map, so you do not get trapped in the map
  // when scrolling down the page. Without Leaflet's dragging, leaflet.css gives the map touch-action: pan-x pan-y, so
  // the browser scrolls the page while Leaflet takes the pinch (which also pans the map). Dragging with one finger briefly
  // shows «Bruk to fingre for å flytte kartet». In full screen there is no page to scroll, and one finger pans the map.
  var COARSE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  function useTwoFingers(map) {
    if (!COARSE) return;
    map.dragging.disable();
    var container = map.getContainer();
    var hint = L.DomUtil.create("div", "map-touch-hint", container);
    hint.textContent = t("map.twoFingers");
    hint.setAttribute("aria-hidden", "true");
    var timer = null;
    container.addEventListener("touchmove", function (ev) {
      if (map.dragging.enabled() || ev.touches.length !== 1) return;
      hint.classList.add("map-touch-hint--on");
      clearTimeout(timer);
      timer = setTimeout(function () { hint.classList.remove("map-touch-hint--on"); }, 1500);
    }, { passive: true });
    container.addEventListener("touchstart", function (ev) {
      if (ev.touches.length > 1) hint.classList.remove("map-touch-hint--on");
    }, { passive: true });
    map.on("fullscreenchange", function (ev) {
      if (ev.on) map.dragging.enable();
      else map.dragging.disable();
      hint.classList.remove("map-touch-hint--on");
    });
  }

  // Zoom with the mouse wheel: the wheel scrolls the page as normal, and zooms the map with Ctrl (or Cmd on Mac), as in
  // Google Maps, so you do not get stuck in the map when scrolling down the page. Without Ctrl a short hint is shown.
  // In full screen there is no page to scroll, and the wheel zooms. active() can turn it off, for example on the
  // desktop home page where the map fills its column and nothing scrolls. Zoom buttons and +/- work as before.
  function wheelNeedsCtrl(map, active) {
    var el = map.getContainer();
    var hint = document.createElement("div");
    hint.className = "map-hint";
    hint.setAttribute("aria-hidden", "true");
    hint.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? t("site.zoomHintMac") : t("site.zoomHint");
    el.appendChild(hint);
    var timer = null;
    // Caught before Leaflet sees the event (capture), so Leaflet's own zoom only gets scrolling with Ctrl/Cmd.
    // Leaflet then also stops the browser from zooming the whole page.
    el.addEventListener("wheel", function (ev) {
      if (ev.ctrlKey || ev.metaKey || el.classList.contains("map--fullscreen") || (active && !active())) { hint.classList.remove("is-visible"); return; }
      ev.stopPropagation();
      hint.classList.add("is-visible");
      clearTimeout(timer);
      timer = setTimeout(function () { hint.classList.remove("is-visible"); }, 1200);
    }, true);
  }

  function createMap(element, options) {
    var map = L.map(element, Object.assign({ scrollWheelZoom: true, zoomControl: true }, options || {}));
    useTwoFingers(map);
    var kartverket = L.tileLayer("https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png", {
      maxZoom: 18,
      className: "base-tiles",
      attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a>',
    });
    function openTopoLayer() {
      return L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
        maxNativeZoom: 17,
        maxZoom: 18,
        subdomains: "abc",
        className: "base-tiles",
        attribution: t("map.openTopoAttribution"),
      });
    }
    var openTopo = openTopoLayer();
    // Kartverket's tiles are transparent outside Norway, so OpenTopoMap below fills in the rest of the world.
    var underlay = openTopoLayer();
    showUnderlayAfter(kartverket, underlay);
    var topo = L.layerGroup([underlay, kartverket]);
    // Satellite imagery from Sentinel-2 cloudless (EOX), free for non-commercial use (CC BY-NC-SA 4.0) without a key.
    // 10 m resolution, so tiles exist only up to zoom 14 and are enlarged beyond that. Not inverted in the dark theme.
    var satellite = L.tileLayer("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg", {
      maxNativeZoom: 14,
      maxZoom: 18,
      className: "photo-tiles",
      attribution: t("map.satelliteAttribution"),
    });
    // Kartverket's greyscale map: roses, airspace and rating colours show better on grey. OpenTopoMap below, as for topo.
    var grayTiles = L.tileLayer("https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png", {
      maxZoom: 18,
      className: "base-tiles",
      attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a>',
    });
    var grayUnderlay = openTopoLayer();
    showUnderlayAfter(grayTiles, grayUnderlay);
    var gray = L.layerGroup([grayUnderlay, grayTiles]);
    topo.addTo(map);
    var baseLayers = {};
    baseLayers[layerLabel(map, "topo", t("map.layerTopo"))] = topo;
    baseLayers[layerLabel(map, "greyscale", t("map.layerGray"))] = gray;
    baseLayers[layerLabel(map, "opentopomap", t("map.layerOpenTopo"))] = openTopo;
    baseLayers[layerLabel(map, "satellite", t("map.layerSatellite"))] = satellite;
    map.layersControl = L.control.layers(baseLayers, null, { position: "topright" }).addTo(map);
    // Only when someone picks a layer themselves. Leaflet also fires baselayerchange when the map loads.
    map.layersControl.getContainer().addEventListener("change", function (ev) {
      if (!ev.target.checked) return;
      var label = ev.target.closest("label");
      track("map-layer/" + ((label && map.layerKeys[label.textContent.trim()]) || "unknown"));
    });
    // Thermals from thermal.kk7.ch: statistics from logged flights, not a forecast. Off by default.
    // Tiles are in TMS order, and src must give our domain (terms of thermal.kk7.ch).
    ["skyways_all_all", "thermals_all_all"].forEach(function (name, i) {
      var layer = L.tileLayer("https://thermal.kk7.ch/tiles/" + name + "/{z}/{x}/{y}.png?src=" + encodeURIComponent(location.hostname), {
        tms: true, maxNativeZoom: 13, maxZoom: 18, opacity: 0.7,
        attribution: t("map.thermalAttribution"),
      });
      map.layersControl.addOverlay(layer, i ? layerLabel(map, "thermals", t("map.layerThermals")) : layerLabel(map, "skyways", t("map.layerSkyways")));
    });
    map.layersControl.addOverlay(hillshadeLayer(), layerLabel(map, "hillshade", t("map.layerHillshade")));
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    return map;
  }

  // Leaflet must know the map size before it zooms to the content. The element can have zero
  // size when the script runs (hidden tab, layout not finished), so we wait for the first
  // real size and keep the map updated when it changes.
  // Buttons below the zoom buttons: «Vis hele …» (house) returns to the view fit() gives, and full screen
  // lays the map over the whole page. Not the browser's full screen, so it also works on iPhone. Esc or
  // the button again closes it. The view is refitted when the map changes size. Used on the home page and site page.
  var ICON_HOME = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7"></path><path d="M5 10v10h5v-6h4v6h5V10"></path></svg>';
  var ICON_EXPAND = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path></svg>';
  var ICON_SHRINK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"></path></svg>';
  function controlButton(onClick) {
    var bar = L.DomUtil.create("div", "leaflet-bar map-reset");
    var button = L.DomUtil.create("a", "", bar);
    button.href = "#";
    button.setAttribute("role", "button");
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.on(button, "click", function (ev) { L.DomEvent.preventDefault(ev); onClick(); });
    return { bar: bar, button: button };
  }
  function addViewControls(map, mapEl, fit, resetLabel) {
    var Reset = L.Control.extend({
      options: { position: "topleft" },
      onAdd: function () {
        var c = controlButton(function () { map.closePopup(); fit(); });
        c.button.title = resetLabel;
        c.button.setAttribute("aria-label", resetLabel);
        c.button.innerHTML = ICON_HOME;
        return c.bar;
      },
    });
    new Reset().addTo(map);

    var fullscreenButton = null;
    function setFullscreen(on, keepView) {
      mapEl.classList.toggle("map--fullscreen", on);
      document.body.classList.toggle("has-fullscreen-map", on);
      fullscreenButton.innerHTML = on ? ICON_SHRINK : ICON_EXPAND;
      var label = on ? t("map.fullscreenClose") : t("map.fullscreenOpen");
      fullscreenButton.title = label;
      fullscreenButton.setAttribute("aria-label", label);
      fullscreenButton.setAttribute("aria-pressed", String(on));
      map.fire("fullscreenchange", { on: on });
      if (keepView) return;
      map.invalidateSize();
      map.closePopup();
      fit();
    }
    var Fullscreen = L.Control.extend({
      options: { position: "topleft" },
      onAdd: function () {
        var c = controlButton(function () {
          var on = !mapEl.classList.contains("map--fullscreen");
          if (on) track("fullscreen" + location.pathname);
          setFullscreen(on);
        });
        fullscreenButton = c.button;
        return c.bar;
      },
    });
    new Fullscreen().addTo(map);
    setFullscreen(false, true);
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && mapEl.classList.contains("map--fullscreen")) setFullscreen(false);
    });
  }

  function fitWhenVisible(map, element, fit) {
    var done = false, queued = false;
    // The first view is the fitted one when the map already has a size. A temporary view first would make Leaflet draw
    // the markers and fetch tiles twice, which costs time on slow phones and networks.
    if (!element.clientWidth || !element.clientHeight) map.setView([68.8, 16.4], 9);
    function check() {
      queued = false;
      if (!element.clientWidth || !element.clientHeight) return;
      // moveend (which recalculates the clusters on the home page) waits until the size has settled.
      map.invalidateSize({ debounceMoveend: true });
      if (!done) { done = true; fit(); }
    }
    // At most once per frame: the home page map changes size while the page scrolls on mobile, and older phones lag if
    // Leaflet redraws for every change.
    function queue() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(check);
    }
    if ("ResizeObserver" in window) new ResizeObserver(queue).observe(element);
    else window.addEventListener("resize", queue);
    check();
  }

  // --- Launches on the site page and in the 3D view ---
  // Launches with their own position (launches[].lat/lon) each get a rose with their directions. The main launch
  // (launch) shows the directions of launches without their own position, or all directions when none has one.
  // Only directions the site suits (primary or possible) are included, so lines like «ikke egnet,
  // men mulig i svak vind» get no colour. A launch without such directions is not drawn.
  // data: { launch, launches, wind_directions }. Returns [{ lat, lon, directions, label, texts }].
  function launchPoints(data) {
    var wind = data.wind_directions || {};
    var all = (wind.primary || []).concat(wind.possible || []);
    var usable = function (list) { return DIRECTIONS.filter(function (d) { return all.indexOf(d) !== -1 && (list || []).indexOf(d) !== -1; }); };
    var label = function (dirs) { return t("site.launchDirs", { dirs: dirs.map(function (d) { return DIRECTION_LABELS[d]; }).join(", ") }); };
    var launches = data.launches || [];
    var placed = launches.filter(function (l) { return l.lat != null && l.lon != null; });
    var points = [];
    if (!placed.length) {
      points.push({ lat: data.launch.lat, lon: data.launch.lon, directions: usable(all), label: t("site.launch"),
        texts: launches.map(function (l) { return l.text; }).filter(Boolean) });
    } else {
      var rest = launches.filter(function (l) { return l.lat == null; });
      var restDirs = usable([].concat.apply([], rest.map(function (l) { return l.directions || []; })));
      if (restDirs.length) {
        points.push({ lat: data.launch.lat, lon: data.launch.lon, directions: restDirs, label: label(restDirs),
          texts: rest.filter(function (l) { return usable(l.directions).length; }).map(function (l) { return l.text; }).filter(Boolean) });
      }
      placed.forEach(function (l) {
        var dirs = usable(l.directions);
        if (dirs.length) points.push({ lat: l.lat, lon: l.lon, directions: dirs, label: label(dirs), texts: l.text ? [l.text] : [] });
      });
    }
    return points;
  }

  // --- Direction arcs ---
  // Which sides of the mountain the site suits: one yellow arc per direction in wind_directions, with an arrow out.
  // Dark yellow is primary, light yellow possible. Used in the site page map (from above) and in the 3D view.
  // If launches have their own positions (launches[].lat/lon), each direction group (launches with the same
  // directions) gets its own arc where the launches are: midway between them, with radius to the farthest launch +
  // ARC_RADIUS_PLACED_M, so the arc stretches along the slope between them. Without own positions there is one arc
  // around the main launch, or around direction_arc in the drawing (<id>-drawing.geojson).
  // data: { launch, launches, wind_directions, drawing }. Coordinates are [lon, lat].
  var ARC_COLORS = { primary: "#F2B705", possible: "#F8DC7A" };
  var ARC_RADIUS_M = 250, ARC_RADIUS_PLACED_M = 110, ARC_ARROW_M = 70;
  var BEARINGS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

  // Point `meters` from [lon, lat] in direction `bearing` (degrees, 0 is north). Good enough for short distances.
  function offset(from, bearing, meters) {
    var b = bearing * Math.PI / 180;
    return [from[0] + Math.sin(b) * meters / (111320 * Math.cos(from[1] * Math.PI / 180)), from[1] + Math.cos(b) * meters / 110540];
  }
  function distanceM(a, b) { return Math.hypot((a[1] - b[1]) * 110540, (a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180)); }

  function arcGroups(data) {
    var wind = data.wind_directions || {}, arcConfig = data.drawing && data.drawing.direction_arc;
    var all = DIRECTIONS.filter(function (d) { return (wind.primary || []).indexOf(d) !== -1 || (wind.possible || []).indexOf(d) !== -1; });
    var placed = (data.launches || []).some(function (l) { return l.lat != null && l.lon != null; });
    if (arcConfig || !placed) {
      return [{ center: (arcConfig && arcConfig.center) || [data.launch.lon, data.launch.lat],
        radius: (arcConfig && arcConfig.radius) || ARC_RADIUS_M, directions: all }];
    }
    var groups = {};
    launchPoints(data).forEach(function (p) {
      var key = p.directions.join(",");
      (groups[key] = groups[key] || { directions: p.directions, points: [] }).points.push([p.lon, p.lat]);
    });
    return Object.keys(groups).map(function (key) {
      var g = groups[key], n = g.points.length;
      var center = [g.points.reduce(function (s, q) { return s + q[0]; }, 0) / n, g.points.reduce(function (s, q) { return s + q[1]; }, 0) / n];
      var spread = Math.max.apply(null, g.points.map(function (q) { return distanceM(q, center); }));
      return { center: center, radius: spread + ARC_RADIUS_PLACED_M, directions: g.directions };
    });
  }

  // [{ direction, label, color, pts, bearing, center, radius, mid, tip }], one per direction and group.
  // options.minRadius and options.arrow (metres) let the map keep the arc visible when zoomed out.
  function directionArcs(data, options) {
    var wind = data.wind_directions || {}, arcs = [], o = options || {};
    var arrow = o.arrow || ARC_ARROW_M;
    arcGroups(data).forEach(function (g) {
      var radius = Math.max(g.radius, o.minRadius || 0);
      g.directions.forEach(function (d) {
        var pts = [];
        for (var az = BEARINGS[d] - 22.5; az <= BEARINGS[d] + 22.5 + 0.01; az += 3) pts.push(offset(g.center, az, radius));
        var type = (wind.primary || []).indexOf(d) !== -1 ? "primary" : "possible";
        arcs.push({ direction: d, label: DIRECTION_LABELS[d], color: ARC_COLORS[type], pts: pts, bearing: BEARINGS[d],
          center: g.center, radius: radius, mid: offset(g.center, BEARINGS[d], radius), tip: offset(g.center, BEARINGS[d], radius + arrow) });
      });
    });
    return arcs;
  }

  // Arrowhead at `tip` in direction `bearing`, as a triangle in metres: [[lon, lat], ...].
  function arrowHead(tip, bearing, size) {
    var base = offset(tip, bearing + 180, size);
    return [tip, offset(base, bearing + 90, size * 0.6), offset(base, bearing - 90, size * 0.6), tip];
  }

  // --- Airspace layers ---
  // Four groups with on/off in the map's layer control, as in IPPC. All are off initially, and the
  // airspace (from openAIP, see scripts/update-airspace.mjs) is loaded only when a group is switched on.
  var AIRSPACE_GROUPS = [
    { key: "airspace-tma", name: t("map.airspaceTma"), types: ["TMA", "CTA"], color: "#2F6FB5", dash: null },
    { key: "airspace-ctr", name: t("map.airspaceCtr"), types: ["CTR", "MCTR", "ATZ", "TIZ"], color: "#C0392B", dash: null },
    { key: "airspace-military", name: t("map.airspaceMilitary"), types: ["MTA", "TRA", "TSA"], color: "#7B3FA0", dash: "6 4" },
    { key: "airspace-danger", name: t("map.airspaceDanger"), types: ["D", "R", "P"], color: "#C24A12", dash: "6 4" },
  ];

  function formatLimit(l) {
    if (!l) return "";
    if (l.ref === "GND" && !l.value) return t("map.ground");
    if (l.unit === "FL") return "FL" + l.value;
    var text = l.value + (l.unit === "M" ? " m" : " ft");
    if (l.ref === "GND") return t("map.aboveGround", { text: text });
    return l.ref === "MSL" && l.unit === "FT" ? t("map.aboutMasl", { text: text, m: Math.round(l.value * 0.3048) }) : text;
  }

  function airspacePopup(p) {
    var e = escapeHtml;
    var rows = [[t("map.class"), p.class], [t("map.lower"), formatLimit(p.lower)], [t("map.upper"), formatLimit(p.upper)]]
      .filter(function (row) { return row[1]; })
      .map(function (row) { return "<tr><th>" + row[0] + "</th><td>" + e(row[1]) + "</td></tr>"; }).join("");
    return '<div class="airspace-popup"><strong>' + e(p.name) + "</strong><table>" + rows + "</table>" +
      (p.byNotam ? '<p class="airspace-popup__notam">' + e(t("map.byNotam")) + "</p>" : "") + "</div>";
  }

  // Precipitation radar from RainViewer (free for non-commercial use, with attribution). Loaded only when the layer
  // is switched on, and the image list is refetched every ten minutes while the layer is on. The free tier has tiles
  // only up to zoom 7, so they are enlarged when zooming in: coarse, but enough to see approaching showers. The latest
  // images (10 minutes apart) play as a short animation that pauses briefly on the last one, with
  // the time in a small box below the layer control. MET's radar map is reserved for Yr, so we cannot use it.
  var RADAR_INDEX = "https://api.rainviewer.com/public/weather-maps.json";
  var RADAR_FRAMES = 6, RADAR_STEP_MS = 700, RADAR_HOLD_STEPS = 4;
  var osloClock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Oslo" });
  function addRadarLayer(map) {
    if (!map.layersControl) return;
    var group = L.layerGroup();
    map.layersControl.addOverlay(group, layerLabel(map, "radar", t("map.layerRadar")));
    var layers = [], times = [], timer = null, refresh = null, on = false, step = 0;

    var statusEl = null;
    var Status = L.Control.extend({
      options: { position: "topright" },
      onAdd: function () {
        statusEl = L.DomUtil.create("div", "airspace-status radar-status");
        statusEl.setAttribute("role", "status");
        statusEl.hidden = true;
        L.DomEvent.disableClickPropagation(statusEl);
        statusEl.addEventListener("click", function (ev) { if (ev.target.closest("[data-retry]")) load(); });
        return statusEl;
      },
    });
    new Status().addTo(map);
    function setStatus(state, text) {
      if (!statusEl) return;
      statusEl.hidden = !state;
      statusEl.classList.toggle("airspace-status--error", state === "error");
      statusEl.innerHTML = state === "error"
        ? escapeHtml(t("map.radarError")) + ' <button type="button" data-retry>' + escapeHtml(t("map.retry")) + "</button>"
        : escapeHtml(text || "");
    }

    function show(i) {
      layers.forEach(function (layer, j) { layer.setOpacity(j === i ? 0.7 : 0); });
      var clock = osloClock.format(new Date(times[i] * 1000)).replace(":", (I18N.meta && I18N.meta.clockSep) || ".");
      setStatus("frame", t("map.radarTime", { time: clock }));
    }
    function play() {
      clearInterval(timer);
      step = 0;
      show(0);
      // Steps through the images and stays on the last one for a few steps before starting over.
      timer = setInterval(function () {
        step = (step + 1) % (layers.length + RADAR_HOLD_STEPS);
        show(Math.min(step, layers.length - 1));
      }, RADAR_STEP_MS);
    }
    function stop() {
      clearInterval(timer);
      clearInterval(refresh);
      timer = refresh = null;
      group.clearLayers();
      layers = [];
      setStatus(null);
    }
    function load() {
      if (!layers.length) setStatus("loading", t("map.radarLoading"));
      // Timeout, so the layer does not stay on «Laster radar …» if RainViewer does not respond.
      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      var timeout = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
      fetch(RADAR_INDEX, ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
        clearTimeout(timeout);
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (data) {
        var past = data && data.radar && Array.isArray(data.radar.past) ? data.radar.past.slice(-RADAR_FRAMES) : [];
        if (!on) return;
        if (!past.length || typeof data.host !== "string" || data.host.indexOf("https://") !== 0) throw new Error("ukjent format");
        group.clearLayers();
        times = past.map(function (f) { return f.time; });
        layers = past.map(function (f) {
          return L.tileLayer(data.host + f.path + "/256/{z}/{x}/{y}/2/1_1.png", {
            maxNativeZoom: 7, maxZoom: 18, opacity: 0, className: "radar-tiles", attribution: t("map.radarAttribution"),
          }).addTo(group);
        });
        play();
      }).catch(function () {
        if (on && !layers.length) setStatus("error");
      });
    }
    map.on("overlayadd", function (ev) {
      if (ev.layer !== group) return;
      on = true;
      load();
      refresh = setInterval(load, 10 * 60000);
    });
    map.on("overlayremove", function (ev) {
      if (ev.layer !== group) return;
      on = false;
      stop();
    });
  }

  function addAirspaceLayers(map, url) {
    if (!url || !map.layersControl) return;
    var groups = AIRSPACE_GROUPS.map(function (g) { return { def: g, layer: L.layerGroup() }; });
    groups.forEach(function (g) { map.layersControl.addOverlay(g.layer, layerLabel(map, g.def.key, g.def.name)); });
    var loading = null, attribution = null, active = 0;

    // Status below the layer control while airspace loads, and on error, so a checked layer without content does not
    // look like «ingen luftrom her». «Prøv igjen» fetches again.
    var statusEl = null;
    var Status = L.Control.extend({
      options: { position: "topright" },
      onAdd: function () {
        statusEl = L.DomUtil.create("div", "airspace-status");
        statusEl.setAttribute("role", "status");
        statusEl.hidden = true;
        L.DomEvent.disableClickPropagation(statusEl);
        statusEl.addEventListener("click", function (ev) { if (ev.target.closest("[data-retry]")) start(); });
        return statusEl;
      },
    });
    new Status().addTo(map);
    function setStatus(state) {
      if (!statusEl) return;
      statusEl.hidden = !state;
      statusEl.classList.toggle("airspace-status--error", state === "error");
      statusEl.innerHTML = state === "loading" ? escapeHtml(t("map.airspaceLoading"))
        : state === "error" ? escapeHtml(t("map.airspaceError")) + ' <button type="button" data-retry>' + escapeHtml(t("map.retry")) + "</button>" : "";
    }

    function load() {
      if (loading) return loading;
      loading = fetch(url).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (data) {
        if (!data || !Array.isArray(data.features)) throw new Error("ukjent format");
        attribution = t("map.airspaceAttribution", { date: (data.fetched || "").split("-").reverse().join(".") });
        data.features.forEach(function (f) {
          var g = groups.find(function (x) { return x.def.types.indexOf(f.properties.type) !== -1; });
          if (!g) return;
          // Transparent fill, so the map shows through where airspaces overlap. The fill is still
          // clickable, and the area lights up faintly on hover.
          L.geoJSON(f, {
            style: { color: g.def.color, weight: 2, opacity: 0.9, fillColor: g.def.color, fillOpacity: 0, dashArray: g.def.dash },
            onEachFeature: function (feature, layer) {
              layer.on("mouseover", function () { layer.setStyle({ fillOpacity: 0.12, weight: 3 }); });
              layer.on("mouseout", function () { layer.setStyle({ fillOpacity: 0, weight: 2 }); });
            },
          }).bindPopup(airspacePopup(f.properties)).addTo(g.layer);
        });
      });
      return loading;
    }

    function start() {
      setStatus("loading");
      load().then(function () {
        setStatus(null);
        if (active && attribution) map.attributionControl.removeAttribution(attribution).addAttribution(attribution);
      }, function () {
        loading = null; // next attempt fetches again
        setStatus(active ? "error" : null);
      });
    }

    function isAirspace(layer) { return groups.some(function (g) { return g.layer === layer; }); }

    // Attribution is shown while at least one airspace layer is on.
    map.on("overlayadd", function (ev) {
      if (!isAirspace(ev.layer)) return;
      active++;
      start();
    });
    map.on("overlayremove", function (ev) {
      if (!isAirspace(ev.layer)) return;
      active--;
      if (!active) setStatus(null);
      if (!active && attribution) map.attributionControl.removeAttribution(attribution);
    });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Number with the language's decimal separator (comma in Norwegian).
  function formatNumber(n, decimals) {
    return Number(n).toFixed(decimals || 0).replace(".", I18N.meta.decimal);
  }

  function readJson(id) {
    var el = document.getElementById(id);
    return el ? JSON.parse(el.textContent) : null;
  }

  // Same marking as the external() macro in macros.njk.
  var EXTERNAL_MARK = '<svg class="external-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"></path><path d="M8 7h9v9"></path></svg><span class="visually-hidden"> ' + escapeHtml(I18N.opensNewTab || "") + "</span>";

  // --- Colour mode ---
  // The script in <head> (base.njk) sets data-theme before the page is drawn. Here the buttons are wired up, and
  // the page follows when the device switches between light and dark while the choice is «Auto».
  var THEME_COLORS = { light: "#F3F5F4", dark: "#11191D" };
  var darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function isDark() { return document.documentElement.getAttribute("data-theme") === "dark"; }

  function applyTheme(choice) {
    var root = document.documentElement;
    var theme = choice === "dark" || (choice === "auto" && darkQuery && darkQuery.matches) ? "dark" : "light";
    var changed = root.getAttribute("data-theme") !== theme;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-choice", choice);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
    // Images with their own dark variant, such as the Yr meteogram. The light URL is kept in data-src-light.
    document.querySelectorAll("img[data-src-dark]").forEach(function (img) {
      if (!img.hasAttribute("data-src-light")) img.setAttribute("data-src-light", img.getAttribute("src"));
      var src = img.getAttribute(theme === "dark" ? "data-src-dark" : "data-src-light");
      if (img.getAttribute("src") !== src) img.setAttribute("src", src);
    });
    document.querySelectorAll(".theme-toggle button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-choice") === choice));
    });
    if (changed) document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: theme } }));
  }

  document.querySelectorAll(".theme-toggle").forEach(function (group) {
    group.addEventListener("click", function (ev) {
      var button = ev.target.closest("button[data-theme-choice]");
      if (!button) return;
      var choice = button.getAttribute("data-theme-choice");
      track("setting/theme/" + choice);
      try {
        if (choice === "auto") localStorage.removeItem("theme");
        else localStorage.setItem("theme", choice);
      } catch (e) {
        // private mode or blocked storage: the choice applies to this page only
      }
      applyTheme(choice);
    });
  });
  if (darkQuery) {
    var onSystemChange = function () { if (document.documentElement.getAttribute("data-theme-choice") === "auto") applyTheme("auto"); };
    if (darkQuery.addEventListener) darkQuery.addEventListener("change", onSystemChange);
    else if (darkQuery.addListener) darkQuery.addListener(onSystemChange);
  }
  applyTheme(document.documentElement.getAttribute("data-theme-choice") || "auto");

  // --- Colour-blind-friendly colours ---
  // Switches the wind assessment to blue / yellow / reddish orange / grey (Okabe–Ito). Stored as «cvd» in the browser.
  function applyCvd(on) {
    var root = document.documentElement;
    if (on) root.setAttribute("data-cvd", "on");
    else root.removeAttribute("data-cvd");
    document.querySelectorAll("[data-cvd-toggle]").forEach(function (b) { b.setAttribute("aria-checked", String(on)); });
  }
  document.querySelectorAll("[data-cvd-toggle]").forEach(function (button) {
    button.addEventListener("click", function () {
      var on = document.documentElement.getAttribute("data-cvd") !== "on";
      track("setting/colorblind/" + (on ? "on" : "off"));
      try {
        if (on) localStorage.setItem("cvd", "on");
        else localStorage.removeItem("cvd");
      } catch (e) {
        // blocked storage: the choice applies to this page only
      }
      applyCvd(on);
    });
  });
  applyCvd(document.documentElement.getAttribute("data-cvd") === "on");

  // --- Menu ---
  // Opened with the button, closed with the button, Escape or a click outside.
  document.querySelectorAll(".site-menu").forEach(function (menu) {
    var button = menu.querySelector(".site-menu__button");
    var panel = menu.querySelector(".site-menu__panel");
    button.hidden = false;
    function setOpen(open) {
      panel.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
    }
    button.addEventListener("click", function () { setOpen(panel.hidden); });
    document.addEventListener("click", function (ev) { if (!panel.hidden && !menu.contains(ev.target)) setOpen(false); });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && !panel.hidden) { setOpen(false); button.focus(); }
    });
  });

  // --- Click statistics ---
  // Counted as events in GoatCounter (src/assets/js/goatcounter.js), with English names like «link/flightlog.org/flysteder/ryten/».
  // Does nothing when the script is not loaded (locally, or blocked by an ad blocker).
  function track(name, title) {
    var gc = window.goatcounter;
    if (gc && gc.count) gc.count({ path: name, title: title || name, event: true });
  }

  // Outbound links (Flightlog, Yr, Windy, IPPC, directions …) and downloads (GPX, GeoJSON, KML), on all pages.
  // Middle-click (auxclick) opens in a new tab and is counted too.
  function trackLink(ev) {
    var a = ev.target.closest && ev.target.closest("a[href]");
    if (!a) return;
    var text = a.textContent.trim().replace(/\s+/g, " ");
    if (a.hasAttribute("download")) track("download" + a.pathname, text + " (" + location.pathname + ")");
    else if (a.hostname && a.hostname !== location.hostname) track("link/" + a.hostname.replace(/^www\./, "") + location.pathname, text);
  }
  document.addEventListener("click", trackLink);
  document.addEventListener("auxclick", trackLink);

  window.FlyingSites = {
    t: t,
    tn: tn,
    lang: I18N.lang || "nb",
    meta: I18N.meta,
    track: track,
    isDark: isDark,
    EXTERNAL_MARK: EXTERNAL_MARK,
    opensNewTab: I18N.opensNewTab || "",
    DIRECTIONS: DIRECTIONS,
    DIRECTION_LABELS: DIRECTION_LABELS,
    ROSE_PATHS: ROSE_PATHS,
    directionType: directionType,
    roseSvg: roseSvg,
    launchPoints: launchPoints,
    directionArcs: directionArcs,
    arrowHead: arrowHead,
    offset: offset,
    createMap: createMap,
    wheelNeedsCtrl: wheelNeedsCtrl,
    addAirspaceLayers: addAirspaceLayers,
    addRadarLayer: addRadarLayer,
    layerLabel: layerLabel,
    fitWhenVisible: fitWhenVisible,
    addViewControls: addViewControls,
    escapeHtml: escapeHtml,
    formatNumber: formatNumber,
    readJson: readJson,
  };
})();
