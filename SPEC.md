# HPGT flysteder – spesifikasjon

Ny versjon av flysteder.hpgt.com. Erstatter den gamle iframe-baserte flystedsoversikten til Lars Sletten, som han har gitt til klubben. Målgruppe: ferske PP2-piloter og tilreisende piloter. Kun norsk i første omgang.

## Teknisk oppsett
- Statisk side bygget med **Eleventy (11ty)**. Ingen server, ingen database.
- Publiseres på **GitHub Pages** via GitHub Actions ved push til `main`. Eget domene `flysteder.hpgt.com` settes i Pages-innstillingene (CNAME).
- `actions/checkout` med `fetch-depth: 0`, så «sist endret» per sted kan hentes fra Git.
- Kart: **Leaflet**, installert via npm og servert fra egen side. Standard bakgrunn: Kartverkets åpne topografiske kart. Alternativt lag: OpenTopoMap. Kreditering av kartkilder.
- Ingen validering av PR-er. Bygget skal feile hvis en stedsfil er ugyldig (manglende `name`, ugyldig retningskode, ukjent nøkkel, bilde som ikke finnes).
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
- Tittel «Hvor står vinden i dag?», lenke «Til hpgt.com».
- Filtre som virker sammen: **vindretning** (kompass 3×3 med «Alle» i midten), **nivå** (Alle, PP2–PP5), **kategori** (Alle, PG, SPG, PPG).
- Kart med alle starter som små vindroser. Luftromslag som i IPPC kan slås av og på i kartets lagvelger: TMA, CTR, militære områder, fare og restriksjon. Av som standard, lastes først når de slås på, klikk viser navn, klasse og grenser. Kreditering «Luftrom: openAIP … Ikke for navigasjon, sjekk IPPC». Steder som ikke passer filteret tones ned. Klikk på en start viser et kort med rose, tagger, kort tekst, «Se hele stedet» og «Se på Flightlog».
- Forklaring til rosefargene (hovedretning, mulig, ikke egnet). Mobil: under kartet. Desktop: under kortet for valgt sted.
- **Vindvurdering** (filtergruppe «Vind fra varsel»: Av, Nå, Om 3 t, Om 6 t, I morgen kl. 12). Varsel fra MET Locationforecast for hver start (`src/_data/forecast.js`, 48 timer, hentes ved hver bygging, siden bygges hver time). Regler i `src/_data/windRules.json`: over `maxWind` (7 m/s) gir «For mye vind»; vindretning i hovedretning gir «Kan passe», men «Usikkert» når kastene er mer enn `maxGustSpread` (4 m/s) over middelvinden; mulig retning gir «Usikkert»; ellers «Passer ikke». Kartet viser farget ring og en vindpil som står på siden vinden kommer fra og peker inn mot starten, listen sorteres etter vurdering, kortet viser vind og vurdering. Bare et forslag, aldri «OK å fly». Uten varsel (henting feilet) vises ikke vindvalget.
- Liste over steder som passer filteret.
- «Før du drar»: NOTAM og luftrom (https://ippc.no), Tårn (egen side `/luftrom/` med telefonnumre til tårnene, fra `src/_data/towers.json`, tårn uten nummer vises ikke), Flybart (https://flybart.net/), XCC flymet (http://xcc.no/xccflymet.html). Én linje om NLF sin tommelfingerregel på 5–6 m/s.
- Nederst: ansvarsfraskrivelse og kreditering av Lars Sletten. Krediteringen står bare her, ikke på hver stedsside.
- Desktop: tre kolonner (filtre og liste | kart | valgt sted, forklaring, «Før du drar»).

## Stedsside – fast mal i denne rekkefølgen
1. Navn, én–to setninger kort fortalt, tagger (kategori og sesong).
2. Oversiktsbilde (Lars sine tegnede 3D-bilder der de finnes, trykk for full størrelse). Plassholder hvis det mangler.
3. **Før du starter**: bare farer som gjelder hele stedet. Rød boks. Hvis ingen: «Ingen spesielle farer registrert for stedet.»
4. **Fakta**: vindrose med forklaring, og rader for Nivå (tagger), Kategori (tagger), Høyde (start moh, landing moh, forskjell), Luftrom: bare taket over start, det laveste faste luftrommet over startstedet, som tagger (navn, klasse, nedre grense i ft, ca. moh regnet om fra fot), og under: dato for siste henting, og «Sjekk alltid IPPC før du flyr.» på egen linje. Bare luftrom ved takeoff vises. Nærliggende luftrom (TMA, CTR osv.) vises ikke, piloter sjekker dem i IPPC. Nærliggende og militære områder hentes, men vises ikke.
5. **Start**: Parkering, Veien opp (med km og høydemeter fra GPX), Tid (bevegelsestid fra GPX). Deretter kort tekst om startområdet og én linje per retningsgruppe med retningsmerker i rosens farger og eventuelle kategori-tagger (PG/SPG).
6. **Landing**: kort tekst.
7. **Vær**: Yr-meteogram (`https://www.yr.no/nb/innhold/<yr_id>/meteogram.svg`, kreditering «Varsel fra Yr, levert av NRK og Meteorologisk institutt»), lenker til Yr, Windy (pin på startkoordinat: `https://www.windy.com/<lat>/<lon>?<lat>,<lon>,12`), Flybart, XCC flymet, IPPC.
8. **Kart**: start (oransje sirkel), landing (firkant), alternativ landing (grå), parkering (blå P), gangruter fra GPX (stiplet linje). Knapper: Veibeskrivelse til parkering (Google Maps), Last ned gangrute (GPX).
   - **Høydeprofil** under kartet når stedet har gangrute: avstand/høyde, partier brattere enn 25 % markert i aksentfarge, glidebryter (og dra/touch i profilen) som flytter en markør langs ruten i kartet og viser avstand, høyde og stigning. Faner når stedet har flere ruter. Kort oppsummering under (km, fra–til moh, hvor mye som er brattere enn 25 %). Høyder bør hentes fra Kartverket, med GPS-høyde som reserve.
   - Tid under Start er bevegelsestid fra GPX (uten pauser), rundet til 5 min.
9. **Bilder**: faste plasser for Start, Landing, Fra luften. Tom plass viser «Mangler bilde. Har du et herfra? Send det inn.»
10. **Logg og mer**: Flightlog (`https://flightlog.org/fl.html?l=1&a=22&country_id=160&start_id=<id>`), Paraglidingearth (`https://www.paraglidingearth.com/?site=<pgearth_id>`, bare når `pgearth_id` er satt, ellers utelatt).
11. Bunn: «Foreslå endring» (lenke til skjema), Sist endret (dato og navn fra Git), Gjennomgått (manuelt felt, rødt «Ikke gjennomgått ennå» hvis tomt), Kilder (én linje, skilt med «|»), ansvarsfraskrivelse.
- Desktop: to kolonner. Venstre: tittel, oversikt, start, landing, kart, bilder. Høyre: Før du starter, Fakta, Vær, Logg og mer.

## Design
- Farger: bakgrunn #F3F5F4, tekst #1C2B33, dempet tekst #45545C, linjer #C3D0CF, fjord #2E5E6E, aksent (hovedretning) #C24A12, mulig #9DBAC2, farer-boks #FBE3DA med tekst #6B1A0B, parkering #2F6FB5.
- Skrift: Barlow (brødtekst) og Barlow Condensed (overskrifter) fra Google Fonts.
- Mobil først, lesbart ute i sollys, knapper minst 44 px høye, lys/mørk modus senere.
- Designreferanse: `referanse/prototype/` (prototype-HTML fra designfasen, ikke kjørbar som den er). `referanse/` ligger bare lokalt og er ikke med i repoet (se `.gitignore`), fordi uttrekket fra den gamle oversikten inneholder originaltekster.

## Senere (fase 2)
- Vindgrenser per sted (maks/min vind), vindvurdering også på stedssiden.
- Engelsk versjon, video fra YouTube, 3D-visning med tegnede lag (GeoJSON).

## Fase 3: NOTAM
- IPPC er eneste autoritative kilde. Venter til vi har en sikker og tillatt måte å hente fra IPPC på.
- Visning som i IPPC: NOTAM-områder som polygoner eller sirkler på kartene, fargede markører per type (militært operasjonsområde, ubemannede luftfartøy, hindringer, advarsler) med forklaring, gyldighet i norsk tid, og lenke til IPPC.
- Kobles til flystedene: stedssiden og forsidekortet viser aktive og kommende NOTAM som berører start eller landing.
