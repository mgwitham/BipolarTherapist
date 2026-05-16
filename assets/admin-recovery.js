// Admin recovery queue dashboard. Therapists who lost access to their
// on-file email submit a therapistRecoveryRequest. This module lists
// pending/resolved requests and wires approve/reject actions. Identity
// is verified manually by the admin (DCA lookup, phone call, etc.)
// before clicking Approve.

import { escapeHtml } from "./escape-html.js";
import {
  approveRecoveryRequest,
  dismissRecoveryRequest,
  fetchRecoveryRequests,
  rejectRecoveryRequest,
  resendRecoverySignin,
} from "./review-api.js";

const DASHBOARD_ID = "adminRecoveryDashboard";
const REFRESH_ID = "adminRecoveryRefresh";
const STATUS_ID = "adminRecoveryStatus";
const TAB_COUNT_ID = "navCountRecovery";

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

function formatAge(value) {
  if (!value) return "";
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, Date.now() - t);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  const days = Math.round(hrs / 24);
  if (days < 7) return days + "d ago";
  return formatDate(value);
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

// "no_email_on_file" means the listing never had a contact address on
// file when the therapist submitted the claim. Approving this is a
// cold takeover: there's no prior owner to disturb and public
// name+license is the only thing the automated flow checked. Admin
// must verify identity out-of-band before approving.
function isColdTakeover(req) {
  return req.reason === "no_email_on_file";
}

