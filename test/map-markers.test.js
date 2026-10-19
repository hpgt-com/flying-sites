// The map markers keep Leaflet's position: absolute. A class used for a marker (L.divIcon's className) must not set
// another position in styles.css: position: relative put the weather stations and the pilots in the air in the page
// flow, each pushed down by the markers before it, so they sat in the wrong place and moved on zoom. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../src/assets/css/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const js = ["home.js", "site.js", "stations.js", "live.js", "common.js"].map((f) => fs.readFileSync(new URL(`../src/assets/js/${f}`, import.meta.url), "utf8")).join("\n");

test("no marker class sets its own position", () => {
  // The first class name given to each L.divIcon.
  const classes = new Set([...js.matchAll(/divIcon\(\{\s*className:\s*"([a-z-]+)/g)].map((m) => m[1]));
  for (const m of js.matchAll(/return "(station-marker)"/g)) classes.add(m[1]);
  assert.ok(classes.has("live-marker") && classes.has("station-marker"), "the marker classes are found");
  for (const name of classes) {
    // Rules whose selector is the class itself (not a part inside it, such as .station-marker__dial).
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = m[1].trim(), body = m[2];
      // The class is on the element the rule styles: in the last part of the selector, not on an ancestor.
      const subject = new RegExp(`\\.${name}(?![\\w-])[^\\s>+~]*$`);
      if (!selector.split(",").some((part) => subject.test(part.trim()))) continue;
      const pos = /(?:^|;)\s*position\s*:\s*([a-z]+)/.exec(body);
      assert.ok(!pos || pos[1] === "absolute", `${selector} sets position: ${pos && pos[1]}`);
    }
  }
});
