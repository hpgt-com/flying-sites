// Innlogging som klubbens GitHub App. Da kommer sakene fra «Meld fra om endring» (report.js) fra appen (vist som en
// bot), og ingen personlig token må fornyes. Appens ID (eller Client ID) og private nøkkel er hemmelighetene
// REPORTS_APP_ID og REPORTS_APP_PRIVATE_KEY (.pem-filen fra GitHub, som den er). Installasjonen på repoet slås opp.
// Hvert kall ber GitHub om en token som varer en time (rapporter er sjeldne, så ingenting beholdes). Testet i
// test/data-worker.test.js.

const API = "https://api.github.com";
const HEADERS = { accept: "application/vnd.github+json", "user-agent": "hpgt-flysteder" };

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const utf8 = (s) => new TextEncoder().encode(s);

// DER-lengde, og en tagg med innholdet.
function der(tag, content) {
  const n = content.length;
  const len = n < 128 ? [n] : n < 256 ? [0x81, n] : n < 65536 ? [0x82, n >> 8, n & 255] : [0x83, n >> 16, (n >> 8) & 255, n & 255];
  return Uint8Array.from([tag, ...len, ...content]);
}

// Nøkkelen slik WebCrypto vil ha den (PKCS#8). GitHub gir PKCS#1 («BEGIN RSA PRIVATE KEY»), som pakkes inn her. En
// nøkkel som alt er PKCS#8 («BEGIN PRIVATE KEY»), brukes som den er.
export function pkcs8(pem) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const raw = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  if (!/BEGIN RSA PRIVATE KEY/.test(pem)) return raw;
  const rsaOid = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  return der(0x30, [0x02, 0x01, 0x00, ...der(0x30, rsaOid), ...der(0x04, [...raw])]);
}

// En JWT for appen, gyldig i 9 minutter (GitHub tillater 10), tilbakedatert ett minutt i tilfelle klokkene går ulikt.
export async function appJwt(appId, pem, now = Date.now()) {
  const key = await crypto.subtle.importKey("pkcs8", pkcs8(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const t = Math.floor(now / 1000);
  const head = b64url(utf8(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(utf8(JSON.stringify({ iat: t - 60, exp: t + 540, iss: String(appId) })));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(sig)}`;
}

// En token for appens installasjon på `repo` ("eier/navn"), for ett kall. Tokenen bes om med bare det repoet og
// Issues: write, så den kan ikke gjøre mer enn det, selv om appen en dag blir installert på flere repoer eller får
// flere rettigheter.
export async function installationToken(env, repo, now = Date.now()) {
  const api = env.GITHUB_API || API;
  const jwt = await appJwt(env.REPORTS_APP_ID, env.REPORTS_APP_PRIVATE_KEY, now);
  const auth = { ...HEADERS, authorization: `Bearer ${jwt}` };
  const inst = await fetch(`${api}/repos/${repo}/installation`, { headers: auth, signal: AbortSignal.timeout(10000) });
  if (!inst.ok) throw new Error(`GitHub (installasjon) svarte ${inst.status}`);
  const { id } = await inst.json();
  const tok = await fetch(`${api}/app/installations/${id}/access_tokens`, {
    method: "POST", headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ repositories: [repo.split("/")[1]], permissions: { issues: "write" } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!tok.ok) throw new Error(`GitHub (token) svarte ${tok.status}`);
  return (await tok.json()).token;
}
