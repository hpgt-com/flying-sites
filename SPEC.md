# HPGT flysteder – spesifikasjon

Ny versjon av flysteder.hpgt.com. Erstatter den gamle iframe-baserte flystedsoversikten til Lars Sletten, som han har gitt til klubben. Målgruppe: ferske PP2-piloter og tilreisende piloter. Kun norsk i første omgang.

## Teknisk oppsett
- Statisk side bygget med **Eleventy (11ty)**. Ingen server, ingen database.
- Publiseres på **GitHub Pages** via GitHub Actions ved push til `main`. Eget domene `flysteder.hpgt.com` settes i Pages-innstillingene (CNAME).
- `actions/checkout` med `fetch-depth: 0`, så «sist endret» per sted kan hentes fra Git.
- Kart: **Leaflet**, installert via npm og servert fra egen side. Standard bakgrunn: Kartverkets åpne topografiske kart. Alternativt lag: OpenTopoMap. Kreditering av kartkilder.
- PR-sjekken (`sjekk.yml`) kjører testene (`npm test`) og bygger siden. Bygget skal feile hvis en stedsfil er ugyldig (manglende `name`, ugyldig retningskode, ukjent nøkkel, bilde som ikke finnes).
- Automatiske importer (Kartverket-høyder, luftrom fra openAIP) skriver aldri i stedsfilene, bare i `src/_data/cache/`.
- Luftrom hentes fra openAIP (CC BY-NC 4.0) med `npm run airspace`, i ett kall for hele regionen (openAIP har streng fartsgrense), og lagres per start og som `region.geojson` til kartlaget. Hentes og av workflowen «Oppdater luftrom» den 1. hver måned. Endringer kommer som PR og gjennomgås før merge. Nøkkelen ligger som repository secret `OPENAIP_API_KEY`. Stedsfilens `airspace` brukes bare til steder som ikke er hentet ennå, og til merknader (`note`).

## Innhold
- Én mappe per sted: `src/flysteder/<id>/index.md` med front matter + tekst, og bilder/GPX i samme mappe.
- Faste filnavn med stedets id foran, som bygget håndhever: bilder heter `<id>-overview`, `<id>-launch`, `<id>-landing` og `<id>-air` (`.jpg`, `.png` eller `.webp`), gangruter heter `<id>-route.gpx`, eller `<id>-route-1.gpx`, `<id>-route-2.gpx` osv. når stedet har flere ruter. Filer fra Strava eller kamera må døpes om før de legges inn. Bilder importeres med `npm run images -- <id> <felt> <fil>`, som gir riktig navn, skalerer ned til maks 2560 px og fjerner metadata (EXIF/GPS). Originaler over 2 MB stopper bygget. Siden viser bare versjoner laget ved bygging (WebP/JPEG i flere størrelser), aldri originalene.
- Front matter følger strukturen i eksisterende filer (se `src/flysteder/elgen/index.md` for et komplett eksempel). Nøklene er på engelsk, verdiene på norsk. `parking` er en liste (steder kan ha flere ruter med hver sin parkering). Hver linje under `launches` kan ha `categories` (PG/SPG).
- Retninger lagres som standardkoder (N, NE, E, SE, S, SW, W, NW) og vises som norske (N, NØ, Ø, SØ, S, SV, V, NV).
- `status: utkast` betyr at stedet vises, men merkes «Ikke gjennomgått ennå». Når stedet er kontrollert, settes `status: gjennomgått` sammen med `reviewed.by` (navn) og `reviewed.date` (`'2026-09-24'`). Bygget feiler hvis status og `reviewed` ikke stemmer overens.
- Tomme felt (`null`) vises som tydelige plassholdere eller utelates, aldri som gjettede verdier.
- Statussiden `/status/` viser hvilke steder som er gjennomgått, og hva som mangler per sted (nivå, landing, parkering, gangrute, høyder, bilder, luftrom, yr_id, flightlog_id). Den lages automatisk ved hver bygging, lenkes ikke fra menyen og er merket `noindex`. Den erstatter `MANGLER.csv`.
- `external.pgearth_id` settes manuelt, bare når stedet faktisk finnes på Paraglidingearth. Ingen import derfra: API-et er bare for lesing, bare 5 av 30 steder finnes der, dataene deres avviker fra våre, og innholdet er lisensiert med «del på samme vilkår» (CC BY-SA 3.0 / ODbL). Bidrag til Paraglidingearth gjøres manuelt på nettsiden deres, og bare med innhold klubben har rett til å dele.

