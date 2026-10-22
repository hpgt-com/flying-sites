// Home page: filters, map with wind roses, wind assessment from the forecast at the time chosen in the timeline, the
// selected site and list. On mobile the map stays at the top of the screen and shrinks while the list scrolls.
(function () {
  "use strict";

  var FS = window.FlyingSites;
  var sites = FS.readJson("sites-data") || [];
  var LEVELS = ["PP2", "PP3", "PP4", "PP5"];
  // directions: the wind directions chosen in the filter rose. A site matches when it suits one of them.
  var filter = { directions: [], level: "", category: "", q: "" };
  var MOBILE = window.matchMedia("(max-width: 1099px)");

  // --- Search by name and place ---
  // Lowercase and without accents. Æ, ø and å can be typed in all common ways without a Norwegian keyboard:
  // «kvaefjord» and «kvafjord» find Kvæfjord, «hoegfjellet» and «hogfjellet» Høgfjellet, «blaahatten» and
  // «blahatten» Blåhatten. Name and query are normalised the same way (æ, ae → a; ø, oe → o; å, aa → a),
  // so it may give an extra hit, but never lose one. Spaces and hyphens do not count. Matches anywhere
  // in the name («solli» → Sollifjellet), or in the municipality or region («kvæfjord», «lofoten»). Names
  // and places are checked separately, so a query cannot match across the join between them.
  function searchKey(s) {
    return String(s || "").toLowerCase()
      .replace(/æ/g, "a").replace(/ø/g, "o").replace(/å/g, "a")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[\s\-–]+/g, "")
      .replace(/ae/g, "a").replace(/oe/g, "o").replace(/aa/g, "a");
  }
  sites.forEach(function (site) {
    site.searchKeys = [site.name].concat(site.places || []).map(searchKey);
    site.all = { primary: site.primary, possible: site.possible };
  });

  // With a category selected, the launches for that category apply: SPG at Elgen only launches NE–SW, even though
  // PG launches in all directions. site.primary/possible are swapped, so the direction filter, wind rose and
  // wind assessment use the same directions. Without a category, or without its own launches, the whole site applies.
  function applyCategory() {
    sites.forEach(function (site) {
      var own = filter.category && site.byCategory && site.byCategory[filter.category];
      site.primary = own ? own.primary : site.all.primary;
      site.possible = own ? own.possible : site.all.possible;
    });
  }
  function nameMatches(site) {
    var q = searchKey(filter.q);
    return !q || site.searchKeys.some(function (key) { return key.indexOf(q) !== -1; });
  }
  var selectedId = null;
  var markers = {};

  // "match", "unknown" or "no". The level filter shows sites for the selected level and lower (a PP3 pilot can
  // fly PP2 sites). Sites without a registered level are not hidden, but get "unknown" and are shown separately, since
  // most sites do not have a level yet and an empty result would otherwise look like «ingen steder».
  // With forecast suggestions on («Vis bare steder som kan passe»), sites rated
  // «Passer ikke» or «For mye vind» are dimmed, as when choosing a direction. «Kan passe» and «Usikkert»
  // stay. Sites without a forecast (the fetch failed for the site) do not disappear, but get "nowind" and are shown
  // separately under «Mangler varsel – ikke vurdert», so they do not look assessed.
  var suggest = false;
  function matches(site, assessment, windAssessed, ignoreSuggest) {
    if (!nameMatches(site)) return "no";
    if (suggest && !ignoreSuggest && assessment && (assessment.rating === "no" || assessment.rating === "high")) return "no";
    if (filter.directions.length && !filter.directions.some(function (d) { return site.primary.indexOf(d) !== -1 || site.possible.indexOf(d) !== -1; })) return "no";
    if (filter.category && site.categories.indexOf(filter.category) === -1) return "no";
    if (filter.level && site.level && LEVELS.indexOf(site.level) > LEVELS.indexOf(filter.level)) return "no";
    if (suggest && !ignoreSuggest && windAssessed && !assessment) return "nowind";
    if (filter.level && !site.level) return "unknown";
    return "match";
  }
  // Groups shown separately at the bottom of the list and slightly dimmed on the map.
  var WEAK = { unknown: true, nowind: true };

  function directionBadges(site) {
    return FS.DIRECTIONS.filter(function (code) { return FS.directionType(site, code) !== "none"; })
      .map(function (code) {
        var active = filter.directions.indexOf(code) !== -1 ? " direction--active" : "";
        return '<span class="direction direction--' + FS.directionType(site, code) + active + '">' + FS.DIRECTION_LABELS[code] + "</span>";
      }).join("");
  }

  function tags(site) {
    var e = FS.escapeHtml;
    var html = site.level ? '<span class="tag">' + site.level + "</span>" : '<span class="tag tag--missing">' + e(FS.t("home.levelNotSet")) + "</span>";
    if (site.trainingSite) html += '<span class="tag">' + e(FS.t("home.trainingSite")) + "</span>";
    site.categories.forEach(function (c) { html += '<span class="tag">' + c + "</span>"; });
    if (!site.reviewed) html += '<span class="tag tag--warning">' + e(FS.t("home.notReviewed")) + "</span>";
    return html;
  }

  // --- Wind assessment from the MET forecast ---
  // The logic is in wind.js. Here the time is chosen, and the result is shown in the map, list and card.
  var W = window.FlyingSitesWind;
  var RATINGS = W.RATINGS;
  var fc = FS.readJson("forecast-data") || {};
  var rules = fc.rules;
  var forecast = fc.forecast || null;
  var forecastStatusEl = document.getElementById("forecast-status");
  // If the forecast is too old (the scheduled build has stopped, or the page is saved in the browser),
  // the wind assessment is turned off with an explanation. The age is rechecked before each assessment, when
  // returning to the tab and every minute, so a tab left open for hours does not show stale assessments.
  var stale = false;
  // The chosen time as hours from now ("0", "1" … as far as the forecast goes), from the timeline. "off" without a
  // forecast, or when it is too old.
  var windSlot = forecast ? "0" : "off";
  var windIndex = -1; // forecast index for the chosen time, set by assessAll()
  var dayShort = new Intl.DateTimeFormat(FS.lang === "nb" ? "nb-NO" : "en-GB", { weekday: "short", timeZone: "Europe/Oslo" });
  // «nå», «kl. 17.00», «i morgen kl. 09.00» or «søn. kl. 13.00», for the forecast hour at index.
  function whenLabel(index) {
    if (windSlot === "0") return FS.t("home.whenNow");
    var ms = Date.parse(forecast.times[index]);
    var day = W.osloParts(ms).date, today = W.osloParts(Date.now()).date, time = W.formatClock(ms);
    if (day === today) return FS.t("home.whenToday", { time: time });
    if (day === W.osloParts(Date.now() + 86400000).date) return FS.t("home.whenTomorrow", { time: time });
    return FS.t("home.whenDay", { day: dayShort.format(ms).replace(/\.$/, "") + ".", time: time });
  }

  // «i dag kl. 08:47», or «16.10 kl. 23:47» for another day.
  function whenText(iso) {
    var ms = Date.parse(iso);
    var today = W.osloParts(Date.now()).date, day = W.osloParts(ms).date;
    return (day === today ? FS.t("wind.today") : day.slice(8, 10) + "." + day.slice(5, 7)) + " " + FS.t("wind.at", { time: W.formatClock(ms) });
  }
  function fetchedText() { return whenText(forecast.fetched); }

  // Returns true when the forecast has just become too old, so the caller can redraw the page.
  function checkStale() {
    if (!forecast || stale || !W.isStale(forecast, rules, Date.now())) return false;
    stale = true;
    windSlot = "off";
    suggest = false;
    if (timelineEl) timelineEl.hidden = true;
    if (suggestButton) suggestButton.hidden = true;
    forecastStatusEl.innerHTML = "<strong>" + FS.escapeHtml(FS.t("wind.staleTitle")) + "</strong> " + FS.escapeHtml(FS.t("wind.staleHome", { when: fetchedText() }));
    return true;
  }

  // Text below the wind selector: when the forecast was fetched, and which time the assessment applies to.
  function updateForecastStatus(index) {
    if (!forecast || stale) return;
    // MET's own update time (the model run) when the forecast has it, as well as when it was fetched.
    var text = FS.escapeHtml(Number.isFinite(Date.parse(forecast.updated))
      ? FS.t("wind.fetchedUpdated", { updated: whenText(forecast.updated), when: fetchedText() })
      : FS.t("wind.fetched", { when: fetchedText() }));
    if (windSlot !== "off") {
      text = index < 0
        ? "<strong>" + FS.escapeHtml(FS.t("wind.notCovered")) + "</strong> " + text
        : FS.escapeHtml(FS.t("wind.showingWhen", { when: whenLabel(index) }) + (W.stepAt(forecast.times, index) > 3600000 ? " " + FS.t("home.coarse") : "")) + " " + text;
    }
    forecastStatusEl.innerHTML = text + sunLine(index);
  }
  // Sunrise and sunset in the middle of the home region, for the day shown (today when wind is off). The difference
  // between launches in the region is a few minutes.
  function sunLine(index) {
    if (!bounds.length) return "";
    var lat = 0, lon = 0;
    bounds.forEach(function (b) { lat += b[0] / bounds.length; lon += b[1] / bounds.length; });
    var date = W.osloParts(index >= 0 ? Date.parse(forecast.times[index]) : Date.now()).date;
    return " " + FS.escapeHtml(W.sunText(date, lat, lon));
  }

  // --- Summary ---
  // Wind in the area (most common direction, median mean wind, highest gust) and how many sites get
  // each rating, with the most common reason. Explains why no sites suit on a windy day.
  var summaryEl = document.getElementById("wind-summary");
  // ids: the sites the summary covers (those matching the filters).
  function summarize(assessments, ids) {
    var list = ids.filter(function (id) { return assessments[id]; }).map(function (id) { return assessments[id]; });
    if (!list.length) return null;
    var dirs = {}, speeds = [], maxGust = null;
    var counts = { ok: 0, maybe: 0, high: 0, no: 0 }, highByGust = 0, highByLocal = 0, noByRain = 0;
    list.forEach(function (a) {
      var code = W.directionCode(a.wind.dir);
      dirs[code] = (dirs[code] || 0) + 1;
      speeds.push(a.wind.speed);
      if (a.wind.gust != null && (maxGust == null || a.wind.gust > maxGust)) maxGust = a.wind.gust;
      counts[a.rating]++;
      // Reason from the code (wind.js), not the text, so it works in all languages.
      if (a.rating === "high") {
        if (a.codes[0] === "gust") highByGust++;
        else if (a.codes[0] === "overSiteLimit") highByLocal++;
      }
      if (a.rating === "no" && a.codes[0] === "rain") noByRain++;
    });
    speeds.sort(function (x, y) { return x - y; });
    var mainDir = Object.keys(dirs).sort(function (x, y) { return dirs[y] - dirs[x]; })[0];
    return { counts: counts, total: list.length, missing: ids.length - list.length, filtered: ids.length < sites.length, highByGust: highByGust, highByLocal: highByLocal, noByRain: noByRain,
      dir: mainDir, speed: speeds[Math.floor(speeds.length / 2)], minSpeed: speeds[0], maxSpeed: speeds[speeds.length - 1], gust: maxGust };
  }
  function places(n) { return FS.tn("summary.places", n); }
  function maybeLabel(n) { return FS.tn("summary.maybe", n); }
  function renderSummary(sum) {
    if (!summaryEl) return;
    summaryEl.hidden = !sum;
    if (!sum) { summaryEl.innerHTML = ""; return; }
    var c = sum.counts, parts = [];
    if (c.ok) parts.push(c.ok + " " + FS.t("summary.ok"));
    if (c.maybe) parts.push(c.maybe + " " + maybeLabel(c.maybe));
    if (c.high) {
      var why = [];
      if (sum.highByGust) why.push(FS.t("summary.highByGust", { n: sum.highByGust }));
      if (sum.highByLocal) why.push(FS.t("summary.highByLocal", { n: sum.highByLocal }));
      parts.push(c.high + " " + FS.t("summary.high") + (why.length ? " (" + why.join(", ") + ")" : ""));
    }
    if (c.no - sum.noByRain) parts.push((c.no - sum.noByRain) + " " + FS.t("summary.wrongDirection"));
    if (sum.noByRain) parts.push(sum.noByRain + " " + FS.t("summary.rain"));
    var wind = FS.t("summary.wind", {
      dir: FS.DIRECTION_LABELS[sum.dir],
      speed: Math.round(sum.minSpeed) === Math.round(sum.maxSpeed) ? Math.round(sum.speed) : Math.round(sum.minSpeed) + "–" + Math.round(sum.maxSpeed),
      gust: sum.gust != null ? FS.t("summary.gustUpTo", { g: Math.round(sum.gust) }) : "",
    });
    // As in the prototype: wind line, colour bar with the distribution and count per rating with coloured dots.
    // Details (gusts, the site's own limit, missing forecast) are in the line's tooltip.
    var detail = places(sum.total) + (sum.filtered ? FS.t("summary.matchingFilters") : "") + ": " + parts.join(", ") + "." +
      (sum.missing ? " " + FS.t("summary.missingNotAssessed", { places: places(sum.missing) }) : "");
    // [rating, count, text]. «Passer ikke» is split into wrong direction and rain, so the reason shows.
    var order = [["ok", c.ok, FS.t("summary.ok")], ["maybe", c.maybe, maybeLabel(c.maybe)], ["high", c.high, FS.t("summary.high")],
      ["no", c.no - sum.noByRain, FS.t("summary.wrongDirection")], ["no", sum.noByRain, FS.t("summary.rain")]];
    var bar = order.map(function (o) {
      return o[1] ? '<span class="wind-bar__part wind-dot--' + o[0] + '" data-grow="' + o[1] + '"></span>' : "";
    }).join("");
    var chips = order.map(function (o) {
      return o[1] ? '<span><span class="wind-dot wind-dot--' + o[0] + '"></span>' + o[1] + " " + FS.escapeHtml(o[2]) + "</span>" : "";
    }).join("");
    summaryEl.innerHTML = '<p class="wind-summary__wind">' + FS.escapeHtml(wind) + "</p>" +
      '<div class="wind-bar" role="img" aria-label="' + FS.escapeHtml(detail) + '" title="' + FS.escapeHtml(detail) + '">' + bar + "</div>" +
      (sum.filtered ? '<p class="wind-summary__scope">' + FS.escapeHtml(FS.t("summary.scope", { places: places(sum.total + sum.missing) })) + "</p>" : "") +
      '<p class="wind-summary__counts">' + chips + "</p>" +
      (sum.missing ? '<p class="wind-summary__missing">' + FS.escapeHtml(FS.t("summary.missing", { places: places(sum.missing) })) + "</p>" : "") +
      (c.ok + c.maybe === 0 ? '<p class="wind-summary__none">' + FS.escapeHtml(FS.t("summary.noneCanWork") + " " + noneReason(sum)) + "</p>" : "");
    // The parts' widths set on the elements, not in the HTML: the page allows no inline styles (CSP style-src 'self').
    summaryEl.querySelectorAll(".wind-bar__part").forEach(function (el) { el.style.flexGrow = el.getAttribute("data-grow"); });
  }
  // The pill on the map: how many sites may work at the chosen time, with the best rating found, and the most common
  // direction («✓ 3 kan passe · mest NV»). The details open below it. Without wind, how many sites are shown.
  var statusEl = document.getElementById("map-status");
  var statusTextEl = document.getElementById("map-count");
  var statusSubEl = document.getElementById("map-status-sub");
  var statusIconEl = statusEl && statusEl.querySelector(".map-status__icon");
  var ICONS = { ok: "✓", maybe: "?", high: "!", no: "×" };
  var RATING_KEYS = { ok: "ok", maybe: "maybe", high: "high", no: "no" };
  var DIRECTION_KEYS = { N: "N", NE: "NE", E: "E", SE: "SE", S: "S", SW: "SW", W: "W", NW: "NW" };
  function renderStatus(sum, shownText) {
    if (!statusEl) return;
    var rating = null, text = shownText;
    if (sum) {
      var c = sum.counts;
      rating = c.ok ? "ok" : c.maybe ? "maybe" : c.high ? "high" : "no";
      text = c.ok ? c.ok + " " + FS.t("summary.ok") : c.maybe ? c.maybe + " " + maybeLabel(c.maybe) : FS.t("home.statusNone");
    }
    statusEl.className = "map-status__pill" + (rating ? " map-status__pill--" + rating : "");
    statusIconEl.textContent = rating ? ICONS[rating] : "";
    statusIconEl.hidden = !rating;
    statusTextEl.textContent = text;
    // Short on mobile («mest NV»), the wind as well on desktop («Mest V 2–8 m/s, kast 14»).
    statusSubEl.textContent = !sum ? "" : MOBILE.matches ? " · " + FS.t("home.statusMostly", { dir: FS.DIRECTION_LABELS[sum.dir] })
      : FS.t("home.statusWind", {
        dir: FS.DIRECTION_LABELS[sum.dir],
        speed: Math.round(sum.minSpeed) === Math.round(sum.maxSpeed) ? Math.round(sum.speed) : Math.round(sum.minSpeed) + "–" + Math.round(sum.maxSpeed),
        gust: sum.gust != null ? FS.t("home.statusGust", { g: Math.round(sum.gust) }) : "",
      });
  }
  var infoEl = document.getElementById("map-info");
  function setInfoOpen(open) {
    if (!statusEl || !infoEl) return;
    statusEl.setAttribute("aria-expanded", String(open));
    infoEl.hidden = !open;
  }
  if (statusEl) {
    statusEl.addEventListener("click", function () {
      var open = statusEl.getAttribute("aria-expanded") !== "true";
      if (open) FS.track("map/status");
      setInfoOpen(open);
    });
    document.addEventListener("click", function (ev) { if (!ev.target.closest(".map-status")) setInfoOpen(false); });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !infoEl.hidden) { setInfoOpen(false); statusEl.focus(); } });
  }

  // The main reason no sites suit, in one sentence.
  function noneReason(sum) {
    var c = sum.counts;
    if (sum.noByRain >= c.high && sum.noByRain >= c.no - sum.noByRain) return FS.t("summary.reasonRain");
    if (c.high >= c.no) {
      return sum.highByGust > c.high / 2
        ? FS.t("summary.reasonGust", { limit: rules.maxGust })
        : FS.t("summary.reasonWind", { limit: rules.maxWind });
    }
    return FS.t("summary.reasonDirection");
  }

  function windText(wind) {
    return FS.DIRECTION_LABELS[W.directionCode(wind.dir)] + " " + Math.round(wind.speed) + " m/s, " +
      (wind.gust != null ? FS.t("wind.gust", { g: Math.round(wind.gust) }) : FS.t("wind.gustUnknown")) +
      (wind.rain != null && wind.rain >= rules.rainMaybe ? ", " + FS.t("wind.rain", { rain: W.formatRain(wind.rain) }) : "") +
      (wind.measured ? " (" + FS.t("home.measured") + ")" : "");
  }

  // The fresh measurement from a site's weather station (stations.js), or null. stationData is the latest answer from the
  // data service, set by addStations below.
  var stationData = null;
  function stationMeasurement(siteId, now) {
    var ST = window.FlyingSitesStations;
    if (!ST || !stationData) return null;
    var item = stationData.items.filter(function (i) { return i.site === siteId; })[0];
    return item ? ST.measurement(item, now) : null;
  }

  // Assessment for all sites at the chosen time: { id: { wind, rating, reasons } }, or null when wind is off
  // or the forecast does not cover the time. Sites without a forecast (fetch failed) are missing from the result.
  function assessAll() {
    checkStale();
    if (!forecast || stale) return null;
    if (windSlot === "off") { updateForecastStatus(-1); return null; }
    var index = W.slotIndex(forecast.times, windSlot, Date.now());
    windIndex = index;
    updateForecastStatus(index);
    if (index < 0) return null;
    var result = {}, now = Date.now();
    sites.forEach(function (site) {
      var wind = W.windAt(forecast, site.id, index);
      if (!wind) return;
      // «Nå» for a site with a weather station: the fresh measurement counts as on the site page (wind.js rateNow), and the
      // wind shown is then the measured one, marked «målt».
      var m = windSlot === "0" ? stationMeasurement(site.id, now) : null;
      var assessed = W.rateNow(site, wind, m && m.wind, rules, m && m.steady);
      var rating = assessed.result;
      if (assessed.basis === "measured") wind = { dir: m.wind.dir, speed: m.wind.speed, gust: m.wind.gust, rain: wind.rain, measured: true };
      result[site.id] = { wind: wind, rating: rating.rating, reasons: rating.reasons, codes: rating.codes };
    });
    return result;
  }

  // --- Map ---
  var mapEl = document.getElementById("home-map");
  var map = FS.createMap(mapEl);
  FS.addAirspaceLayers(map, mapEl.getAttribute("data-airspace-url"));
  FS.addObstacleLayer(map, mapEl.getAttribute("data-obstacles-url"));
  FS.addRadarLayer(map);
  addStations();
  // On desktop the map fills its column and nothing scrolls, so the wheel zooms. Elsewhere the wheel scrolls the page,
  // and Ctrl/Cmd + wheel zooms (common.js).
  FS.wheelNeedsCtrl(map, function () { return MOBILE.matches; });
  // The attribution goes below the map, on one line, so it does not cover the small map on mobile or the timeline.
  var attributionEl = map.attributionControl.getContainer();
  attributionEl.classList.add("map-attribution");
  document.getElementById("home-map-wrap").appendChild(attributionEl);
  // The map opens over the launches in the home region (site.homeRegion), not over all sites, so a distant
  // site does not zoom the map out. Sites outside are in the list and search.
  var homeRegion = mapEl.getAttribute("data-home-region");
  var bounds = [];

  // The arrow is on the side the wind comes from and points in towards the launch, like wind blowing into the rose.
  // Dimming and selection are in className, so they survive when the marker is taken out of and back into a cluster.
  // match: "match", "unknown" (level not set), "nowind" (missing forecast) or "no", see matches().
  // The rose in the marker (46 px with ring, so it is easy to see): the same rose as on the card and site page. With wind
  // on, the sector the wind comes from is filled with the rating colour out to the ring (roseSvg in common.js).
  function markerRose(site, assessment) {
    return FS.roseSvg(site, 40, false, assessment ? { code: W.directionCode(assessment.wind.dir), rating: assessment.rating, edge: true } : null);
  }
  // Mean wind and gust below the name, «5 (8) m/s», when zoomed in far enough for names to show. The direction is in the rose.
  function markerWind(assessment) {
    if (!assessment) return "";
    var w = assessment.wind;
    return '<span class="rose-marker__wind">' + FS.escapeHtml(FS.t("wind.mapWind", { speed: Math.round(w.speed), gust: w.gust != null ? Math.round(w.gust) : "?" })) + "</span>";
  }
  function markerIcon(site, assessment, match, selected) {
    var ring = assessment ? " rose-marker__ring--" + assessment.rating : "";
    return L.divIcon({
      className: "rose-marker" + (match === "no" ? " rose-marker--dimmed" : WEAK[match] ? " rose-marker--unknown" : "") +
        (selected ? " rose-marker--selected" : ""),
      html: '<span class="rose-marker__ring' + ring + '">' + markerRose(site, assessment) + "</span>" +
        '<span class="rose-marker__name">' + FS.escapeHtml(site.name) + markerWind(assessment) + "</span>",
      iconSize: [46, 46],
      iconAnchor: [23, 23],
    });
  }

  // Launches that overlap on the map are merged into a cluster with a count.
  // The count is of sites matching the filter, or sites without a level when none match fully.
  // With wind on, the ring gets the colour of the best rating among those counted.
  var markerState = {}; // id: { match, rating, selected }, updated in update()
  function clusterIcon(cluster) {
    var children = cluster.getAllChildMarkers();
    var counts = { match: 0, unknown: 0, no: 0 }, best = { match: null, unknown: null }, selected = false;
    children.forEach(function (m) {
      var st = markerState[m.options.siteId] || { match: "match" };
      var group = WEAK[st.match] ? "unknown" : st.match;
      if (st.selected) selected = true;
      counts[group]++;
      if (group === "no" || !st.rating) return;
      if (!best[group] || RATINGS[st.rating].order < RATINGS[best[group]].order) best[group] = st.rating;
    });
    var shown = counts.match ? "match" : counts.unknown ? "unknown" : "no";
    var rating = best[shown];
    var ring = rating ? " rose-marker__ring--" + rating : "";
    return L.divIcon({
      className: "rose-marker site-cluster" + (shown === "no" ? " rose-marker--dimmed" : shown === "unknown" ? " rose-marker--unknown" : "") +
        (selected ? " rose-marker--selected" : ""),
      html: '<span class="rose-marker__ring site-cluster__ring' + ring + '">' + (shown === "no" ? children.length : counts[shown]) + "</span>",
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }
  var cluster = L.markerClusterGroup({
    // At least the size of a site marker (46 px), so a marker and a cluster never overlap without being merged (which
    // left a cluster with only a sliver to tap).
    maxClusterRadius: 48,
    showCoverageOnHover: false,
    spiderfyDistanceMultiplier: 1.6,
    iconCreateFunction: clusterIcon,
  }).addTo(map);
  // «Flysteder» as a layer, so the map can show only the weather. What belongs to the sites (the status, the line about
  // the selected site, the timeline, the card) is hidden with it.
  map.layersControl.addOverlay(cluster, FS.layerLabel(map, "sites", FS.t("map.layerSites")));
  var homeMapEl = mapEl.closest(".home__map");
  map.on("overlayadd overlayremove", function (ev) {
    if (ev.layer === cluster && homeMapEl) homeMapEl.classList.toggle("home__map--no-sites", ev.type === "overlayremove");
  });

  sites.forEach(function (site) {
    var marker = L.marker([site.lat, site.lon], { icon: markerIcon(site, null, "match", false), title: site.name, alt: site.name, keyboard: true, riseOnHover: true, siteId: site.id });
    marker.bindTooltip(FS.escapeHtml(site.name), { direction: "top", offset: [0, -14] });
    marker.on("click", function () { FS.track("map/select/" + site.id, site.name); select(site.id, "map"); });
    cluster.addLayer(marker);
    markers[site.id] = marker;
    if (site.region === homeRegion) bounds.push([site.lat, site.lon]);
  });
  // Without sites in the home region the map covers all sites.
  if (!bounds.length) sites.forEach(function (site) { bounds.push([site.lat, site.lon]); });
  // Site names below the roses when zoomed in close.
  var NAMES_ZOOM = 11;
  function toggleNames() { mapEl.classList.toggle("map--names", map.getZoom() >= NAMES_ZOOM); }
  map.on("zoomend", toggleNames);

  function fitAllSites() {
    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], animate: false });
  }
  FS.fitWhenVisible(map, mapEl, fitAllSites);
  // «Vis flysteder i Harstad og Kvæfjord» and full screen below the zoom buttons, as on the site page.
  FS.addViewControls(map, mapEl, fitAllSites, FS.t("home.showSitesIn", { region: homeRegion }));
  // «Piloter i lufta» (live.js), off until it is turned on in the layer list.
  if (window.FlyingSitesLive) window.FlyingSitesLive.addMapLayer(map, mapEl.getAttribute("data-live-url"));
  // «Prognose» (forecast-layer.js), off until turned on; it follows the time in the timeline (update()).
  var forecastLayers = window.FlyingSitesForecast
    ? window.FlyingSitesForecast.addMapLayers(map, { close: mapEl.getAttribute("data-grid-url"), wide: mapEl.getAttribute("data-grid-wide-url") })
    : null;

  // --- Card for the selected site ---
  var cardEl = document.getElementById("selected");
  // The empty state is built with DOM methods (not innerHTML from the page itself), so no text is parsed as HTML.
  var EMPTY_CARD_TEXT = FS.t("home.emptyCard");
  function resetCard() {
    var p = document.createElement("p");
    p.className = "muted selected__empty";
    p.textContent = EMPTY_CARD_TEXT;
    cardEl.replaceChildren(p);
    cardEl.classList.remove("selected--active");
    if (noteEl) { noteEl.hidden = true; noteEl.replaceChildren(); }
  }
  function showCard(site, assessment, windOn) {
    var e = FS.escapeHtml;
    var html = '<button type="button" class="selected__close" data-close-card aria-label="' + e(FS.t("home.closeCard", { name: site.name })) + '">×</button>' +
      '<div class="selected__top">' + FS.roseSvg(site, 84, true, assessment ? { code: W.directionCode(assessment.wind.dir), rating: assessment.rating } : null) +
      '<div class="selected__info"><h2 class="selected__name">' + e(site.name) + "</h2>" +
      (site.elevation != null ? '<p class="selected__elev">' + e(FS.t("home.launchMasl", { m: site.elevation })) + "</p>" : "") +
      '<div class="directions">' + directionBadges(site) + "</div>" +
      '<div class="tags">' + tags(site) + "</div></div></div>";
    if (assessment) {
      html += '<p class="selected__wind"><span class="wind-dot wind-dot--' + assessment.rating + '"></span>' +
        e(FS.t("home.windAt", { when: whenLabel(windIndex) })) +
        e(windText(assessment.wind)) + ". <strong>" + e(RATINGS[assessment.rating].label) + "</strong></p>";
      if (assessment.reasons.length) html += '<p class="selected__reasons">' + e(assessment.reasons.join(". ")) + ".</p>";
      if (assessment.note) html += '<p class="selected__reasons">' + e(assessment.note) + "</p>";
      if (site.maxWind != null && assessment.codes.indexOf("overSiteLimit") === -1) html += '<p class="selected__reasons">' + e(FS.t("home.siteLimit", { limit: site.maxWind })) + "</p>";
    } else if (windOn) {
      html += '<p class="selected__wind muted">' + e(FS.t("home.noForecastNow")) + "</p>";
    }
    if (site.text) html += '<p class="selected__text">' + e(site.text) + "</p>";
    html += '<a class="btn btn--primary btn--wide" href="' + e(site.url) + '">' + e(FS.t("home.seeSite")) + "</a>";
    if (site.flightlogId) {
      html += '<a class="btn btn--wide" href="https://flightlog.org/fl.html?l=1&amp;a=22&amp;country_id=160&amp;start_id=' +
        encodeURIComponent(site.flightlogId) + '" target="_blank" rel="noopener">' + e(FS.t("home.seeFlightlog")) + FS.EXTERNAL_MARK + "</a>";
    }
    cardEl.innerHTML = html;
    cardEl.classList.add("selected--active");
    showNote(site, assessment);
  }
  // Mobile: one line on the map about the selected site, with a link to the site page. The card is for desktop (CSS).
  var noteEl = document.getElementById("map-note");
  function showNote(site, assessment) {
    if (!noteEl) return;
    var e = FS.escapeHtml;
    noteEl.innerHTML = "<span><strong>" + e(site.name) + "</strong>" +
      (assessment ? " · " + e(windText(assessment.wind)) + " · " + e(RATINGS[assessment.rating].label) : "") + "</span>" +
      '<a href="' + e(site.url) + '" aria-label="' + e(FS.t("home.seeName", { name: site.name })) + '">' + e(FS.t("home.see")) + "</a>";
    noteEl.hidden = false;
  }

  // origin: "map" (a rose in the map), "list" (the list) or "pick" (search hits, the day plan).
  function select(id, origin) {
    var site = sites.find(function (s) { return s.id === id; });
    if (!site) return;
    var mobile = MOBILE.matches;
    // In full screen the list is behind the map: the site is shown in the line on the map (with the link to its page), and
    // the page behind is left as it is.
    var fullscreen = mapEl.classList.contains("map--fullscreen");
    // A second tap on the selected site opens the site page: in the map (also in full screen), and in the list on mobile.
    // The first tap shows it in the map and the list.
    if (id === selectedId && (origin === "map" || (origin === "list" && mobile))) {
      FS.track(origin + "/open/" + id);
      // The link is in the page from the build (index.njk), so the address never comes from the script.
      var link = listEl.querySelector('[data-id="' + id + '"] .results__open');
      if (link) link.click();
      return;
    }
    selectedId = id;
    // A rose tapped in the map shows the site in the list, also when it is further down than the first few.
    if (origin === "map" && mobile && !fullscreen) listExpanded = true;
    update();
    writeHash();
    if (origin !== "map") {
      // If the site is in a cluster, zoom in until the marker shows.
      cluster.zoomToShowLayer(markers[id], function () { map.panTo([site.lat, site.lon]); });
    }
    if (origin === "map" && mobile && !fullscreen) scrollToItem(id);
  }
  // Mobile: scrolls the list so the site sits right below the map and the search bar, which stay at the top. The position
  // is measured before the map is made small: the small map keeps its old height as margin below, so the list does not
  // move, but the height is animated and would be measured halfway. --map-h follows the class at once.
  function scrollToItem(id) {
    var li = listEl.querySelector('[data-id="' + id + '"]');
    if (!li || li.hidden || !homeEl) return;
    var y = li.getBoundingClientRect().top + window.scrollY;
    homeEl.classList.add("home--small");
    var mapH = parseFloat(getComputedStyle(homeEl).getPropertyValue("--map-h")) || 0;
    var bar = document.getElementById("filters");
    var top = y - mapH - (bar ? bar.offsetHeight : 0) - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: REDUCED_MOTION.matches ? "auto" : "smooth" });
  }
  var REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

  // --- Filters and list ---
  var listEl = document.getElementById("results-list");
  var titleEl = document.getElementById("results-title");
  var noResultsEl = document.getElementById("no-results");
  var windLegendEl = document.getElementById("wind-legend");
  var moreEl = document.getElementById("results-more");
  var homeEl = document.querySelector(".home");
  var LIST_LIMIT = 5;
  var listExpanded = false;
  if (moreEl) moreEl.addEventListener("click", function () {
    listExpanded = true;
    FS.track("list/show-all");
    update();
    // Focus on the first site that was hidden, so keyboard and screen reader users continue there.
    var next = listEl.querySelectorAll("li[data-id]:not([hidden]) button")[LIST_LIMIT];
    if (next) next.focus();
  });
  var originalOrder = Array.prototype.slice.call(listEl.children);

  // List headings for sites without a forecast (suggestions on) and without a level (level filter on).
  var GROUP_ORDER = { match: 0, nowind: 1, unknown: 2 };
  var headingEls = {};
  ["nowind", "unknown"].forEach(function (g) {
    var el = document.createElement("li");
    el.className = "results__group";
    el.hidden = true;
    headingEls[g] = el;
  });
  function headingHtml(g, n) {
    return g === "nowind"
      ? '<h3 class="results__group-title">' + FS.escapeHtml(FS.t("home.groupNoWind", { n: n })) + "</h3>" +
        '<p class="muted">' + FS.escapeHtml(FS.t("home.groupNoWindText")) + "</p>"
      : '<h3 class="results__group-title">' + FS.escapeHtml(FS.t("home.groupNoLevel", { n: n })) + "</h3>" +
        '<p class="muted">' + FS.escapeHtml(FS.t("home.groupNoLevelText", { level: filter.level })) + "</p>";
  }

  function update() {
    applyCategory();
    var assessments = assessAll();
    // The forecast layers show the hour chosen in the timeline, or now when the wind assessment is off.
    if (forecastLayers) forecastLayers.setTime(windIndex >= 0 && windSlot !== "off" && forecast && !stale ? Date.parse(forecast.times[windIndex]) : Date.now());
    var windOn = !!(forecast && !stale && windSlot !== "off");
    var counts = { match: 0, unknown: 0, nowind: 0, no: 0 };
    var matchById = {};
    sites.forEach(function (site) {
      var assessment = assessments && assessments[site.id];
      var match = matches(site, assessment, !!assessments);
      matchById[site.id] = match;
      counts[match]++;
      var marker = markers[site.id];
      if (marker) {
        marker.setIcon(markerIcon(site, assessment, match, site.id === selectedId));
        markerState[site.id] = { match: match, rating: assessment ? assessment.rating : null, selected: site.id === selectedId };
        var order = assessment ? 3 - RATINGS[assessment.rating].order : 0;
        var base = { match: 500, unknown: 250, nowind: 250, no: 0 }[match];
        marker.setZIndexOffset(site.id === selectedId ? 1000 : base + order * 10);
      }
      var li = listEl.querySelector('[data-id="' + site.id + '"]');
      if (li) {
        li.hidden = match === "no";
        var button = li.querySelector("button");
        button.classList.toggle("results__item--selected", site.id === selectedId);
        li.querySelector(".directions").innerHTML = directionBadges(site);
        // The same rose as in the map: the wind sector in the rating colour, and the ring. The rating is looked up in a
        // fixed list, so only known class names reach the markup.
        var ringRating = assessment ? RATING_KEYS[assessment.rating] : null;
        var windCode = assessment ? DIRECTION_KEYS[W.directionCode(assessment.wind.dir)] : null;
        li.querySelector(".results__rose").innerHTML = '<span class="results__ring' + (ringRating ? " results__ring--" + ringRating : "") + '">' +
          FS.roseSvg(site, 34, false, ringRating && windCode ? { code: windCode, rating: ringRating, edge: true } : null) + "</span>";
        var windEl = button.querySelector(".results__wind");
        if (!windEl) {
          windEl = document.createElement("span");
          windEl.className = "results__wind";
          button.querySelector(".results__body").insertBefore(windEl, button.querySelector(".results__open"));
        }
        windEl.hidden = !assessment && !(assessments && windOn);
        // The rating as a chip with a symbol, so it does not rest on colour alone, then the wind.
        windEl.innerHTML = assessment
          ? '<span class="rating-chip rating-chip--' + assessment.rating + '"><span aria-hidden="true">' + ICONS[assessment.rating] + "</span>" +
            FS.escapeHtml(RATINGS[assessment.rating].label) + "</span>" + FS.escapeHtml(windText(assessment.wind))
          : FS.escapeHtml(FS.t("home.noForecast"));
      }
      if (site.id === selectedId) showCard(site, assessment, windOn);
    });

    cluster.refreshClusters();

    // Sites without a forecast and without a level come last. With wind on, each group is sorted by rating,
    // otherwise alphabetically as from the build.
    var items = originalOrder.slice();
    var group = function (li) { return GROUP_ORDER[matchById[li.getAttribute("data-id")]] || 0; };
    items.sort(function (a, b) {
      var ra = assessments && assessments[a.getAttribute("data-id")], rb = assessments && assessments[b.getAttribute("data-id")];
      return group(a) - group(b) ||
        (ra ? RATINGS[ra.rating].order : 9) - (rb ? RATINGS[rb.rating].order : 9) ||
        originalOrder.indexOf(a) - originalOrder.indexOf(b);
    });
    Object.keys(headingEls).forEach(function (g) {
      var el = headingEls[g];
      if (el.parentNode) listEl.removeChild(el);
      el.hidden = !counts[g];
      el.innerHTML = counts[g] ? headingHtml(g, counts[g]) : "";
    });
    var placed = {};
    items.forEach(function (li) {
      var g = matchById[li.getAttribute("data-id")];
      if (headingEls[g] && !placed[g]) { listEl.appendChild(headingEls[g]); placed[g] = true; }
      listEl.appendChild(li);
    });
    // Without filters or search, the first LIST_LIMIT sites are shown (the best rated first) and «Vis alle 32» shows the
    // rest, so the list does not push everything else far down. The rest are always in the map.
    var filtered = filter.directions.length || filter.level || filter.category || filter.q || (suggest && assessments);
    var limited = !filtered && !listExpanded;
    var visible = items.filter(function (li) { return !li.hidden; });
    visible.forEach(function (li, i) { li.classList.toggle("results__li--more", limited && i >= LIST_LIMIT); });
    if (moreEl) {
      moreEl.hidden = !limited || visible.length <= LIST_LIMIT;
      moreEl.textContent = FS.t("home.showAll", { n: visible.length });
    }
    if (windLegendEl) windLegendEl.hidden = !assessments;

    var title = filtered
      ? FS.tn("home.matchFilters", counts.match)
      : FS.t("home.sites", { n: counts.match });
    if (counts.nowind) title += FS.t("home.withoutForecast", { n: counts.nowind });
    if (counts.unknown) title += FS.t("home.withoutLevel", { n: counts.unknown });
    titleEl.textContent = title;
    var shown = counts.match + counts.unknown + counts.nowind;
    var shownText = shown === sites.length
      ? FS.t("home.showingAll", { n: sites.length })
      : FS.t("home.showingSome", { shown: shown, n: sites.length });
    noResultsEl.hidden = counts.match + counts.unknown + counts.nowind !== 0;
    // The summary follows direction, level, category and search, but not «Bare steder som kan passe», which would
    // otherwise hide what the summary explains.
    var scope = assessments ? sites.filter(function (s) { return matches(s, assessments[s.id], true, true) !== "no"; })
      .map(function (s) { return s.id; }) : [];
    var sum = assessments ? summarize(assessments, scope) : null;
    renderSummary(sum);
    renderStatus(sum, shownText);
    renderTimeline(scope.length ? scope : sites.filter(function (s) { return matches(s, null, false, true) !== "no"; }).map(function (s) { return s.id; }));
    // Empty result with suggestions on: say why, not just that none suit.
    noResultsEl.textContent = suggest && sum && sum.counts.ok + sum.counts.maybe === 0
      ? FS.t("home.noneSuggest", { reason: noneReason(sum) })
      : filter.q && !sites.some(nameMatches)
        ? FS.t("home.noName", { q: filter.q.trim() })
        : FS.t("home.noResults");
    renderSearchHits();
    renderDayPlan();
    updateFiltersToggle(shown);
  }

  // The «Filter» button: how many filters are chosen, as a count. It opens direction, level, category and «Bare steder
  // som kan passe» as a panel from the bottom of the screen (mobile) or folded out below (desktop). «Vis 12 flysteder»,
  // the backdrop and Esc close it again.
  var filtersToggle = document.getElementById("filters-toggle");
  var filtersMore = document.getElementById("filters-more");
  var filtersDone = document.getElementById("filters-done");
  var filtersBackdrop = document.getElementById("filters-backdrop");
  var filtersClose = document.getElementById("filters-close");
  var filtersReset = document.getElementById("filters-reset");
  var chipsEl = document.getElementById("filter-chips");
  var directionChosenEl = document.getElementById("direction-chosen");
  var DESKTOP = window.matchMedia("(min-width: 1100px)");
  function updateFiltersToggle(shown) {
    if (!filtersToggle) return;
    var n = (filter.directions.length ? 1 : 0) + (filter.level ? 1 : 0) + (filter.category ? 1 : 0) + (suggest ? 1 : 0);
    var count = filtersToggle.querySelector(".filters-toggle__count");
    count.textContent = n ? String(n) : "";
    count.hidden = !n;
    if (filtersReset) filtersReset.hidden = !n;
    renderChips();
    if (filtersDone) filtersDone.textContent = FS.tn("home.showSites", shown);
    if (directionChosenEl) {
      directionChosenEl.textContent = filter.directions.length
        ? filter.directions.map(function (d) { return FS.DIRECTION_LABELS[d]; }).join(", ")
        : FS.t("home.allDirections");
    }
  }
  // The chosen filters as chips under the search: one per direction, level, category and «Kan passe», each removed with ✕.
  // Built with DOM calls, so no text is read as markup.
  var SVG_NS = "http://www.w3.org/2000/svg";
  function chip(label, remove) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "filter-chip";
    button.setAttribute("aria-label", FS.t("home.removeFilter", { name: label }));
    button.appendChild(document.createTextNode(label));
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "14"); svg.setAttribute("height", "14"); svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M6 6l12 12M18 6L6 18");
    svg.appendChild(path);
    button.appendChild(svg);
    button.addEventListener("click", function () {
      var index = Array.prototype.indexOf.call(chipsEl.children, button);
      remove();
      update();
      writeHash();
      // The chips are drawn again: focus goes to the one in the same place, or back to the search when none are left.
      var left = chipsEl.children;
      (left.length ? left[Math.min(index, left.length - 1)] : searchEl).focus();
    });
    return button;
  }
  function renderChips() {
    if (!chipsEl) return;
    var chips = filter.directions.map(function (d) {
      return chip(FS.DIRECTION_LABELS[d], function () { FS.track("filter/chip/direction"); setFilter("direction", d); });
    });
    ["level", "category"].forEach(function (type) {
      if (filter[type]) chips.push(chip(filter[type], function () { FS.track("filter/chip/" + type); setFilter(type, ""); }));
    });
    if (suggest) chips.push(chip(FS.t("home.suggestChip"), function () { FS.track("filter/chip/suggest"); setSuggest(false); }));
    chipsEl.replaceChildren.apply(chipsEl, chips);
    chipsEl.hidden = !chips.length;
  }
  function resetFilters() {
    setDirections([]);
    setFilter("level", "");
    setFilter("category", "");
    setSuggest(false);
    update();
    writeHash();
  }

  // On mobile the panel is a modal dialog: role and aria-modal while it is open, and Tab moves only between its buttons.
  // On desktop it folds out under the search bar and the page stays usable.
  function isSheet() { return !DESKTOP.matches; }
  function setFiltersOpen(open) {
    filtersToggle.setAttribute("aria-expanded", String(open));
    filtersMore.classList.toggle("is-open", open);
    if (open && isSheet()) { filtersMore.setAttribute("role", "dialog"); filtersMore.setAttribute("aria-modal", "true"); }
    else { filtersMore.setAttribute("role", "group"); filtersMore.removeAttribute("aria-modal"); }
    if (filtersBackdrop) filtersBackdrop.hidden = !open;
    document.body.classList.toggle("sheet-open", open);
    if (open) (isSheet() && filtersDone ? filtersDone : filtersClose || filtersToggle).focus();
    else filtersToggle.focus();
  }
  function trapFocus(e) {
    var items = Array.prototype.filter.call(filtersMore.querySelectorAll("button, a[href], input"), function (el) {
      return !el.disabled && el.offsetParent !== null;
    });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !filtersMore.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !filtersMore.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }
  if (filtersToggle) {
    filtersToggle.addEventListener("click", function () { setFiltersOpen(filtersToggle.getAttribute("aria-expanded") !== "true"); });
    if (filtersDone) filtersDone.addEventListener("click", function () { setFiltersOpen(false); });
    if (filtersClose) filtersClose.addEventListener("click", function () { setFiltersOpen(false); });
    if (filtersReset) filtersReset.addEventListener("click", function () { FS.track("filter/reset"); resetFilters(); (isSheet() ? filtersDone : filtersClose).focus(); });
    if (filtersBackdrop) filtersBackdrop.addEventListener("click", function () { setFiltersOpen(false); });
    document.addEventListener("keydown", function (e) {
      if (filtersToggle.getAttribute("aria-expanded") !== "true") return;
      if (e.key === "Escape") setFiltersOpen(false);
      else if (e.key === "Tab" && isSheet()) trapFocus(e);
    });
  }

  // The search field filters while typing, together with the other filters. The map zooms to the hits
  // (slightly delayed, so it does not jump on every letter). Enter with one hit selects the site, Esc clears.
  var searchEl = document.getElementById("site-search");
  var searchHitsEl = document.getElementById("search-hits");
  var searchTimer = null;
  var missTimer = null;
  var MAX_HITS = 6;
  // Up to MAX_HITS hits as buttons below the field. More hits: just the count, they are in the list.
  function renderSearchHits() {
    if (!searchHitsEl) return;
    var hits = filter.q.trim() ? visibleMatches() : [];
    searchHitsEl.hidden = !filter.q.trim();
    if (!hits.length) { searchHitsEl.innerHTML = filter.q.trim() ? '<p class="muted">' + FS.escapeHtml(FS.t("home.noHits")) + "</p>" : ""; return; }
    searchHitsEl.innerHTML = hits.length > MAX_HITS
      ? '<p class="muted">' + FS.escapeHtml(FS.t("home.manyHits", { n: hits.length })) + "</p>"
      : hits.map(function (s) {
          return '<button type="button" class="pill" data-select="' + FS.escapeHtml(s.id) + '">' + FS.escapeHtml(s.name) + "</button>";
        }).join("");
  }
  function visibleMatches() {
    return sites.filter(function (s) { var li = listEl.querySelector('[data-id="' + s.id + '"]'); return li && !li.hidden; });
  }
  function fitToMatches() {
    var hits = visibleMatches();
    if (!filter.q || !hits.length) return;
    if (hits.length === 1) map.setView([hits[0].lat, hits[0].lon], Math.max(map.getZoom(), 12));
    else map.fitBounds(hits.map(function (s) { return [s.lat, s.lon]; }), { padding: [40, 40], maxZoom: 12 });
  }
  function setSearch(value) {
    filter.q = value || "";
    if (searchEl && searchEl.value !== filter.q) searchEl.value = filter.q;
  }
  if (searchEl) {
    searchEl.addEventListener("input", function () {
      setSearch(searchEl.value);
      update();
      writeHash();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(fitToMatches, 350);
      // Searches without hits are counted once typing stops, but only as a number: the search text is never sent.
      // People type all sorts of things into a search box (names, addresses), and a cookie-free counter is still
      // a third party.
      clearTimeout(missTimer);
      missTimer = setTimeout(function () {
        if (filter.q.trim().length >= 3 && !visibleMatches().length) FS.track("search/no-hits");
      }, 2000);
    });
    searchEl.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && searchEl.value) {
        ev.preventDefault();
        setSearch("");
        update();
        writeHash();
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        var hits = visibleMatches();
        if (hits.length === 1) { clearTimeout(searchTimer); select(hits[0].id, "pick"); }
      }
    });
  }
  if (searchHitsEl) {
    searchHitsEl.addEventListener("click", function (ev) {
      var button = ev.target.closest("button[data-select]");
      if (button) { clearTimeout(searchTimer); select(button.getAttribute("data-select"), "pick"); }
    });
  }

  // --- Day plan («Når kan det passe?») ---
  // For today and the next days in the forecast: the sites matching the filters (direction, level, category, search), with
  // the daylight periods where the assessment is «Kan passe» or «Usikkert» (dayWindows in wind.js). Sites with
  // the most suitable hours come first. Built with DOM methods, so nothing from the data is parsed as HTML.
  var dayPlanEl = document.getElementById("day-plan");
  var dayPlanDaysEl = document.getElementById("day-plan-days");
  var DAY_PLAN_DAYS = 3, DAY_PLAN_SHOWN = 6;
  var dayFormat = new Intl.DateTimeFormat(FS.lang === "nb" ? "nb-NO" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Oslo" });
  function domEl(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function hourLabel(ms) { var h = W.osloParts(ms).hour; return (h < 10 ? "0" : "") + h; }
  function windowChip(w) {
    var end = W.osloParts(w.end).hour === 0 ? "24" : hourLabel(w.end);
    // «10–18 SV 3–5 (7)»: the period, most common direction, mean wind from–to and highest gust.
    var chip = domEl("span", "day-plan__time day-plan__time--" + w.rating);
    chip.appendChild(domEl("strong", "", hourLabel(w.start) + "–" + end));
    var speed = w.min === w.max ? String(w.min) : w.min + "–" + w.max;
    chip.appendChild(domEl("span", "day-plan__wind", FS.DIRECTION_LABELS[w.dir] + " " + speed + (w.gust != null ? " (" + w.gust + ")" : "")));
    chip.title = RATINGS[w.rating].label + ": " + FS.t("dayPlan.windTitle", { dir: FS.DIRECTION_LABELS[w.dir], speed: speed, gust: w.gust != null ? w.gust : "?" });
    return chip;
  }
  function siteRow(entry) {
    var li = domEl("li", "day-plan__site");
    var button = li.appendChild(domEl("button", "day-plan__name", entry.site.name));
    button.type = "button";
    button.setAttribute("data-select", entry.site.id);
    var times = li.appendChild(domEl("span", "day-plan__times"));
    entry.windows.forEach(function (w) { times.appendChild(windowChip(w)); });
    return li;
  }
  function renderDayPlan() {
    if (!dayPlanEl) return;
    if (!forecast || stale) { dayPlanEl.hidden = true; return; }
    var now = Date.now();
    var today = W.osloParts(now).date;
    var tomorrow = W.osloParts(now + 86400000).date;
    var perSite = sites.filter(function (s) { return matches(s, null, false, true) !== "no"; }).map(function (s) {
      return { site: s, days: W.dayWindows(forecast, s, rules, s.lat, s.lon) };
    });
    var dates = [];
    forecast.times.forEach(function (t) { var d = W.osloParts(Date.parse(t)).date; if (d >= today && dates.indexOf(d) === -1) dates.push(d); });
    dayPlanDaysEl.replaceChildren();
    dates.slice(0, DAY_PLAN_DAYS).forEach(function (date) {
      var entries = perSite.map(function (e) {
        var windows = (e.days[date] || []).filter(function (w) { return w.end > now; });
        var hours = function (rating) { return windows.reduce(function (n, w) { return n + (w.rating === rating ? (w.end - w.start) / 3600000 : 0); }, 0); };
        return { site: e.site, windows: windows, ok: hours("ok"), maybe: hours("maybe") };
      }).filter(function (e) { return e.windows.length; });
      entries.sort(function (a, b) { return b.ok - a.ok || b.maybe - a.maybe || a.site.name.localeCompare(b.site.name); });
      var good = entries.filter(function (e) { return e.ok; });
      var unsure = entries.filter(function (e) { return !e.ok; });
      var day = dayPlanDaysEl.appendChild(domEl("div", "day-plan__day"));
      var label = date === today ? FS.t("dayPlan.today") : date === tomorrow ? FS.t("dayPlan.tomorrow") : dayFormat.format(Date.parse(date + "T12:00:00Z"));
      day.appendChild(domEl("h3", "day-plan__date", label.charAt(0).toUpperCase() + label.slice(1)));
      // The forecast ends mid-day: say so, so «07–10» does not look like it only suits until 10.
      var lastTime = Date.parse(forecast.times[forecast.times.length - 1]) + W.stepAt(forecast.times, forecast.times.length - 1);
      if (W.osloParts(lastTime - 1).date === date && W.osloParts(lastTime).hour < 20) {
        day.appendChild(domEl("p", "muted day-plan__partial", FS.t("dayPlan.partial", { time: hourLabel(lastTime) })));
      }
      if (!good.length) day.appendChild(domEl("p", "muted", FS.t("dayPlan.none")));
      var list = day.appendChild(domEl("ul", "day-plan__list"));
      good.slice(0, DAY_PLAN_SHOWN).forEach(function (e) { list.appendChild(siteRow(e)); });
      if (good.length > DAY_PLAN_SHOWN) {
        var more = day.appendChild(domEl("details", "day-plan__more"));
        more.appendChild(domEl("summary", "", FS.t("dayPlan.more", { n: good.length - DAY_PLAN_SHOWN })));
        var rest = more.appendChild(domEl("ul", "day-plan__list"));
        good.slice(DAY_PLAN_SHOWN).forEach(function (e) { rest.appendChild(siteRow(e)); });
      }
      if (unsure.length) {
        var maybe = day.appendChild(domEl("details", "day-plan__more"));
        maybe.appendChild(domEl("summary", "", FS.t("dayPlan.maybeOnly", { n: unsure.length })));
        var mlist = maybe.appendChild(domEl("ul", "day-plan__list"));
        unsure.forEach(function (e) { mlist.appendChild(siteRow(e)); });
      }
    });
    dayPlanEl.hidden = !dates.length;
  }
  if (dayPlanDaysEl) {
    dayPlanDaysEl.addEventListener("click", function (ev) {
      var button = ev.target.closest("button[data-select]");
      if (!button) return;
      FS.track("day-plan/select/" + button.getAttribute("data-select"));
      select(button.getAttribute("data-select"), "pick");
    });
  }

  // Sets a filter and highlights the right button. Unknown values (e.g. from an old link) give «Alle». Direction toggles:
  // a sector turns that direction on or off, and «Alle» clears them. Several directions can be on at once.
  function setFilter(type, value) {
    var buttons = document.querySelectorAll('button[data-filter="' + type + '"]');
    var known = function (v) { return Array.prototype.some.call(buttons, function (b) { return b.getAttribute("data-value") === v; }); };
    if (type === "direction") {
      var list = filter.directions.filter(function (d) { return d !== value; });
      if (value && known(value) && list.length === filter.directions.length) list.push(value);
      setDirections(value ? list : []);
      return;
    }
    value = known(value) ? value : "";
    filter[type] = value;
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-value") === value ? "true" : "false"); });
  }
  function setDirections(list) {
    filter.directions = FS.DIRECTIONS.filter(function (d) { return list.indexOf(d) !== -1; });
    document.querySelectorAll('button[data-filter="direction"]').forEach(function (b) {
      var v = b.getAttribute("data-value");
      b.setAttribute("aria-pressed", String(v ? filter.directions.indexOf(v) !== -1 : !filter.directions.length));
    });
  }

  // The time as hours from now. Old links can have «tomorrow» (12:00 tomorrow) or «off», which give the nearest valid time.
  // Further ahead the forecast has a time every 6 hours, so the hours are taken to the nearest time it has (from: the
  // hours chosen now, so stepping an hour at a time moves on to the next one).
  function setWind(value, from) {
    if (!forecast || stale) return;
    var now = Date.now(), ahead = W.hoursAhead(forecast.times, now);
    var tomorrow = value === "tomorrow" ? W.slotIndex(forecast.times, "tomorrow", now) : -1;
    var hours = tomorrow >= 0 ? ahead.filter(function (a) { return a.index === tomorrow; }).map(function (a) { return a.hours; })[0] : parseInt(value, 10);
    windSlot = String(Number.isFinite(hours) && hours > 0 ? W.nearestHours(ahead, hours, from) : 0);
  }

  // The suggestion switch only works with a forecast. The text follows the chosen time («nå», «kl. 17.00» …).
  var suggestButton = document.querySelector("button[data-suggest]");
  function setSuggest(on) {
    suggest = !!(on && suggestButton && forecast && !stale);
    if (!suggestButton) return;
    var windOn = windSlot !== "off";
    suggestButton.hidden = !forecast || stale;
    suggestButton.setAttribute("aria-pressed", String(suggest && windOn));
    var index = windOn ? W.slotIndex(forecast.times, windSlot, Date.now()) : -1;
    suggestButton.textContent = FS.t("home.suggest") + (index >= 0 ? " " + whenLabel(index) : "");
  }

  var FILTER_NAMES = { direction: "direction", level: "level", category: "category" };
  filtersMore.addEventListener("click", function (ev) {
    var button = ev.target.closest("button[data-filter], button[data-suggest]");
    if (!button) return;
    // Event names are the same in all languages, so the GoatCounter numbers can be summed.
    if (button.hasAttribute("data-suggest")) FS.track("filter/suggest/" + (suggest ? "off" : "on"));
    else FS.track("filter/" + FILTER_NAMES[button.getAttribute("data-filter")] + "/" + (button.getAttribute("data-value") || "all"));
    if (button.hasAttribute("data-suggest")) setSuggest(!suggest);
    else setFilter(button.getAttribute("data-filter"), button.getAttribute("data-value"));
    update();
    writeHash();
  });

  // --- Timeline: the time for the wind assessment ---
  // «Nå» and a slider over the hours in the forecast. The track is coloured hour by hour with the best rating among the
  // sites matching the filters, so you can see when it may work, with the weekday at each midnight.
  var timelineEl = document.getElementById("timeline");
  var rangeEl = document.getElementById("timeline-range");
  var timeEl = document.getElementById("timeline-time");
  var nowButton = document.getElementById("timeline-now");
  var barEl = document.getElementById("timeline-bar");
  var daysEl = document.getElementById("timeline-days");
  var BAR_COLORS = { ok: "var(--wind-ok)", maybe: "var(--wind-maybe)", high: "var(--wind-high)", no: "var(--wind-no)" };
  function renderTimeline(ids) {
    if (!timelineEl) return;
    var now = Date.now(), ahead = forecast && !stale ? W.hoursAhead(forecast.times, now) : [];
    timelineEl.hidden = !ahead.length;
    if (!ahead.length) return;
    // The slider and the track in hours, so the 6-hour steps further ahead take the room their time does.
    var max = ahead[ahead.length - 1].hours;
    var total = max + W.stepAt(forecast.times, ahead[ahead.length - 1].index) / 3600000;
    rangeEl.max = String(max);
    rangeEl.value = windSlot;
    var index = W.slotIndex(forecast.times, windSlot, now);
    // «kl. 13.00» also for now (the button says «Nå»), with the day when it is not today.
    var label = windSlot === "0" ? FS.t("home.whenToday", { time: W.formatClock(Date.parse(forecast.times[index])) }) : whenLabel(index);
    timeEl.textContent = label;
    rangeEl.setAttribute("aria-valuetext", label);
    nowButton.setAttribute("aria-pressed", String(windSlot === "0"));
    var stops = [], days = [], coarse = null;
    var byId = {};
    sites.forEach(function (s) { byId[s.id] = s; });
    var pct = function (h) { return (h / total * 100).toFixed(2) + "%"; };
    ahead.forEach(function (a) {
      var best = null;
      ids.forEach(function (id) {
        var wind = W.windAt(forecast, id, a.index);
        if (!wind) return;
        var r = W.rateWind(byId[id], wind, rules).rating;
        if (!best || RATINGS[r].order < RATINGS[best].order) best = r;
      });
      var step = W.stepAt(forecast.times, a.index) / 3600000;
      if (step > 1 && coarse === null) coarse = a.hours;
      var color = best ? BAR_COLORS[best] : "var(--line)";
      stops.push(color + " " + pct(a.hours), color + " " + pct(a.hours + step));
    });
    // The weekday at each midnight in Norway, wherever it falls between the forecast's times.
    var start = Date.parse(forecast.times[ahead[0].index]);
    for (var h = 1; h <= max; h++) {
      var ms = start + h * 3600000;
      if (W.osloParts(ms).hour !== 0) continue;
      var day = document.createElement("span");
      day.style.left = pct(h);
      day.textContent = dayShort.format(ms).replace(/\.$/, "");
      days.push(day);
    }
    barEl.style.background = "linear-gradient(90deg, " + stops.join(", ") + ")";
    // From where the forecast has a time only every 6 hours (no gusts): striped, with its words for the mouse.
    var coarseEl = null;
    if (coarse !== null) {
      coarseEl = document.createElement("span");
      coarseEl.className = "timeline__coarse";
      coarseEl.style.left = pct(coarse);
      coarseEl.title = FS.t("home.coarse");
    }
    barEl.replaceChildren.apply(barEl, coarseEl ? [coarseEl] : []);
    daysEl.replaceChildren.apply(daysEl, days);
  }
  function setTime(value, track, from) {
    setWind(String(value), from);
    setSuggest(suggest);
    update();
    writeHash();
    if (track) FS.track("filter/wind/" + windSlot);
  }
  if (rangeEl) {
    rangeEl.addEventListener("input", function () { setTime(rangeEl.value, false, Number(windSlot)); });
    rangeEl.addEventListener("change", function () { FS.track("filter/wind/" + windSlot); });
    nowButton.addEventListener("click", function () { setTime(0, true); });
  }

  // Close the card for the selected site (on desktop it sits on top of the map).
  cardEl.addEventListener("click", function (ev) {
    if (!ev.target.closest("[data-close-card]")) return;
    selectedId = null;
    resetCard();
    update();
    writeHash();
  });

  // --- Tabs: Flysteder and Vær ---
  // Switches the content of the left column (below the map on mobile). The map always stays. Arrow keys move between tabs.
  var TAB_NAMES = { "tab-sites": "sites", "tab-weather": "weather" };
  var tabButtons = Array.prototype.slice.call(document.querySelectorAll('.home-tabs [role="tab"]'));
  function showTab(button, focus) {
    tabButtons.forEach(function (b) {
      var on = b === button;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      document.getElementById(b.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) button.focus();
  }
  tabButtons.forEach(function (b, i) {
    b.addEventListener("click", function () { FS.track("tab/" + TAB_NAMES[b.id]); showTab(b); });
    b.addEventListener("keydown", function (ev) {
      var step = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
      if (step) { ev.preventDefault(); showTab(tabButtons[(i + step + tabButtons.length) % tabButtons.length], true); }
    });
  });

  // --- State in the URL ---
  // Filters, search, wind time and selected site are stored in the URL (#direction=W,NW&level=PP3&wind=3&q=solli&site=sollifjellet),
  // so the back button and shared links give the same view. replaceState, so each click does not become a history step.
  function writeHash() {
    var params = new URLSearchParams();
    if (filter.directions.length) params.set("direction", filter.directions.join(","));
    ["level", "category"].forEach(function (type) { if (filter[type]) params.set(type, filter[type]); });
    if (forecast && !stale && windSlot !== "0") params.set("wind", windSlot);
    if (suggest && windSlot !== "off") params.set("forslag", "1");
    if (filter.q.trim()) params.set("q", filter.q.trim());
    if (selectedId) params.set("site", selectedId);
    var hash = params.toString();
    history.replaceState(null, "", hash ? "#" + hash : location.pathname + location.search);
  }

  function readHash() {
    var params = new URLSearchParams(location.hash.slice(1));
    setDirections((params.get("direction") || "").split(","));
    ["level", "category"].forEach(function (type) { setFilter(type, params.get(type) || ""); });
    setWind(params.get("wind") || "0");
    setSuggest(params.get("forslag") === "1");
    setSearch(params.get("q") || "");
    var site = params.get("site");
    selectedId = sites.some(function (s) { return s.id === site; }) ? site : null;
    if (!selectedId) {
      resetCard();
    }
    update();
    writeHash(); // removes unknown values from the URL
  }

  window.addEventListener("hashchange", readHash);

  // --- Mobile: the map at the top ---
  // The map stays at the top of the screen (CSS, position: sticky). It shrinks once the list has been scrolled a bit, and
  // grows again near the top. Two thresholds, so it does not flicker in between. While searching it is smaller still, so
  // the hits have room above the keyboard.
  function onScroll() {
    if (!MOBILE.matches) return;
    var y = window.scrollY;
    if (y > 200) homeEl.classList.add("home--small");
    else if (y < 20) homeEl.classList.remove("home--small");
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  if (searchEl) {
    searchEl.addEventListener("focus", function () { if (MOBILE.matches) homeEl.classList.add("home--search"); });
    // Delayed, so a tap on a search hit is not lost when the layout changes.
    searchEl.addEventListener("blur", function () { setTimeout(function () { homeEl.classList.remove("home--search"); }, 150); });
  }

  listEl.addEventListener("click", function (ev) {
    var button = ev.target.closest("button[data-select]");
    if (button) select(button.getAttribute("data-select"), "list");
  });

  // When returning to a tab that has been left open, and every minute: redraw when the forecast has
  // become too old, or when the chosen time points to a different hour in the forecast (hour change for
  // «nå», «om 3 t» and «om 6 t», midnight for «i morgen»).
  function recheck() {
    if (checkStale()) { update(); writeHash(); return; }
    if (forecast && !stale && windSlot !== "off" && W.slotIndex(forecast.times, windSlot, Date.now()) !== windIndex) update();
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) recheck(); });
  setInterval(recheck, 60 * 1000);

  // --- Weather stations (stations.js) ---
  // The measured wind as the map layers «Klubbens værstasjoner» and «METs værstasjoner», and the same stations as short rows in the Vær tab (the change over
  // the last half hour); the charts and the rest are on the weather page, which each row links to.
  function addStations() {
    var ST = window.FlyingSitesStations;
    var stationsEl = document.getElementById("stations");
    var listEl2 = document.getElementById("station-list");
    if (!ST || !stationsEl) return;
    ST.useRules(rules);
    // Each row links to the station's card on the weather page (the link below the list gives its address).
    var more = stationsEl.querySelector(".stations__more");
    var weatherUrl = more ? more.getAttribute("href") : "";
    var lastMeasured = null;
    ST.addMapLayer(map, stationsEl.getAttribute("data-url"), function (data, now) {
      stationData = data;
      // The stations answer every minute, and update() draws all the markers, rows and clusters again, which is a lot on
      // a phone. The measurements enter the assessment only at «Nå» (assessAll), so the page is drawn again only then,
      // and only when a measurement that counts has changed (or gone old).
      var measured = windSlot === "0" ? JSON.stringify(data.items.filter(function (i) { return i.site; }).map(function (i) {
        var m = ST.measurement(i, now);
        return [i.site, m ? m.wind : null, m ? m.steady : null];
      })) : null;
      if (measured !== lastMeasured) { lastMeasured = measured; update(); }
      // The club's stations as rows, in their own order (Heia first); MET's as a small folded table under them.
      listEl2.replaceChildren.apply(listEl2, ST.groups(data.items).club.map(function (item) { return ST.row(item, now, 30, weatherUrl + "#" + ST.anchor(item), true); }));
      var oldMet = stationsEl.querySelector(".met-stations"), met = ST.metTable(data.items, now, oldMet && oldMet.open);
      if (oldMet) oldMet.remove();
      if (met) listEl2.after(met);
      stationsEl.hidden = !data.items.length;
    });
  }

  readHash();

  // A newer forecast from the data service (workers/data), at once, every ten minutes while the page is in view, and when
  // it comes back into view or online (wind.js watchForecast). It brings the assessment back when the page's forecast
  // had become too old, and gives one to a page built without a forecast (the parts that show it are in the page as long
  // as there is a data service, index.njk).
  W.watchForecast(fc.live, function () { return forecast; }, function (newer) {
    var first = !forecast || stale;
    forecast = newer;
    if (first) { stale = false; windSlot = "0"; setSuggest(false); }
    update();
  });
})();
