// «Piloter i lufta» on the maps: the paragliders (and speedflyers) the Open Glider Network hears in the area right now
// (FANET from varios and phone apps, FLARM), from the data service (/v1/live.json, workers/data/src/live.js). A layer
// that is off by default; while it is on and the page is in view, it asks every POLL_MS and moves the markers. Each
// marker is the wing seen from above, with the lines down to the pilot, pointing where it flies, with the height and the
// climb, and a line for its track over the last minutes (from the data service, so it shows at once), coloured by the
// climb at each point, so where the lift and the sink were is easy to see; a small legend explains the colours while the
// layer is on.
// Pilots who must not be identified are shown as «Ukjent». Built with DOM methods only; numbers only in the HTML.
// Exposed as window.FlyingSitesLive; tested in test/live.test.js.
(function () {
  "use strict";

  // Every 10 seconds: a paraglider moves 100–150 m in that time, and each ask counts against the data service's
  // requests per day (the data service keeps the answer as long, CACHE_SECONDS in workers/data/src/live.js).
  var POLL_MS = 10000;
  // The wing seen from above, nose up (north) before it is turned to the track: a paraglider's curved wing with the lines
  // down to the pilot. The data service sends only paragliders (OGN's type 7).
  var WING = '<path d="M0.8 11.2Q12 3 23.2 11.2Q22.6 12.9 21.4 13.1Q12 7.6 2.6 13.1Q1.4 12.9 0.8 11.2Z" fill="currentColor"/>' +
    '<path d="M2.6 12.8L12 17.6L21.4 12.8M7 9.6L12 17.6L17 9.6" fill="none" stroke="currentColor" stroke-width="0.8"/>' +
    '<circle cx="12" cy="17.8" r="2" fill="currentColor"/>';
  // The track's colours, by the climb in m/s, from sink to lift (CSS .live-trail--…). A paraglider sinks about 1 m/s in
  // still air, so plain gliding is the grey middle, not sink.
  var CLIMB = [{ key: "sink2", below: -3 }, { key: "sink1", below: -1.5 }, { key: "glide", below: 0.5 }, { key: "lift1", below: 2 }, { key: "lift2", below: Infinity }];
  var text = function (key, vars) { var FS = globalThis.FlyingSites; return FS && FS.t ? FS.t(key, vars) : key; };
  function useText(fn) { text = fn; }
  var isNum = function (v) { return typeof v === "number" && Number.isFinite(v); };

  // Only data in the expected shape: items with an id, a position and numbers or null.
  function isLiveData(d) {
    if (!d || d.dataset !== "live" || !Array.isArray(d.items)) return false;
    return d.items.every(function (i) {
      return i && typeof i.id === "string" && /^[0-9a-f]{6,16}$/.test(i.id) && isNum(i.lat) && isNum(i.lon) &&
        (i.name === null || typeof i.name === "string") && typeof i.time === "string" && Number.isFinite(Date.parse(i.time)) &&
        ["alt", "track", "speed", "climb", "type"].every(function (k) { return i[k] === null || isNum(i[k]); }) &&
        (i.trail === undefined || (Array.isArray(i.trail) && i.trail.every(function (p) {
          return Array.isArray(p) && isNum(p[0]) && isNum(p[1]) && (p[2] === undefined || p[2] === null || isNum(p[2]));
        })));
    });
  }
  // The colour of a climb (m/s): sink2 … lift2; glide when it is not known.
  function climbKey(v) {
    if (!isNum(v)) return "glide";
    for (var k = 0; k < CLIMB.length; k++) if (v < CLIMB[k].below) return CLIMB[k].key;
    return "lift2";
  }
  // The track ([[lat, lon, climb], ...], oldest first) as runs of one colour, [{ key, points }]: each piece takes the
  // colour of the climb where it ends, and the runs share their end points so the line is unbroken.
  function trailRuns(points) {
    var runs = [];
    for (var k = 1; k < points.length; k++) {
      var key = climbKey(points[k][2]), last = runs[runs.length - 1];
      var to = [points[k][0], points[k][1]];
      if (last && last.key === key) last.points.push(to);
      else runs.push({ key: key, points: [[points[k - 1][0], points[k - 1][1]], to] });
    }
    return runs;
  }
  // «+1,2» / «−0,8» / «0», the climb in m/s with a sign.
  function climbText(v) {
    var FS = globalThis.FlyingSites;
    if (!isNum(v)) return "";
    var r = Math.round(v * 10) / 10;
    return r === 0 ? "0" : (r > 0 ? "+" : "−") + FS.formatNumber(Math.abs(r), 1);
  }
  // The label beside the wing: «1240 m · +1,2».
  function labelText(item) {
    return [isNum(item.alt) ? text("live.alt", { m: Math.round(item.alt) }) : "", climbText(item.climb)].filter(Boolean).join(" · ");
  }
  function ageText(item, now) {
    var s = Math.max(0, Math.round((now - Date.parse(item.time)) / 1000));
    return s < 60 ? text("live.secondsAgo", { n: s }) : text("live.minutesAgo", { n: Math.round(s / 60) });
  }

  function make(tag, cls, content) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (content != null) n.textContent = content;
    return n;
  }
  function popup(item, now) {
    var box = make("div", "live-popup");
    box.appendChild(make("strong", null, item.name || text("live.unknown")));
    var lines = [];
    if (isNum(item.alt)) lines.push(text("live.altLine", { m: Math.round(item.alt) }));
    if (isNum(item.speed)) lines.push(text("live.speed", { kmh: Math.round(item.speed * 3.6) }));
    if (isNum(item.climb)) lines.push(text("live.climb", { v: climbText(item.climb) }));
    lines.forEach(function (l) { box.appendChild(make("span", null, l)); });
    box.appendChild(make("span", "live-popup__age", ageText(item, now)));
    return box;
  }

  // The legend for the track's colours, from sink to lift, under the layer button while the layer is on. Each colour has
  // its words for screen readers and as a tooltip, and the limits between them are written under the bar.
  function legendControl(L) {
    var control = L.control({ position: "topright" });
    control.onAdd = function () {
      var box = make("div", "live-legend");
      box.appendChild(make("span", "live-legend__title", text("live.legend")));
      var bar = make("ul", "live-legend__bar");
      CLIMB.forEach(function (c) {
        var li = make("li", "live-legend__step live-trail-swatch--" + c.key);
        li.title = text("live.climb_" + c.key);
        li.appendChild(make("span", "visually-hidden", text("live.climb_" + c.key)));
        bar.appendChild(li);
      });
      box.appendChild(bar);
      var ticks = make("div", "live-legend__ticks");
      ticks.setAttribute("aria-hidden", "true");
      CLIMB.slice(0, -1).forEach(function (c) { ticks.appendChild(make("span", null, (c.below > 0 ? "+" : "−") + globalThis.FlyingSites.formatNumber(Math.abs(c.below), c.below % 1 ? 1 : 0))); });
      box.appendChild(ticks);
      var ends = make("div", "live-legend__ends");
      ends.setAttribute("aria-hidden", "true");
      ends.appendChild(make("span", null, text("live.legendSink")));
      ends.appendChild(make("span", null, text("live.legendLift")));
      box.appendChild(ends);
      return box;
    };
    return control;
  }

  function addMapLayer(map, url) {
    var L = globalThis.L, FS = globalThis.FlyingSites;
    if (!L || !url || !map.layersControl) return null;
    var layer = L.layerGroup([], { attribution: text("live.credit") });
    map.layersControl.addOverlay(layer, FS.layerLabel(map, "live", text("live.layer")));
    var markers = {}, trails = {}, timer = null, on = false, legend = legendControl(L);

    function icon(item) {
      var shape = isNum(item.track)
        ? '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(' + Math.round(item.track) + ' 12 12)">' + WING + '</g></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>';
      return L.divIcon({ className: "live-marker",
        html: '<span class="live-marker__wing">' + shape + '</span><span class="live-marker__label"></span>', iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] });
    }
    function draw(data) {
      var now = Date.now(), seen = {};
      data.items.forEach(function (item) {
        seen[item.id] = true;
        // The track, ending at the marker, under it: a light edge under the whole line so every colour shows on the map,
        // then the runs of one colour.
        var points = (item.trail || []).concat([[item.lat, item.lon, item.climb]]);
        var group = trails[item.id] || (trails[item.id] = L.layerGroup().addTo(layer));
        group.clearLayers();
        if (points.length > 1) {
          group.addLayer(L.polyline(points.map(function (p) { return [p[0], p[1]]; }), { className: "live-trail-edge", weight: 8, interactive: false }));
          trailRuns(points).forEach(function (run) {
            group.addLayer(L.polyline(run.points, { className: "live-trail live-trail--" + run.key, weight: 4, interactive: false }));
          });
        }
        var m = markers[item.id];
        if (!m) {
          m = markers[item.id] = L.marker([item.lat, item.lon], { icon: icon(item), keyboard: true, title: item.name || text("live.unknown"), zIndexOffset: 1000 }).addTo(layer);
          m.bindPopup("");
        } else {
          m.setLatLng([item.lat, item.lon]);
          m.setIcon(icon(item));
        }
        var label = m.getElement() && m.getElement().querySelector(".live-marker__label");
        if (label) label.textContent = labelText(item);
        m.setPopupContent(popup(item, now));
      });
      Object.keys(markers).forEach(function (id) { if (!seen[id]) { layer.removeLayer(markers[id]); delete markers[id]; } });
      Object.keys(trails).forEach(function (id) { if (!seen[id]) { layer.removeLayer(trails[id]); delete trails[id]; } });
    }
    function load() {
      if (!on || document.hidden || typeof fetch !== "function") return;
      fetch(url, { credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (on && isLiveData(d)) draw(d); })
        .catch(function () {});
    }
    function start() { if (on) return; on = true; legend.addTo(map); load(); timer = setInterval(load, POLL_MS); }
    function stop() { on = false; legend.remove(); clearInterval(timer); timer = null; }
    map.on("overlayadd", function (ev) { if (ev.layer === layer) { start(); FS.track("map-layer/live"); } });
    map.on("overlayremove", function (ev) { if (ev.layer === layer) stop(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
    return layer;
  }

  globalThis.FlyingSitesLive = { addMapLayer: addMapLayer, isLiveData: isLiveData, labelText: labelText, climbKey: climbKey, trailRuns: trailRuns, climbText: climbText, useText: useText };
})();
