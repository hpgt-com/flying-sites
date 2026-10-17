// HTML validation of the built site (npm run check:html, and the PR check). Starts from the recommended rules.
// The rules turned off below are listed with the reason, so they can be turned back on when the reason goes away.

export default {
  extends: ["html-validate:recommended"],
  rules: {
    // Formatting from the Nunjucks templates, not errors.
    "no-trailing-whitespace": "off",
    "doctype-style": "off",
    // Wants &nbsp; inside the phone numbers on the towers page. The numbers are short, and wrapping does no harm.
    "tel-non-breaking": "off",
    // The Leaflet map containers are <div role="region"> with a label, which is correct for a map.
    "prefer-native-element": ["error", { exclude: ["region"] }],
  },
};
