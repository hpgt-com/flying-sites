// «Meld fra» on the site page (site.njk, #report, folded) and on /meld-fra/ (general, no site): the form is sent to the
// data service (/v1/report, workers/data/src/report.js), which checks the Turnstile token and makes an issue for the
// club; when it answers with the issue's address, the thanks link to it, so the sender can follow what happens with
// it. On the site page Cloudflare's Turnstile script is loaded only when the form is opened, so a visit that does not
// use it never contacts Cloudflare; on /meld-fra/ the form is the page, so it is loaded at once.
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

  function say(key, kind) {
    statusEl.textContent = key ? FS.t("report." + key) : "";
    statusEl.className = "report__status" + (kind ? " report__status--" + kind : "");
  }
  // The thanks with a link to the issue: «Takk! Meldingen er sendt til klubben som sak #171.» Only an issue in the
  // site's own repository is linked.
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
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
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
