// Navngiving av bilder som samles inn til flystedene, så sted, type og retning kan leses fra filnavnet:
//
//   <Location>_Takeoff_<Direction>_<Nr>_<Original>.jpg   Storlitinden_Takeoff_SE_1_DSC04968.jpg
//   <Location>_Landing_<Nr>_<Original>.jpg               Storlitinden_Landing_1_DSC05012.jpg
//   <Location>_Aerial_<Nr>_<Original>.jpg                Storlitinden_Aerial_1_DJI_0042.jpg
//
// Location er stedsnavnet uten mellomrom, bindestrek og æ/ø/å («Melå aksla» → MelaAksla). Retning bare for
// Takeoff, én av de engelske kodene, og det er retningen man ser mot når man starter. Original er kameraets
// filnavn og kan selv inneholde understrek (DJI_0042). Brukes av `npm run images` (scripts/optimize-images.mjs).

export const PHOTO_TYPES = { Takeoff: "launch", Landing: "landing", Aerial: "air" };
export const PHOTO_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const NORWEGIAN = { NØ: "NE", Ø: "E", SØ: "SE", SV: "SW", V: "W", NV: "NW" };
const NAME = /^([^_]+)_([^_]+)_(.+)\.(jpe?g|png|webp)$/i;

// «Melå aksla» → «melaaksla». æ kan skrives ae, a eller e, så alle tre godtas.
function keys(text) {
  const base = String(text).toLowerCase().replace(/ø/g, "o").replace(/å/g, "a");
  return ["ae", "a", "e"].map((ae) => base.replace(/æ/g, ae).replace(/[^a-z0-9]/g, ""));
}

// Ser ut som et bilde etter konvensjonen (sted og type stemmer i formen), selv om innholdet kan være feil.
export function looksLikePhotoName(filename) {
  const m = NAME.exec(filename);
  return !!m && Object.keys(PHOTO_TYPES).some((t) => t.toLowerCase() === m[2].toLowerCase());
}

// Tolker filnavnet. sites: [{ id, name }]. Gir { siteId, field, type, direction, nr, original } eller kaster
// en feil med en melding som sier hva som er galt og hvordan det skal skrives.
export function parsePhotoName(filename, sites) {
  const m = NAME.exec(filename);
  if (!m) throw new Error(`${filename}: skal hete <Sted>_<Takeoff|Landing|Aerial>_[<Retning>_]<Nr>_<Original>.jpg`);
  const [, location, typeRaw, rest] = m;

  const type = Object.keys(PHOTO_TYPES).find((t) => t.toLowerCase() === typeRaw.toLowerCase());
  if (!type) throw new Error(`${filename}: ukjent type «${typeRaw}». Bruk Takeoff, Landing eller Aerial.`);

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

  const nr = Number(parts.shift());
  if (!Number.isInteger(nr) || nr < 1) throw new Error(`${filename}: mangler nummer (1, 2, 3 …) etter ${direction ? "retningen" : "typen"}.`);
  const original = parts.join("_");
  if (!original) throw new Error(`${filename}: mangler kameraets filnavn til slutt (for eksempel DSC04968).`);

  return { siteId: site.id, siteName: site.name, field: PHOTO_TYPES[type], type, direction, nr, original };
}
