// Minutes between runs per source, on the schedule that runs every minute (wrangler.toml). The stations report every
// minute or two, so they are fetched every minute (a measurement already stored is kept once). The forecast changes
// about once an hour, and each run fetches 6 launches (sources/forecast.js). MET's stations report every ten minutes
// (sources/frost.js). Open-Meteo's winds aloft change every few hours (sources/windgram.js).
export const INTERVALS = { forecast: 5, stations: 1, met: 10, windgram: 30 };

// Whether the source should run on the scheduled minute (scheduledTime in milliseconds).
export function due(name, time) {
  return Math.floor(time / 60000) % INTERVALS[name] === 0;
}
