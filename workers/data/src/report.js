// «Meld fra om endring» on the site pages: POST /v1/report from flysteder.hpgt.com. The browser is checked with
// Cloudflare Turnstile (the secret TURNSTILE_SECRET), and the report becomes an issue in the site's GitHub repository,
// made by the club's GitHub App (the secrets REPORTS_APP_ID and REPORTS_APP_PRIVATE_KEY, github-app.js), or else with a
// fine-grained token (the secret GITHUB_ISSUES_TOKEN, only Issues: read and write on hpgt-com/flying-sites).
// Without Turnstile and one of the two the endpoint answers 503 and the pages do not show the form (turnstileSiteKey in
// src/_data/site.js). At most DAILY_LIMIT reports a day. Nothing is stored here but the day's count. The issue gets the
// labels for its kind (LABELS), and the answer gives its number and address, so the form can link to it. Tested in
// test/data-worker.test.js.

import { installationToken } from "./github-app.js";

// What a report about a site can concern, and one from /meld-fra/ (no site). The pages have the same lists (macros.njk).
export const KINDS = ["landing", "access", "hazard", "launch", "other"];
export const GENERAL_KINDS = ["newsite", "bug", "idea", "other"];
export const MAX_MESSAGE = 1000;
export const MIN_MESSAGE = 10;
export const MAX_NAME = 80;
export const DAILY_LIMIT = 20;
export const ORIGINS = ["https://flysteder.hpgt.com"];
const REPO = "hpgt-com/flying-sites";
const KIND_TITLES = { landing: "Landing", access: "Vei, parkering eller adkomst", hazard: "Fare eller hindring", launch: "Start", other: "Annet",
  newsite: "Nytt flysted", bug: "Feil på siden", idea: "Forslag" };
// The labels each kind gets (all exist in the repository): what concerns a site's information is site-data, a hazard
// is also safety; a fault on the page is a bug and an idea an enhancement. «endringsforslag» is the label of the issue
// form for changes (.github/ISSUE_TEMPLATE/endring.yml), so reports and changes suggested on GitHub are found together.
const SITE_LABELS = ["endringsforslag", "site-data"];
export const LABELS = { landing: SITE_LABELS, access: SITE_LABELS, launch: SITE_LABELS, hazard: [...SITE_LABELS, "safety"], newsite: SITE_LABELS,
  bug: ["bug"], idea: ["enhancement"] };
// The address of an issue in the repository, the only kind of link passed on to the page.
const ISSUE_URL = new RegExp(`^https://github\\.com/${REPO}/issues/\\d+$`);

// The report checked and trimmed, or { error } with what is wrong. siteNames: { id: name } for the sites that exist.
export function checkReport(body, siteNames) {
  if (!body || typeof body !== "object") return { error: "bad-request" };
  const site = typeof body.site === "string" ? body.site : "";
  const kind = typeof body.kind === "string" ? body.kind : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const token = typeof body.token === "string" ? body.token : "";
  // No site: a general report from /meld-fra/.
  if (site === "" ? !GENERAL_KINDS.includes(kind) : !Object.hasOwn(siteNames, site) || !KINDS.includes(kind)) return { error: "bad-request" };
  if (message.length < MIN_MESSAGE || message.length > MAX_MESSAGE || name.length > MAX_NAME) return { error: "bad-length" };
  if (!token || token.length > 4096) return { error: "no-token" };
  return { site, siteName: site ? siteNames[site] : null, kind, message, name, token };
}

// The issue: the title names the site and the kind; the text from the form goes in a code block, so nothing in it is
// read as Markdown (no links, images or @mentions).
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
  // «Annet» on a site page concerns the site; «Annet» from /meld-fra/ may be anything, so it gets no label.
  const labels = report.kind === "other" ? (report.site ? SITE_LABELS : []) : LABELS[report.kind];
  return { title: `[Meld fra] ${report.siteName ?? "Generelt"}: ${KIND_TITLES[report.kind]}`, body: lines.join("\n"), labels };
}

async function turnstileOk(env, token, ip) {
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const r = await fetch(env.TURNSTILE_URL || "https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form, signal: AbortSignal.timeout(10000) });
  const d = r.ok ? await r.json() : null;
  return !!(d && d.success);
}

const hasApp = (env) => !!(env.REPORTS_APP_ID && env.REPORTS_APP_PRIVATE_KEY);

async function createIssue(env, issue, now) {
  const token = hasApp(env) ? await installationToken(env, REPO, now) : env.GITHUB_ISSUES_TOKEN;
  const r = await fetch(`${env.GITHUB_API || "https://api.github.com"}/repos/${REPO}/issues`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "hpgt-flysteder", "content-type": "application/json" },
    body: JSON.stringify(issue),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`GitHub svarte ${r.status}`);
  // The issue's number and address, or null when GitHub's answer does not have them as expected.
  const d = await r.json().catch(() => null);
  return d && Number.isInteger(d.number) && ISSUE_URL.test(d.html_url) ? { number: d.number, url: d.html_url } : null;
}

// The answer to POST /v1/report: { status, body }. store: for the day's count; siteNames as for checkReport.
export async function handleReport(request, env, store, siteNames, now = Date.now()) {
  if (!env.TURNSTILE_SECRET || !(hasApp(env) || env.GITHUB_ISSUES_TOKEN)) return { status: 503, body: { error: "not-configured" } };
  let body = null;
  try { body = await request.json(); } catch { /* not JSON */ }
  const report = checkReport(body, siteNames);
  if (report.error) return { status: 400, body: { error: report.error } };
  if (!(await turnstileOk(env, report.token, request.headers.get("cf-connecting-ip")))) return { status: 403, body: { error: "turnstile" } };
  const key = `reports-${new Date(now).toISOString().slice(0, 10)}`;
  const count = (await store.getState(key)) ?? 0;
  if (count >= DAILY_LIMIT) return { status: 429, body: { error: "limit" } };
  await store.putState(key, count + 1);
  let issue;
  try {
    issue = await createIssue(env, issueFor(report, now), now);
  } catch (err) {
    console.warn(`report: ${err.message}`);
    return { status: 502, body: { error: "github" } };
  }
  return { status: 200, body: issue ? { ok: true, issue: issue.number, url: issue.url } : { ok: true } };
}
