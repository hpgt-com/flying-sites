// CSP-brudd rapportert til datatjenesten (workers/data/src/csp-report.js, POST /v1/csp-report): metodene, begge typene
// rapport, størrelsesgrensen, frekvensgrensen, og at loggen ikke har personopplysninger. Kjør med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/cloudflare-loader.mjs", import.meta.url);
const worker = (await import("../workers/data/src/index.js")).default;
const csp = await import("../workers/data/src/csp-report.js");

const URL_ = "https://data.test/v1/csp-report";
const IP = "203.0.113.7";
const UA = "Mozilla/5.0 (X11; Linux x86_64) TestBrowser/1.0";

const legacy = {
  "csp-report": {
    "document-uri": "https://flysteder.hpgt.com/flysteder/heia/?q=hemmelig#x",
    referrer: "https://www.example.org/side?bruker=ola",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "original-policy": "default-src 'none'; report-uri https://data.hpgt.com/v1/csp-report",
    disposition: "enforce",
    "blocked-uri": "https://evil.example.com/x.js?token=abc",
    "status-code": 200,
    "script-sample": "",
  },
};

const reporting = [
  { type: "csp-violation", age: 10, url: "https://flysteder.hpgt.com/kart/?lat=68.8", user_agent: UA,
    body: { documentURL: "https://flysteder.hpgt.com/kart/?lat=68.8", referrer: "https://www.example.org/?q=ola", blockedURL: "trusted-types-sink",
      effectiveDirective: "require-trusted-types-for", originalPolicy: "require-trusted-types-for 'script'", disposition: "report",
      sample: "Element innerHTML|<img src=x onerror=alert('ola@example.org')>", statusCode: 200, lineNumber: 12, sourceFile: "https://flysteder.hpgt.com/assets/leaflet/leaflet.js" } },
  { type: "csp-violation", url: "https://flysteder.hpgt.com/", body: { documentURL: "https://flysteder.hpgt.com/", blockedURL: "inline", effectiveDirective: "style-src-attr", disposition: "enforce" } },
  { type: "csp-violation", url: "https://andre.example.net/side", body: { documentURL: "https://andre.example.net/side", blockedURL: "eval", effectiveDirective: "script-src", disposition: "enforce" } },
  { type: "deprecation", url: "https://flysteder.hpgt.com/", body: { id: "x", message: "noe" } },
];

const post = (body, type, headers = {}) => new Request(URL_, { method: "POST", headers: { "content-type": type, "cf-connecting-ip": IP, "user-agent": UA, ...headers }, body });

// Kjører Workeren med console.log fanget; gir svaret og linjene som ble logget.
async function run(request, env = {}) {
  const lines = [];
  const saved = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    return { res: await worker.fetch(request, env, { waitUntil() {} }), lines };
  } finally {
    console.log = saved;
  }
}

// Ingenting personlig i en logglinje: ingen adresse, nettleserinfo, referrer, spørrestreng, full adresse eller utdrag.
function assertClean(lines) {
  for (const l of lines) {
    for (const bad of [IP, "TestBrowser", "example.org", "ola", "?", "token", "lat=", "q=", "onerror", "<img", "x.js", "leaflet.js"]) assert.ok(!l.includes(bad), `«${bad}» i «${l}»`);
  }
}

test("csp-report: bare POST; andre metoder får 405", async () => {
  for (const method of ["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]) {
    const { res } = await run(new Request(URL_, { method }));
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "POST");
    assert.equal(res.headers.get("access-control-allow-origin"), null, "ingen CORS");
  }
});

test("csp-report: en gammel report-uri-rapport logges som én linje uten personopplysninger og besvares med 204", async () => {
  const { res, lines } = await run(post(JSON.stringify(legacy), "application/csp-report"));
  assert.equal(res.status, 204);
  assert.equal(await res.text(), "");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(lines, ["csp-report directive=script-src-elem disposition=enforce blocked=https://evil.example.com path=/flysteder/heia/"]);
  assertClean(lines);
});

