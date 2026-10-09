// Felles for forsiden og stedssidene: tekster, kartlag og vindrose.
(function () {
  "use strict";

  // --- Tekster ---
  // Ordboken for sidens språk ligger i #i18n-data (base.njk, fra src/_i18n/<språk>.json): t("home.seeSite"),
  // t("home.closeCard", { name: "Elgen" }). tn() velger entall eller flertall: tn("summary.places", 3).
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

  // Samme stier som rose-makroen i src/_includes/macros.njk.
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

  // "primary" | "possible" | "none", som directionType i lib/format.js.
  function directionType(site, code) {
    if (site.primary.indexOf(code) !== -1) return "primary";
    if (site.possible.indexOf(code) !== -1) return "possible";
    return "none";
  }

  // wind (valgfri): { code, rating, edge } fra vindvurderingen. Sektoren vinden kommer fra fylles med
  // vurderingsfargen, så man ser om vinden treffer en startretning uten en egen pil. Med edge (markørene
  // på forsiden) går den fra midten helt ut til ringen rundt rosen; ellers (kortet) «løftes» den litt ut.
  var LIFT = 8;
  function roseSvg(site, size, labels, wind) {
    var lift = wind && !wind.edge;
    var viewBox = labels ? "-12 -12 184 184" : lift ? (18 - LIFT) + " " + (18 - LIFT) + " " + (124 + 2 * LIFT) + " " + (124 + 2 * LIFT) : "18 18 124 124";
    var svg = '<svg class="rose" width="' + size + '" height="' + size + '" viewBox="' + viewBox + '" aria-hidden="true">';
    var lifted = "";
    DIRECTIONS.forEach(function (code, i) {
      if (wind && wind.code === code) {
        if (wind.edge) {
          // Fra midten og helt ut til kanten (r = 62, der ringen rundt markøren ligger).
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
      svg += '<text x="80" y="2" text-anchor="middle">' + DIRECTION_LABELS.N + '</text><text x="80" y="168" text-anchor="middle">' + DIRECTION_LABELS.S + "</text>" +
        '<text x="-4" y="85" text-anchor="middle">' + DIRECTION_LABELS.W + '</text><text x="164" y="85" text-anchor="middle">' + DIRECTION_LABELS.E + "</text>";
    }
    return svg + "</svg>";
  }

  // En flis i laget under vises først når flisen over på samme sted er lastet. OpenTopoMap laster ofte raskere
  // enn Kartverket, så uten dette blinker OpenTopoMap fram før Kartverket legger seg over. Laget under har
  // maxNativeZoom 17, så på zoom 18 dekker én flis under fire fliser over.
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

  // Terrengskygge fra Kartverkets nasjonale høydemodell (hoydedata.no, åpne data), oppå bakgrunnskartet. Viser
  // fjellsidene og hvilken vei de vender. Tjenesten lager bilder for et utsnitt, ikke ferdige fliser, så hver
  // flis bes om med sitt eget utsnitt i Web Mercator. Bare Norge, gjennomsiktig ellers. Av som standard.
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

  function createMap(element, options) {
    var map = L.map(element, Object.assign({ scrollWheelZoom: true, zoomControl: true }, options || {}));
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
    // Kartverkets fliser er gjennomsiktige utenfor Norge, så OpenTopoMap under fyller ut resten av verden.
    var underlay = openTopoLayer();
    showUnderlayAfter(kartverket, underlay);
    var topo = L.layerGroup([underlay, kartverket]);
    // Satellittbilde fra Sentinel-2 cloudless (EOX), fritt for ikke-kommersiell bruk (CC BY-NC-SA 4.0) uten nøkkel.
    // 10 m oppløsning, så flisene finnes bare til zoom 14 og forstørres over det. Ikke invertert i mørkt tema.
    var satellite = L.tileLayer("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg", {
      maxNativeZoom: 14,
      maxZoom: 18,
      className: "photo-tiles",
      attribution: t("map.satelliteAttribution"),
    });
    // Kartverkets gråtonekart: roser, luftrom og vurderingsfarger synes bedre på grått. OpenTopoMap under, som for topo.
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
    baseLayers[t("map.layerTopo")] = topo;
    baseLayers[t("map.layerGray")] = gray;
    baseLayers[t("map.layerOpenTopo")] = openTopo;
    baseLayers[t("map.layerSatellite")] = satellite;
    map.layersControl = L.control.layers(baseLayers, null, { position: "topright" }).addTo(map);
    // Bare når noen velger et lag selv. Leaflet sender også baselayerchange når kartet lastes.
    map.layersControl.getContainer().addEventListener("change", function (ev) {
      if (!ev.target.checked) return;
      var label = ev.target.closest("label");
      track("kartlag/" + (label ? label.textContent.trim() : "ukjent"));
    });
    // Termikk fra thermal.kk7.ch: statistikk fra loggede flyturer, ikke et varsel. Av som standard.
    // Flisene er i TMS-rekkefølge, og src skal oppgi domenet vårt (vilkår på thermal.kk7.ch).
    ["skyways_all_all", "thermals_all_all"].forEach(function (name, i) {
      var layer = L.tileLayer("https://thermal.kk7.ch/tiles/" + name + "/{z}/{x}/{y}.png?src=" + encodeURIComponent(location.hostname), {
        tms: true, maxNativeZoom: 13, maxZoom: 18, opacity: 0.7,
        attribution: t("map.thermalAttribution"),
      });
      map.layersControl.addOverlay(layer, i ? t("map.layerThermals") : t("map.layerSkyways"));
    });
    map.layersControl.addOverlay(hillshadeLayer(), t("map.layerHillshade"));
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    return map;
  }

  // Leaflet må vite kartets størrelse før det zoomer til innholdet. Elementet kan ha null
  // størrelse når skriptet kjører (skjult fane, layout ikke ferdig), så vi venter på første
  // reelle størrelse og holder kartet oppdatert når den endres.
  // Knapper under zoomknappene: «Vis hele …» (hus) går tilbake til utsnittet fit() gir, og fullskjerm
  // legger kartet over hele siden. Ikke nettleserens fullskjerm, så det også virker på iPhone. Esc eller
  // knappen igjen lukker. Utsnittet tilpasses når kartet bytter størrelse. Brukes på forsiden og stedssiden.
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
          if (on) track("fullskjerm" + location.pathname);
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
    var done = false;
    map.setView([68.8, 16.4], 9);
    function check() {
      if (!element.clientWidth || !element.clientHeight) return;
      map.invalidateSize();
      if (!done) { done = true; fit(); }
    }
    if ("ResizeObserver" in window) new ResizeObserver(check).observe(element);
    else window.addEventListener("resize", check);
    check();
  }

  // --- Starter på stedssiden og i 3D-visningen ---
  // Starter med egen posisjon (launches[].lat/lon) får hver sin rose med sine retninger. Hovedstarten
  // (launch) viser retningene til startene uten egen posisjon, eller alle retningene når ingen har det.
  // Bare retninger stedet passer for (hovedretning eller mulig) tas med, så linjer som «ikke egnet,
  // men mulig i svak vind» ikke gir farge. En start uten slike retninger tegnes ikke.
  // data: { launch, launches, wind_directions }. Gir [{ lat, lon, directions, label, texts }].
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

  // --- Retningsbuer ---
  // Hvilke sider av fjellet stedet passer for: én gul bue per retning i wind_directions, med en pil ut.
  // Mørk gul er hovedretning, lys gul mulig. Brukes i kartet på stedssiden (ovenfra) og i 3D-visningen.
  // Har startene egne posisjoner (launches[].lat/lon), får hver retningsgruppe (starter med samme
  // retninger) sin egen bue der startene ligger: midt mellom dem, med radius til lengste start +
  // ARC_RADIUS_PLACED_M, så buen strekker seg langs siden mellom dem. Uten egne posisjoner er det én bue
  // rundt hovedstarten, eller rundt direction_arc i tegningen (<id>-drawing.geojson).
  // data: { launch, launches, wind_directions, drawing }. Koordinatene er [lon, lat].
  var ARC_COLORS = { primary: "#F2B705", possible: "#F8DC7A" };
  var ARC_RADIUS_M = 250, ARC_RADIUS_PLACED_M = 110, ARC_ARROW_M = 70;
  var BEARINGS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

  // Punkt `meters` fra [lon, lat] i retning `bearing` (grader, 0 er nord). Godt nok på korte avstander.
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

  // [{ direction, label, color, pts, bearing, center, radius, mid, tip }], én per retning og gruppe.
  // options.minRadius og options.arrow (meter) lar kartet holde buen synlig når man zoomer ut.
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

  // Pilspiss ved `tip` i retning `bearing`, som trekant i meter: [[lon, lat], ...].
  function arrowHead(tip, bearing, size) {
    var base = offset(tip, bearing + 180, size);
    return [tip, offset(base, bearing + 90, size * 0.6), offset(base, bearing - 90, size * 0.6), tip];
  }

  // --- Luftromslag ---
  // Fire grupper med av/på i kartets lagvelger, som i IPPC. Alle er av til å begynne med, og
  // luftrommene (fra openAIP, se scripts/update-airspace.mjs) lastes først når en gruppe slås på.
  var AIRSPACE_GROUPS = [
    { name: t("map.airspaceTma"), types: ["TMA", "CTA"], color: "#2F6FB5", dash: null },
    { name: t("map.airspaceCtr"), types: ["CTR", "MCTR", "ATZ", "TIZ"], color: "#C0392B", dash: null },
    { name: t("map.airspaceMilitary"), types: ["MTA", "TRA", "TSA"], color: "#7B3FA0", dash: "6 4" },
    { name: t("map.airspaceDanger"), types: ["D", "R", "P"], color: "#C24A12", dash: "6 4" },
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

  // Nedbørsradar fra RainViewer (gratis for ikke-kommersiell bruk, med kreditering). Lastes først når laget slås
  // på, og listen over bilder hentes på nytt hvert tiende minutt så lenge laget er på. Gratisversjonen har fliser
  // bare til zoom 7, så de forstørres når man zoomer inn: grovt, men nok til å se byger som kommer. De siste
  // bildene (10 minutter mellom hvert) vises som en kort animasjon som blir stående litt på det siste, med
  // klokkeslettet i en liten boks under lagvelgeren. MET sitt radarkart er forbeholdt Yr, så det kan vi ikke bruke.
  var RADAR_INDEX = "https://api.rainviewer.com/public/weather-maps.json";
  var RADAR_FRAMES = 6, RADAR_STEP_MS = 700, RADAR_HOLD_STEPS = 4;
  var osloClock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Oslo" });
  function addRadarLayer(map) {
    if (!map.layersControl) return;
    var group = L.layerGroup();
    map.layersControl.addOverlay(group, t("map.layerRadar"));
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
      // Går gjennom bildene og blir stående på det siste i noen steg før den starter på nytt.
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
      // Tidsgrense, så laget ikke blir stående på «Laster radar …» hvis RainViewer ikke svarer.
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
    groups.forEach(function (g) { map.layersControl.addOverlay(g.layer, g.def.name); });
    var loading = null, attribution = null, active = 0;

    // Status under lagvelgeren mens luftrommene lastes, og ved feil, så et avkrysset lag uten innhold ikke
    // ser ut som «ingen luftrom her». «Prøv igjen» henter på nytt.
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
          // Gjennomsiktig fyll, så kartet synes også der flere luftrom overlapper. Fyllet er likevel
          // klikkbart, og området lyser svakt opp når musen er over det.
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
        loading = null; // neste forsøk henter på nytt
        setStatus(active ? "error" : null);
      });
    }

    function isAirspace(layer) { return groups.some(function (g) { return g.layer === layer; }); }

    // Kreditering vises så lenge minst ett luftromslag er på.
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

  // Tall med språkets desimaltegn (komma på norsk).
  function formatNumber(n, decimals) {
    return Number(n).toFixed(decimals || 0).replace(".", I18N.meta.decimal);
  }

  function readJson(id) {
    var el = document.getElementById(id);
    return el ? JSON.parse(el.textContent) : null;
  }

  // Samme merking som external()-makroen i macros.njk.
  var EXTERNAL_MARK = '<svg class="external-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"></path><path d="M8 7h9v9"></path></svg><span class="visually-hidden"> ' + escapeHtml(I18N.opensNewTab || "") + "</span>";

  // --- Fargemodus ---
  // Skriptet i <head> (base.njk) setter data-theme før siden tegnes. Her kobles knappene til, og
  // siden følger med når enheten bytter mellom lys og mørk mens valget er «Auto».
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
    // Bilder med egen mørk variant, som Yr-meteogrammet. Den lyse adressen huskes i data-src-light.
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
      track("innstilling/tema/" + choice);
      try {
        if (choice === "auto") localStorage.removeItem("theme");
        else localStorage.setItem("theme", choice);
      } catch (e) {
        // privat modus eller blokkert lagring: valget gjelder bare denne siden
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

  // --- Fargeblindvennlige farger ---
  // Bytter vindvurderingen til blå / gul / oransjerød / grå (Okabe–Ito). Lagres som «cvd» i nettleseren.
  function applyCvd(on) {
    var root = document.documentElement;
    if (on) root.setAttribute("data-cvd", "on");
    else root.removeAttribute("data-cvd");
    document.querySelectorAll("[data-cvd-toggle]").forEach(function (b) { b.setAttribute("aria-checked", String(on)); });
  }
  document.querySelectorAll("[data-cvd-toggle]").forEach(function (button) {
    button.addEventListener("click", function () {
      var on = document.documentElement.getAttribute("data-cvd") !== "on";
      track("innstilling/fargeblindvennlig/" + (on ? "på" : "av"));
      try {
        if (on) localStorage.setItem("cvd", "on");
        else localStorage.removeItem("cvd");
      } catch (e) {
        // blokkert lagring: valget gjelder bare denne siden
      }
      applyCvd(on);
    });
  });
  applyCvd(document.documentElement.getAttribute("data-cvd") === "on");

  // --- Meny ---
  // Åpnes med knappen, lukkes med knappen, Escape eller klikk utenfor.
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

  // --- Besøksstatistikk for klikk ---
  // Telles som hendelser i GoatCounter (src/assets/js/goatcounter.js), med navn som «lenke/flightlog.org/flysteder/ryten/».
  // Gjør ingenting når skriptet ikke er lastet (lokalt, eller blokkert av adblock).
  function track(name, title) {
    var gc = window.goatcounter;
    if (gc && gc.count) gc.count({ path: name, title: title || name, event: true });
  }

  // Lenker ut (Flightlog, Yr, Windy, IPPC, veibeskrivelse …) og nedlastinger (GPX, GeoJSON, KML), på alle sider.
  // Midtklikk (auxclick) åpner i ny fane og telles også.
  function trackLink(ev) {
    var a = ev.target.closest && ev.target.closest("a[href]");
    if (!a) return;
    var text = a.textContent.trim().replace(/\s+/g, " ");
    if (a.hasAttribute("download")) track("nedlasting" + a.pathname, text + " (" + location.pathname + ")");
    else if (a.hostname && a.hostname !== location.hostname) track("lenke/" + a.hostname.replace(/^www\./, "") + location.pathname, text);
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
    DIRECTIONS: DIRECTIONS,
    DIRECTION_LABELS: DIRECTION_LABELS,
    directionType: directionType,
    roseSvg: roseSvg,
    launchPoints: launchPoints,
    directionArcs: directionArcs,
    arrowHead: arrowHead,
    offset: offset,
    createMap: createMap,
    addAirspaceLayers: addAirspaceLayers,
    addRadarLayer: addRadarLayer,
    fitWhenVisible: fitWhenVisible,
    addViewControls: addViewControls,
    escapeHtml: escapeHtml,
    formatNumber: formatNumber,
    readJson: readJson,
  };
})();
