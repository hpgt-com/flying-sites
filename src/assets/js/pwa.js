// Registrerer service workeren (src/sw.11ty.js), så besøkte sider, GPX-filer og kartfliser også virker offline,
// og viser en melding mens den besøkende er offline. Lastes fra base.njk etter common.js.
(function () {
  "use strict";
  var FS = window.FlyingSites;
  var script = document.currentScript;

  // «Du er offline»: siden kan være en lagret kopi, så innholdet og varselet kan være utdatert.
  // Vindvurderingen slår seg av når varselet er for gammelt (isStale i wind.js).
  // Når siden ble lagret, står det i meldingen («Siden ble lagret på enheten i går kl. 18.30»).
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

  // «i dag kl. 18.30», «i går kl. 18.30» eller «17.10. kl. 18.30», i norsk tid.
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

  // Når siden sist ble lagret av service workeren (Date-headeren i den lagrede kopien), til meldingen og til
  // «Lagret på enheten …» nederst på stedssidene (#offline-saved). Ingenting når den ikke er lagret.
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
    navigator.serviceWorker.register(globalThis.FSTrustedTypes.scriptURL(script.dataset.sw), { scope: script.dataset.scope }).then(function () {
      return navigator.serviceWorker.ready;
    }).then(function (registration) {
      // Den første siden ble lastet før service workeren fantes, så den ber om å bli lagret nå.
      if (firstVisit && registration.active) registration.active.postMessage({ type: "store-page", url: location.href });
      // Kopien som ble lagret mens siden lastet, er på plass litt senere.
      setTimeout(showSaved, 3000);
    }).catch(function () {
      // Uten service worker virker siden som før, bare ikke offline.
    });
  });
})();
