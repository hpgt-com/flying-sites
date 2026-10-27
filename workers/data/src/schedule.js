// Minutes between runs per source, on the schedule that runs every minute (wrangler.toml). The stations report every
// minute or two, so they are fetched every minute (a measurement already stored is kept once). The forecast changes
// about once an hour, and each run fetches 6 launches (sources/forecast.js). MET's stations report every ten minutes
// (sources/frost.js). The winds aloft: 2 launches every 10 minutes (sources/windgram.js). How well the forecast hit is
// worked out twice an hour from what is already stored (sources/verify.js). The paragliders in the air are counted every
// minute (sources/flights.js), so a short flight is seen too and a flight's track has a point a minute.
// The restore of a new, empty store from the latest backup (store.js restore) is tried every minute until it has
// succeeded once, which index.js reads from the health state.
export const INTERVALS = { forecast: 5, stations: 1, met: 10, windgram: 10, verify: 30, flights: 1, backup: 1440, grid: 180, gridWide: 360, ognDdb: 1440, restore: 1 };
// Minute within the interval each source runs on. All sources run in the same invocation, and the free plan gives one
// invocation 10 ms of CPU in all, so the heavier ones (the forecast, MET, the winds aloft) never share a minute: the
// forecast at :00 and :05, MET at :03, the winds aloft at :07 (and so on every ten minutes), the verification at :09 and :39.
// The flying activity is light (one small answer from OGN, mostly empty) and runs on the even minutes. The backup
// (backup.js) once a day at 02:14 UTC, a minute no other heavy source has; its work is done in the store, not here. OGN's
// list of devices that must not be tracked (for the APRS reserve, aprs.js) once a day at 05:14 UTC, also in the store.
// The forecast grids (sources/grid.js): the close one every three hours at :21 (00:21, 03:21 …), the wide one every six
// at :51 (00:51, 06:51 …), so they never share Open-Meteo's minute; their work is done in the store too.
export const OFFSETS = { forecast: 0, stations: 0, met: 3, windgram: 7, verify: 9, flights: 0, backup: 134, grid: 21, gridWide: 51, ognDdb: 314, restore: 0 };

// The sources that are caught up when their minute was missed (Cloudflare's Cron Triggers are best effort, and a run
// can be skipped or cut off): the daily ones and the forecast grids, where a missed minute would otherwise mean a day
// (or hours) without a backup, a no-track list or a grid. The others run so often that the next minute makes up for it.
export const CATCH_UP = ["backup", "ognDdb", "grid", "gridWide"];

// Whether the source should run on the scheduled minute (scheduledTime in milliseconds), or, for the sources in
// CATCH_UP, when it last ran (lastTried, ISO time from the health state, index.js) more than an interval and a minute
// ago. A daily source whose last run failed (failed, from the same state) is tried again after RETRY_MINUTES rather
// than a day later, so a bad day at the other end does not leave a day without a backup or a no-track list; a source
// that keeps failing is still tried once an hour, not every minute, since a failed run counts as tried.
export const RETRY_MINUTES = 60;
export function due(name, time, lastTried, failed) {
  if (Math.floor(time / 60000) % INTERVALS[name] === (OFFSETS[name] ?? 0)) return true;
  if (!CATCH_UP.includes(name) || !lastTried) return false;
  const wait = failed ? Math.min(RETRY_MINUTES, INTERVALS[name]) : INTERVALS[name];
  return time - Date.parse(lastTried) >= (wait + 1) * 60000;
}
