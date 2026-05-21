import "./sentry-init.js";
import { escapeHtml as esc } from "./escape-html.js";
import { getOutreachTemplate } from "../shared/outreach-templates.mjs";
import { initAdminProfileSearch } from "./admin-profile-search.js";
import {
  openTherapistEditDrawer,
  closeCandidateEditDrawer,
  bindCandidateEditDrawer,
} from "./admin-candidate-edit.js";
import { mountEditDrawer } from "./edit-drawer-shell.js";

const API = "/api/admin";

// ---- STATE ----

const state = {
  therapists: [],
  // view: which tab is active. "outreach" = cold-outreach CRM (default),
  // "live" = therapists who have claimed and are published, different
  // segment, different future messaging, not part of the cold queue.
  view: "outreach",
  // includeDone: terminal statuses (claimed/paid/replied/bounced/opted_out)
  // are hidden from the outreach queue by default so the working list
  // stays focused on people who can still convert. Toggle reveals them.
  filters: {
    status: "",
    state: "CA",
    search: "",
    followUpDue: false,
    includeDone: false,
    // engagement: "" (all) | "engaged" | "quiet" | "recent"
    engagement: "",
  },
  // Insights expander (Subject Performance + Patient Signal) collapsed
  // by default so the page leads with the queue, not the analytics.
  insightsOpen: false,
  // Bulk-select for batch email send. IDs only, the row objects live
  // in state.therapists. Cleared on tab switch or after a send.
  selected: new Set(),
  // Outreach-link click events from the funnel log, indexed by slug
  // for O(1) lookup when computing Subject Performance click rates.
  outreachClicksBySlug: new Map(),
  // Last-used campaign tag, remembered across sends within a session
  // so the operator doesn't retype it for back-to-back batches.
  lastCampaign: "",
  // True while a sendBatch loop is running. Guards against the 2026-05-15
  // incident where two batches got kicked off in parallel and interleaved
  // their POSTs, producing 30+ duplicate sends. openBatchComposer refuses
  // to open a new composer while this is true.
  batchInFlight: false,
  liveFilters: { search: "" },
  // Sort: which column + direction. Last contact desc mirrors the API
  // query's default and is the most useful first view.
  sort: { column: "lastContactedAt", direction: "desc" },
  liveSort: { column: "claimedAt", direction: "desc" },
  selectedId: null,
  patientSignal: null, // { matchRequests, profileViews, ctaClicks, generatedAt }
};

// A therapist is "live" when they've claimed (either via outreach
// status or the signup flow that stamps claimedAt) AND are actually
// visible to patients (listingActive). Ingested-but-unclaimed records
// don't count, Live is about people who chose to be on the platform.
function isLive(t) {
  const status = t.outreach?.status;
  const claimed = ["claimed", "paid"].includes(status) || Boolean(t.claimedAt);
  return claimed && t.listingActive === true;
}

// ---- UTILS ----

function relTime(dateStr) {
  if (!dateStr) return "";
  const time = new Date(dateStr).getTime();
  if (!Number.isFinite(time)) return "";
  const diff = Date.now() - time;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function safeExternalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function safeProfileUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return safeExternalUrl(raw);
}

function getContactFormUrl(t) {
  return safeExternalUrl((t && (t.website || t.sourceUrl)) || "");
}

// Detect a Psychology Today profile URL. PT is a major outreach
// channel for therapists who don't expose a direct email, so we treat
// it as a first-class signal: the row gets a PT badge, and "Outreach
// via PT" step-throughs target only these rows.
function getPTProfileUrl(t) {
  const candidates = [t?.sourceUrl, t?.website].map((v) => safeExternalUrl(v || ""));
  return candidates.find((u) => /(^|\.)psychologytoday\.com\//i.test(u)) || "";
}

// Open a Google search scoped to psychologytoday.com so the user can
// find a missing PT profile by name + license_state + city. No PT
// requests come from us, the user clicks the result.
function getPTSearchUrl(t) {
  const parts = [t?.name, t?.city, t?.state || t?.licenseState, "psychology today"].filter(Boolean);
  const q = encodeURIComponent(parts.join(" "));
  return `https://www.google.com/search?q=${q}+site%3Apsychologytoday.com`;
}

function therapistPath(id) {
  return `/therapist/${encodeURIComponent(String(id || ""))}`;
}

const STATUS_LABELS = {
  not_contacted: "Not contacted",
  email_1_sent: "Email 1 sent",
  followed_up: "Followed up",
  profile_gap_sent: "Profile gap sent",
  replied: "Replied",
  bounced: "Bounced",
  claimed: "Claimed",
  paid: "Paid",
  opted_out: "Opted out",
};

const STATUS_STYLES = {
  not_contacted: "background:#f3f4f6;color:#6b7280;border:1px solid #d1d5db;",
  email_1_sent: "background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;",
  followed_up: "background:#fffbeb;color:#b45309;border:1px solid #fcd34d;",
  profile_gap_sent: "background:#fdf4ff;color:#86198f;border:1px solid #f0abfc;",
  replied: "background:#f5f3ff;color:#5b21b6;border:1px solid #c4b5fd;",
  bounced:
    "background:#f3f4f6;color:#374151;border:1px solid #9ca3af;text-decoration:line-through;",
  claimed: "background:#e8f3f6;color:#2a5f6e;border:1px solid #a5d0db;",
  paid: "background:#ecfdf5;color:#065f46;border:1px solid #6ee7b7;",
  opted_out: "background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;",
};

// Statuses that mean we should NOT keep emailing this person.
const TERMINAL_STATUSES = new Set(["replied", "bounced", "claimed", "paid", "opted_out"]);

function pill(status) {
  const s = status || "not_contacted";
  const style = STATUS_STYLES[s] || STATUS_STYLES.not_contacted;
  return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:500;white-space:nowrap;${style}">${STATUS_LABELS[s] || s}</span>`;
}

function isFollowUpDue(t) {
  if ((t.outreach?.status || "not_contacted") !== "email_1_sent") return false;
  const last = t.outreach?.lastContactedAt;
  return last && Date.now() - new Date(last).getTime() >= 7 * 24 * 60 * 60 * 1000;
}

// Open tracking went live when the Resend tracking subdomain was
// verified (2026-05-15). Sends before this date were transmitted
// without the open-tracking pixel, so even a real open today won't
// fire the webhook, there's no signal to recover. Mark them
// "untracked" so the engagement trail doesn't render misleading
// hollow dots for sends we'll never have data on.
const OPEN_TRACKING_ENABLED_AT = "2026-05-15T00:00:00Z";

// Classify an emailLog entry's open state for the engagement trail.
// "opened"  , Resend webhook stamped openedAt
// "unopened", Resend-tracked send, no open yet
// "untracked", sent via contact form / PT, OR sent before open
//               tracking was enabled (no pixel embedded, blind by
//               design). The trail renderer drops untracked entries.
function openState(entry) {
  if (!entry) return "untracked";
  const tmpl = String(entry.template || "");
  if (tmpl.endsWith("_via_form")) return "untracked";
  if (entry.sentAt && entry.sentAt < OPEN_TRACKING_ENABLED_AT) return "untracked";
  return entry.openedAt ? "opened" : "unopened";
}

function hasAnyOpen(t) {
  const log = Array.isArray(t.outreach?.emailLog) ? t.outreach.emailLog : [];
  return log.some((e) => openState(e) === "opened");
}

function hasAnyTrackedSend(t) {
  const log = Array.isArray(t.outreach?.emailLog) ? t.outreach.emailLog : [];
  return log.some((e) => openState(e) !== "untracked");
}

function openedLatest(t) {
  const log = Array.isArray(t.outreach?.emailLog) ? t.outreach.emailLog : [];
  if (log.length === 0) return false;
  return openState(log[log.length - 1]) === "opened";
}

// Renders the open-trail for a therapist as a row of colored dots.
// Only tracked sends (Resend direct) get a dot, form / PT sends are
// blind to open tracking so we drop them entirely. The Status pill
// + Last contact column still communicate "we did reach out via PT,"
// just without a misleading neutral dot on the engagement trail.
function engagementTrailHtml(t) {
  const log = Array.isArray(t.outreach?.emailLog) ? t.outreach.emailLog : [];
  const tracked = log.filter((e) => openState(e) !== "untracked");
  if (tracked.length === 0) {
    return `<span style="color:#9ca3af;font-size:11px;">, </span>`;
  }
  const dots = tracked
    .map((e, i) => {
      const state = openState(e);
      const subj = String(e.subject || "(no subject)").replace(/"/g, "&quot;");
      const when = e.sentAt ? new Date(e.sentAt).toLocaleString() : "";
      const stateLabel =
        state === "opened"
          ? `opened ${e.openedAt ? new Date(e.openedAt).toLocaleString() : ""}`
          : "not opened";
      const title = `Email ${i + 1}: ${subj} · sent ${when} · ${stateLabel}`;
      const fill = state === "opened" ? "#059669" : "transparent";
      const border = state === "opened" ? "#059669" : "#9ca3af";
      return `<span title="${esc(title)}" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${fill};border:1.5px solid ${border};margin-right:3px;vertical-align:middle;"></span>`;
    })
    .join("");
  return `<span>${dots}</span>`;
}

// ---- TOAST ----

function toast(msg, type = "success") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ---- API ----

async function apiPost(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function apiGet(path, params = {}) {
  const filtered = Object.entries(params).filter(([, v]) => v != null && v !== "");
  const q = new URLSearchParams(filtered).toString();
  const r = await fetch(`${API}${path}${q ? "?" + q : ""}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const data = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data };
}

async function apiPatch(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// ---- FILTERS ----

function applyFilters() {
  const { status, state: stateF, search, followUpDue, includeDone, engagement } = state.filters;
  const filtered = state.therapists.filter((t) => {
    const s = t.outreach?.status || "not_contacted";
    // Hide terminal statuses by default so claimed/paid/replied/bounced
    // therapists don't clutter the working queue. Explicit status pick
    // overrides the gate so "filter to Claimed" still works.
    //
    // A therapist who claimed via the portal/signup flow gets claimedAt
    // stamped on the doc, but that flow does NOT rewrite outreach.status
    // (it can stay "email_1_sent"). So claimedAt is the source of truth
    // for "they're in now" — mirror the Live-tab definition (isLive) and
    // treat any claimedAt as terminal here, or claimed therapists keep
    // showing in the cold queue after they've already joined.
    const hasClaimed = Boolean(t.claimedAt) || t.claimStatus === "claimed";
    if (!includeDone && !status && (TERMINAL_STATUSES.has(s) || hasClaimed)) return false;
    if (status && s !== status) return false;
    if (stateF && t.state !== stateF) return false;
    if (followUpDue && !isFollowUpDue(t)) return false;
    if (engagement === "engaged" && !hasAnyOpen(t)) return false;
    if (engagement === "quiet" && (!hasAnyTrackedSend(t) || hasAnyOpen(t))) return false;
    if (engagement === "recent" && !openedLatest(t)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(t.name || "").toLowerCase().includes(q) && !(t.email || "").toLowerCase().includes(q))
        return false;
    }
    return true;
  });
  return applySort(filtered);
}

function applyLiveFilters() {
  const { search } = state.liveFilters;
  const filtered = state.therapists.filter((t) => {
    if (!isLive(t)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(t.name || "").toLowerCase().includes(q) && !(t.email || "").toLowerCase().includes(q))
        return false;
    }
    return true;
  });
  return applyLiveSort(filtered);
}

function applyLiveSort(list) {
  const { column, direction } = state.liveSort || {};
  if (!column) return list;
  const dir = direction === "asc" ? 1 : -1;
  const sorted = [...list];
  if (column === "claimedAt") {
    sorted.sort((a, b) => {
      const aT = a.claimedAt ? new Date(a.claimedAt).getTime() : 0;
      const bT = b.claimedAt ? new Date(b.claimedAt).getTime() : 0;
      return (aT - bT) * dir;
    });
  } else if (column === "name") {
    sorted.sort((a, b) => (a.name || "").localeCompare(b.name || "") * dir);
  } else if (column === "status") {
    sorted.sort((a, b) => (statusRank(a.outreach?.status) - statusRank(b.outreach?.status)) * dir);
  }
  return sorted;
}

// Canonical status ordering, funnel progression rather than alpha.
// "Not contacted" first, terminal/negative states last. Sort by index
// in this list when the user picks the Status column.
const STATUS_ORDER = [
  "not_contacted",
  "email_1_sent",
  "followed_up",
  "profile_gap_sent",
  "replied",
  "claimed",
  "paid",
  "bounced",
  "opted_out",
];

function statusRank(s) {
  const i = STATUS_ORDER.indexOf(s || "not_contacted");
  return i === -1 ? STATUS_ORDER.length : i;
}

function applySort(list) {
  const { column, direction } = state.sort || {};
  if (!column) return list;
  const dir = direction === "asc" ? 1 : -1;
  const sorted = [...list];
  if (column === "status") {
    sorted.sort((a, b) => {
      const diff = statusRank(a.outreach?.status) - statusRank(b.outreach?.status);
      return diff * dir;
    });
  } else if (column === "lastContactedAt") {
    sorted.sort((a, b) => {
      const at = new Date(a.outreach?.lastContactedAt || 0).getTime() || 0;
      const bt = new Date(b.outreach?.lastContactedAt || 0).getTime() || 0;
      return (at - bt) * dir;
    });
  }
  return sorted;
}

// ---- STATS ----

function computeStats(list) {
  const total = list.length;
  const contacted = list.filter((t) =>
    ["email_1_sent", "followed_up", "profile_gap_sent", "replied", "claimed", "paid"].includes(
      t.outreach?.status,
    ),
  ).length;
  const replied = list.filter((t) =>
    ["replied", "claimed", "paid"].includes(t.outreach?.status),
  ).length;
  const claimed = list.filter((t) => ["claimed", "paid"].includes(t.outreach?.status)).length;
  // Reply rate is the meaningful early signal, claim rate stays low for
  // a while even on healthy outreach. Bounced + opted_out are excluded
  // from the denominator so we measure response from people who actually
  // received the email.
  const replyRate = contacted > 0 ? Math.round((replied / contacted) * 100) : 0;
  return { total, contacted, replied, claimed, replyRate };
}

// Group every therapist's most recent email_1 send by subject line and
// compute open/reply rate per subject. Lets the operator see which
// subject is actually working instead of staring at one overall reply
// rate that mixes every variant together.
//
// Attribution rules:
//   - Only `email_1` template sends count (not follow_up, not _via_form,
//     not webhook bounce/complaint entries).
//   - Each therapist is bucketed by the LATEST email_1 they received.
//   - openedAt on the bucketed entry counts as an open.
//   - The therapist's overall outreach.status (replied/claimed/paid)
//     counts as a reply for that subject's bucket.
function computeSubjectPerformance(list) {
  const buckets = new Map();
  const clicksBySlug = state.outreachClicksBySlug || new Map();
  for (const t of list) {
    const log = Array.isArray(t.outreach?.emailLog) ? t.outreach.emailLog : [];
    // Count both Resend-direct (email_1) and contact-form (email_1_via_form)
    // initial sends. The latest of either is the bucket the therapist
    // belongs to. PT/contact-form clicks land in the same funnel
    // because we pass the same profile URL convention to both.
    const initialSends = log.filter(
      (e) => e?.template === "email_1" || e?.template === "email_1_via_form",
    );
    if (initialSends.length === 0) continue;
    const latest = initialSends[initialSends.length - 1];
    const subject = (latest.subject || "").trim() || "(no subject)";
    const campaign = (latest.campaign || "").trim() || "(no campaign)";
    const key = subject + " " + campaign;
    if (!buckets.has(key)) {
      buckets.set(key, {
        subject,
        campaign,
        sent: 0,
        opened: 0,
        clicked: 0,
        claimed: 0,
      });
    }
    const b = buckets.get(key);
    b.sent += 1;
    if (latest.openedAt) b.opened += 1;
    // Click counts when a funnel "outreach_profile_viewed" event
    // landed on this therapist's slug AFTER the email was sent.
    const slug = t.slug?.current || t.slug || "";
    const clicks = clicksBySlug.get(slug);
    if (clicks && latest.sentAt && clicks.some((vAt) => vAt >= latest.sentAt)) {
      b.clicked += 1;
    }
    if (["claimed", "paid"].includes(t.outreach?.status)) b.claimed += 1;
  }
  return Array.from(buckets.values())
    .filter((b) => !LEGACY_SUBJECT_RE.test(b.subject))
    .map((b) => ({
      ...b,
      openRate: b.sent > 0 ? Math.round((b.opened / b.sent) * 100) : 0,
      clickRate: b.sent > 0 ? Math.round((b.clicked / b.sent) * 100) : 0,
      claimRate: b.sent > 0 ? Math.round((b.claimed / b.sent) * 100) : 0,
    }))
    .sort((a, b) => b.sent - a.sent);
}

// Legacy city-based subject from an early discovery test run. Hidden
// from the leaderboard so it stops crowding out subjects we're actually
// iterating on. Pattern: "Patients in [City] are searching for bipolar
// specialists" (one row per city).
const LEGACY_SUBJECT_RE = /^Patients in .+ are searching for bipolar specialists$/i;

// ---- AUTH GATE ----
// CRM reuses the existing review-API admin session (cookie: bt_admin_session).
// If the session is missing/expired, send the user to /admin.html to sign in,
// then they come back here.

function redirectToAdminLogin() {
  window.location.href = "/admin";
}

// ---- DASHBOARD SHELL ----

function renderDashboard() {
  const tabs = `
    <div style="padding:0 24px;border-bottom:1px solid #e5e7eb;background:#fff;flex-shrink:0;">
      <div style="display:flex;gap:4px;">
        ${tabButton("outreach", "Outreach")}
        ${tabButton("live", "Live therapists")}
      </div>
    </div>
  `;

  const header = `
    <div style="background:#2a5f6e;color:#fff;height:52px;padding:0 24px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
      <span style="font-size:15px;font-weight:700;letter-spacing:-0.3px;">Outreach CRM</span>
      <div style="display:flex;align-items:center;gap:8px;">
        <a href="/admin" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.4);border-radius:6px;padding:4px 12px;font-size:13px;font-weight:500;text-decoration:none;display:inline-flex;align-items:center;gap:4px;" title="Open the admin page">Admin →</a>
        <button id="logout-btn" style="background:rgba(255,255,255,0.15);color:#fff;border:none;border-radius:6px;padding:5px 13px;font-size:13px;">Log out</button>
      </div>
    </div>
  `;

  const overlays = `
    <div id="panel-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:199;opacity:0;pointer-events:none;transition:opacity 0.2s;"></div>
    <div id="detail-panel" style="position:fixed;top:0;right:0;width:480px;max-width:100vw;height:100%;background:#fff;box-shadow:-4px 0 24px rgba(0,0,0,0.12);z-index:200;transform:translateX(100%);transition:transform 0.25s ease;overflow-y:auto;"></div>
  `;

  const body = state.view === "live" ? renderLiveView() : renderOutreachView();

  document.getElementById("app").innerHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column;">
      ${header}
      ${tabs}
      ${body}
    </div>
    ${overlays}
  `;

  document.querySelectorAll("[data-tab-target]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-tab-target");
      if (target && target !== state.view) {
        // Clear bulk selection on tab switch so a stale selection from
        // the Outreach tab doesn't ride along into the Live tab and
        // resurface if the user toggles back.
        state.selected.clear();
        state.view = target;
        renderDashboard();
        renderBulkActionBar();
      }
    }),
  );

  if (state.view === "live") {
    refreshLiveTable();
    setupLiveListeners();
  } else {
    refreshTable();
    setupDashboardListeners();
    // Patient signal loads asynchronously so it doesn't block the table.
    // Reuses cached value while fetching to avoid flash of empty state on
    // re-render (e.g. after a status save).
    loadAndRenderPatientSignal();
  }
  initProfileSearchWidget();
}

