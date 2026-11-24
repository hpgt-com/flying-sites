// Setter fargemodus før siden tegnes, så den ikke blinker lys først. Lastes synkront i <head> (base.njk).
// Valget (auto, light, dark) lagres i nettleseren av menyen (common.js). Auto følger innstillingen på enheten.
// Det samme gjelder fargeblindvennlige farger (data-cvd). En egen fil og ikke et innebygd skript, så
// Content-Security-Policy kan holde seg på script-src 'self'.
(function () {
  var d = document.documentElement, choice = "auto";
  try { choice = localStorage.getItem("theme") || "auto"; } catch (e) {}
  var dark = choice === "dark" || (choice === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  d.setAttribute("data-theme", dark ? "dark" : "light");
  d.setAttribute("data-theme-choice", choice);
  try { if (localStorage.getItem("cvd") === "on") d.setAttribute("data-cvd", "on"); } catch (e) {}
})();
