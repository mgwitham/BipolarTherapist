// Admin recovery queue dashboard. Therapists who lost access to their
// on-file email submit a therapistRecoveryRequest. This module lists
// pending/resolved requests and wires approve/reject actions. Identity
// is verified manually by the admin (DCA lookup, phone call, etc.)
// before clicking Approve.

import {
  approveRecoveryRequest,
  fetchRecoveryRequests,
  rejectRecoveryRequest,
} from "./review-api.js";

const DASHBOARD_ID = "adminRecoveryDashboard";
const REFRESH_ID = "adminRecoveryRefresh";
const STATUS_ID = "adminRecoveryStatus";
const TAB_COUNT_ID = "navCountRecovery";

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
}

function dcaLookupUrl(license) {
  // CA DCA license search takes the license number via query string.
  // Opens in new tab so admin can eyeball the result without losing place.
  return (
    "https://search.dca.ca.gov/results?BD=" +
    encodeURIComponent("") +
    "&TP=" +
    encodeURIComponent("") +
    "&LN=" +
    encodeURIComponent("") +
    "&FN=" +
    encodeURIComponent("") +
    "&licenseNumber=" +
    encodeURIComponent(license || "")
  );
}

function renderRequestCard(req) {
  const statusClass =
    req.status === "approved"
      ? "is-approved"
      : req.status === "rejected"
        ? "is-rejected"
        : "is-pending";
  const nameMismatch =
    req.profileName &&
    req.fullName &&
    req.profileName.trim().toLowerCase() !== req.fullName.trim().toLowerCase();
  const domainCheck = (() => {
    if (!req.requestedEmail || !req.profileEmailHint) return "";
    const reqDomain = String(req.requestedEmail).split("@")[1] || "";
    // profileEmailHint is masked (j***@d***.com), so strict domain comparison
    // isn't possible. Just surface the requested domain for the reviewer.
    return reqDomain;
  })();

  return (
    '<article class="admin-recovery-card ' +
    statusClass +
    '" data-request-id="' +
    escapeHtml(req._id) +
    '">' +
    '<header class="admin-recovery-head">' +
    '<div><span class="admin-recovery-status-pill admin-recovery-status-' +
    escapeHtml(req.status) +
    '">' +
    escapeHtml(req.status) +
    "</span>" +
    (nameMismatch ? '<span class="admin-recovery-flag">⚠ name differs from profile</span>' : "") +
    "</div>" +
    '<span class="admin-recovery-time">' +
    escapeHtml(formatDate(req.createdAt)) +
    "</span>" +
    "</header>" +
    '<h3 class="admin-recovery-name">' +
    escapeHtml(req.fullName || "(no name)") +
    (req.licenseNumber
      ? ' · <a href="' +
        escapeHtml(dcaLookupUrl(req.licenseNumber)) +
        '" target="_blank" rel="noopener">License ' +
        escapeHtml(req.licenseNumber) +
        " ↗</a>"
      : "") +
    "</h3>" +
    '<dl class="admin-recovery-fields">' +
    "<dt>Requested email</dt><dd><strong>" +
    escapeHtml(req.requestedEmail || "—") +
    "</strong>" +
    (domainCheck ? " <small>(domain: " + escapeHtml(domainCheck) + ")</small>" : "") +
    "</dd>" +
    "<dt>Prior email (remembered)</dt><dd>" +
    escapeHtml(req.priorEmail || "—") +
    "</dd>" +
    "<dt>Profile name on record</dt><dd>" +
    escapeHtml(req.profileName || "(no matching profile)") +
    "</dd>" +
    "<dt>Profile email on record</dt><dd>" +
    escapeHtml(req.profileEmailHint || "—") +
    "</dd>" +
    (req.profileClaimedEmail
      ? "<dt>Previously claimed by</dt><dd>" + escapeHtml(req.profileClaimedEmail) + "</dd>"
      : "") +
    (req.therapistSlug
      ? '<dt>Therapist profile</dt><dd><a href="/therapist.html?slug=' +
        escapeHtml(req.therapistSlug) +
        '" target="_blank" rel="noopener">/therapist?slug=' +
        escapeHtml(req.therapistSlug) +
        " ↗</a></dd>"
      : "") +
    "<dt>Reason</dt><dd>" +
    escapeHtml(req.reason || "—").replace(/\n/g, "<br/>") +
    "</dd>" +
    (req.requesterIp
      ? "<dt>Requester IP</dt><dd><code>" + escapeHtml(req.requesterIp) + "</code></dd>"
      : "") +
    (req.reviewedAt
      ? "<dt>Reviewed</dt><dd>" +
        escapeHtml(formatDate(req.reviewedAt)) +
        (req.reviewedBy ? " by " + escapeHtml(req.reviewedBy) : "") +
        "</dd>"
      : "") +
    (req.outcomeMessage
      ? "<dt>Message sent</dt><dd><em>" +
        escapeHtml(req.outcomeMessage).replace(/\n/g, "<br/>") +
        "</em></dd>"
      : "") +
    (req.adminNote
      ? "<dt>Admin note</dt><dd><em>" +
        escapeHtml(req.adminNote).replace(/\n/g, "<br/>") +
        "</em></dd>"
      : "") +
    "</dl>" +
    (req.status === "pending"
      ? '<div class="admin-recovery-actions">' +
        '<textarea class="admin-recovery-outcome" data-for="' +
        escapeHtml(req._id) +
        '" placeholder="Message for the therapist (optional, included in the email)" rows="2"></textarea>' +
        '<div class="admin-recovery-buttons">' +
        '<button type="button" class="btn-primary admin-recovery-approve" data-request-id="' +
        escapeHtml(req._id) +
        '">Approve + send sign-in link</button>' +
        '<button type="button" class="btn-secondary admin-recovery-reject" data-request-id="' +
        escapeHtml(req._id) +
        '">Reject</button>' +
        "</div>" +
        '<div class="admin-recovery-feedback" data-feedback-for="' +
        escapeHtml(req._id) +
        '" hidden></div>' +
        "</div>"
      : "") +
    "</article>"
  );
}

