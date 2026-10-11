// Sets the colour mode before the page is drawn, so it does not flash light first. Loaded synchronously in <head> (base.njk).
// The choice (auto, light, dark) is stored in the browser by the menu (common.js); auto follows the device setting.
// The same applies to colour-blind-friendly colours (data-cvd). A separate file rather than an inline script, so the
// Content-Security-Policy can stay at script-src 'self'.
(function () {
  var d = document.documentElement, choice = "auto";
  try { choice = localStorage.getItem("theme") || "auto"; } catch (e) {}
  var dark = choice === "dark" || (choice === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  d.setAttribute("data-theme", dark ? "dark" : "light");
  d.setAttribute("data-theme-choice", choice);
  try { if (localStorage.getItem("cvd") === "on") d.setAttribute("data-cvd", "on"); } catch (e) {}
})();
