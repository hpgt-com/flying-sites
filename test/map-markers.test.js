// Kartmarkørene beholder Leaflets position: absolute. En klasse som brukes til en markør (className i L.divIcon), skal
// ikke sette en annen position i styles.css: position: relative la værstasjonene og pilotene i lufta i sideflyten, hver
// skjøvet ned av markørene før den, så de havnet på feil sted og flyttet seg ved zoom. Kjør med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../src/assets/css/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const js = ["home.js", "site.js", "stations.js", "live.js", "common.js"].map((f) => fs.readFileSync(new URL(`../src/assets/js/${f}`, import.meta.url), "utf8")).join("\n");

test("ingen markørklasse setter sin egen position", () => {
  // Det første klassenavnet gitt til hver L.divIcon.
  const classes = new Set([...js.matchAll(/divIcon\(\{\s*className:\s*"([a-z-]+)/g)].map((m) => m[1]));
  for (const m of js.matchAll(/return "(station-marker)"/g)) classes.add(m[1]);
  assert.ok(classes.has("live-marker") && classes.has("station-marker"), "markørklassene blir funnet");
  for (const name of classes) {
    // Regler der selektoren er selve klassen (ikke en del inni den, som .station-marker__dial).
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = m[1].trim(), body = m[2];
      // Klassen sitter på elementet regelen styler: i siste del av selektoren, ikke på en forelder.
      const subject = new RegExp(`\\.${name}(?![\\w-])[^\\s>+~]*$`);
      if (!selector.split(",").some((part) => subject.test(part.trim()))) continue;
      const pos = /(?:^|;)\s*position\s*:\s*([a-z]+)/.exec(body);
      assert.ok(!pos || pos[1] === "absolute", `${selector} setter position: ${pos && pos[1]}`);
    }
  }
});
