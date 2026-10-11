// The language of each page. Pages available in several languages paginate over src/_data/languages.js with
// alias "language" (front page, site pages, towers). Other pages are Norwegian.
export default {
  lang: (data) => data.language?.code ?? "nb",
  t: (data) => data.i18n[data.language?.code ?? "nb"],
};