## Forside
- Tittel «Hvor står vinden i dag?». Menyknapp (tre streker) oppe til høyre på alle sider med fargemodus (Auto/Lys/Mørk), bryter for fargeblindvennlige farger og lenkene «Alle flysteder» og «Til hpgt.com».
- Filtre som virker sammen: **vindretning** (kompass 3×3 med «Alle» i midten), **nivå** (Alle, PP2–PP5, viser valgt nivå og lavere), **kategori** (Alle, PG, SPG, PPG). Steder uten registrert nivå skjules ikke av nivåfilteret: de vises nederst i listen under «Nivå ikke satt», litt nedtonet i kartet, og telles for seg («3 flysteder passer filtrene, 25 uten nivå»).
- Kart med alle starter som små vindroser (hvite skiller, mørk kant, stedsnavn under rosene når man zoomer nært inn). Starter som ligger oppå hverandre når man zoomer ut, slås sammen til en klynge med antall steder som passer filteret (Leaflet.markercluster); klikk zoomer inn. Med vind på har klyngen ringfargen til den beste vurderingen i den. Luftromslag som i IPPC kan slås av og på i kartets lagvelger: TMA, CTR, militære områder, fare og restriksjon. Av som standard, lastes først når de slås på, klikk viser navn, klasse og grenser. Kreditering «Luftrom: openAIP … Ikke for navigasjon, sjekk IPPC». Termikklag (også på stedssidene): «Termikk: skyways» og «Termikk: hotspots» fra thermal.kk7.ch (CC BY-NC-SA 4.0, statistikk fra loggede flyturer, ikke varsel), av som standard. Ingen værradar, den sjekkes i Yr/Windy. Steder som ikke passer filteret tones ned. Klikk på en start viser et kort med rose, tagger, kort tekst, «Se hele stedet» og «Se på Flightlog».
- Forklaring til rosefargene (hovedretning, mulig, ikke egnet). Mobil: under kartet. Desktop: under kortet for valgt sted.
- **Vindvurdering** (filtergruppe «Vind fra varsel»: Av, Nå, Om 3 t, Om 6 t, I morgen kl. 12). Varsel fra MET Locationforecast for hver start (`src/_data/forecast.js`, 48 timer, hentes ved hver bygging, siden bygges hver time). Logikken ligger i `src/assets/js/wind.js` og testes i `test/wind.test.js`. Regler i `src/_data/windRules.json`:
  - «For mye vind»: middelvind over `maxWind` (7 m/s), eller over stedets egen grense `wind_limits.max_wind` når den er satt, eller kast over `maxGust` (10 m/s).
  - «Passer ikke»: retningen er verken hovedretning eller mulig.
  - «Usikkert»: mulig retning, middelvind under `minWind` (2 m/s, retningen er da usikker), varselet mangler kast, kast mer enn `maxGustSpread` (4 m/s) over middelvinden, eller hovedretning der vinden ligger innenfor `sectorMargin` (10°) fra en retning som ikke er hovedretning.
  - «Kan passe»: ellers. Det som mangler eller er usikkert, gjør aldri vurderingen bedre.
  - Kortet viser vind, klokkeslett, vurdering og årsaken. Under vindvalget står hvilket klokkeslett som vises og når varselet ble hentet. Klokkeslett og «I morgen kl. 12» er alltid norsk tid.
  - Er varselet hentet for mer enn `maxForecastAgeHours` (3 t) siden, skjules vindvalget, og siden sier at varselet er for gammelt. Dekker varselet ikke valgt tidspunkt, vises ingen vurdering.
  - Varselet hentes per sted. Feiler ett sted, står det «Ingen vindvarsel for stedet» der, og resten får vurdering. Feiler alle, vises ikke vindvalget.
  - Kartet viser farget ring og en vindpil som står på siden vinden kommer fra og peker inn mot starten, listen sorteres etter vurdering. Bare et forslag, aldri «OK å fly».
