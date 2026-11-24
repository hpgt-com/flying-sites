// «Meld fra om endring» på stedssidene: POST /v1/report fra flysteder.hpgt.com. Nettleseren sjekkes med Cloudflare
// Turnstile (hemmeligheten TURNSTILE_SECRET), og rapporten blir en sak i nettstedets repo på GitHub. Saken lages av
// klubbens GitHub App «HPGT Flying Sites Reports» (hemmelighetene REPORTS_APP_ID og REPORTS_APP_PRIVATE_KEY,
// github-app.js) med en token som varer en time og bare gjelder Issues i dette repoet. Ingen personlig token.
// Uten Turnstile og appen svarer endepunktet 503, og sidene viser ikke skjemaet (turnstileSiteKey i src/_data/site.js).
// Høyst DAILY_LIMIT rapporter i døgnet, og PER_IP_LIMIT fra én IP-adresse. Begge telles og reserveres i ett steg i
// lageret (store.js reserveReport), så to rapporter samtidig ikke begge kan slippe forbi grensen. En reservasjon gis
// tilbake når GitHub feiler. Adressen beholdes bare som en hash med et salt, som kastes sammen med dagens telling dagen
// etter. Svaret fra Turnstile må gjelde nettstedets eget vertsnavn. Saken får etikettene for sin type (LABELS), og
// svaret gir nummeret og adressen, så skjemaet kan lenke til den. Testet i test/data-worker.test.js.

import { installationToken } from "./github-app.js";

// Hva en rapport om et sted kan gjelde, og en fra /meld-fra/ (uten sted). Sidene har de samme listene (macros.njk).
export const KINDS = ["landing", "access", "hazard", "launch", "other"];
export const GENERAL_KINDS = ["newsite", "bug", "idea", "other"];
export const MAX_MESSAGE = 1000;
export const MIN_MESSAGE = 10;
export const MAX_NAME = 80;
// 50 i døgnet: nok for en travel kveld etter et klubbmøte, og få nok til at en flom har en grense. 3 fra én adresse.
export const DAILY_LIMIT = 50;
export const PER_IP_LIMIT = 3;
// Det største innholdet i en forespørsel som leses (feltene i skjemaet og Turnstile-tokenen er langt under).
export const MAX_BODY = 8192;
export const ORIGINS = ["https://flysteder.hpgt.com"];
const REPO = "hpgt-com/flying-sites";
const KIND_TITLES = { landing: "Landing", access: "Vei, parkering eller adkomst", hazard: "Fare eller hindring", launch: "Start", other: "Annet",
  newsite: "Nytt flysted", bug: "Feil på siden", idea: "Forslag" };
// Etikettene hver type får (alle finnes i repoet). Det som gjelder opplysningene om et sted, er site-data, og en fare
// er også safety. En feil på siden er bug, og et forslag er enhancement. «endringsforslag» er etiketten til
// saksskjemaet for endringer (.github/ISSUE_TEMPLATE/endring.yml), så rapporter og endringer foreslått på GitHub finnes
// sammen.
const SITE_LABELS = ["endringsforslag", "site-data"];
export const LABELS = { landing: SITE_LABELS, access: SITE_LABELS, launch: SITE_LABELS, hazard: [...SITE_LABELS, "safety"], newsite: SITE_LABELS,
  bug: ["bug"], idea: ["enhancement"] };
// Adressen til en sak i repoet, den eneste typen lenke som sendes videre til siden.
const ISSUE_URL = new RegExp(`^https://github\\.com/${REPO}/issues/\\d+$`);

// Rapporten sjekket og trimmet, eller { error } med det som er feil. siteNames: { id: name } for stedene som finnes.
export function checkReport(body, siteNames) {
  if (!body || typeof body !== "object") return { error: "bad-request" };
  const site = typeof body.site === "string" ? body.site : "";
  const kind = typeof body.kind === "string" ? body.kind : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const token = typeof body.token === "string" ? body.token : "";
  // Uten sted: en generell rapport fra /meld-fra/.
  if (site === "" ? !GENERAL_KINDS.includes(kind) : !Object.hasOwn(siteNames, site) || !KINDS.includes(kind)) return { error: "bad-request" };
  if (message.length < MIN_MESSAGE || message.length > MAX_MESSAGE || name.length > MAX_NAME) return { error: "bad-length" };
  if (!token || token.length > 4096) return { error: "no-token" };
  return { site, siteName: site ? siteNames[site] : null, kind, message, name, token };
}

