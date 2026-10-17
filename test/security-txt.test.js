// Tests for security.txt (lib/security-txt.js). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { securityTxt } from "../lib/security-txt.js";

const txt = securityTxt({
  siteUrl: "https://flysteder.hpgt.com",
  repoUrl: "https://github.com/hpgt-com/flying-sites",
  now: Date.parse("2026-10-17T08:00:00Z"),
});

test("has the fields RFC 9116 requires, and points to private vulnerability reporting", () => {
  assert.match(txt, /^Contact: https:\/\/github\.com\/hpgt-com\/flying-sites\/security\/advisories\/new$/m);
  assert.match(txt, /^Expires: 2027-10-17T00:00:00\.000Z$/m);
  assert.match(txt, /^Canonical: https:\/\/flysteder\.hpgt\.com\/\.well-known\/security\.txt$/m);
  assert.match(txt, /^Policy: https:\/\/github\.com\/hpgt-com\/flying-sites\/blob\/main\/SECURITY\.md$/m);
});

test("expires less than a year after the build, as the RFC requires", () => {
  const expires = Date.parse(/^Expires: (.+)$/m.exec(txt)[1]);
  const built = Date.parse("2026-10-17T08:00:00Z");
  assert.ok(expires > built && expires - built <= 366 * 24 * 3600 * 1000);
});
