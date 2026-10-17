// Registers the service worker (src/sw.11ty.js), so visited pages, GPX files and map tiles also work offline,
// and shows a notice while the visitor is offline. Loaded from base.njk after common.js.
(function () {
  "use strict";
  var FS = window.FlyingSites;
  var script = document.currentScript;

  // «Du er offline»: the page may be a stored copy, so the content and the forecast may be out of date.
  // The wind assessment turns itself off when the forecast is too old (isStale in wind.js).
  var notice = null;
  function updateNotice() {
    if (navigator.onLine) {
      if (notice) notice.hidden = true;
      return;
    }
    if (!notice) {
      notice = document.createElement("p");
      notice.className = "offline-notice";
      notice.setAttribute("role", "status");
      notice.textContent = FS.t("offline.notice");
      document.body.insertBefore(notice, document.body.firstChild);
    }
    notice.hidden = false;
  }
  window.addEventListener("online", updateNotice);
  window.addEventListener("offline", updateNotice);
  updateNotice();

  if (!("serviceWorker" in navigator) || !script || !script.dataset.sw) return;
  window.addEventListener("load", function () {
    var firstVisit = !navigator.serviceWorker.controller;
    navigator.serviceWorker.register(script.dataset.sw, { scope: script.dataset.scope }).then(function () {
      return navigator.serviceWorker.ready;
    }).then(function (registration) {
      // The first page was loaded before the service worker existed, so it asks for it to be stored now.
      if (firstVisit && registration.active) registration.active.postMessage({ type: "store-page", url: location.href });
    }).catch(function () {
      // Without a service worker the site works as before, only not offline.
    });
  });
})();
