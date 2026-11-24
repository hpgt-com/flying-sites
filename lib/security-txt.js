// security.txt (RFC 9116) på /.well-known/security.txt: hvor du melder fra om en sårbarhet. Lages ved hver bygging,
// så Expires (påkrevd, maks ett år fram) alltid er omtrent ett år etter siste bygging og aldri går ut mens
// nettstedet bygges. Stopper byggingen, går den ut ett år senere, og det er poenget med feltet.

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
