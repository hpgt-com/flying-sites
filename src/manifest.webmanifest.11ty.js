// Web app-manifestet (lib/pwa.js), ett per språk: /manifest.webmanifest og /en/manifest.webmanifest.
// Lenket fra base.njk, så «Legg til på startskjermen» åpner forsiden på språket den besøkende bruker.
import { manifest } from "../lib/pwa.js";

export default class {
  data() {
    return {
      pagination: { data: "languages", size: 1, alias: "language" },
      permalink: (data) => `${data.language.prefix}/manifest.webmanifest`,
      eleventyExcludeFromCollections: true,
    };
  }

  render({ language }) {
    return JSON.stringify(manifest(language.code, this.url("/"), this.url(`${language.prefix}/`)), null, 2);
  }
}
