// Minutes between runs per source, on the schedule that runs every minute (wrangler.toml). The stations report every
// minute or two, so they are fetched every minute (a measurement already stored is kept once). The forecast changes
// about once an hour, and each run fetches 6 launches (sources/forecast.js). MET's stations report every ten minutes
// (sources/frost.js). The winds aloft: 2 launches every 10 minutes (sources/windgram.js). How well the forecast hit is
// worked out twice an hour from what is already stored (sources/verify.js). The paragliders in the air are counted every
// other minute (sources/flights.js), so a short flight is seen too.
export const INTERVALS = { forecast: 5, stations: 1, met: 10, windgram: 10, verify: 30, flights: 2, backup: 1440, grid: 180, gridWide: 360, ognDdb: 1440 };
// Minute within the interval each source runs on. All sources run in the same invocation, and the free plan gives one
// invocation 10 ms of CPU in all, so the heavier ones (the forecast, MET, the winds aloft) never share a minute: the
// forecast at :00 and :05, MET at :03, the winds aloft at :07 (and so on every ten minutes), the verification at :09 and :39.
// The flying activity is light (one small answer from OGN, mostly empty) and runs on the even minutes. The backup
// (backup.js) once a day at 02:14 UTC, a minute no other heavy source has; its work is done in the store, not here. OGN's
// list of devices that must not be tracked (for the APRS reserve, aprs.js) once a day at 05:14 UTC, also in the store.
// The forecast grids (sources/grid.js): the close one every three hours at :21 (00:21, 03:21 …), the wide one every six
// at :51 (00:51, 06:51 …), so they never share Open-Meteo's minute; their work is done in the store too.
export const OFFSETS = { forecast: 0, stations: 0, met: 3, windgram: 7, verify: 9, flights: 0, backup: 134, grid: 21, gridWide: 51, ognDdb: 314 };

// The sources that are caught up when their minute was missed (Cloudflare's Cron Triggers are best effort, and a run
// can be skipped or cut off): the daily ones and the forecast grids, where a missed minute would otherwise mean a day
// (or hours) without a backup, a no-track list or a grid. The others run so often that the next minute makes up for it.
export const CATCH_UP = ["backup", "ognDdb", "grid", "gridWide"];

// Whether the source should run on the scheduled minute (scheduledTime in milliseconds), or, for the sources in
// CATCH_UP, when it last ran (lastTried, ISO time from the health state, index.js) more than an interval and a minute
// ago. A source that keeps failing is tried again once an interval, not every minute, since a failed run counts as tried.
export function due(name, time, lastTried) {
  if (Math.floor(time / 60000) % INTERVALS[name] === (OFFSETS[name] ?? 0)) return true;
  if (!CATCH_UP.includes(name) || !lastTried) return false;
  return time - Date.parse(lastTried) >= (INTERVALS[name] + 1) * 60000;
}
