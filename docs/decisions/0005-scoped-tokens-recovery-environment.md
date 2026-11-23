# 0005: Avgrensede tokens eid av klubben, og et eget miljø for gjenoppretting

- **Status:** Vedtatt
- **Dato:** 2026-11-18

## Bakgrunn
Publisering av datatjenesten brukte et personlig Cloudflare-brukertoken med Workers- og R2-rettigheter på hele
kontoen, og sikkerhetskopien brukte et personlig R2-token. Begge var avhengige av én person og ga mer tilgang enn
hver jobb trengte.

## Beslutning
- `cloudflare`: et kontotoken laget fra Workeren (Settings → Builds → «API token for external CI/CD») som bare kan
  publisere Workeren `data`.
- `backup`: et R2-kontotoken, bare Object Read, bare `hpgt-data-archive`.
- `recovery`: et eget miljø (bare `main`, påkrevd godkjenner) for `recover.yml`, som også skriver til R2. Tokenet
  lages bare når en gjenoppretting trengs, og slettes etterpå.
- Tilgang til GitHub går gjennom GitHub-appene «HPGT Flying Sites» og «HPGT Flying Sites Reports», som eies av
  organisasjonen, aldri gjennom personlige tokens.

## Konsekvenser
- Et lekket token kan bare gjøre én ting, og ingenting slutter å virke når noen går ut av styret.
- Tokenet for den daglige publiseringen må fornyes hvert år. En gjenoppretting krever ett ekstra steg: å lage
  tokenet.

## Alternativer som ble vurdert
Ett bredt token for alt (enklere, men en lekkasje ville nådd alle Workers og arkivet).