function tabButton(target, label) {
  const active = state.view === target;
  const style = active
    ? "border-bottom:2px solid #2a5f6e;color:#2a5f6e;font-weight:600;"
    : "border-bottom:2px solid transparent;color:#6b7280;font-weight:500;";
  return `<button data-tab-target="${target}" style="background:none;border:none;padding:12px 16px;font-size:14px;cursor:pointer;${style}">${label}</button>`;
}

function renderOutreachView() {
  const stats = computeStats(state.therapists);
  const insightsOpen = state.insightsOpen;
  return `
    <div style="padding:10px 24px 0;flex-shrink:0;">
      <div id="profileSearchWidget" class="ps-widget-root" style="padding:0;"></div>
    </div>

    <div style="padding:10px 24px 0;flex-shrink:0;">
      <div style="display:flex;gap:10px;">
        ${statCard("Total", stats.total, "#2a5f6e")}
        ${statCard("Contacted", stats.contacted, "#3b82f6")}
        ${statCard("Replied", stats.replied, "#7c3aed")}
        ${statCard("Reply rate", stats.replyRate + "%", "#f59e0b")}
        ${statCardLink("go-live-tab", "Claimed (Live tab)", stats.claimed, "#2a5f6e")}
      </div>
    </div>

    <div style="display:flex;gap:10px;align-items:center;padding:12px 24px;flex-shrink:0;flex-wrap:wrap;border-bottom:1px solid #e5e7eb;">
      <select id="f-status" class="form-input" style="width:160px;">
        <option value="">Active only</option>
        ${Object.entries(STATUS_LABELS)
          .map(
            ([v, l]) =>
              `<option value="${v}" ${state.filters.status === v ? "selected" : ""}>${l}</option>`,
          )
          .join("")}
      </select>
      <select id="f-state" class="form-input" style="width:90px;">
        <option value="">All states</option>
        <option value="CA" ${state.filters.state === "CA" ? "selected" : ""}>CA</option>
      </select>
      <input id="f-search" type="search" class="form-input" style="width:200px;" placeholder="Search name or email…" value="${esc(state.filters.search)}" />
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#374151;cursor:pointer;white-space:nowrap;">
        <input id="f-followup" type="checkbox" ${state.filters.followUpDue ? "checked" : ""} />
        Follow-up due
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#374151;cursor:pointer;white-space:nowrap;" title="Show claimed, paid, replied, bounced, and opted-out therapists">
        <input id="f-includedone" type="checkbox" ${state.filters.includeDone ? "checked" : ""} />
        Include done
      </label>
      <select id="f-engagement" class="form-input" style="width:170px;" title="Filter by open behavior across all sends to each therapist">
        <option value="" ${!state.filters.engagement ? "selected" : ""}>All engagement</option>
        <option value="engaged" ${state.filters.engagement === "engaged" ? "selected" : ""}>Engaged (opened any)</option>
        <option value="quiet" ${state.filters.engagement === "quiet" ? "selected" : ""}>Quiet (never opened)</option>
        <option value="recent" ${state.filters.engagement === "recent" ? "selected" : ""}>Opened most recent</option>
      </select>
      <span id="result-count" style="margin-left:auto;font-size:13px;color:#6b7280;"></span>
    </div>

    <div style="padding:10px 24px 0;flex-shrink:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <button id="insights-toggle" type="button" style="background:none;border:none;padding:4px 0;cursor:pointer;font-size:11px;font-weight:600;color:#6b7280;letter-spacing:0.5px;text-transform:uppercase;display:flex;align-items:center;gap:6px;">
          <span>${insightsOpen ? "▾" : "▸"}</span>
          <span>Insights</span>
          <span style="font-size:10px;font-weight:500;color:#9ca3af;text-transform:none;letter-spacing:0;">subject performance + patient signal</span>
        </button>
        <span id="demand-chip" style="font-size:12px;">${demandChipHtml(state.patientSignal)}</span>
      </div>
      <div id="insights-body" style="${insightsOpen ? "" : "display:none;"}margin-top:8px;">
        ${subjectPerformanceHtml(computeSubjectPerformance(state.therapists))}
        <div style="padding:10px 0 0;">
          <div style="font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:baseline;gap:8px;">
            <span>Patient signal (last 30 days)</span>
            <span id="patient-signal-trend" style="font-size:10px;font-weight:500;color:#6b7280;text-transform:none;letter-spacing:0;"></span>
          </div>
          <div id="patient-signal-row" style="display:flex;gap:10px;">
            ${patientSignalCardsHtml(state.patientSignal)}
          </div>
        </div>
      </div>
    </div>

    <div style="flex:1;padding:0 24px 24px;" id="table-container"></div>
  `;
}

