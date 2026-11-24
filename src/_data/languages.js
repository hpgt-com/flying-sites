// Språkene siden finnes på. Norsk er hovedspråket: alle sider finnes på norsk, og tekst som mangler på et
// annet språk, vises på norsk. Nytt språk: legg det til her og lag src/_i18n/<code>.json
// (samme nøkler som nb.json). prefix er starten på URL-en ("/en/sites/ryten/"); norsk har ingen. slugs oversetter
// første ledd i URL-en (med de norske navnene som nøkler): /flysteder/ryten/ blir /en/sites/ryten/,
// /tarn/ blir /en/towers/, /om/ blir /en/about/, /vaer/ blir /en/weather/, /meld-fra/ blir /en/report/,
// /flyaktivitet/ blir /en/flying-activity/, /nytt/ blir /en/whats-new/.
export default [
  { code: "nb", name: "Norsk", locale: "nb_NO", prefix: "", slugs: {} },
  { code: "en", name: "English", locale: "en_GB", prefix: "/en", slugs: { flysteder: "sites", tarn: "towers", om: "about", vaer: "weather", "meld-fra": "report", flyaktivitet: "flying-activity", nytt: "whats-new" } },
];
