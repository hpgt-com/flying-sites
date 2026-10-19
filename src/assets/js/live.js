// «Piloter i lufta» on the maps: the aircraft the Open Glider Network hears in the area right now (FANET from
// paragliders' varios, FLARM and others), from the data service (/v1/live.json, workers/data/src/live.js). A layer that
// is off by default; while it is on and the page is in view, it asks every POLL_MS and moves the markers. Each marker is
// an arrow pointing where the aircraft flies, with the height and the climb; paragliders and hang gliders stand out.
// Pilots who must not be identified are shown as «Ukjent». Built with DOM methods only; numbers only in the HTML.
// Exposed as window.FlyingSitesLive; tested in test/live.test.js.
(function () {
  "use strict";

  var POLL_MS = 5000;
  // OGN's aircraft types (0 unknown … 13 drone); 6 and 7 are hang gliders and paragliders.
  var TYPES = { 1: "glider", 2: "tow", 3: "heli", 4: "parachute", 5: "dropPlane", 6: "hangGlider", 7: "paraglider", 8: "plane", 9: "jet", 11: "balloon", 13: "drone" };
  var text = function (key, vars) { var FS = globalThis.FlyingSites; return FS && FS.t ? FS.t(key, vars) : key; };
  function useText(fn) { text = fn; }
  var isNum = function (v) { return typeof v === "number" && Number.isFinite(v); };

  // Only data in the expected shape: items with an id, a position and numbers or null.
  function isLiveData(d) {
    if (!d || d.dataset !== "live" || !Array.isArray(d.items)) return false;
    return d.items.every(function (i) {
      return i && typeof i.id === "string" && /^[0-9a-f]{6,16}$/.test(i.id) && isNum(i.lat) && isNum(i.lon) &&
        (i.name === null || typeof i.name === "string") && typeof i.time === "string" && Number.isFinite(Date.parse(i.time)) &&
        ["alt", "track", "speed", "climb", "type"].every(function (k) { return i[k] === null || isNum(i[k]); });
    });
  }
  function isFlyer(item) { return item.type === 6 || item.type === 7; }
  function typeText(item) { return text("live.type_" + (TYPES[item.type] || "other")); }
  // «+1,2» / «−0,8» / «0», the climb in m/s with a sign.
  function climbText(v) {
    var FS = globalThis.FlyingSites;
    if (!isNum(v)) return "";
    var r = Math.round(v * 10) / 10;
    return r === 0 ? "0" : (r > 0 ? "+" : "−") + FS.formatNumber(Math.abs(r), 1);
  }
  // The label beside the arrow: «1240 m · +1,2».
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
    box.appendChild(make("span", null, typeText(item)));
    var lines = [];
    if (isNum(item.alt)) lines.push(text("live.altLine", { m: Math.round(item.alt) }));
    if (isNum(item.speed)) lines.push(text("live.speed", { kmh: Math.round(item.speed * 3.6) }));
    if (isNum(item.climb)) lines.push(text("live.climb", { v: climbText(item.climb) }));
    lines.forEach(function (l) { box.appendChild(make("span", null, l)); });
    box.appendChild(make("span", "live-popup__age", ageText(item, now)));
    return box;
  }

  function addMapLayer(map, url) {
    var L = globalThis.L, FS = globalThis.FlyingSites;
    if (!L || !url || !map.layersControl) return null;
    var layer = L.layerGroup([], { attribution: text("live.credit") });
    map.layersControl.addOverlay(layer, FS.layerLabel(map, "live", text("live.layer")));
    var markers = {}, timer = null, on = false;

    function icon(item) {
      var arrow = isNum(item.track)
        ? '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style="transform: rotate(' + Math.round(item.track) + 'deg)"><path d="M12 2l7 18-7-4-7 4z" fill="currentColor"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>';
      return L.divIcon({ className: "live-marker" + (isFlyer(item) ? " live-marker--flyer" : ""),
        html: '<span class="live-marker__arrow">' + arrow + '</span><span class="live-marker__label"></span>', iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] });
    }
    function draw(data) {
      var now = Date.now(), seen = {};
      data.items.forEach(function (item) {
        seen[item.id] = true;
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
    }
    function load() {
      if (!on || document.hidden || typeof fetch !== "function") return;
      fetch(url, { credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (on && isLiveData(d)) draw(d); })
        .catch(function () {});
    }
    function start() { if (on) return; on = true; load(); timer = setInterval(load, POLL_MS); }
    function stop() { on = false; clearInterval(timer); timer = null; }
    map.on("overlayadd", function (ev) { if (ev.layer === layer) { start(); FS.track("map-layer/live"); } });
    map.on("overlayremove", function (ev) { if (ev.layer === layer) stop(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
    return layer;
  }

  globalThis.FlyingSitesLive = { addMapLayer: addMapLayer, isLiveData: isLiveData, labelText: labelText, climbText: climbText, typeText: typeText, useText: useText };
})();
