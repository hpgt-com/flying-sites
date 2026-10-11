import { test } from "node:test";
import assert from "node:assert/strict";
import { isAutomatedAuthor, lastModified } from "../lib/git.js";

test("AI assistants and bots count as automated authors", () => {
  assert.equal(isAutomatedAuthor("Claude", "noreply@anthropic.com"), true);
  assert.equal(isAutomatedAuthor("dependabot[bot]", "49699333+dependabot[bot]@users.noreply.github.com"), true);
  assert.equal(isAutomatedAuthor("github-actions[bot]", "41898282+github-actions[bot]@users.noreply.github.com"), true);
  assert.equal(isAutomatedAuthor("Kristoffer D. Hofstad", "22492302+krishofs@users.noreply.github.com"), false);
});

test("last modified never shows an automated author", () => {
  const result = lastModified("src/sites/sollifjellet/index.md");
  if (!result) return; // not a Git repo
  assert.notEqual(result.name, "Claude");
  assert.ok(!String(result.name).includes("[bot]"));
});
