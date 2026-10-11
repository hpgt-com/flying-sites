// «Sist endret» per file from Git. Requires full history (fetch-depth: 0 in CI).
//
// If the last change was made by an AI assistant or a bot, the person who approved it is shown instead:
// the author of the merge commit that brought it into main (whoever merged the PR). If there is no such
// merge (squash or direct push), only the date is shown.

import fs from "node:fs";
import { execFileSync } from "node:child_process";

const cache = new Map();

// AI assistants and bots must not appear as «endret av» on the page.
export function isAutomatedAuthor(name, email) {
  const n = String(name || "").toLowerCase();
  const e = String(email || "").toLowerCase();
  return n.includes("[bot]") || e.includes("[bot]") || e === "noreply@anthropic.com" || n === "claude";
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

// Commits that must not count as «Sist endret»: mechanical changes across many site files at once (e.g.
// renamed values), listed in .git-blame-ignore-revs. GitHub uses the same file to hide them in blame.
let ignored = null;
function ignoredRevs() {
  if (ignored) return ignored;
  try {
    ignored = new Set(fs.readFileSync(".git-blame-ignore-revs", "utf8").split("\n").map((l) => l.trim()).filter((l) => /^[0-9a-f]{40}$/.test(l)));
  } catch {
    ignored = new Set();
  }
  return ignored;
}

// Last commit that actually changed the file's content. History is followed through renames (--follow); pure
// renames without changes (R100, as when src/flysteder/ became src/sites/) do not count, nor do commits in
// .git-blame-ignore-revs.
function lastContentCommit(file) {
  const output = git(["log", "--follow", "-M", "--format=%x1e%H%x1f%aI%x1f%an%x1f%ae", "--name-status", "--", file]);
  for (const entry of output.split("\x1e")) {
    const [head, ...rest] = entry.trim().split("\n");
    if (!head) continue;
    const status = rest.map((l) => l.trim()).find(Boolean) ?? "";
    const [hash] = head.split("\x1f");
    if (/^R100\t/.test(status) || ignoredRevs().has(hash)) continue;
    return head;
  }
  return "";
}

export function lastModified(file) {
  if (cache.has(file)) return cache.get(file);
  let result = null;
  try {
    const output = lastContentCommit(file);
    if (output) {
      const [hash, date, name, email] = output.split("\x1f");
      result = { date, name };
      if (isAutomatedAuthor(name, email)) {
        // The oldest first-parent merge commit that is not older than the change is the one that brought it in.
        const merges = git(["log", "--first-parent", "--merges", "--format=%aI%x1f%an%x1f%ae", `${hash}..HEAD`]);
        const merge = merges ? merges.split("\n").pop().split("\x1f") : null;
        result = merge && !isAutomatedAuthor(merge[1], merge[2]) ? { date: merge[0], name: merge[1] } : { date, name: null };
      }
    }
  } catch {
    // not a Git repo, or git is missing
  }
  cache.set(file, result);
  return result;
}