function renderLiveView() {
  const live = state.therapists.filter(isLive);
  const total = live.length;
  const fromOutreach = live.filter((t) => ["claimed", "paid"].includes(t.outreach?.status)).length;
  const direct = total - fromOutreach;
  const paid = live.filter((t) => t.outreach?.status === "paid").length;

  return `
    <div style="padding:14px 24px 0;flex-shrink:0;">
      <div id="profileSearchWidget" class="ps-widget-root" style="padding:0;"></div>
    </div>

    <div style="padding:14px 24px 0;flex-shrink:0;">
      <div style="font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">
        Live therapists (claimed + published)
      </div>
      <div style="display:flex;gap:14px;">
        ${statCard("Live", total, "#2a5f6e")}
        ${statCard("Claimed via outreach", fromOutreach, "#3b82f6")}
        ${statCard("Direct signup", direct, "#7c3aed")}
        ${statCard("Paid", paid, "#059669")}
      </div>
    </div>

    <div style="display:flex;gap:10px;align-items:center;padding:14px 24px;flex-shrink:0;flex-wrap:wrap;border-bottom:1px solid #e5e7eb;">
      <input id="live-search" type="search" class="form-input" style="width:240px;" placeholder="Search name or email…" value="${esc(state.liveFilters.search)}" />
      <span id="live-result-count" style="margin-left:auto;font-size:13px;color:#6b7280;"></span>
    </div>

    <div style="flex:1;padding:0 24px 24px;" id="live-table-container"></div>
  `;
}

function refreshLiveTable() {
  const filtered = applyLiveFilters();
  const container = document.getElementById("live-table-container");
  const countEl = document.getElementById("live-result-count");
  if (countEl)
    countEl.textContent = `${filtered.length} therapist${filtered.length !== 1 ? "s" : ""}`;
  if (!container) return;

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:48px;color:#6b7280;">No live therapists match the current filters.</div>`;
    return;
  }

  const rows = filtered
    .map((t) => {
      const status = t.outreach?.status || "not_contacted";
      const channel = ["claimed", "paid"].includes(status) ? "outreach" : "direct";
      const channelPill =
        channel === "outreach"
          ? `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:500;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;">Outreach</span>`
          : `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:500;background:#f5f3ff;color:#5b21b6;border:1px solid #c4b5fd;">Direct signup</span>`;
      const profileUrl = safeProfileUrl(t.profileUrl);
      const claimedDisplay = t.claimedAt ? relTime(t.claimedAt) : "-";
      return `<tr data-id="${esc(t._id)}" style="cursor:pointer;">
      <td style="padding:11px 14px;font-weight:500;">${esc(t.name || "-")}</td>
      <td style="padding:11px 14px;color:#6b7280;">${esc(t.email || "-")}</td>
      <td style="padding:11px 14px;color:#6b7280;">${esc(t.city || "-")}</td>
      <td style="padding:11px 14px;">${channelPill}</td>
      <td style="padding:11px 14px;">${pill(status)}</td>
      <td style="padding:11px 14px;color:#6b7280;">${claimedDisplay}</td>
      <td style="padding:11px 14px;white-space:nowrap;">
        <button class="live-email-btn btn-secondary" data-id="${esc(t._id)}" style="margin-right:6px;color:#2a5f6e;border-color:#2a5f6e;">Email</button>
        <button class="live-edit-btn btn-secondary" data-id="${esc(t._id)}" style="margin-right:6px;">Edit</button>
        ${profileUrl ? `<a class="profile-link" href="${esc(profileUrl)}" target="_blank" rel="noopener" data-no-row-click style="display:inline-block;padding:4px 10px;border:1px solid #d1d5db;border-radius:6px;color:#2a5f6e;font-size:12px;text-decoration:none;">View ↗</a>` : ""}
      </td>
    </tr>`;
    })
    .join("");

  const headers = [
    { label: "Name", sortKey: "name" },
    { label: "Email" },
    { label: "City" },
    { label: "Signup channel" },
    { label: "Status", sortKey: "status" },
    { label: "Claimed", sortKey: "claimedAt" },
    { label: "Actions" },
  ];
  const { column: activeSort, direction: activeDir } = state.liveSort || {};
  const arrow = (key) => {
    if (!key || key !== activeSort) return "";
    return activeDir === "asc" ? " ▲" : " ▼";
  };
  const headerHtml = headers
    .map((h) => {
      const clickable = h.sortKey
        ? `cursor:pointer;user-select:none;${h.sortKey === activeSort ? "color:#2a5f6e;" : ""}`
        : "";
      const attr = h.sortKey ? `data-sort-key="${h.sortKey}"` : "";
      return `<th ${attr} style="padding:9px 14px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;${clickable}">${h.label}${arrow(h.sortKey)}</th>`;
    })
    .join("");

  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-top:14px;">
      <thead>
        <tr id="live-thead-row" style="background:#f9fafb;border-bottom:1px solid #e5e7eb;">
          ${headerHtml}
        </tr>
      </thead>
      <tbody id="live-tbody" style="border-top:none;">${rows}</tbody>
    </table>
  `;

  document.getElementById("live-tbody").addEventListener("click", handleLiveTableClick);
  document.getElementById("live-thead-row").addEventListener("click", handleLiveHeaderSortClick);
}

function handleLiveHeaderSortClick(e) {
  const th = e.target.closest("th[data-sort-key]");
  if (!th) return;
  const key = th.dataset.sortKey;
  if (state.liveSort.column === key) {
    state.liveSort.direction = state.liveSort.direction === "asc" ? "desc" : "asc";
  } else {
    state.liveSort.column = key;
    state.liveSort.direction = key === "claimedAt" ? "desc" : "asc";
  }
  refreshLiveTable();
}

function handleLiveTableClick(e) {
  if (e.target.closest("[data-no-row-click]")) return;

  const editBtn = e.target.closest(".live-edit-btn");
  const emailBtn = e.target.closest(".live-email-btn");
  const row = e.target.closest("tr[data-id]");
  const id = editBtn?.dataset.id || emailBtn?.dataset.id || row?.dataset.id;
  if (!id) return;
  if (e.target.closest("button") && !editBtn && !emailBtn) return;

  const t = state.therapists.find((x) => x._id === id);
  if (!t) return;

  if (editBtn) {
    openOutreachEditDrawer(t);
    return;
  }
  openPanel(t);
}

function setupLiveListeners() {
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await fetch("/api/review/admin/session", { method: "DELETE", credentials: "same-origin" });
    redirectToAdminLogin();
  });

  document.getElementById("live-search")?.addEventListener("input", (e) => {
    state.liveFilters.search = e.target.value;
    refreshLiveTable();
  });

  document.getElementById("panel-overlay")?.addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Drawer close/confirm-modal close are wired inside the shared
    // drawer module. Just handle the small detail panel here.
    const drawerOpen = document
      .getElementById("candidateEditDrawer")
      ?.classList.contains("is-open");
    if (drawerOpen) {
      closeCandidateEditDrawer();
    } else {
      closePanel();
    }
  });
}

// Reuses the admin Find-profile widget so the outreach page can jump
// straight to any therapist without scrolling the filtered table.
// Outreach has no candidates or applications in scope, so the kind-
// dependent feeders are stub-empty; only the therapist list is searched.
function initProfileSearchWidget() {
  initAdminProfileSearch({
    getCandidates: () => [],
    getApplications: () => [],
    getTherapists: () => state.therapists,
    onSelect: (result) => {
      if (result.kind !== "therapist") return;
      const t = state.therapists.find(
        (x) => (x._id || x.id) === (result.record._id || result.record.id),
      );
      if (!t) return;
      openPanel(t);
    },
  });
}

// ---- BULK SEND ----

// Sticky bar at the bottom of the page. Appears when ≥1 row is
// selected; disappears at zero. Lives in its own root element so the
// table doesn't have to rerender to show/hide it.
function renderBulkActionBar() {
  let bar = document.getElementById("bulk-action-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "bulk-action-bar";
    bar.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:24px",
      "transform:translateX(-50%)",
      "background:#111827",
      "color:#fff",
      "padding:10px 14px",
      "border-radius:10px",
      "box-shadow:0 12px 32px rgba(0,0,0,0.25)",
      "display:none",
      "align-items:center",
      "gap:14px",
      "font-size:13px",
      "z-index:250",
    ].join(";");
    document.body.appendChild(bar);
  }
  const count = state.selected.size;
  if (count === 0) {
    bar.style.display = "none";
    bar.innerHTML = "";
    return;
  }
  const selectedRows = Array.from(state.selected)
    .map((id) => state.therapists.find((t) => t._id === id))
    .filter(Boolean);
  const emailable = selectedRows.filter((t) => (t.email || "").trim()).length;
  const ptReady = selectedRows.filter((t) => getPTProfileUrl(t)).length;
  const ptMissing = selectedRows.filter(
    (t) => !getPTProfileUrl(t) && !(t.email || "").trim(),
  ).length;

  bar.style.display = "flex";
  bar.innerHTML = `
    <span style="font-weight:600;">${count} selected</span>
    <button id="bulk-send" type="button" ${emailable === 0 ? "disabled" : ""} style="background:#2a5f6e;color:#fff;border:none;border-radius:6px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;${emailable === 0 ? "opacity:0.4;cursor:not-allowed;" : ""}" title="Send personalized emails through Resend to selected therapists with an email on file">Send email (${emailable})</button>
    <button id="bulk-pt" type="button" ${ptReady === 0 ? "disabled" : ""} style="background:#5b21b6;color:#fff;border:none;border-radius:6px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;${ptReady === 0 ? "opacity:0.4;cursor:not-allowed;" : ""}" title="Step through Psychology Today contact forms for selected therapists with a PT URL">Outreach via PT (${ptReady})</button>
    <button id="bulk-find-pt" type="button" ${ptMissing === 0 ? "disabled" : ""} style="background:transparent;color:#fff;border:1px solid #6b7280;border-radius:6px;padding:7px 12px;font-size:13px;cursor:pointer;${ptMissing === 0 ? "opacity:0.4;cursor:not-allowed;" : ""}" title="Open a Google search scoped to psychologytoday.com for each selected therapist with no PT URL on file">Find on PT (${ptMissing})</button>
    <button id="bulk-clear" type="button" style="background:transparent;color:#9ca3af;border:1px solid #374151;border-radius:6px;padding:7px 12px;font-size:13px;cursor:pointer;">Clear</button>
  `;
  document.getElementById("bulk-send")?.addEventListener("click", openBatchComposer);
  document.getElementById("bulk-pt")?.addEventListener("click", openPTOutreach);
  document.getElementById("bulk-find-pt")?.addEventListener("click", openFindOnPT);
  document.getElementById("bulk-clear")?.addEventListener("click", () => {
    state.selected.clear();
    refreshTable();
  });
}

// Step-through Psychology Today outreach. Opens a modal that walks
// the user through each selected therapist who has a PT profile URL.
// For each one we copy the personalized outreach body to the
// clipboard and open the PT page in a new tab so the user can paste
// + submit the form manually (PT's CAPTCHA + ToS make full
// automation a non-starter). After submit, "Mark sent" logs to the
// therapist's emailLog via the existing log-contact-form endpoint,
// so PT sends show up in Subject Performance and the status pill
// flips to email_1_sent, same as Resend sends.
function openPTOutreach() {
  const queue = Array.from(state.selected)
    .map((id) => state.therapists.find((t) => t._id === id))
    .filter((t) => t && getPTProfileUrl(t));
  if (queue.length === 0) return;

  // Campaign tag set once at the start of the step-through and
  // applied to every send in this session. Operator can change it
  // mid-session by reopening the modal; cached in state.lastCampaign.
  const campaign = (
    window.prompt(
      "Campaign tag (optional, lowercase letters/digits/dash/underscore, leave blank to skip):",
      state.lastCampaign || "",
    ) || ""
  ).trim();
  state.lastCampaign = campaign;

  let idx = 0;
  const overlay = document.createElement("div");
  overlay.id = "pt-outreach-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(17,24,39,0.55);z-index:300;display:flex;align-items:center;justify-content:center;padding:20px;";
  document.body.appendChild(overlay);

  function renderStep() {
    if (idx >= queue.length) {
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:14px;max-width:440px;width:100%;padding:24px;box-shadow:0 24px 64px rgba(0,0,0,0.25);text-align:center;">
          <div style="font-size:17px;font-weight:700;color:#111827;margin-bottom:6px;">Batch complete</div>
          <div style="font-size:13px;color:#6b7280;margin-bottom:18px;">Stepped through ${queue.length} therapist${queue.length === 1 ? "" : "s"}.</div>
          <button id="pt-close" type="button" class="btn-primary">Close</button>
        </div>
      `;
      overlay.querySelector("#pt-close").addEventListener("click", () => {
        overlay.remove();
        state.selected.clear();
        refreshTable();
      });
      return;
    }

    const t = queue[idx];
    const ptUrl = getPTProfileUrl(t);
    const rendered = getOutreachTemplate("email_1", t);

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:640px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,0.25);">
        <div style="padding:18px 22px 12px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div>
            <div style="font-size:12px;font-weight:600;color:#5b21b6;letter-spacing:0.4px;text-transform:uppercase;">Outreach via PT · ${idx + 1} of ${queue.length}</div>
            <div style="font-size:17px;font-weight:700;color:#111827;margin-top:2px;">${esc(t.name || "Unknown")}</div>
            <div style="font-size:12px;color:#6b7280;margin-top:1px;">${esc(t.city || "")}${t.city && t.state ? ", " : ""}${esc(t.state || "")}</div>
          </div>
          <button id="pt-close-x" type="button" aria-label="Close" style="background:none;border:none;font-size:22px;color:#9ca3af;cursor:pointer;line-height:1;">&times;</button>
        </div>
        <div style="padding:14px 22px;overflow-y:auto;flex:1;">
          <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Subject (for your reference)</div>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;font-size:13px;color:#111827;margin-bottom:12px;">${esc(rendered.subject)}</div>
          <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Message body (will be copied to your clipboard)</div>
          <pre id="pt-preview" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:12px;color:#111827;white-space:pre-wrap;font-family:inherit;max-height:260px;overflow:auto;margin-bottom:14px;">${esc(rendered.body)}</pre>
          <button id="pt-open" type="button" class="btn-primary" style="width:100%;background:#5b21b6;">Copy message + open PT form ↗</button>
          <div id="pt-copy-status" style="font-size:11px;color:#9ca3af;margin-top:6px;text-align:center;"></div>
        </div>
        <div style="padding:12px 22px;border-top:1px solid #e5e7eb;display:flex;align-items:center;gap:10px;background:#f9fafb;border-radius:0 0 14px 14px;">
          <button id="pt-skip" type="button" class="btn-secondary">Skip</button>
          <button id="pt-sent" type="button" class="btn-primary" style="margin-left:auto;">Mark sent → next</button>
        </div>
      </div>
    `;

    overlay.querySelector("#pt-close-x").addEventListener("click", () => {
      overlay.remove();
    });
    overlay.querySelector("#pt-skip").addEventListener("click", () => {
      idx++;
      renderStep();
    });
    overlay.querySelector("#pt-open").addEventListener("click", async () => {
      const status = overlay.querySelector("#pt-copy-status");
      try {
        await navigator.clipboard.writeText(rendered.body);
        status.textContent = "Copied. Paste into the message field on PT.";
        status.style.color = "#059669";
      } catch {
        status.textContent =
          "Couldn't copy automatically. Select the body above and copy manually.";
        status.style.color = "#b45309";
      }
      window.open(ptUrl, "_blank", "noopener");
    });
    overlay.querySelector("#pt-sent").addEventListener("click", async () => {
      const btn = overlay.querySelector("#pt-sent");
      btn.disabled = true;
      btn.textContent = "Logging…";
      const { ok } = await apiPost("/log-contact-form", {
        therapistId: t._id,
        template: "email_1",
        subject: rendered.subject,
        body: rendered.body,
        ...(campaign ? { campaign } : {}),
      });
      if (!ok) {
        btn.disabled = false;
        btn.textContent = "Retry log";
        return;
      }
      const now = new Date().toISOString();
      mutateTherapist(t._id, (th) => {
        if (!th.outreach) th.outreach = {};
        th.outreach.status = "email_1_sent";
        th.outreach.emailsSent = (th.outreach.emailsSent || 0) + 1;
        th.outreach.lastContactedAt = now;
        th.outreach.emailLog = [
          ...(th.outreach.emailLog || []),
          {
            sentAt: now,
            template: "email_1_via_form",
            subject: rendered.subject,
            body: rendered.body,
            ...(campaign ? { campaign } : {}),
          },
        ];
      });
      state.selected.delete(t._id);
      idx++;
      renderStep();
    });
  }
  renderStep();
}

// Find-on-PT helper. For each selected therapist without a PT URL on
// file, opens a Google search scoped to psychologytoday.com so the
// user can locate their profile. Once found, the user pastes the URL
// into the therapist's Edit drawer (Source URL field) and saves,
// next time they refresh the page, the therapist moves to the
// Outreach-via-PT queue.
function openFindOnPT() {
  const queue = Array.from(state.selected)
    .map((id) => state.therapists.find((t) => t._id === id))
    .filter((t) => t && !getPTProfileUrl(t) && !(t.email || "").trim());
  if (queue.length === 0) return;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(17,24,39,0.55);z-index:300;display:flex;align-items:center;justify-content:center;padding:20px;";
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:640px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,0.25);">
      <div style="padding:18px 22px 12px;border-bottom:1px solid #e5e7eb;">
        <div style="font-size:17px;font-weight:700;color:#111827;">Find on Psychology Today · ${queue.length}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;line-height:1.45;">
          These therapists don't have a PT URL on file. Click <strong>Search</strong> to open a Google query scoped to psychologytoday.com. When you find their PT profile, copy the URL, then paste it into the therapist's Edit drawer (Source URL field) and save. They'll move to the Outreach via PT queue.
        </div>
      </div>
      <div style="padding:8px 0;overflow-y:auto;flex:1;">
        ${queue
          .map(
            (t) => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 22px;border-bottom:1px solid #f3f4f6;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;color:#111827;">${esc(t.name || "Unknown")}</div>
              <div style="font-size:11px;color:#6b7280;">${esc(t.city || "")}${t.city && t.state ? ", " : ""}${esc(t.state || "")}${t.licenseNumber ? ` · License ${esc(t.licenseNumber)}` : ""}</div>
            </div>
            <a href="${esc(getPTSearchUrl(t))}" target="_blank" rel="noopener" style="background:#5b21b6;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:600;text-decoration:none;">Search ↗</a>
            <button class="btn-secondary fop-edit-btn" data-id="${esc(t._id)}" style="font-size:12px;">Edit</button>
          </div>
        `,
          )
          .join("")}
      </div>
      <div style="padding:12px 22px;border-top:1px solid #e5e7eb;display:flex;align-items:center;gap:10px;background:#f9fafb;border-radius:0 0 14px 14px;">
        <span style="font-size:12px;color:#6b7280;flex:1;">Tip: middle-click "Search" to open in a background tab.</span>
        <button id="fop-close" type="button" class="btn-secondary">Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#fop-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelectorAll(".fop-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const t = state.therapists.find((x) => x._id === id);
      if (t) openOutreachEditDrawer(t);
    });
  });
}

