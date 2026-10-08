// Språkene siden finnes på. Norsk er hovedspråket: alle sider finnes på norsk, og tekst som mangler i et
// annet språk vises på norsk. Nytt språk: legg det til her og lag src/_i18n/<code>.json (samme nøkler som nb.json).
// prefix er starten på adressen («/en/flysteder/ryten/»). Norsk har ingen.
export default [
  { code: "nb", name: "Norsk", locale: "nb_NO", prefix: "" },
  { code: "en", name: "English", locale: "en_GB", prefix: "/en" },
];
