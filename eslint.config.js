// ESLint: bare de anbefalte reglene, for å fange det testene ikke kan (et navn som ikke er definert, en variabel som
// ikke brukes, en skrivefeil i en gren ingen test når). Kjør med `npm run lint`; sjekken av PR-er kjører den.
// Ingen regler for formatering.
import js from "@eslint/js";

// Navnene nettleserskriptene deler via globalThis (src/assets/js), og det sidene og Leaflet gir dem.
const browserGlobals = {
  window: "readonly", document: "readonly", navigator: "readonly", location: "readonly", history: "readonly",
  fetch: "readonly", Request: "readonly", Response: "readonly", Headers: "readonly", URL: "readonly", URLSearchParams: "readonly",
  AbortController: "readonly", AbortSignal: "readonly", setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly",
  clearInterval: "readonly", requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly", console: "readonly",
  localStorage: "readonly", sessionStorage: "readonly", matchMedia: "readonly", Intl: "readonly", performance: "readonly",
  Node: "readonly", Element: "readonly", HTMLElement: "readonly", Event: "readonly", CustomEvent: "readonly", KeyboardEvent: "readonly",
  MutationObserver: "readonly", IntersectionObserver: "readonly", ResizeObserver: "readonly", DOMParser: "readonly",
  Image: "readonly", FormData: "readonly", Blob: "readonly", TextEncoder: "readonly", TextDecoder: "readonly", crypto: "readonly",
  caches: "readonly", self: "readonly", globalThis: "readonly", L: "readonly", screen: "readonly", getComputedStyle: "readonly",
  scrollTo: "readonly", innerWidth: "readonly", innerHeight: "readonly", alert: "readonly", structuredClone: "readonly",
  DOMMatrixReadOnly: "readonly", parent: "readonly", PerformanceObserver: "readonly",
};

export default [
  { ignores: ["_site/**", "node_modules/**", "workers/data/node_modules/**", ".cache/**", "src/assets/vendor/**"] },
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Feilene som kastes videre, er skrevet for loggene og statusen, med årsaken i teksten.
      "preserve-caught-error": "off",
    },
  },
  // Node: byggingen, skriptene, testene og datatjenesten (ES-moduler).
  {
    files: ["lib/**/*.js", "scripts/**/*.mjs", "test/**/*.{js,mjs}", "workers/data/src/**/*.js", "eleventy.config.js", "eslint.config.js", "src/_data/**/*.js", "src/**/*.11ty.js", "src/**/*.11tydata.js", ".htmlvalidate.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: {
      process: "readonly", console: "readonly", Buffer: "readonly", URL: "readonly", URLSearchParams: "readonly", fetch: "readonly",
      Request: "readonly", Response: "readonly", Headers: "readonly", FormData: "readonly", AbortSignal: "readonly", AbortController: "readonly",
      setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly", TextEncoder: "readonly",
      TextDecoder: "readonly", crypto: "readonly", globalThis: "readonly", structuredClone: "readonly", performance: "readonly",
      caches: "readonly", queueMicrotask: "readonly", Intl: "readonly", btoa: "readonly", atob: "readonly",
      ReadableStream: "readonly", WritableStream: "readonly",
    } },
  },
  // Nettlesersjekkene kjører kode på siden (page.evaluate), så de bruker også navnene i nettleseren.
  {
    files: ["scripts/check-a11y.mjs", "scripts/check-behaviour.mjs", "scripts/check-budget.mjs"],
    languageOptions: { globals: browserGlobals },
  },
  // Nettleserskriptene: vanlige skript, én IIFE hver, som deler via globalThis.
  {
    files: ["src/assets/js/**/*.js"],
    languageOptions: { ecmaVersion: 2020, sourceType: "script", globals: browserGlobals },
  },
  // Service workeren (satt sammen av src/sw.11ty.js med verdiene den trenger): et vanlig skript i workerens omfang.
  {
    files: ["lib/service-worker.js"],
    languageOptions: { ecmaVersion: 2020, sourceType: "script", globals: { ...browserGlobals, self: "readonly" } },
  },
  // Telleskriptet til GoatCounter (beholdt slik det er hos opphavet), som setter opp sin globale variabel.
  {
    files: ["src/assets/js/goatcounter.js"],
    languageOptions: { globals: { goatcounter: "writable" } },
  },
];
