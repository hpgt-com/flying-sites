// The web app manifest (lib/pwa.js), one per language: /manifest.webmanifest and /en/manifest.webmanifest.
// Linked from base.njk, so «Add to home screen» opens the front page in the language the visitor uses.
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
