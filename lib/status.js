// Status per sted til vedlikeholdssiden /status/: gjennomgått, egen side og hva som mangler.
// Erstatter MANGLER.csv, som måtte holdes oppdatert for hånd.

// Det som sjekkes, i fast rekkefølge. `missing` returnerer true når opplysningen mangler.
const CHECKS = [
  { label: "nivå", missing: (d) => !d.level },
  { label: "landing", missing: (d) => !(d.landings ?? []).length },
  { label: "parkering", missing: (d) => !(d.parking ?? []).length },
  { label: "gangrute", missing: (d) => !(d.access?.routes ?? []).some((r) => r.file) },
  { label: "høyder", missing: (d) => d.elevation?.launch_masl == null || d.elevation?.landing_masl == null },
  { label: "oversiktsbilde", missing: (d) => !d.images?.overview },
  { label: "startbilde", missing: (d) => !d.images?.launch },
  { label: "landingsbilde", missing: (d) => !d.images?.landing },
  { label: "luftbilde", missing: (d) => !d.images?.air },
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
    missing: CHECKS.filter((c) => c.missing(d)).map((c) => c.label),
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
