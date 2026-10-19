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
  // The data service on Cloudflare (workers/data): the MET forecast, renewed every few minutes, and the Holfuy stations.
  // The pages use the forecast when it is newer than the one from the build. Must also be in connect-src in base.njk.
  forecastUrl: "https://data.hpgt.workers.dev/v1/forecast.json",
  stationsUrl: "https://data.hpgt.workers.dev/v1/stations.json",
  windgramUrl: "https://data.hpgt.workers.dev/v1/windgram.json",
  verificationUrl: "https://data.hpgt.workers.dev/v1/verification.json",
  // «Meld fra om endring» on the site pages (report.js, workers/data/src/report.js). The form is shown only when the
  // Turnstile site key is set (public; the secret is TURNSTILE_SECRET in Cloudflare), see docs/operations.md.
  reportUrl: "https://data.hpgt.workers.dev/v1/report",
  turnstileSiteKey: "",
  // Form for suggesting changes. Until we have our own form it goes to GitHub issues.
  suggestChangeUrl: "https://github.com/hpgt-com/flying-sites/issues/new",
};