// Mirror of the server-side TEMPLATES[*].nextStatus map. Kept in sync
// so the optimistic client-side mutation matches what the server writes
// to Sanity on a successful send. New templates need an entry here AND
// in api/admin/send-email.mjs.
function nextStatusForTemplate(template) {
  if (template === "email_1") return "email_1_sent";
  if (template === "profile_gap") return "profile_gap_sent";
  return "followed_up";
}

// True if this therapist's outreach.emailLog already contains an entry
// for the given template. Used to flag/exclude already-emailed recipients
// in the batch composer so a re-run can't silently double-send. The
// `_via_form` templates (PT contact-form pathway) are distinct values,
// so they don't false-positive an `email_1` send.
function therapistAlreadySent(t, template) {
  const log = Array.isArray(t?.outreach?.emailLog) ? t.outreach.emailLog : [];
  return log.some((e) => e && e.template === template);
}

// Find the most recent sentAt for a given template, used to label the
// "already received" warning row.
function lastSentAtForTemplate(t, template) {
  const log = Array.isArray(t?.outreach?.emailLog) ? t.outreach.emailLog : [];
  return log
    .filter((e) => e && e.template === template && e.sentAt)
    .map((e) => e.sentAt)
    .sort()
    .pop();
}

// Modal for composing the batch send. Shows a template selector, an
// editable subject, a single rendered preview for the first selected
// therapist, and a type-to-confirm gate before the actual send.
function openBatchComposer() {
  // Hard guard: refuse to open a second composer while a batch is in
  // flight. Today's incident (2026-05-15) happened because two batches
  // ran concurrently, interleaved POSTs produced 30+ duplicate sends.
  if (state.batchInFlight) {
    toast("A batch is already running, wait for it to finish.", "error");
    return;
  }

  const ids = Array.from(state.selected);
  const recipients = ids
    .map((id) => state.therapists.find((t) => t._id === id))
    .filter((t) => t && (t.email || "").trim());
  if (recipients.length === 0) return;

  const defaultTemplate = "email_1";
  const overlay = document.createElement("div");
  overlay.id = "batch-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(17,24,39,0.55);z-index:300;display:flex;align-items:center;justify-content:center;padding:20px;";

  const example = getOutreachTemplate(defaultTemplate, recipients[0]);

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:640px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,0.25);">
      <div style="padding:18px 22px 12px;border-bottom:1px solid #e5e7eb;">
        <div style="font-size:17px;font-weight:700;color:#111827;">Send batch · ${recipients.length} therapist${recipients.length === 1 ? "" : "s"}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:2px;">First name and profile URL are personalized per recipient. Subject is the same for everyone.</div>
      </div>
      <div style="padding:14px 22px;overflow-y:auto;flex:1;">
        <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Template</label>
        <select id="batch-template" class="form-input" style="margin-bottom:12px;">
          <option value="email_1" selected>Initial outreach</option>
          <option value="follow_up">Follow-up</option>
          <option value="profile_gap">Profile gap (photo + experience)</option>
        </select>

        <div id="batch-dupe-warning" style="display:none;margin-bottom:12px;"></div>

        <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Subject</label>
        <input id="batch-subject" class="form-input" type="text" value="${esc(example.subject)}" style="margin-bottom:12px;" />

        <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Campaign tag <span style="font-weight:400;color:#9ca3af;">(optional)</span></label>
        <input id="batch-campaign" class="form-input" type="text" placeholder="e.g. 2026-05-pt-test" value="${esc(state.lastCampaign || "")}" autocomplete="off" style="margin-bottom:12px;" />
        <div style="font-size:11px;color:#9ca3af;margin-top:-6px;margin-bottom:12px;">Lowercase letters, digits, dash, underscore. Lets you A/B with the same subject by tagging each batch.</div>

        <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Preview for ${esc(recipients[0].name || recipients[0].email)}</div>
        <pre id="batch-preview" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:12px;color:#111827;white-space:pre-wrap;font-family:inherit;max-height:220px;overflow:auto;">${esc(example.body)}</pre>

        <div style="margin-top:14px;font-size:12px;color:#6b7280;">
          Type <strong style="color:#111827;">SEND</strong> to confirm:
        </div>
        <input id="batch-confirm" class="form-input" type="text" autocomplete="off" spellcheck="false" style="margin-top:6px;" />
      </div>
      <div style="padding:12px 22px;border-top:1px solid #e5e7eb;display:flex;align-items:center;gap:10px;background:#f9fafb;border-radius:0 0 14px 14px;">
        <button id="batch-cancel" type="button" class="btn-secondary">Cancel</button>
        <button id="batch-go" type="button" class="btn-primary" disabled style="margin-left:auto;">Send to ${recipients.length}</button>
        <span id="batch-progress" style="font-size:12px;color:#6b7280;"></span>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const tmplSel = overlay.querySelector("#batch-template");
  const subjEl = overlay.querySelector("#batch-subject");
  const preview = overlay.querySelector("#batch-preview");
  const confirmEl = overlay.querySelector("#batch-confirm");
  const goBtn = overlay.querySelector("#batch-go");
  const warnEl = overlay.querySelector("#batch-dupe-warning");

  // Tracks the "include already-emailed anyway" checkbox state. Default
  // OFF so the safe path is one-click: the user types SEND and only
  // fresh recipients ship. They have to explicitly opt in to re-send.
  let includeAlreadySent = false;

  function classifyAndRenderWarning() {
    const template = tmplSel.value;
    const already = recipients.filter((t) => therapistAlreadySent(t, template));
    const fresh = recipients.filter((t) => !therapistAlreadySent(t, template));
    const willSend = includeAlreadySent ? recipients : fresh;

    if (already.length === 0) {
      warnEl.style.display = "none";
      warnEl.innerHTML = "";
    } else {
      const preview = already
        .slice(0, 5)
        .map((t) => {
          const when = lastSentAtForTemplate(t, template);
          const whenLabel = when ? new Date(when).toLocaleString() : "earlier";
          return `<li style="font-size:12px;color:#7c2d12;">${esc(t.name || t.email || t._id)} <span style="color:#9a3412;font-weight:400;">, sent ${esc(whenLabel)}</span></li>`;
        })
        .join("");
      const more =
        already.length > 5
          ? `<li style="font-size:12px;color:#9a3412;list-style:none;">…and ${already.length - 5} more.</li>`
          : "";
      warnEl.style.display = "block";
      warnEl.innerHTML = `
        <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:12px;">
          <div style="font-size:13px;font-weight:700;color:#9a3412;margin-bottom:6px;">⚠️ ${already.length} recipient${already.length === 1 ? "" : "s"} already received this template</div>
          <ul style="margin:0 0 8px;padding-left:18px;">${preview}${more}</ul>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#7c2d12;cursor:pointer;">
            <input id="batch-include-already" type="checkbox" ${includeAlreadySent ? "checked" : ""} style="margin:0;" />
            Re-send to these ${already.length} anyway (the server will reject without this).
          </label>
        </div>
      `;
      const cb = warnEl.querySelector("#batch-include-already");
      cb.addEventListener("change", () => {
        includeAlreadySent = cb.checked;
        updateGoButton();
      });
    }
    updateGoButton();
  }

  function getActiveRecipients() {
    const template = tmplSel.value;
    return includeAlreadySent
      ? recipients
      : recipients.filter((t) => !therapistAlreadySent(t, template));
  }

  function updateGoButton() {
    const count = getActiveRecipients().length;
    const sendOk = confirmEl.value.trim().toUpperCase() === "SEND";
    goBtn.textContent = count > 0 ? `Send to ${count}` : "Nothing to send";
    goBtn.disabled = !sendOk || count === 0;
  }

  function rerenderPreview() {
    const t = recipients[0];
    const rendered = getOutreachTemplate(tmplSel.value, t);
    subjEl.value = rendered.subject;
    preview.textContent = rendered.body;
  }
  tmplSel.addEventListener("change", () => {
    rerenderPreview();
    classifyAndRenderWarning();
  });

  confirmEl.addEventListener("input", updateGoButton);

  overlay.querySelector("#batch-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const campaignEl = overlay.querySelector("#batch-campaign");

  goBtn.addEventListener("click", async () => {
    const activeRecipients = getActiveRecipients();
    if (activeRecipients.length === 0) return;
    goBtn.disabled = true;
    confirmEl.disabled = true;
    subjEl.disabled = true;
    tmplSel.disabled = true;
    if (campaignEl) campaignEl.disabled = true;
    const campaign = (campaignEl?.value || "").trim();
    state.lastCampaign = campaign;
    state.batchInFlight = true;
    try {
      await sendBatch(
        activeRecipients,
        tmplSel.value,
        subjEl.value.trim(),
        campaign,
        overlay,
        includeAlreadySent,
      );
    } finally {
      state.batchInFlight = false;
    }
  });

  // Initial classification (warns immediately if any selected recipient
  // has already received the default template).
  classifyAndRenderWarning();
}

