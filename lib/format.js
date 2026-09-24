// Felles formatering og oppslag for maler og byggelogikk.

export const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

const DIRECTION_LABELS = {
  N: "N", NE: "NØ", E: "Ø", SE: "SØ", S: "S", SW: "SV", W: "V", NW: "NV",
};

const DIRECTION_WORDS = {
  N: "nord", NE: "nordøst", E: "øst", SE: "sørøst", S: "sør", SW: "sørvest", W: "vest", NW: "nordvest",
};

export const CATEGORIES = ["PG", "SPG", "PPG"];
export const LEVELS = ["PP2", "PP3", "PP4", "PP5"];

// Norsk forkortelse for en retningskode (NE -> NØ).
export function directionLabel(code) {
  return DIRECTION_LABELS[code] ?? code;
}

// Norsk ord for en retningskode (NE -> nordøst).
export function directionWord(code) {
  return DIRECTION_WORDS[code] ?? code;
}

export function sortDirections(list = []) {
  return [...list].sort((a, b) => DIRECTIONS.indexOf(a) - DIRECTIONS.indexOf(b));
}

// "primary" | "possible" | "none" for én retning på et sted (wind_directions).
export function directionType(windDirections, code) {
  if (windDirections?.primary?.includes(code)) return "primary";
  if (windDirections?.possible?.includes(code)) return "possible";
  return "none";
}

// Tall med norsk desimalkomma.
export function formatNumber(n, decimals = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  return Number(n).toFixed(decimals).replace(".", ",");
}

// dd.mm.åååå
export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (x) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function feetToMeters(ft) {
  return Math.round(ft * 0.3048);
}

// Høydegrense fra luftromsdata: { value, unit: FT|FL|M, ref: GND|MSL|STD } -> "4500 ft", "FL105", "bakken".
export function formatLimit(limit) {
  if (!limit) return "";
  if (limit.ref === "GND" && !limit.value) return "bakken";
  if (limit.unit === "FL") return `FL${limit.value}`;
  const text = limit.unit === "M" ? `${limit.value} m` : `${limit.value} ft`;
  return limit.ref === "GND" ? `${text} over bakken` : text;
}

// Omtrentlig høyde over havet for en grense i fot over havet, ellers tom.
export function limitMasl(limit) {
  if (!limit || limit.ref !== "MSL") return "";
  return `ca. ${limit.unit === "M" ? limit.value : feetToMeters(limit.value)} moh`;
}

const SOURCE_LABELS = {
  flightlog: "Flightlog",
  "flightlog/lokalkunnskap": "Flightlog og lokalkunnskap",
  manuell: "registrert manuelt",
  gpx: "fra gangrute (GPX)",
  "gammel side": "den gamle flystedsoversikten",
  IPPC: "IPPC",
};

// Leselig tekst for en `source`-verdi i stedsfilene.
export function sourceLabel(source) {
  return SOURCE_LABELS[source] ?? source;
}
