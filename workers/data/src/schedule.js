// Minutes between runs per source, on the schedule that runs every minute (wrangler.toml). The stations report every
// minute or two, so they are fetched every minute (a measurement already stored is kept once). The forecast changes
// about once an hour, and each run fetches 6 launches (sources/forecast.js). MET's stations report every ten minutes
// (sources/frost.js). The winds aloft: 2 launches every 10 minutes (sources/windgram.js). How well the forecast hit is
// worked out twice an hour from what is already stored (sources/verify.js). The paragliders in the air are counted every
// other minute (sources/flights.js), so a short flight is seen too.
export const INTERVALS = { forecast: 5, stations: 1, met: 10, windgram: 10, verify: 30, flights: 2, backup: 1440, grid: 180, gridWide: 360 };
// Minute within the interval each source runs on. All sources run in the same invocation, and the free plan gives one
// invocation 10 ms of CPU in all, so the heavier ones (the forecast, MET, the winds aloft) never share a minute: the
// forecast at :00 and :05, MET at :03, the winds aloft at :07 (and so on every ten minutes), the verification at :09 and :39.
// The flying activity is light (one small answer from OGN, mostly empty) and runs on the even minutes. The backup
// (backup.js) once a day at 02:14 UTC, a minute no other heavy source has; its work is done in the store, not here.
// The forecast grids (sources/grid.js): the close one every three hours at :21 (00:21, 03:21 …), the wide one every six
// at :51 (00:51, 06:51 …), so they never share Open-Meteo's minute; their work is done in the store too.
export const OFFSETS = { forecast: 0, stations: 0, met: 3, windgram: 7, verify: 9, flights: 0, backup: 134, grid: 21, gridWide: 51 };

// Whether the source should run on the scheduled minute (scheduledTime in milliseconds).
export function due(name, time) {
  return Math.floor(time / 60000) % INTERVALS[name] === (OFFSETS[name] ?? 0);
}
