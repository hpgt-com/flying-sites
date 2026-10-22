// «Prognose» on the home map: the forecast for the hours of the day, as map layers that follow the timeline, from the
// data service's grids (/v1/grid.json close around the sites and /v1/grid-wide.json over a wider area with Sweden,
// workers/data/src/sources/grid.js). Off by default; the grids are fetched the first time a layer is turned on.
//   termikk        the estimated thermal strength as coloured cells (as on RASP)
//   topp og skybase the top of the thermals «↑ 1200», or the cloud base «☁ 1100» when the thermals reach it (Cu)
//   vind           wind barbs as on RASP, at the ground or at about 750 m (925 hPa), with the speed in m/s
//   temperatur     the temperature at 2 m
//   lav sky og regn low cloud or fog as grey cells, rain as blue dots
// The thermal strength is Deardorff's w* from the sun on the ground and the boundary layer, the cloud base 125 m per
// degree between temperature and dew point: rough estimates, said so in the legend. A tap in the map gives all the
// numbers for the nearest point. Labels are thinned by distance on screen, the close grid first. Built with numbers and
// fixed strings only in the HTML. Exposed as window.FlyingSitesForecast; tested in test/forecast-layer.test.js.
(function () {
  "use strict";

  var text = function (key, vars) { var FS = globalThis.FlyingSites; return FS && FS.t ? FS.t(key, vars) : key; };
  function useText(fn) { text = fn; }
  var isNum = function (v) { return typeof v === "number" && Number.isFinite(v); };
  var KEYS = ["T", "Td", "ws", "wd", "ws9", "wd9", "blh", "cl", "pr", "sw"];
  // The thermal strength's colours in m/s (CSS .fc-legend__step--…, the same as the cells): below 1 m/s there is no cell.
  var SCALE = [{ key: "t1", below: 1.5 }, { key: "t2", below: 2 }, { key: "t3", below: 2.5 }, { key: "t4", below: 3 }, { key: "t5", below: Infinity }];
  var COLORS = { t1: "#4CC46A", t2: "#B9D94A", t3: "#EBD94A", t4: "#F2A23F", t5: "#E5535A" };
  var LAYERS = ["thermal", "top", "wind", "temp", "cloud"];
  // The space each label needs on screen (px): fewer labels when zoomed out, never on top of each other.
  var SPACING = { top: 52, wind: 60, windStack: 84, temp: 44, cloud: 30 };

  // Only data in the expected shape: a grid of rows × cols points, the hours as Unix times, and for each variable one
  // list per point with a number or null per hour.
  function isGridData(d) {
    if (!d || (d.dataset !== "grid" && d.dataset !== "grid-wide")) return false;
    if (![d.lat0, d.lon0, d.dLat, d.dLon].every(isNum) || !(d.dLat > 0) || !(d.dLon > 0)) return false;
    if (!Number.isInteger(d.rows) || !Number.isInteger(d.cols) || d.rows < 1 || d.cols < 1 || d.rows * d.cols > 5000) return false;
    var n = d.rows * d.cols;
    if (!Array.isArray(d.times) || !d.times.length || !d.times.every(isNum)) return false;
    if (!Array.isArray(d.elev) || d.elev.length !== n || !d.elev.every(isNum)) return false;
    if (!d.values || typeof d.values !== "object") return false;
    return KEYS.every(function (k) {
      var list = d.values[k];
      return Array.isArray(list) && list.length === n && list.every(function (hours) {
        return Array.isArray(hours) && hours.length === d.times.length && hours.every(function (v) { return v === null || isNum(v); });
      });
    });
  }

  // The hour in the grid that holds the time (ms): each value counts for one hour from its time. -1 outside the hours.
  function hourIndex(grid, ms) {
    for (var i = 0; i < grid.times.length; i++) if (ms >= grid.times[i] * 1000 && ms < grid.times[i] * 1000 + 3600000) return i;
    return -1;
  }

  // The point's position: points are row by row from the south.
  function pointAt(grid, i) {
    var row = Math.floor(i / grid.cols), col = i % grid.cols;
    return { lat: grid.lat0 + row * grid.dLat, lon: grid.lon0 + col * grid.dLon };
  }

  // The hour at a point: the values, and what is worked out from them. w* = (g/T · H/(ρ·cp) · zi)^(1/3), with the heat
  // into the air H about 0.4 × the sun on the ground, over land only (the sea is 0 m in the model). The thermals reach the
  // boundary layer's top; the cloud base is 125 m per degree between temperature and dew point, and when it is below the
  // top there are Cu, and the base is how high you get. Low cloud: most of the sky with a base under 300 m over the ground.
  function hourAt(grid, i, ti) {
    var v = function (k) { var x = grid.values[k][i][ti]; return isNum(x) ? x : null; };
    var elev = grid.elev[i], land = elev > 0;
    var T = v("T"), Td = v("Td"), zi = v("blh"), sw = v("sw"), cl = v("cl"), pr = v("pr");
    var heat = 0.4 * (sw || 0);
    var w = land && zi !== null && zi >= 150 && heat > 5 && T !== null ? Math.cbrt(9.81 / (T + 273.15) * heat / 1200 * zi) : 0;
    var base = T !== null && Td !== null ? Math.round((elev + 125 * Math.max(0, T - Td)) / 50) * 50 : null;
    var top = land && zi !== null ? Math.round((elev + zi) / 50) * 50 : null;
    var cu = w >= 0.8 && top !== null && base !== null && base < top;
    return {
      elev: elev, land: land, w: Math.round(w * 10) / 10, top: top, base: base, cu: cu, T: T, Td: Td, zi: zi, sw: sw, cl: cl, pr: pr,
      low: cl !== null && cl >= 80 && base !== null && base - elev < 300, rain: pr !== null && pr >= 0.3,
      ws: v("ws"), wd: v("wd"), ws9: v("ws9"), wd9: v("wd9"),
    };
  }

  function scaleKey(w) {
    if (!(w >= 1)) return null;
    for (var k = 0; k < SCALE.length; k++) if (w < SCALE[k].below) return SCALE[k].key;
    return "t5";
  }

  // A wind barb as on weather maps and RASP, in m/s: the staff points to where the wind comes from, with a half barb
  // for 2.5 m/s, a full one for 5 and a pennant for 25, on the clockwise side. Calm (under 1.25 m/s) is a ring.
  function barbSvg(dir, speed) {
    var head = '<svg width="56" height="56" viewBox="-28 -28 56 56" aria-hidden="true">';
    if (!isNum(speed) || !isNum(dir)) return "";
    if (speed < 1.25) return head + '<circle r="5" class="fc-barb__calm"/></svg>';
    var n = Math.round(speed / 2.5), pennants = Math.floor(n / 10), fulls = Math.floor((n % 10) / 2), half = n % 2;
    var L = 22, y = -L, parts = ["M0 0V" + -L];
    var flags = "";
    for (var p = 0; p < pennants; p++) { flags += "M0 " + y + "L9 " + (y - 2) + "L0 " + (y + 5) + "Z"; y += 6; }
    if (pennants && (fulls || half)) y += 1;
    for (var f = 0; f < fulls; f++) { parts.push("M0 " + y + "L10 " + (y - 4)); y += 4; }
    // A half barb alone sits a step in from the end, so it is not read as a full one.
    if (half) { if (!pennants && !fulls) y += 4; parts.push("M0 " + y + "L5 " + (y - 2)); }
    var d = parts.join("");
    return head + '<g transform="rotate(' + Math.round(dir) + ')">' +
      '<path class="fc-barb__halo" d="' + d + '"/>' + (flags ? '<path class="fc-barb__halo" d="' + flags + '"/>' : "") +
      '<path class="fc-barb__line" d="' + d + '"/>' + (flags ? '<path class="fc-barb__flag" d="' + flags + '"/>' : "") +
      '</g><circle r="2" class="fc-barb__dot"/></svg>';
  }

  // Where a stack of labels goes ({ x, y: [per row] } in px from the point): on the point without wind, otherwise out
  // on the side the wind blows to (the staff points to where it comes from), far enough that the whole stack clears
  // the station whichever way that is. rows: [{ size: [w, h] }].
  function stackAt(dir, rows) {
    var w = 0, h = 0;
    rows.forEach(function (r) { w = Math.max(w, r.size[0]); h += r.size[1]; });
    var cx = 0, cy = 0;
    if (isNum(dir)) {
      var a = dir * Math.PI / 180, ux = -Math.sin(a), uy = Math.cos(a), d = 8 + Math.abs(ux) * w / 2 + Math.abs(uy) * h / 2;
      cx = Math.round(ux * d) + 0; // + 0: no −0
      cy = Math.round(uy * d) + 0;
    }
    var y = cy - h / 2, ys = rows.map(function (r) { var mid = y + r.size[1] / 2; y += r.size[1]; return Math.round(mid); });
    return { x: cx, y: ys };
  }

  function formatTemp(T) {
    var r = Math.round(T);
    return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r) + "°";
  }
  function compass(dir) {
    var FS = globalThis.FlyingSites, codes = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    var code = codes[Math.round(((dir % 360) + 360) % 360 / 45) % 8];
    return (FS && FS.DIRECTION_LABELS && FS.DIRECTION_LABELS[code]) || code;
  }
  function number(v, d) { var FS = globalThis.FlyingSites; return FS && FS.formatNumber ? FS.formatNumber(v, d) : v.toFixed(d); }

  // The lines in the popup for an hour at a point: [label, value], only what is known.
  function popupRows(h) {
    var rows = [];
    rows.push([text("forecast.thermal"), h.land && h.w >= 1 ? text("forecast.ms", { v: number(h.w, 1) }) : text("forecast.noThermal")]);
    if (h.top !== null && h.w >= 1) rows.push([text("forecast.top"), text("forecast.masl", { m: h.cu ? h.base : h.top })]);
    if (h.base !== null) rows.push([text("forecast.base"), text("forecast.masl", { m: h.base }) + (h.cu ? " · " + text("forecast.cu") : "")]);
    if (h.T !== null) rows.push([text("forecast.temp"), formatTemp(h.T) + (h.Td !== null ? " · " + text("forecast.dew", { v: formatTemp(h.Td) }) : "")]);
    if (h.ws !== null && h.wd !== null) rows.push([text("forecast.windGround"), compass(h.wd) + " " + text("forecast.ms", { v: number(h.ws, 1) })]);
    if (h.ws9 !== null && h.wd9 !== null) rows.push([text("forecast.wind750"), compass(h.wd9) + " " + text("forecast.ms", { v: number(h.ws9, 1) })]);
    if (h.cl !== null) rows.push([text("forecast.lowCloud"), h.cl + " %"]);
    if (h.pr !== null) rows.push([text("forecast.rain"), text("forecast.mm", { v: number(h.pr, 1) })]);
    return rows;
  }

  function make(tag, cls, content) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (content != null) n.textContent = content;
    return n;
  }

  // The layers on a map. urls: { close, wide }. Returns { setTime(ms) } for the page's timeline, or null.
  // existing: the layers already in the layer list, keyed thermal … cloud, when this script was fetched on first use
  // (common.js lazyOverlays); they are taken over, and the ones on the map already are drawn at once.
  function addMapLayers(map, urls, existing) {
    var L = globalThis.L, FS = globalThis.FlyingSites;
    if (!L || !map.layersControl || !urls || !urls.close) return null;
    var attribution = text("forecast.credit");
    var layers = {}, on = {};
    var renderer = L.canvas({ padding: 0.2 });
    LAYERS.forEach(function (key) {
      layers[key] = (existing && existing[key]) || L.layerGroup([], { attribution: attribution });
      if (!existing || !existing[key]) map.layersControl.addOverlay(layers[key], FS.layerLabel(map, "forecast-" + key, text("forecast.layer_" + key)));
    });
    var grids = null, loading = null, failed = false, time = Date.now(), level = "750", moreOpen = null;
    var legend = legendControl();

    // The grids drawn, the close one on top of the wide one: the wide grid's points inside the close one are left out.
    // [{ grid, i, ti }] for the chosen time.
    function points() {
      var list = [];
      if (!grids) return list;
      var close = grids.close, box = close ? {
        s: close.lat0 - close.dLat / 2, n: close.lat0 + (close.rows - 0.5) * close.dLat,
        w: close.lon0 - close.dLon / 2, e: close.lon0 + (close.cols - 0.5) * close.dLon,
      } : null;
      [close, grids.wide].forEach(function (grid) {
        if (!grid) return;
        var ti = hourIndex(grid, time);
        if (ti < 0) return;
        for (var i = 0; i < grid.rows * grid.cols; i++) {
          var p = pointAt(grid, i);
          if (grid !== close && box && p.lat > box.s && p.lat < box.n && p.lon > box.w && p.lon < box.e) continue;
          list.push({ grid: grid, i: i, ti: ti, lat: p.lat, lon: p.lon, h: hourAt(grid, i, ti) });
        }
      });
      return list;
    }
    function cell(p, options) {
      var g = p.grid;
      return L.rectangle([[p.lat - g.dLat / 2, p.lon - g.dLon / 2], [p.lat + g.dLat / 2, p.lon + g.dLon / 2]],
        Object.assign({ renderer: renderer, stroke: false, interactive: false }, options));
    }
    // A label centred dx px to the right of the point and dy px below it.
    function label(p, cls, html, size, dx, dy) {
      return L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "fc-label " + cls, html: html, iconSize: size, iconAnchor: [size[0] / 2 - dx, size[1] / 2 - dy] }), interactive: false, keyboard: false });
    }
    function windOf(p) { return level === "750" ? { dir: p.h.wd9, speed: p.h.ws9 } : { dir: p.h.wd, speed: p.h.ws }; }
    // Labels far enough apart on screen, inside the view: the first point in each square of the given size.
    function thin(list, size, want) {
      var bounds = map.getBounds().pad(0.1), taken = {}, out = [];
      list.forEach(function (p) {
        if (!want(p) || !bounds.contains([p.lat, p.lon])) return;
        var xy = map.latLngToContainerPoint([p.lat, p.lon]), key = Math.floor(xy.x / size) + ":" + Math.floor(xy.y / size);
        if (taken[key]) return;
        taken[key] = true;
        out.push(p);
      });
      return out;
    }

    function render() {
      LAYERS.forEach(function (key) { layers[key].clearLayers(); });
      updateLegend();
      if (!grids) return;
      var list = points();
      if (on.thermal) list.forEach(function (p) {
        var key = scaleKey(p.h.w);
        if (key) layers.thermal.addLayer(cell(p, { fillColor: COLORS[key], fillOpacity: 0.5 }));
      });
      if (on.cloud) {
        list.forEach(function (p) { if (p.h.low) layers.cloud.addLayer(cell(p, { fillColor: "#7F9396", fillOpacity: 0.55 })); });
        thin(list, SPACING.cloud, function (p) { return p.h.rain; }).forEach(function (p) {
          var r = Math.min(9, 3 + p.h.pr * 2);
          layers.cloud.addLayer(label(p, "fc-rain", '<svg width="20" height="20" viewBox="-10 -10 20 20" aria-hidden="true"><circle r="' + r.toFixed(1) + '"/></svg>', [20, 20]));
        });
      }
      // The labels at the same points, thinned once. With the wind on, the barb is on the point and the speed, the top
      // and the temperature are stacked on the side the wind blows to, where the staff and its barbs never are; without
      // it, the top above the temperature on the point.
      var picked = thin(list, on.wind ? (on.top || on.temp ? SPACING.windStack : SPACING.wind) : on.top ? SPACING.top : SPACING.temp, function (p) {
        return (on.top && p.h.w >= 1 && p.h.top !== null) || (on.temp && p.h.T !== null) || (on.wind && windOf(p).speed !== null);
      });
      picked.forEach(function (p) {
        var wind = windOf(p), rows = [];
        if (on.wind && wind.speed !== null) {
          layers.wind.addLayer(label(p, "fc-barb", barbSvg(wind.dir, wind.speed), [56, 56], 0, 0));
          rows.push({ layer: layers.wind, html: '<b class="fc-speed">' + Math.round(wind.speed) + "</b>", size: [30, 16] });
        }
        if (on.top && p.h.w >= 1 && p.h.top !== null) {
          rows.push({ layer: layers.top, size: [60, 20], html: p.h.cu
            ? '<span class="fc-top fc-top--cu"><svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true"><path d="M3.5 9.5h7.5a2.5 2.5 0 0 0 .3-5A3.6 3.6 0 0 0 4.4 3.6 3 3 0 0 0 3.5 9.5z"/></svg>' + p.h.base + "</span>"
            : '<span class="fc-top">↑' + p.h.top + "</span>" });
        }
        if (on.temp && p.h.T !== null) {
          rows.push({ layer: layers.temp, size: [44, 20], html: '<span class="fc-temp ' + (p.h.T < 0 ? "fc-temp--cold" : "fc-temp--warm") + '">' + formatTemp(p.h.T) + "</span>" });
        }
        var at = stackAt(on.wind && wind.speed !== null ? wind.dir : null, rows);
        rows.forEach(function (r, k) { r.layer.addLayer(label(p, "", r.html, r.size, at.x, at.y[k])); });
      });
    }

    // The legend under the layer list while a layer is on: the time and source, then the keys for the layers on.
    function legendControl() {
      var control = L.control({ position: "topright" });
      control.onAdd = function () {
        var box = make("div", "fc-legend");
        L.DomEvent.disableClickPropagation(box);
        box.addEventListener("click", function (ev) {
          var b = ev.target.closest("[data-level]");
          if (b) { level = b.getAttribute("data-level"); render(); FS.track("map-layer/forecast-wind-" + level); }
          if (ev.target.closest("[data-retry]")) { failed = false; load(); }
        });
        return box;
      };
      return control;
    }
    function updateLegend() {
      var box = legend.getContainer();
      if (!box) return;
      box.replaceChildren();
      var status = make("p", "fc-legend__status");
      status.setAttribute("role", "status");
      box.appendChild(status);
      if (failed) {
        status.textContent = text("forecast.error") + " ";
        var retry = make("button", null, text("forecast.retry"));
        retry.type = "button";
        retry.setAttribute("data-retry", "");
        status.appendChild(retry);
        return;
      }
      if (!grids) { status.textContent = text("forecast.loading"); return; }
      var ti = hourIndex(grids.close || grids.wide, time);
      if (ti < 0) { status.textContent = text("forecast.noHour"); return; }
      status.textContent = text("forecast.at", { time: clock(time) });
      if (on.thermal) {
        box.appendChild(make("span", "fc-legend__title", text("forecast.legendThermal")));
        var bar = make("ul", "fc-legend__bar");
        SCALE.forEach(function (s, k) {
          var li = make("li", "fc-legend__step fc-legend__step--" + s.key);
          var from = k ? SCALE[k - 1].below : 1;
          li.appendChild(make("span", null, (isFinite(s.below) ? "" : "> ") + number(from, from % 1 ? 1 : 0)));
          bar.appendChild(li);
        });
        box.appendChild(bar);
      }
      if (on.wind) {
        var levels = make("div", "fc-legend__levels");
        levels.setAttribute("role", "group");
        levels.setAttribute("aria-label", text("forecast.level"));
        [["ground", text("forecast.levelGround")], ["750", text("forecast.level750")]].forEach(function (l) {
          var b = make("button", null, l[1]);
          b.type = "button";
          b.setAttribute("data-level", l[0]);
          b.setAttribute("aria-pressed", String(level === l[0]));
          levels.appendChild(b);
        });
        box.appendChild(levels);
      }
      // The keys in words, folded away on a phone (open on a wide screen, and as the reader left them).
      var more = make("details", "fc-legend__more");
      if (moreOpen === null) moreOpen = !(typeof matchMedia === "function" && matchMedia("(max-width: 600px)").matches);
      more.open = moreOpen;
      more.addEventListener("toggle", function () { moreOpen = more.open; });
      more.appendChild(make("summary", null, text("forecast.keys")));
      var keys = make("div", "fc-legend__keys");
      if (on.top) {
        keys.appendChild(make("span", null, text("forecast.keyTop")));
        keys.appendChild(make("span", null, text("forecast.keyCu")));
      }
      if (on.cloud) {
        keys.appendChild(make("span", "fc-legend__key fc-legend__key--low", text("forecast.keyLow")));
        keys.appendChild(make("span", "fc-legend__key fc-legend__key--rain", text("forecast.keyRain")));
      }
      if (on.wind) keys.appendChild(make("span", null, text("forecast.keyBarb")));
      keys.appendChild(make("span", "fc-legend__note", text("forecast.note")));
      more.appendChild(keys);
      box.appendChild(more);
    }
    // «tir. 14.00»: the weekday too, as the timeline goes days ahead.
    var dayFormat = new Intl.DateTimeFormat(FS.lang === "nb" ? "nb-NO" : "en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Oslo" });
    function clock(ms) {
      var parts = {};
      dayFormat.formatToParts(ms).forEach(function (p) { parts[p.type] = p.value; });
      return parts.weekday.replace(/\.$/, "") + ". " + parts.hour + ((FS.meta && FS.meta.clockSep) || ".") + parts.minute;
    }

    function get(url) {
      if (!url) return Promise.resolve(null);
      return fetch(url, { credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return isGridData(d) ? d : null; })
        .catch(function () { return null; });
    }
    function load() {
      if (grids || loading || typeof fetch !== "function") return;
      updateLegend();
      loading = Promise.all([get(urls.close), get(urls.wide)]).then(function (both) {
        loading = null;
        if (!both[0] && !both[1]) { failed = true; render(); return; }
        grids = { close: both[0], wide: both[1] };
        render();
      });
    }
    function anyOn() { return LAYERS.some(function (k) { return on[k]; }); }

    function switched(key, isOn) {
      on[key] = isOn;
      if (anyOn()) { legend.addTo(map); load(); } else legend.remove();
      if (isOn) FS.track("map-layer/forecast-" + key);
      render();
    }
    map.on("overlayadd overlayremove", function (ev) {
      var key = LAYERS.filter(function (k) { return layers[k] === ev.layer; })[0];
      if (key) switched(key, ev.type === "overlayadd");
    });
    LAYERS.forEach(function (key) { if (map.hasLayer(layers[key])) switched(key, true); });
    map.on("zoomend moveend", function () { if (anyOn()) render(); });

    // A tap in the map while a layer is on: all the numbers for the nearest point at the chosen time.
    var popup = L.popup({ maxWidth: 260 });
    map.on("click", function (ev) {
      if (!anyOn() || !grids) return;
      var best = null, bd = Infinity, cos = Math.cos(ev.latlng.lat * Math.PI / 180);
      points().forEach(function (p) {
        var d = Math.pow(p.lat - ev.latlng.lat, 2) + Math.pow((p.lon - ev.latlng.lng) * cos, 2);
        if (d < bd) { bd = d; best = p; }
      });
      if (!best || bd > Math.pow(best.grid.dLat, 2) * 4) return;
      var box = make("div", "fc-popup");
      box.appendChild(make("strong", null, text("forecast.popupTitle", { time: clock(time) })));
      var table = make("table");
      popupRows(best.h).forEach(function (r) {
        var tr = make("tr");
        tr.appendChild(make("th", null, r[0]));
        tr.appendChild(make("td", null, r[1]));
        table.appendChild(tr);
      });
      box.appendChild(table);
      box.appendChild(make("p", "fc-popup__note", text("forecast.popupNote", { m: best.h.elev })));
      popup.setLatLng(ev.latlng).setContent(box).openOn(map);
    });

    return {
      setTime: function (ms) {
        if (!isNum(ms) || ms === time) return;
        time = ms;
        if (anyOn()) render();
      },
    };
  }

  globalThis.FlyingSitesForecast = {
    addMapLayers: addMapLayers, isGridData: isGridData, hourIndex: hourIndex, hourAt: hourAt, pointAt: pointAt,
    barbSvg: barbSvg, stackAt: stackAt, scaleKey: scaleKey, popupRows: popupRows, formatTemp: formatTemp, useText: useText,
  };
})();
