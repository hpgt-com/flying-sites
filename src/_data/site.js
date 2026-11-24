export default {
  title: "HPGT flysteder",
  url: "https://flysteder.hpgt.com",
  hpgtUrl: "https://hpgt.com",
  // Statussiden (Upptime i hpgt-com/status): sjekker denne siden, hpgt.com og datatjenesten hvert 5. minutt,
  // fra GitHub.
  statusUrl: "https://status.hpgt.com/",
  repoUrl: "https://github.com/hpgt-com/flying-sites",
  // Kartet på forsiden zoomer til startene i denne regionen. Steder lenger unna (Lofoten, Andøya …) står i
  // lista og søket, og kartet kan zoomes ut til dem.
  homeRegion: "Harstad og Kvæfjord",
  // Content-Security-Policy, på ett sted: i en <meta> på hver side (base.njk) og som HTTP-header på Cloudflare
  // (src/headers.njk → _headers, med frame-ancestors, som en meta-tagg ikke kan sette). Verter sidene laster
  // fra, må stå her.
  csp: "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: https://hpgt-flysteder.goatcounter.com https://cache.kartverket.no https://*.tile.opentopomap.org https://thermal.kk7.ch https://tiles.maps.eox.at https://hoydedata.no https://tilecache.rainviewer.com https://www.yr.no; font-src 'self'; connect-src 'self' https://hpgt-flysteder.goatcounter.com https://api.rainviewer.com https://data.hpgt.com; manifest-src 'self'; worker-src 'self'; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests",
  // Hvor nettleserne sender rapporter om brudd på CSP (workers/data/src/csp-report.js): report-uri og report-to i
  // headerne (src/headers.njk), ikke i <meta>, som ikke kan bære dem.
  cspReportUrl: "https://data.hpgt.com/v1/csp-report",
  // Besøksstatistikk (GoatCounter): anonym, uten informasjonskapsler. Se src/assets/js/goatcounter.js.
  goatcounter: "https://hpgt-flysteder.goatcounter.com/count",
  // Datatjenesten på Cloudflare (workers/data): MET-prognosen, fornyet med få minutters mellomrom, og
  // Holfuy-stasjonene.
  // Sidene bruker prognosen når den er nyere enn den fra bygget. Må også stå i connect-src i base.njk.
  forecastUrl: "https://data.hpgt.com/v1/forecast.json",
  stationsUrl: "https://data.hpgt.com/v1/stations.json",
  windgramUrl: "https://data.hpgt.com/v1/windgram.json",
  verificationUrl: "https://data.hpgt.com/v1/verification.json",
  liveUrl: "https://data.hpgt.com/v1/live.json",
  flightsUrl: "https://data.hpgt.com/v1/flights.json",
  flightLogUrl: "https://data.hpgt.com/v1/flight-log.json",
  // Prognosegridene for kartlagene «Prognose» på forsiden (forecast-layer.js).
  gridUrl: "https://data.hpgt.com/v1/grid.json",
  gridWideUrl: "https://data.hpgt.com/v1/grid-wide.json",
  // «Meld fra om endring» på stedssidene (report.js, workers/data/src/report.js). Skjemaet vises bare når
  // nøkkelen for Turnstile er satt (den er offentlig; hemmeligheten er TURNSTILE_SECRET i Cloudflare), se
  // docs/operations.md.
  reportUrl: "https://data.hpgt.com/v1/report",
  turnstileSiteKey: "0x4AAAAAAFbKpuCOckRpqREy",
  // Skjema for å foreslå endringer. Til vi har vårt eget skjema, går det til GitHub-issues.
  suggestChangeUrl: "https://github.com/hpgt-com/flying-sites/issues/new",
};
