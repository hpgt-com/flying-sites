# Drift og vedlikehold

Praktiske fremgangsmåter for dem som vedlikeholder siden. Hvordan siden henger sammen, står i
[architecture.md](architecture.md), og formatet på stedsfilene i [site-files.md](site-files.md).

## Kjøre siden lokalt

Krever Node.js 26 eller nyere (versjonen i `.nvmrc`, som CI bruker; Node 26 er LTS til april 2029).

```bash
npm ci          # installerer pakkene
npm start       # http://localhost:8080, lastes på nytt ved lagring
npm test        # testene i test/
npm run build   # bygger til _site/
```

`FORECAST_OFFLINE=1 npm run build` bygger uten været (MET og Open-Meteo), som går raskere og virker uten nett.
Ellers henter bygget været når `.cache/weather/` mangler eller er eldre enn 30 minutter. `npm run weather` henter det
med en gang, på samme måte som jobben `weather` i «Build and deploy».

Kvalitetssjekkene i PR-sjekken kan kjøres lokalt etter bygget:

```bash
npm run check:links   # interne lenker og bilder peker på filer som finnes (uten nett)
npm run check:html    # HTML-validering av hver side, regler i .htmlvalidate.mjs
npm run check:output  # ingen «[object Object]», «undefined», «NaN» eller plassholdere som ikke er fylt ut
npx playwright install chromium   # én gang
npm run check:a11y    # axe i Chromium på noen sider, lys og mørk modus
npm run check:behaviour  # hva sidene gjør i Chromium: markører ved zoom, live-laget, datatjenesten nede, «Meld fra», offline
```

`check:a11y` feiler bare på funn med alvorlighet «serious» eller «critical», og lister resten. Med en Chromium som
allerede er installert, settes `CHROMIUM_PATH` i stedet for å kjøre `playwright install`. Sidene som sjekkes: `PAGES` i
`scripts/check-a11y.mjs`. `check:behaviour` kjører scenarioene i `scripts/check-behaviour.mjs`, der skriptet svarer for
datatjenesten og Turnstile (stasjoner fra `test/fixtures/stations.json`, flyttet til nå) og uten nett. Når noe i
nettleseren slutter å virke, legges det til et scenario der.

## Arbeidsflyt

1. Lag en gren og gjør endringen.
2. Åpne en pull request. PR-sjekken kjører testene, bygger siden og sjekker lenker, HTML og tilgjengelighet. Ugyldige
   stedsfiler, brutte interne lenker, ugyldig HTML eller alvorlige tilgjengelighetsfeil får den til å feile.
3. Merge til `main`. Siden publiseres automatisk etter noen minutter.

Endringer laget av Claude eller andre roboter vises i «Sist endret» som PR-en de kom fra (`lib/git.js`).

## Nytt flysted

1. Lag mappen `src/sites/<id>/` og kopier `index.md` fra et lignende sted.
2. Fyll inn `name`, `id`, `launch`, `wind_directions`, `landings` og `parking`. Høydene hentes fra Kartverket
   (`https://ws.geonorge.no/hoydedata/v1/punkt?koordsys=4258&punkter=[[lon,lat]]`).
3. Sett `status: draft` til stedet er gjennomgått.
4. Legg til en gangrute (`<id>-route.gpx`, uten tidsstempler eller pulsdata) og bilder (`npm run images`).
5. Kjør `npm run airspace` (krever `OPENAIP_API_KEY`), eller vent på den månedlige oppdateringen.
6. Skriv `index.en.md`, eller la statussiden minne om det.
7. Sjekk `/status/` etter bygget: den viser hva som mangler.

## Gjennomgå et flysted

Når stedet er sjekket av noen som kjenner det, settes:

```yaml
status: reviewed
reviewed:
  by: Navn Navnesen
  date: '2026-10-06'
```

Bygget stopper hvis `status` og `reviewed` ikke stemmer overens.

## Statussiden