// Saken: tittelen nevner stedet og typen. Teksten fra skjemaet legges i en kodeblokk, så ingenting i den leses som
// Markdown (ingen lenker, bilder eller @-omtaler).
export function issueFor(report, now = Date.now()) {
  const fence = (s) => "~~~text\n" + s.replace(/~~~/g, "~ ~ ~") + "\n~~~";
  const lines = [
    report.site ? `Meldt fra skjemaet på stedssiden for **${report.siteName}** (\`src/sites/${report.site}/\`).` : "Meldt fra skjemaet «Meld fra» i menyen (gjelder ikke ett bestemt flysted).",
    "",
    `- Gjelder: ${KIND_TITLES[report.kind]}`,
    `- Tidspunkt: ${new Date(now).toISOString()}`,
    "",
    fence(report.message),
  ];
  if (report.name) lines.push("", "Fra:", fence(report.name));
  lines.push("", "_Sendt inn av en besøkende. Sjekk opplysningene før stedet endres._");
  // «Annet» på en stedsside gjelder stedet. «Annet» fra /meld-fra/ kan være hva som helst, så den får ingen etikett.
  const labels = report.kind === "other" ? (report.site ? SITE_LABELS : []) : LABELS[report.kind];
  return { title: `[Meld fra] ${report.siteName ?? "Generelt"}: ${KIND_TITLES[report.kind]}`, body: lines.join("\n"), labels };
}

// Vertsnavnene svaret fra Turnstile kan gjelde: de til de tillatte opphavene (ORIGINS, eller REPORT_ORIGINS under
// testing).
export function reportHosts(env) {
  return (env.REPORT_ORIGINS ? env.REPORT_ORIGINS.split(",") : ORIGINS).map((o) => { try { return new URL(o.trim()).hostname; } catch { return null; } }).filter(Boolean);
}

// Om Turnstile godtar tokenen, for et av våre vertsnavn (en token løst på et annet nettsted avvises). Tidsavbrudd eller
// en feil fra Turnstile regnes som ikke godtatt.
async function turnstileOk(env, token, ip) {
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const r = await fetch(env.TURNSTILE_URL || "https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form, signal: AbortSignal.timeout(10000) });
    const d = r.ok ? await r.json() : null;
    const ok = !!(d && d.success && reportHosts(env).includes(d.hostname));
    // Hvorfor en token ble avvist (feilkodene fra Turnstile, ingenting om avsenderen). Da ses en feil hemmelighet eller
    // et feil vertsnavn i loggene, og ikke bare som «sjekken feilet» i skjemaet.
    if (!ok) console.warn(`turnstile: ${!r.ok ? `svarte ${r.status}` : d?.success ? `hostname ${d.hostname}` : (d?.["error-codes"] ?? []).join(",") || "avvist"}`);
    return ok;
  } catch (err) {
    console.warn(`turnstile: ${err.message}`);
    return false;
  }
}

// Avsenderens adresse som en hash med dagens salt (aldri selve adressen), eller "" uten adresse.
export async function ipKey(ip, salt) {
  if (!ip) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${ip}`));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const hasApp = (env) => !!(env.REPORTS_APP_ID && env.REPORTS_APP_PRIVATE_KEY);

async function createIssue(env, issue, now) {
  const token = await installationToken(env, REPO, now);
  const r = await fetch(`${env.GITHUB_API || "https://api.github.com"}/repos/${REPO}/issues`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "hpgt-flysteder", "content-type": "application/json" },
    body: JSON.stringify(issue),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`GitHub svarte ${r.status}`);
  // Nummeret og adressen til saken, eller null når svaret fra GitHub ikke har dem slik vi venter.
  const d = await r.json().catch(() => null);
  return d && Number.isInteger(d.number) && ISSUE_URL.test(d.html_url) ? { number: d.number, url: d.html_url } : null;
}

// Svaret på POST /v1/report: { status, body }. store: for dagens telling. siteNames som for checkReport.
export async function handleReport(request, env, store, siteNames, now = Date.now()) {
  if (!env.TURNSTILE_SECRET || !hasApp(env)) return { status: 503, body: { error: "not-configured" } };
  if (!/^application\/json\b/i.test(request.headers.get("content-type") || "")) return { status: 415, body: { error: "bad-request" } };
  if (Number(request.headers.get("content-length")) > MAX_BODY) return { status: 413, body: { error: "bad-length" } };
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return { status: 413, body: { error: "bad-length" } };
  let body = null;
  try { body = JSON.parse(text); } catch { /* ikke JSON */ }
  const report = checkReport(body, siteNames);
  if (report.error) return { status: 400, body: { error: report.error } };
  const ip = request.headers.get("cf-connecting-ip");
  if (!(await turnstileOk(env, report.token, ip))) return { status: 403, body: { error: "turnstile" } };
  const day = new Date(now).toISOString().slice(0, 10);
  const who = await ipKey(ip, await store.reportSalt(day));
  const reserved = await store.reserveReport(day, who, DAILY_LIMIT, PER_IP_LIMIT);
  if (reserved !== "ok") return { status: 429, body: { error: "limit" } };
  let issue;
  try {
    issue = await createIssue(env, issueFor(report, now), now);
  } catch (err) {
    console.warn(`report: ${err.message}`);
    await store.releaseReport(day, who);
    return { status: 502, body: { error: "github" } };
  }
  return { status: 200, body: issue ? { ok: true, issue: issue.number, url: issue.url } : { ok: true } };
}
