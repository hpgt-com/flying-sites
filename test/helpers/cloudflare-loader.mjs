// Lets the tests import the data service (workers/data/src) in Node: «cloudflare:workers» becomes a small stand-in for
// DurableObject, and sites.json (written before each deploy, not in Git) is made from the site files. Registered with
// module.register by test/data-quota.test.js.

const STUB = "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }";

export async function resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript," + encodeURIComponent(STUB), shortCircuit: true };
  if (specifier.endsWith("sites.json") && context.parentURL) {
    const url = new URL(specifier, context.parentURL);
    if (url.pathname.endsWith("/workers/data/src/sites.json")) return { url: url.href + "?sites", shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith("/workers/data/src/sites.json?sites")) {
    const { readSites } = await import(new URL("../../lib/site-files.js", import.meta.url).href);
    const sites = readSites().map(({ id, data }) => ({ id, name: data.name, lat: data.launch.lat, lon: data.launch.lon, altitude: data.elevation?.launch_masl ?? null }));
    return { format: "module", source: `export default ${JSON.stringify(sites)};`, shortCircuit: true };
  }
  return next(url, context);
}
