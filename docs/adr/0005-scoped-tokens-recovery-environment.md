# 0005: Scoped tokens owned by the club, and a separate recovery environment

- **Status:** Accepted
- **Date:** 2026-11-18

## Context
Publishing the data service used a personal Cloudflare user token with Workers and R2 rights on the whole account, and
the backup used a personal R2 token. Both depended on one person and allowed more than each job needed.

## Decision
- `cloudflare`: an account token made from the Worker (Settings → Builds → «API token for external CI/CD») that can
  only publish the Worker `data`.
- `backup`: an R2 account token, Object Read only, `hpgt-data-archive` only.
- `recovery`: a new environment (only `main`, a required reviewer) for `recover.yml`, which also writes to R2. Its token
  is made only when a recovery is needed and deleted afterwards.
- GitHub access goes through the org-owned GitHub Apps «HPGT Flying Sites» and «HPGT Flying Sites Reports», never
  personal tokens.

## Consequences
- A leaked token can do one thing only, and nothing stops working when someone leaves the board.
- The everyday deploy token must be renewed yearly. A recovery takes one extra step: making its token.

## Alternatives considered
One broad token for everything (simpler, but a leak would reach every Worker and the archive).