// Therapist-self-confirm UI block. Only rendered on cold-takeover
// cards — stale-email recoveries already have a prior email anchor so
// the admin can approve directly. Three states:
//   1. Not yet sent → form to pick a confirmation channel
//   2. Sent, pending therapist response → status line + "resend to
//      different channel" affordance
//   3. Responded → the response is already in the card's outcome copy,
//      so nothing to render here; the card itself has moved state.
// Verification anchors block — surfaces every signal admin can use to
// validate the request, pulled from the linked therapist profile and
// embedded by the server in the request payload as `req.anchor`.
// Designed for at-a-glance scanning so the reviewer doesn't need to
// hunt through DCA, the directory, or other tabs.
function renderAnchorsBlock(req) {
  const a = req.anchor;
  if (!a) return "";
  const dcaProfile =
    req.licenseNumber && a.boardName
      ? ' <a href="' +
        escapeHtml(dcaLookupUrl(req.licenseNumber)) +
        '" target="_blank" rel="noopener">DCA ↗</a>'
      : "";
  const dcaAddress = [a.addressCity, a.addressState, a.addressZip].filter(Boolean).join(", ");
  const expSoon = (() => {
    if (!a.licenseExpDate) return "";
    const days = Math.round((new Date(a.licenseExpDate) - Date.now()) / 86400000);
    if (days < 0) return ' <span class="rec-pill rec-pill-warn">expired</span>';
    if (days <= 60) return ' <span class="rec-pill rec-pill-warn">expires in ' + days + "d</span>";
    return "";
  })();
  const items = [
    {
      label: "License",
      html:
        escapeHtml(a.licenseStatus || "?") +
        (a.licenseExpDate ? " · exp " + escapeHtml(a.licenseExpDate) : "") +
        expSoon +
        (a.disciplineFlag
          ? ' <span class="rec-pill rec-pill-warn">discipline on file</span>'
          : "") +
        dcaProfile,
    },
    { label: "DCA address", html: dcaAddress ? escapeHtml(dcaAddress) : "—" },
    {
      label: "Phone",
      html: a.phone
        ? '<a href="tel:' + escapeHtml(a.phone) + '">' + escapeHtml(a.phone) + "</a>"
        : "—",
    },
    {
      label: "Website",
      html: a.website
        ? '<a href="' +
          escapeHtml(a.website) +
          '" target="_blank" rel="noopener">' +
          escapeHtml(a.website.replace(/^https?:\/\//, "").replace(/\/$/, "")) +
          " ↗</a>"
        : "—",
    },
    { label: "Email on profile", html: escapeHtml(a.email || "—") },
  ];
  if (a.providerNpi) {
    items.push({ label: "NPI", html: "<code>" + escapeHtml(a.providerNpi) + "</code>" });
  }
  return (
    '<section class="rec-block">' +
    '<h4 class="rec-block-title">Verification anchors <span class="rec-block-hint">check these out-of-band</span></h4>' +
    '<dl class="rec-anchors">' +
    items.map((i) => "<dt>" + escapeHtml(i.label) + "</dt><dd>" + i.html + "</dd>").join("") +
    "</dl>" +
    "</section>"
  );
}

function renderFlagsBlock(req) {
  if (!Array.isArray(req.flags) || req.flags.length === 0) return "";
  return (
    '<ul class="admin-recovery-auto-flags">' +
    req.flags
      .map(
        (f) =>
          '<li class="admin-recovery-auto-flag is-' +
          escapeHtml(f.severity || "warn") +
          '"><strong>⚠</strong> ' +
          escapeHtml(f.message) +
          "</li>",
      )
      .join("") +
    "</ul>"
  );
}

function renderRequestCard(req) {
  const statusClass =
    req.status === "approved"
      ? "is-approved"
      : req.status === "rejected"
        ? "is-rejected"
        : req.status === "dismissed"
          ? "is-dismissed"
          : "is-pending";
  const coldTakeover = isColdTakeover(req);
  const nameMismatch =
    req.profileName &&
    req.fullName &&
    req.profileName.trim().toLowerCase() !== req.fullName.trim().toLowerCase();
  const FREE_EMAIL = /@(gmail|yahoo|hotmail|outlook|icloud|aol|proton(mail)?|mail|ymail|gmx)\./i;
  const isFreeEmail = req.requestedEmail && FREE_EMAIL.test(req.requestedEmail);

  // Header strip — the 4 things you scan in <10s before making a call:
  // who, what license, what email they want, how old + risk.
  const headerStrip =
    '<header class="rec-strip">' +
    '<div class="rec-strip-main">' +
    '<h3 class="rec-strip-title">' +
    escapeHtml(req.fullName || "(no name)") +
    (req.licenseNumber
      ? ' <a class="rec-strip-license" href="' +
        escapeHtml(dcaLookupUrl(req.licenseNumber)) +
        '" target="_blank" rel="noopener">' +
        escapeHtml(req.licenseNumber) +
        " ↗</a>"
      : "") +
    "</h3>" +
    '<p class="rec-strip-email">Requesting access as <strong>' +
    escapeHtml(req.requestedEmail || "—") +
    "</strong>" +
    (isFreeEmail ? ' <span class="rec-pill rec-pill-warn">free email</span>' : "") +
    "</p>" +
    "</div>" +
    '<div class="rec-strip-meta">' +
    (coldTakeover ? '<span class="rec-pill rec-pill-danger">Cold takeover</span>' : "") +
    '<span class="rec-pill rec-pill-' +
    escapeHtml(req.status) +
    '" title="' +
    escapeHtml(formatDate(req.createdAt)) +
    '">' +
    escapeHtml(req.status === "pending" ? "Pending" : req.status) +
    " · " +
    escapeHtml(formatAge(req.createdAt)) +
    "</span>" +
    "</div>" +
    "</header>";

  // Two-column body grid: request facts left, profile-we'd-unlock right.
  const requestCol =
    '<section class="rec-col">' +
    '<h4 class="rec-block-title">Request</h4>' +
    '<dl class="rec-defs">' +
    "<dt>Reason</dt><dd>" +
    escapeHtml(req.reason || "—") +
    "</dd>" +
    "<dt>Prior email</dt><dd>" +
    escapeHtml(req.priorEmail || "—") +
    "</dd>" +
    (req.requesterIp
      ? "<dt>Requester IP</dt><dd><code>" + escapeHtml(req.requesterIp) + "</code></dd>"
      : "") +
    "</dl>" +
    "</section>";

  const profileCol =
    '<section class="rec-col">' +
    '<h4 class="rec-block-title">Profile we\'d unlock</h4>' +
    '<dl class="rec-defs">' +
    "<dt>Name on record</dt><dd>" +
    escapeHtml(req.profileName || "(no matching profile)") +
    (nameMismatch ? ' <span class="rec-pill rec-pill-warn">differs from request</span>' : "") +
    "</dd>" +
    "<dt>Email on record</dt><dd>" +
    escapeHtml(req.profileEmailHint || "—") +
    "</dd>" +
    (req.profileClaimedEmail
      ? "<dt>Previously claimed by</dt><dd>" + escapeHtml(req.profileClaimedEmail) + "</dd>"
      : "") +
    (req.therapistSlug
      ? '<dt>View profile</dt><dd><a href="/therapists/' +
        encodeURIComponent(req.therapistSlug) +
        '" target="_blank" rel="noopener">/therapists/' +
        escapeHtml(req.therapistSlug) +
        " ↗</a></dd>"
      : "") +
    "</dl>" +
    "</section>";

  const bodyGrid = '<div class="rec-grid">' + requestCol + profileCol + "</div>";

  const pendingActions =
    req.status !== "pending"
      ? ""
      : '<section class="rec-action">' +
        '<label class="rec-outcome-label" for="outcome-' +
        escapeHtml(req._id) +
        '">Message to therapist <small>(optional, included in the email)</small></label>' +
        '<textarea class="admin-recovery-outcome" id="outcome-' +
        escapeHtml(req._id) +
        '" data-for="' +
        escapeHtml(req._id) +
        '" rows="2"></textarea>' +
        '<div class="rec-buttons">' +
        '<button type="button" class="btn-primary admin-recovery-approve" data-request-id="' +
        escapeHtml(req._id) +
        '">Approve + send sign-in link</button>' +
        '<button type="button" class="btn-secondary admin-recovery-reject" data-request-id="' +
        escapeHtml(req._id) +
        '">Reject + notify</button>' +
        '<button type="button" class="rec-btn-quiet admin-recovery-dismiss" data-request-id="' +
        escapeHtml(req._id) +
        '" title="Clear this request without sending any email. Use for duplicates or junk.">Dismiss (no email)</button>' +
        "</div>" +
        '<div class="admin-recovery-feedback" data-feedback-for="' +
        escapeHtml(req._id) +
        '" hidden></div>' +
        "</section>";

  // For resolved requests, surface the audit trail compactly.
  const resolutionMeta =
    req.status === "pending"
      ? ""
      : '<section class="rec-resolution">' +
        '<dl class="rec-defs">' +
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
        (req.identityVerification
          ? "<dt>Verification note</dt><dd><em>" +
            escapeHtml(req.identityVerification).replace(/\n/g, "<br/>") +
            "</em></dd>"
          : "") +
        (Array.isArray(req.verificationMethods) && req.verificationMethods.length
          ? "<dt>Methods used</dt><dd>" +
            req.verificationMethods.map((m) => escapeHtml(m)).join(", ") +
            "</dd>"
          : "") +
        (req.adminNote
          ? "<dt>Admin note</dt><dd><em>" +
            escapeHtml(req.adminNote).replace(/\n/g, "<br/>") +
            "</em></dd>"
          : "") +
        "</dl>" +
        (req.status === "approved"
          ? '<button type="button" class="btn-secondary admin-recovery-resend-signin-btn" data-request-id="' +
            escapeHtml(req._id) +
            '" title="Re-mint and resend the magic sign-in link. Use if the approval email bounced or got lost.">Resend sign-in link</button>' +
            '<div class="admin-recovery-feedback" data-feedback-for="' +
            escapeHtml(req._id) +
            '" hidden></div>'
          : "") +
        "</section>";

  // Resolved cards collapse to a one-line summary that expands on click.
  // Pending cards stay fully expanded so the admin can act without an
  // extra click.
  if (req.status !== "pending") {
    const statusLabel =
      req.status === "approved"
        ? "Approved"
        : req.status === "rejected"
          ? "Rejected"
          : req.status === "dismissed"
            ? "Dismissed"
            : escapeHtml(req.status);
    const summaryRow =
      '<summary class="rec-row">' +
      '<span class="rec-pill rec-pill-' +
      escapeHtml(req.status) +
      '" title="' +
      escapeHtml(formatDate(req.reviewedAt || req.createdAt)) +
      '">' +
      escapeHtml(statusLabel) +
      " · " +
      escapeHtml(formatAge(req.reviewedAt || req.createdAt)) +
      "</span>" +
      (coldTakeover ? '<span class="rec-pill rec-pill-danger">Cold takeover</span>' : "") +
      '<span class="rec-row-name">' +
      escapeHtml(req.fullName || "(no name)") +
      (req.licenseNumber ? " · " + escapeHtml(req.licenseNumber) : "") +
      "</span>" +
      '<span class="rec-row-email">' +
      escapeHtml(req.requestedEmail || "—") +
      "</span>" +
      '<span class="rec-row-chevron" aria-hidden="true">▾</span>' +
      "</summary>";
    return (
      '<article class="admin-recovery-card ' +
      statusClass +
      (coldTakeover ? " is-cold-takeover" : "") +
      '" data-request-id="' +
      escapeHtml(req._id) +
      '" data-reason="' +
      escapeHtml(req.reason || "") +
      '">' +
      '<details class="rec-collapsible">' +
      summaryRow +
      '<div class="rec-collapsible-body">' +
      bodyGrid +
      renderAnchorsBlock(req) +
      renderFlagsBlock(req) +
      resolutionMeta +
      "</div>" +
      "</details>" +
      "</article>"
    );
  }

  return (
    '<article class="admin-recovery-card ' +
    statusClass +
    (coldTakeover ? " is-cold-takeover" : "") +
    '" data-request-id="' +
    escapeHtml(req._id) +
    '" data-reason="' +
    escapeHtml(req.reason || "") +
    '">' +
    headerStrip +
    bodyGrid +
    renderAnchorsBlock(req) +
    renderFlagsBlock(req) +
    pendingActions +
    "</article>"
  );
}

function renderDashboard(container, requests) {
  const pending = requests.filter((r) => r.status === "pending");
  const approved = requests.filter((r) => r.status === "approved");
  // Rejected + dismissed share a bucket — both are "didn't grant access"
  // outcomes and the admin rarely needs to distinguish them at a glance.
  const closed = requests.filter((r) => r.status === "rejected" || r.status === "dismissed");

  const renderSection = (heading, items, emptyMsg, limit) => {
    if (!items.length && !emptyMsg) return "";
    const list = limit ? items.slice(0, limit) : items;
    return (
      '<section class="admin-recovery-section">' +
      "<h3>" +
      escapeHtml(heading) +
      " — " +
      items.length +
      "</h3>" +
      (items.length
        ? list.map(renderRequestCard).join("")
        : '<p class="subtle">' + escapeHtml(emptyMsg) + "</p>") +
      "</section>"
    );
  };

  const parts = [
    renderSection("Pending review", pending, "No pending requests."),
    renderSection("Approved", approved, "", 20),
    renderSection("Rejected & dismissed", closed, "", 20),
  ];
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
  // Warnings/errors are the ones the admin needs to see immediately —
  // scroll into view so a blocked submit never looks like a silent click.
  if (tone === "warn" || tone === "error") {
    if (typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
}

function bindCardActions(container) {
  container.querySelectorAll(".admin-recovery-resend-signin-btn").forEach(function (button) {
    button.addEventListener("click", async function () {
      const id = button.getAttribute("data-request-id");
      if (
        !window.confirm(
          "Resend the magic sign-in link to the requested email? Use this when the original approval email bounced or didn't arrive.",
        )
      ) {
        return;
      }
      button.disabled = true;
      setFeedback(id, "info", "Resending sign-in link...");
      try {
        await resendRecoverySignin(id);
        setFeedback(id, "success", "Sign-in link resent. Ask the therapist to check their inbox.");
      } catch (error) {
        setFeedback(id, "warn", (error && error.message) || "Resend failed.");
      } finally {
        button.disabled = false;
      }
    });
  });

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
  container.querySelectorAll(".admin-recovery-dismiss").forEach(function (button) {
    button.addEventListener("click", async function () {
      const id = button.getAttribute("data-request-id");
      const note = window.prompt(
        "Dismiss this request without notifying the therapist.\n\nWhy are you dismissing it? (saved on the request for audit)",
        "Duplicate submission",
      );
      if (note === null) return;
      button.disabled = true;
      setFeedback(id, "info", "Dismissing...");
      try {
        await dismissRecoveryRequest(id, { admin_note: note });
        setFeedback(id, "success", "Dismissed. No email sent.");
        window.setTimeout(loadRecoveryDashboard, 800);
      } catch (error) {
        setFeedback(id, "warn", (error && error.message) || "Dismiss failed.");
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
