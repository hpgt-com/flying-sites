// The Holfuy stations the data service fetches (sources/holfuy.js). id: the station's number at Holfuy (in the address
// holfuy.com/en/weather/<id>). name: the name on the site (Holfuy's own name when left out). model: the kind of station
// (for example "Holfuy 2.0"), when known, so measurements from different station types can be told apart. site: the
// flying site the station belongs to (its folder name under src/sites/), when it has one. near: flying sites close
// enough, and at about the same height, for the station to say something about them too ({ site, km }): their page
// shows it as a station nearby, and how well the forecast hit there is worked out against it. The API key is the
// secret HOLFUY_KEY in Cloudflare, never here.
//
// The club's key gives access to HPGT Heia (490, on the flying site Heia) and Modellflystripa (820).
export const HOLFUY_STATIONS = [
  // Hinnstein's launch (558 moh) is 1,3 km from the station (472 moh).
  { id: 490, site: "heia", near: [{ site: "hinnstein", km: 1.3 }] },
  { id: 820 },
];

// MET's stations (sources/frost.js) are found by MET itself within the area of the flying sites, so they are not listed
// here. A MET station that belongs to a flying site is linked to it here, by MET's number (SN…) and the site's folder,
// as `site` above: that site page then shows it and uses it for the assessment of the hour now.
export const MET_STATION_SITES = {
  // «Sætertinden ved tjeldsundet», 1095 moh, about 100 m from the launch (1089 moh). Measures once an hour.
  SN87772: "saetertinden",
};
// MET's stations that are found in the area but should not be shown (MET's number, "SN…"), e.g. one that says nothing
// useful for flying.
export const MET_EXCLUDE = [];

// The flying sites with their own station, or one nearby (near), for how well the forecast hit there
// (sources/verify.js): { site, source, station }, with the source's key as in the store (measurements.js).
export function siteLinks() {
  return [
    ...HOLFUY_STATIONS.filter((s) => s.site).map((s) => ({ site: s.site, source: "holfuy", station: String(s.id) })),
    ...HOLFUY_STATIONS.flatMap((s) => (s.near ?? []).map((n) => ({ site: n.site, source: "holfuy", station: String(s.id) }))),
    ...Object.entries(MET_STATION_SITES).map(([station, site]) => ({ site, source: "met", station })),
  ];
}
