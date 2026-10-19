// Registers the service worker (src/sw.11ty.js), so visited pages, GPX files and map tiles also work offline,
// and shows a notice while the visitor is offline. Loaded from base.njk after common.js.
(function () {
  "use strict";
  var FS = window.FlyingSites;
  var script = document.currentScript;

  // «Du er offline»: the page may be a stored copy, so the content and the forecast may be out of date.
  // The wind assessment turns itself off when the forecast is too old (isStale in wind.js).
  // When the page was stored, it says so («Siden ble lagret på enheten i går kl. 18.30»).
  var notice = null, savedWhen = null;
  function updateNotice() {
    if (navigator.onLine) {
      if (notice) notice.hidden = true;
      return;
    }
    if (!notice) {
      notice = document.createElement("p");
      notice.className = "offline-notice";
      notice.setAttribute("role", "status");
      document.body.insertBefore(notice, document.body.firstChild);
    }
    notice.textContent = savedWhen ? FS.t("offline.noticeSaved", { when: savedWhen }) : FS.t("offline.notice");
    notice.hidden = false;
  }

  // «i dag kl. 18.30», «i går kl. 18.30» or «17.10. kl. 18.30», in Norwegian time.
  var parts = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Oslo" });
  function osloDay(ms) { var p = parts.formatToParts(new Date(ms)), o = {}; p.forEach(function (x) { o[x.type] = x.value; }); return o; }
  function whenText(ms) {
    var d = osloDay(ms), now = osloDay(Date.now()), yesterday = osloDay(Date.now() - 86400000);
    var meta = (FS.readJson("i18n-data") || {}).meta || {};
    var time = d.hour + (meta.clockSep || ".") + d.minute;
    var key = d.day + d.month + d.year;
    if (key === now.day + now.month + now.year) return FS.t("offline.today", { time: time });
    if (key === yesterday.day + yesterday.month + yesterday.year) return FS.t("offline.yesterday", { time: time });
    return FS.t("offline.date", { date: d.day + "." + d.month + ".", time: time });
  }

  // When this page was last stored by the service worker (the stored copy's Date header), for the notice and for
  // «Lagret på enheten …» at the bottom of the site pages (#offline-saved). Nothing when it is not stored.
  function showSaved() {
    if (typeof caches === "undefined") return;
    caches.match(location.href.split("#")[0].split("?")[0], { ignoreSearch: true }).then(function (stored) {
      var ms = stored && Date.parse(stored.headers.get("date"));
      if (!ms || !Number.isFinite(ms)) return;
      savedWhen = whenText(ms);
      var el = document.getElementById("offline-saved");
      if (el) { el.textContent = FS.t("offline.saved", { when: savedWhen }); el.hidden = false; }
      if (!navigator.onLine) updateNotice();
    }).catch(function () {});
  }
  window.addEventListener("online", updateNotice);
  window.addEventListener("offline", updateNotice);
  updateNotice();
  showSaved();

  if (!("serviceWorker" in navigator) || !script || !script.dataset.sw) return;
  window.addEventListener("load", function () {
    var firstVisit = !navigator.serviceWorker.controller;
    navigator.serviceWorker.register(script.dataset.sw, { scope: script.dataset.scope }).then(function () {
      return navigator.serviceWorker.ready;
    }).then(function (registration) {
      // The first page was loaded before the service worker existed, so it asks for it to be stored now.
      if (firstVisit && registration.active) registration.active.postMessage({ type: "store-page", url: location.href });
      // The copy stored while this page loaded is in place a moment later.
      setTimeout(showSaved, 3000);
    }).catch(function () {
      // Without a service worker the site works as before, only not offline.
    });
  });
})();
