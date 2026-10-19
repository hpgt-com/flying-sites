// Minutes between runs per source, on the schedule that runs every minute (wrangler.toml). The stations report every
// minute or two, so they are fetched every minute (a measurement already stored is kept once). The forecast changes
// about once an hour, and each run fetches 6 launches (sources/forecast.js). MET's stations report every ten minutes
// (sources/frost.js). The winds aloft: 2 launches every 10 minutes (sources/windgram.js).
export const INTERVALS = { forecast: 5, stations: 1, met: 10, windgram: 10 };

// Whether the source should run on the scheduled minute (scheduledTime in milliseconds).
export function due(name, time) {
  return Math.floor(time / 60000) % INTERVALS[name] === 0;
}
