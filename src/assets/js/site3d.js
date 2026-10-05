// 3D-visning av et sted (src/3d.njk): terreng fra Terrain Tiles, Kartverkets topokart oppå, og
// start, landing, parkering, gangrute og tegningen fra <id>-drawing.geojson (se lib/drawing.js).
(function () {
  "use strict";

  var FS = window.FlyingSites;
  var data = FS.readJson("site3d-data");
  var mapEl = document.getElementById("map3d");
  if (!data || !data.drawing || !mapEl || !window.maplibregl) return;

  // Utsnittet i tegningen er laget for en bred skjerm. På smalere skjermer zoomes det litt ut, så
  // startene og landingen fortsatt er med.
  var camera = Object.assign({}, data.drawing.camera);
  camera.zoom += Math.max(-0.8, Math.min(0, Math.log2(mapEl.clientWidth / 1100) * 0.5));
  var infoEl = document.getElementById("map3d-info");
  var editing = /[?&]rediger\b/.test(location.search);

  // Farger på det som er tegnet inn. Fare er rød som farer-boksen, flyvei er aksentfargen.
  var STYLE_COLORS = { flight: "#C24A12", hazard: "#C62828", info: "#2E5E6E", launch: "#F2B705", landing: "#1C2B33" };
  // Retningsbuen: mørk gul for hovedretning, lys gul for mulig, som de gule strekene på de tegnede oversiktsbildene.
  var ARROW_COLORS = { primary: "#F2B705", possible: "#F8DC7A" };
  var BEARINGS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

  // Høyder fra Terrain Tiles (AWS Open Data, gratis og uten nøkkel). I Norge bygger de på Kartverkets
  // høydedata. To kilder, så terrenget og skyggeleggingen ikke deler mellomlager (anbefalt av MapLibre).
  var DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
  var DEM_ATTRIBUTION = 'Høyder: <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a>';
  var dem = function () { return { type: "raster-dem", tiles: [DEM_URL], encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: DEM_ATTRIBUTION }; };

  var map = new maplibregl.Map({
    container: mapEl,
    style: {
      version: 8,
      sources: {
        topo: {
          type: "raster",
          tiles: ["https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png"],
          tileSize: 256,
          maxzoom: 18,
          attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a>',
        },
        terrain: dem(),
        hillshade: dem(),
      },
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#E9EEEA" } },
        { id: "topo", type: "raster", source: "topo" },
        { id: "hillshade", type: "hillshade", source: "hillshade", paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#2A3A40" } },
      ],
      terrain: { source: "terrain", exaggeration: 1.2 },
      sky: { "sky-color": "#BFD9EA", "horizon-color": "#EEF3F2", "sky-horizon-blend": 0.6 },
    },
    center: camera.center,
    zoom: camera.zoom,
    pitch: camera.pitch,
    bearing: camera.bearing,
    maxPitch: 85,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

  function showInfo(title, texts) {
    var e = FS.escapeHtml;
    infoEl.innerHTML = "<h2>" + e(title) + "</h2>" + texts.filter(Boolean).map(function (t) { return "<p>" + e(t) + "</p>"; }).join("");
    infoEl.hidden = false;
  }

  function marker(className, html, lngLat, title, onClick, options) {
    var el = document.createElement(onClick ? "button" : "div");
    if (onClick) el.type = "button";
    el.className = className;
    el.innerHTML = html || "";
    if (title) { el.title = title; el.setAttribute("aria-label", title); }
    if (onClick) el.addEventListener("click", function (ev) { ev.stopPropagation(); onClick(); });
    return new maplibregl.Marker(Object.assign({ element: el }, options)).setLngLat(lngLat).addTo(map);
  }

  // --- Fra stedsfilen: start, landing og parkering ---
  var windDirections = data.wind_directions || { primary: [], possible: [] };
  var launchPoints = FS.launchPoints(data);
  // Starten er en oransje prikk. Retningene vises med buen under.
  launchPoints.forEach(function (p) {
    marker("map3d__launch", "", [p.lon, p.lat], p.label, function () { showInfo(p.label, p.texts); });
  });
  (data.landings || []).forEach(function (l) {
    var alt = l.primary === false;
    var name = l.name || (alt ? "Alternativ landing" : "Landing");
    marker("map-symbol map-symbol--landing map3d__landing" + (alt ? " map-symbol--alt" : ""), "", [l.lon, l.lat], name);
  });
  (data.parking || []).forEach(function (p) {
    marker("map-icon map-icon--parking map3d__parking", "P", [p.lon, p.lat], p.name || "Parkering");
  });

  // --- Tekstene i tegningen: nummererte punkter, med teksten i listen under kartet (src/3d.njk) ---
  // Markørene lages med en gang, ikke når stilen er klar: markører som lages etter at terrenget er på
  // plass, løftes ikke opp på terrenget før kartet flyttes.
  var labels = (data.drawing.features || []).filter(function (f) { return f.properties && f.properties.kind === "label" && f.properties.title; });
  labels.forEach(function (f, i) {
    var p = f.properties, n = i + 1, hazard = p.style === "hazard";
    marker("drawing-pin" + (hazard ? " drawing-pin--hazard" : ""), String(n), f.geometry.coordinates, n + ". " + p.title, function () {
      showInfo(n + ". " + p.title, [p.text]);
      selectListItem(n);
    });
  });
  function selectListItem(n) {
    document.querySelectorAll(".drawing-list li").forEach(function (li) { li.classList.toggle("is-selected", li.getAttribute("data-n") === String(n)); });
  }
  // Trykk i listen flytter kartet til punktet.
  document.querySelectorAll(".drawing-list button[data-n]").forEach(function (button) {
    button.addEventListener("click", function () {
      var n = Number(button.getAttribute("data-n")), f = labels[n - 1];
      if (!f) return;
      selectListItem(n);
      map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 14.5), duration: 800 });
    });
  });

  // Punkt `meters` fra [lon, lat] i retning `bearing` (grader, 0 er nord). Godt nok på korte avstander.
  function offset(from, bearing, meters) {
    var b = bearing * Math.PI / 180;
    return [from[0] + Math.sin(b) * meters / (111320 * Math.cos(from[1] * Math.PI / 180)), from[1] + Math.cos(b) * meters / 110540];
  }
  function bearingBetween(a, b) {
    var dx = (b[0] - a[0]) * Math.cos(b[1] * Math.PI / 180), dy = b[1] - a[1];
    return Math.atan2(dx, dy) * 180 / Math.PI;
  }
  // Pilspiss på slutten av en linje: en trekant i meter, så den ligger på terrenget og følger med når man vipper.
  function arrowHead(coords, size) {
    var a = coords[coords.length - 2], b = coords[coords.length - 1], bearing = bearingBetween(a, b);
    size = size || 45;
    var base = offset(b, bearing + 180, size);
    return [[b, offset(base, bearing + 90, size * 0.6), offset(base, bearing - 90, size * 0.6), b]];
  }

  // --- Retningsbuen ---
  // Hvilken side av fjellet stedet passer for: en gul bue rundt toppen, én bit per retning i
  // wind_directions, med en pil ut og retningen ved spissen. Mørk gul er hovedretning, lys gul mulig.
  // Regnes ut fra stedsfilen. Midten og radiusen kan settes i tegningen (direction_arc), ellers er
  // midten hovedstarten og radiusen ARC_RADIUS_M.
  // To visninger (UTKAST, velges med knappene over kartet): «løftet» svever over terrenget og synes fra
  // alle vinkler, «på bakken» ligger på terrenget og skjules bak topper.
  var ARC_RADIUS_M = 250, ARC_LIFT_M = 30;
  var arcConfig = data.drawing.direction_arc || {};
  var arcCenter = arcConfig.center || [data.launch.lon, data.launch.lat];
  var arcRadius = arcConfig.radius || ARC_RADIUS_M;
  var arcs = FS.DIRECTIONS.filter(function (d) {
    return (windDirections.primary || []).indexOf(d) !== -1 || (windDirections.possible || []).indexOf(d) !== -1;
  }).map(function (d) {
    var pts = [];
    for (var az = BEARINGS[d] - 22.5; az <= BEARINGS[d] + 22.5 + 0.01; az += 1.5) pts.push(offset(arcCenter, az, arcRadius));
    var type = (windDirections.primary || []).indexOf(d) !== -1 ? "primary" : "possible";
    return { direction: d, color: ARROW_COLORS[type], pts: pts, bearing: BEARINGS[d],
      mid: offset(arcCenter, BEARINGS[d], arcRadius), tip: offset(arcCenter, BEARINGS[d], arcRadius + 70) };
  });
  // Retningene på bakken er markører (følger terrenget). I løftet visning tegnes de i SVG-laget.
  var groundLabels = arcs.map(function (arc) {
    return marker("arc-label", FS.DIRECTION_LABELS[arc.direction], offset(arcCenter, arc.bearing, arcRadius + 115), null, null);
  });

  var arcMode = /(^|[#&])linje=bakke\b/.test(location.hash) ? "ground" : "lifted";
  var overlay = null;
  function setArcMode(mode) {
    arcMode = mode;
    var ground = mode === "ground";
    if (map.getLayer("arc-casing")) {
      ["arc-casing", "arc-line", "arc-heads-casing", "arc-heads"].forEach(function (id) { map.setLayoutProperty(id, "visibility", ground ? "visible" : "none"); });
      map.setLayoutProperty("arc-shadow", "visibility", ground ? "none" : "visible");
    }
    groundLabels.forEach(function (m) { m.getElement().hidden = !ground; });
    if (overlay) overlay.style.display = ground ? "none" : "";
    document.querySelectorAll("[data-arc-mode]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-arc-mode") === mode)); });
    history.replaceState(null, "", ground ? "#linje=bakke" : location.pathname + location.search);
  }
  document.querySelectorAll("[data-arc-mode]").forEach(function (b) {
    b.addEventListener("click", function () { setArcMode(b.getAttribute("data-arc-mode")); });
  });

  // Løftet: tegnes i et SVG-lag over kartet. Hvert punkt plasseres på terrenget (map.project) og løftes
  // ARC_LIFT_M meter rett opp, regnet om til piksler med den lokale målestokken og vinkelen. Løftet jevnes
  // ut langs buen, så linjen ikke blir bølgete der terrenget er ujevnt.
  function liftedPoints(lls) {
    var sin = Math.sin(map.getPitch() * Math.PI / 180);
    var base = lls.map(function (ll) { return map.project(ll); });
    var lift = lls.map(function (ll, i) {
      var e = map.project(offset(ll, 90, 50)), n = map.project(offset(ll, 0, 50)), p = base[i];
      return ARC_LIFT_M * Math.max(Math.hypot(e.x - p.x, e.y - p.y), Math.hypot(n.x - p.x, n.y - p.y)) / 50 * sin;
    });
    return base.map(function (p, i) {
      var w = lift.slice(Math.max(0, i - 4), i + 5), avg = w.reduce(function (x, y) { return x + y; }, 0) / w.length;
      return [p.x, p.y - avg];
    });
  }
  function svgPath(points) { return "M" + points.map(function (q) { return q[0].toFixed(1) + " " + q[1].toFixed(1); }).join(" L"); }
  function drawOverlay() {
    if (!overlay || arcMode !== "lifted") return;
    // Alle konturer først, så linjene, så det ikke blir mørke hakk der to retninger møtes.
    var casings = "", lines = "", tops = "";
    arcs.forEach(function (arc) {
      var pts = liftedPoints(arc.pts.concat([arc.mid, offset(arcCenter, arc.bearing, arcRadius + 60)]));
      var a = pts[pts.length - 2], b = pts[pts.length - 1], d = svgPath(pts.slice(0, -2));
      var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      var tip = [a[0] + ux * 30, a[1] + uy * 30], stem = [a[0] + ux * 18, a[1] + uy * 18];
      var head = [tip, [stem[0] - uy * 8, stem[1] + ux * 8], [stem[0] + uy * 8, stem[1] - ux * 8]];
      var label = [a[0] + ux * 48, a[1] + uy * 48];
      casings += '<path d="' + d + '" class="arc-overlay__casing"/><path d="' + svgPath([a, stem]) + '" class="arc-overlay__casing arc-overlay__casing--thin"/>';
      lines += '<path d="' + d + '" class="arc-overlay__line" style="stroke:' + arc.color + '"/><path d="' + svgPath([a, stem]) + '" class="arc-overlay__line arc-overlay__line--thin" style="stroke:' + arc.color + '"/>';
      tops += '<path d="' + svgPath(head) + 'Z" class="arc-overlay__head" style="fill:' + arc.color + '"/>' +
        '<text x="' + label[0].toFixed(1) + '" y="' + (label[1] + 5).toFixed(1) + '" class="arc-overlay__label">' + FS.DIRECTION_LABELS[arc.direction] + "</text>";
    });
    overlay.innerHTML = casings + lines + tops;
  }
  if (arcs.length) {
    overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    overlay.setAttribute("class", "arc-overlay");
    overlay.setAttribute("aria-hidden", "true");
    map.getContainer().appendChild(overlay);
    map.on("render", drawOverlay);
  }

  // Tegningen legges inn så snart stilen er klar, ikke ved «load», som venter på alle kartflisene.
  // Da vises den også når Kartverket eller høydedataene ikke svarer.
  function addDrawing() {
    var lines = [], areas = [], heads = [];
    (data.routes || []).forEach(function (r) {
      lines.push({ type: "Feature", properties: { color: "#1C2B33", dashed: true, width: 3, casing: false },
        geometry: { type: "LineString", coordinates: r.line.map(function (p) { return [p[1], p[0]]; }) } });
    });
    (data.drawing.features || []).forEach(function (f, i) {
      var p = f.properties || {};
      var color = STYLE_COLORS[p.style] || (p.kind === "area" ? STYLE_COLORS.hazard : STYLE_COLORS.flight);
      var props = { id: i, color: color, title: p.title || "", text: p.text || "", dashed: !!p.dashed, width: 4, casing: true };
      if (p.kind === "path") {
        lines.push({ type: "Feature", properties: props, geometry: f.geometry });
        if (p.arrow) heads.push({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: arrowHead(f.geometry.coordinates) } });
      } else if (p.kind === "area") {
        areas.push({ type: "Feature", properties: props, geometry: f.geometry });
      }
    });


    map.addSource("areas", { type: "geojson", data: { type: "FeatureCollection", features: areas } });
    map.addSource("lines", { type: "geojson", data: { type: "FeatureCollection", features: lines } });
    map.addSource("heads", { type: "geojson", data: { type: "FeatureCollection", features: heads } });
    map.addLayer({ id: "areas-fill", type: "fill", source: "areas", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.22 } });
    map.addLayer({ id: "areas-line", type: "line", source: "areas", paint: { "line-color": ["get", "color"], "line-width": 2.5 } });
    // Mørk kant under linjene, så også gule piler synes mot det lyse kartet.
    map.addLayer({ id: "lines-casing", type: "line", source: "lines", filter: ["==", ["get", "casing"], true], layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#1C2B33", "line-width": ["+", ["get", "width"], 3], "line-opacity": 0.85 } });
    map.addLayer({ id: "lines-solid", type: "line", source: "lines", filter: ["!=", ["get", "dashed"], true], layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": ["get", "width"] } });
    map.addLayer({ id: "lines-dashed", type: "line", source: "lines", filter: ["==", ["get", "dashed"], true],
      paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-dasharray": [1.5, 1.5] } });
    map.addLayer({ id: "heads-casing", type: "line", source: "heads", paint: { "line-color": "#1C2B33", "line-width": 2 } });
    map.addLayer({ id: "heads", type: "fill", source: "heads", paint: { "fill-color": ["get", "color"] } });

    // Retningsbuen på bakken, og skyggen under den løftede buen.
    var arcLines = arcs.map(function (arc) { return { type: "Feature", properties: { color: arc.color }, geometry: { type: "LineString", coordinates: arc.pts } }; });
    var arcHeads = [];
    arcs.forEach(function (arc) {
      var stem = [arc.mid, offset(arcCenter, arc.bearing, arcRadius + 70)];
      arcLines.push({ type: "Feature", properties: { color: arc.color, stem: true }, geometry: { type: "LineString", coordinates: stem } });
      arcHeads.push({ type: "Feature", properties: { color: arc.color }, geometry: { type: "Polygon", coordinates: arrowHead(stem, 32) } });
    });
    map.addSource("arc", { type: "geojson", data: { type: "FeatureCollection", features: arcLines } });
    map.addSource("arc-heads", { type: "geojson", data: { type: "FeatureCollection", features: arcHeads } });
    map.addLayer({ id: "arc-shadow", type: "line", source: "arc", filter: ["!=", ["get", "stem"], true],
      paint: { "line-color": "#1C2B33", "line-width": 4, "line-opacity": 0.35, "line-blur": 2 } });
    map.addLayer({ id: "arc-casing", type: "line", source: "arc", layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#1C2B33", "line-width": ["case", ["==", ["get", "stem"], true], 7, 10] } });
    map.addLayer({ id: "arc-line", type: "line", source: "arc", layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "stem"], true], 3.5, 6] } });
    map.addLayer({ id: "arc-heads-casing", type: "line", source: "arc-heads", paint: { "line-color": "#1C2B33", "line-width": 2 } });
    map.addLayer({ id: "arc-heads", type: "fill", source: "arc-heads", paint: { "fill-color": ["get", "color"] } });
    setArcMode(arcMode);

    ["areas-fill", "lines-solid", "lines-dashed", "heads"].forEach(function (id) {
      map.on("click", id, function (ev) {
        var p = ev.features[0].properties;
        if (p.title) showInfo(p.title, [p.text]);
      });
      map.on("mouseenter", id, function (ev) { if (ev.features[0].properties.title) map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", id, function () { map.getCanvas().style.cursor = ""; });
    });
  }
  if (map.isStyleLoaded()) addDrawing();
  else map.once("style.load", addDrawing);

  document.getElementById("map3d-reset").addEventListener("click", function () {
    map.easeTo({ center: camera.center, zoom: camera.zoom, pitch: camera.pitch, bearing: camera.bearing, duration: 800 });
  });

  // --- Redigering (?rediger) ---
  // Viser koordinatene der man klikker og utsnittet som `camera`, klare til å limes inn i tegningen.
  if (editing) {
    var round = function (n, d) { return Number(n.toFixed(d)); };
    var cameraJson = function () {
      var c = map.getCenter();
      return JSON.stringify({ center: [round(c.lng, 5), round(c.lat, 5)], zoom: round(map.getZoom(), 2), pitch: round(map.getPitch(), 0), bearing: round(map.getBearing(), 0) });
    };
    var panel = document.createElement("div");
    panel.className = "map3d-edit";
    panel.innerHTML = '<strong>Redigering</strong><span>Klikk i kartet for koordinater.</span><code data-edit="point">–</code>' +
      '<span>Utsnitt (camera):</span><code data-edit="camera"></code>';
    infoEl.parentNode.insertBefore(panel, infoEl);
    var pointEl = panel.querySelector('[data-edit="point"]'), cameraEl = panel.querySelector('[data-edit="camera"]');
    var updateCamera = function () { cameraEl.textContent = '"camera": ' + cameraJson(); };
    map.on("moveend", updateCamera);
    updateCamera();
    map.on("click", function (ev) { pointEl.textContent = "[" + round(ev.lngLat.lng, 5) + ", " + round(ev.lngLat.lat, 5) + "]"; });
  }
})();
