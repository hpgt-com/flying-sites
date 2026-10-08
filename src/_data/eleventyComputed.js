// Språket for hver side. Sider som finnes på flere språk pagineres over src/_data/languages.js med
// alias «language» (forsiden, stedssidene, tårn). Andre sider er norske.
export default {
  lang: (data) => data.language?.code ?? "nb",
  t: (data) => data.i18n[data.language?.code ?? "nb"],
};
