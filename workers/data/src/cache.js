// The answers to /v1/<dataset>.json and /v1/status.json kept in Cloudflare's cache for CACHE_SECONDS, as live.js does
// for /v1/live.json, so a page view does not wake the store (store.js): without it every view was one or two calls to
// the Durable Object, which the free plan counts per day. The key is the path alone, so a query string cannot get past
// the cache to the store. A second copy of each answer is kept STALE_SECONDS as a reserve: when the store fails (down,
// out of its daily quota), the reserve is served with x-stale: 1 and no caching, so the pages keep their data (each
// dataset carries its own time, and the pages judge its age themselves) instead of losing it a minute after the store
// went down. Tested in test/data-quota.test.js and test/data-store.test.js.

export const CACHE_SECONDS = 60;
export const STALE_SECONDS = 12 * 3600;

// The cache key for a request: the path on the service's own address, without the query string.
export function cacheKey(request) {
  const url = new URL(request.url);
  return new Request(`${url.origin}${url.pathname}`);
}

// The reserve's key for a request's key.
const staleKey = (key) => new Request(`${key.url}?stale`);

// A copy of a response with these headers set.
function withHeaders(res, headers) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

// The answer from the cache when it is there, otherwise from make(), which is stored when it is a success (and as the
// reserve). When make() throws, the reserve is served if there is one; otherwise the error goes on. ctx: the Worker's
// context, so storing happens after the answer is sent.
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
