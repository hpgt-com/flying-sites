# Beslutningsnotater

De viktige valgene for flysteder.hpgt.com (Architecture Decision Records), med begrunnelsen, så den som kommer etter
vet *hvorfor* ting er som de er. Et nytt valg: kopier `template.md` til neste nummer og legg det i pull requesten som
gjør endringen. Et notat redigeres ikke i etterkant; det erstattes av et nytt, og det gamle får statusen
«Erstattet av NNNN».

| Nr. | Beslutning | Status |
|---|---|---|
| [0001](0001-static-site-eleventy-github-pages.md) | Statisk side med Eleventy på GitHub Pages | Erstattet av 0006 (hosting) |
| [0002](0002-data-service-cloudflare.md) | Datatjeneste på Cloudflare Workers med Durable Objects og R2 | Vedtatt |
| [0003](0003-slow-data-cached-by-pr.md) | Eksterne data som endres sjelden, mellomlagres i repoet og oppdateres med PR | Vedtatt |
| [0004](0004-offsite-backup-restore-drill.md) | Sikkerhetskopi utenfor Cloudflare i Backblaze B2, med månedlig gjenopprettingsøvelse | Vedtatt |
| [0005](0005-scoped-tokens-recovery-environment.md) | Avgrensede tokens eid av klubben, og et eget miljø for gjenoppretting | Vedtatt |
| [0006](0006-site-served-by-cloudflare.md) | Siden serveres av Cloudflare, med GitHub Pages som reserve | Vedtatt |
