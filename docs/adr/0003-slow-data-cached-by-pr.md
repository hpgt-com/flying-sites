# 0003: Slow-changing external data cached in the repository, updated by PR

- **Status:** Accepted
- **Date:** 2026-10

## Context
Airspace, power lines, obstacles and elevations change rarely, are slow or rate-limited to fetch, and a wrong change
(an airspace floor, a missing power line) is a safety matter.

## Decision
Such data is fetched by monthly workflows (`airspace.yml`, `obstacles.yml`) or during the build for new GPX files, and
committed to `src/_data/cache/`. Changes arrive as pull requests from the GitHub App «HPGT Flying Sites», so a person
sees the diff before it goes live.

## Consequences
- Builds are fast and do not depend on openAIP, NVE or Overpass being up.
- Safety-relevant changes are reviewed, and the history shows when something changed.
- The data can be up to a month old. IPPC remains the authority for airspace.

## Alternatives considered
Fetching on every build (slow, fragile, unreviewed), and fetching in the browser (keys and rate limits exposed).
