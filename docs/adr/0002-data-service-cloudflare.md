# 0002: Data service on Cloudflare Workers with Durable Objects and R2

- **Status:** Accepted
- **Date:** 2026-10

## Context
Wind forecasts, weather stations, flights and pilots in the air change by the minute. Rebuilding the site that often is
not possible, and the browser should not call every source directly (keys, rate limits, CORS, licences).

## Decision
One Worker, `data` (`workers/data`), with one module per source. It runs on a schedule, stores the data in a Durable
Object (SQLite) and serves each dataset as `/v1/<dataset>.json`. Measurements are archived as CSV in R2
(`hpgt-data-archive`), and the history is backed up there every night.

## Consequences
- The pages stay static; only the data service needs secrets, and those live in Cloudflare.
- A health check (`health.yml`) and UptimeRobot watch it from outside.
- A lost store, bucket or account must be recoverable: see [0004](0004-offsite-backup-restore-drill.md).

## Alternatives considered
Fetching in the build only (too old within hours), and a VPS with a database (a server to patch and pay for).
