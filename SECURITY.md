# Security

## Reporting a security issue

If you have found a vulnerability in the site or the repository, do not open a public issue. Use
**[Report a vulnerability](https://github.com/hpgt-com/flying-sites/security/advisories/new)** under the Security
tab, so only the maintainers see the report. Describe what you found, how to reproduce it and which page it affects.
We reply as soon as we can, but this is a volunteer club project.

Errors in site information (hazards, directions, airspace) are not security issues in this sense. Report them with
«Foreslå endring» ("Suggest a change") on the site page.

## What is in place

The site is static (Eleventy on GitHub Pages), with no login or accounts. Beside it runs the data service, a Cloudflare
Worker with a Durable Object (SQLite) and an R2 archive, which serves the fresh data and takes the one public form,
«Meld fra om endring».

**The site**
- Content-Security-Policy as a meta tag in `src/_includes/base.njk`: scripts only from the site itself (no inline
  scripts) and Cloudflare Turnstile (`challenges.cloudflare.com`, also the only `frame-src`; loaded only when someone
  opens «Meld fra om endring»), images only from the map tiles (Kartverket, OpenTopoMap, EOX, thermal.kk7.ch) and Yr.
  GitHub Pages cannot set custom HTTP headers, so `frame-ancestors` and other header-only rules are not included.
  `manifest-src 'self'` and `worker-src 'self'`: the web app manifest and the service worker come only from the site.
  `connect-src` allows the site, GoatCounter, RainViewer and the data service (`data.hpgt.workers.dev`). The station
  data is likewise used only in the expected shape (`isStationsData` in `stations.js`) and drawn with DOM methods.
- «Meld fra om endring» (`POST /v1/report`, `workers/data/src/report.js`) takes requests only from
  `https://flysteder.hpgt.com`, checks every one with Turnstile, accepts only known sites and kinds and 10–1000
  characters, and makes at most 50 issues a day and 3 from one address. Turnstile's answer must be for
  `flysteder.hpgt.com`, the body is read only as JSON up to 8 KB, and the day's count and the per-address count are
  reserved in one step in the Durable Object (so two reports at the same time cannot pass the limit), and given back
  when GitHub fails. The address is kept only as a hash with a salt for the day, deleted with the count the next day.
  The text goes into the issue inside a code block, so it cannot add
  links, images or @mentions. The issues are made by the club's GitHub App, installed only on this repository with
  only Issues: read and write; its private key is a Cloudflare secret, and each report gets a token that lasts an hour
  (`workers/data/src/github-app.js`).
- The forecast from the data service is only used when it has the expected shape (times as strings, rows of numbers
  or null; `isNewerForecast` in `wind.js`), and it is never parsed as HTML.
- The service worker (`lib/service-worker.js`) stores only the site's own pages and files, and Kartverket's map tiles
  (fetched with CORS and without cookies, at most 300). Responses from GoatCounter, Yr and other third parties are
  never stored, and only complete same-origin or CORS responses are kept (no opaque responses).
- `Referrer-Policy: strict-origin-when-cross-origin`.
- Leaflet, markercluster and the fonts are served from the site itself. No scripts or fonts from a CDN.
- Images are published without EXIF metadata (`lib/images.js`).
- `/.well-known/security.txt` (RFC 9116) points to «Report a vulnerability» and this file. It is generated on every
  build (`lib/security-txt.js`), so `Expires` is always about a year ahead.

**The repository and publishing**
- All changes go through a PR. «PR check» runs tests, the build, link check, HTML validation and the check for template slips (`build`), axe
  (`accessibility`), dependency review
  (`dependency-review`, stops packages with known vulnerabilities) and zizmor (`workflow-security`, security issues
  in the workflows).
- CodeQL analyses the JavaScript and the workflows on PRs, on `main` and weekly.
- Actions are pinned to commit SHAs and updated by Dependabot. Workflows have read-only access by default. Only the
  deploy job has the publishing permissions (`pages`, `id-token`).
- All workflows install with `npm ci --ignore-scripts`, so no package's install script runs in CI (none of the
  dependencies need one). A new dependency that needs one will fail the build and must be assessed first.
- The airspace workflow is split in two jobs: `fetch` installs the npm packages (`npm ci --ignore-scripts`) and
  runs the script with read-only access and the openAIP key; `pr` has write access to push the branch and open the
  PR, but runs no npm code. The fetched files go from one to the other as an artifact. When the club's GitHub App
  is set up, `pr` uses a short-lived app token limited to this repository (contents and pull requests), so the PR
  check runs on the airspace PRs too. The power line workflow (`obstacles.yml`) is built the same way, without any
  key.