[`/status/`](https://flysteder.hpgt.com/status/) lages ved hvert bygg (`lib/status.js`), lenkes ikke fra menyen og er
merket `noindex`. Den viser per sted:

| Sjekk | Mangler når |
|---|---|
| nivå, landing, parkering | feltet er tomt (landing ikke når `no_fixed_landing: true`) |
| parkeringstekst | parkeringen er i kartet, men `access.parking_text` mangler |
| gangrute | ingen GPX, og ingen parkering innen 300 m fra starten og mindre enn 50 m lavere |
| starttekst, landingstekst | avsnittet mangler eller er en plassholder |
| høyder | `launch_masl` eller `landing_masl` mangler |
| startbilde, landingsbilde, oversiktsbilde | ingen bilder av den typen |
| luftrom | verken hentet fra openAIP eller ført inn i stedsfilen |
| yr_id, flightlog_id | ikke koblet |
| engelsk tekst (utdatert) | `index.en.md` mangler, eller er eldre enn `index.md` |

## Vindvarselet

- Hentes fra MET ved hvert bygg (jobben `weather`; siden bygges bare når innholdet endres, uten tidsplan).
- **Datatjenesten** (`workers/data`, Cloudflare-kontoen «HPGT») henter selv MET hvert 5. minutt, seks startsteder per
  kjøring, og sidene bruker varselet derfra når det er nyere enn det som er bygget inn i siden. Det ligger på
  `https://data.hpgt.com/v1/forecast.json` (`fetched` = når det eldste startstedet ble hentet). Loggene ligger i
  Cloudflare → Workers & Pages → data → Observability.
- Er varselet mer enn 6 timer gammelt (`maxForecastAgeHours` i `src/_data/windRules.json`), eller kommer det fra en
  modellkjøring hos MET som er mer enn 12 timer gammel (`maxModelAgeHours`), slås vindvurderingen av, og siden sier fra.
- **Hent et nytt varsel nå:** Actions → «Build and deploy» → «Run workflow».
- Grensene for vurderingen står i `src/_data/windRules.json`. Et steds egen grense settes med `wind_limits.max_wind` i
  stedsfilen.
- **Publisere datatjenesten:** skjer av seg selv når `workers/data/`, `lib/weather/met.js` eller en stedsfil endres på
  `main` (Actions → «Data service»), eller med «Run workflow» der. Testes lokalt med `node scripts/data-sites.mjs` og
  `cd workers/data && npm ci --ignore-scripts && npx wrangler dev --test-scheduled` (åpne så `/__scheduled` for å kjøre
  tidsplanen, og `/v1/forecast.json`). For Holfuy lokalt legges `HOLFUY_KEY=…` i `workers/data/.dev.vars` (ignoreres
  av Git).

## Siden på Cloudflare

flysteder.hpgt.com serveres av Cloudflare (Workers static assets, Workeren `flysteder`, `workers/site/wrangler.toml`),
slik at den sender ekte sikkerhetshoder (`src/headers.njk` → `_headers`: HSTS, CSP-en fra `site.csp` med
rapportering, Trusted Types i report-only, innramming, referrer, permissions; se [CSP-rapporter](#csp-rapporter)) og
cacher bildene i et år. Bygget er det samme: jobben «cloudflare» i «Build and deploy»
publiserer arkivet som lages for GitHub Pages, så begge får nøyaktig de samme filene. GitHub Pages får fortsatt hvert
bygg som reserve. Det egne domenet under Settings → Pages kan bli stående; GitHub varsler bare at DNS-posten ikke
lenger peker dit.

- **Tokenet** er `CLOUDFLARE_SITE_TOKEN` i miljøet `cloudflare`, laget under Workers & Pages → flysteder → Settings →
  Builds → «API token for external CI/CD», så det bare kan publisere denne Workeren. Det utløper 19.11.2027. Lag et
  nytt på samme måte et par uker før, bytt hemmeligheten og kjør «Build and deploy». Uten tokenet sier jobben at den
  ble hoppet over, og siden blir som den var.
- **Domenet** flysteder.hpgt.com er et eget domene på Workeren (Settings → Domains & Routes), lagt til for hånd.
  Cloudflare lager DNS-posten, og sertifikatet er Cloudflares eget for hpgt.com. Sjekk med
  `curl -I https://flysteder.hpgt.com/` (`server: cloudflare`, `strict-transport-security`).
- **Tilbake til GitHub Pages ved behov:** fjern det egne domenet fra Workeren, legg CNAME-posten `flysteder` →
  `hpgt-com.github.io` inn igjen i Cloudflare → hpgt.com → DNS som «DNS only» (grå sky), og sjekk at
  `flysteder.hpgt.com` fortsatt er det egne domenet under flying-sites → Settings → Pages. GitHub kan bruke en stund på
  å utstede sertifikatet sitt igjen.

## Adressen til datatjenesten

- `https://data.hpgt.com` er datatjenestens eneste adresse, og den brukes av siden, sjekkene og arbeidsflytene.
  Workerens egen `workers.dev`-adresse er slått av (`workers_dev = false`). Adressen er et eget domene på Workeren
  `data`, lagt til for hånd i Cloudflare (Workers & Pages → data → Settings → Domains & Routes → Add → Custom domain →
  `data.hpgt.com`); Cloudflare lager DNS-posten og sertifikatet. Den står ikke i `wrangler.toml`, fordi
  publiseringstokenet bare kan publisere Workeren og ikke kan lage DNS-poster, og publiseringer lar den være som den er.

## Helsesjekk for datatjenesten

- `https://data.hpgt.com/v1/status.json` (`workers/data/src/health.js`) viser for hver kilde når den sist kjørte, sist
  lyktes og siste feil, og hvor lang tid kjøringene tar (`lastMs`, `avgMs` som glidende snitt, `maxMs` den tregeste i
  dag: en feil på 20 000 ms er et tidsavbrudd, en suksess på 8 000 en treg kilde). For hvert datasett viser den når det
  sist ble skrevet og om det er innenfor grensen (varsel 60 min, stasjoner 15, høydevind 90, verifisering 90), hvilke
  startsteder varselet og høydevinden mangler, og siste arkiverte dag per stasjonskilde. `"ok": false` når et datasett
  er for gammelt.
- «Data service health» (`health.yml`) sjekker den utenfra hver time. Når noe er galt, åpner den saken
  «Datatjenesten: data mangler eller er for gamle» (eller kommenterer på den åpne), og lukker den når alt er i orden
  igjen. GitHub kan kjøre den sent, så et problem kan bruke en time eller to på å vises. Kjør den nå: Actions → «Data
  service health» → «Run workflow».
- Når den melder et problem: loggene ligger i Cloudflare (Workers → data → Observability), og en kilde som feiler,
  beholder feilen i statusen til den lykkes igjen. Vanlige årsaker er en kilde som er nede (MET, Holfuy, Frost,
  Open-Meteo), en utløpt hemmelighet, eller en av gratisplanens daglige grenser (nullstilles kl. 00:00 UTC):
  100 000 forespørsler, og for lageret 100 000 forespørsler, 5 millioner leste rader og 100 000 skrevne rader
  (Cloudflare sender e-post ved 90 %). `test/data-quota.test.js` kjører ett døgn av tidsplanen mot et fullt lager og
  feiler når den bruker mer enn 30 % av noen av disse (kjør den med `QUOTA_DETAIL=1` for å se hva hver spørring koster).
  Hver spørring på tid går gjennom en nøkkel eller en indeks (`workers/data/src/indexes.js`,
  `test/store-indexes.test.js`), og hver indeks koster en skrevet rad per rad. Datasettene caches 60 sekunder foran
  lageret (`cache.js`), så sidevisninger gir lite ekstra.
- Publisering (`data-worker.yml`): etter `wrangler deploy` venter jobben i opptil 6 minutter til den nye versjonen har
  kjørt stasjonene og serverer `/v1/forecast.json` (`scripts/data-smoke.mjs`). Gjør den ikke det, ruller jobben tilbake
  til versjonen som kjørte før (`wrangler rollback`) og feiler, så varselet åpner en sak. Tilbakerulling for hånd:
  Cloudflare → Workers & Pages → data → Deployments, eller `npx wrangler rollback` i `workers/data`.
- Prognosenettene (`/v1/grid.json`, `/v1/grid-wide.json`, `sources/grid.js`) bruker Open-Meteos gratis,
  ikke-kommersielle tilgang: høyst 600 punkter i minuttet og 10 000 i døgnet. Det nære nettet (omtrent 540 punkter)
  hentes hver 3. time og det vide (omtrent 380) hver 6., på ulike minutter, så et døgn bruker omtrent 5 800, og
  høydevinden omtrent 300 til. `test/data-store.test.js` feiler hvis et nett får over 600 punkter eller døgnet over
  7 000. Et større område eller et finere nett krever Open-Meteos betalte API.
- Gjenoppretting: koden ligger i Git (publiser på nytt med Actions → «Data service» → «Run workflow»). Lageret (Durable
  Object-et) har bare data som kommer tilbake av seg selv: varselet og høydevinden innen en halvtime, de siste 7 dagene
  med målinger fra kildenes egen korte historikk (Holfuy og Frost gir bare den siste, så et tapt lager mister dagene som
  ikke er arkivert ennå), og verifiseringen fra da av. Flyaktiviteten per dag (`flight_days`) og
  verifiseringshistorikken (`verify_hours`) sikkerhetskopieres til R2 hver natt kl. 02:14 UTC (`backup.js`:
  `backup/<table>/<day>.json` og `latest.json`, 90 dager beholdes). Et nytt, tomt lager leser `latest.json` inn igjen
  innen ett minutt etter start (`store.js` `restore`, prøvd hvert minutt til det har lyktes én gang, vist i
  `/v1/status.json` som `backup.restored` og som kilden `restore`). Etter et tapt lager er historikken derfor tilbake
  uten noe arbeid for hånd, og en gjenoppretting som stadig feiler, vises i helsesjekken. Arkivet i R2 har målingene
  fra hvert ferdige døgn.

## Værstasjoner (Holfuy)

- Stasjonene står i `workers/data/src/stations.js`: `id` (nummeret i holfuy.com/en/weather/<id>), og eventuelt `name`
  (ellers Holfuys), `model` og `site` (flystedets mappe: den stedssiden viser da «Målt nå» og en Holfuy-knapp, og
  vurderingen for timen nå bruker målingen). Stasjonene er 490 HPGT Heia (stedet `heia`) og 820 Modellflystripa. En
  endring der publiseres av seg selv. En stasjon kobles til et sted bare med `site`, ikke etter avstand.
- Nøkkelen: Cloudflare → Workers & Pages → data → Settings → Variables and Secrets → legg til hemmeligheten
  `HOLFUY_KEY` (type Secret). Publisering beholder den. Uten nøkkel, eller uten stasjoner, hopper tjenesten over Holfuy.
- Hentes hvert minutt. `https://data.hpgt.com/v1/stations.json` har siste måling og de siste 6 timene per stasjon.
  Tjenesten beholder de siste 7 dagene; eldre dager går til arkivet (under), og ingenting slettes før det ligger der.
  Holfuy har godtatt at klubben lagrer målingene over tid.
- Hvor de vises: laget «Klubbens værstasjoner» (METs i eget lag, «METs værstasjoner») på forsidekartet og stedskartene
  (på Holfuys posisjon, eller ved stedets start når Holfuy ikke oppgir noen), korte rader i Vær-fanen, værsiden
  `/vaer/`, og «Målt nå» på stasjonens stedsside. Vurderingen av den målte vinden, endringen over en periode og hvor
  jevn vinden er, regnes ut i nettleseren (`src/assets/js/stations.js`), med grensene i `src/_data/windRules.json`.
- Vurderingen for timen nå (stedssiden og «Nå» på forsiden) bruker en måling som er høyst 15 minutter gammel: en
  strengere måling teller alltid, en bedre bare når vinden den siste halvtimen er jevn. Regelen endres i `rateNow`
  (`src/assets/js/wind.js`), og jevnheten i `measurement` (`stations.js`).
- **Hva varselet sa for hver time:** hver henting av varselet lagrer også varselet for timen som pågår (siste henting i
  timen vinner), og det beholdes i 30 dager i lageret (`forecast_hours`). De siste 6 timene ligger i
  `/v1/forecast.json` som `past`, som «Målt mot varslet» på værsiden tegner over målingene.

## «Meld fra om endring»

- Et kort skjema på hver stedsside (`report.js`) som blir en sak i dette repoet, med tittelen «[Meld fra] <sted>:
  <type>», og det samme skjemaet på `/meld-fra/` (i menyen) for det som ikke gjelder ett sted, med tittelen «[Meld fra]
  Generelt: <type>» (nytt flysted, feil på siden, idé, annet). Datatjenesten tar imot det
  (`POST https://data.hpgt.com/v1/report`, `workers/data/src/report.js`), sjekker det med Cloudflare Turnstile og lager
  saken. Høyst 50 i døgnet, og 3 fra én adresse (lagret bare som en hash med et salt for dagen). Svaret fra Turnstile
  må gjelde `flysteder.hpgt.com` (eller vertene i `REPORT_ORIGINS` ved testing).
- Saken får etikettene for typen (`LABELS` i `report.js`): det som gjelder et sted `endringsforslag` og `site-data`, en
  fare i tillegg `safety`, en feil på siden `bug`, en idé `enhancement`, og et generelt «Annet» ingen. Etikettene må
  finnes i repoet (det gjør de); GitHub dropper uten å si fra en etikett appen ikke får sette. Svaret har sakens nummer
  og adresse, og takken i skjemaet lenker dit.
- **Slå det på** (én gang):
  1. Cloudflare → Turnstile → Add widget: navn «flysteder», vertsnavn `flysteder.hpgt.com`, modus «Managed». Kopier
     **site key** (offentlig) til `turnstileSiteKey` i `src/_data/site.js`. Skjemaet er skjult så lenge den er tom.
  2. **Secret key** fra den samme widgeten: Cloudflare → Workers & Pages → data → Settings → Variables and Secrets →
     legg til hemmeligheten `TURNSTILE_SECRET`.
  3. Sakene lages av klubbens **GitHub App**, så de vises som fra appen, og ingenting utløper: organisasjonen
     `hpgt-com` → Settings → Developer settings → GitHub Apps → New GitHub App. Navn «HPGT Flying Sites Reports» (en
     egen app, ikke «HPGT Flying Sites», som har en nøkkel som kan endre koden), hjemmeside
     `https://flysteder.hpgt.com`, Webhook av, rettigheter **Repository → Issues: Read and write** (ingenting annet),
     «Only on this account». Opprett den, noter **App ID**, og «Generate a private key» laster ned en `.pem`-fil.
     Deretter «Install App» → bare repoet `flying-sites`. Legg til hemmelighetene `REPORTS_APP_ID` (App ID, eller
     Client ID) og `REPORTS_APP_PRIVATE_KEY` (hele `.pem`-filen, som den er) på datatjenesten som over, og slett
     `.pem`-filen. Det finnes ingen reserve med personlig token.
- Uten Turnstile og appen svarer endepunktet 503 «not-configured». Feil fra GitHub står i datatjenestens logger
  (Observability), som `report: GitHub svarte …`.

## CSP-rapporter

- Nettleserne melder brudd på Content-Security-Policy til datatjenesten (`POST https://data.hpgt.com/v1/csp-report`,
  `workers/data/src/csp-report.js`), ved siden av `POST /v1/report`. Adressen er `cspReportUrl` i `src/_data/site.js`,
  og hodene i `src/headers.njk` peker dit: `Reporting-Endpoints: csp="…"`, og `report-uri …; report-to csp` på slutten
  av `Content-Security-Policy` og `Content-Security-Policy-Report-Only`. `<meta>`-CSP-en i sidene har dem ikke (det
  kan ikke en meta-tag), så `site.csp` er uten.
- `Content-Security-Policy-Report-Only: require-trusted-types-for 'script'` prøver Trusted Types uten å håndheve dem.
  Sidenes egne skript bruker ikke `innerHTML`, men Leaflet (`src/assets/leaflet/`) setter HTML-tekst for kreditering,
  prefiks og navnene i lagvelgeren, og Turnstile er fra en tredjepart. Rapportene med `disposition=report` viser hva
  som må endres før regelen kan flyttes til den håndhevede CSP-en, med smale, navngitte policyer.
- Endepunktet lagrer ingenting. Hver rapport blir én linje i loggen, for eksempel
  `csp-report directive=require-trusted-types-for disposition=report blocked=trusted-types-sink path=/kart/ sink="Element innerHTML"`:
  direktivet, `enforce` eller `report`, det som ble blokkert som skjema og vert eller et nøkkelord (`inline`, `eval`,
  `data`, `blob`, `trusted-types-sink`, `trusted-types-policy`), stien på `flysteder.hpgt.com` uten spørrestreng, og
  for Trusted Types navnet på stedet i koden (`Element innerHTML`). Ingen IP-adresse, nettleser, referrer, hele
  adresser eller `sample` (koden eller teksten som ble blokkert). Rapporter fra andre sider enn `flysteder.hpgt.com`
  droppes. Det er ingen personopplysninger i loggene.
- Bare `POST` (andre metoder får 405), bare `application/csp-report` og `application/reports+json` (ellers 415).
  Innholdet leses høyst 16 KB fra strømmen uansett hva `Content-Length` sier (413 over det), høyst 20 rapporter per
  forespørsel, og høyst 30 forespørsler i minuttet fra én adresse (Cloudflares rate limit-binding `CSP_LIMIT` i
  `workers/data/wrangler.toml`, telt under en hash av adressen; over grensen 429). Svaret er 204.
- **Lese rapportene:** Cloudflare → Workers & Pages → data → Observability, og søk etter `csp-report`. Linjer med
  `disposition=enforce` er noe som faktisk ble stoppet på siden; en ny ekstern kilde som mangler i `site.csp`, viser seg
  her som `blocked=https://…`. Utvidelser i nettleseren gir også rapporter (`blocked=chrome-extension` og lignende), og
  de kan ses bort fra.

## Turlogger («Fra turlogger»)

- Turlogger (IGC, og KML med tider) leses på pilotens egen maskin, og bare summene committes:
  `npm run logbook -- ~/turer [~/turer-fra-andre …]` (`scripts/logbook.mjs`, `lib/igc.js`) skriver
  `src/_data/logbook.json`. Se over filen, og commit den. Loggene, sporene og navnene forlater aldri maskinen.
- Kjør det på nytt over alle mappene når det kommer nye logger: filen skrives på nytt hver gang, og den samme turen i en
  IGC- og en KML-fil telles én gang. Én mappe per pilot (`pilots` i filen er antallet mapper). En tur som telles feil,
  kan holdes utenfor med `--skip <del av filnavnet>` (kan gjentas; kjør igjen med de samme utelatelsene).
- En tur finnes der loggen beveger seg 4 m/s eller mer over 20 sekunder (avgang og landing), og teller for nærmeste
  start innen 500 m (et steds `launch` og dets `launches` med posisjon). Skriptet skriver ut hvor mange turer det fant
  per sted, hvor mange som var andre steder, i hvor mange IGC- og KML-filer, og filene uten tur eller som ikke kunne
  leses (`--list` navngir dem). KML virker med tider: en gx:Track, ett stedsmerke per punkt med tid, eller en GpsDump-tur
  (sporloggens tider i FsInfo). En KML med bare en linje har ingen tider og gir ingen tur (eksporter IGC i stedet;
  XCTracer skriver en slik KML ved siden av IGC-filen, og IGC-filen telles).
- Vises på stedssiden som «Fra turlogger» når stedet har turer i filen. Det finnes ingen `src/_data/logbook.json`, så
  boksen er skjult: én pilots logger var for få, og tallene stemte ikke med Flightlog. Filen committes når flere piloter
  har lagt inn logger (eller Flightlog eller pgpilot får et API, #105).

## Piloter i lufta (OGN)

- Kartlaget «Piloter i lufta» spør datatjenesten hvert 10. sekund mens det er på. Datatjenesten spør OGNs livekart
  (`live.glidernet.org/lxml.php`, området rundt stedene med en margin) høyst én gang per 10 sekunder og sender videre
  det den får for paraglidere (`workers/data/src/live.js`; hengglidere og andre luftfartøy holdes utenfor), med hver
  pilots spor og stigning de siste 10 minuttene, holdt bare i lagerets minne (skrives aldri ned; borte når lageret
  kastes ut). Ingen nøkkel.
- **Flyaktivitet** (`workers/data/src/sources/flights.js`): hvert minutt spør datatjenesten OGN på samme måte og teller
  turene til paraglidere som ses fly (3 m/s over bakken, eller stiger eller synker 0,5 m/s, og aldri over 80 km/t: det
  er en bil med appen på). En tur teller for stedet nærmest der piloten først ble sett i lufta (innen 5 km), men først
  når piloten er sett 50 m eller mer over bakken (en bil, en sykkel eller en tur til fots med appen på er aldri det;
  til da venter turen med minuttene sine, og den droppes hvis piloten lander først; uten bakkens høyde teller den etter
  tre kjøringer). En ny tur begynner når piloten har landet: står stille to kjøringer på rad, eller ikke er hørt på 15
  minutter, og i begge tilfeller mindre enn 100 m over bakken der den sist ble sett. Bakkens høyde kommer fra
  Kartverkets høydemodell (`ws.geonorge.no/hoydedata/v1/punkt`, ingen nøkkel), spurt bare for de få pilotene, i én
  forespørsel per kjøring. Uten svar teller et stopp eller et opphold som landing, og et opphold på mer enn to timer
  gjør det alltid. Dagens tilstand holder hver pilots siste posisjon i lufta, og den kastes sammen med nøklene neste
  dag. Bare summene per sted og dag beholdes (`flight_days` i lageret: turer, piloter, minutter, lengst fra start,
  høyest). Dagens piloter skilles med en nøkkel laget med et tilfeldig salt for dagen (tilstanden `flights-today`), som
  byttes ved første kjøring på en ny dag, så ingen enhets-id beholdes. Serveres som `/v1/flights.json`, og vises på
  stedssiden og på /flyaktivitet/ (`activity.js`). Tellingen begynte da dette ble publisert (`flights-since`).
- **Turloggen** (`flights` i lageret, `/v1/flight-log.json`): hver tur for seg også, når den er ferdig (landet, et
  opphold, eller oppryddingen etter to timer uten livstegn): stedet, start og slutt, minuttene, høyeste punkt, lengst
  unna, toppfarten og OGNs posisjoner, én per kjøring (ett minutt mellom)
  ([time, lat, lon, alt, speed m/s, climb m/s]). En tilfeldig id, ingen enhet og ingen nøkkel. En tur som aldri ble sett
  50 m over bakken (en bil, en sykkel eller en tur til fots med appen på), beholdes ikke i det hele tatt. Turer beholdes
  i 120 dager; summene per sted og dag blir stående for alltid. Vises på /flyaktivitet/ under «Siste turer» (den valgte
  turen på et kart, med høydekurven: pek på kurven for å se hvor piloten var; «‹ Forrige» og «Neste ›» går gjennom
  turene i tid, og «Alle turer denne dagen» viser dagens turer på ett kart, hver i sin farge, med høydekurvene mot
  klokka; `#tur-<id>` og `#dag-<YYYY-MM-DD>` åpner dem) og på stedssiden som «Siste turer herfra», der hver lenker til
  `/flyaktivitet/#tur-<id>`. Sikkerhetskopieres sammen med de andre tabellene.
- OGNs regler (`https://www.glidernet.org/ogn-data-usage/`): ODbL med kreditering, følg eiernes personvernvalg, og send
  ikke videre noe som er eldre enn 24 timer. OGNs livedata holder allerede utenfor enheter som ikke skal spores, og gir
  de uidentifiserte et tilfeldig navn, som vises her som «Ukjent».
- **APRS-reserven** (`workers/data/src/aprs.js`): når livekartet ikke svarer, leser både laget og flyaktiviteten de
  samme posisjonene fra OGNs APRS-strøm i stedet (`aprs.glidernet.org:14580`, bare lesing med passcode -1 og et
  områdefilter for det samme området): laget lytter i 8 sekunder, flyaktiviteten i 20. Strømmen er OGNs egen ryggrad,
  som mottakere og apper som pgpilot sender til, og den krever ingen egen mottaker. Siden strømmen har alle enheter,
  følges OGNs regler her: flagget mot sporing i hver melding og `tracked: N` i OGNs enhetsdatabase
  (`ddb.glidernet.org/download/ddb-cache.csv`, hentet av lageret hver dag kl. 05:14 UTC når OGN er oppe, kilden
  `ognDdb` i `/v1/status.json`, tilstanden `ogn-notrack`) holder en enhet utenfor, og ingen navngis (alle er «Ukjent»).
  Databasen kan være nede samtidig med livekartet, så listen hentes på forhånd, og den lagrede brukes til den er en uke
  gammel. Uten noen liste gir reserven ingenting. `/v1/live.json` har da `"via": "aprs"`, og kjøringen av turene logger
  `flights: … fra OGNs APRS-strøm`. Den hjelper ikke når hele OGN er nede, eller når en pilots app ikke fikk sendt.
- Adressen er den OGNs eget livekart bruker, og den er ikke dokumentert. Endrer OGN den, brukes reserven over, og
  feiler også den, viser laget ingenting, og datatjenesten logger `live: …`. Mottakere nær Harstad: AVX970 nord for
  Evenes, AVX1058 Hadsel/Sortland og AVX1004 Tromsø (`live.glidernet.org/rec.php`).

## Hvor godt varselet treffer

- Datatjenesten parer varselet for hver ferdige time (slik det sto i timen, `forecast_hours`) med det flystedets egen
  stasjon målte i den (`workers/data/src/sources/verify.js`): middelvinden, det høyeste kastet og retningen, og der
  stasjonen måler dem, temperaturen og lufttrykket (varselets verdier lagres også per time i `forecast_hours`; begge
  trykkene er ved havnivå). To ganger i timen (:09 og :39). Parene beholdes i et år (`verify_hours`); de siste 30
  dagene summeres i `https://data.hpgt.com/v1/verification.json`.
- Hvilke steder: de med egen stasjon (`site` i `HOLFUY_STATIONS`, og `MET_STATION_SITES`), det vil si Heia og
  Sætertinden, og de med en stasjon i nærheten på omtrent samme høyde (`near` i `HOLFUY_STATIONS`), det vil si
  Hinnstein mot stasjonen på Heia. En stasjon i nærheten vises også under «Målt nå» på det stedets side, med avstanden;
  bare et steds egen stasjon brukes i vurderingen av timen nå. Andre steder har ingen stasjon nær nok på sin høyde (de
  fleste stasjonene står nede ved veien eller sjøen), så de holdes utenfor i stedet for å sammenlignes med en
  dalstasjon. Vises under «Målt nå» på stedssiden og i «Målt mot varslet» på /vaer/ når det finnes 24 timer (før det,
  hvor langt innsamlingen har kommet).

## Høydevind

- Hentes av datatjenesten fra Open-Meteo, to startsteder hvert 10. minutt (hvert omtrent hver halvtime), for
  startstedene i `WINDGRAM_SITES` i `lib/weather/open-meteo.js` (`workers/data/src/sources/windgram.js`), og serveres som
  `https://data.hpgt.com/v1/windgram.json`, med regn, skydekke, sol og vindkast per time til radene under rutenettet.
  Ingen nøkkel. Et startsted som feiler, beholder forrige rutenett i opptil 6 timer. Stedssiden bruker det når det er
  nyere enn rutenettet som er bygget inn i siden; avsnittet er skjult når ingen av dem har timer igjen.
- Et nytt startsted: legg mappen til i `WINDGRAM_SITES` og publiser både siden og datatjenesten.

## Værstasjoner (MET)

- METs egne stasjoner finner datatjenesten selv: én gang i døgnet spør den Frost etter stasjonene i området rundt
  flystedene, og beholder dem innen 50 km fra en start (Lofoten til Bardu) som måler vind
  (`workers/data/src/sources/frost.js`). De siste observasjonene hentes hvert 10. minutt (vind, retning, kast,
  temperatur, fuktighet, trykk, regn), lagres og arkiveres som Holfuys (`met/station=SN…/…` i arkivet), og serveres i
  `/v1/stations.json` sammen med Holfuys, hver stasjon med kilden sin («MET Norge», lisens CC BY).
- Klient-ID-en: registrer (gratis) på `https://frost.met.no/auth/requestCredentials.html` med klubbens e-postadresse,
  og så Cloudflare → Workers & Pages → data → Settings → Variables and Secrets → legg til hemmeligheten
  `FROST_CLIENT_ID` (bare klient-ID-en; klienthemmeligheten brukes ikke). Uten den hopper tjenesten over MET.
- En MET-stasjon på et flysted kobles til det i `MET_STATION_SITES` i `workers/data/src/stations.js` (METs nummer og
  stedets mappe; Sætertindens egen MET-stasjon, SN87772, er koblet dit). En stasjon som ikke skal vises, legges i
  `MET_EXCLUDE` samme sted; stasjonene slås da opp på nytt ved neste kjøring.

## Værarkivet (R2)

- Én CSV per stasjon per døgn (UTC) i R2-bøtta `hpgt-data-archive`: `holfuy/station=<id>/year=<year>/<date>.csv`
  (kolonnene `source, station, time_utc, direction_deg, speed_ms, gust_ms, min_ms, temperature_c, humidity_pct,
  pressure_hpa, rain_mm, extra_json`), og stasjonene i `holfuy/stations.csv` (`source, station, name, model, site,
  lat, lon, altitude_m`). En stasjon uten en sensor lar kolonnen stå tom. Andre tall en stasjon sender, beholdes i
  `extra_json` til de får en egen kolonne (`workers/data/src/measurements.js`; lageret legger til kolonnen).
  `source` + `station` identifiserer en stasjon, siden to leverandører kan bruke samme nummer. Skrives fra kl. 03:00 UTC
  for døgnet før, så målinger som kommer sent, kommer med (`workers/data/src/archive.js`). De ferske målingene
  publiseres før arkivet skrives, så et arkiv som feiler (R2 nede), stopper ikke «Målt nå»; ingenting slettes fra
  lageret før døgnet er arkivert.
- Mappene bruker formen `key=value`, så DuckDB, BigQuery, Athena og Spark leser `station` og `year` som kolonner, og hver
  rad har stasjonen, så alle filene kan lastes inn i én tabell. Eksempel med DuckDB og R2s S3-adresse:
  `SELECT station, date_trunc('day', time_utc) AS day, avg(speed_ms), max(gust_ms) FROM read_csv('s3://hpgt-data-archive/holfuy/*/*/*.csv', hive_partitioning = true) GROUP BY ALL ORDER BY day;`
- **Oppsett** for en ny konto eller bøtte (uten arkivet beholder tjenesten alle målingene, så ingenting går tapt):
  1. Cloudflare → R2 → slå på R2 (Free: 10 GB og gratis nedlasting; Cloudflare kan be om et kort selv innenfor
     gratisgrensene) og lag bøtta `hpgt-data-archive` (privat, ingen offentlig tilgang).
  2. Det daglige publiseringstokenet (miljøet `cloudflare`, laget fra Workeren) kan publisere Workeren med
     R2-bindingen; det trengs ingen ekstra rettighet. Bare «Recover» skriver objekter til R2, med sitt eget token.
  3. Bindingen `[[r2_buckets]]` i `workers/data/wrangler.toml` (binding `ARCHIVE`, bøtte `hpgt-data-archive`). Først
     etter steg 1 og 2: en publisering med bindingen og uten bøtte feiler.
- Lese filene til rapporter: R2 → `hpgt-data-archive` → Settings → R2 API tokens (bare lesing), og bruk dem med
  S3-adressen `https://<account id>.r2.cloudflarestorage.com`.
- **Kopi utenfor Cloudflare** (`.github/workflows/backup.yml`, hver natt kl. 03:30 UTC og for hånd med «Run
  workflow»): hele bøtta kopieres med rclone til bøtta `hpgt-flysteder-backup` hos Backblaze B2 (en annen leverandør,
  så en tapt Cloudflare-konto eller bøtte ikke mister dataene) under `archive/`, uten at noe slettes der (B2-bøtta
  beholder også gamle versjoner). Deretter sjekkes kopiens `latest.json` for hver tabell (`scripts/check-backup.mjs`,
  `lib/backup-check.js`): den finnes, kan leses som den tabellen, og er fra i dag eller i går. Før det bekrefter
  `rclone check` at hver fil i R2 ligger i kopien med samme sjekksum, og etter opplastingen sjekkes sakene og
  Git-bunten i B2 også (bunten høyst 8 dager gammel). Hvert steg kjører med `shell: bash` (pipefail), så en rclone som
  feiler, gjør kjøringen rød i stedet for å skjules av `| tail`. Sakene og kommentarene deres går til `github/` hver
  natt (den eneste kopien av «Meld fra» utenfor GitHub), og hele Git-historikken som en bunt til
  `git/flying-sites.bundle` på søndager (`git clone flying-sites.bundle` gjenoppretter den). En natt som feiler, åpner
  saken «Backup: den nattlige kopien feilet», som lukkes av neste gode natt. Nøklene ligger i GitHub-miljøet `backup`
  (se [Kontoer og hemmeligheter](#kontoer-og-hemmeligheter)). Kopien sammenligner sjekksummer fra listingene
  (`--checksum`), så en natt koster noen få Class C-listinger hos B2 og ingen Class B-kall per fil; B2s gratis daglige
  tak (2 500 Class B- og 2 500 Class C-transaksjoner, under Caps & Alerts) er da langt unna. En full gjenoppretting
  laster ned hver fil én gang, som er ett Class B-kall per fil: øk Class B-taket for den dagen (det koster brøkdeler av
  en cent per 10 000) før «Recover» kjøres med `restore_archive`. **Gjenopprette R2 fra kopien** (en tapt bøtte): lag
  bøtta, og så fra en maskin med rclone og begge nøklene:
  `rclone copy b2:hpgt-flysteder-backup/archive r2:hpgt-data-archive`. Datatjenesten leser så historikken inn igjen av
  seg selv innen ett minutt etter at lageret er tomt (`store.js` `restore`).

## Luftrom

- Hentes fra openAIP den 1. hver måned (`airspace.yml`). Det kommer som en PR som bør leses gjennom før merge.
  Arbeidsflyten har to jobber: `fetch` henter dataene med lesetilgang, og `pr` åpner PR-en.
- **Kontrollert og endret er to datoer.** Hver vellykket kjøring skriver `src/_data/cache/airspace/checked.json`
  (datoen for kontrollen), også når luftrommet er uendret, så det kommer en PR hver måned; når den merges, er det
  registrert at kontrollen er gjort. `fetched` i hvert steds fil er når stedets luftrom sist endret seg. Stedssiden viser
  begge («Kontrollert mot openAIP …, sist endret …»), og varsler («Luftrommet er ikke kontrollert mot openAIP siden …»)
  når siste kontroll er mer enn 45 dager gammel (`AIRSPACE_STALE_DAYS` i `lib/airspace.js`). Varselet slås også på i
  nettleseren, så en side bygget før grensen varsler likevel senere.
- **Ingen geografiske søk hos openAIP.** openAIP svarer på `pos`/`dist`- og `bbox`-søk med 403 fra Cloudflare
  («Geospatial query for external clients no longer available» på openaip.net/blog), uansett nøkkel. Skriptet henter
  derfor luftrommet for Norge og Sverige (`country`) og velger selv ut området rundt stedene (`withinCircles` i
  `lib/airspace.js`). En ny nøkkel hjelper ikke mot en 403 som sier «fra Cloudflare foran openAIP»; mot en 403 med
  openAIPs egen melding (en utløpt nøkkel) hjelper den.
- **Hent nå:** Actions → «Update airspace» → «Run workflow», eller `npm run airspace` lokalt.
- Nøkkelen `OPENAIP_API_KEY` ligger i miljøet `automation` (se [Kontoer og hemmeligheter](#kontoer-og-hemmeligheter)).
  Oppdateringen virker ikke uten den.
- **GitHub App «HPGT Flying Sites»**. Klubbens app for automatisering i GitHub Actions, brukt av arbeidsflytene for
  luftrom og hindre til å åpne PR-ene sine. PR-ene får sjekkene som alle andre. GitHub Actions kan ikke lage pull
  requests med sitt eget token i organisasjonen, så arbeidsflytene feiler hvis appen ikke er satt opp. Oppsett (en med
  admin-tilgang til hpgt-com):
  1. hpgt-com → Settings → Developer settings → GitHub Apps → New GitHub App. Navn «HPGT Flying Sites», hjemmeside
     `https://flysteder.hpgt.com`, Webhook «Active» av. Repository permissions: Contents = Read and write, Pull
     requests = Read and write (Metadata = Read legges til automatisk). Ingenting annet. «Only on this account». Gi den
     bare det arbeidsflytene som bruker den, trenger, og utvid når en ny oppgave trenger mer. Alt som kjører utenfor
     GitHub eller tar imot input fra publikum (som et skjema), skal ha en egen app.
  2. På appsiden: noter **Client ID**, og «Generate a private key» (laster ned en `.pem`-fil).
  3. «Install App» → hpgt-com → «Only select repositories» → flying-sites.
  4. Variabelen `APP_CLIENT_ID` (Client ID) under flying-sites → Settings → Secrets and variables → Actions →
     Variables, og hemmeligheten `APP_PRIVATE_KEY` (hele innholdet i `.pem`-filen) i miljøet `automation`. Slett så
     `.pem`-filen.
  5. Test appen: Actions → «Update airspace» → «Run workflow», kryss av «Test the GitHub App token only». Jobben
     `test-app-token` får et token med lesetilgang fra appen og leser repoet; den henter ikke luftrom og åpner ingen PR.
     Grønt betyr at appen virker. PR-ene kommer fra `hpgt-flying-sites[bot]`.
- Merknader om luftrom (for eksempel at innflygingen går inn i Evenes CTR) står i stedsfilens `airspace`.
- Tårnenes telefonnumre står bare i `src/_data/towers.json` (med navn per språk i `names`).

## Kraftlinjer og hindre

- Kartlaget «Kraftlinjer og hindre» (forsiden og stedssidene, av til det slås på) kommer fra
  `src/_data/cache/obstacles/` (`index.json` og `tiles/<row>_<column>.geojson`, 0,25° × 0,5°, omtrent 28 × 20 km), hentet
  av `npm run obstacles` (`scripts/update-obstacles.mjs`, `lib/obstacles.js`) for hele regionen rundt stedene (25 km
  utenfor de ytterste, ut til hele ruter), så turer bort fra stedene også er dekket. Kartet laster bare rutene som er i
  bildet, fra zoom 10 («Zoom inn for å se kraftlinjer» lenger ut). Et nytt sted langt fra de andre utvider regionen ved
  neste henting.
  - **NVE** (`kart.nve.no/enterprise`, NLOD): luftledningene i sentral-, regional- og distribusjonsnettet (22 kV og
    oppover) med spenning og eier, og vindturbiner i drift. Mastene og stolpene bare innen 1,5 km fra hvert steds
    starter og landinger (det er over 40 000 i regionen; linjene viser hvor de står).
  - **OpenStreetMap** (Overpass, ODbL, ett søk for hele regionen): lavspentlinjer (`power=minor_line`), skiheiser og
    andre taubaner (også `aerialway=yes`, som gamle vareløyper), og kommunikasjonsmaster. Bare der noen har tegnet dem.
- Hentes den 2. hver måned (`obstacles.yml`); endringer kommer som en PR. Det trengs ingen hemmeligheter. **Hent nå:**
  Actions → «Update power lines and obstacles» → «Run workflow», eller `npm run obstacles` lokalt.
  `npm run obstacles -- --no-osm` henter bare NVE (når Overpass ikke svarer); filen sier da fra om det, og kartets
  kreditering nevner bare NVE.
- Ikke komplett: lavspent (230/400 V) er ikke i NVEs data og bare delvis i OpenStreetMap, og vaiere som ikke er
  kraftlinjer (barduner, tømmer- og vareløyper), er sjelden i noen av dem. Kartverkets register over luftfartshindre
  (NRL) er stengt for publikum («Norge digitalt begrenset»; tilgang for berettigede brukere etter søknad til
  Kartverket). Det som er kjent lokalt, hører hjemme i stedets farer.
- En heis, linje eller mast som mangler, legges best inn i OpenStreetMap; den kommer med ved neste månedlige henting.

## Kartfliser

- Kartverkets fliser (`cache.kartverket.no`) ligger ferdige for land, men fliser som for det meste er sjø eller utenfor
  Norge (det meste av en vid utsikt, fra omtrent 30 km-målestokken og ut), lages på nytt for hver forespørsel og tar
  0,5–1 s hver, så en utzooming venter på dem. På PC (fin peker, vindu minst 900 px bredt, uten datasparing) henter
  forsidekartet flisene for de to neste zoomnivåene ut i bakgrunnen (`warmZoomOut` i `common.js`): 1,5 s etter at de
  første flisene er vist, og 0,4 s etter hver utzooming, høyst 160 fliser per sidevisning, fire om gangen. Steget ut
  tegnes da fra nettleserens cache. Telefoner lar det være (data).
- Service workeren (`lib/service-worker.js`) beholder de siste `MAX_TILES` (500, i `lib/pwa.js`) Kartverket-flisene til
  bruk uten nett, gir en flis til kartet så snart den kommer og lagrer den etterpå, og rydder lageret bare hver 20.
  flis, så en zoom som gir tjue nye fliser, ikke holdes igjen av tjue oppryddinger.

## Bilder

```bash
npm run images -- ~/Bilder/flysteder        # importerer alle bilder som er navngitt etter konvensjonen
npm run images -- elgen landing bilde.jpg    # ett bilde for et sted
npm run images                               # sjekker og krymper alle bildene i repoet
```

Navngiving før import: `Storlitinden_Takeoff_SE_1_DSC04968.jpg`, `Storlitinden_Landing_1_DSC05012.jpg`,
`Storlitinden_Overview_1_DJI_0042.jpg`. Se [SPEC.md](../SPEC.md#innhold). Standard fotograf og lisens settes i
`src/_data/photoCredit.json`.

## Statistikk

- [GoatCounter](https://hpgt-flysteder.goatcounter.com), kontoen `hpgt-flysteder`. Anonymt og uten informasjonskapsler.
  Teller ikke på localhost.
- Skriptet er en kopi i `src/assets/js/goatcounter.js` (CSP-en tillater bare sidens egne skript). Adressen settes i
  `src/_data/site.js` og i CSP-en i `base.njk`.
- Hendelser (klikk) har faste engelske navn, de samme på alle språk: `link/<domain><page>`, `download/<file>`,
  `tab/sites|weather`, `filter/direction|level|category/…`, `filter/wind/<hours from now>`, `filter/suggest/on|off`,
  `map/select/<id>`, `map/status` (statusdetaljene åpnet), `list/show-all`, `list/open/<id>` (andre trykk i listen på
  mobil), `day-plan/select/<id>`, `map-layer/<key>` (topo, greyscale, opentopomap, satellite, skyways, thermals,
  hillshade, radar, airspace-tma, airspace-ctr, airspace-military, airspace-danger), `search/no-hits` (bare telt,
  søketeksten sendes ikke), `images<page>`, `fullscreen<page>`, `setting/theme/…`, `setting/colorblind/on|off`.
  Hendelser til og med 11.10.2026 har norske navn i GoatCounter (`lenke/…`, `fane/…`, `kart/valgt/…` osv.), og
  `tab/info` finnes i eldre data.
- Egne besøk telles ikke etter at `https://flysteder.hpgt.com/#toggle-goatcounter` er åpnet i nettleseren.

## Nytt språk

1. Legg språket til i `src/_data/languages.js`: `code`, `name` (slik det skrives på språket selv), `locale` (for Open
   Graph), `prefix` (`/de`) og `slugs` (adresser: `{ flysteder: "orte", tarn: "tuerme" }`).
2. Kopier `src/_i18n/en.json` til `src/_i18n/<code>.json` og oversett verdiene. Nøkler som mangler, vises på norsk.
3. Legg språkets norske navn til i `LANGUAGE_WORDS` i `lib/status.js`, så statussiden kan vise «tysk tekst».
4. Oversett stedene i `index.<code>.md`, eller la statussiden vise hva som mangler.
5. `npm test` sjekker at ordboken bare har nøkler som finnes i `nb.json`.

## Kontoer og hemmeligheter

| Hva | Hvor | Brukes til |
|---|---|---|
| `OPENAIP_API_KEY` | GitHub → Settings → Environments → `automation` (bare `main`) | Månedlig henting av luftrom |
| GitHub App «HPGT Flying Sites»: `APP_CLIENT_ID` (variabel), `APP_PRIVATE_KEY` (hemmelighet) | hpgt-com → Developer settings → GitHub Apps; variabelen under flying-sites → Settings → Secrets and variables, hemmeligheten i miljøet `automation` (bare `main`) | Automatisering i GitHub Actions (PR-ene for luftrom og hindre, så PR-sjekken kjører) |
| Cloudflare-kontoen «HPGT» (eieren står under Manage account → Members, og bør være en klubbadresse) | dash.cloudflare.com | Siden (`flysteder.hpgt.com`), datatjenesten (`data.hpgt.com`) og «Meld fra» |
| `HOLFUY_KEY` | Cloudflare → Workers & Pages → data → Settings → Variables and Secrets | Holfuy-stasjonene |
| `FROST_CLIENT_ID` | Cloudflare → Workers & Pages → data → Settings → Variables and Secrets | METs stasjoner (Frost) |
| `TURNSTILE_SECRET` | Cloudflare → Workers & Pages → data → Settings → Variables and Secrets | «Meld fra»: robotsjekken (site key er offentlig, i `src/_data/site.js`) |
| GitHub App «HPGT Flying Sites Reports»: `REPORTS_APP_ID`, `REPORTS_APP_PRIVATE_KEY` | Cloudflare (som over); appen under hpgt-com → Developer settings → GitHub Apps | «Meld fra»: lager sakene (bare Issues: read and write) |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | flying-sites → Settings → Environments → `cloudflare` (bare `main`) | Publisering av datatjenesten. Tokenet er et kontotoken som bare kan publisere Workeren `data`, laget under Workers & Pages → data → Settings → Builds → «API token for external CI/CD» (står under Manage Account → Account API Tokens). Bytte det: lag et nytt der, oppdater hemmeligheten, kjør «Data service» én gang, og slett det gamle tokenet. |
| `CLOUDFLARE_SITE_TOKEN` | flying-sites → Settings → Environments → `cloudflare` (bare `main`) | Publisering av siden til Cloudflare (jobben «cloudflare» i «Build and deploy»). Et kontotoken som bare kan publisere Workeren `flysteder`, laget fra Workeren. Utløper 19.11.2027. Se [Siden på Cloudflare](#siden-på-cloudflare). |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | flying-sites → Settings → Environments → `recovery` (bare `main`, krever godkjenning fra teamet `maintainers`) | Bare «Recover». Tomt til vanlig: tokenet (Workers Scripts: Edit, Workers R2 Storage: Edit, Account Settings: Read, bare kontoen HPGT, kort levetid) lages når en gjenoppretting trenger det, og slettes etterpå. Se [Katastrofegjenoppretting](#katastrofegjenoppretting). |
| GoatCounter `hpgt-flysteder` | goatcounter.com | Besøksstatistikk |
| Backblaze B2 (gratisplan; kontoen står på klubbens adresse) med bøtta `hpgt-flysteder-backup` (privat, EU-region, livssyklus «keep prior versions for 90 days»: en fil som skrives på nytt, beholder den gamle versjonen i 90 dager, og filer som skrives én gang, beholdes for godt) og nøkkelen `github-backup` (bare den bøtta, lese og skrive, utløper ikke) | backblaze.com | Kopien utenfor Cloudflare av arkivet, sikkerhetskopiene, sakene og koden (`backup.yml`) |
| `B2_KEY_ID`, `B2_APPLICATION_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (hemmeligheter); `B2_ENDPOINT`, `R2_ENDPOINT` (variabler; `B2_BUCKET` og `R2_BUCKET` bare når navnene avviker fra standardverdiene i `backup.yml`) | flying-sites → Settings → Environments → `backup` (bare `main`) | `backup.yml`. R2-tokenet (et kontotoken, bare Object Read, bare `hpgt-data-archive`) lages under R2 → Manage R2 API Tokens → Create Account API token |
| `B2_KEY_ID`, `B2_APPLICATION_KEY` (hemmeligheter, en nøkkel med bare lesetilgang); `B2_ENDPOINT` (variabel; `B2_BUCKET` bare når navnet avviker) | flying-sites → Settings → Environments → `backup-read` (bare `main`) | `restore-drill.yml` og hentingen i `recover.yml`. En Backblaze application key med **Read Only**-tilgang til bare `hpgt-flysteder-backup`, så øvelsen og en gjenoppretting ikke kan endre eller slette kopien |
| UptimeRobot (gratisplan; kontoen står på e-postadressen til eier og flyttes ved å endre den under My Settings → Account) | uptimerobot.com | Tre overvåkinger hvert femte minutt: `https://flysteder.hpgt.com/` svarer, `https://hpgt.com/` (klubbens side) svarer, og `/v1/status.json` på datatjenesten inneholder `"ok":true`. Sender e-post til varslingskontaktene når en feiler, og når den er tilbake. |
| Cloudflare-Workeren `flysteder`, domene | Cloudflare → Workers & Pages → flysteder (eget domene `flysteder.hpgt.com`) | Serverer siden; GitHub Pages (Settings → Pages) får hvert bygg som reserve |

MET og Kartverket krever ingen nøkkel. MET krever at klienten oppgir kontaktinformasjon (`USER_AGENT` i
`lib/weather/met.js`).

## Runbook

Hva som gjøres når noe stopper, og hvordan neste styre tar over. Alt her kan gjøres av én person med admin på repoet og
Cloudflare-kontoen; ingenting krever en utviklermaskin, bortsett fra der `npm` er nevnt.

**En kilde er nede (MET, Holfuy, Frost, Open-Meteo, OGN).** Ingenting å gjøre. Datatjenesten beholder siste gode data,
sidene viser dem med alderen, og vurderingen slås av når varselet er for gammelt (6 timer). Statusen
(`/v1/status.json`) viser kildens siste feil; den timevise sjekken åpner en sak bare når kilden har feilet i et døgn,
eller et datasett er over grensen sin.

**Tidsplanen har stoppet.** GitHub slår av tidsplanen i et offentlig repo etter 60 dager uten commit, og kjører den sent
når det er travelt. Tegn: den månedlige luftroms-PR-en kom ikke, eller «Data service health» har ikke kjørt på flere
dager (Actions → arbeidsflyten → listen over kjøringer). Løsning: Actions → arbeidsflyten → «Enable workflow», og så
«Run workflow». En commit av hvilken som helst type nullstiller de 60 dagene. Datatjenestens egen tidsplan kjører på
Cloudflare og berøres ikke, og UptimeRobot (se [Kontoer og hemmeligheter](#kontoer-og-hemmeligheter)) overvåker siden og
statusen utenfra GitHub uansett hva tidsplanen gjør: en e-post derfra er det første tegnet på et problem i en stille
periode.

Klubbens offentlige statusside [status.hpgt.com](https://status.hpgt.com) (Upptime i repoet `hpgt-com/status`, lenket som
«Driftsstatus» i menyen: `site.statusUrl`) sjekker også siden og datatjenesten hvert 5. minutt fra GitHub Actions, og
åpner en sak der når en av dem er nede. Oppsettet er beskrevet i [«Hva overvåker hva»](https://github.com/hpgt-com/hpgt-web/blob/main/docs/operations.md#hva-overvåker-hva) i hpgt-web.

**Datatjenesten svarer ikke, eller svarer 503.** Sidene virker fortsatt med det innebygde varselet. Se i Cloudflare →
Workers & Pages → data → Observability (loggene navngir kilden og feilen) og Metrics (gratisplanens daglige grenser
nullstilles kl. 00:00 UTC; Cloudflare sender e-post ved 90 %). En dårlig versjon: rull tilbake under Deployments (eller
`npx wrangler rollback` i `workers/data`). Et tapt lager kommer tilbake av seg selv, se
[Helsesjekk for datatjenesten](#helsesjekk-for-datatjenesten). Publisere på nytt fra koden: Actions → «Data service» →
«Run workflow».

**En publisering av siden gikk galt.** Actions → «Build and deploy» → en tidligere grønn kjøring → «Re-run all jobs»
publiserer den commiten igjen, med et ferskt varsel. Varig: `git revert` av mergen på `main` gjennom en PR. Ingenting
går tapt: hver publisering bygges fra Git.

**En hemmelighet eller et token kan ha lekket, eller har utløpt.** Bytt den der den ligger (tabellen under
[Kontoer og hemmeligheter](#kontoer-og-hemmeligheter)); ingenting annet trenger å endres:

- `CLOUDFLARE_API_TOKEN` i `cloudflare`: et nytt token fra Workeren (Workers & Pages → data → Settings → Builds → «API
  token for external CI/CD»), så miljøet `cloudflare` i GitHub, kjør «Data service» én gang, og slett det gamle tokenet
  under Manage Account → Account API Tokens. Når det utløper, feiler «Data service» med en autentiseringsfeil.
- `CLOUDFLARE_SITE_TOKEN` i `cloudflare`: på samme måte fra Workeren `flysteder`, se
  [Siden på Cloudflare](#siden-på-cloudflare).
- `CLOUDFLARE_API_TOKEN` i `recovery`: til vanlig finnes det ikke. Ble det liggende igjen etter en gjenoppretting,
  slettes det i Cloudflare, og hemmeligheten fjernes.
- Workerens hemmeligheter (`HOLFUY_KEY`, `FROST_CLIENT_ID`, `TURNSTILE_SECRET`, `REPORTS_APP_*`): ny verdi under
  Variables and Secrets; versjonen som kjører, tar den i bruk med en gang. For en nøkkel til en GitHub App lages en ny
  nøkkel under appen, og den gamle slettes. For Turnstile gir en ny widget under Cloudflare → Turnstile en ny site key
  (`src/_data/site.js`) og hemmelighet.
- `OPENAIP_API_KEY` og `APP_PRIVATE_KEY`: ny verdi under Settings → Environments → `automation`.
- En GitHub-konto med admin: bytt passord, sjekk Settings → Sessions og Applications, og behold totrinnsinnlogging med
  en sikkerhetsnøkkel.

Kan et token med skrivetilgang til repoet ha lekket, leses også commitene og Actions-kjøringene siden da (Settings →
Audit log i organisasjonen).

**Domenet svarer ikke, eller viser feil side.** `flysteder.hpgt.com` og `data.hpgt.com` er egne domener på Workerne
`flysteder` og `data` (Workers & Pages → Workeren → Settings → Domains & Routes), i sonen `hpgt.com` på Cloudflare. Er
et domene borte, legges det til igjen der; Cloudflare lager DNS-posten og sertifikatet. Sonen `hpgt.com` forvaltes
utenfor dette repoet. For å gå tilbake til GitHub Pages, se [Siden på Cloudflare](#siden-på-cloudflare); GitHub sjekker
da også verifiseringsposten `_github-pages-challenge-hpgt-com` (Organization → Settings → Pages → Verified domains).

**Overlevering til et nytt styre.** Gi den nye personen eierrolle i GitHub-organisasjonen `hpgt-com` og admin på repoet,
et medlemskap med Administrator på Cloudflare-kontoen «HPGT» (og flytt kontoens eier til en klubbadresse hvis den
fortsatt er en persons), tilgang til GoatCounter-kontoen og til DNS for `hpgt.com`, og eierskap til de to GitHub-appene
(organisasjonen eier dem). Fjern så dem som har sluttet. Sjekklisten i `SECURITY.md` er listen over innstillinger som
gås gjennom etterpå.

## Katastrofegjenoppretting

Hva som går tapt når hver del forsvinner, hva som bringer den tilbake, og hvor lang tid det tar. Siden er statisk og
bygges fra Git, og datatjenesten har bare data som kommer tilbake av seg selv innen en time, bortsett fra historikken og
arkivet, som kopieres hver natt.

**Mål.** Høyst 24 timer med historikk og arkiv tapt (kopiene tas hver natt). Siden og datatjenesten tilbake innen en
time, uten steg som krever en utviklermaskin.

**Hva som ligger hvor, og kopiene.**

| Hva | Ligger i | Kommer tilbake fra | Kopi tas |
|---|---|---|---|
| Kode, stedsfiler, bilder, arbeidsflyter | GitHub (`hpgt-com/flying-sites`) | En hvilken som helst klone; `git/flying-sites.bundle` i B2-bøtta (`git clone flying-sites.bundle`) | Bunt hver søndag (`backup.yml`); hver vedlikeholders klone |
| Saker (også «Meld fra») og kommentarer | GitHub | `github/issues.json` og `github/issue-comments.json` i B2-bøtta, slik API-et gir dem | Hver natt |
| Varsel, høydevind, prognosenett, siste 7 dager med målinger, piloter i lufta | Lageret (Durable Object) | Kildene, innen en time; de siste 7 dagene med målinger bare så langt kildenes egen historikk rekker (Holfuy og Frost gir bare den siste) | Trengs ikke |
| Flyaktivitet per dag, verifiseringshistorikk | Lageret | `backup/<table>/latest.json` i R2, lest inn av lageret selv innen ett minutt etter at det er tomt (`store.js` `restore`) | Hver natt kl. 02:14 UTC til R2, kl. 03:30 UTC videre til B2 |
| Værarkivet (CSV per stasjon og døgn) | R2 `hpgt-data-archive` | `archive/` i B2-bøtta `hpgt-flysteder-backup` (`rclone copy b2:… r2:…`) | Hver natt kl. 03:30 UTC |
| Innstillinger utenfor Git: rulesets, miljøer, Pages, Turnstile, GitHub-appene, DNS | GitHub, Cloudflare | For hånd fra sjekklisten i `SECURITY.md` og tabellen under [Kontoer og hemmeligheter](#kontoer-og-hemmeligheter) | Ingen (det er lite; sjekklisten er kopien) |
| Hemmeligheter og nøkler | Der tabellen sier; verdiene i klubbens passordhvelv | Byttes, gjenopprettes aldri: nye verdier der de ligger | — |

**Scenarioer, i rekkefølgen de tas.**

1. **Lageret er tapt** (en Durable Object-migrering som gikk galt, en hendelse hos Cloudflare, en nullstilling).
   Ingenting å gjøre. Minuttet etter leser lageret historikken inn igjen fra R2, kildene fyller resten innen en time,
   og `/v1/status.json` viser `backup.restored` med tidspunkt og rader.
2. **Arkivbøtta er tapt eller tømt.** Lag `hpgt-data-archive` på nytt (R2, privat), og så fra en hvilken som helst
   maskin med rclone og de to nøklene fra miljøet `backup`:
   `rclone copy b2:hpgt-flysteder-backup/archive r2:hpgt-data-archive`. Deretter skjer scenario 1 av seg selv. Kopien
   tar omtrent en halvtime.
3. **Cloudflare-kontoen er tapt** (eller bare arkivbøtta og lageret). I denne rekkefølgen, fra sjekklisten under
   [Kontoer og hemmeligheter](#kontoer-og-hemmeligheter) og klubbens passordhvelv:
   1. Ny konto på klubbens adresse, med totrinnsinnlogging. Slå på Workers og R2 (det kan bli bedt om et kort selv
      innenfor gratisgrensene), og lag bøtta `hpgt-data-archive` (privat).
   2. To tokener på den nye kontoen: det daglige publiseringstokenet fra Workeren (som under [Runbook](#runbook) «En
      hemmelighet eller et token kan ha lekket») i GitHub-miljøet `cloudflare`, og et gjenopprettingstoken (Manage
      Account → Account API Tokens → Create: Workers Scripts: Edit, Workers R2 Storage: Edit, Account Settings: Read,
      levetid på noen dager) i miljøet `recovery`, begge med konto-id-en. Slett gjenopprettingstokenet når «Recover»
      har kjørt. (Workeren finnes ikke ennå på en ny konto, så den første publiseringen her bruker
      gjenopprettingstokenet; Workerens eget token lages etterpå.)
   3. En ny Turnstile-widget for `flysteder.hpgt.com` (site key inn i `src/_data/site.js` gjennom en PR, hemmeligheten
      inn i Workeren under), og en ny privat nøkkel på GitHub-appen «HPGT Flying Sites Reports».
   4. Actions → «Recover» → «Run workflow» med `restore_archive` på, `lost_store` på og `base_url` satt til
      datatjenestens adresse på den nye kontoen. Den henter kopien fra B2, skriver arkivet tilbake til R2 (ett objekt
      om gangen gjennom API-et, minutter for måneder med filer), publiserer datatjenesten, venter til den kjører (høyst
      6 minutter), og sjekker at lageret leste historikken inn igjen med nøyaktig radene i kopien.
      `workers/data/wrangler.toml` har `workers_dev = false`, så Workeren får ingen `workers.dev`-adresse: legg til det
      egne domenet `data.hpgt.com` på Workeren (sonen `hpgt.com` må da ligge på den nye kontoen) mens kjøringen
      venter, og bruk det som `base_url`.
   5. Workerens hemmeligheter for hånd i Cloudflare → Workers & Pages → data → Settings → Variables and Secrets:
      `HOLFUY_KEY`, `FROST_CLIENT_ID`, `TURNSTILE_SECRET`, `REPORTS_APP_ID`, `REPORTS_APP_PRIVATE_KEY`. De holdes med
      vilje utenfor GitHub (SECURITY.md): en ekstra kopi der ville utvidet det en dårlig endring i en arbeidsflyt kunne
      nå, for et scenario der to av dem uansett må lages på nytt. Til de er satt, er stasjonene, «Meld fra» og METs
      stasjoner av; resten kjører.
   6. Siden på den nye kontoen: Workeren `flysteder` publiseres av «Build and deploy» med et nytt
      `CLOUDFLARE_SITE_TOKEN`, og domenet `flysteder.hpgt.com` legges til på den (se
      [Siden på Cloudflare](#siden-på-cloudflare)); til da kan siden serveres fra GitHub Pages. Får datatjenesten en
      annen adresse enn `data.hpgt.com`, må den inn i `src/_data/site.js` (`forecastUrl` og de andre) gjennom en PR, og
      helsesjekken og UptimeRobot pekes dit. En time arbeid pluss kopien.
4. **GitHub-repoet er tapt.** Push en hvilken som helst klone, eller bunten fra B2, til et nytt repo
   (`git clone flying-sites.bundle`, legg til remote, `git push --all`). Deretter innstillingene fra sjekklisten i
   `SECURITY.md`: Pages med domenet, miljøene `automation`, `cloudflare`, `recovery`, `backup` og `backup-read` med
   hemmeligheter og variabler, rulesettene, og installasjonen av de to GitHub-appene. Sakene ligger i
   `github/issues.json` til lesing; de importeres ikke tilbake. En halv dag, mest innstillinger.
5. **B2-kontoen er tapt.** Ingenting er nede. Ny konto og bøtte, ny nøkkel i miljøet `backup`, og neste natt kopierer
   alt på nytt fra R2.
6. **Domenet.** Se «Domenet svarer ikke» under [Runbook](#runbook). DNS for `hpgt.com` ligger utenfor dette repoet.
7. **Personen er utilgjengelig.** Se «Overlevering til et nytt styre» under [Runbook](#runbook). Dette er det ene
   scenarioet ingenting her automatiserer: det krever en eier til i GitHub-organisasjonen og på Cloudflare-kontoen, og
   at passordhvelvet er delt, før det trengs.

**Hva som overvåker det.** `backup.yml` feiler og åpner en sak når den nattlige kopien eller kontrollen av den feiler,
og lukker den når en natt går gjennom igjen. `health.yml` åpner en sak når lagerets egen sikkerhetskopi er mer enn to
døgn bak, eller når gjenopprettingen stadig feiler. UptimeRobot sender e-post når siden eller statusen slutter å svare.
Et stille repo får GitHubs tidsplaner slått av etter 60 dager uten commit (se [Runbook](#runbook)); UptimeRobot er ikke
avhengig av det.

**Den månedlige øvelsen** (`restore-drill.yml`, den 1. kl. 04:30 UTC og for hånd): scenario 1 og 2 bevist sammen uten å
røre produksjon. Datatjenestens egen kode kjører på runneren (`wrangler dev`, lokal workerd, med eget tomt lager og
lokal R2), den siste sikkerhetskopien av hver tabell hentes fra kopien i B2 og legges i den lokale R2-en, tidsplanen
utløses én gang, og lageret må lese hver rad inn igjen, sammenlignet med radene i filene (`scripts/restore-drill.mjs`,
`lib/restore-drill.js`). En øvelse som feiler, åpner saken «Gjenopprettingsøvelsen feilet»; Actions-historikken for
arbeidsflyten er loggen over øvelsene.

**Ikke dekket.** Det finnes ingen kopi av repoet hos en annen Git-tjeneste; en slik kopi ville gjort scenario 4 til en
push i stedet for en bunt. Det finnes ikke noe staging-miljø for Workeren (`[env.staging]` i `wrangler.toml`); det
trengs bare hvis migreringer av lageret må prøves mot ekte Cloudflare før `main`.

## Feilsøking

| Melding fra bygget | Løsning |
|---|---|
| `ukjent source «…»` | Bruk en av de faste verdiene, se [source](site-files.md#front-matter). |
| `ukjent nøkkel …` | Skrivefeil i front matter. Se tabellen i [site-files.md](site-files.md#front-matter). |
| `bildet … har feil navn` | Importer med `npm run images`, eller gi filen et navn etter mønsteret. |
| `gangruten … skal hete …` | Flere ruter skal hete `<id>-route-1.gpx`, `<id>-route-2.gpx`. |
| `status er «reviewed», men reviewed …` | Fyll inn `reviewed.by` og `reviewed.date`. |
| `index.en.md: ukjente nøkler …` | Skrivefeil i oversettelsen. Se [Oversettelse](site-files.md#oversettelse). |
| Vindvurderingen mangler på siden | Varselet er for gammelt, eller MET svarte ikke. Sjekk `https://data.hpgt.com/v1/forecast.json`, og kjør «Build and deploy» for hånd. |
| En sak «Datatjenesten: data mangler eller er for gamle» | Se [Helsesjekk for datatjenesten](#helsesjekk-for-datatjenesten). Den lukkes av seg selv når statusen er i orden igjen. |
| En sak «Jobben «…» feilet» | En kjøring feilet (jobben `alert` åpner den, eller kommenterer på den åpne). Åpne kjøringen fra lenken, rett årsaken, kjør arbeidsflyten igjen, og lukk saken. |
| «Data service» feiler med en autentiseringsfeil | Cloudflare-tokenet har utløpt eller er endret. Lag et nytt (se [Runbook](#runbook)) og oppdater `CLOUDFLARE_API_TOKEN` i miljøet `cloudflare`. |
| Luftromslaget sier «Kunne ikke hente luftrom» | `assets/airspace.geojson` mangler i bygget. Sjekk at `src/_data/cache/airspace/region.geojson` finnes. |

| Annen melding | Løsning |
|---|---|
| E-post fra Backblaze: «Daily Class B Transactions Cap reached» | Noe har lest mange enkeltfiler fra B2 samme dag (en gjenoppretting, eller flere kopieringer). Overføringer som trenger Class B, feiler til taket nullstilles kl. 00:00 UTC; den nattlige kopien kjører etter det. Øk taket under Caps & Alerts hvis en gjenoppretting pågår. |
