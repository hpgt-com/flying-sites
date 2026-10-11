// Naming of photos collected for the sites, so site, type and direction can be read from the file name:
//
//   <Location>_Takeoff_<Direction>_<Nr>_<Original>.jpg   Storlitinden_Takeoff_SE_1_DSC04968.jpg
//   <Location>_Landing_[SPG_]<Nr>_<Original>.jpg          Storlitinden_Landing_1_DSC05012.jpg
//                                                        Sollifjellet_Landing_SPG_1_DSC00978.jpg
//   <Location>_Overview_<Nr>_<Original>.jpg              Storlitinden_Overview_1_DJI_0042.jpg (overview photo;
//                                                        Aerial is also accepted: Storlitinden_Aerial_1_DJI_0042.jpg)
//
// Location is the site name without spaces, hyphens or æ/ø/å («Melå aksla» → MelaAksla or MelaaAksla). Direction only
// for Takeoff: one of the English codes, the direction you face when launching. SPG is an optional tag on Landing
// for SPG-only landings; all landings are PG by default, so PG is not written.
// Original is the camera's file name and may itself contain underscores (DJI_0042).
// Used by `npm run images` (scripts/optimize-images.mjs).

// Aerial and Overview mean the same: the overview photo. Aerial is accepted because many photos already use that name.
export const PHOTO_TYPES = { Takeoff: "takeoff", Landing: "landing", Overview: "overview", Aerial: "overview" };
export const PHOTO_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const NORWEGIAN = { NØ: "NE", Ø: "E", SØ: "SE", SV: "SW", V: "W", NV: "NW" };
const NAME = /^([^_]+)_([^_]+)_(.+)\.(jpe?g|png|webp)$/i;

// «Melå aksla» → «melaaksla». æ may be written ae, a or e, ø as oe or o, and å as aa or a, so all
// variants are accepted. The first is the short form (o and a), used in suggestions for wrong names.
const LETTERS = { æ: ["ae", "a", "e"], ø: ["o", "oe"], å: ["a", "aa"] };
function keys(text) {
  let variants = [String(text).toLowerCase()];
  for (const [letter, options] of Object.entries(LETTERS)) {
    if (!variants[0].includes(letter)) continue;
    variants = variants.flatMap((v) => options.map((o) => v.replaceAll(letter, o)));
  }
  return variants.map((v) => v.replace(/[^a-z0-9]/g, ""));
}

// Looks like a photo following the convention (site and type in the right shape), even if the content may be wrong.
export function looksLikePhotoName(filename) {
  const m = NAME.exec(filename);
  return !!m && Object.keys(PHOTO_TYPES).some((t) => t.toLowerCase() === m[2].toLowerCase());
}

// Parses the file name. sites: [{ id, name }]. Returns { siteId, field, type, direction, nr, original }, or throws
// an error saying what is wrong and how it should be written.
export function parsePhotoName(filename, sites) {
  const m = NAME.exec(filename);
  if (!m) throw new Error(`${filename}: skal hete <Sted>_<Takeoff|Landing|Overview>_[<Retning>_][SPG_]<Nr>_<Original>.jpg`);
  const [, location, typeRaw, rest] = m;

  const type = Object.keys(PHOTO_TYPES).find((t) => t.toLowerCase() === typeRaw.toLowerCase());
  if (!type) throw new Error(`${filename}: ukjent type «${typeRaw}». Bruk Takeoff, Landing eller Overview (Aerial godtas også).`);

  const wanted = keys(location)[0];
  const site = sites.find((s) => keys(s.name).includes(wanted) || keys(s.id).includes(wanted));
  if (!site) {
    const near = sites.filter((s) => keys(s.name)[0].startsWith(wanted.slice(0, 4))).map((s) => s.name);
    throw new Error(`${filename}: fant ikke stedet «${location}».` + (near.length ? ` Mente du ${near.join(" eller ")}?` : ""));
  }

  const parts = rest.split("_");
  let direction = null;
  if (type === "Takeoff") {
    const dir = parts.shift();
    if (PHOTO_DIRECTIONS.includes(dir)) direction = dir;
    else if (NORWEGIAN[dir]) throw new Error(`${filename}: bruk engelske retninger, ${NORWEGIAN[dir]} i stedet for ${dir}.`);
    else throw new Error(`${filename}: Takeoff trenger én retning (${PHOTO_DIRECTIONS.join(", ")}), fikk «${dir}».`);
  } else if (PHOTO_DIRECTIONS.includes(parts[0]) || NORWEGIAN[parts[0]]) {
    throw new Error(`${filename}: retning brukes bare på Takeoff. Skriv ${location}_${type}_<Nr>_<Original>.`);
  }

  let category = null;
  if (parts[0]?.toUpperCase() === "PG") throw new Error(`${filename}: PG er standard og skrives ikke. Fjern «PG_» fra navnet.`);
  if (parts[0]?.toUpperCase() === "SPG") {
    if (type !== "Landing") throw new Error(`${filename}: SPG-merket brukes bare på Landing.`);
    category = "SPG";
    parts.shift();
  }

  const nr = Number(parts.shift());
  if (!Number.isInteger(nr) || nr < 1) throw new Error(`${filename}: mangler nummer (1, 2, 3 …) etter ${direction ? "retningen" : category ? "kategorien" : "typen"}.`);
  const original = parts.join("_");
  if (!original) throw new Error(`${filename}: mangler kameraets filnavn til slutt (for eksempel DSC04968).`);

  return { siteId: site.id, siteName: site.name, field: PHOTO_TYPES[type], type, direction, category, nr, original };
}
