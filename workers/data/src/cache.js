// The answers to /v1/<dataset>.json and /v1/status.json kept in Cloudflare's cache for CACHE_SECONDS, as live.js does
// for /v1/live.json, so a page view does not wake the store (store.js): without it every view was one or two calls to
// the Durable Object, which the free plan counts per day. The key is the path alone, so a query string cannot get past
// the cache to the store. Tested in test/data-quota.test.js.

export const CACHE_SECONDS = 60;

// The cache key for a request: the path on the service's own address, without the query string.
export function cacheKey(request) {
  const url = new URL(request.url);
  return new Request(`${url.origin}${url.pathname}`);
}

// The answer from the cache when it is there, otherwise from make(), which is stored when it is a success. ctx: the
// Worker's context, so storing happens after the answer is sent.
export async function cached(cache, request, ctx, make) {
  const key = cacheKey(request);
  const hit = cache && (await cache.match(key));
  if (hit) return hit;
  const res = await make();
  if (cache && res.ok) {
    const put = cache.put(key, res.clone());
    if (ctx?.waitUntil) ctx.waitUntil(put);
    else await put;
  }
  return res;
}
