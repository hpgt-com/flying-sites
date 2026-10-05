// "Sist endret" per fil fra Git. Krever full historikk (fetch-depth: 0 i CI).
//
// Er siste endring gjort av en KI-assistent eller en bot, vises personen som godkjente endringen:
// forfatteren av merge-commiten som tok den inn i main (den som merget PR-en). Finnes ingen slik merge
// (squash eller direkte push), vises bare datoen.

import { execFileSync } from "node:child_process";

const cache = new Map();

// KI-assistenter og boter skal ikke stå som «endret av» på siden.
export function isAutomatedAuthor(name, email) {
  const n = String(name || "").toLowerCase();
  const e = String(email || "").toLowerCase();
  return n.includes("[bot]") || e.includes("[bot]") || e === "noreply@anthropic.com" || n === "claude";
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function lastModified(file) {
  if (cache.has(file)) return cache.get(file);
  let result = null;
  try {
    const output = git(["log", "-1", "--format=%H%x1f%aI%x1f%an%x1f%ae", "--", file]);
    if (output) {
      const [hash, date, name, email] = output.split("\x1f");
      result = { date, name };
      if (isAutomatedAuthor(name, email)) {
        // Den eldste merge-commiten i hovedlinjen som ikke er eldre enn endringen, er den som tok den inn.
        const merges = git(["log", "--first-parent", "--merges", "--format=%aI%x1f%an%x1f%ae", `${hash}..HEAD`]);
        const merge = merges ? merges.split("\n").pop().split("\x1f") : null;
        result = merge && !isAutomatedAuthor(merge[1], merge[2]) ? { date: merge[0], name: merge[1] } : { date, name: null };
      }
    }
  } catch {
    // ikke et Git-repo, eller git mangler
  }
  cache.set(file, result);
  return result;
}
