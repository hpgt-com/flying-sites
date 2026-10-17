// Height profile under «Luftrom over start» on the site page: terrain from launch to landing, the floor of the
// lowest fixed airspace over the launch, and an arrow with the height between them. Drawn at build time as an
// SVG string, so it needs no JavaScript. Colours come from CSS classes (styles.css), so it follows the theme.
// The drawing is schematic, not to scale: a true scale makes small heights (193 m at Arbøstadtinden) and a launch
// above the floor (Sætertinden) unreadable. The arrow grows a little with the height, but the number carries the
// value. The arrow stands on the launch, which makes it clear that the height applies over the launch only.

import { dict, fmt } from "./i18n.js";
import { formatLimit } from "./format.js";

const W = 360;
const H = 190;
const LAUNCH_X = 118;
const LANDING_X = 262;
const BASE = H - 6; // sea level
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r = (n) => Math.round(n * 10) / 10;

// ceiling: from ceilingOverLaunch() in lib/airspace.js. Returns "" when there is nothing to draw: no ceiling,
// airspace from the ground (shown as text), or no launch height.
export function airspaceProfile(ceiling, launchMasl, landingMasl, lang) {
  if (!ceiling || ceiling.fromGround || !Number.isFinite(ceiling.masl) || !Number.isFinite(launchMasl)) return "";
  const t = dict(lang);
  const p = t.site.profile;
  const masl = t.units.masl;
  const limit = ceiling.masl;
  const gap = limit - launchMasl;
  const landing = Number.isFinite(landingMasl) && landingMasl < launchMasl ? landingMasl : null;

  // Vertical layout. Above the floor: limit line high up, launch below it. Launch above the floor: the line
  // lower down and the launch above it. The airspace name always sits at the top of the band.
  const above = gap >= 0;
  const yLimit = above ? 62 : 108;
  const yLaunch = above ? yLimit + 46 + 44 * Math.min(1, gap / 1300) : yLimit - 34 - 16 * Math.min(1, -gap / 600);
  const down = BASE - yLaunch;
  // The landing at least 30 px below the launch, so its label stays clear of «Start …».
  const yLanding = landing != null ? Math.min(BASE - 8, yLaunch + Math.max(30, down * (1 - landing / launchMasl))) : null;
  const yLow = yLanding ?? yLaunch + down * 0.8;

  // Terrain: up to the launch from the left, down to the landing (or towards the sea) on the right.
  const terrain = [
    [0, yLaunch + down * 0.6], [56, yLaunch + down * 0.22], [LAUNCH_X, yLaunch],
    [LAUNCH_X + 60, yLaunch + (yLow - yLaunch) * 0.55], [LANDING_X, yLow], [W, yLow + (BASE - yLow) * 0.3], [W, H], [0, H],
  ].map(([x, yy]) => `${x},${r(yy)}`).join(" ");

  const a = ceiling.airspace;
  const name = [a.name, a.class ? fmt(t.site.class, { c: a.class }) : ""].filter(Boolean).join(" · ");
  const floor = fmt(p.floor, { m: limit, limit: formatLimit(a.lower, lang) });
  const gapText = fmt(above ? p.gap : p.gapNegative, { m: Math.abs(gap) });
  const label = fmt(above ? p.ariaAbove : p.ariaBelow, { name: a.name, m: Math.abs(gap), limit, launch: launchMasl });

  // The height label sits left of the arrow, centred on it.
  const yMid = (yLimit + yLaunch) / 2 - 6;
  const arrowFrom = above ? r(yLaunch - 7) : yLimit;
  const arrowTo = above ? yLimit + 3 : r(yLaunch + 7);

  return `<svg class="airspace-profile" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="ap-title">` +
    `<title id="ap-title">${esc(label)}</title>` +
    `<defs><marker id="ap-head" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" class="airspace-profile__head${above ? "" : " airspace-profile__head--warn"}"/></marker></defs>` +
    `<rect x="0" y="0" width="${W}" height="${yLimit}" class="airspace-profile__band"/>` +
    `<line x1="0" x2="${W}" y1="${yLimit}" y2="${yLimit}" class="airspace-profile__limit"/>` +
    `<text x="10" y="24" class="airspace-profile__name">${esc(name)}</text>` +
    `<text x="10" y="42" class="airspace-profile__floor">${esc(floor)}</text>` +
    `<polygon points="${terrain}" class="airspace-profile__terrain"/>` +
    `<line x1="${LAUNCH_X}" x2="${LAUNCH_X}" y1="${arrowFrom}" y2="${arrowTo}" class="airspace-profile__arrow${above ? "" : " airspace-profile__arrow--warn"}" marker-start="url(#ap-head)" marker-end="url(#ap-head)"/>` +
    `<text x="${LAUNCH_X - 10}" y="${r(yMid + 2)}" text-anchor="end" class="airspace-profile__gap${above ? "" : " airspace-profile__gap--warn"}">${esc(gapText)}</text>` +
    `<text x="${LAUNCH_X - 10}" y="${r(yMid + 17)}" text-anchor="end" class="airspace-profile__small">${esc(above ? p.overLaunch : p.launchAbove)}</text>` +
    `<circle cx="${LAUNCH_X}" cy="${r(yLaunch)}" r="5.5" class="airspace-profile__launch"/>` +
    `<text x="${LAUNCH_X + 12}" y="${r(yLaunch + 5)}" class="airspace-profile__label">${esc(p.launch)} ${launchMasl} ${esc(masl)}</text>` +
    (landing != null
      ? `<circle cx="${LANDING_X}" cy="${r(yLanding)}" r="5" class="airspace-profile__landing"/>` +
        `<text x="${LANDING_X}" y="${r(yLanding - 11)}" text-anchor="middle" class="airspace-profile__label">${esc(p.landing)} ${landing} ${esc(masl)}</text>`
      : "") +
    `</svg>`;
}
