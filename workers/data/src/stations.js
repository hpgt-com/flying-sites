// Holfuy-stasjonene datatjenesten henter (sources/holfuy.js). id: stasjonens nummer hos Holfuy (i adressen
// holfuy.com/en/weather/<id>). name: navnet på nettstedet (Holfuys eget navn når det utelates). model: stasjonstypen
// (for eksempel "Holfuy 2.0"), når den er kjent, så målinger fra ulike stasjonstyper kan skilles. site: flystedet
// stasjonen hører til (mappenavnet under src/sites/), når den har et. near: flysteder nær nok, og på omtrent samme
// høyde, til at stasjonen sier noe om dem også ({ site, km }). Sidene deres viser den som en stasjon i nærheten, og
// hvor godt varselet traff der, regnes ut mot den. API-nøkkelen er hemmeligheten HOLFUY_KEY i Cloudflare, aldri her.
//
// Klubbens nøkkel gir tilgang til HPGT Heia (490, på flystedet Heia) og Modellflystripa (820).
export const HOLFUY_STATIONS = [
  // Starten på Hinnstein (558 moh) er 1,3 km fra stasjonen (472 moh).
  { id: 490, site: "heia", near: [{ site: "hinnstein", km: 1.3 }] },
  { id: 820 },
];

// METs stasjoner (sources/frost.js) finner MET selv innenfor området til flystedene, så de står ikke her. En
// MET-stasjon som hører til et flysted, kobles til det her, med METs nummer (SN…) og mappen til stedet, som `site`
// over. Da viser stedssiden den og bruker den i vurderingen av timen nå.
export const MET_STATION_SITES = {
  // «Sætertinden ved tjeldsundet», 1095 moh, omtrent 100 m fra starten (1089 moh). Måler én gang i timen.
  SN87772: "saetertinden",
};
// METs stasjoner som finnes i området, men som ikke skal vises (METs nummer, "SN…"), for eksempel en som ikke sier noe
// nyttig for flyging.
export const MET_EXCLUDE = [];

// Flystedene med egen stasjon, eller en i nærheten (near), for hvor godt varselet traff der (sources/verify.js):
// { site, source, station }, med nøkkelen til kilden som i lageret (measurements.js).
export function siteLinks() {
  return [
    ...HOLFUY_STATIONS.filter((s) => s.site).map((s) => ({ site: s.site, source: "holfuy", station: String(s.id) })),
    ...HOLFUY_STATIONS.flatMap((s) => (s.near ?? []).map((n) => ({ site: n.site, source: "holfuy", station: String(s.id) }))),
    ...Object.entries(MET_STATION_SITES).map(([station, site]) => ({ site, source: "met", station })),
  ];
}
