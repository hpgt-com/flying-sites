// security.txt (RFC 9116): hvordan man melder fra om en sårbarhet, på /.well-known/security.txt (lib/security-txt.js).
import { securityTxt } from "../lib/security-txt.js";

export default class {
  data() {
    return { permalink: "/.well-known/security.txt", eleventyExcludeFromCollections: true };
  }

  render({ site }) {
    return securityTxt({ siteUrl: site.url, repoUrl: site.repoUrl });
  }
}
