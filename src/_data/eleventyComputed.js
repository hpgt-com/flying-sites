// Språket på hver side. Sider som finnes på flere språk, paginerer over src/_data/languages.js med
// alias "language" (forsiden, stedssidene, tårn). Andre sider er på norsk.
export default {
  lang: (data) => data.language?.code ?? "nb",
  t: (data) => data.i18n[data.language?.code ?? "nb"],
};