- Every successful publish is signed. The `attest` job in «Build and deploy» makes a build provenance attestation (which
  workflow, commit and run built the site) and an SBOM attestation (SPDX from `package-lock.json`, made with
  `npm sbom`), both for the SHA-256 of the archive that is published to Pages. The job has `id-token` and
  `attestations` but checks out no code; the build job never gets `id-token`. The SBOM is also kept as the
  artifact `sbom` on the run for 90 days. `deploy` does not wait for `attest`, so a failed attestation does not stop a
  publish; it fails the run and opens an issue (below). See [Verifying a publish](#verifying-a-publish).
- A failed run of «Build and deploy», the data service deploy, «Update airspace» or «Update power lines and obstacles»
  opens an issue labelled `bug` (or comments on the open one), from the job `alert`, which only has `issues: write`
  and runs no project code. Scheduled runs on GitHub can be hours late, and GitHub turns off the schedule of a public
  repository after 60 days without activity, so a missing monthly PR is a sign to check Actions.
- «Data service health» (`health.yml`) checks `/v1/status.json` every hour and opens an issue when a dataset is too
  old or the service does not answer. The status has no secrets and nothing about visitors: run times, ages, error
  messages from the sources, the launch ids missing and the last archived day.
- OpenSSF Scorecard (`scorecard.yml`) checks the repository against supply-chain good practice weekly (and
  when the branch rules change). The results are in Code scanning and behind the badge in README.
- Secrets (`OPENAIP_API_KEY`, `APP_PRIVATE_KEY`) are stored as repository secrets, never in the code. Planned: move
  them to an environment `automation` that only `main` may use, so a workflow on another branch cannot read them. `.gitignore` blocks `.env` and
  key files.
- The data service (`workers/data`) runs in the club's Cloudflare account «HPGT». It is published by
  `data-worker.yml` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, which are secrets in the GitHub
  environment `cloudflare`, which only `main` may use, so a PR branch cannot publish. The token («GitHub – flying-sites»,
  made 22.10.2026 with a year's TTL) may only change Workers (including their Durable Objects) and R2 in the HPGT account
  (Workers Scripts: Edit, Workers R2 Storage: Edit, Account Settings: Read), has no access to KV, domains or DNS, and
  expires in October 2027 (the date is under My Profile → API Tokens). The account has
  two-factor sign-in with a security key and an authenticator app. The service's secrets are set in Cloudflare and
  never in GitHub or the code, and never logged: `HOLFUY_KEY` (sent only to api.holfuy.com), `FROST_CLIENT_ID` (MET's
  Frost), `TURNSTILE_SECRET`, and `REPORTS_APP_ID` with `REPORTS_APP_PRIVATE_KEY` (the GitHub App for «Meld fra»).
  The service serves only public data: forecast, measured wind, winds aloft, how well the forecast hit, flying activity
  as sums per site and day, and pilots in the air from the Open Glider Network (their tracks over the last 10 minutes
  only in memory). To count the day's flights it keeps, until the next day, a random salt, a hash per device and each
  pilot's last position in the air, and asks Kartverket for the terrain height at it; nothing that names a device or
  pilot is kept longer. The weather archive is a private R2 bucket
  (`hpgt-data-archive`), written only by the service; read access for reports is a separate read-only R2 token.

## Verifying a publish

Download the archive `github-pages` from a run of «Build and deploy» (Actions → the run → Artifacts), unzip it so
you have `artifact.tar`, and run:

```bash
gh attestation verify artifact.tar --repo hpgt-com/flying-sites
gh attestation verify artifact.tar --repo hpgt-com/flying-sites --predicate-type https://spdx.dev/Document/v2.3
```

The first checks the provenance, the second the SBOM. Both fail if the archive was not built by this repository's
workflow. All attestations are listed under the repository's Actions → Attestations.

`step-security/harden-runner` (blocks unexpected outbound traffic from the runner) is not used: it sends data about
every run to StepSecurity. It is a choice for the owners if they want it.

## GitHub settings (done by someone with admin access)

These cannot live in the repository. Go through them whenever someone gains or loses access. Menu names are as in
GitHub in autumn 2026.

**The organisation** (hpgt-com → Settings)
- [ ] **Authentication security**: «Require two-factor authentication for everyone in the organization».
- [ ] **Member privileges**: Base permissions = Read.
- [ ] At least two owners, or a shared email the board has access to, so the club is never left without an admin.

**The repository** (flying-sites → Settings)
- [ ] **Rulesets → New branch ruleset**, name «main protection», Enforcement status = Active,
  Target = Include default branch:
  - Restrict deletions and Block force pushes.
  - Require a pull request before merging, Required approvals = 0 as long as one person merges alone.
  - Require status checks to pass: `build`, `dependency-review`, `workflow-security` and `accessibility`, with source
    GitHub Actions.
    «Require branches to be up to date» off. A check can only be selected once it has run recently.
  - Require code scanning results: CodeQL, Security alerts = High or higher, Alerts = Errors
    (once CodeQL has run on `main`).
  - Bypass list: Repository admin, «For pull requests only». Without the GitHub App (see docs/operations.md),
    PRs from the airspace workflow are created with the GitHub token and do not trigger the PR check, so they must
    be merged with «Bypass rules». With the app they get the checks like any other PR, and the bypass is only a
    fallback. Direct pushes to `main` are still blocked.
- [ ] **Advanced Security**: Private vulnerability reporting, Dependency graph, Dependabot alerts,
  Dependabot security updates, Secret scanning and Push protection on. Code scanning must be set to
  Advanced (our `code-scanning.yml`), not Default setup.
- [ ] **Actions → General**, Workflow permissions: «Read repository contents and packages permissions»,
  and «Allow GitHub Actions to create and approve pull requests» on (needed by the airspace workflow only while
  the GitHub App is not set up; turn it off once the app works).
- [ ] **Pages**: Source = GitHub Actions, «Enforce HTTPS» on.
- [ ] **Collaborators and teams** and **GitHub Apps**: as few people as possible with write and admin access.
