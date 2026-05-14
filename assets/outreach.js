import "./sentry-init.js";
import { escapeHtml as esc } from "./escape-html.js";
import { getOutreachTemplate } from "../shared/outreach-templates.mjs";
import { initAdminProfileSearch } from "./admin-profile-search.js";

const API = "/api/admin";

// ---- STATE ----

const state = {
  therapists: [],
  // view: which tab is active. "outreach" = cold-outreach CRM (default),
  // "live" = therapists who have claimed and are published — different
  // segment, different future messaging, not part of the cold queue.
  view: "outreach",
  // includeDone: terminal statuses (claimed/paid/replied/bounced/opted_out)
  // are hidden from the outreach queue by default so the working list
  // stays focused on people who can still convert. Toggle reveals them.
  filters: { status: "", state: "CA", search: "", followUpDue: false, includeDone: false },
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
// don't count — Live is about people who chose to be on the platform.
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

function therapistPath(id) {
  return `/therapist/${encodeURIComponent(String(id || ""))}`;
}

const STATUS_LABELS = {
  not_contacted: "Not contacted",
  email_1_sent: "Email 1 sent",
  followed_up: "Followed up",
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
  const { status, state: stateF, search, followUpDue, includeDone } = state.filters;
  const filtered = state.therapists.filter((t) => {
    const s = t.outreach?.status || "not_contacted";
    // Hide terminal statuses by default so claimed/paid/replied/bounced
    // therapists don't clutter the working queue. Explicit status pick
    // overrides the gate so "filter to Claimed" still works.
    if (!includeDone && !status && TERMINAL_STATUSES.has(s)) return false;
    if (status && s !== status) return false;
    if (stateF && t.state !== stateF) return false;
    if (followUpDue && !isFollowUpDue(t)) return false;
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

// Canonical status ordering — funnel progression rather than alpha.
// "Not contacted" first, terminal/negative states last. Sort by index
// in this list when the user picks the Status column.
const STATUS_ORDER = [
  "not_contacted",
  "email_1_sent",
  "followed_up",
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
    ["email_1_sent", "followed_up", "replied", "claimed", "paid"].includes(t.outreach?.status),
  ).length;
  const replied = list.filter((t) =>
    ["replied", "claimed", "paid"].includes(t.outreach?.status),
  ).length;
  const claimed = list.filter((t) => ["claimed", "paid"].includes(t.outreach?.status)).length;
  // Reply rate is the meaningful early signal — claim rate stays low for
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
  for (const t of list) {
    const log = Array.isArray(t.outreach?.emailLog) ? t.outreach.emailLog : [];
    const email1Sends = log.filter((e) => e?.template === "email_1");
    if (email1Sends.length === 0) continue;
    const latest = email1Sends[email1Sends.length - 1];
    const key = (latest.subject || "").trim() || "(no subject)";
    if (!buckets.has(key)) {
      buckets.set(key, { subject: key, sent: 0, opened: 0, replied: 0 });
    }
    const b = buckets.get(key);
    b.sent += 1;
    if (latest.openedAt) b.opened += 1;
    if (["replied", "claimed", "paid"].includes(t.outreach?.status)) b.replied += 1;
  }
  return Array.from(buckets.values())
    .map((b) => ({
      ...b,
      openRate: b.sent > 0 ? Math.round((b.opened / b.sent) * 100) : 0,
      replyRate: b.sent > 0 ? Math.round((b.replied / b.sent) * 100) : 0,
    }))
    .sort((a, b) => b.sent - a.sent);
}

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

    <div id="ed-drawer-overlay" class="ed-drawer-overlay"></div>
    <div id="ed-drawer" class="ed-drawer" role="dialog" aria-modal="true" aria-label="Edit therapist profile"></div>
    <div id="ed-confirm-overlay" class="ed-confirm-overlay" role="dialog" aria-modal="true" aria-label="Confirm delete"></div>
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

  document
    .querySelectorAll("[data-tab-target]")
    .forEach((btn) =>
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-tab-target");
        if (target && target !== state.view) {
          state.view = target;
          renderDashboard();
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
  return `
    <div style="padding:14px 24px 0;flex-shrink:0;">
      <div id="profileSearchWidget" class="ps-widget-root" style="padding:0;"></div>
    </div>

    <div style="padding:14px 24px 0;flex-shrink:0;">
      <div style="font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">
        Outreach (your sends)
      </div>
      <div style="display:flex;gap:14px;">
        ${statCard("Total", stats.total, "#2a5f6e")}
        ${statCard("Contacted", stats.contacted, "#3b82f6")}
        ${statCard("Replied", stats.replied, "#7c3aed")}
        ${statCard("Reply rate", stats.replyRate + "%", "#f59e0b")}
      </div>
      <div style="margin-top:8px;font-size:12px;color:#6b7280;">
        ${stats.claimed} therapist${stats.claimed === 1 ? "" : "s"} have claimed —
        <button id="go-live-tab" style="background:none;border:none;padding:0;color:#2a5f6e;font-weight:600;text-decoration:underline;cursor:pointer;font-size:12px;">view on Live tab →</button>
      </div>
    </div>

    ${subjectPerformanceHtml(computeSubjectPerformance(state.therapists))}

    <div style="padding:14px 24px 0;flex-shrink:0;">
      <div style="font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:baseline;gap:8px;">
        <span>Patient signal (last 30 days)</span>
        <span id="patient-signal-trend" style="font-size:10px;font-weight:500;color:#6b7280;text-transform:none;letter-spacing:0;"></span>
      </div>
      <div id="patient-signal-row" style="display:flex;gap:14px;">
        ${patientSignalCardsHtml(state.patientSignal)}
      </div>
    </div>

    <div style="display:flex;gap:10px;align-items:center;padding:14px 24px;flex-shrink:0;flex-wrap:wrap;border-bottom:1px solid #e5e7eb;">
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
      <span id="result-count" style="margin-left:auto;font-size:13px;color:#6b7280;"></span>
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
        ${profileUrl ? `<a class="profile-link" href="${esc(profileUrl)}" target="_blank" rel="noopener" data-no-row-click style="margin-right:6px;display:inline-block;padding:4px 10px;border:1px solid #d1d5db;border-radius:6px;color:#2a5f6e;font-size:12px;text-decoration:none;">Profile ↗</a>` : ""}
        <button class="live-edit-btn btn-secondary" data-id="${esc(t._id)}" style="margin-right:6px;">Edit</button>
        <button class="view-btn btn-secondary" data-id="${esc(t._id)}">Email</button>
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
  const viewBtn = e.target.closest(".view-btn");
  const row = e.target.closest("tr[data-id]");
  const id = editBtn?.dataset.id || viewBtn?.dataset.id || row?.dataset.id;
  if (!id) return;
  if (e.target.closest("button") && !editBtn && !viewBtn) return;

  const t = state.therapists.find((x) => x._id === id);
  if (!t) return;

  if (editBtn) {
    openEditDrawer(t);
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
    const confirmOpen = document
      .getElementById("ed-confirm-overlay")
      ?.classList.contains("is-open");
    const drawerOpen = document.getElementById("ed-drawer")?.classList.contains("is-open");
    if (confirmOpen) {
      closeDeleteConfirm();
    } else if (drawerOpen) {
      closeEditDrawer();
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

function statCard(label, value, color) {
  return `<div style="flex:1;min-width:90px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;">
    <div style="font-size:22px;font-weight:700;color:${color};">${value}</div>
    <div style="font-size:12px;color:#6b7280;margin-top:2px;">${label}</div>
  </div>`;
}

function subjectPerformanceHtml(rows) {
  if (!rows || rows.length === 0) return "";
  return `
    <div style="padding:14px 24px 0;flex-shrink:0;">
      <div style="font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">
        Subject performance (initial sends)
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f9fafb;color:#6b7280;text-align:left;">
              <th style="padding:8px 14px;font-weight:600;">Subject</th>
              <th style="padding:8px 14px;font-weight:600;text-align:right;width:80px;">Sent</th>
              <th style="padding:8px 14px;font-weight:600;text-align:right;width:110px;">Opened</th>
              <th style="padding:8px 14px;font-weight:600;text-align:right;width:110px;">Replied</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (r) => `
              <tr style="border-top:1px solid #f3f4f6;">
                <td style="padding:8px 14px;color:#111827;max-width:480px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.subject)}">${esc(r.subject)}</td>
                <td style="padding:8px 14px;text-align:right;color:#374151;">${r.sent}</td>
                <td style="padding:8px 14px;text-align:right;color:#0ea5e9;">${r.opened} <span style="color:#9ca3af;font-size:11px;">(${r.openRate}%)</span></td>
                <td style="padding:8px 14px;text-align:right;color:#7c3aed;">${r.replied} <span style="color:#9ca3af;font-size:11px;">(${r.replyRate}%)</span></td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function patientSignalCardsHtml(signal) {
  if (!signal) {
    // Loading state — placeholder cards.
    return [
      statCard("Match requests", "…", "#9ca3af"),
      statCard("Profile views (7d)", "…", "#9ca3af"),
      statCard("CTA clicks (7d)", "…", "#9ca3af"),
      statCard("Trend", "…", "#9ca3af"),
    ].join("");
  }
  const mr = signal.matchRequests || {};
  const views = signal.profileViews || {};
  const clicks = signal.ctaClicks || {};
  const trend = mr.trend7dVsPrev7d || "flat";
  const trendStyle =
    trend === "growing"
      ? { label: "↑ growing", color: "#059669" }
      : trend === "declining"
        ? { label: "↓ declining", color: "#dc2626" }
        : { label: "→ flat", color: "#6b7280" };
  return [
    statCard(`Match requests (${mr.last30d || 0} this month)`, mr.last7d || 0, "#10b981"),
    statCard("Profile views (7d)", views.last7d || 0, "#0ea5e9"),
    statCard("CTA clicks (7d)", clicks.last7d || 0, "#8b5cf6"),
    statCard(trendStyle.label, "", trendStyle.color),
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
      const sent = t.outreach?.emailsSent || 0;
      const last = t.outreach?.lastContactedAt;
      const dueBg = isFollowUpDue(t) ? "background:#fffbeb;" : "";
      const channel = t.email ? "email" : getContactFormUrl(t) ? "form" : "";
      const sendLabel = !channel
        ? ""
        : s === "not_contacted"
          ? channel === "email"
            ? "Send email 1"
            : "Open form 1"
          : s === "email_1_sent" || s === "followed_up"
            ? channel === "email"
              ? "Send follow-up"
              : "Open form follow-up"
            : "";

      const profileUrl = safeProfileUrl(t.profileUrl);
      return `<tr data-id="${esc(t._id)}" style="cursor:pointer;${dueBg}">
      <td style="padding:11px 14px;font-weight:500;">${esc(t.name || "-")}</td>
      <td style="padding:11px 14px;color:#6b7280;">${esc(t.email || "-")}</td>
      <td style="padding:11px 14px;">${pill(s)}</td>
      <td style="padding:11px 14px;text-align:center;color:#6b7280;">${sent}</td>
      <td style="padding:11px 14px;color:#6b7280;">${relTime(last) || "-"}</td>
      <td style="padding:11px 14px;white-space:nowrap;">
        ${sendLabel ? `<button class="send-btn btn-secondary" data-id="${esc(t._id)}" style="margin-right:6px;color:#2a5f6e;border-color:#2a5f6e;">${sendLabel}</button>` : ""}
        ${profileUrl ? `<a class="profile-link" href="${esc(profileUrl)}" target="_blank" rel="noopener" data-no-row-click style="margin-right:6px;display:inline-block;padding:4px 10px;border:1px solid #d1d5db;border-radius:6px;color:#2a5f6e;font-size:12px;text-decoration:none;">Profile ↗</a>` : ""}
        <button class="view-btn btn-secondary" data-id="${esc(t._id)}">View</button>
      </td>
    </tr>`;
    })
    .join("");

  // Sortable headers: Status + Last contact have a click-to-sort
  // toggle. The arrow appears only on the active column.
  const headers = [
    { label: "Name" },
    { label: "Email" },
    { label: "Status", sortKey: "status" },
    { label: "Sent", align: "center" },
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
  // Profile link is a real <a target="_blank"> — let the browser handle it
  // and don't open the detail panel on top.
  if (e.target.closest("[data-no-row-click]")) return;

  const sendBtn = e.target.closest(".send-btn");
  const viewBtn = e.target.closest(".view-btn");
  const row = e.target.closest("tr[data-id]");

  const id = sendBtn?.dataset.id || viewBtn?.dataset.id || row?.dataset.id;
  if (!id) return;
  if (e.target.closest("button") && !sendBtn && !viewBtn) return;

  const t = state.therapists.find((x) => x._id === id);
  if (t) openPanel(t);
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
  const showQuickActions = ["email_1_sent", "followed_up"].includes(status);

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
              .map(
                (e) => `
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;margin-bottom:8px;font-size:13px;">
            <div style="font-weight:500;">${
              e.template?.startsWith("email_1") ? "Initial outreach" : "Follow-up"
            }${e.template?.endsWith("_via_form") ? " (contact form)" : ""}</div>
            <div style="color:#6b7280;font-size:12px;margin-top:2px;">${esc(e.subject)}</div>
            <div style="color:#9ca3af;font-size:12px;margin-top:2px;">${e.sentAt ? new Date(e.sentAt).toLocaleString() : "-"}</div>
          </div>`,
              )
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
// server too) — this just adapts the profileUrl to the placeholder the
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

function joinCsv(arr) {
  return Array.isArray(arr) ? arr.join(", ") : "";
}
function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
function selOption(value, label, current) {
  return `<option value="${esc(value)}" ${current === value ? "selected" : ""}>${esc(label)}</option>`;
}

function renderEditDrawerContent(t) {
  const profileUrl = safeProfileUrl(t.profileUrl);
  return `
    <div class="ed-drawer-header">
      <div>
        <div class="ed-drawer-title">${esc(t.name || "Unnamed")}</div>
        <div class="ed-drawer-subtitle">
          ${esc(t.email || "no email on file")}
          ${profileUrl ? ` · <a href="${esc(profileUrl)}" target="_blank" rel="noopener" style="color:#2a5f6e;">view live →</a>` : ""}
        </div>
      </div>
      <button id="ed-close" type="button" class="ed-drawer-close" aria-label="Close">&times;</button>
    </div>

    <div class="ed-drawer-body">
      <form id="ed-form" novalidate>

        <div class="ed-section">
          <div class="ed-section-title">Identity</div>
          <div class="ed-grid">
            <div class="ed-field is-full"><label>Full name</label>
              <input name="name" type="text" value="${esc(t.name || "")}" autocomplete="off" />
            </div>
            <div class="ed-field"><label>Credentials</label>
              <input name="credentials" type="text" value="${esc(t.credentials || "")}" placeholder="e.g. LMFT" autocomplete="off" />
            </div>
            <div class="ed-field"><label>Title</label>
              <input name="title" type="text" value="${esc(t.title || "")}" autocomplete="off" />
            </div>
            <div class="ed-field is-full"><label>Practice name</label>
              <input name="practiceName" type="text" value="${esc(t.practiceName || t.practice_name || "")}" autocomplete="off" />
            </div>
          </div>
        </div>

        <div class="ed-section">
          <div class="ed-section-title">Location</div>
          <div class="ed-grid">
            <div class="ed-field"><label>City</label>
              <input name="city" type="text" value="${esc(t.city || "")}" autocomplete="off" />
            </div>
            <div class="ed-field"><label>State</label>
              <input name="state" type="text" value="${esc(t.state || "")}" placeholder="CA" autocomplete="off" />
            </div>
            <div class="ed-field"><label>ZIP</label>
              <input name="zip" type="text" value="${esc(t.zip || "")}" autocomplete="off" />
            </div>
          </div>
        </div>

        <div class="ed-section">
          <div class="ed-section-title">License</div>
          <div class="ed-grid">
            <div class="ed-field"><label>License state</label>
              <input name="licenseState" type="text" value="${esc(t.licenseState || t.license_state || "")}" placeholder="CA" autocomplete="off" />
            </div>
            <div class="ed-field"><label>License number</label>
              <input name="licenseNumber" type="text" value="${esc(t.licenseNumber || t.license_number || "")}" autocomplete="off" />
            </div>
          </div>
        </div>

        <div class="ed-section">
          <div class="ed-section-title">Contact</div>
          <div class="ed-grid">
            <div class="ed-field"><label>Email</label>
              <input name="email" type="email" value="${esc(t.email || "")}" autocomplete="off" />
            </div>
            <div class="ed-field"><label>Phone</label>
              <input name="phone" type="tel" value="${esc(t.phone || "")}" autocomplete="off" />
            </div>
            <div class="ed-field"><label>Website</label>
              <input name="website" type="url" value="${esc(t.website || "")}" placeholder="https://" autocomplete="off" />
            </div>
            <div class="ed-field"><label>Booking URL</label>
              <input name="bookingUrl" type="url" value="${esc(t.bookingUrl || t.booking_url || "")}" placeholder="https://" autocomplete="off" />
            </div>
            <div class="ed-field is-full"><label>Preferred contact method</label>
              <select name="preferredContactMethod">
                ${selOption("", "— Not set —", t.preferredContactMethod || t.preferred_contact_method || "")}
                ${selOption("email", "Email", t.preferredContactMethod || t.preferred_contact_method)}
                ${selOption("phone", "Phone", t.preferredContactMethod || t.preferred_contact_method)}
                ${selOption("website", "Website", t.preferredContactMethod || t.preferred_contact_method)}
                ${selOption("booking", "Booking link", t.preferredContactMethod || t.preferred_contact_method)}
              </select>
            </div>
          </div>
        </div>

        <div class="ed-section">
          <div class="ed-section-title">Care approach</div>
          <div class="ed-grid is-full">
            <div class="ed-field"><label>Bio</label>
              <textarea name="bio" rows="4">${esc(t.bio || "")}</textarea>
            </div>
            <div class="ed-field"><label>How they help bipolar clients</label>
              <textarea name="careApproach" rows="3">${esc(t.careApproach || t.care_approach || "")}</textarea>
            </div>
            <div class="ed-field"><label>Specialties</label>
              <input name="specialties" type="text" value="${esc(joinCsv(t.specialties))}" autocomplete="off" />
              <div class="ed-hint">Comma-separated</div>
            </div>
            <div class="ed-field"><label>Treatment modalities</label>
              <input name="treatmentModalities" type="text" value="${esc(joinCsv(t.treatmentModalities || t.treatment_modalities))}" autocomplete="off" />
              <div class="ed-hint">Comma-separated</div>
            </div>
            <div class="ed-field"><label>Populations served</label>
              <input name="clientPopulations" type="text" value="${esc(joinCsv(t.clientPopulations || t.client_populations))}" autocomplete="off" />
              <div class="ed-hint">Comma-separated</div>
            </div>
            <div class="ed-field"><label>Insurance accepted</label>
              <input name="insuranceAccepted" type="text" value="${esc(joinCsv(t.insuranceAccepted || t.insurance_accepted))}" autocomplete="off" />
              <div class="ed-hint">Comma-separated</div>
            </div>
          </div>
        </div>

        <div class="ed-section">
          <div class="ed-section-title">Availability &amp; fees</div>
          <div class="ed-check-row" style="margin-bottom:10px;">
            <label class="ed-check"><input name="acceptsTelehealth" type="checkbox" ${t.acceptsTelehealth ? "checked" : ""}/> Telehealth</label>
            <label class="ed-check"><input name="acceptsInPerson" type="checkbox" ${t.acceptsInPerson ? "checked" : ""}/> In-person</label>
            <label class="ed-check"><input name="acceptingNewPatients" type="checkbox" ${t.acceptingNewPatients ? "checked" : ""}/> Accepting new patients</label>
            <label class="ed-check"><input name="slidingScale" type="checkbox" ${t.slidingScale ? "checked" : ""}/> Sliding scale</label>
          </div>
          <div class="ed-grid">
            <div class="ed-field"><label>Fee min ($)</label>
              <input name="sessionFeeMin" type="number" min="0" step="5" value="${t.sessionFeeMin ?? ""}" />
            </div>
            <div class="ed-field"><label>Fee max ($)</label>
              <input name="sessionFeeMax" type="number" min="0" step="5" value="${t.sessionFeeMax ?? ""}" />
            </div>
          </div>
        </div>

        <div class="ed-section">
          <div class="ed-section-title">Status &amp; visibility</div>
          <div class="ed-grid">
            <div class="ed-field"><label>Lifecycle</label>
              <select name="lifecycle">
                ${["draft", "in_review", "awaiting_confirmation", "approved", "paused", "archived"].map((v) => selOption(v, v.replace(/_/g, " "), t.lifecycle)).join("")}
              </select>
            </div>
            <div class="ed-field"><label>Visibility</label>
              <select name="visibilityIntent">
                ${selOption("listed", "Listed", t.visibilityIntent || t.visibility_intent)}
                ${selOption("hidden", "Hidden", t.visibilityIntent || t.visibility_intent)}
              </select>
            </div>
          </div>
        </div>

        <div class="ed-section">
          <div class="ed-section-title">Internal notes</div>
          <div class="ed-grid is-full">
            <div class="ed-field"><label>Admin-only notes</label>
              <textarea name="internalNotes" rows="3" placeholder="Notes visible only to the review team">${esc(t.notes || "")}</textarea>
            </div>
          </div>
        </div>

        <div class="ed-danger-zone">
          <div class="ed-danger-title">Danger zone</div>
          <div class="ed-danger-body">
            Deleting removes this therapist from the public directory and search. The Sanity document, outreach history, and email log are preserved, so this is reversible from Sanity Studio if needed.
          </div>
          <button id="ed-delete-btn" type="button" class="ed-delete-btn">Delete therapist</button>
        </div>

      </form>
    </div>

    <div class="ed-drawer-footer">
      <button id="ed-save-btn" type="button" class="btn-primary">Save changes</button>
      <button id="ed-cancel-btn" type="button" class="btn-secondary">Cancel</button>
      <span id="ed-save-status" class="ed-save-status"></span>
    </div>
  `;
}

let _drawerTherapistId = null;

function openEditDrawer(t) {
  _drawerTherapistId = t._id;
  const drawer = document.getElementById("ed-drawer");
  const overlay = document.getElementById("ed-drawer-overlay");
  if (!drawer || !overlay) return;
  drawer.innerHTML = renderEditDrawerContent(t);
  // Two-frame paint trick: set innerHTML, then add .is-open on the next
  // frame so the CSS transition actually animates the transform.
  // requestAnimationFrame is globally available in browsers; use a
  // function reference rather than the bare identifier so eslint's
  // no-undef rule (which doesn't know our env is browser-side) doesn't
  // flag it.
  window.requestAnimationFrame(() => {
    drawer.classList.add("is-open");
    overlay.classList.add("is-open");
  });
  setupEditDrawerListeners(t);
}

function closeEditDrawer() {
  const drawer = document.getElementById("ed-drawer");
  const overlay = document.getElementById("ed-drawer-overlay");
  if (drawer) drawer.classList.remove("is-open");
  if (overlay) overlay.classList.remove("is-open");
  _drawerTherapistId = null;
}

function readDrawerForm() {
  const form = document.getElementById("ed-form");
  if (!form) return {};
  const out = {};
  const stringFields = [
    "name",
    "credentials",
    "title",
    "practiceName",
    "city",
    "state",
    "zip",
    "licenseState",
    "licenseNumber",
    "email",
    "phone",
    "website",
    "bookingUrl",
    "preferredContactMethod",
    "bio",
    "careApproach",
    "lifecycle",
    "visibilityIntent",
    "internalNotes",
  ];
  stringFields.forEach((f) => {
    const el = form.elements.namedItem(f);
    if (el) out[f] = el.value.trim();
  });
  const arrayFields = [
    "specialties",
    "treatmentModalities",
    "clientPopulations",
    "insuranceAccepted",
  ];
  arrayFields.forEach((f) => {
    const el = form.elements.namedItem(f);
    if (el) out[f] = parseCsv(el.value);
  });
  const boolFields = [
    "acceptsTelehealth",
    "acceptsInPerson",
    "acceptingNewPatients",
    "slidingScale",
  ];
  boolFields.forEach((f) => {
    const el = form.elements.namedItem(f);
    if (el) out[f] = el.checked;
  });
  const feeMin = form.elements.namedItem("sessionFeeMin");
  const feeMax = form.elements.namedItem("sessionFeeMax");
  out.sessionFeeMin = feeMin && feeMin.value !== "" ? Number(feeMin.value) : null;
  out.sessionFeeMax = feeMax && feeMax.value !== "" ? Number(feeMax.value) : null;
  // State is conventionally uppercase. The server validator enforces it,
  // so coerce here too rather than yelling at the user.
  if (out.state) out.state = out.state.toUpperCase();
  if (out.licenseState) out.licenseState = out.licenseState.toUpperCase();
  return out;
}

async function saveDrawer() {
  if (!_drawerTherapistId) return;
  const status = document.getElementById("ed-save-status");
  const saveBtn = document.getElementById("ed-save-btn");
  if (status) {
    status.textContent = "Saving…";
    status.style.color = "#6b7280";
  }
  if (saveBtn) saveBtn.disabled = true;
  const payload = readDrawerForm();
  const r = await apiPatch(`/therapist/${encodeURIComponent(_drawerTherapistId)}`, payload);
  if (saveBtn) saveBtn.disabled = false;
  if (!r.ok) {
    const msg = r.data?.error || "Save failed.";
    if (status) {
      status.textContent = msg;
      status.style.color = "#dc2626";
    }
    toast(msg, "error");
    return;
  }
  // Merge server-returned doc into local state so the table + panel
  // reflect the save without a full reload.
  if (r.data?.doc) {
    const i = state.therapists.findIndex((x) => x._id === _drawerTherapistId);
    if (i !== -1) {
      state.therapists[i] = { ...state.therapists[i], ...mapServerDoc(r.data.doc) };
      refreshTable();
    }
  }
  if (status) {
    status.textContent = "Saved.";
    status.style.color = "#10b981";
  }
  toast("Profile saved", "success");
}

// Server returns the raw Sanity doc; the outreach list uses a slightly
// different field shape from the list endpoint's projection. Pull the
// fields that this page actually reads in render paths so the row + any
// reopened panel stay accurate without a full data refetch.
function mapServerDoc(doc) {
  return {
    name: doc.name,
    email: doc.email,
    phone: doc.phone,
    website: doc.website,
    city: doc.city,
    state: doc.state,
    licenseNumber: doc.licenseNumber,
    claimStatus: doc.claimStatus,
    listingActive: doc.listingActive,
    status: doc.status,
  };
}

function openDeleteConfirm(t) {
  const overlay = document.getElementById("ed-confirm-overlay");
  if (!overlay) return;
  const expected = String(t.name || "").trim();
  overlay.innerHTML = `
    <div class="ed-confirm-modal" role="document">
      <div class="ed-confirm-title">Delete this therapist?</div>
      <div class="ed-confirm-body">
        This removes <strong>${esc(expected)}</strong> from the public directory and search. Sanity history, outreach log, and emails are preserved — reversible from Sanity Studio.
        <div style="margin-top:10px;">Type <strong>${esc(expected)}</strong> to confirm:</div>
      </div>
      <input id="ed-confirm-input" class="ed-confirm-input" type="text" autocomplete="off" spellcheck="false" />
      <div class="ed-confirm-actions">
        <button id="ed-confirm-cancel" type="button" class="ed-confirm-cancel">Cancel</button>
        <button id="ed-confirm-delete" type="button" class="ed-confirm-delete" disabled>Delete therapist</button>
      </div>
    </div>
  `;
  overlay.classList.add("is-open");
  const input = document.getElementById("ed-confirm-input");
  const confirmBtn = document.getElementById("ed-confirm-delete");
  const cancelBtn = document.getElementById("ed-confirm-cancel");
  input?.focus();
  input?.addEventListener("input", () => {
    confirmBtn.disabled = input.value.trim() !== expected;
  });
  cancelBtn?.addEventListener("click", closeDeleteConfirm);
  confirmBtn?.addEventListener("click", () => performDelete(t));
}

function closeDeleteConfirm() {
  const overlay = document.getElementById("ed-confirm-overlay");
  if (overlay) overlay.classList.remove("is-open");
}

async function performDelete(t) {
  const confirmBtn = document.getElementById("ed-confirm-delete");
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Deleting…";
  }
  const r = await fetch(`${API}/therapist/${encodeURIComponent(t._id)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    toast(data?.error || "Delete failed.", "error");
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Delete therapist";
    }
    return;
  }
  // Remove from local state, close everything, refresh the table.
  state.therapists = state.therapists.filter((x) => x._id !== t._id);
  closeDeleteConfirm();
  closeEditDrawer();
  refreshTable();
  toast(`Deleted ${t.name || "therapist"}.`, "success");
}

function setupEditDrawerListeners(t) {
  document.getElementById("ed-close")?.addEventListener("click", closeEditDrawer);
  document.getElementById("ed-cancel-btn")?.addEventListener("click", closeEditDrawer);
  document.getElementById("ed-drawer-overlay")?.addEventListener("click", closeEditDrawer);
  document.getElementById("ed-save-btn")?.addEventListener("click", saveDrawer);
  document.getElementById("ed-delete-btn")?.addEventListener("click", () => openDeleteConfirm(t));
}

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
  document.getElementById("go-live-tab")?.addEventListener("click", () => {
    state.view = "live";
    renderDashboard();
  });

  document.getElementById("panel-overlay")?.addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Layered escape: close the topmost open thing first. Confirm modal
    // beats drawer beats panel.
    const confirmOpen = document
      .getElementById("ed-confirm-overlay")
      ?.classList.contains("is-open");
    const drawerOpen = document.getElementById("ed-drawer")?.classList.contains("is-open");
    if (confirmOpen) {
      closeDeleteConfirm();
    } else if (drawerOpen) {
      closeEditDrawer();
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
    openEditDrawer(t);
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
        th.outreach.status = composer.template === "email_1" ? "email_1_sent" : "followed_up";
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

    btn.disabled = true;
    btn.textContent = "Sending…";

    const { ok, data } = await apiPost("/send-email", {
      therapistId: t._id,
      template: composer.template,
      subject: composer.subject,
      body: composer.body,
    });
    btn.disabled = false;
    btn.textContent = "Send email";

    if (ok) {
      toast("Email sent!");
      const now = new Date().toISOString();
      mutateTherapist(t._id, (th) => {
        if (!th.outreach) th.outreach = {};
        th.outreach.status = composer.template === "email_1" ? "email_1_sent" : "followed_up";
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
    renderDashboard();
  } else {
    redirectToAdminLogin();
  }
}

init();
