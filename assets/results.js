/* global CustomEvent */
// /results page: read URL params → fetch therapists → score → render into
// the design from PR #660. /match keeps working as today; this page is the
// new destination from the homepage form and the /match refine submit.

import { fetchPublicTherapists } from "./cms.js";
import { rankTherapistsForUser, buildUserMatchProfile } from "./matching-model.js";
import {
  restoreProfileFromUrl,
  splitCommaSeparated,
  deriveStateFromLocation,
  buildAppliedAnswerPills,
} from "./match-intake.js";
import { getCardLocationLabel, getFeeLabel, getInsuranceLabel } from "./card-content.js";
import { escapeHtml } from "./escape-html.js";

const FEATURED_RANK = 1;
const PRIMARY_LIMIT = 8;

/* ── helpers ─────────────────────────────────────────────── */

function getInitials(name) {
  const parts = String(name || "")
    .replace(/[^A-Za-z\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const REASON_GENERIC = new Set(["bipolar", "mood disorders", "mood disorder"]);

function buildReasonLine(therapist) {
  const t = therapist || {};
  const years = Number(t.bipolar_years_experience || 0);
  if (years > 0) {
    return `${years} yr${years === 1 ? "" : "s"} treating bipolar`;
  }
  const specs = Array.isArray(t.specialties) ? t.specialties : [];
  for (const raw of specs) {
    const s = String(raw || "").trim();
    if (/bipolar|cycl|mixed/i.test(s) && !REASON_GENERIC.has(s.toLowerCase())) {
      return `${s} specialist`;
    }
  }
  return "";
}

const MODALITY_TOKENS = [
  "ipsrt",
  "dbt",
  "cbt",
  "fft",
  "act",
  "emdr",
  "psychodynamic",
  "internal family systems",
  "ifs",
  "mindfulness",
];

function isModalityTag(tag) {
  const lower = String(tag || "").toLowerCase();
  return MODALITY_TOKENS.some((tok) => lower.includes(tok));
}

function isBipolarTag(tag) {
  return /bipolar|cycl|mixed/i.test(String(tag || ""));
}

function buildSpecialtyTagsHtml(therapist, max) {
  const all = Array.isArray(therapist.specialties) ? therapist.specialties : [];
  const bipolar = all.filter(isBipolarTag);
  const modality = all.filter(isModalityTag);
  const ordered = [...bipolar, ...modality];
  if (!ordered.length) return "";
  const shown = ordered.slice(0, max);
  const overflow = ordered.length - shown.length;
  const items = shown
    .map((tag) => {
      const cls = isModalityTag(tag) ? "specialty-tag specialty-tag-modality" : "specialty-tag";
      return `<li class="${cls}">${escapeHtml(tag)}</li>`;
    })
    .join("");
  const more = overflow > 0 ? `<li class="specialty-tag-more">+${overflow} more</li>` : "";
  return `<ul class="specialty-tags">${items}${more}</ul>`;
}

function buildBipolarYearsBadgeHtml(therapist) {
  const years = Number(therapist.bipolar_years_experience || 0);
  if (years <= 0) return "";
  return (
    `<div class="bipolar-years-badge">` +
    `<span class="bipolar-years-num">${years}</span>` +
    `<span class="bipolar-years-label">year${years === 1 ? "" : "s"}<br />treating bipolar specifically</span>` +
    `</div>`
  );
}

function buildMetaHtml(therapist, profile, opts) {
  const tele = profile && profile.care_format === "Telehealth";
  const userZip = profile ? String(profile.location_query || "") : "";
  const distanceMiles = !tele && userZip && therapist.zip ? null : null; // TODO: zip distance is computed in match.js via getZipDistance — punt to a follow-up
  const items = [];
  const loc = getCardLocationLabel(therapist, { distanceMiles, teleSelected: tele });
  if (loc) items.push({ html: escapeHtml(loc) });
  const fee = getFeeLabel(therapist);
  if (fee) items.push({ html: escapeHtml(fee) });
  if (therapist.accepting_new_patients) {
    items.push({
      html: `<span class="avail-dot" aria-hidden="true"></span>Available now`,
      avail: true,
    });
  }
  const ins = getInsuranceLabel(therapist);
  if (ins) items.push({ html: escapeHtml(ins) });
  if (!items.length) return "";
  const cls = opts && opts.small ? "card-meta card-meta-sm" : "card-meta";
  return `<ul class="${cls}">${items.map((i) => `<li class="card-meta-item${i.avail ? " card-meta-avail" : ""}">${i.html}</li>`).join("")}</ul>`;
}

function profileHref(therapist) {
  return `/therapists/${encodeURIComponent(therapist.slug || "")}`;
}

function hasRenderableTherapist(entry) {
  const therapist = entry && entry.therapist;
  return Boolean(therapist && String(therapist.slug || "").trim());
}

/* ── card builders ───────────────────────────────────────── */

function renderFeaturedCard(entry, profile) {
  const t = entry.therapist || {};
  const reason = buildReasonLine(t);
  return (
    `<div class="best-match-label">` +
    `<i class="ti ti-rosette" aria-hidden="true"></i>` +
    `<span>Top match</span>` +
    `</div>` +
    `<article class="featured-card" data-card data-card-rank="${FEATURED_RANK}" data-card-id="${escapeHtml(t.slug || "")}">` +
    `<div class="featured-card-header">` +
    `<div class="card-avatar" aria-hidden="true">${escapeHtml(getInitials(t.name))}</div>` +
    `<div class="card-ident">` +
    `<h2 class="card-name">${escapeHtml(t.name || "")}${t.credentials ? `, <span class="card-creds">${escapeHtml(t.credentials)}</span>` : ""}</h2>` +
    (t.headline ? `<p class="card-title">${escapeHtml(t.headline)}</p>` : "") +
    (reason ? `<p class="card-reason" data-card-reason>${escapeHtml(reason)}</p>` : "") +
    `</div>` +
    `<button type="button" class="card-save" data-card-save aria-label="Save this therapist" aria-pressed="false">` +
    `<i class="ti ti-bookmark" aria-hidden="true"></i><span class="card-save-label">Save</span>` +
    `</button>` +
    `</div>` +
    buildBipolarYearsBadgeHtml(t) +
    buildSpecialtyTagsHtml(t, 4) +
    buildMetaHtml(t, profile) +
    `<div class="card-actions">` +
    `<a href="${escapeHtml(profileHref(t))}" class="card-cta-primary" data-card-profile>View profile <i class="ti ti-arrow-right" aria-hidden="true"></i></a>` +
    `</div>` +
    `</article>`
  );
}

function renderGridCard(entry, rank, profile) {
  const t = entry.therapist || {};
  return (
    `<article class="grid-card" data-card data-card-rank="${rank}" data-card-id="${escapeHtml(t.slug || "")}">` +
    `<div class="grid-card-header">` +
    `<div class="card-avatar card-avatar-sm" aria-hidden="true">${escapeHtml(getInitials(t.name))}</div>` +
    `<div class="card-ident">` +
    `<h3 class="card-name card-name-sm">${escapeHtml(t.name || "")}${t.credentials ? `, <span class="card-creds">${escapeHtml(t.credentials)}</span>` : ""}</h3>` +
    `</div>` +
    `<button type="button" class="card-save" data-card-save aria-label="Save this therapist" aria-pressed="false">` +
    `<i class="ti ti-bookmark" aria-hidden="true"></i><span class="card-save-label">Save</span>` +
    `</button>` +
    `</div>` +
    buildSpecialtyTagsHtml(t, 2) +
    buildMetaHtml(t, profile, { small: true }) +
    `<div class="card-actions">` +
    `<a href="${escapeHtml(profileHref(t))}" class="card-cta-grid" data-card-profile>View profile <i class="ti ti-arrow-right" aria-hidden="true"></i></a>` +
    `</div>` +
    `</article>`
  );
}

/* ── header / state ───────────────────────────────────────── */

function renderHeader(profile, count) {
  const countEl = document.querySelector("[data-results-count]");
  if (countEl) countEl.textContent = String(count);

  const filtersEl = document.querySelector("[data-results-filters]");
  if (!filtersEl) return;
  // Build the same applied-answer pills /match uses, then re-style them with
  // our .filter-pill class. The Edit link stays at the end.
  const editLink = filtersEl.querySelector(".filter-edit-btn");
  filtersEl.innerHTML = "";
  const pills = profile ? buildAppliedAnswerPills(profile) : [];
  pills.forEach((p) => {
    const span = document.createElement("span");
    span.className = "filter-pill";
    span.textContent = p.label || p.value || p;
    filtersEl.appendChild(span);
  });
  if (editLink) filtersEl.appendChild(editLink);
}

function showState(state) {
  const list = document.querySelector("[data-results-list]");
  const skeleton = document.querySelector("[data-results-skeleton]");
  const empty = document.querySelector("[data-results-empty]");
  const error = document.querySelector("[data-results-error]");
  const footer = document.querySelector("[data-results-footer]");
  if (skeleton) skeleton.hidden = state !== "loading";
  if (empty) empty.hidden = state !== "empty";
  if (error) error.hidden = state !== "error";
  if (footer) footer.hidden = state !== "loaded";
  if (list) {
    // Hide cards container while loading or empty.
    [...list.querySelectorAll("[data-results-cards]")].forEach((el) => {
      el.hidden = state !== "loaded";
    });
  }
}

/* ── orchestrator ─────────────────────────────────────────── */

async function bootstrap() {
  const profile = restoreProfileFromUrl({
    buildUserMatchProfile,
    deriveStateFromLocation,
    splitCommaSeparated,
  });

  // No params at all → user landed on /results raw. Send them to intake.
  if (!profile) {
    window.location.replace("/match");
    return;
  }

  // CA-only directory (MVP). When no care_state is in the URL,
  // deriveStateFromLocation returns "" because the async zipcodes data
  // isn't loaded here, and the matching engine's hard-constraint filter
  // drops every therapist. Default to CA so scoring runs.
  if (!profile.care_state) profile.care_state = "CA";

  showState("loading");

  let therapists;
  try {
    therapists = await fetchPublicTherapists({ strict: false });
  } catch (err) {
    console.error("results: therapist fetch failed", err);
    renderHeader(profile, 0);
    try {
      window.sessionStorage.removeItem("matchResultsUrl");
    } catch (_e) {
      /* ignore */
    }
    showState("error");
    document.dispatchEvent(
      new CustomEvent("results:rendered", { detail: { count: 0, error: true } }),
    );
    return;
  }

  const entries = rankTherapistsForUser(therapists, profile, null)
    .filter(hasRenderableTherapist)
    .slice(0, PRIMARY_LIMIT);
  renderHeader(profile, entries.length);

  if (!entries.length) {
    try {
      window.sessionStorage.removeItem("matchResultsUrl");
    } catch (_e) {
      /* ignore */
    }
    showState("empty");
    document.dispatchEvent(new CustomEvent("results:rendered", { detail: { count: 0 } }));
    return;
  }

  try {
    window.sessionStorage.setItem("matchResultsUrl", window.location.href);
  } catch (_e) {
    /* ignore */
  }

  const list = document.querySelector("[data-results-list]");
  const cards = list && list.querySelector("[data-results-cards]");
  if (!cards) return;

  const featured = renderFeaturedCard(entries[0], profile);
  const rest = entries.slice(1);
  const gridLabel = rest.length
    ? `<p class="grid-section-label" data-grid-label><span><span data-grid-count>${rest.length}</span> more match${rest.length === 1 ? "" : "es"}</span></p>`
    : "";
  const grid = rest.length
    ? `<div class="results-grid" data-results-grid>${rest.map((e, i) => renderGridCard(e, i + 2, profile)).join("")}</div>`
    : "";

  cards.innerHTML = featured + gridLabel + grid;

  showState("loaded");
  document.dispatchEvent(
    new CustomEvent("results:rendered", { detail: { count: entries.length } }),
  );
}

bootstrap();
