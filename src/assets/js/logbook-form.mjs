// «Registrer tur» (/registrer-tur/, prototype): a log file (IGC or KML) is read here in the browser with the same code
// the logbook script uses (igc.js), the flight found in it fills the form, and only the sums are sent to the data
// service (POST /v1/logbook, workers/data/src/logbook.js) with the Turnstile token, as «Meld fra» does (report.js).
// Without a file the fields are typed in. The track, the file and the pilot never leave the browser. The same file
// sent again replaces the flight (the key is the site, the day and the takeoff minute).
import { parseIgc, parseKml, analyzeFlight, launchPoints, flightKey } from "./igc.js";

const FS = window.FlyingSites;
const box = document.getElementById("logflight");
const form = document.getElementById("logflight-form");
if (FS && box && form) {
  const statusEl = document.getElementById("logflight-status");
  const foundEl = document.getElementById("logflight-found");
  const checkEl = document.getElementById("logflight-check");
  const sendEl = form.querySelector(".report__send");
  const sites = FS.readJson("sites-data") || [];
  const names = Object.fromEntries(sites.map((s) => [s.id, s.name]));
  const launches = launchPoints(sites.map((s) => ({ id: s.id, launch: { lat: s.lat, lon: s.lon } })));
  let token = "", widget = null, loading = false;
  // The flight read from the file: its key and source go with the sums, so the same file counts once.
  let fromFile = null;

  const say = (el, key, kind, vars) => {
    el.textContent = key ? FS.t("logFlight." + key, vars) : "";
    el.className = "report__status" + (kind ? " report__status--" + kind : "");
  };
  const dateText = (day) => new Intl.DateTimeFormat(FS.lang === "nb" ? "nb-NO" : "en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));

  function render() {
    widget = window.turnstile.render(checkEl, {
      sitekey: box.getAttribute("data-sitekey"),
      language: document.documentElement.lang || "auto",
      theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
      callback: (t) => { token = t; },
      "expired-callback": () => { token = ""; },
      "error-callback": () => { token = ""; say(statusEl, "checkFailed", "error"); },
    });
  }
  function loadTurnstile() {
    if (widget !== null || loading) return;
    if (window.turnstile) { render(); return; }
    loading = true;
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => { loading = false; render(); };
    s.onerror = () => { loading = false; say(statusEl, "checkFailed", "error"); };
    document.head.appendChild(s);
  }
  loadTurnstile();

  // The file: read, the flight found, the fields filled. A takeoff not near a known site leaves the site to be chosen.
  form.elements.file.addEventListener("change", () => {
    const file = form.elements.file.files && form.elements.file.files[0];
    fromFile = null;
    if (!file) { say(foundEl, null); return; }
    const reader = new FileReader();
    reader.onerror = () => say(foundEl, "readFailed", "error");
    reader.onload = () => {
      try {
        const text = String(reader.result);
        const kml = /\.kml$/i.test(file.name) || /^\s*<\?xml|<kml/i.test(text.slice(0, 200));
        const flight = analyzeFlight(kml ? parseKml(text) : parseIgc(text), launches);
        if (!flight || !flight.date) { say(foundEl, "notFound", "error"); return; }
        fromFile = { key: flightKey(flight), source: kml ? "kml" : "igc" };
        form.elements.site.value = flight.site || "";
        form.elements.day.value = flight.date;
        form.elements.minutes.value = String(flight.minutes);
        form.elements.maxAlt.value = flight.maxAlt == null ? "" : String(flight.maxAlt);
        form.elements.maxDistKm.value = String(flight.maxDistKm);
        const vars = { site: flight.site ? names[flight.site] || flight.site : "", date: dateText(flight.date), minutes: flight.minutes, alt: flight.maxAlt == null ? "?" : flight.maxAlt, km: FS.formatNumber(flight.maxDistKm, 1) };
        say(foundEl, flight.site ? "found" : "foundNoSite", "ok", vars);
        FS.track("logflight/file-read");
      } catch {
        say(foundEl, "readFailed", "error");
      }
    };
    reader.readAsText(file);
  });

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const site = form.elements.site.value, day = form.elements.day.value, minutes = parseInt(form.elements.minutes.value, 10);
    if (!site || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(minutes) || minutes < 1) { say(statusEl, "invalid", "error"); return; }
    if (!token) { say(statusEl, "waitCheck", "error"); return; }
    const maxAlt = form.elements.maxAlt.value === "" ? null : parseInt(form.elements.maxAlt.value, 10);
    const maxDistKm = form.elements.maxDistKm.value === "" ? null : Number(form.elements.maxDistKm.value);
    const key = fromFile ? fromFile.key : `${day}|m|${crypto.randomUUID().slice(0, 8)}`;
    sendEl.disabled = true;
    say(statusEl, "sending");
    fetch(box.getAttribute("data-url"), {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site, day, minutes, maxAlt: Number.isInteger(maxAlt) ? maxAlt : null, maxDistKm: Number.isFinite(maxDistKm) ? maxDistKm : null,
        category: form.elements.category.value || null, source: fromFile ? fromFile.source : "manual", key, token }),
    }).then((r) => {
      if (r.ok) {
        FS.track("logflight/sent/" + (fromFile ? fromFile.source : "manual"));
        return r.json().catch(() => null).then((d) => {
          form.reset();
          fromFile = null;
          say(foundEl, null);
          say(statusEl, "sent", "ok", { site: names[site] || site, n: d && Number.isInteger(d.site) ? d.site : 1 });
        });
      }
      say(statusEl, r.status === 429 ? "limit" : r.status === 403 ? "checkFailed" : "failed", "error");
    }).catch(() => say(statusEl, "failed", "error")).then(() => {
      sendEl.disabled = false;
      token = "";
      if (window.turnstile && widget !== null) window.turnstile.reset(widget);
    });
  });
}