- Liste over steder som passer filteret.
- «Før du drar»: NOTAM og luftrom (https://ippc.no), Tårn (egen side `/luftrom/` med telefonnumre til tårnene, fra `src/_data/towers.json`, tårn uten nummer vises ikke), Flybart (https://flybart.net/), XCC flymet (http://xcc.no/xccflymet.html). Én linje om NLF sin tommelfingerregel på 5–6 m/s.
- Nederst: ansvarsfraskrivelse og kreditering av Lars Sletten. Krediteringen står bare her, ikke på hver stedsside.
- Desktop: tre kolonner (filtre og liste | kart | valgt sted, forklaring, «Før du drar»).

## Stedsside – fast mal i denne rekkefølgen
1. Navn, én–to setninger kort fortalt, tagger (kategori og sesong).
2. Oversiktsbilde (Lars sine tegnede 3D-bilder der de finnes, trykk for full størrelse). Plassholder hvis det mangler. Har stedet tegning til 3D-visningen, kommer en knapp «Se stedet i 3D (prøveversjon)» under. I bildevisningen kan man zoome med knip, dobbelttrykk/dobbeltklikk og musehjul, og dra for å flytte; sveip bytter bilde når bildet ikke er zoomet.
3. **Før du starter**: bare farer som gjelder hele stedet. Rød boks. Hvis ingen: «Ingen spesielle farer registrert for stedet.»
4. **Fakta**: vindrose med forklaring, og rader for Nivå (tagger), Kategori (tagger), Maks vind (bare når `wind_limits.max_wind` er satt), Høyde (start moh, landing moh, forskjell), Luftrom: bare taket over start, det laveste faste luftrommet over startstedet, som tagger (navn, klasse, nedre grense i ft, ca. moh regnet om fra fot), og under: dato for siste henting, og «Sjekk alltid IPPC før du flyr.» på egen linje. Bare luftrom ved takeoff vises. Nærliggende luftrom (TMA, CTR osv.) vises ikke, piloter sjekker dem i IPPC. Nærliggende og militære områder hentes, men vises ikke.
5. **Start**: Parkering, Veien opp (med km og høydemeter fra GPX), Tid (bevegelsestid fra GPX). Deretter kort tekst om startområdet og én linje per retningsgruppe med retningsmerker i rosens farger og eventuelle kategori-tagger (PG/SPG).
6. **Landing**: kort tekst.
7. **Vær**: Yr-meteogram (`https://www.yr.no/nb/innhold/<yr_id>/meteogram.svg`, med `?mode=dark` i mørk modus, kreditering «Varsel fra Yr, levert av NRK og Meteorologisk institutt»), lenker til Yr, Windy (pin på startkoordinat: `https://www.windy.com/<lat>/<lon>?<lat>,<lon>,12`), Flybart, XCC flymet, IPPC.
8. **Kart**: start som vindrose med oransje ring (som på forsiden), landing som mørk målskive, alternativ landing som grå målskive, parkering (blå P). Starter med egen posisjon (`launches[].lat`/`lon`, valgfritt, maks 5 km fra `launch`) får hver sin rose med sine retninger; hovedstarten viser da retningene til startene uten egen posisjon, og tegnes ikke hvis alle har egen posisjon. Uten slike posisjoner viser hovedstarten alle retningene. Én rose er standard: retninger som startes fra samme sted, hører til samme start, også når den dekker mange retninger. Egen posisjon er bare for starter som ligger et annet sted (Sollifjellet: toppen, alpinsenteret, alpinbakken og baksiden). Starter som ligger så tett at rosene ville overlappet, slås sammen til én rose med alle retningene og antallet starter (Leaflet.markercluster); de deles opp når man zoomer inn eller trykker på rosen, gangruter fra GPX (stiplet linje). Knapper: Veibeskrivelse til parkering (Google Maps), Last ned gangrute (GPX).
   - **Høydeprofil** under kartet når stedet har gangrute: avstand/høyde, partier brattere enn 25 % markert i aksentfarge, glidebryter (og dra/touch i profilen) som flytter en markør langs ruten i kartet og viser avstand, høyde og stigning. Faner når stedet har flere ruter. Kort oppsummering under (km, fra–til moh, hvor mye som er brattere enn 25 %). Høyder bør hentes fra Kartverket, med GPS-høyde som reserve.
   - Tid under Start er bevegelsestid fra GPX (uten pauser), rundet til 5 min.
9. **Bilder**: faste plasser for Start, Landing, Fra luften. Tom plass viser «Mangler bilde. Har du et herfra? Send det inn.»
10. **Logg og mer**: Flightlog (`https://flightlog.org/fl.html?l=1&a=22&country_id=160&start_id=<id>`), Paraglidingearth (`https://www.paraglidingearth.com/?site=<pgearth_id>`, bare når `pgearth_id` er satt, ellers utelatt).
11. Bunn: «Foreslå endring» (lenke til skjema), Sist endret (dato og navn fra Git), Gjennomgått (manuelt felt, rødt «Ikke gjennomgått ennå» hvis tomt), Kilder (én linje, skilt med «|»), ansvarsfraskrivelse.
- Desktop: to kolonner. Venstre: tittel, oversikt, start, landing, kart, bilder. Høyre: Før du starter, Fakta, Vær, Logg og mer.

## 3D-visning (prøveversjon)
- Mål: det samme som Lars sine tegnede oversiktsbilder (hvilken side av fjellet som passer for hvilken retning, startkant, flyvei, farer, tekster), men tegnet av siden selv, så det kan dreies og zoomes og vedlikeholdes som data i stedet for som bilde.
- Side `/flysteder/<id>/3d/` for steder med `src/flysteder/<id>/<id>-drawing.geojson` (`src/3d.njk`, `src/assets/js/site3d.js`). `noindex` og ikke i sitemap mens det er prøveversjon. Lenket fra oversiktsbildet på stedssiden.
- Ytelse: oppløsningen er begrenset til 2× på skjermer med høyere pikseltetthet, og den løftede buen regner målestokken i tre punkter per bue og tegnes høyst én gang per bilde.
- Kart: MapLibre GL med terreng fra Terrain Tiles (AWS Open Data, terrarium, uten nøkkel; i Norge bygger de på Kartverkets høydedata, kontrollert mot kjente høyder: Sollifjellet 563/567 moh, Elgen 498/506 moh), skyggelegging og Kartverkets topokart oppå. Tegningen vises selv om kartflisene ikke svarer.
- **Retningsbuen** regnes ut fra `wind_directions`: gule buer med én bit per retning, en pil ut og retningen ved spissen. Mørk gul er hovedretning, lys gul mulig. Har startene egne posisjoner (`launches[].lat`/`lon`), får hver retningsgruppe (starter med samme retninger) sin egen bue der startene ligger: midt mellom dem, med radius til lengste start + 110 m, så buen strekker seg langs siden mellom dem (Sollifjellet: Ø–S fra toppen mot masta, N–NØ på siden av alpinbakken, NV på ryggen). Uten egne posisjoner er det én bue rundt hovedstarten (250 m), eller rundt `direction_arc` i tegningen.
- **UTKAST:** to visninger av buen, valgt med knapper over kartet, så klubben kan prøve begge og velge én: «Løftet over bakken» (standard; tegnes i et SVG-lag 30 m over terrenget med skygge på bakken, like tykk på skjermen og synlig fra alle vinkler) og «På bakken» (ligger på terrenget og skjules bak topper). `#linje=bakke` i adressen åpner på bakken.
- Ellers fra stedsfilen: starter (oransje prikk, trykk for tekstene fra `launches`), landing (målskive), parkering og gangrute. Ingen piler per start.
- **Tekstene** (`label` i tegningen) vises som nummererte punkter i kartet og med tittel og tekst i en nummerert liste under kartet (med `style: hazard` en lys firkant med rød kant, som «Før du starter», så den ikke forveksles med de oransje startene). Punktene står litt over stedet, så de ikke dekker en start. Trykk på et nummer viser teksten og markerer den i listen; trykk i listen flytter kartet dit. Ikke tekstbokser i kartet, siden de overlapper når kartet dreies.
- Tegningen (`lib/drawing.js`, valideres ved bygging): GeoJSON FeatureCollection med `camera` (center, zoom, pitch, bearing), valgfri `direction_arc` (center, radius) og objekter med `kind`: `label` (punkt med title og text), `path` (linje, style launch/flight/hazard/info, dashed, arrow) og `area` (polygon, style hazard/launch/landing/info). Kan tegnes i geojson.io. Med `?rediger` i adressen viser siden koordinatene der man klikker og utsnittet som `camera`.
- Bare innhold klubben har bekreftet legges i tegningen. Sollifjellet har i dag tre punkter med tekst fra stedsfilen (toppen, trakteffekten ved masta, landingen).

## Deling og søk
- Alle sider har Open Graph-tagger (tittel, beskrivelse, bilde, adresse), så lenker får forhåndsvisning på Facebook og Messenger. Stedssider bruker oversiktsbildet og innledningen, andre sider `src/assets/img/share.jpg` (1200×630, skjermbilde av forsiden).
- `/404.html`: «Fant ikke siden», lenke til forsiden og liste over alle stedene. Ingen lenke til den gamle oversikten.
- `/sitemap.xml` med alle sider uten `noindex` (stedssider med dato fra Git), og `/robots.txt` som peker på den.

## Design
- Farger: bakgrunn #F3F5F4, tekst #1C2B33, dempet tekst #45545C, linjer #C3D0CF, fjord #2E5E6E, aksent #C24A12 (valgt sted, knapper, bratt i høydeprofil), hovedretning petrol #3D7A8A, mulig lys petrol #8FBCC7 (én farge i tre lysheter, så rosen ikke kan forveksles med vindvurderingens trafikklys), vindvurdering grønn #2E8B57 / gul #D99A1E / rød #C62828 (med fargeblindvennlige farger valgt i menyen: blå #0072B2 / gul #E69F00 / oransjerød #D55E00 / grå, Okabe–Ito; valget lagres i nettleseren som fargemodusen) / grå #7F9396 med tynn mørk kant, og «For mye vind» og «Passer ikke» litt mindre i kartet så vurderingen ikke bare vises med farge, farer-boks #FBE3DA med tekst #6B1A0B, parkering #2F6FB5.
- Skrift: Barlow (brødtekst) og Barlow Condensed (overskrifter) fra Google Fonts.
- Mobil først, lesbart ute i sollys, knapper minst 44 px høye. Mørk modus: valg i menyen oppe til høyre på alle sider med Auto, Lys og Mørk. Auto (standard) følger innstillingen på enheten (`prefers-color-scheme`), valget lagres i nettleseren (localStorage). Skriptet i `<head>` setter `data-theme` før siden tegnes; egne fargeverdier under `:root[data-theme="dark"]`, mørkt kart ved at bakgrunnskartet inverteres med CSS-filter (luftrom, termikk og symboler beholder fargene), popuper og lagvelger forblir lyse.
- Designreferanse: `referanse/prototype/` (prototype-HTML fra designfasen, ikke kjørbar som den er). `referanse/` ligger bare lokalt og er ikke med i repoet (se `.gitignore`), fordi uttrekket fra den gamle oversikten inneholder originaltekster.

## Senere (fase 2)
- Minste vind per sted, vindvurdering også på stedssiden. (Maks vind per sted finnes: `wind_limits.max_wind`, vises under Fakta.)
- Engelsk versjon, video fra YouTube, 3D-visning med tegnede lag (GeoJSON).

## Fase 3: NOTAM
- IPPC er eneste autoritative kilde. Venter til vi har en sikker og tillatt måte å hente fra IPPC på.
- Visning som i IPPC: NOTAM-områder som polygoner eller sirkler på kartene, fargede markører per type (militært operasjonsområde, ubemannede luftfartøy, hindringer, advarsler) med forklaring, gyldighet i norsk tid, og lenke til IPPC.
- Kobles til flystedene: stedssiden og forsidekortet viser aktive og kommende NOTAM som berører start eller landing.
