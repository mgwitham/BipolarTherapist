/* global CustomEvent */
// /results page: read URL params → fetch therapists → score → render into
// the design from PR #660. /match keeps working as today; this page is the
// new destination from the homepage form and the /match refine submit.

import "./sentry-init.js";
import "./site-analytics.js";
import { fetchPublicTherapists } from "./cms.js";
import { rankTherapistsForUser, buildUserMatchProfile } from "../shared/matching-model.mjs";
import {
  restoreProfileFromUrl,
  splitCommaSeparated,
  deriveStateFromLocation,
  buildAppliedAnswerPillItems,
} from "./match-intake.js";
import { getCardLocationLabel, getFeeLabel, getInsuranceLabel } from "./card-content.js";
import { escapeHtml } from "./escape-html.js";
import { sanityImageUrl } from "./sanity-image.js";
import { orderMatchEntries } from "./match-ordering.js";
import { preloadZipcodes, getDistanceMilesFromZipToTherapist } from "./zip-lookup.js";

const FEATURED_RANK = 1;
const PRIMARY_LIMIT = 8;

/* ── helpers ─────────────────────────────────────────────── */

function getInitials(name) {
  const parts = String(name || "")
    .replace(/[^A-Za-z\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter(function (w) {
      return !/^(dr|mr|mrs|ms|mx|prof)$/i.test(w);
    });
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
  let distanceMiles = null;
  if (!tele && userZip && therapist.zip) {
    const d = getDistanceMilesFromZipToTherapist(userZip, therapist);
    if (Number.isFinite(d) && d <= 60) distanceMiles = d;
  }
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

function renderAvatar(t, sizeClass) {
  const cls = sizeClass ? `card-avatar ${sizeClass}` : "card-avatar";
  if (t.photo_url) {
    // card-avatar is 48px, card-avatar-sm is 36px; request 2x for retina.
    const px = sizeClass === "card-avatar-sm" ? 36 : 48;
    const src = sanityImageUrl(t.photo_url, { width: px * 2, height: px * 2 });
    // Decorative: the name is always rendered as adjacent text and the
    // initials fallback below is aria-hidden, so an empty alt keeps the
    // screen-reader experience consistent and avoids a redundant
    // name announcement.
    return `<div class="${cls}"><img class="card-avatar-img" src="${escapeHtml(src)}" alt="" width="${px}" height="${px}" loading="lazy" decoding="async" /></div>`;
  }
  return `<div class="${cls}" aria-hidden="true">${escapeHtml(getInitials(t.name))}</div>`;
}

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
    renderAvatar(t) +
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
    renderAvatar(t, "card-avatar-sm") +
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
  const nounEl = document.querySelector("[data-results-match-noun]");
  if (nounEl) nounEl.textContent = count === 1 ? "match" : "matches";

  const filtersEl = document.querySelector("[data-results-filters]");
  if (!filtersEl) return;
  // Build the same applied-answer pills /match uses, then re-style them with
  // our .filter-pill class. Removable pills render as buttons with an ×
  // that drops the filter and re-ranks in place. The Edit button (toggles the
  // inline filter panel) and the Start-new-search link stay at the end.
  const editLink = filtersEl.querySelector(".filter-edit-btn");
  const startNewLink = filtersEl.querySelector(".filter-start-new");
  filtersEl.innerHTML = "";
  const pills = profile ? buildAppliedAnswerPillItems(profile) : [];
  pills.forEach((p) => {
    if (p.removable) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-pill filter-pill-removable";
      btn.setAttribute("data-pill-remove", p.key);
      btn.setAttribute("aria-label", `Remove filter: ${p.label}`);
      btn.innerHTML = `<span>${escapeHtml(p.label)}</span><i class="ti ti-x filter-pill-x" aria-hidden="true"></i>`;
      filtersEl.appendChild(btn);
    } else {
      const span = document.createElement("span");
      span.className = "filter-pill";
      span.textContent = p.label;
      filtersEl.appendChild(span);
    }
  });
  if (editLink) filtersEl.appendChild(editLink);
  if (startNewLink) filtersEl.appendChild(startNewLink);
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

/* ── live filtering ───────────────────────────────────────── */

// Fetched once at bootstrap; filter edits re-rank this list in memory so
// pill removal and panel changes update the page without a reload.
const state = { therapists: null, profile: null };

function readProfileFromLocation() {
  const profile = restoreProfileFromUrl({
    buildUserMatchProfile,
    deriveStateFromLocation,
    splitCommaSeparated,
  });
  // CA-only directory (MVP). When no care_state is in the URL,
  // deriveStateFromLocation returns "" because the async zipcodes data
  // isn't loaded here, and the matching engine's hard-constraint filter
  // drops every therapist. Default to CA so scoring runs.
  if (profile && !profile.care_state) profile.care_state = "CA";
  return profile;
}

// Panel radio values use "" for the neutral option; these normalized
// profile defaults mean the same thing when they arrive via URL params.
const NEUTRAL_PARAM_VALUES = new Set(["Either", "Open to either", "Best overall fit"]);

function mutateUrlParams(mutator) {
  const params = new URLSearchParams(window.location.search);
  mutator(params);
  // Keep the URL restorable: care_state anchors the profile when every
  // other intake param has been removed.
  if (!params.get("care_state")) {
    params.set("care_state", (state.profile && state.profile.care_state) || "CA");
  }
  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
}

function applyFilterChange(mutator, trigger) {
  mutateUrlParams(mutator);
  state.profile = readProfileFromLocation();
  syncPanelFields();
  if (!state.therapists) {
    // Fetch failed earlier; keep the header honest but stay on the
    // error state — there is nothing to re-rank.
    renderHeader(state.profile, 0);
    return;
  }
  renderResults({ rerender: true, trigger });
}

function removeFilterPill(key) {
  applyFilterChange((params) => {
    params.delete(key);
  }, "pill_remove");
}

function getPanel() {
  return document.querySelector("[data-results-filter-panel]");
}

function syncPanelFields() {
  const panel = getPanel();
  if (!panel) return;
  const params = new URLSearchParams(window.location.search);
  panel.querySelectorAll("[data-rf-field]").forEach((input) => {
    const key = input.getAttribute("data-rf-field");
    const raw = params.get(key) || "";
    const value = NEUTRAL_PARAM_VALUES.has(raw) ? "" : raw;
    if (input.type === "radio") {
      input.checked = input.value === value;
    } else {
      // Don't yank the caret while the user is typing in this field.
      if (document.activeElement !== input) input.value = value;
    }
  });
}

function setPanelOpen(open) {
  const panel = getPanel();
  const editBtn = document.querySelector("[data-results-edit]");
  if (!panel) return;
  panel.hidden = !open;
  if (editBtn) editBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) syncPanelFields();
}

function isZipApplyable(value) {
  return value === "" || /^\d{5}$/.test(value);
}

function initFilterControls() {
  const panel = getPanel();
  const editBtn = document.querySelector("[data-results-edit]");

  if (editBtn) {
    editBtn.addEventListener("click", () => {
      setPanelOpen(panel ? panel.hidden : false);
    });
  }

  document.addEventListener("click", (event) => {
    const pill = event.target.closest("[data-pill-remove]");
    if (pill) {
      removeFilterPill(pill.getAttribute("data-pill-remove"));
      // The pill list is rebuilt, so park focus on the Edit button to
      // keep keyboard users in the filter row.
      if (editBtn) editBtn.focus();
      return;
    }
    const opener = event.target.closest("[data-results-edit-open]");
    if (opener) {
      setPanelOpen(true);
      const header = document.querySelector(".results-header");
      if (header && typeof header.scrollIntoView === "function") {
        header.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      const firstField = panel && panel.querySelector("[data-rf-field]");
      if (firstField) firstField.focus({ preventScroll: true });
    }
  });

  if (!panel) return;

  const closeBtn = panel.querySelector("[data-rf-close]");
  if (closeBtn) closeBtn.addEventListener("click", () => setPanelOpen(false));
  panel.addEventListener("submit", (event) => event.preventDefault());

  function applyField(key, rawValue) {
    const value = String(rawValue || "").trim();
    applyFilterChange((params) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }, "filter_panel");
  }

  panel.addEventListener("change", (event) => {
    const input = event.target.closest("[data-rf-field]");
    if (!input) return;
    const key = input.getAttribute("data-rf-field");
    if (input.type === "radio") {
      if (!input.checked) return;
      applyField(key, input.value);
      return;
    }
    const value = String(input.value || "").trim();
    if (key === "location_query" && !isZipApplyable(value)) return;
    applyField(key, value);
  });

  // Text fields also apply live while typing (debounced), so the results
  // move as soon as a ZIP is complete or an insurance name takes shape.
  let debounceTimer = null;
  panel.addEventListener("input", (event) => {
    const input = event.target.closest("[data-rf-field]");
    if (!input || input.type === "radio") return;
    const key = input.getAttribute("data-rf-field");
    const value = String(input.value || "").trim();
    if (key === "location_query" && !isZipApplyable(value)) return;
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if ((params.get(key) || "") === value) return;
      applyField(key, value);
    }, 350);
  });
}

