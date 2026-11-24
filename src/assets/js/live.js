// «Piloter i lufta» på kartene: paragliderne (og speedflyerne) Open Glider Network hører i området akkurat nå
// (FANET fra varioer og mobilapper, FLARM), fra datatjenesten (/v1/live.json, workers/data/src/live.js). Et lag
// som er av som standard. Mens det er på og siden er synlig, spør det hvert POLL_MS og flytter markørene. Hver
// markør er vingen sett ovenfra, med linene ned til piloten, pekende dit den flyr, med høyden og
// stigningen, og en strek for sporet de siste minuttene (fra datatjenesten, så det vises med en gang), farget etter
// stigningen i hvert punkt, så det er lett å se hvor løftet og synken var. En liten tegnforklaring forklarer fargene
// mens laget er på.
// Piloter som ikke skal kunne identifiseres, vises som «Ukjent». Bygges bare med DOM-metoder.
// Eksponert som window.FlyingSitesLive. Testet i test/live.test.js.
(function () {
  "use strict";

  // Hvert 10. sekund: en paraglider flytter seg 100–150 m på den tiden, og hver spørring teller mot datatjenestens
  // forespørsler per dag (datatjenesten holder på svaret like lenge, CACHE_SECONDS i workers/data/src/live.js).
  var POLL_MS = 10000;
  // Vingen sett ovenfra, med nesa opp (nord) før den snus etter sporet: en paragliders buede vinge med linene
  // ned til piloten. Datatjenesten sender bare paraglidere (OGNs type 7).
  // Delene som [tag, attributes], bygd med FlyingSites.svg.
  var WING = [
    ["path", { d: "M0.8 11.2Q12 3 23.2 11.2Q22.6 12.9 21.4 13.1Q12 7.6 2.6 13.1Q1.4 12.9 0.8 11.2Z", fill: "currentColor" }],
    ["path", { d: "M2.6 12.8L12 17.6L21.4 12.8M7 9.6L12 17.6L17 9.6", fill: "none", stroke: "currentColor", "stroke-width": "0.8" }],
    ["circle", { cx: "12", cy: "17.8", r: "2", fill: "currentColor" }],
  ];
  // Fargene på sporet etter stigningen i m/s, fra synk til løft (CSS .live-trail--…). En paraglider synker ca. 1 m/s i
  // stille luft, så vanlig gliding er den grå midten, ikke synk.
  var CLIMB = [{ key: "sink2", below: -3 }, { key: "sink1", below: -1.5 }, { key: "glide", below: 0.5 }, { key: "lift1", below: 2 }, { key: "lift2", below: Infinity }];
  var text = function (key, vars) { var FS = globalThis.FlyingSites; return FS && FS.t ? FS.t(key, vars) : key; };
  function useText(fn) { text = fn; }
  var isNum = function (v) { return typeof v === "number" && Number.isFinite(v); };

  // Bare data i forventet form: elementer med id, posisjon og tall eller null.
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
  // Fargen for en stigning (m/s): sink2 … lift2. glide når den ikke er kjent.
  function climbKey(v) {
    if (!isNum(v)) return "glide";
    for (var k = 0; k < CLIMB.length; k++) if (v < CLIMB[k].below) return CLIMB[k].key;
    return "lift2";
  }
  // Sporet ([[lat, lon, climb], ...], eldste først) som strekk med én farge, [{ key, points }]: hver bit får
  // fargen til stigningen der den slutter, og strekkene deler endepunkter, så streken er sammenhengende.
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
  // «+1,2» / «−0,8» / «0», stigningen i m/s med fortegn.
  function climbText(v) {
    var FS = globalThis.FlyingSites;
    if (!isNum(v)) return "";
    var r = Math.round(v * 10) / 10;
    return r === 0 ? "0" : (r > 0 ? "+" : "−") + FS.formatNumber(Math.abs(r), 1);
  }
  // Etiketten ved siden av vingen: «1240 m · +1,2».
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

  // Tegnforklaringen for fargene på sporet, fra synk til løft, under lagknappen mens laget er på. Hver farge har
  // ord for skjermlesere og som verktøytips, og grensene mellom dem står under stolpen.
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

  // existing: laget som allerede var i laglista da skriptet ble hentet ved første bruk (common.js lazyOverlays).
  // Det tas over, og når det allerede er på kartet, hentes pilotene med en gang.
  function addMapLayer(map, url, existing) {
    var L = globalThis.L, FS = globalThis.FlyingSites;
    if (!L || !url || !map.layersControl) return null;
    var layer = existing || L.layerGroup([], { attribution: text("live.credit") });
    if (!existing) map.layersControl.addOverlay(layer, FS.layerLabel(map, "live", text("live.layer")));
    var markers = {}, trails = {}, timer = null, on = false, legend = legendControl(L);

    // Det laget sier når pilotene ikke kan hentes (datatjenesten nede, eller uten nett): en boks med «Prøv
    // igjen», som for radaren og luftrommet (common.js), så et tomt kart aldri forveksles med en tom himmel.
    var statusEl = null;
    var Status = L.Control.extend({
      options: { position: "topright" },
      onAdd: function () {
        statusEl = make("div", "airspace-status live-status");
        statusEl.setAttribute("role", "status");
        statusEl.hidden = true;
        L.DomEvent.disableClickPropagation(statusEl);
        statusEl.addEventListener("click", function (ev) { if (ev.target.closest("[data-retry]")) load(); });
        return statusEl;
      },
    });
    function setStatus(failed) {
      if (!statusEl) return;
      statusEl.hidden = !failed;
      statusEl.classList.toggle("airspace-status--error", !!failed);
      statusEl.textContent = "";
      if (!failed) return;
      statusEl.appendChild(make("span", null, text("live.error")));
      var b = make("button", null, text("live.retry"));
      b.type = "button";
      b.setAttribute("data-retry", "");
      statusEl.appendChild(b);
    }

    function shape(item) {
      return isNum(item.track)
        ? FS.svg("svg", { width: 24, height: 24, viewBox: "0 0 24 24", "aria-hidden": "true" },
          FS.svg("g", { transform: "rotate(" + Math.round(item.track) + " 12 12)" }, WING.map(function (part) { return FS.svg(part[0], part[1]); })))
        : FS.svg("svg", { width: 14, height: 14, viewBox: "0 0 24 24", "aria-hidden": "true" }, FS.svg("circle", { cx: 12, cy: 12, r: 8, fill: "currentColor" }));
    }
    function icon(item) {
      return FS.divIcon({ className: "live-marker",
        content: function () { return FS.frag(FS.h("span", { class: "live-marker__wing" }, shape(item)), FS.h("span", { class: "live-marker__label" })); },
        iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] });
    }
    function draw(data) {
      var now = Date.now(), seen = {};
      data.items.forEach(function (item) {
        seen[item.id] = true;
        // Sporet, som slutter ved markøren, under den: en lys kant under hele streken så alle farger synes på kartet,
        // så strekkene med én farge.
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
          m.bindPopup(popup(item, now));
        } else {
          m.setLatLng([item.lat, item.lon]);
          m.setIcon(icon(item));
          m.setPopupContent(popup(item, now));
        }
        var label = m.getElement() && m.getElement().querySelector(".live-marker__label");
        if (label) label.textContent = labelText(item);
      });
      Object.keys(markers).forEach(function (id) { if (!seen[id]) { layer.removeLayer(markers[id]); delete markers[id]; } });
      Object.keys(trails).forEach(function (id) { if (!seen[id]) { layer.removeLayer(trails[id]); delete trails[id]; } });
    }
    var status = new Status();
    function load() {
      if (!on || document.hidden || typeof fetch !== "function") return;
      fetch(url, { credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!on) return;
          if (isLiveData(d)) { draw(d); setStatus(false); } else setStatus(true);
        })
        .catch(function () { if (on) setStatus(true); });
    }
    function start() { if (on) return; on = true; legend.addTo(map); status.addTo(map); load(); timer = setInterval(load, POLL_MS); }
    function stop() { on = false; legend.remove(); status.remove(); statusEl = null; clearInterval(timer); timer = null; }
    map.on("overlayadd", function (ev) { if (ev.layer === layer) { start(); FS.track("map-layer/live"); } });
    map.on("overlayremove", function (ev) { if (ev.layer === layer) stop(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
    if (map.hasLayer(layer)) { start(); FS.track("map-layer/live"); }
    return layer;
  }

  globalThis.FlyingSitesLive = { addMapLayer: addMapLayer, isLiveData: isLiveData, labelText: labelText, climbKey: climbKey, trailRuns: trailRuns, climbText: climbText, useText: useText };
})();
