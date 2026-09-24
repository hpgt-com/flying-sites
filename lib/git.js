// "Sist endret" per fil fra Git. Krever full historikk (fetch-depth: 0 i CI).

import { execFileSync } from "node:child_process";

const cache = new Map();

export function lastModified(file) {
  if (cache.has(file)) return cache.get(file);
  let result = null;
  try {
    const output = execFileSync("git", ["log", "-1", "--format=%aI%x1f%an", "--", file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (output) {
      const [date, name] = output.split("\x1f");
      result = { date, name };
    }
  } catch {
    // ikke et Git-repo, eller git mangler
  }
  cache.set(file, result);
  return result;
}
