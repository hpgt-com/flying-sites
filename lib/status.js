// Status per sted til vedlikeholdssiden /status/: gjennomgått, egen side og hva som mangler.
// Erstatter MANGLER.csv, som måtte holdes oppdatert for hånd.

// Bildene finnes av bygget ut fra filnavnet (lib/site-images.js), ikke i stedsfilen.
const hasImage = (d, field) => (d.derived?.images ?? []).some((i) => i.field === field);

// Ligger en parkering under 300 m fra starten, og under 50 m lavere (som på Utstrand og Samaåsen), trengs
// ingen gangrute. Høyden må stå i parkeringen (`masl`, fra Kartverket). Uten den kreves gangrute, så en
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

// Teksten under en overskrift i stedsfilen (## Start, ## Landing). Tom, eller bare en plassholder som
// «Landingsbeskrivelse mangler», regnes som manglende.
function sectionMissing(body, heading) {
  const m = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(body ?? "");
  const text = m?.[1].trim() ?? "";
  return !text || /\bmangler\b/i.test(text);
}

// Det som sjekkes, i fast rekkefølge. `missing` returnerer true når opplysningen mangler.
const CHECKS = [
  { label: "nivå", missing: (d) => !d.level },
  { label: "landing", missing: (d) => !(d.landings ?? []).length },
  { label: "parkering", missing: (d) => !(d.parking ?? []).length },
  { label: "gangrute", missing: (d) => !(d.access?.routes ?? []).some((r) => r.file) && !parkingAtLaunch(d) },
  { label: "starttekst", missing: (d, body) => sectionMissing(body, "Start") },
  { label: "landingstekst", missing: (d, body) => sectionMissing(body, "Landing") },
  { label: "høyder", missing: (d) => d.elevation?.launch_masl == null || d.elevation?.landing_masl == null },
  { label: "startbilde", missing: (d) => !hasImage(d, "takeoff") },
  { label: "landingsbilde", missing: (d) => !hasImage(d, "landing") },
  { label: "oversiktsbilde", missing: (d) => !hasImage(d, "overview") },
  { label: "luftrom", missing: (d) => !(d.airspace ?? []).length && !d.derived?.airspace },
  { label: "yr_id", missing: (d) => !d.external?.yr_id },
  { label: "flightlog_id", missing: (d) => !d.external?.flightlog_id },
];

export function siteStatus(site) {
  const d = site.data;
  const reviewed = d.status === "gjennomgått" && d.reviewed?.by && d.reviewed?.date;
  return {
    id: d.id,
    name: d.name,
    url: site.url,
    reviewed: reviewed ? { by: d.reviewed.by, date: d.reviewed.date } : null,
    missing: CHECKS.filter((c) => c.missing(d, site.rawInput)).map((c) => c.label),
  };
}

// Samlet oversikt: hvor mange som er gjennomgått, har egen side, og hvor mange som mangler hver ting.
export function statusSummary(sites) {
  // Ikke gjennomgåtte først, siden det er dem som skal følges opp. Ellers alfabetisk.
  const rows = sites.map(siteStatus)
    .sort((a, b) => Number(!!a.reviewed) - Number(!!b.reviewed) || a.name.localeCompare(b.name, "nb"));
  return {
    rows,
    total: rows.length,
    reviewed: rows.filter((r) => r.reviewed).length,
    missingCounts: CHECKS.map((c) => ({ label: c.label, count: rows.filter((r) => r.missing.includes(c.label)).length }))
      .filter((c) => c.count > 0),
  };
}
