// The Holfuy stations the data service fetches (sources/holfuy.js). id: the station's number at Holfuy (in the address
// holfuy.com/en/weather/<id>). name: the name on the site (Holfuy's own name when left out). site: the flying site the
// station belongs to (its folder name under src/sites/), when it has one. The API key is the secret HOLFUY_KEY in
// Cloudflare, never here.
//
// The club's key gives access to HPGT Heia and Modellflystripa.
export const HOLFUY_STATIONS = [
  { id: 490 },
  { id: 820 },
];
