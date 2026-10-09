// Høydevind (windgram) på stedssiden: vinden i høydene over starten time for time, fra Open-Meteo.
// Rutenettet er regnet ut i byggingen (lib/windgram.js) og ligger i #windgram-data. Høyest oppe, timene bortover.
// Fargene følger vindreglene på forsiden: under minste vind blekt, passe grønt, nær grensen gult, over rødt.
// Ruter over grenselaget (omtrent der termikken slutter) er tonet ned. Skybasen er en stiplet strek med sky.
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

  // Bare timer fra nå og framover (byggingen kan være opptil en halvtime gammel).
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

  var html = '<table class="windgram__table"><thead>';
  // Dag over timene, så det er lett å se hvor i dag slutter.
  var days = [];
  cols.forEach(function (i) {
    var date = W.osloParts(data.times[i]).date;
    if (!days.length || days[days.length - 1].date !== date) days.push({ date: date, n: 0 });
    days[days.length - 1].n++;
  });
  html += '<tr><th class="windgram__corner"></th>' + days.map(function (d) {
    var label = d.date === W.osloParts(now).date ? FS.t("windgram.today") : d.date.slice(8, 10) + "." + d.date.slice(5, 7);
    return '<th class="windgram__day" colspan="' + d.n + '">' + FS.escapeHtml(label) + "</th>";
  }).join("") + "</tr>";
  html += '<tr><th class="windgram__corner">' + FS.escapeHtml(FS.t("windgram.masl")) + "</th>" + cols.map(function (i) {
    return '<th class="windgram__hour' + (isNight(data.times[i]) ? " windgram--night" : "") + '">' + W.osloParts(data.times[i]).hour + "</th>";
  }).join("") + "</tr></thead><tbody>";

  function infoRow(label, values, warn) {
    return '<tr class="windgram__info"><th>' + FS.escapeHtml(label) + "</th>" + cols.map(function (i) {
      var v = values[i];
      return "<td" + (warn && v != null && warn(v) ? ' class="windgram__warn"' : "") + ">" + (v == null ? "–" : v) + "</td>";
    }).join("") + "</tr>";
  }
  // Skybase under starten betyr at starten kan ligge i skyen.
  html += infoRow(FS.t("windgram.cloudBase"), data.cloudBase, function (v) { return data.launch != null && v <= data.launch; });
  html += infoRow(FS.t("windgram.blh"), data.blh);

  for (var r = data.heights.length - 1; r >= 0; r--) {
    var height = data.heights[r];
    // Høyder uten data i noen av timene (over øverste trykkflate eller under terrenget) vises ikke.
    if (!cols.some(function (i) { return data.cells[i][r]; })) continue;
    var isLaunch = height === data.launch;
    html += "<tr" + (isLaunch ? ' class="windgram__launch"' : "") + "><th>" +
      (isLaunch ? FS.escapeHtml(FS.t("windgram.launch", { h: height })) : height) + "</th>";
    cols.forEach(function (i) {
      var cell = data.cells[i][r];
      if (!cell) { html += '<td class="windgram__none"></td>'; return; }
      var cls = "windgram__cell windgram--" + speedClass(cell[1]);
      if (data.blh[i] != null && height > data.blh[i]) cls += " windgram--above";
      // Skybasen: stiplet strek og sky i den laveste ruten i skyen, svak grå tone over.
      var cb = data.cloudBase[i];
      var cloudBaseRow = cb != null && height >= cb && !(r > 0 && data.heights[r - 1] >= cb && data.cells[i][r - 1]);
      if (cb != null && height >= cb) cls += cloudBaseRow ? " windgram--cloud windgram--cloudbase" : " windgram--cloud";
      if (isNight(data.times[i])) cls += " windgram--night";
      var title = FS.DIRECTION_LABELS[W.directionCode(cell[0])] + " " + Math.round(cell[1]) + " m/s";
      html += '<td class="' + cls + '" title="' + FS.escapeHtml(title) + '">' +
        (cloudBaseRow ? '<span class="windgram__cloud" aria-hidden="true">☁</span>' : "") +
        '<span class="windgram__arrow" style="transform: rotate(' + cell[0] + 'deg)" aria-hidden="true">↓</span>' +
        Math.round(cell[1]) + "</td>";
    });
    html += "</tr>";
  }
  html += "</tbody></table>";
  el.innerHTML = html;
  el.hidden = false;
})();
