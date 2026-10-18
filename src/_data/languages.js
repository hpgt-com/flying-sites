// The languages the site is available in. Norwegian is the main language: every page exists in Norwegian, and text
// missing in another language is shown in Norwegian. New language: add it here and create src/_i18n/<code>.json
// (same keys as nb.json). prefix is the start of the URL ("/en/sites/ryten/"); Norwegian has none. slugs translate the
// first URL segment (keyed by the Norwegian names): /flysteder/ryten/ becomes /en/sites/ryten/, /tarn/ becomes /en/towers/, /om/ becomes /en/about/, /vaer/ becomes /en/weather/.
export default [
  { code: "nb", name: "Norsk", locale: "nb_NO", prefix: "", slugs: {} },
  { code: "en", name: "English", locale: "en_GB", prefix: "/en", slugs: { flysteder: "sites", tarn: "towers", om: "about", vaer: "weather" } },
];
