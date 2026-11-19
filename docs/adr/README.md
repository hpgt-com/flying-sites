# Architecture Decision Records

The important choices for flysteder.hpgt.com, with the reasons, so whoever comes next knows *why* things are as they are.
New decision: copy `template.md` to the next number and add it to the pull request that makes the change. A decision is
not edited afterwards; it is superseded by a new one, and the old one gets the status «Superseded by NNNN».

| No. | Decision | Status |
|---|---|---|
| [0001](0001-static-site-eleventy-github-pages.md) | Static site with Eleventy on GitHub Pages | Superseded by 0006 (hosting) |
| [0002](0002-data-service-cloudflare.md) | Data service on Cloudflare Workers with Durable Objects and R2 | Accepted |
| [0003](0003-slow-data-cached-by-pr.md) | Slow-changing external data cached in the repository, updated by PR | Accepted |
| [0004](0004-offsite-backup-restore-drill.md) | Off-site backup to Backblaze B2, with a monthly restore drill | Accepted |
| [0005](0005-scoped-tokens-recovery-environment.md) | Scoped tokens owned by the club, and a separate recovery environment | Accepted |
| [0006](0006-site-served-by-cloudflare.md) | Site served by Cloudflare, with GitHub Pages as a fallback | Accepted |
