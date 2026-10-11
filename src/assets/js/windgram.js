// Wind above the launch (windgram) on the site page: wind at heights above the launch, hour by hour, from Open-Meteo.
// The grid is computed at build time (lib/windgram.js) and stored in #windgram-data. Highest at the top, hours across.
// Colours follow the home page wind rules: below minimum wind pale, suitable green, near the limit yellow, above red.
// Cells above the boundary layer (roughly where thermals end) are dimmed. Cloud base is a dashed line with a cloud.
(function () {
  "use strict";

  var FS = window.FlyingSites;
  var W = window.FlyingSitesWind;
  var el = document.getElementById("windgram-grid");
  var data = FS && W && el ? FS.readJson("windgram-data") : null;
  if (!data || !data.times || !data.times.length) return;

  var rules = data.rules;
  function speedClass(speed) {
    if (speed < rules.minWind) return "calm";
    if (speed <= rules.maxWind - 2) return "ok";
    if (speed <= rules.maxWind) return "maybe";
    if (speed <= rules.maxGust) return "high";
    return "storm";
  }

  // Only hours from now on (the build can be up to half an hour old).
  var now = Date.now();
  var first = 0;
  while (first < data.times.length - 1 && data.times[first + 1] <= now) first++;
  var cols = [];
  for (var i = first; i < data.times.length; i++) cols.push(i);

  var sun = {};
  function isNight(ms) {
    var date = W.osloParts(ms).date;
    var s = sun[date] || (sun[date] = W.sunTimes(date, data.lat, data.lon));
    if (s.polar) return s.polar === "night";
    return ms < s.rise || ms > s.set;
  }

  // Built with DOM methods, not innerHTML, so nothing from the data is parsed as HTML.
  function node(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = String(text);
    return n;
  }
  var table = node("table", "windgram__table");
  var thead = table.appendChild(document.createElement("thead"));
  var tbody = table.appendChild(document.createElement("tbody"));

  // Day above the hours, so it is easy to see where today ends.
  var days = [];
  cols.forEach(function (i) {
    var date = W.osloParts(data.times[i]).date;
    if (!days.length || days[days.length - 1].date !== date) days.push({ date: date, n: 0 });
    days[days.length - 1].n++;
  });
  var dayRow = thead.appendChild(document.createElement("tr"));
  dayRow.appendChild(node("th", "windgram__corner"));
  days.forEach(function (d) {
    var label = d.date === W.osloParts(now).date ? FS.t("windgram.today") : d.date.slice(8, 10) + "." + d.date.slice(5, 7);
    dayRow.appendChild(node("th", "windgram__day", label)).colSpan = d.n;
  });
  var hourRow = thead.appendChild(document.createElement("tr"));
  hourRow.appendChild(node("th", "windgram__corner", FS.t("windgram.masl")));
  cols.forEach(function (i) {
    hourRow.appendChild(node("th", "windgram__hour" + (isNight(data.times[i]) ? " windgram--night" : ""), W.osloParts(data.times[i]).hour));
  });

  function infoRow(label, values, warn) {
    var tr = tbody.appendChild(node("tr", "windgram__info"));
    tr.appendChild(node("th", "", label));
    cols.forEach(function (i) {
      var v = values[i];
      tr.appendChild(node("td", warn && v != null && warn(v) ? "windgram__warn" : "", v == null ? "–" : Math.round(v)));
    });
  }
  // Cloud base below the launch means the launch may be in cloud.
  infoRow(FS.t("windgram.cloudBase"), data.cloudBase, function (v) { return data.launch != null && v <= data.launch; });
  infoRow(FS.t("windgram.blh"), data.blh);

  for (var r = data.heights.length - 1; r >= 0; r--) {
    var height = data.heights[r];
    // Heights without data in any hour (above the top pressure level or below the terrain) are not shown.
    if (!cols.some(function (i) { return data.cells[i][r]; })) continue;
    var isLaunch = height === data.launch;
    var tr = tbody.appendChild(node("tr", isLaunch ? "windgram__launch" : ""));
    tr.appendChild(node("th", "", isLaunch ? FS.t("windgram.launch", { h: height }) : Math.round(height)));
    cols.forEach(function (i) {
      var cell = data.cells[i][r];
      if (!cell) { tr.appendChild(node("td", "windgram__none")); return; }
      var dir = Number(cell[0]), speed = Math.round(cell[1]);
      var cls = "windgram__cell windgram--" + speedClass(cell[1]);
      if (data.blh[i] != null && height > data.blh[i]) cls += " windgram--above";
      // Cloud base: dashed line and cloud in the lowest cell in cloud, faint grey tint above.
      var cb = data.cloudBase[i];
      var cloudBaseRow = cb != null && height >= cb && !(r > 0 && data.heights[r - 1] >= cb && data.cells[i][r - 1]);
      if (cb != null && height >= cb) cls += cloudBaseRow ? " windgram--cloud windgram--cloudbase" : " windgram--cloud";
      if (isNight(data.times[i])) cls += " windgram--night";
      var td = tr.appendChild(node("td", cls));
      td.title = FS.DIRECTION_LABELS[W.directionCode(dir)] + " " + speed + " m/s";
      if (cloudBaseRow) td.appendChild(node("span", "windgram__cloud", "☁")).setAttribute("aria-hidden", "true");
      var arrow = td.appendChild(node("span", "windgram__arrow", "↓"));
      arrow.setAttribute("aria-hidden", "true");
      arrow.style.transform = "rotate(" + dir + "deg)";
      td.appendChild(document.createTextNode(String(speed)));
    });
  }
  el.replaceChildren(table);
  el.hidden = false;
})();
