import { test } from "node:test";
import assert from "node:assert/strict";
import { isAutomatedAuthor, lastModified } from "../lib/git.js";

test("KI-assistenter og boter regnes som automatiske forfattere", () => {
  assert.equal(isAutomatedAuthor("Claude", "noreply@anthropic.com"), true);
  assert.equal(isAutomatedAuthor("dependabot[bot]", "49699333+dependabot[bot]@users.noreply.github.com"), true);
  assert.equal(isAutomatedAuthor("github-actions[bot]", "41898282+github-actions[bot]@users.noreply.github.com"), true);
  assert.equal(isAutomatedAuthor("Kristoffer D. Hofstad", "22492302+krishofs@users.noreply.github.com"), false);
});

test("sist endret viser aldri en automatisk forfatter", () => {
  const result = lastModified("src/flysteder/sollifjellet/index.md");
  if (!result) return; // ikke et Git-repo
  assert.notEqual(result.name, "Claude");
  assert.ok(!String(result.name).includes("[bot]"));
});
