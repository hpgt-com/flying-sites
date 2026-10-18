// The Holfuy stations the data service fetches (sources/holfuy.js). id: the station's number at Holfuy (in the address
// holfuy.com/en/weather/<id>). name: the name on the site (Holfuy's own name when left out). model: the kind of station
// (for example "Holfuy 2.0"), when known, so measurements from different station types can be told apart. site: the
// flying site the station belongs to (its folder name under src/sites/), when it has one. The API key is the secret HOLFUY_KEY in
// Cloudflare, never here.
//
// The club's key gives access to HPGT Heia (490, on the flying site Heia) and Modellflystripa (820).
export const HOLFUY_STATIONS = [
  { id: 490, site: "heia" },
  { id: 820 },
];
