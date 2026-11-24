// Svarene på /v1/<dataset>.json og /v1/status.json holdes i Cloudflares hurtigbuffer i CACHE_SECONDS sekunder, slik
// live.js gjør for /v1/live.json. Da vekker ikke en sidevisning lageret (store.js). Uten bufferen ga hver visning ett
// eller to kall til Durable Object-et, som gratisplanen teller per døgn. Nøkkelen er bare stien, så en spørrestreng kan
// ikke komme forbi bufferen til lageret. En ekstra kopi av hvert svar holdes i STALE_SECONDS sekunder som reserve. Når
// lageret svikter (nede, eller tom for dagskvoten), sendes reserven med x-stale: 1 og uten hurtigbuffer. Da beholder
// sidene dataene sine i stedet for å miste dem et minutt etter at lageret gikk ned. Hvert datasett har sin egen tid, og
// sidene vurderer alderen selv. Testet i test/data-quota.test.js og test/data-store.test.js.

export const CACHE_SECONDS = 60;
export const STALE_SECONDS = 12 * 3600;

// Buffernøkkelen for en forespørsel: stien på tjenestens egen adresse, uten spørrestrengen.
export function cacheKey(request) {
  const url = new URL(request.url);
  return new Request(`${url.origin}${url.pathname}`);
}

// Nøkkelen til reserven, ut fra nøkkelen til en forespørsel.
const staleKey = (key) => new Request(`${key.url}?stale`);

// En kopi av et svar med disse hodene satt.
function withHeaders(res, headers) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

// Svaret fra bufferen når det finnes der, ellers fra make(). Det lagres når det er vellykket (også som reserve). Når
// make() kaster en feil, sendes reserven hvis den finnes. Ellers går feilen videre. ctx: Workerens kontekst, så
// lagringen skjer etter at svaret er sendt.
export async function cached(cache, request, ctx, make) {
  const key = cacheKey(request);
  const hit = cache && (await cache.match(key));
  if (hit) return hit;
  let res;
  try {
    res = await make();
  } catch (err) {
    const stale = cache && (await cache.match(staleKey(key)));
    if (!stale) throw err;
    console.warn(`cache: ${key.url} fra reserven: ${err.message}`);
    return withHeaders(stale, { "cache-control": "no-store", "x-stale": "1" });
  }
  if (cache && res.ok) {
    const put = Promise.all([
      cache.put(key, res.clone()),
      cache.put(staleKey(key), withHeaders(res.clone(), { "cache-control": `public, max-age=${STALE_SECONDS}` })),
    ]);
    if (ctx?.waitUntil) ctx.waitUntil(put);
    else await put;
  }
  return res;
}
