# 0002: Datatjeneste på Cloudflare Workers med Durable Objects og R2

- **Status:** Vedtatt
- **Dato:** 2026-10

## Bakgrunn
Vindvarsel, værstasjoner, flyturer og piloter i lufta endrer seg fra minutt til minutt. Å bygge siden så ofte går
ikke, og nettleseren bør ikke kalle hver kilde direkte (nøkler, bruksgrenser, CORS, lisenser).

## Beslutning
Én Worker, `data` (`workers/data`), med én modul per kilde. Den kjører etter en tidsplan, lagrer dataene i et Durable
Object (SQLite) og serverer hvert datasett som `/v1/<dataset>.json`. Målinger arkiveres som CSV i R2
(`hpgt-data-archive`), og historikken sikkerhetskopieres dit hver natt.

## Konsekvenser
- Sidene forblir statiske; bare datatjenesten trenger hemmeligheter, og de ligger i Cloudflare.
- En helsesjekk (`health.yml`) og UptimeRobot overvåker den utenfra.
- Et tapt lager, en tapt bøtte eller en tapt konto må kunne gjenopprettes: se [0004](0004-offsite-backup-restore-drill.md).

## Alternativer som ble vurdert
Henting bare i bygget (for gammelt i løpet av timer), og en VPS med database (en server å patche og betale for).
