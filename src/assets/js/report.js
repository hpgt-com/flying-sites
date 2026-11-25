// «Meld fra» på stedssiden (site.njk, #report, foldet) og på /meld-fra/ (generelt, uten sted): skjemaet sendes til
// datatjenesten (/v1/report, workers/data/src/report.js), som sjekker Turnstile-tokenet og lager en sak til
// klubben. Når den svarer med adressen til saken, lenker takken dit, så avsenderen kan følge med på hva som skjer.
// På stedssiden lastes Cloudflares Turnstile-skript først når skjemaet åpnes, så et besøk som ikke bruker det,
// aldri kontakter Cloudflare. På /meld-fra/ er skjemaet selve siden, så det lastes med en gang.
(function () {
  "use strict";

  var FS = window.FlyingSites;
  var box = document.getElementById("report");
  var form = document.getElementById("report-form");
  if (!FS || !box || !form) return;
  var statusEl = document.getElementById("report-status");
  var checkEl = document.getElementById("report-check");
  var sendEl = form.querySelector(".report__send");
  var token = "", widget = null, loading = false;
  // Knappen er av i HTML-en til skriptet kjører (macros.njk), så nettleseren aldri sender skjemaet på egen hånd.
  sendEl.disabled = false;

  function say(key, kind) {
    statusEl.textContent = key ? FS.t("report." + key) : "";
    statusEl.className = "report__status" + (kind ? " report__status--" + kind : "");
  }
  // Takken med lenke til saken: «Takk! Meldingen er sendt til klubben som sak #171.» Bare en sak i stedets eget
  // repo får lenke.
  var ISSUE_URL = /^https:\/\/github\.com\/hpgt-com\/flying-sites\/issues\/\d+$/;
  function saySent(d) {
    if (!d || !Number.isInteger(d.issue) || typeof d.url !== "string" || !ISSUE_URL.test(d.url)) { say("sent", "ok"); return; }
    var parts = FS.t("report.sentIssue").split("{link}");
    var a = document.createElement("a");
    a.href = d.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = FS.t("report.issueLink", { n: d.issue });
    statusEl.textContent = "";
    statusEl.append(parts[0], a, parts[1] || "");
    statusEl.className = "report__status report__status--ok";
  }

  function render() {
    widget = window.turnstile.render(checkEl, {
      sitekey: box.getAttribute("data-sitekey"),
      language: document.documentElement.lang || "auto",
      theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
      callback: function (t) { token = t; },
      "expired-callback": function () { token = ""; },
      "error-callback": function () { token = ""; say("checkFailed", "error"); },
    });
  }
  function loadTurnstile() {
    if (widget !== null || loading) return;
    if (window.turnstile) { render(); return; }
    loading = true;
    var s = document.createElement("script");
    s.src = globalThis.FSTrustedTypes.scriptURL("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
    s.async = true;
    s.onload = function () { loading = false; render(); };
    s.onerror = function () { loading = false; say("checkFailed", "error"); };
    document.head.appendChild(s);
  }
  if (box.tagName !== "DETAILS") loadTurnstile();
  else {
    box.addEventListener("toggle", function () { if (box.open) loadTurnstile(); });
    if (box.open) loadTurnstile();
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var message = form.elements.message.value.trim();
    if (message.length < 10) { say("tooShort", "error"); form.elements.message.focus(); return; }
    if (!token) { say("waitCheck", "error"); return; }
    sendEl.disabled = true;
    say("sending");
    fetch(box.getAttribute("data-url"), {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site: box.getAttribute("data-site"), kind: form.elements.kind.value, message: message, name: form.elements.name.value.trim(), token: token }),
    }).then(function (r) {
      if (r.ok) {
        form.reset();
        FS.track("report/sent/" + (box.getAttribute("data-site") || "general"));
        return r.json().catch(function () { return null; }).then(saySent);
      } else {
        say(r.status === 429 ? "limit" : r.status === 403 ? "checkFailed" : "failed", "error");
      }
    }).catch(function () { say("failed", "error"); }).then(function () {
      sendEl.disabled = false;
      token = "";
      if (window.turnstile && widget !== null) window.turnstile.reset(widget);
    });
  });
})();
