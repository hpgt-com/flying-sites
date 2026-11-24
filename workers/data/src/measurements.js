// Feltene i en stasjonsmåling, de samme for alle kilder til målt vær (Holfuy nå, flere senere), med enheten i
// kolonnenavnet i arkivet. Hver måling har også kilden ("holfuy") og stasjonens nummer der. Slik passer målinger fra
// flere leverandører i én tabell uten at stasjoner med samme nummer blandes. En stasjon uten en sensor lar feltet være
// null. Verdier en kilde sender som ikke har et felt her, beholdes i `extra` (et objekt med tall), så en ny type sensor
// ikke går tapt før den får sitt eget felt. Et felt som legges til her, får sin egen kolonne i lageret (store.js legger
// til kolonner som mangler) og i arkivet.
export const FIELDS = [
  { key: "dir", csv: "direction_deg" },
  { key: "speed", csv: "speed_ms" },
  { key: "gust", csv: "gust_ms" },
  { key: "min", csv: "min_ms" },
  { key: "temperature", csv: "temperature_c" },
  { key: "humidity", csv: "humidity_pct" },
  { key: "pressure", csv: "pressure_hpa" },
  { key: "rain", csv: "rain_mm" },
];

// Høyst så mange ekstra verdier per måling, med enkle navn, så et rart svar ikke kan fylle lageret.
const MAX_EXTRA = 20;
const EXTRA_KEY = /^[A-Za-z0-9_.]{1,40}$/;

export const num = (v) =>
  typeof v === "number" && Number.isFinite(v) ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v)
      : null;

// Tallene i et objekt som ikke er i `known`, ett nivå ned ("battery", "wind.max"), som { name: number }.
// null når det ikke er noen.
export function extraValues(object, known, prefix = "") {
  const out = {};
  let count = 0;
  for (const [key, value] of Object.entries(object ?? {})) {
    const name = prefix + key;
    if (known.has(name) || count >= MAX_EXTRA) continue;
    if (value && typeof value === "object" && !Array.isArray(value) && !prefix) {
      for (const [k, v] of Object.entries(extraValues(value, known, name + ".") ?? {})) {
        if (count < MAX_EXTRA) { out[k] = v; count++; }
      }
    } else if (num(value) !== null && EXTRA_KEY.test(name)) {
      out[name] = num(value);
      count++;
    }
  }
  return count ? out : null;
}
