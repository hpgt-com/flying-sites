# Sikkerhet

## Rapportere et sikkerhetsproblem

Har du funnet en sårbarhet i siden eller repoet, skal du ikke åpne en offentlig sak. Bruk
**[Report a vulnerability](https://github.com/hpgt-com/flying-sites/security/advisories/new)** under fanen Security,
så bare de som vedlikeholder siden, ser rapporten. Beskriv hva du fant, hvordan det kan gjenskapes, og hvilken side
det gjelder. Vi svarer så fort vi kan, men dette er et frivillig klubbprosjekt.

Rapporten kan skrives på norsk eller engelsk.

Feil i opplysningene om et flysted (farer, retninger, luftrom) er ikke sikkerhetsproblemer i denne forstand. Meld fra
om dem med «Foreslå endring» på stedssiden.

## Dette er på plass

Siden er statisk (Eleventy, servert av Cloudflare fra det samme bygget som GitHub Pages får), uten innlogging eller
kontoer. Ved siden av kjører datatjenesten, en Cloudflare Worker med et Durable Object (SQLite) og et arkiv i R2, som
serverer de ferske dataene og tar imot det ene offentlige skjemaet, «Meld fra om endring».

**Siden**
- Content-Security-Policy som meta-tagg i `src/_includes/base.njk`, med `default-src 'none'`, så hver type kilde må
  tillates uttrykkelig: skript bare fra siden selv (ingen innebygde skript, og heller ingen innebygde stiler:
  `style-src 'self'`) og Cloudflare Turnstile (`challenges.cloudflare.com`, også den eneste `frame-src`; lastes bare
  når noen åpner «Meld fra om endring»), bilder bare fra kartflisene (Kartverket, OpenTopoMap, EOX, thermal.kk7.ch) og
  Yr. Reglene som bare kan stå i en header, kommer fra `src/headers.njk` på Cloudflare: `frame-ancestors 'none'` og
  `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-site`,
  HSTS, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` og en `Permissions-Policy` som slår av
  kamera, mikrofon, posisjon og betaling.
  `manifest-src 'self'` og `worker-src 'self'`: manifestet for webappen og service workeren kommer bare fra siden.
  `connect-src` tillater siden, GoatCounter, RainViewer og datatjenesten (`data.hpgt.com`). Stasjonsdataene brukes
  også bare i den formen som er ventet (`isStationsData` i `stations.js`), og tegnes med DOM-metoder.
- Brudd på CSP-en rapporteres av nettleserne til `POST https://data.hpgt.com/v1/csp-report`
  (`workers/data/src/csp-report.js`): headeren legger til `report-uri` og `report-to csp` med
  `Reporting-Endpoints: csp="https://data.hpgt.com/v1/csp-report"` (meta-taggen kan ikke ha dem, så `site.csp`
  er uten). Nettleseren sender rapportene selv, ikke skriptene på sidene, så `connect-src` trenger ikke
  adressen. Trusted Types prøves i rapporteringsmodus: `Content-Security-Policy-Report-Only:
  require-trusted-types-for 'script'` med de samme rapporteringsdirektivene. Sidens egne skript tilordner ingen
  HTML-strenger, men Leaflet gjør det fortsatt (kreditering, prefiks, navnene i lagvelgeren), og Turnstile er fra en
  tredjepart, så rapportene viser hva som må endres før det kan håndheves. `/sw.js` får verken policyene eller
  `Reporting-Endpoints`.
- Ingen av Workerne (`data`, `site`) har Cloudflares logg per forespørsel (`invocation_logs = false`), som ville
  registrert IP-adressen og nettleserinfoen til hver besøkende. Bare Workernes egne linjer logges, og de har ingen
  personopplysninger.
- Adressen for CSP-rapporter lagrer ingenting: hver rapport blir én linje i loggen til Workeren med bare direktivet,
  om den ble håndhevet eller bare rapportert, det som ble blokkert, redusert til skjema og vert eller et nøkkelord
  (`inline`, `eval`, `data`, `blob`, `trusted-types-sink` …), stien til siden på `flysteder.hpgt.com` uten
  spørrestreng, og for Trusted Types navnet på sinken (`Element innerHTML`). Aldri adressen, nettleserinfoen,
  referrer, fullstendige adresser eller utdraget (koden eller teksten som ble blokkert). Rapporter fra andre sider
  forkastes. Bare `POST` (andre får 405), bare `application/csp-report` og `application/reports+json` (andre får 415),
  innholdet leses fra strømmen opp til 16 KB uansett hva `Content-Length` sier (413 over det), høyst 20 rapporter per
  forespørsel og 30 forespørsler i minuttet fra én adresse (Cloudflares rate limit-binding `CSP_LIMIT`, telt under en
  hash av adressen).
- «Meld fra om endring» (`POST /v1/report`, `workers/data/src/report.js`) tar bare imot forespørsler fra
  `https://flysteder.hpgt.com`, sjekker hver av dem med Turnstile, godtar bare kjente steder og typer og 10–1000
  tegn, og lager høyst 50 saker om dagen og 3 fra én adresse. Svaret fra Turnstile må gjelde `flysteder.hpgt.com`,
  innholdet leses bare som JSON opp til 8 KB, og dagens antall og antallet per adresse reserveres i ett steg i
  Durable Objectet (så to rapporter samtidig ikke kan komme forbi grensen), og gis tilbake når GitHub feiler. Adressen
  lagres bare som en hash med et salt for dagen, og slettes med tellingen dagen etter. Teksten legges inn i saken i
  en kodeblokk, så den ikke kan legge til lenker, bilder eller @-omtaler. Sakene lages av klubbens GitHub-app, som
  bare er installert på dette repoet og bare har Issues: read and write; den private nøkkelen er en hemmelighet i
  Cloudflare, og hver rapport får et token som varer i en time (`workers/data/src/github-app.js`).
- Varselet fra datatjenesten brukes bare når det har den ventede formen (tider som strenger, rader med tall eller
  null; `isNewerForecast` i `wind.js`), og det tolkes aldri som HTML.
- Service workeren (`lib/service-worker.js`) lagrer bare sidens egne sider og filer, og kartflisene fra Kartverket
  (hentet med CORS og uten informasjonskapsler, høyst 300). Svar fra GoatCounter, Yr og andre tredjeparter lagres
  aldri, og bare komplette svar fra samme opphav eller med CORS beholdes (ingen ugjennomsiktige svar).
- `Referrer-Policy: strict-origin-when-cross-origin`.
- Leaflet, markercluster og skriftene serveres fra siden selv. Ingen skript eller skrifter fra et CDN.
- Bildene publiseres uten EXIF-metadata (`lib/images.js`).
- `/.well-known/security.txt` (RFC 9116) peker til «Report a vulnerability» og denne filen. Den lages ved hvert
  bygg (`lib/security-txt.js`), så `Expires` er alltid omtrent et år fram i tid.

**Repoet og publiseringen**
- Alle endringer går gjennom en PR. «PR-sjekk» kjører testene, bygget, lenkesjekken, HTML-valideringen og sjekken
  for glipp i malene (`build`), axe (`accessibility`), gjennomgang av avhengigheter (`dependency-review`, stopper
  pakker med kjente sårbarheter) og zizmor (`workflow-security`, sikkerhetsproblemer i arbeidsflytene).
- CodeQL analyserer JavaScript-koden og arbeidsflytene på PR-er, på `main` og hver uke.
- Actions er låst til commit-SHA-er og oppdateres av Dependabot, med en ventetid på 7 dager (30 for
  major-versjoner). Patch- og minor-oppdateringer av npm-pakker og Actions, også Wrangler, merges automatisk når
  alle påkrevde sjekker er grønne (`dependabot-automerge.yml`, med et token fra GitHub-appen). Arbeidsflytene har bare
  lesetilgang som standard. Bare publiseringsjobben har rettighetene til å publisere (`pages`, `id-token`).
- Alle arbeidsflytene installerer med `npm ci --ignore-scripts`, så ingen pakkers installasjonsskript kjører i CI
  (ingen av avhengighetene trenger det). En ny avhengighet som trenger det, får bygget til å feile og må vurderes
  først.
- PR-sjekken kjører `npm audit signatures` for `workers/data`, så en pakke som ikke er signert av registeret, stopper
  merge. Selve siden kan ikke kjøre sjekken: Eleventy installerer `@11ty/nunjucks` under aliaset `nunjucks`, og
  `npm audit signatures` slår opp navnet på aliaset, som ikke finnes i den versjonen. Integritetshashene i
  `package-lock.json` sjekkes likevel av `npm ci`.
- Arbeidsflyten for luftrom er delt i to jobber: `fetch` installerer npm-pakkene (`npm ci --ignore-scripts`) og
  kjører skriptet med bare lesetilgang og openAIP-nøkkelen; `pr` har skrivetilgang for å pushe grenen og åpne PR-en,
  men kjører ingen npm-kode. De hentede filene går fra den ene til den andre som en artefakt. Når klubbens GitHub-app
  er satt opp, bruker `pr` et kortlivet app-token begrenset til dette repoet (contents og pull requests), så
  PR-sjekken kjører på luftroms-PR-ene også. Arbeidsflyten for kraftlinjer (`obstacles.yml`) er bygget på samme måte,
  uten nøkkel.
- Hver vellykket publisering signeres. Jobben `attest` i «Bygg og publiser» lager en attestasjon av byggeproveniensen
  (hvilken arbeidsflyt, commit og kjøring som bygget siden) og en SBOM-attestasjon (SPDX fra `package-lock.json`,
  laget med `npm sbom`), begge for SHA-256 av arkivet som publiseres til Pages. Jobben har `id-token` og
  `attestations`, men sjekker ikke ut kode; byggejobben får aldri `id-token`. SBOM-en lagres også som artefakten
  `sbom` på kjøringen i 90 dager. `deploy` venter ikke på `attest`, så en attestasjon som feiler, stopper ikke en
  publisering; den får kjøringen til å feile og åpner en sak (se nedenfor). Se
  [Verifisere en publisering](#verifisere-en-publisering).
- En kjøring som feiler i «Bygg og publiser», publiseringen av datatjenesten, «Oppdater luftrom» eller «Oppdater
  kraftlinjer og hindringer», åpner en sak merket `bug` (eller kommenterer på den åpne), fra jobben `alert`, som bare
  har `issues: write` og ikke kjører kode fra prosjektet. Planlagte kjøringer på GitHub kan komme timer for sent, og
  GitHub slår av tidsplanen for et offentlig repo etter 60 dager uten aktivitet, så en månedlig PR som mangler, er et
  tegn på at Actions bør sjekkes.
- «Helsesjekk for datatjenesten» (`health.yml`) sjekker `/v1/status.json` hver time og åpner en sak når et datasett
  er for gammelt eller tjenesten ikke svarer. Statusen har ingen hemmeligheter og ingenting om besøkende:
  kjøretider, alder, feilmeldinger fra kildene, id-ene til startene som mangler, og den siste arkiverte dagen. Siden
  GitHub slår av tidsplanen etter 60 dager uten commit, er det vakten utenfor GitHub som teller: UptimeRobot
  (gratisplanen, satt opp 22.10.2026) sjekker `https://flysteder.hpgt.com/`, `https://hpgt.com/` og
  `/v1/status.json` for `"ok":true` hvert femte minutt og sender e-post til den som vedlikeholder siden, når en av
  dem feiler. Der lagres ingenting fra siden utenom adressene.
- OpenSSF Scorecard (`scorecard.yml`) sjekker repoet mot god praksis for forsyningskjeden hver uke (og når
  grenreglene endres). Resultatene ligger i Code scanning og bak merket i README.
- Hemmelighetene (`OPENAIP_API_KEY`, `APP_PRIVATE_KEY`) ligger i GitHub-miljøet `automation`, som bare `main` kan
  bruke, så en arbeidsflyt som er endret på en annen gren, ikke kan lese dem; jobbene som bruker dem (`airspace.yml`,
  `obstacles.yml`), oppgir miljøet. `.gitignore` stopper `.env` og nøkkelfiler.
- Datatjenesten (`workers/data`) kjører i klubbens Cloudflare-konto «HPGT». Den publiseres av `data-worker.yml` med
  `CLOUDFLARE_API_TOKEN` og `CLOUDFLARE_ACCOUNT_ID`, som er hemmeligheter i GitHub-miljøet `cloudflare`, som bare
  `main` kan bruke, så en PR-gren ikke kan publisere. Tokenet er et kontotoken laget fra Workeren (Workers & Pages →
  data → Settings → Builds → «API token for external CI/CD») og kan bare publisere Workeren `data`: ingen andre
  Workers, ikke R2, KV, domener eller DNS. Siden publiseres på samme måte av `deploy.yml` (jobben `cloudflare`) med
  `CLOUDFLARE_SITE_TOKEN` i det samme miljøet, laget fra Workeren `flysteder`, så det bare kan publisere den; det
  utløper 19.11.2027. Det bredere tokenet som «Gjenoppretting» trenger for å skrive arkivet tilbake til R2 (Workers
  Scripts: Edit, Workers R2 Storage: Edit, Account Settings: Read), blir ikke tatt vare på: det lages når det trengs,
  legges i et eget miljø, `recovery` (bare `main`, krever godkjenning fra teamet `maintainers`), og slettes
  etterpå. Kontoen har tofaktorinnlogging med en sikkerhetsnøkkel og en autentiseringsapp. Tjenestens hemmeligheter
  settes i Cloudflare, aldri i GitHub eller koden, og logges aldri: `HOLFUY_KEY` (sendes bare til api.holfuy.com),
  `FROST_CLIENT_ID` (METs Frost), `TURNSTILE_SECRET`, og `REPORTS_APP_ID` med `REPORTS_APP_PRIVATE_KEY` (GitHub-appen
  for «Meld fra»). Tjenesten serverer bare offentlige data: varsel, målt vind, høydevind, hvor godt varselet traff,
  flyaktivitet som summer per sted og dag, og piloter i lufta fra Open Glider Network (sporene deres de siste 10
  minuttene bare i minnet). For å telle dagens flyturer tar den vare på, til neste dag, et tilfeldig salt, en hash
  per enhet og hver pilots siste posisjon i lufta, og spør Kartverket om terrenghøyden der; ingenting som navngir en
  enhet eller pilot, lagres lenger. Værarkivet er en privat bøtte i R2 (`hpgt-data-archive`), som bare tjenesten
  skriver til; lesetilgang for rapporter er et eget R2-token med bare lesetilgang.
- Den månedlige gjenopprettingsøvelsen og hentingen i «Gjenoppretting» bruker miljøet `backup-read`, med en B2-nøkkel
  som bare kan lese backup-bøtta.
- Kopien hos en annen leverandør (`backup.yml`) kjører i miljøet `backup`, som bare `main` kan bruke: et R2-token med
  bare lesetilgang til arkivbøtta og en Backblaze-nøkkel bare for backup-bøtta, så en PR-gren ikke kan lese arkivet
  eller skrive til kopien, og nøklene kan høyst lese målinger som er åpne data.

## Verifisere en publisering

Last ned arkivet `github-pages` fra en kjøring av «Bygg og publiser» (Actions → kjøringen → Artifacts), pakk det ut
så du har `artifact.tar`, og kjør:

```bash
gh attestation verify artifact.tar --repo hpgt-com/flying-sites
gh attestation verify artifact.tar --repo hpgt-com/flying-sites --predicate-type https://spdx.dev/Document/v2.3
```

Den første sjekker proveniensen, den andre SBOM-en. Begge feiler hvis arkivet ikke ble bygget av arbeidsflyten i
dette repoet. Alle attestasjonene står under Actions → Attestations i repoet.

`step-security/harden-runner` (stopper uventet utgående trafikk fra runneren) brukes ikke: den sender data om hver
kjøring til StepSecurity. Det er et valg for eierne om de vil ha den.

## Innstillinger i GitHub (gjøres av noen med admin-tilgang)

Disse kan ikke ligge i repoet. Gå gjennom dem hver gang noen får eller mister tilgang. Menynavnene er slik de var i
GitHub høsten 2026.

**Organisasjonen** (hpgt-com → Settings)
- [ ] **Authentication security**: «Require two-factor authentication for everyone in the organization».
- [ ] **Member privileges**: Base permissions = Read.
- [ ] Minst to eiere, eller en felles e-postadresse styret har tilgang til, så klubben aldri står uten admin.

**Repoet** (flying-sites → Settings)
- [ ] **Rulesets → New branch ruleset**, navn «main protection», Enforcement status = Active,
  Target = Include default branch:
  - Restrict deletions og Block force pushes.
  - Require a pull request before merging, Required approvals = 0 så lenge én person merger alene.
  - Require status checks to pass: `build`, `dependency-review`, `workflow-security`, `accessibility` og `worker`
    (prøvekjøringen av datatjenesten), med kilden GitHub Actions.
    «Require branches to be up to date before merging» på (fra 16.11.2026; OpenSSF Scorecard ber om det): en PR
    testes mot siste `main` før den merges, så to PR-er som er grønne hver for seg, ikke kan ødelegge `main` sammen.
    Prisen: når en annen PR er merget i mellomtiden, trykk «Update branch» og vent på sjekkene på nytt. En sjekk kan
    bare velges når den har kjørt nylig.
  - Require code scanning results: CodeQL, Security alerts = High or higher, Alerts = Errors
    (når CodeQL har kjørt på `main`).
  - Bypass list: Repository admin, «For pull requests only». PR-er fra arbeidsflytene for luftrom og hindringer
    lages med GitHub-appen (se docs/operations.md) og får sjekkene som alle andre PR-er. Direkte push til `main` er
    blokkert.
- [ ] **Advanced Security**: Private vulnerability reporting, Dependency graph, Dependabot alerts,
  Dependabot security updates, Secret scanning og Push protection på. Code scanning må stå på
  Advanced (vår `code-scanning.yml`), ikke Default setup.
- [ ] **Actions → General**, Workflow permissions: «Read repository contents and packages permissions»,
  og «Allow GitHub Actions to create and approve pull requests» av (satt for hele organisasjonen).
  Arbeidsflytene som åpner PR-er, bruker GitHub-appen.
- [ ] **Pages**: Source = GitHub Actions, «Enforce HTTPS» på.
- [ ] **Collaborators and teams** og **GitHub Apps**: så få personer som mulig med skrive- og admin-tilgang.
