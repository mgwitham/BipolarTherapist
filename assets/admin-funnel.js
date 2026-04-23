// Admin funnel dashboard. Reads the singleton funnelEventLog via
// GET /analytics/events and renders:
//   - Headline event counts for 24h / 7d / 30d windows
//   - Signup + claim funnel with conversion + drop-off
//   - Recent events stream (last 50)
//
// Pure client-side aggregation — the log is a flat event list, we
// bucket here. No chart library, just DOM.

import { fetchFunnelEventLog } from "./review-api.js";

const DASHBOARD_ID = "adminFunnelDashboard";
const REFRESH_ID = "adminFunnelRefresh";
const STATUS_ID = "adminFunnelStatus";

const SIGNUP_STEPS = [
  { key: "signup_page_viewed", label: "Viewed signup" },
  { key: "signup_already_listed_search_started", label: "Started search" },
  { key: "signup_new_listing_form_started", label: "Started form" },
  { key: "signup_new_listing_submit_attempted", label: "Attempted submit" },
  { key: "signup_new_listing_submitted", label: "Submitted" },
];

const CLAIM_STEPS = [
  { key: "claim_page_viewed", label: "Viewed claim" },
  { key: "claim_listing_picked", label: "Picked listing" },
  { key: "claim_trial_clicked", label: "Clicked trial" },
  { key: "claim_trial_checkout_opened", label: "Opened Stripe" },
];

// Portal edit-form funnel. Tracks the post-claim path a therapist
// takes from "landed on portal" through "profile is match-ready."
// This is the primary metric driver for the portal UX work — if
// fewer therapists reach "portal_readiness_crossed_65", the polish
// isn't converting the way we expect.
const PORTAL_STEPS = [
  { key: "portal_opened", label: "Opened portal" },
  { key: "portal_first_edit", label: "First edit" },
  { key: "portal_save_success", label: "Saved changes" },
  { key: "portal_readiness_crossed_65", label: "Readiness ≥ 65" },
  { key: "portal_readiness_crossed_85", label: "Match-ready (≥ 85)" },
];

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function parsePayload(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_error) {
    return {};
  }
}

function countEventsWithin(events, millisAgo, type) {
  const cutoff = Date.now() - millisAgo;
  return events.filter(function (event) {
    if (event.type !== type) return false;
    const at = new Date(event.occurredAt || 0).getTime();
    return Number.isFinite(at) && at >= cutoff;
  }).length;
}

function buildFunnelRow(events, steps, window) {
  const cells = steps.map(function (step) {
    return {
      label: step.label,
      count: countEventsWithin(events, window.ms, step.key),
    };
  });
  const first = cells[0] ? cells[0].count : 0;
  return cells.map(function (cell, index) {
    if (index === 0) {
      return { ...cell, conversion: 100, delta: 0 };
    }
    const prev = cells[index - 1].count || 0;
    const conversion = first === 0 ? 0 : Math.round((cell.count / first) * 100);
    const dropoff = prev === 0 ? 0 : Math.round(((prev - cell.count) / prev) * 100);
    return { ...cell, conversion, dropoff };
  });
}

function renderFunnelTable(title, rows) {
  return (
    '<table class="admin-funnel-table">' +
    '<thead><tr><th>Step</th><th class="r">Count</th><th class="r">% of entries</th><th class="r">Drop-off</th></tr></thead>' +
    "<tbody>" +
    rows
      .map(function (row, index) {
        const dropoffCell =
          index === 0
            ? "—"
            : row.dropoff > 0
              ? '<span class="admin-funnel-dropoff">-' + row.dropoff + "%</span>"
              : "0%";
        return (
          "<tr>" +
          '<td class="admin-funnel-step">' +
          escapeHtml(row.label) +
          "</td>" +
          '<td class="r">' +
          row.count +
          "</td>" +
          '<td class="r">' +
          (row.conversion || 0) +
          "%</td>" +
          '<td class="r">' +
          dropoffCell +
          "</td>" +
          "</tr>"
        );
      })
      .join("") +
    "</tbody></table>" +
    '<p class="admin-funnel-caption">' +
    escapeHtml(title) +
    "</p>"
  );
}

