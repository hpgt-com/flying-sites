// "Sist endret" per fil fra Git. Krever full historikk (fetch-depth: 0 i CI).
//
// Er siste endring gjort av en KI-assistent eller en bot, vises personen som godkjente endringen:
// forfatteren av merge-commiten som tok den inn i main (den som merget PR-en). Finnes ingen slik merge
// (squash eller direkte push), vises bare datoen.

import fs from "node:fs";
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

// Commits som ikke skal telle som «Sist endret»: mekaniske endringer i mange stedsfiler samtidig (for eksempel
// nye navn på verdier), listet i .git-blame-ignore-revs. GitHub bruker samme fil til å skjule dem i «blame».
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

// Siste commit som faktisk endret innholdet i filen. Historikken følges gjennom flyttinger (--follow), og ren
// flytting uten endringer (R100, som da src/flysteder/ ble src/sites/) teller ikke, heller ikke commits i
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
