// HTML-validering av det bygde nettstedet (npm run check:html, og sjekken av PR-er). Starter fra de anbefalte reglene.
// Reglene som er slått av under, står med begrunnelse, så de kan slås på igjen når grunnen forsvinner.

export default {
  extends: ["html-validate:recommended"],
  rules: {
    // Formatering fra Nunjucks-malene, ikke feil.
    "no-trailing-whitespace": "off",
    "doctype-style": "off",
    // Vil ha &nbsp; i telefonnumrene på siden om tårnene. Numrene er korte, og linjeskift gjør ingen skade.
    "tel-non-breaking": "off",
    // Kartbeholderne fra Leaflet er <div role="region"> med en etikett, som er riktig for et kart.
    "prefer-native-element": ["error", { exclude: ["region"] }],
  },
};
