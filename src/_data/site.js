export default {
  title: "HPGT flysteder",
  url: "https://flysteder.hpgt.com",
  hpgtUrl: "https://hpgt.com",
  repoUrl: "https://github.com/hpgt-com/flying-sites",
  // The front-page map zooms to the launches in this region. Sites further away (Lofoten, Andøya …) are in
  // the list and search, and the map can be zoomed out to them.
  homeRegion: "Harstad og Kvæfjord",
  // Visitor statistics (GoatCounter): anonymous, no cookies. See src/assets/js/goatcounter.js.
  goatcounter: "https://hpgt-flysteder.goatcounter.com/count",
  // The weather service on Cloudflare (workers/forecast): the MET forecast, renewed every few minutes. The pages use it
  // when it is newer than the forecast from the build. Must also be in connect-src in base.njk.
  forecastUrl: "https://forecast.hpgt.workers.dev/forecast.json",
  // Form for suggesting changes. Until we have our own form it goes to GitHub issues.
  suggestChangeUrl: "https://github.com/hpgt-com/flying-sites/issues/new",
};
