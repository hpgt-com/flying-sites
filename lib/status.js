import languages from "../src/_data/languages.js";

// Language names in Norwegian for the status page (which is in Norwegian).
const LANGUAGE_WORDS = { en: "engelsk" };

// Per-site status for the maintenance status page /status/: reviewed, own page, and what is missing.
// Replaces MANGLER.csv, which had to be kept up to date by hand.

// The build finds images by file name (lib/site-images.js), not in the site file.
const hasImage = (d, field) => (d.derived?.images ?? []).some((i) => i.field === field);

// If a parking spot is less than 300 m from the launch and less than 50 m lower (as at Utstrand and Samaåsen),
// no walking route is needed. The parking must have an elevation (`masl`, from Kartverket). Without it a walking
// route is required, so parking right below a steep launch (as at Dale, 63 m lower) is not let off.
const NEAR_PARKING_M = 300;
const NEAR_PARKING_CLIMB_M = 50;
function parkingAtLaunch(d) {
  const l = d.launch;
  const launchMasl = d.elevation?.launch_masl;
  if (!l || launchMasl == null) return false;
  const m = (a) => Math.hypot((a.lat - l.lat) * 111320, (a.lon - l.lon) * 111320 * Math.cos(l.lat * Math.PI / 180));
  return (d.parking ?? []).some((p) => p.masl != null && m(p) < NEAR_PARKING_M && launchMasl - p.masl < NEAR_PARKING_CLIMB_M);
}

// The text under a heading in the site file (## Start, ## Landing). Empty, or only a placeholder such as
// «Landingsbeskrivelse mangler», counts as missing.
function sectionMissing(body, heading) {
  const m = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(body ?? "");
  const text = m?.[1].trim() ?? "";
  return !text || /\bmangler\b/i.test(text);
}

// What is checked, in fixed order. `key` is the stable key (English), `label` the text on the status page.
// `missing` returns true when the information is missing.
const CHECKS = [
  { key: "level", label: "nivå", missing: (d) => !d.level },
  // Sites without a fixed landing (`no_fixed_landing: true`) lack neither landing nor landing photo.
  { key: "landing", label: "landing", missing: (d) => !d.no_fixed_landing && !(d.landings ?? []).length },
  { key: "parking", label: "parkering", missing: (d) => !(d.parking ?? []).length },
  // Parking on the map, but no description of where (parking_text).
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

// Translations (index.<lang>.md, lib/translations.js): «engelsk tekst» (translation_en) when missing,
// «engelsk tekst utdatert» (translation_en_outdated) when index.md has changed since the translation.
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
    // [{ key, label }] for what is missing. The keys are used in code and tests, the labels on the page.
    missing: [...CHECKS.filter((c) => c.missing(d, site.rawInput)).map(({ key, label }) => ({ key, label })), ...translationChecks(d)],
  };
}

// Summary: how many sites are reviewed, have their own page, and how many lack each item.
export function statusSummary(sites) {
  // Unreviewed sites first, since those need follow-up. Otherwise alphabetical.
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
