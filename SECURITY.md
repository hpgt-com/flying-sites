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

Disse kan ikke ligge i repoet. Gå gjennom dem når noen får eller mister tilgang.

- [ ] **Tofaktorautentisering** påkrevd i organisasjonen: Organization → Settings → Authentication security.
- [ ] **Ruleset for `main`**: Settings → Rules → Rulesets → New branch ruleset, mål `main`:
  PR påkrevd, statussjekkene `bygg`, `avhengigheter` og `workflows` må være grønne, blokker force-push
  og sletting. Krev ikke godkjenning fra en annen person så lenge én person merger alene.
- [ ] **Code security**: Settings → Code security: Dependency graph, Dependabot alerts, Secret scanning,
  Push protection og Private vulnerability reporting på.
- [ ] **Actions**: Settings → Actions → General: «Workflow permissions» = Read repository contents.
  «Allow GitHub Actions to create and approve pull requests» på (trengs av luftrom-workflowen).
- [ ] **Pages**: Settings → Pages: Source = GitHub Actions, «Enforce HTTPS» på.
- [ ] **Tilgang**: færrest mulig med skrive- og admin-tilgang (Settings → Collaborators and teams), og
  gå gjennom installerte GitHub-apper.
