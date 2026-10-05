# Sikkerhet

## Melde fra om et sikkerhetsproblem

Har du funnet en sårbarhet i siden eller i repoet, ikke opprett en offentlig issue. Bruk
**[Report a vulnerability](https://github.com/hpgt-com/flying-sites/security/advisories/new)** under
fanen Security, så ser bare vedlikeholderne meldingen. Skriv hva du fant, hvordan det kan gjenskapes og
hvilken side det gjelder. Vi svarer så fort vi kan, men dette er et frivillig klubbprosjekt.

Feil i stedsinformasjonen (farer, retninger, luftrom) er ikke sikkerhetsproblemer i denne forstand.
Meld dem med «Foreslå endring» på stedssiden.

## Hva som er gjort

Siden er statisk (Eleventy på GitHub Pages), uten innlogging, skjema eller database.

**Siden**
- Content-Security-Policy som meta-tag i `src/_includes/base.njk`: skript bare fra siden selv (ingen
  inline-skript), bilder bare fra kartflisene (Kartverket, OpenTopoMap, thermal.kk7.ch) og Yr.
  GitHub Pages kan ikke sette egne HTTP-headere, så `frame-ancestors` og andre header-only-regler er ikke med.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- Leaflet, markercluster og fontene ligger på siden selv. Ingen skript eller fonter fra CDN.
- Bilder publiseres uten EXIF-metadata (`lib/images.js`).

**Repoet og publiseringen**
- Alle endringer går via PR. «Sjekk PR» kjører tester og bygging, dependency review (stopper pakker med
  kjente sårbarheter) og zizmor (sikkerhetsfeil i workflowene).
- CodeQL analyserer JavaScript og workflowene på PR-er, main og hver uke.
- Actions er låst til commit-SHA og oppdateres av Dependabot. Workflowene har bare lesetilgang som
  standard. Publiseringsrettighetene (`pages`, `id-token`) har bare publiseringsjobben.
- Hemmeligheter (`OPENAIP_API_KEY`) ligger som repository secret, aldri i koden. `.gitignore` stopper
  `.env` og nøkkelfiler.

## Innstillinger i GitHub (gjøres av en med admin-tilgang)

Disse kan ikke ligge i repoet. Gå gjennom dem når noen får eller mister tilgang. Menynavnene er fra
GitHub høsten 2026.

**Organisasjonen** (hpgt-com → Settings)
- [ ] **Authentication security**: «Require two-factor authentication for everyone in the organization».
- [ ] **Member privileges**: Base permissions = Read.
- [ ] Minst to eiere, eller en felles e-post styret har tilgang til, så klubben ikke står uten admin.

**Repoet** (flying-sites → Settings)
- [ ] **Rulesets → New branch ruleset**, navn «Beskytt main», Enforcement status = Active,
  Target = Include default branch:
  - Restrict deletions og Block force pushes.
  - Require a pull request before merging, Required approvals = 0 så lenge én person merger alene.
  - Require status checks to pass: `bygg`, `workflows` og `avhengigheter`, med kilde GitHub Actions.
    «Require branches to be up to date» av. En sjekk kan bare velges når den har kjørt nylig.
  - Require code scanning results: CodeQL, Security alerts = High or higher, Alerts = Errors
    (når CodeQL har kjørt på main).
  - Bypass list: Repository admin, «For pull requests only». PR-er fra luftrom-workflowen lages med
    GitHub-tokenet og starter ikke PR-sjekken, så de må merges med «Bypass rules». Direkte push til
    main er fortsatt sperret.
- [ ] **Advanced Security**: Private vulnerability reporting, Dependency graph, Dependabot alerts,
  Dependabot security updates, Secret scanning og Push protection på. Code scanning skal stå på
  Advanced (vår `codeql.yml`), ikke Default setup.
- [ ] **Actions → General**, Workflow permissions: «Read repository contents and packages permissions»,
  og «Allow GitHub Actions to create and approve pull requests» på (trengs av luftrom-workflowen).
- [ ] **Pages**: Source = GitHub Actions, «Enforce HTTPS» på.
- [ ] **Collaborators and teams** og **GitHub Apps**: færrest mulig med skrive- og admin-tilgang.