test("csp-report: Reporting API-rapporter; Trusted Types beholder bare navnet på sinken, andre sider og typer droppes", async () => {
  const { res, lines } = await run(post(JSON.stringify(reporting), "application/reports+json"));
  assert.equal(res.status, 204);
  assert.deepEqual(lines, [
    'csp-report directive=require-trusted-types-for disposition=report blocked=trusted-types-sink path=/kart/ sink="Element innerHTML"',
    "csp-report directive=style-src-attr disposition=enforce blocked=inline path=/",
  ]);
  assertClean(lines);
});

test("csp-report: størrelsesgrensen holder uten Content-Length", async () => {
  const big = JSON.stringify({ "csp-report": { ...legacy["csp-report"], "script-sample": "x".repeat(csp.MAX_BODY) } });
  // En strøm har ingen Content-Length, så bare å lese den kan avgjøre størrelsen.
  const stream = new ReadableStream({ start(c) { const b = new TextEncoder().encode(big); for (let i = 0; i < b.length; i += 1000) c.enqueue(b.slice(i, i + 1000)); c.close(); } });
  const req = new Request(URL_, { method: "POST", headers: { "content-type": "application/csp-report" }, body: stream, duplex: "half" });
  assert.equal(req.headers.get("content-length"), null);
  const { res, lines } = await run(req);
  assert.equal(res.status, 413);
  assert.deepEqual(lines, []);
  // Og en falsk, liten Content-Length slipper den heller ikke gjennom.
  assert.equal(await csp.readLimited(new Request(URL_, { method: "POST", body: big }), csp.MAX_BODY), null);
  assert.equal((await run(post(big, "application/csp-report", { "content-length": "100000" }))).res.status, 413);
});

test("csp-report: andre innholdstyper gir 415, ikke JSON gir 400", async () => {
  assert.equal((await run(post(JSON.stringify(legacy), "text/plain"))).res.status, 415);
  assert.equal((await run(post("{nei", "application/reports+json"))).res.status, 400);
  assert.equal((await run(post("[]", "application/reports+json; charset=utf-8"))).res.status, 204);
});

test("csp-report: frekvensgrensen teller en hash av adressen, aldri adressen", async () => {
  const keys = [];
  let allow = true;
  const env = { CSP_LIMIT: { limit: async ({ key }) => { keys.push(key); return { success: allow }; } } };
  assert.equal((await run(post(JSON.stringify(legacy), "application/csp-report"), env)).res.status, 204);
  allow = false;
  const { res, lines } = await run(post(JSON.stringify(legacy), "application/csp-report"), env);
  assert.equal(res.status, 429);
  assert.deepEqual(lines, []);
  assert.equal(keys[0], keys[1], "samme adresse, samme nøkkel");
  assert.ok(keys.every((k) => /^[0-9a-f]{24}$/.test(k) && !k.includes(IP)));
});

test("csp-report: høyst MAX_REPORTS linjer fra én forespørsel", async () => {
  const many = Array.from({ length: csp.MAX_REPORTS + 5 }, () => reporting[1]);
  const { res, lines } = await run(post(JSON.stringify(many), "application/reports+json"));
  assert.equal(res.status, 204);
  assert.equal(lines.length, csp.MAX_REPORTS);
});

test("csp-report: det som blokkeres, reduseres til skjema og vert eller et nøkkelord", () => {
  assert.equal(csp.blockedOf("https://a.example:8443/p?q=1"), "https://a.example:8443");
  assert.equal(csp.blockedOf("data:image/png;base64,AAAA"), "data");
  assert.equal(csp.blockedOf("blob:https://flysteder.hpgt.com/1234"), "blob");
  assert.equal(csp.blockedOf("eval"), "eval");
  assert.equal(csp.blockedOf("trusted-types-policy"), "trusted-types-policy");
  assert.equal(csp.blockedOf("chrome-extension://abcdefghijklmnop/x.js"), "chrome-extension");
  assert.equal(csp.blockedOf(""), "none");
  assert.equal(csp.pathOf("http://flysteder.hpgt.com/"), null, "bare siden over https");
  assert.equal(csp.pathOf("https://flysteder.hpgt.com/<script>"), "(annen)");
  assert.equal(csp.sinkOf("<b>ola</b>"), null, "et utdrag uten navn på sinken logges ikke");
  assert.equal(csp.sinkOf("HTMLScriptElement src|https://x"), "HTMLScriptElement src");
});
