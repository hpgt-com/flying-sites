// ESLint: the recommended rules only, to catch what the tests cannot (an undefined name, an unused variable, a
// typo in a branch no test reaches). Run with `npm run lint`; the PR check runs it. No formatting rules.
import js from "@eslint/js";

// The names the browser scripts share through globalThis (src/assets/js), and what the pages and Leaflet give them.
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
  { ignores: ["_site/**", "node_modules/**", "workers/data/node_modules/**", ".cache/**", "review/**", "src/assets/vendor/**"] },
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // The errors thrown on are written for the logs and the status, with the cause in the text.
      "preserve-caught-error": "off",
    },
  },
  // Node: the build, the scripts, the tests and the data service (ES modules).
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
  // The browser checks run code in the page (page.evaluate), so they use the browser's names too.
  {
    files: ["scripts/check-a11y.mjs", "scripts/check-behaviour.mjs", "scripts/check-budget.mjs"],
    languageOptions: { globals: browserGlobals },
  },
  // The browser scripts: plain scripts, one IIFE each, sharing through globalThis.
  {
    files: ["src/assets/js/**/*.js"],
    languageOptions: { ecmaVersion: 2020, sourceType: "script", globals: browserGlobals },
  },
  // The service worker (assembled by src/sw.11ty.js with the values it needs): a plain script in the worker's scope.
  {
    files: ["lib/service-worker.js"],
    languageOptions: { ecmaVersion: 2020, sourceType: "script", globals: { ...browserGlobals, self: "readonly" } },
  },
  // GoatCounter's own count script (kept as upstream has it), which sets up its global.
  {
    files: ["src/assets/js/goatcounter.js"],
    languageOptions: { globals: { goatcounter: "writable" } },
  },
];
