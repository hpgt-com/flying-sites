# 0001: Static site with Eleventy on GitHub Pages

- **Status:** Accepted
- **Date:** 2026-09

## Context
The flying site guide must be cheap, fast, safe to run by volunteers, and easy to change through pull requests.

## Decision
Every site is a folder of files (`src/sites/<id>/`). Eleventy builds the whole site in GitHub Actions, and GitHub Pages
serves it at flysteder.hpgt.com. The build validates every site file (`lib/validation.js`) and stops on any error.

## Consequences
- No server or database for the site itself; all history is in Git, and every change is reviewed in a PR.
- Data that must be fresh cannot be baked in at build time alone, so it comes from a separate data service ([0002](0002-data-service-cloudflare.md)).
- Builds publish signed provenance and an SBOM (SECURITY.md).

## Alternatives considered
A CMS with a database (more to secure and maintain), and hosting on Cloudflare (GitHub Pages was enough for the site
itself, and keeps publishing free of secrets).