/* ── orchestrator ─────────────────────────────────────────── */

function renderResults(meta) {
  const profile = state.profile;
  // Rank by care fit, then apply the same ZIP-aware proximity ordering /match
  // uses (assets/match-ordering.js): a strong local boost + 60mi cutoff for
  // In-Person, a light nudge for "Either", and distance-agnostic for
  // Telehealth. Depends on the zipcode data preloaded in bootstrap().
  const ranked = rankTherapistsForUser(state.therapists, profile, null).filter(
    hasRenderableTherapist,
  );
  const entries = orderMatchEntries(ranked, {
    locationQuery: profile && profile.location_query,
    careFormat: profile && profile.care_format,
  }).slice(0, PRIMARY_LIMIT);
  renderHeader(profile, entries.length);

  const detail = Object.assign({ count: entries.length }, meta || {});

  if (!entries.length) {
    try {
      window.sessionStorage.removeItem("matchResultsUrl");
    } catch (_e) {
      /* ignore */
    }
    showState("empty");
    document.dispatchEvent(new CustomEvent("results:rendered", { detail }));
    return;
  }

  try {
    window.sessionStorage.setItem("matchResultsUrl", window.location.href);
    // Timestamp drives the 24h expiry of the "Your matches" nav link (nav.js).
    window.sessionStorage.setItem("matchResultsAt", String(Date.now()));
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
  document.dispatchEvent(new CustomEvent("results:rendered", { detail }));
}

async function bootstrap() {
  state.profile = readProfileFromLocation();

  // No params at all → user landed on /results raw (stale/shared/edited link).
  // Send them to the intake form, which is the homepage hero. (An earlier
  // version aimed at /match?mode=form, but vercel.json server-redirects any
  // /match without a `shortlist` param straight to "/", so that was just an
  // extra hop to the same place. Go directly to "/".)
  if (!state.profile) {
    window.location.replace("/");
    return;
  }

  initFilterControls();
  syncPanelFields();
  showState("loading");

  // Load ZIP → lat/lng data in parallel with the therapist fetch so the first
  // render can rank by proximity (orderMatchEntries) and show distances. Failure
  // is non-fatal: without it, distance resolves to Infinity and ordering falls
  // back to pure care-fit order.
  const zipcodesReady = preloadZipcodes().catch(function () {});

  let therapists;
  try {
    therapists = await fetchPublicTherapists({ strict: false });
  } catch (err) {
    console.error("results: therapist fetch failed", err);
    renderHeader(state.profile, 0);
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

  state.therapists = therapists;
  await zipcodesReady;
  renderResults();
}

bootstrap();
