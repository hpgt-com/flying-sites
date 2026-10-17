# Security

## Reporting a security issue

If you have found a vulnerability in the site or the repository, do not open a public issue. Use
**[Report a vulnerability](https://github.com/hpgt-com/flying-sites/security/advisories/new)** under the Security
tab, so only the maintainers see the report. Describe what you found, how to reproduce it and which page it affects.
We reply as soon as we can, but this is a volunteer club project.

Errors in site information (hazards, directions, airspace) are not security issues in this sense. Report them with
«Foreslå endring» ("Suggest a change") on the site page.

## What is in place

The site is static (Eleventy on GitHub Pages), with no login, forms or database.

**The site**
- Content-Security-Policy as a meta tag in `src/_includes/base.njk`: scripts only from the site itself (no inline
  scripts), images only from the map tiles (Kartverket, OpenTopoMap, EOX, thermal.kk7.ch) and Yr.
  GitHub Pages cannot set custom HTTP headers, so `frame-ancestors` and other header-only rules are not included.
  `manifest-src 'self'` and `worker-src 'self'`: the web app manifest and the service worker come only from the site.
- The service worker (`lib/service-worker.js`) stores only the site's own pages and files, and Kartverket's map tiles
  (fetched with CORS and without cookies, at most 300). Responses from GoatCounter, Yr and other third parties are
  never stored, and only complete same-origin or CORS responses are kept (no opaque responses).
- `Referrer-Policy: strict-origin-when-cross-origin`.
- Leaflet, markercluster and the fonts are served from the site itself. No scripts or fonts from a CDN.
- Images are published without EXIF metadata (`lib/images.js`).
- `/.well-known/security.txt` (RFC 9116) points to «Report a vulnerability» and this file. It is generated on every
  build (`lib/security-txt.js`), so `Expires` is always about a year ahead.

**The repository and publishing**
- All changes go through a PR. «PR check» runs tests and the build (`build`), dependency review
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
  check runs on the airspace PRs too.
- Secrets (`OPENAIP_API_KEY`, `APP_PRIVATE_KEY`) are stored as repository secrets, never in the code. `.gitignore` blocks `.env` and
  key files.

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
  - Require status checks to pass: `build`, `dependency-review` and `workflow-security`, with source GitHub Actions.
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
