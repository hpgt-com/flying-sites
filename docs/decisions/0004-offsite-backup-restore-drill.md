# 0004: Sikkerhetskopi utenfor Cloudflare i Backblaze B2, med månedlig gjenopprettingsøvelse

- **Status:** Vedtatt
- **Dato:** 2026-10

## Bakgrunn
Værarkivet og flyhistorikken finnes bare i Cloudflare. En tapt konto, en slettet bøtte eller en feil publisering kan
miste flere års data, og en sikkerhetskopi som aldri er gjenopprettet, kan ikke stoles på.

## Beslutning
`backup.yml` kopierer hele R2-bøtta til en bøtte hos en annen leverandør (Backblaze B2) hver natt, uten å slette noe
der, og lagrer sakene og Git-historikken. `restore-drill.yml` viser hver måned, lokalt på runneren, at kopien kan
gjenopprettes. `recover.yml` gjør en virkelig gjenoppretting og startes for hånd.

## Konsekvenser
- Hver leverandør kan gå tapt alene uten at data går tapt (docs/operations.md «Katastrofegjenoppretting»).
- Nøklene er minimale: R2 med bare lesetilgang for kopien, B2-nøkkelen bare for én bøtte.
- En natt eller en øvelse som feiler, åpner en sak, som lukkes av seg selv når det virker igjen.

## Alternativer som ble vurdert
Å stole på Cloudflare alene, og en sikkerhetskopi uten øvelse.
