# 0004: Off-site backup to Backblaze B2, with a monthly restore drill

- **Status:** Accepted
- **Date:** 2026-10

## Context
The weather archive and the flight history exist only in Cloudflare. A lost account, a deleted bucket or a bad deploy
could lose years of data, and a backup that has never been restored cannot be trusted.

## Decision
`backup.yml` copies the whole R2 bucket to a bucket at another provider (Backblaze B2) every night, never deleting
anything there, and saves the issues and the Git history. `restore-drill.yml` proves every month, locally on the
runner, that the copy restores. `recover.yml` does a real recovery by hand.

## Consequences
- Each provider can be lost on its own without losing data (docs/operations.md «Disaster recovery»).
- Keys are minimal: R2 read-only for the copy, the B2 key for one bucket only.
- A failing night or drill opens an issue, which closes by itself when it works again.

## Alternatives considered
Relying on Cloudflare alone, and a backup without a drill.
