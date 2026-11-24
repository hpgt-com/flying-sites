// Navngivning av bilder samlet inn for flystedene, så flysted, type og retning kan leses ut av filnavnet:
//
//   <Location>_Takeoff_<Direction>_<Nr>_<Original>.jpg   Storlitinden_Takeoff_SE_1_DSC04968.jpg
//   <Location>_Landing_[SPG_]<Nr>_<Original>.jpg          Storlitinden_Landing_1_DSC05012.jpg
//                                                        Sollifjellet_Landing_SPG_1_DSC00978.jpg
//   <Location>_Overview_<Nr>_<Original>.jpg              Storlitinden_Overview_1_DJI_0042.jpg (oversiktsbilde;
//                                                        Aerial godtas også: Storlitinden_Aerial_1_DJI_0042.jpg)
//
// Location er navnet på flystedet uten mellomrom, bindestrek eller æ/ø/å («Melå aksla» → MelaAksla eller MelaaAksla).
// Direction bare for Takeoff: en av de engelske kodene, retningen du står mot når du starter. SPG er et valgfritt
// merke på Landing for landinger bare for SPG; alle landinger er PG som standard, så PG skrives ikke.
// Original er filnavnet fra kameraet og kan selv inneholde understrek (DJI_0042).
// Brukes av `npm run images` (scripts/optimize-images.mjs).

// Aerial og Overview betyr det samme: oversiktsbildet. Aerial godtas fordi mange bilder alt bruker det navnet.
export const PHOTO_TYPES = { Takeoff: "takeoff", Landing: "landing", Overview: "overview", Aerial: "overview" };
export const PHOTO_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const NORWEGIAN = { NØ: "NE", Ø: "E", SØ: "SE", SV: "SW", V: "W", NV: "NW" };
const NAME = /^([^_]+)_([^_]+)_(.+)\.(jpe?g|png|webp)$/i;

// «Melå aksla» → «melaaksla». æ kan skrives ae, a eller e, ø som oe eller o, og å som aa eller a, så alle
// variantene godtas. Den første er kortformen (o og a), som brukes i forslag ved feil navn.
const LETTERS = { æ: ["ae", "a", "e"], ø: ["o", "oe"], å: ["a", "aa"] };
function keys(text) {
  let variants = [String(text).toLowerCase()];
  for (const [letter, options] of Object.entries(LETTERS)) {
    if (!variants[0].includes(letter)) continue;
    variants = variants.flatMap((v) => options.map((o) => v.replaceAll(letter, o)));
  }
  return variants.map((v) => v.replace(/[^a-z0-9]/g, ""));
}

// Ser ut som et bilde etter konvensjonen (flysted og type på riktig form), selv om innholdet kan være feil.
export function looksLikePhotoName(filename) {
  const m = NAME.exec(filename);
  return !!m && Object.keys(PHOTO_TYPES).some((t) => t.toLowerCase() === m[2].toLowerCase());
}

// Tolker filnavnet. sites: [{ id, name }]. Gir { siteId, field, type, direction, nr, original }, eller kaster en
// feil som sier hva som er galt og hvordan det skal skrives.
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