// Sequential send with a small delay so we don't trip Resend's rate
// limits. Each call goes through the existing /send-email endpoint, so
// server-side validation, audit log, and emailLog write all happen on
// the standard path. Progress is rendered into the modal's footer.
//
// `force` is set from the "include already-emailed anyway" checkbox in
// the composer. When false, the server hard-rejects same-template
// duplicates with 409, we count those as `skipped` (not failed) so the
// final toast distinguishes "I couldn't send" from "I refused to send".
async function sendBatch(recipients, template, subject, campaign, overlay, force) {
  const progressEl = overlay.querySelector("#batch-progress");
  const goBtn = overlay.querySelector("#batch-go");
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  for (let i = 0; i < recipients.length; i++) {
    const t = recipients[i];
    progressEl.textContent = `Sending ${i + 1}/${recipients.length}…`;
    const rendered = getOutreachTemplate(template, t);
    const {
      ok: success,
      status,
      data,
    } = await apiPost("/send-email", {
      therapistId: t._id,
      template,
      subject,
      body: rendered.body,
      ...(campaign ? { campaign } : {}),
      ...(force ? { force: true } : {}),
    });
    if (success) {
      ok++;
      const now = new Date().toISOString();
      mutateTherapist(t._id, (th) => {
        if (!th.outreach) th.outreach = {};
        th.outreach.status = nextStatusForTemplate(template);
        th.outreach.emailsSent = (th.outreach.emailsSent || 0) + 1;
        th.outreach.lastContactedAt = now;
        th.outreach.emailLog = [
          ...(th.outreach.emailLog || []),
          {
            sentAt: now,
            template,
            subject,
            body: rendered.body,
            ...(campaign ? { campaign } : {}),
          },
        ];
      });
      state.selected.delete(t._id);
    } else if (status === 409 && data?.error === "duplicate_send") {
      // Server refused because the same template is already in this
      // therapist's emailLog. Treat as a skip, the desired no-op outcome.
      skipped++;
      console.warn(
        `[sendBatch] skipped duplicate to ${t.name || t._id}: last sent at ${data.lastSentAt}`,
      );
    } else {
      failed++;
    }
    if (i < recipients.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const parts = [
    `${ok} sent`,
    skipped ? `${skipped} skipped (already received)` : "",
    failed ? `${failed} failed` : "",
  ].filter(Boolean);
  progressEl.textContent = `Done · ${parts.join(", ")}.`;
  goBtn.textContent = "Close";
  goBtn.disabled = false;
  goBtn.onclick = () => {
    overlay.remove();
    refreshTable();
    renderBulkActionBar();
  };
  toast(parts.join(", "), failed ? "error" : "success");
}

function statCard(label, value, color) {
  return `<div style="flex:1;min-width:80px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;">
    <div style="font-size:18px;font-weight:700;color:${color};line-height:1.1;">${value}</div>
    <div style="font-size:11px;color:#6b7280;margin-top:2px;">${label}</div>
  </div>`;
}

// Same shape as statCard but rendered as a button, used for the
// Claimed stat that doubles as a jump to the Live tab.
function statCardLink(id, label, value, color) {
  return `<button id="${id}" type="button" style="flex:1;min-width:80px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;cursor:pointer;text-align:left;font:inherit;">
    <div style="font-size:18px;font-weight:700;color:${color};line-height:1.1;">${value} <span style="font-size:12px;color:#9ca3af;">→</span></div>
    <div style="font-size:11px;color:#6b7280;margin-top:2px;">${label}</div>
  </button>`;
}

function subjectPerformanceHtml(rows) {
  if (!rows || rows.length === 0) return "";
  return `
    <div style="flex-shrink:0;">
      <div style="font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">
        Subject performance (initial sends)
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f9fafb;color:#6b7280;text-align:left;">
              <th style="padding:8px 14px;font-weight:600;">Subject</th>
              <th style="padding:8px 14px;font-weight:600;">Campaign</th>
              <th style="padding:8px 14px;font-weight:600;text-align:right;width:70px;">Sent</th>
              <th style="padding:8px 14px;font-weight:600;text-align:right;width:100px;">Opened</th>
              <th style="padding:8px 14px;font-weight:600;text-align:right;width:100px;">Clicked</th>
              <th style="padding:8px 14px;font-weight:600;text-align:right;width:100px;">Claimed</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (r) => `
              <tr style="border-top:1px solid #f3f4f6;">
                <td style="padding:8px 14px;color:#111827;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.subject)}">${esc(r.subject)}</td>
                <td style="padding:8px 14px;color:#6b7280;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.campaign)}">${esc(r.campaign)}</td>
                <td style="padding:8px 14px;text-align:right;color:#374151;">${r.sent}</td>
                <td style="padding:8px 14px;text-align:right;color:#0ea5e9;">${r.opened} <span style="color:#9ca3af;font-size:11px;">(${r.openRate}%)</span></td>
                <td style="padding:8px 14px;text-align:right;color:#7c3aed;">${r.clicked} <span style="color:#9ca3af;font-size:11px;">(${r.clickRate}%)</span></td>
                <td style="padding:8px 14px;text-align:right;color:#059669;">${r.claimed} <span style="color:#9ca3af;font-size:11px;">(${r.claimRate}%)</span></td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// Trend direction for patient match-request demand, week over week.
function trendMeta(signal) {
  const trend = signal?.matchRequests?.trend7dVsPrev7d || "flat";
  if (trend === "growing") return { label: "↑ growing", color: "#059669" };
  if (trend === "declining") return { label: "↓ declining", color: "#dc2626" };
  return { label: "→ flat", color: "#6b7280" };
}

// Always-visible demand pulse shown next to the Insights toggle so the
// "is patient demand real?" signal stays in view without expanding
// Insights. Measurement is the bottleneck, so this leads the eye.
function demandChipHtml(signal) {
  if (!signal) {
    return `<span style="color:#9ca3af;">Patient demand: …</span>`;
  }
  const mr = signal.matchRequests || {};
  const t = trendMeta(signal);
  return `<span style="color:#374151;">Patient demand: <strong style="color:#10b981;">${mr.last7d || 0}</strong> match requests (7d) <span style="color:${t.color};font-weight:600;">${t.label}</span></span>`;
}

function patientSignalCardsHtml(signal) {
  if (!signal) {
    // Loading state, placeholder cards.
    return [
      statCard("Match requests", "…", "#9ca3af"),
      statCard("Profile views (7d)", "…", "#9ca3af"),
      statCard("CTA clicks (7d)", "…", "#9ca3af"),
    ].join("");
  }
  const mr = signal.matchRequests || {};
  const views = signal.profileViews || {};
  const clicks = signal.ctaClicks || {};
  return [
    statCard(`Match requests (${mr.last30d || 0} this month)`, mr.last7d || 0, "#10b981"),
    statCard("Profile views (7d)", views.last7d || 0, "#0ea5e9"),
    statCard("CTA clicks (7d)", clicks.last7d || 0, "#8b5cf6"),
  ].join("");
}

async function fetchPatientSignal() {
  try {
    const r = await fetch("/api/review/admin/patient-signal", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function loadAndRenderPatientSignal() {
  const data = await fetchPatientSignal();
  state.patientSignal = data;
  const row = document.getElementById("patient-signal-row");
  if (row) row.innerHTML = patientSignalCardsHtml(data);
  // Trend label inside the Insights header.
  const trendEl = document.getElementById("patient-signal-trend");
  if (trendEl && data) {
    const t = trendMeta(data);
    trendEl.textContent = t.label;
    trendEl.style.color = t.color;
  }
  // Always-visible demand chip on the Insights toggle row.
  const chip = document.getElementById("demand-chip");
  if (chip) chip.innerHTML = demandChipHtml(data);
}

// ---- TABLE ----

function refreshTable() {
  const filtered = applyFilters();
  const container = document.getElementById("table-container");
  const countEl = document.getElementById("result-count");
  if (countEl)
    countEl.textContent = `${filtered.length} therapist${filtered.length !== 1 ? "s" : ""}`;
  if (!container) return;

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:48px;color:#6b7280;">No therapists match the current filters.</div>`;
    return;
  }

  const rows = filtered
    .map((t) => {
      const s = t.outreach?.status || "not_contacted";
      const last = t.outreach?.lastContactedAt;
      const channel = t.email ? "email" : getContactFormUrl(t) ? "form" : "";
      const sendLabel = !channel
        ? ""
        : s === "not_contacted"
          ? channel === "email"
            ? "Send email 1"
            : "Open form 1"
          : s === "email_1_sent" || s === "followed_up" || s === "profile_gap_sent"
            ? channel === "email"
              ? "Send follow-up"
              : "Open form follow-up"
            : "";

      const profileUrl = safeProfileUrl(t.profileUrl);
      const emailLabel = sendLabel || "Email";
      const hasEmail = Boolean((t.email || "").trim());
      const ptUrl = getPTProfileUrl(t);
      const isSelected = state.selected.has(t._id);
      // Any row is selectable, bulk actions route by capability:
      // direct email needs t.email, PT outreach needs a PT URL, Find
      // on PT needs neither.
      const checkboxCell = `<input type="checkbox" class="row-select" data-id="${esc(t._id)}" data-no-row-click ${isSelected ? "checked" : ""} />`;
      const emailCellInner = hasEmail
        ? esc(t.email)
        : ptUrl
          ? `<span style="display:inline-block;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:600;background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;">PT</span>`
          : "-";
      return `<tr data-id="${esc(t._id)}" style="cursor:pointer;">
      <td style="padding:11px 14px;width:32px;" data-no-row-click>${checkboxCell}</td>
      <td style="padding:11px 14px;font-weight:500;">${esc(t.name || "-")}</td>
      <td style="padding:11px 14px;color:#6b7280;">${emailCellInner}</td>
      <td style="padding:11px 14px;">${pill(s)}</td>
      <td style="padding:11px 14px;text-align:center;">${engagementTrailHtml(t)}</td>
      <td style="padding:11px 14px;color:#6b7280;">${relTime(last) || "-"}</td>
      <td style="padding:11px 14px;white-space:nowrap;">
        <button class="email-btn btn-secondary" data-id="${esc(t._id)}" style="margin-right:6px;color:#2a5f6e;border-color:#2a5f6e;">${emailLabel}</button>
        <button class="edit-btn btn-secondary" data-id="${esc(t._id)}" style="margin-right:6px;">Edit</button>
        ${profileUrl ? `<a class="profile-link" href="${esc(profileUrl)}" target="_blank" rel="noopener" data-no-row-click style="display:inline-block;padding:4px 10px;border:1px solid #d1d5db;border-radius:6px;color:#2a5f6e;font-size:12px;text-decoration:none;">View ↗</a>` : ""}
      </td>
    </tr>`;
    })
    .join("");

  // Header checkbox state: checked when every visible row is selected;
  // indeterminate when some but not all are. Bulk actions route by
  // capability (email / PT / find-on-PT) so non-emailable rows are
  // still useful in the selection.
  const selectedVisible = filtered.filter((t) => state.selected.has(t._id)).length;
  const allChecked = filtered.length > 0 && selectedVisible === filtered.length;
  const indeterminate = selectedVisible > 0 && selectedVisible < filtered.length;
  const headerCheckbox = `<input type="checkbox" id="select-all" ${allChecked ? "checked" : ""} ${indeterminate ? 'data-indeterminate="1"' : ""} title="Select all visible therapists" />`;

  // Sortable headers: Status + Last contact have a click-to-sort
  // toggle. The arrow appears only on the active column.
  const headers = [
    { label: headerCheckbox, raw: true },
    { label: "Name" },
    { label: "Email" },
    { label: "Status", sortKey: "status" },
    { label: "Engagement", align: "center" },
    { label: "Last contact", sortKey: "lastContactedAt" },
    { label: "Actions" },
  ];
  const { column: activeSort, direction: activeDir } = state.sort || {};
  const arrow = (key) => {
    if (key !== activeSort) return "";
    return activeDir === "asc" ? " ▲" : " ▼";
  };
  const headerHtml = headers
    .map((h) => {
      const align = h.align || "left";
      const clickable = h.sortKey
        ? `cursor:pointer;user-select:none;${h.sortKey === activeSort ? "color:#2a5f6e;" : ""}`
        : "";
      const attr = h.sortKey ? `data-sort-key="${h.sortKey}"` : "";
      return `<th ${attr} style="padding:9px 14px;text-align:${align};font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;${clickable}">${h.label}${arrow(h.sortKey)}</th>`;
    })
    .join("");

  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-top:14px;">
      <thead>
        <tr id="therapist-thead-row" style="background:#f9fafb;border-bottom:1px solid #e5e7eb;">
          ${headerHtml}
        </tr>
      </thead>
      <tbody id="therapist-tbody" style="border-top:none;">${rows}</tbody>
    </table>
  `;

  document.getElementById("therapist-tbody").addEventListener("click", handleTableClick);
  document.getElementById("therapist-thead-row").addEventListener("click", handleHeaderSortClick);

  // Wire selection checkboxes. Listening at the table level lets the
  // header + row checkboxes share one handler and survive re-renders.
  const tbody = document.getElementById("therapist-tbody");
  if (tbody) tbody.addEventListener("change", handleRowSelectChange);
  const selectAll = document.getElementById("select-all");
  if (selectAll) {
    if (selectAll.dataset.indeterminate === "1") selectAll.indeterminate = true;
    selectAll.addEventListener("change", handleSelectAllChange);
  }
  renderBulkActionBar();
}

function handleRowSelectChange(e) {
  const cb = e.target.closest(".row-select");
  if (!cb) return;
  const id = cb.dataset.id;
  if (cb.checked) state.selected.add(id);
  else state.selected.delete(id);
  renderBulkActionBar();
  // Update header checkbox state without a full table rerender.
  const filtered = applyFilters();
  const selectedVisible = filtered.filter((t) => state.selected.has(t._id)).length;
  const selectAll = document.getElementById("select-all");
  if (selectAll) {
    selectAll.checked = filtered.length > 0 && selectedVisible === filtered.length;
    selectAll.indeterminate = selectedVisible > 0 && selectedVisible < filtered.length;
  }
}

function handleSelectAllChange(e) {
  const filtered = applyFilters();
  if (e.target.checked) {
    filtered.forEach((t) => state.selected.add(t._id));
  } else {
    filtered.forEach((t) => state.selected.delete(t._id));
  }
  refreshTable();
}

function handleHeaderSortClick(e) {
  const th = e.target.closest("th[data-sort-key]");
  if (!th) return;
  const key = th.dataset.sortKey;
  if (state.sort.column === key) {
    state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
  } else {
    state.sort.column = key;
    // Sensible defaults: most-recent-first for dates, funnel-order
    // for status.
    state.sort.direction = key === "lastContactedAt" ? "desc" : "asc";
  }
  refreshTable();
}

function handleTableClick(e) {
  // Profile link is a real <a target="_blank">, let the browser handle it
  // and don't open the detail panel on top.
  if (e.target.closest("[data-no-row-click]")) return;

  const emailBtn = e.target.closest(".email-btn");
  const editBtn = e.target.closest(".edit-btn");
  const row = e.target.closest("tr[data-id]");

  const id = emailBtn?.dataset.id || editBtn?.dataset.id || row?.dataset.id;
  if (!id) return;
  if (e.target.closest("button") && !emailBtn && !editBtn) return;

  const t = state.therapists.find((x) => x._id === id);
  if (!t) return;

  if (editBtn) {
    openOutreachEditDrawer(t);
    return;
  }
  openPanel(t);
}

// ---- EDIT DRAWER (shared with admin) ----

// Open the shared profile-edit drawer for an outreach therapist. The
// drawer DOM and binding logic live in admin-candidate-edit.js so any
// field change here writes back through the same API and shows up the
// same way in the admin Find Profile flow. We just pass callbacks so
// the local outreach state stays in sync after a save or delete.
//
// The outreach list endpoint returns a slim projection (no bio,
// specialties, fees, etc.) to keep the wire payload small. The drawer
// needs the full record, so we fetch /api/review/therapists/:id/admin
// here and pass the normalized full doc to the drawer.
async function openOutreachEditDrawer(t) {
  let full = t;
  try {
    const r = await fetch(`/api/review/therapists/${encodeURIComponent(t._id)}/admin`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (r.ok) {
      const doc = await r.json();
      // Server returns snake_case via normalizeAdminTherapist. The
      // drawer reads either snake or camel, so merging keeps outreach's
      // own fields (_id, slug, profileUrl) alongside the full shape.
      full = { ...t, ...doc };
    }
  } catch {
    // Network error, fall back to the slim record so the drawer at
    // least opens with whatever we have.
  }
  openTherapistEditDrawer(full, onDrawerSaved, {
    enableDelete: true,
    onDeleted: onDrawerDeleted,
  });
}

function onDrawerSaved(saved) {
  const doc = saved?.therapist;
  if (!doc) return;
  const id = doc._id || doc.id;
  if (!id) return;
  const i = state.therapists.findIndex((x) => x._id === id);
  if (i < 0) return;
  // Server response uses camelCase Sanity field names. Merge what the
  // editor can change so the list view reflects fresh values without a
  // full refetch.
  state.therapists[i] = {
    ...state.therapists[i],
    name: doc.name ?? state.therapists[i].name,
    email: doc.email ?? state.therapists[i].email,
    city: doc.city ?? state.therapists[i].city,
    state: doc.state ?? state.therapists[i].state,
    listingActive: doc.listingActive ?? state.therapists[i].listingActive,
  };
  if (state.view === "live") refreshLiveTable();
  else refreshTable();
  toast("Profile updated");
}

function onDrawerDeleted(id) {
  state.therapists = state.therapists.filter((x) => x._id !== id);
  if (state.view === "live") refreshLiveTable();
  else refreshTable();
  toast("Therapist deleted");
}

// ---- PANEL ----

function openPanel(t) {
  state.selectedId = t._id;
  const panel = document.getElementById("detail-panel");
  const overlay = document.getElementById("panel-overlay");
  panel.innerHTML = renderPanelContent(t);
  panel.style.transform = "translateX(0)";
  overlay.style.opacity = "1";
  overlay.style.pointerEvents = "auto";
  setupPanelListeners(t);
}

function closePanel() {
  state.selectedId = null;
  const panel = document.getElementById("detail-panel");
  const overlay = document.getElementById("panel-overlay");
  if (panel) panel.style.transform = "translateX(100%)";
  if (overlay) {
    overlay.style.opacity = "0";
    overlay.style.pointerEvents = "none";
  }
}

function renderPanelContent(t) {
  const status = t.outreach?.status || "not_contacted";
  const emailLog = (t.outreach?.emailLog || []).slice().reverse();
  const isInactive = TERMINAL_STATUSES.has(status);
  const defaultTemplate = status === "not_contacted" ? "email_1" : "follow_up";
  const contactFormUrl = getContactFormUrl(t);
  const profileUrl = safeProfileUrl(t.profileUrl);
  // Quick-action reply buttons make sense after we've contacted them
  // but before they've reached a terminal status. Keeps the dropdown-
  // and-Save dance off the most common reply outcomes.
  const showQuickActions = ["email_1_sent", "followed_up", "profile_gap_sent"].includes(status);

  return `
    <div style="padding:18px 24px;border-bottom:1px solid #e5e7eb;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-size:16px;font-weight:700;">${esc(t.name || "-")}</div>
        ${profileUrl ? `<a href="${esc(profileUrl)}" target="_blank" rel="noopener" style="font-size:12px;color:#2a5f6e;margin-top:4px;display:inline-block;">View live profile →</a>` : ""}
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <button id="panel-edit-profile" type="button" class="btn-secondary" style="white-space:nowrap;" title="Open the full profile editor">Edit profile</button>
        <button id="panel-close" type="button" aria-label="Close panel" style="background:none;border:none;font-size:22px;color:#9ca3af;line-height:1;padding:0;">×</button>
      </div>
    </div>

    <div class="panel-section">
      <div class="section-label">Outreach Status</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        ${pill(status)}
        <select id="panel-status" class="form-input" style="flex:1;min-width:150px;">
          ${Object.entries(STATUS_LABELS)
            .map(([v, l]) => `<option value="${v}" ${status === v ? "selected" : ""}>${l}</option>`)
            .join("")}
        </select>
        <button id="save-status-btn" class="btn-primary" style="white-space:nowrap;">Save</button>
      </div>
      ${
        showQuickActions
          ? `
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="quick-status-btn btn-secondary" data-status="replied" style="border-color:#7c3aed;color:#5b21b6;">Mark replied</button>
          <button class="quick-status-btn btn-secondary" data-status="opted_out" style="border-color:#fca5a5;color:#991b1b;">Mark opted out</button>
        </div>
      `
          : ""
      }
    </div>

    <div class="panel-section">
      <div class="section-label">${t.email ? "Email Composer" : "Contact Form Helper"}</div>
      ${
        isInactive
          ? `
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;font-size:13px;color:#6b7280;">
          ${
            status === "opted_out"
              ? "This therapist opted out. Do not email."
              : status === "replied"
                ? "This therapist replied. Handle in your inbox; don't auto-send another email."
                : status === "bounced"
                  ? "Email bounced. Verify the address before retrying."
                  : "Already claimed or paid. No outreach needed."
          }
        </div>
      `
          : !t.email && !(t.website || t.sourceUrl)
            ? `<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:12px;font-size:13px;color:#92400e;">
                No email or website on file. Can't reach this therapist.
              </div>`
            : !t.email && !contactFormUrl
              ? `<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:12px;font-size:13px;color:#92400e;">
                  Website is not a safe http(s) URL. Verify the profile before opening a contact form.
                </div>`
              : gmailComposerHtml(t, defaultTemplate, t.email ? "email" : "form")
      }
    </div>

    <div class="panel-section">
      <div class="section-label">Email History</div>
      ${
        emailLog.length === 0
          ? `<div style="font-size:13px;color:#6b7280;">No emails sent yet.</div>`
          : emailLog
              .map((e) => {
                const state = openState(e);
                const isFormSend = String(e.template || "").endsWith("_via_form");
                const openBadge =
                  state === "opened"
                    ? `<span title="${e.openedAt ? `Opened ${new Date(e.openedAt).toLocaleString()}` : "Opened"}" style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#dcfce7;color:#15803d;border:1px solid #86efac;">✓ Opened${e.openedAt ? ` · ${relTime(e.openedAt)}` : ""}</span>`
                    : state === "unopened"
                      ? `<span title="Resend has not reported an open yet" style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#f3f4f6;color:#6b7280;border:1px solid #d1d5db;">Not opened</span>`
                      : `<span title="Form / PT sends don't go through Resend, so we can't track opens" style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#fef3c7;color:#92400e;border:1px solid #fde68a;">No tracking</span>`;
                return `
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;margin-bottom:8px;font-size:13px;">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
              <div style="flex:1;min-width:0;">
                <div style="font-weight:500;">${
                  e.template?.startsWith("email_1")
                    ? "Initial outreach"
                    : e.template === "profile_gap"
                      ? "Profile gap"
                      : "Follow-up"
                }${isFormSend ? " (contact form)" : ""}</div>
                <div style="color:#6b7280;font-size:12px;margin-top:2px;">${esc(e.subject)}</div>
                <div style="color:#9ca3af;font-size:12px;margin-top:2px;">${e.sentAt ? new Date(e.sentAt).toLocaleString() : "-"}${e.campaign ? ` · campaign: ${esc(e.campaign)}` : ""}</div>
              </div>
              <div style="flex-shrink:0;">${openBadge}</div>
            </div>
          </div>`;
              })
              .join("")
      }
    </div>

    <div class="panel-section" style="border-bottom:none;">
      <div class="section-label">Notes</div>
      <textarea id="panel-notes" class="form-input" style="min-height:90px;resize:vertical;" placeholder="Internal notes…">${esc(t.outreach?.notes || "")}</textarea>
      <button id="save-notes-btn" class="btn-primary" style="margin-top:8px;">Save notes</button>
    </div>
  `;
}

// Default starting subject + body for each template. The composer
// pre-fills these into editable inputs; the user edits before sending.
// Template content lives in shared/outreach-templates.mjs (used by the
// server too), this just adapts the profileUrl to the placeholder the
// admin sees when no URL is on file yet.
function getTemplateDefaults(template, t) {
  return getOutreachTemplate(template, {
    name: t.name,
    profileUrl: safeProfileUrl(t.profileUrl) || "[your profile URL]",
  });
}

// ---- EDIT-PROFILE DRAWER ----
//
// Full-control drawer for editing a therapist's profile fields. Opens
// from the small detail panel's "Edit profile" button. Save submits a
// single PATCH to /api/admin/therapist/[id] with the changed-fields
// payload; Delete opens a type-to-confirm modal that hits the same
// endpoint with DELETE (soft delete: listingActive=false, status=
// archived, lifecycle=archived).
//
// The drawer is mounted once on init (the overlay + drawer + confirm-
// overlay divs live in the page-level template). Each open() call
// rerenders its body innerHTML for the current therapist; close()
// just animates it back off-screen.

// Gmail-style composer: From + To (or just From for form mode), an
// editable Subject input, an editable Body textarea, and a single
// action button. The same component is used for both real-email sends
// and contact-form helpers; only the action button + lack of "To"
// differentiates them.
function gmailComposerHtml(t, defaultTemplate, mode) {
  const fromAddress = "Michael <michael@bipolartherapyhub.com>";
  const isFormMode = mode === "form";
  const target = getContactFormUrl(t);
  const defaults = getTemplateDefaults(defaultTemplate, t);

  const headerRow = (label, value) => `
    <div style="display:flex;align-items:baseline;gap:8px;padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">
      <span style="color:#9ca3af;width:48px;flex-shrink:0;">${esc(label)}</span>
      <span style="color:#374151;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(value)}</span>
    </div>
  `;

  const formNote = isFormMode
    ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:8px 11px;font-size:12px;color:#1e3a8a;margin-bottom:10px;line-height:1.5;">
        No email on file. Click <strong>Copy + open contact page</strong>: the body is copied to your clipboard, ${esc(target || "their site")} opens in a new tab, paste it into their contact form by hand.
      </div>`
    : "";

  const templateSelector = `
    <label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:6px;">Template</label>
    <select id="template-select" class="form-input" style="margin-bottom:12px;">
      <option value="email_1" ${defaultTemplate === "email_1" ? "selected" : ""}>Initial outreach</option>
      <option value="follow_up" ${defaultTemplate === "follow_up" ? "selected" : ""}>Follow-up</option>
      <option value="profile_gap" ${defaultTemplate === "profile_gap" ? "selected" : ""}>Profile gap (photo + experience)</option>
    </select>
  `;

  const composerCard = `
    <div style="background:#fff;border:1px solid #d1d5db;border-radius:8px;overflow:hidden;margin-bottom:10px;">
      ${headerRow("From", fromAddress)}
      ${isFormMode ? "" : headerRow("To", t.email || "")}
      <input id="composer-subject" type="text" placeholder="Subject"
        value="${esc(defaults.subject)}"
        style="display:block;width:100%;border:none;border-bottom:1px solid #e5e7eb;padding:10px 12px;font-size:14px;font-weight:500;color:#111827;outline:none;box-sizing:border-box;" />
      <textarea id="composer-body" placeholder="Write your message…"
        style="display:block;width:100%;border:none;padding:12px;font-size:14px;line-height:1.55;color:#111827;font-family:inherit;resize:vertical;min-height:240px;outline:none;box-sizing:border-box;">${esc(defaults.body)}</textarea>
    </div>
  `;

  const button = isFormMode
    ? `<button id="open-form-btn" class="btn-primary" data-target="${esc(target)}" style="width:100%;padding:10px;">Copy + open contact page</button>`
    : `
        <div style="display:flex;gap:8px;">
          <button id="send-email-btn" class="btn-primary" style="flex:1;padding:10px;">Send email</button>
          <button id="send-test-btn" class="btn-secondary" style="padding:10px 14px;white-space:nowrap;border-color:#2a5f6e;color:#2a5f6e;">Send test to me</button>
        </div>
      `;

  return `
    ${formNote}
    ${templateSelector}
    ${composerCard}
    ${button}
    <div id="send-msg" style="margin-top:8px;font-size:13px;"></div>
  `;
}

// ---- LISTENERS ----

function setupDashboardListeners() {
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    try {
      await fetch("/api/review/admin/logout", { method: "POST" });
    } catch {}
    redirectToAdminLogin();
  });

  const refilter = () => refreshTable();

  document.getElementById("f-status")?.addEventListener("change", (e) => {
    state.filters.status = e.target.value;
    refilter();
  });
  document.getElementById("f-state")?.addEventListener("change", (e) => {
    state.filters.state = e.target.value;
    refilter();
  });
  document.getElementById("f-search")?.addEventListener("input", (e) => {
    state.filters.search = e.target.value;
    refilter();
  });
  document.getElementById("f-followup")?.addEventListener("change", (e) => {
    state.filters.followUpDue = e.target.checked;
    refilter();
  });
  document.getElementById("f-includedone")?.addEventListener("change", (e) => {
    state.filters.includeDone = e.target.checked;
    refilter();
  });
  document.getElementById("f-engagement")?.addEventListener("change", (e) => {
    state.filters.engagement = e.target.value;
    refilter();
  });
  document.getElementById("go-live-tab")?.addEventListener("click", () => {
    state.view = "live";
    renderDashboard();
  });
  document.getElementById("insights-toggle")?.addEventListener("click", () => {
    state.insightsOpen = !state.insightsOpen;
    renderDashboard();
  });

  document.getElementById("panel-overlay")?.addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Drawer close + confirm-modal close are wired inside the shared
    // drawer module. Just handle the small detail panel here.
    const drawerOpen = document
      .getElementById("candidateEditDrawer")
      ?.classList.contains("is-open");
    if (drawerOpen) {
      closeCandidateEditDrawer();
    } else {
      closePanel();
    }
  });
}

function setupPanelListeners(t) {
  document.getElementById("panel-close")?.addEventListener("click", closePanel);
  document.getElementById("panel-edit-profile")?.addEventListener("click", () => {
    // Hand off from the small outreach panel to the full edit drawer.
    // Close the panel underneath so they don't compete for the same
    // right-edge real estate or fight for keyboard focus.
    closePanel();
    openOutreachEditDrawer(t);
  });

  document.getElementById("template-select")?.addEventListener("change", (e) => {
    // Switching template repopulates the composer fields with the new
    // template's defaults. If the user has unsaved edits, ask first so
    // we don't blow away in-progress work.
    const subjectEl = document.getElementById("composer-subject");
    const bodyEl = document.getElementById("composer-body");
    if (!subjectEl || !bodyEl) return;
    const newDefaults = getTemplateDefaults(e.target.value, t);
    const prevTemplate = e.target.value === "email_1" ? "follow_up" : "email_1";
    const prevDefaults = getTemplateDefaults(prevTemplate, t);
    const isUnedited =
      subjectEl.value === prevDefaults.subject && bodyEl.value === prevDefaults.body;
    if (
      !isUnedited &&
      !window.confirm("Replace the current draft with the other template's starting copy?")
    ) {
      // Roll the selector back if they decline.
      e.target.value = prevTemplate;
      return;
    }
    subjectEl.value = newDefaults.subject;
    bodyEl.value = newDefaults.body;
  });

  async function applyStatus(newStatus) {
    const { ok } = await apiPatch(therapistPath(t._id), { status: newStatus });
    if (ok) {
      mutateTherapist(t._id, (th) => {
        if (!th.outreach) th.outreach = {};
        th.outreach.status = newStatus;
      });
      toast("Status updated");
      refreshTable();
      const updated = state.therapists.find((x) => x._id === t._id);
      if (updated) openPanel(updated);
    } else {
      toast("Failed to save status", "error");
    }
  }

  document.getElementById("save-status-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("save-status-btn");
    const newStatus = document.getElementById("panel-status")?.value;
    btn.disabled = true;
    btn.textContent = "Saving…";
    await applyStatus(newStatus);
    btn.disabled = false;
    btn.textContent = "Save";
  });

  document.querySelectorAll(".quick-status-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const newStatus = btn.dataset.status;
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = "Saving…";
      await applyStatus(newStatus);
      btn.disabled = false;
      btn.textContent = orig;
    });
  });

  // Read the current composer state (template + edited subject/body).
  // Returns null if the inputs aren't on screen.
  function readComposer() {
    const template = document.getElementById("template-select")?.value || "email_1";
    const subjectEl = document.getElementById("composer-subject");
    const bodyEl = document.getElementById("composer-body");
    if (!subjectEl || !bodyEl) return null;
    return {
      template,
      subject: subjectEl.value.trim(),
      body: bodyEl.value.trim(),
    };
  }

  document.getElementById("open-form-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("open-form-btn");
    const msgEl = document.getElementById("send-msg");
    const target = safeExternalUrl(btn.dataset.target);
    const composer = readComposer();
    if (!composer) return;
    if (msgEl) msgEl.textContent = "";

    if (!target) {
      if (msgEl) {
        msgEl.textContent = "Contact page URL is not safe to open.";
        msgEl.style.color = "#ef4444";
      }
      return;
    }

    if (!composer.subject || !composer.body) {
      if (msgEl) {
        msgEl.textContent = "Subject and body are required.";
        msgEl.style.color = "#ef4444";
      }
      return;
    }

    const messageText = `Subject: ${composer.subject}\n\n${composer.body}`;
    try {
      await navigator.clipboard.writeText(messageText);
    } catch {
      if (msgEl) {
        msgEl.textContent = "Couldn't copy to clipboard. Copy from the composer by hand.";
        msgEl.style.color = "#b45309";
      }
    }

    const opened = window.open(target, "_blank", "noopener");
    if (opened) opened.opener = null;

    btn.disabled = true;
    btn.textContent = "Logging…";
    const { ok, data } = await apiPost("/log-contact-form", {
      therapistId: t._id,
      template: composer.template,
      subject: composer.subject,
      body: composer.body,
    });
    btn.disabled = false;
    btn.textContent = "Copy + open contact page";

    if (ok) {
      toast("Copied + opened. Outreach logged.");
      const now = new Date().toISOString();
      mutateTherapist(t._id, (th) => {
        if (!th.outreach) th.outreach = {};
        th.outreach.status = nextStatusForTemplate(composer.template);
        th.outreach.emailsSent = (th.outreach.emailsSent || 0) + 1;
        th.outreach.lastContactedAt = now;
        th.outreach.emailLog = [
          ...(th.outreach.emailLog || []),
          {
            sentAt: now,
            template: `${composer.template}_via_form`,
            subject: composer.subject,
            body: composer.body,
          },
        ];
      });
      refreshTable();
      const updated = state.therapists.find((x) => x._id === t._id);
      if (updated) openPanel(updated);
    } else {
      const msg = data?.error || "Couldn't log outreach";
      if (msgEl) {
        msgEl.textContent = msg;
        msgEl.style.color = "#ef4444";
      }
    }
  });

  document.getElementById("send-test-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("send-test-btn");
    const msgEl = document.getElementById("send-msg");
    const composer = readComposer();
    if (!composer) return;
    if (msgEl) msgEl.textContent = "";

    if (!composer.subject || !composer.body) {
      if (msgEl) {
        msgEl.textContent = "Subject and body are required.";
        msgEl.style.color = "#ef4444";
      }
      return;
    }

    btn.disabled = true;
    btn.textContent = "Sending test…";

    const { ok, data } = await apiPost("/send-email", {
      therapistId: t._id,
      template: composer.template,
      subject: composer.subject,
      body: composer.body,
      sendToSelf: true,
    });
    btn.disabled = false;
    btn.textContent = "Send test to me";

    if (ok) {
      toast(`Test sent to ${data?.testTo || "your inbox"}`);
    } else {
      const err = data?.error || "Test send failed";
      if (msgEl) {
        msgEl.textContent = err;
        msgEl.style.color = "#ef4444";
      }
    }
  });

  document.getElementById("send-email-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("send-email-btn");
    const msgEl = document.getElementById("send-msg");
    const composer = readComposer();
    if (!composer) return;
    if (msgEl) msgEl.textContent = "";

    if (!composer.subject || !composer.body) {
      if (msgEl) {
        msgEl.textContent = "Subject and body are required.";
        msgEl.style.color = "#ef4444";
      }
      return;
    }

    // Duplicate-send confirmation: if this therapist already received
    // the selected template, force the operator through an explicit
    // confirm() before we pass force:true to the server. Without this,
    // a misclick on a row whose status field is out of view can ship
    // a second copy of the same template.
    let force = false;
    if (therapistAlreadySent(t, composer.template)) {
      const when = lastSentAtForTemplate(t, composer.template);
      const whenLabel = when ? new Date(when).toLocaleString() : "earlier";
      const proceed = window.confirm(
        `${t.name || t.email} already received the "${composer.template}" template on ${whenLabel}.\n\nSend it again anyway?`,
      );
      if (!proceed) return;
      force = true;
    }

    btn.disabled = true;
    btn.textContent = "Sending…";

    const { ok, data } = await apiPost("/send-email", {
      therapistId: t._id,
      template: composer.template,
      subject: composer.subject,
      body: composer.body,
      ...(force ? { force: true } : {}),
    });
    btn.disabled = false;
    btn.textContent = "Send email";

    if (ok) {
      toast("Email sent!");
      const now = new Date().toISOString();
      mutateTherapist(t._id, (th) => {
        if (!th.outreach) th.outreach = {};
        th.outreach.status = nextStatusForTemplate(composer.template);
        th.outreach.emailsSent = (th.outreach.emailsSent || 0) + 1;
        th.outreach.lastContactedAt = now;
        th.outreach.emailLog = [
          ...(th.outreach.emailLog || []),
          {
            sentAt: now,
            template: composer.template,
            subject: composer.subject,
            body: composer.body,
          },
        ];
      });
      refreshTable();
      const updated = state.therapists.find((x) => x._id === t._id);
      if (updated) openPanel(updated);
    } else {
      const msg = data?.error || "Failed to send email";
      if (msgEl) {
        msgEl.textContent = msg;
        msgEl.style.color = "#ef4444";
      }
      toast(msg, "error");
    }
  });

  document.getElementById("save-notes-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("save-notes-btn");
    const notes = document.getElementById("panel-notes")?.value ?? "";
    btn.disabled = true;
    btn.textContent = "Saving…";
    const { ok } = await apiPatch(therapistPath(t._id), { notes });
    btn.disabled = false;
    btn.textContent = "Save notes";
    if (ok) {
      mutateTherapist(t._id, (th) => {
        if (!th.outreach) th.outreach = {};
        th.outreach.notes = notes;
      });
      toast("Notes saved");
    } else {
      toast("Failed to save notes", "error");
    }
  });
}

