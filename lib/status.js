import languages from "../src/_data/languages.js";

// Språknavn på norsk for statussiden (som er på norsk).
const LANGUAGE_WORDS = { en: "engelsk" };

// Status per flysted for vedlikeholdssiden /status/: gjennomgått, egen side, og hva som mangler.
// Erstatter MANGLER.csv, som måtte holdes oppdatert for hånd.

// Byggingen finner bildene etter filnavn (lib/site-images.js), ikke i flystedsfilen.
const hasImage = (d, field) => (d.derived?.images ?? []).some((i) => i.field === field);

// Er en parkering mindre enn 300 m fra start og mindre enn 50 m lavere (som på Utstrand og Samaåsen), trengs
// ingen gangvei. Parkeringen må ha en høyde (`masl`, fra Kartverket). Uten den kreves en gangvei, så en
// parkering rett under en bratt start (som på Dale, 63 m lavere) ikke slipper unna.
const NEAR_PARKING_M = 300;
const NEAR_PARKING_CLIMB_M = 50;
function parkingAtLaunch(d) {
  const l = d.launch;
  const launchMasl = d.elevation?.launch_masl;
  if (!l || launchMasl == null) return false;
  const m = (a) => Math.hypot((a.lat - l.lat) * 111320, (a.lon - l.lon) * 111320 * Math.cos(l.lat * Math.PI / 180));
  return (d.parking ?? []).some((p) => p.masl != null && m(p) < NEAR_PARKING_M && launchMasl - p.masl < NEAR_PARKING_CLIMB_M);
}

// Teksten under en overskrift i flystedsfilen (## Start, ## Landing). Tom, eller bare en plassholder som
// «Landingsbeskrivelse mangler», regnes som manglende.
function sectionMissing(body, heading) {
  const m = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(body ?? "");
  const text = m?.[1].trim() ?? "";
  return !text || /\bmangler\b/i.test(text);
}

// Hva som sjekkes, i fast rekkefølge. `key` er den faste nøkkelen (engelsk), `label` teksten på statussiden.
// `missing` gir true når opplysningen mangler.
const CHECKS = [
  { key: "level", label: "nivå", missing: (d) => !d.level },
  // Flysteder uten fast landing (`no_fixed_landing: true`) mangler verken landing eller landingsbilde.
  { key: "landing", label: "landing", missing: (d) => !d.no_fixed_landing && !(d.landings ?? []).length },
  { key: "parking", label: "parkering", missing: (d) => !(d.parking ?? []).length },
  // Parkering på kartet, men ingen beskrivelse av hvor (parking_text).
  { key: "parking_text", label: "parkeringstekst", missing: (d) => (d.parking ?? []).length > 0 && !d.access?.parking_text },
  { key: "route", label: "gangrute", missing: (d) => !(d.access?.routes ?? []).some((r) => r.file) && !parkingAtLaunch(d) },
  { key: "launch_text", label: "starttekst", missing: (d, body) => sectionMissing(body, "Start") },
  { key: "landing_text", label: "landingstekst", missing: (d, body) => sectionMissing(body, "Landing") },
  { key: "elevations", label: "høyder", missing: (d) => d.elevation?.launch_masl == null || d.elevation?.landing_masl == null },
  { key: "launch_photo", label: "startbilde", missing: (d) => !hasImage(d, "takeoff") },
  { key: "landing_photo", label: "landingsbilde", missing: (d) => !d.no_fixed_landing && !hasImage(d, "landing") },
  { key: "overview_photo", label: "oversiktsbilde", missing: (d) => !hasImage(d, "overview") },
  { key: "airspace", label: "luftrom", missing: (d) => !(d.airspace ?? []).length && !d.derived?.airspace },
  { key: "yr_id", label: "yr_id", missing: (d) => !d.external?.yr_id },
  { key: "flightlog_id", label: "flightlog_id", missing: (d) => !d.external?.flightlog_id },
];

// Oversettelser (index.<lang>.md, lib/translations.js): «engelsk tekst» (translation_en) når den mangler,
// «engelsk tekst utdatert» (translation_en_outdated) når index.md er endret siden oversettelsen.
function translationChecks(d) {
  return languages.filter((l) => l.code !== "nb").flatMap((l) => {
    const label = `${LANGUAGE_WORDS[l.code] ?? l.name.toLowerCase()} tekst`;
    const tr = d.derived?.translations?.[l.code];
    if (!tr) return [{ key: `translation_${l.code}`, label }];
    return tr.outdated ? [{ key: `translation_${l.code}_outdated`, label: `${label} utdatert` }] : [];
  });
}

export function siteStatus(site) {
  const d = site.data;
  const reviewed = d.status === "reviewed" && d.reviewed?.by && d.reviewed?.date;
  return {
    id: d.id,
    name: d.name,
    url: site.url,
    reviewed: reviewed ? { by: d.reviewed.by, date: d.reviewed.date } : null,
    // [{ key, label }] for det som mangler. Nøklene brukes i kode og tester, tekstene på siden.
    missing: [...CHECKS.filter((c) => c.missing(d, site.rawInput)).map(({ key, label }) => ({ key, label })), ...translationChecks(d)],
  };
}

// Sammendrag: hvor mange flysteder som er gjennomgått og har egen side, og hvor mange som mangler hvert punkt.
export function statusSummary(sites) {
  // Flysteder som ikke er gjennomgått, først, siden de trenger oppfølging. Ellers alfabetisk.
  const rows = sites.map(siteStatus)
    .sort((a, b) => Number(!!a.reviewed) - Number(!!b.reviewed) || a.name.localeCompare(b.name, "nb"));
  return {
    rows,
    total: rows.length,
    reviewed: rows.filter((r) => r.reviewed).length,
    missingCounts: [...new Map([...CHECKS, ...rows.flatMap((r) => r.missing)].map((c) => [c.key, c.label]))]
      .map(([key, label]) => ({ key, label, count: rows.filter((r) => r.missing.some((m) => m.key === key)).length }))
      .filter((c) => c.count > 0),
  };
}
