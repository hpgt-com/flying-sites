// Minutes between runs per source, on the schedule that runs every minute (wrangler.toml). The stations report every
// minute or two, so they are fetched every minute (a measurement already stored is kept once). The forecast changes
// about once an hour, and each run fetches 6 launches (sources/forecast.js). MET's stations report every ten minutes
// (sources/frost.js). The winds aloft: 2 launches every 10 minutes (sources/windgram.js). How well the forecast hit is
// worked out twice an hour from what is already stored (sources/verify.js).
export const INTERVALS = { forecast: 5, stations: 1, met: 10, windgram: 10, verify: 30 };
// Minute within the interval each source runs on. All sources run in the same invocation, and the free plan gives one
// invocation 10 ms of CPU in all, so the heavier ones (the forecast, MET, the winds aloft) never share a minute: the
// forecast at :00 and :05, MET at :03, the winds aloft at :07 (and so on every ten minutes), the verification at :09 and :39.
export const OFFSETS = { forecast: 0, stations: 0, met: 3, windgram: 7, verify: 9 };

// Whether the source should run on the scheduled minute (scheduledTime in milliseconds).
export function due(name, time) {
  return Math.floor(time / 60000) % INTERVALS[name] === (OFFSETS[name] ?? 0);
}
