// The fields of a station measurement, the same for every source of measured weather (Holfuy now, more later), with the
// unit as the archive's column name. Every measurement also has its source ("holfuy") and the station's number there, so
// measurements from several providers fit one table without mixing up stations with the same number. A station without a sensor leaves the field null. Values a source sends that have no
// field here are kept in `extra` (an object of numbers), so a new kind of sensor is not lost before it gets its own
// field; a field added here gets its own column in the store (store.js adds missing columns) and the archive.
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

// At most this many extra values per measurement, with plain names, so an odd answer cannot fill the store.
const MAX_EXTRA = 20;
const EXTRA_KEY = /^[A-Za-z0-9_.]{1,40}$/;

export const num = (v) =>
  typeof v === "number" && Number.isFinite(v) ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v)
      : null;

// The numbers in an object that are not in `known`, one level deep ("battery", "wind.max"), as { name: number }.
// null when there are none.
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
