// Signing in as the club's GitHub App, so the issues from «Meld fra om endring» (report.js) come from the app (shown as
// a bot) and no personal token has to be renewed. The app's ID (or Client ID) and private key are the secrets REPORTS_APP_ID and
// REPORTS_APP_PRIVATE_KEY (the .pem file GitHub gives, as it is); the installation on the repository is looked up. Each
// call asks GitHub for a token that lasts an hour (a report is rare, so nothing is kept). Tested in
// test/data-worker.test.js.

const API = "https://api.github.com";
const HEADERS = { accept: "application/vnd.github+json", "user-agent": "hpgt-flysteder" };

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const utf8 = (s) => new TextEncoder().encode(s);

// DER length, and a tag with its content.
function der(tag, content) {
  const n = content.length;
  const len = n < 128 ? [n] : n < 256 ? [0x81, n] : n < 65536 ? [0x82, n >> 8, n & 255] : [0x83, n >> 16, (n >> 8) & 255, n & 255];
  return Uint8Array.from([tag, ...len, ...content]);
}

// The key as WebCrypto takes it (PKCS#8). GitHub gives PKCS#1 («BEGIN RSA PRIVATE KEY»), which is wrapped here; a key
// already in PKCS#8 («BEGIN PRIVATE KEY») is used as it is.
export function pkcs8(pem) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const raw = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  if (!/BEGIN RSA PRIVATE KEY/.test(pem)) return raw;
  const rsaOid = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  return der(0x30, [0x02, 0x01, 0x00, ...der(0x30, rsaOid), ...der(0x04, [...raw])]);
}

// A JWT for the app, valid for 9 minutes (GitHub allows 10), back-dated a minute for clock drift.
export async function appJwt(appId, pem, now = Date.now()) {
  const key = await crypto.subtle.importKey("pkcs8", pkcs8(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const t = Math.floor(now / 1000);
  const head = b64url(utf8(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(utf8(JSON.stringify({ iat: t - 60, exp: t + 540, iss: String(appId) })));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(sig)}`;
}

// A token for the app's installation on `repo` ("owner/name"), for one call. The token is asked for with only that
// repository and Issues: write, so it can do no more than that even if the app is one day installed on more or given
// more.
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
