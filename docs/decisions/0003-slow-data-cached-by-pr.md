# 0003: Eksterne data som endres sjelden, mellomlagres i repoet og oppdateres med PR

- **Status:** Vedtatt
- **Dato:** 2026-10

## Bakgrunn
Luftrom, kraftlinjer, hindre og høyder endres sjelden, er trege å hente eller har bruksgrenser, og en feil endring
(et luftromsgulv, en kraftlinje som mangler) er en sikkerhetssak.

## Beslutning
Slike data hentes av månedlige arbeidsflyter (`airspace.yml`, `obstacles.yml`) eller i bygget for nye GPX-filer, og
committes til `src/_data/cache/`. Endringer kommer som pull requests fra GitHub-appen «HPGT Flying Sites», så en
person ser diffen før den publiseres.

## Konsekvenser
- Byggene er raske og avhenger ikke av at openAIP, NVE eller Overpass er oppe.
- Sikkerhetsrelevante endringer gjennomgås, og historikken viser når noe endret seg.
- Dataene kan være opptil en måned gamle. IPPC er den autoritative kilden for luftrom.

## Alternativer som ble vurdert
Henting ved hvert bygg (tregt, sårbart, ikke gjennomgått), og henting i nettleseren (nøkler og bruksgrenser
eksponert).
