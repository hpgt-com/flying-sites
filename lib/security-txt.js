// security.txt (RFC 9116) at /.well-known/security.txt: where to report a vulnerability. Generated on every build,
// so Expires (required, at most a year ahead) is always about a year after the last build and never runs out
// while the site is built. If builds stop, it expires a year later, which is the point of the field.

const DAY = 24 * 3600 * 1000;

export function securityTxt({ siteUrl, repoUrl, now = Date.now() }) {
  const expires = new Date(now + 365 * DAY);
  expires.setUTCHours(0, 0, 0, 0);
  return [
    `Contact: ${repoUrl}/security/advisories/new`,
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: no, en",
    `Canonical: ${siteUrl}/.well-known/security.txt`,
    `Policy: ${repoUrl}/blob/main/SECURITY.md`,
    "",
  ].join("\n");
}
