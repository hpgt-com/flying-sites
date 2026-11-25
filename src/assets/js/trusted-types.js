// Trusted Types-policyene for sidene. Lastes før alle andre skript (src/_includes/base.njk), fordi Leaflet bruker
// innerHTML allerede når biblioteket lastes. CSP-en håndhever Trusted Types (src/headers.njk): en streng som settes inn
// som HTML eller brukes som skriptadresse, må gå gjennom en av disse policyene, ellers stopper nettleseren den.
//
// «default» brukes av koden vi ikke styrer selv (Leaflet), og slipper bare gjennom de HTML-strengene Leaflet faktisk
// lager: ren tekst (navnene i lagvelgeren, målestokken), lenker med en https-adresse og tekst (attribusjonen), de faste
// <span>-ene i knappene og skillet i attribusjonen, testen <svg/> og radioknappen i lagvelgeren. Alt annet blokkeres.
// Vår egen kode setter aldri HTML fra strenger (den bygger med DOM-metoder).
//
// «fs-script-url» brukes av vår egen kode for skriptadressene sidene laster: Turnstile (report.js), service workeren
// (pwa.js) og skriptene bak kartlagene, som hentes første gang laget slås på (common.js, /assets/js/*.js med ?v=
// fra byggingen). Andre adresser gir en feil.
(function () {
  "use strict";
  var tt = globalThis.trustedTypes;
  var identity = function (s) { return s; };
  if (!tt || !tt.createPolicy) {
    globalThis.FSTrustedTypes = { scriptURL: identity };
    return;
  }

  // Tekst uten «<», eller <a href="https://…">tekst</a> (eventuelt med target="_blank" rel="noopener", som i
  // kildene for piloter og prognose), eller de faste <span aria-hidden="true">-ene i Leaflet (skillet | i
  // attribusjonen, + og − i zoomknappene, × i lukkeknappen på popup-er).
  var SAFE_HTML = /^(?:[^<]|<a href="https:\/\/[^"<>\s]+"(?: target="_blank" rel="noopener")?>[^<]*<\/a>|<span aria-hidden="true">(?:\||\+|&#x2212;|&#215;)<\/span>)*$/;
  var RADIO = /^<input type="radio" class="leaflet-control-layers-selector" name="leaflet-base-layers_\d+"(?: checked="checked")?\/>$/;
  tt.createPolicy("default", {
    createHTML: function (s) {
      return s === "<svg/>" || RADIO.test(s) || SAFE_HTML.test(s) ? s : null;
    },
  });

  var TURNSTILE = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  var scripts = tt.createPolicy("fs-script-url", {
    createScriptURL: function (s) {
      if (s === TURNSTILE) return s;
      var url = new URL(s, location.href);
      if (url.origin === location.origin && !url.hash) {
        if (/\/sw\.js$/.test(url.pathname) && !url.search) return s;
        if (/\/assets\/js\/[\w-]+\.js$/.test(url.pathname) && /^(\?v=[0-9a-f]+)?$/.test(url.search)) return s;
      }
      throw new TypeError("Skriptadressen er ikke tillatt: " + s);
    },
  });
  globalThis.FSTrustedTypes = { scriptURL: function (s) { return scripts.createScriptURL(s); } };
})();
