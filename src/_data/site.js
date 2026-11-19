export default {
  title: "HPGT flysteder",
  url: "https://flysteder.hpgt.com",
  hpgtUrl: "https://hpgt.com",
  repoUrl: "https://github.com/hpgt-com/flying-sites",
  // The front-page map zooms to the launches in this region. Sites further away (Lofoten, Andøya …) are in
  // the list and search, and the map can be zoomed out to them.
  homeRegion: "Harstad og Kvæfjord",
  // The Content-Security-Policy, in one place: in a <meta> in every page (base.njk) and as an HTTP header on Cloudflare
  // (src/headers.njk → _headers, with frame-ancestors, which a meta tag cannot set). Hosts the pages load from must be here.
  csp: "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: https://hpgt-flysteder.goatcounter.com https://cache.kartverket.no https://*.tile.opentopomap.org https://thermal.kk7.ch https://tiles.maps.eox.at https://hoydedata.no https://tilecache.rainviewer.com https://www.yr.no; font-src 'self'; connect-src 'self' https://hpgt-flysteder.goatcounter.com https://api.rainviewer.com https://data.hpgt.com; manifest-src 'self'; worker-src 'self'; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests",
  // Visitor statistics (GoatCounter): anonymous, no cookies. See src/assets/js/goatcounter.js.
  goatcounter: "https://hpgt-flysteder.goatcounter.com/count",
  // The data service on Cloudflare (workers/data): the MET forecast, renewed every few minutes, and the Holfuy stations.
  // The pages use the forecast when it is newer than the one from the build. Must also be in connect-src in base.njk.
  forecastUrl: "https://data.hpgt.com/v1/forecast.json",
  stationsUrl: "https://data.hpgt.com/v1/stations.json",
  windgramUrl: "https://data.hpgt.com/v1/windgram.json",
  verificationUrl: "https://data.hpgt.com/v1/verification.json",
  liveUrl: "https://data.hpgt.com/v1/live.json",
  flightsUrl: "https://data.hpgt.com/v1/flights.json",
  flightLogUrl: "https://data.hpgt.com/v1/flight-log.json",
  // The forecast grids for the map layers «Prognose» on the home page (forecast-layer.js).
  gridUrl: "https://data.hpgt.com/v1/grid.json",
  gridWideUrl: "https://data.hpgt.com/v1/grid-wide.json",
  // «Meld fra om endring» on the site pages (report.js, workers/data/src/report.js). The form is shown only when the
  // Turnstile site key is set (public; the secret is TURNSTILE_SECRET in Cloudflare), see docs/operations.md.
  reportUrl: "https://data.hpgt.com/v1/report",
  turnstileSiteKey: "0x4AAAAAAFbKpuCOckRpqREy",
  // Form for suggesting changes. Until we have our own form it goes to GitHub issues.
  suggestChangeUrl: "https://github.com/hpgt-com/flying-sites/issues/new",
};