function mutateTherapist(id, fn) {
  const t = state.therapists.find((x) => x._id === id);
  if (t) fn(t);
}

// ---- INIT ----

async function init() {
  const { ok, status, data } = await apiGet("/therapists", {});
  if (status === 401) {
    redirectToAdminLogin();
    return;
  }
  if (ok && data) {
    state.therapists = data;
    // Fetch outreach-link clicks (outreach_profile_viewed funnel
    // events). Stored as a Map<slug, [viewedAt]> for fast per-slug
    // lookup when computing per-subject click rates. Tolerant of
    // failure, Subject Performance falls back to 0 clicks shown.
    try {
      // Route lives in the review API dispatcher (one Vercel function,
      // many paths) to stay under the Hobby plan's function cap.
      const r = await fetch("/api/review/admin/outreach-clicks", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const data = r.ok ? await r.json().catch(() => null) : null;
      const events = data?.events || [];
      const bySlug = new Map();
      for (const e of events) {
        if (!bySlug.has(e.slug)) bySlug.set(e.slug, []);
        bySlug.get(e.slug).push(e.viewedAt);
      }
      state.outreachClicksBySlug = bySlug;
    } catch {
      state.outreachClicksBySlug = new Map();
    }
    // Mount + bind the shared profile-edit drawer once. Both Outreach
    // and Live tabs reuse it; renderDashboard() doesn't recreate it.
    mountEditDrawer();
    bindCandidateEditDrawer();
    renderDashboard();
  } else {
    redirectToAdminLogin();
  }
}

init();