function renderDashboard(container, requests) {
  const pending = requests.filter((r) => r.status === "pending");
  const resolved = requests.filter((r) => r.status !== "pending");

  const parts = [];
  parts.push(
    '<section class="admin-recovery-section">' +
      "<h3>Pending review — " +
      pending.length +
      "</h3>" +
      (pending.length
        ? pending.map(renderRequestCard).join("")
        : '<p class="subtle">No pending requests.</p>') +
      "</section>",
  );
  if (resolved.length) {
    parts.push(
      '<section class="admin-recovery-section">' +
        "<h3>Resolved — last " +
        resolved.length +
        "</h3>" +
        resolved.slice(0, 20).map(renderRequestCard).join("") +
        "</section>",
    );
  }
  container.innerHTML = parts.join("");

  updateTabCount(pending.length);
  bindCardActions(container);
}

function updateTabCount(pendingCount) {
  const el = document.getElementById(TAB_COUNT_ID);
  if (!el) return;
  if (pendingCount > 0) {
    el.textContent = String(pendingCount);
    el.hidden = false;
  } else {
    el.textContent = "";
    el.hidden = true;
  }
}

function setFeedback(requestId, tone, message) {
  const node = document.querySelector('[data-feedback-for="' + requestId + '"]');
  if (!node) return;
  node.hidden = false;
  node.setAttribute("data-tone", tone);
  node.textContent = message;
}

function bindCardActions(container) {
  container.querySelectorAll(".admin-recovery-approve").forEach(function (button) {
    button.addEventListener("click", async function () {
      const id = button.getAttribute("data-request-id");
      const outcomeBox = container.querySelector('.admin-recovery-outcome[data-for="' + id + '"]');
      const outcomeMessage = outcomeBox ? outcomeBox.value : "";
      if (!window.confirm("Approve this recovery? This sends a sign-in link to the therapist.")) {
        return;
      }
      button.disabled = true;
      setFeedback(id, "info", "Approving and sending sign-in link...");
      try {
        await approveRecoveryRequest(id, { outcome_message: outcomeMessage });
        setFeedback(id, "success", "Approved. Email sent.");
        window.setTimeout(loadRecoveryDashboard, 800);
      } catch (error) {
        setFeedback(id, "warn", (error && error.message) || "Approval failed.");
        button.disabled = false;
      }
    });
  });
  container.querySelectorAll(".admin-recovery-reject").forEach(function (button) {
    button.addEventListener("click", async function () {
      const id = button.getAttribute("data-request-id");
      const outcomeBox = container.querySelector('.admin-recovery-outcome[data-for="' + id + '"]');
      const outcomeMessage = outcomeBox ? outcomeBox.value : "";
      if (!window.confirm("Reject this recovery? The therapist will be notified by email.")) {
        return;
      }
      button.disabled = true;
      setFeedback(id, "info", "Rejecting and notifying...");
      try {
        await rejectRecoveryRequest(id, { outcome_message: outcomeMessage });
        setFeedback(id, "success", "Rejected. Email sent.");
        window.setTimeout(loadRecoveryDashboard, 800);
      } catch (error) {
        setFeedback(id, "warn", (error && error.message) || "Reject failed.");
        button.disabled = false;
      }
    });
  });
}

async function loadRecoveryDashboard() {
  const container = document.getElementById(DASHBOARD_ID);
  const status = document.getElementById(STATUS_ID);
  if (!container) return;
  if (status) {
    status.textContent = "Loading...";
    status.hidden = false;
  }
  try {
    const result = await fetchRecoveryRequests();
    if (status) status.hidden = true;
    renderDashboard(container, (result && result.requests) || []);
  } catch (error) {
    if (status) {
      status.hidden = false;
      status.textContent =
        "Couldn't load recovery queue: " + (error && error.message ? error.message : "unknown");
    }
  }
}

function bindDashboard() {
  const refresh = document.getElementById(REFRESH_ID);
  if (refresh) refresh.addEventListener("click", loadRecoveryDashboard);

  const observer = new window.MutationObserver(function () {
    if (document.body.getAttribute("data-admin-view") === "recovery") {
      loadRecoveryDashboard();
    }
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ["data-admin-view"] });
  if (document.body.getAttribute("data-admin-view") === "recovery") {
    loadRecoveryDashboard();
  }

  // Also load pending count on admin load so the tab badge is populated
  // even when the admin hasn't clicked into the tab yet.
  loadRecoveryDashboard();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindDashboard);
} else {
  bindDashboard();
}