function renderHeadlineCounts(events) {
  const windows = [
    { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
    { label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
    { label: "30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  ];
  const keyEvents = [
    "signup_page_viewed",
    "signup_new_listing_submitted",
    "claim_page_viewed",
    "claim_trial_checkout_opened",
  ];
  return (
    '<div class="admin-funnel-headline-grid">' +
    windows
      .map(function (window) {
        return (
          '<div class="admin-funnel-headline-card">' +
          '<h4 class="admin-funnel-headline-card-title">Last ' +
          escapeHtml(window.label) +
          "</h4>" +
          '<dl class="admin-funnel-headline-stats">' +
          keyEvents
            .map(function (key) {
              const count = countEventsWithin(events, window.ms, key);
              return (
                "<dt>" + escapeHtml(key.replace(/_/g, " ")) + "</dt>" + "<dd>" + count + "</dd>"
              );
            })
            .join("") +
          "</dl>" +
          "</div>"
        );
      })
      .join("") +
    "</div>"
  );
}

function renderWaitlistByState(events) {
  var signups = events.filter(function (e) {
    return e.type === "waitlist_signup";
  });
  if (!signups.length) {
    return '<p class="admin-funnel-empty">No out-of-state waitlist signups yet.</p>';
  }
  var byState = {};
  signups.forEach(function (e) {
    var p = parsePayload(e.payload);
    var state = (p && p.state) || "—";
    if (!byState[state]) byState[state] = { count: 0, recent: [] };
    byState[state].count += 1;
    if (byState[state].recent.length < 5) {
      byState[state].recent.push({
        email: (p && p.email) || "",
        at: e.occurredAt || "",
      });
    }
  });
  var sorted = Object.keys(byState).sort(function (a, b) {
    return byState[b].count - byState[a].count;
  });
  var rows = sorted
    .map(function (state) {
      var bucket = byState[state];
      var recentBits = bucket.recent
        .map(function (r) {
          return (
            escapeHtml(r.email) +
            ' <span style="color:#6b8290">(' +
            escapeHtml(r.at.slice(0, 10)) +
            ")</span>"
          );
        })
        .join("<br>");
      return (
        "<tr>" +
        '<td class="admin-funnel-step">' +
        escapeHtml(state) +
        "</td>" +
        '<td class="r">' +
        bucket.count +
        "</td>" +
        "<td>" +
        recentBits +
        "</td>" +
        "</tr>"
      );
    })
    .join("");
  return (
    '<table class="admin-funnel-table">' +
    '<thead><tr><th>State</th><th class="r">Signups</th><th>Recent emails</th></tr></thead>' +
    "<tbody>" +
    rows +
    "</tbody></table>" +
    '<p class="admin-funnel-caption">' +
    signups.length +
    " total out-of-state signups</p>"
  );
}

function renderRecentEvents(events) {
  if (!events.length) {
    return '<p class="admin-funnel-empty">No events logged yet. Trigger one by visiting /signup or /claim.</p>';
  }
  return (
    '<ul class="admin-funnel-recent">' +
    events
      .slice(0, 50)
      .map(function (event) {
        const payload = parsePayload(event.payload);
        const payloadBits = Object.keys(payload)
          .slice(0, 4)
          .map(function (key) {
            return key + "=" + String(payload[key]).slice(0, 60);
          })
          .join(", ");
        return (
          '<li class="admin-funnel-recent-item">' +
          '<span class="admin-funnel-recent-time">' +
          escapeHtml(event.occurredAt || "") +
          "</span>" +
          '<span class="admin-funnel-recent-type">' +
          escapeHtml(event.type) +
          "</span>" +
          (payloadBits
            ? '<span class="admin-funnel-recent-payload">' + escapeHtml(payloadBits) + "</span>"
            : "") +
          "</li>"
        );
      })
      .join("") +
    "</ul>"
  );
}

function renderDashboard(container, logData) {
  const events = Array.isArray(logData.events) ? logData.events : [];
  const lastSevenDays = { ms: 7 * 24 * 60 * 60 * 1000 };
  const signupRows = buildFunnelRow(events, SIGNUP_STEPS, lastSevenDays);
  const claimRows = buildFunnelRow(events, CLAIM_STEPS, lastSevenDays);
  const portalRows = buildFunnelRow(events, PORTAL_STEPS, lastSevenDays);

  const totalAppended = Number(logData.totalAppended || 0);
  const updatedAt = logData.updatedAt || "never";

  container.innerHTML =
    '<section class="admin-funnel-section"><h3>At a glance</h3>' +
    renderHeadlineCounts(events) +
    "</section>" +
    '<section class="admin-funnel-section"><h3>Signup funnel — last 7 days</h3>' +
    renderFunnelTable("% shown relative to users who reached step 1", signupRows) +
    "</section>" +
    '<section class="admin-funnel-section"><h3>Claim + trial funnel — last 7 days</h3>' +
    renderFunnelTable("% shown relative to users who reached step 1", claimRows) +
    "</section>" +
    '<section class="admin-funnel-section"><h3>Portal completion funnel — last 7 days</h3>' +
    renderFunnelTable("% shown relative to therapists who opened the portal", portalRows) +
    "</section>" +
    '<section class="admin-funnel-section"><h3>Out-of-state waitlist interest</h3>' +
    renderWaitlistByState(events) +
    "</section>" +
    '<p class="admin-funnel-meta">Buffer holds last 500 events · ' +
    totalAppended +
    " total appended · updated " +
    escapeHtml(updatedAt) +
    "</p>";

  const recentContainer = document.getElementById("adminFunnelRecentEvents");
  if (recentContainer) {
    recentContainer.innerHTML =
      '<section class="admin-funnel-section"><details class="admin-funnel-recent-details"><summary><h3 style="display:inline;margin:0">Recent events (last 50)</h3></summary>' +
      renderRecentEvents(events) +
      "</details></section>";
  }
}

async function loadFunnelDashboard() {
  const container = document.getElementById(DASHBOARD_ID);
  const status = document.getElementById(STATUS_ID);
  if (!container) return;
  if (status) {
    status.textContent = "Loading funnel...";
    status.hidden = false;
  }
  try {
    const result = await fetchFunnelEventLog();
    if (status) status.hidden = true;
    renderDashboard(container, result || {});
  } catch (error) {
    if (status) {
      status.hidden = false;
      status.textContent =
        "Couldn't load funnel: " + (error && error.message ? error.message : "unknown error");
    }
  }
}

function bindFunnelDashboard() {
  const refresh = document.getElementById(REFRESH_ID);
  if (refresh) {
    refresh.addEventListener("click", function () {
      loadFunnelDashboard();
    });
  }
  // Load when the admin-view tab becomes "reports" so funnel analysis stays
  // with other reporting surfaces instead of competing with queue work.
  const observer = new window.MutationObserver(function () {
    if (document.body.getAttribute("data-admin-view") === "reports") {
      loadFunnelDashboard();
    }
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ["data-admin-view"] });
  // Also load once on init if already on the reports tab.
  if (document.body.getAttribute("data-admin-view") === "reports") {
    loadFunnelDashboard();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindFunnelDashboard);
} else {
  bindFunnelDashboard();
}

// Exported for tests.
export { buildFunnelRow, countEventsWithin, SIGNUP_STEPS, CLAIM_STEPS };
