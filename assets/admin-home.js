// Admin Home dashboard, the morning briefing.
//
// Three cards, one screen:
//   1. Revenue (MRR, active subs, new/past due), fetches /api/review/stripe/admin/metrics
//   2. Today's queue, counts pulled from already-loaded admin state arrays
//   3. Outreach replies awaiting attention, fetches /api/admin/therapists and
//      counts non-terminal statuses sent more than a day ago.
//
// Each card refreshes when the host calls renderAdminHome({ applications,
// candidates, portalRequests }). The reply count auto-refreshes on a 60s
// interval because the underlying status is changed in another surface.
import { escapeHtml as esc } from "./escape-html.js";

const REVIEW_API = "/api/review";
const ADMIN_API = "/api/admin";
const RELOAD_INTERVAL_MS = 60_000;

let _state = { applications: [], candidates: [], portalRequests: [] };
let _replyRefreshTimer = null;

function fmtCurrencyCents(cents, currency) {
  const dollars = Number(cents || 0) / 100;
  const cur = String(currency || "usd").toUpperCase();
  if (cur === "USD") {
    return "$" + dollars.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return cur + " " + dollars.toLocaleString();
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

// ─── Revenue card ─────────────────────────────────────────────────

async function fetchStripeMetrics() {
  try {
    const r = await fetch(`${REVIEW_API}/stripe/admin/metrics`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    return (data && data.metrics) || null;
  } catch {
    return null;
  }
}

function renderRevenueEmpty(message) {
  setText("adminHomeRevenueStatus", "");
  setHTML("adminHomeRevenueBody", `<p class="admin-home-card-empty">${esc(message)}</p>`);
}

function renderRevenue(metrics) {
  if (!metrics) {
    renderRevenueEmpty("Stripe data unavailable.");
    return;
  }
  if (!metrics.total_subs) {
    renderRevenueEmpty("No subscriptions yet, first paid signup will appear here.");
    setText("adminHomeRevenueStatus", "0 active");
    return;
  }
  setText("adminHomeRevenueStatus", `${metrics.active_subscribers} active`);
  const mrr = fmtCurrencyCents(metrics.mrr_cents, metrics.currency);
  const rows = [
    { label: "MRR", value: mrr, big: true },
    { label: "Active", value: String(metrics.active_subscribers) },
    { label: "Trialing", value: String(metrics.trialing) },
    { label: "New this month", value: String(metrics.new_this_month) },
  ];
  if (metrics.past_due > 0) {
    rows.push({ label: "Past due", value: String(metrics.past_due), warn: true });
  }
  if (metrics.lost_this_month > 0) {
    rows.push({ label: "Lost this month", value: String(metrics.lost_this_month), warn: true });
  }
  setHTML(
    "adminHomeRevenueBody",
    `<dl class="admin-home-metric-grid">${rows
      .map(
        (r) =>
          `<div class="admin-home-metric${r.big ? " is-headline" : ""}${
            r.warn ? " is-warn" : ""
          }"><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`,
      )
      .join("")}</dl>`,
  );
}

// ─── Today's Queue card ───────────────────────────────────────────

function countOpenPortalRequests(portalRequests) {
  if (!Array.isArray(portalRequests)) return 0;
  return portalRequests.filter(function (r) {
    const status = String(r.status || r.review_status || "").toLowerCase();
    // Terminal statuses are anything resolved. Treat empty/unknown as open
    // so a malformed record still surfaces for review.
    return !["resolved", "completed", "rejected", "closed"].includes(status);
  }).length;
}

function countPendingApplications(applications) {
  if (!Array.isArray(applications)) return 0;
  return applications.filter(function (a) {
    return String(a.status || "").toLowerCase() === "pending";
  }).length;
}

function countCandidatesNeedingReview(candidates) {
  if (!Array.isArray(candidates)) return 0;
  return candidates.filter(function (c) {
    const status = String(c.review_status || "").toLowerCase();
    return status !== "published" && status !== "archived" && status !== "rejected_duplicate";
  }).length;
}

function renderQueueCard() {
  const items = [
    {
      label: "Applications pending review",
      count: countPendingApplications(_state.applications),
      href: "#review",
      cta: "Open Review →",
    },
    {
      label: "Candidates awaiting publish decision",
      count: countCandidatesNeedingReview(_state.candidates),
      href: "#review",
      cta: "Open Review →",
    },
    {
      label: "Portal requests (claim / pause / remove)",
      count: countOpenPortalRequests(_state.portalRequests),
      href: "#inbox",
      cta: "Open Inbox →",
    },
  ];

  const total = items.reduce((sum, i) => sum + i.count, 0);
  setText("adminHomeQueueStatus", total === 0 ? "All clear" : String(total) + " open");

  const listEl = document.getElementById("adminHomeQueueList");
  if (!listEl) return;
  if (total === 0) {
    listEl.innerHTML =
      '<li class="admin-home-queue-empty">Nothing in the queue, enjoy the quiet.</li>';
    return;
  }

  listEl.innerHTML = items
    .filter((i) => i.count > 0)
    .map(
      (i) =>
        `<li class="admin-home-queue-row">
          <span class="admin-home-queue-count">${i.count}</span>
          <span class="admin-home-queue-label">${esc(i.label)}</span>
          <a class="admin-home-queue-cta" href="${esc(i.href)}">${esc(i.cta)}</a>
        </li>`,
    )
    .join("");
}

// ─── Outreach replies card ────────────────────────────────────────

async function fetchOutreachAwaitingReply() {
  try {
    const r = await fetch(`${ADMIN_API}/therapists`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    if (!Array.isArray(data)) return null;

    // Awaiting reply: an outreach email was sent (or a follow-up was) and
    // the status hasn't moved to a terminal value. We exclude profiles
    // contacted in the last 24h to give the auto-reply window time to land
    //, those don't need admin attention yet.
    const MS_DAY = 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - MS_DAY;
    const open = data.filter(function (t) {
      const status = String((t.outreach && t.outreach.status) || "").toLowerCase();
      if (status !== "email_1_sent" && status !== "followed_up") return false;
      const lastAt = t.outreach && t.outreach.lastContactedAt;
      if (!lastAt) return false;
      return new Date(lastAt).getTime() < cutoff;
    });
    return open;
  } catch {
    return null;
  }
}

function renderRepliesCard(open) {
  const statusEl = document.getElementById("adminHomeRepliesStatus");
  const bodyEl = document.getElementById("adminHomeRepliesBody");
  if (!statusEl || !bodyEl) return;

  if (open == null) {
    statusEl.textContent = "";
    bodyEl.innerHTML = '<p class="admin-home-card-empty">Outreach data unavailable.</p>';
    return;
  }

  const count = open.length;
  statusEl.textContent = count === 0 ? "All clear" : String(count) + " open";

  if (count === 0) {
    bodyEl.innerHTML =
      '<p class="admin-home-card-empty">No outreach is sitting unread, every sent email has hit a terminal status.</p>';
    return;
  }

  // Show the 5 oldest first so the most overdue rise to the top.
  const sorted = open.slice().sort(function (a, b) {
    const ta = new Date(a.outreach.lastContactedAt).getTime();
    const tb = new Date(b.outreach.lastContactedAt).getTime();
    return ta - tb;
  });
  const preview = sorted.slice(0, 5);
  const days = (iso) => {
    const ms = Date.now() - new Date(iso).getTime();
    return Math.max(1, Math.floor(ms / (24 * 60 * 60 * 1000)));
  };

  const previewHtml = preview
    .map(
      (t) =>
        `<li class="admin-home-replies-row">
          <span class="admin-home-replies-name">${esc(t.name || "")}</span>
          <span class="admin-home-replies-age">${days(t.outreach.lastContactedAt)}d ago</span>
        </li>`,
    )
    .join("");

  bodyEl.innerHTML =
    `<p class="admin-home-replies-lede">
      ${count} outreach ${count === 1 ? "email" : "emails"} sent more than 24h ago without a reply, bounce, or opt-out logged.
      Check Gmail and mark each one in the Outreach CRM.
    </p>
    <ul class="admin-home-replies-list">${previewHtml}</ul>` +
    (count > 5 ? `<p class="admin-home-replies-more">+ ${count - 5} more</p>` : "");
}

// ─── Public API ───────────────────────────────────────────────────

export async function renderAdminHome(stateUpdate) {
  if (stateUpdate && typeof stateUpdate === "object") {
    if (Array.isArray(stateUpdate.applications)) _state.applications = stateUpdate.applications;
    if (Array.isArray(stateUpdate.candidates)) _state.candidates = stateUpdate.candidates;
    if (Array.isArray(stateUpdate.portalRequests))
      _state.portalRequests = stateUpdate.portalRequests;
  }

  // Queue card renders synchronously from the already-loaded admin state.
  renderQueueCard();

  // Revenue + replies fetch in parallel.
  const [metrics, open] = await Promise.all([fetchStripeMetrics(), fetchOutreachAwaitingReply()]);
  renderRevenue(metrics);
  renderRepliesCard(open);

  // Schedule the reply refresh (idempotent, clear any prior timer).
  if (_replyRefreshTimer) window.clearInterval(_replyRefreshTimer);
  _replyRefreshTimer = window.setInterval(async function () {
    if (document.body.getAttribute("data-admin-view") !== "home") return;
    const fresh = await fetchOutreachAwaitingReply();
    renderRepliesCard(fresh);
  }, RELOAD_INTERVAL_MS);
}
