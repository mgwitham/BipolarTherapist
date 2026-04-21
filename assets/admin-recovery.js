// Admin recovery queue dashboard. Therapists who lost access to their
// on-file email submit a therapistRecoveryRequest. This module lists
// pending/resolved requests and wires approve/reject actions. Identity
// is verified manually by the admin (DCA lookup, phone call, etc.)
// before clicking Approve.

import {
  approveRecoveryRequest,
  fetchRecoveryRequests,
  rejectRecoveryRequest,
  resendRecoverySignin,
  sendRecoveryConfirmation,
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
function renderConfirmationSection(req, coldTakeover) {
  if (!coldTakeover) return "";
  const sent = req.confirmationSentAt;
  const response = req.confirmationResponse || "";
  if (!sent) {
    return (
      '<div class="admin-recovery-confirm-block">' +
      '<h4 class="admin-recovery-confirm-title">Confirm via therapist\'s own channel (recommended)</h4>' +
      '<p class="admin-recovery-confirm-help">' +
      "Find an email for this therapist on a <strong>public source the requester doesn't control</strong> " +
      "(DCA record, practice website footer, Psychology Today profile). " +
      "We'll email that address asking the therapist to confirm or deny. " +
      "If they confirm, the claim auto-approves. If they deny, it auto-rejects." +
      "</p>" +
      '<label class="admin-recovery-confirm-label">Channel email' +
      '<input type="email" class="admin-recovery-confirm-email" data-confirm-email-for="' +
      escapeHtml(req._id) +
      '" placeholder="e.g. info@drsmiththerapy.com" />' +
      "</label>" +
      '<label class="admin-recovery-confirm-label">Where did you find this email?' +
      '<input type="text" class="admin-recovery-confirm-context" data-confirm-context-for="' +
      escapeHtml(req._id) +
      '" placeholder="e.g. Psychology Today profile, DCA record, practice website footer" />' +
      "</label>" +
      '<button type="button" class="btn-primary admin-recovery-confirm-send" data-request-id="' +
      escapeHtml(req._id) +
      '">Send confirmation request</button>' +
      "</div>"
    );
  }
  if (response === "pending" || !response) {
    return (
      '<div class="admin-recovery-confirm-block admin-recovery-confirm-waiting">' +
      "<strong>⏳ Confirmation sent to " +
      escapeHtml(req.confirmationChannel || "") +
      "</strong><br/>" +
      '<span class="subtle">Sourced from: ' +
      escapeHtml(req.confirmationChannelContext || "(unspecified)") +
      " · Sent " +
      escapeHtml(formatDate(sent)) +
      "</span><br/>" +
      "<small>Waiting for the therapist to click Yes or No. Link expires in 7 days. " +
      "If they don't respond, you can still use the manual fallback below.</small>" +
      '<details class="admin-recovery-resend"><summary>Send to a different channel instead</summary>' +
      '<label class="admin-recovery-confirm-label">Channel email' +
      '<input type="email" class="admin-recovery-confirm-email" data-confirm-email-for="' +
      escapeHtml(req._id) +
      '" placeholder="e.g. info@drsmiththerapy.com" />' +
      "</label>" +
      '<label class="admin-recovery-confirm-label">Where did you find this email?' +
      '<input type="text" class="admin-recovery-confirm-context" data-confirm-context-for="' +
      escapeHtml(req._id) +
      '" placeholder="e.g. Psychology Today profile" />' +
      "</label>" +
      '<button type="button" class="btn-secondary admin-recovery-confirm-send" data-request-id="' +
      escapeHtml(req._id) +
      '">Resend to this channel</button>' +
      "</details>" +
      "</div>"
    );
  }
  return "";
}

function renderRequestCard(req) {
  const statusClass =
    req.status === "approved"
      ? "is-approved"
      : req.status === "rejected"
        ? "is-rejected"
        : "is-pending";
  const coldTakeover = isColdTakeover(req);
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
    (coldTakeover ? " is-cold-takeover" : "") +
    '" data-request-id="' +
    escapeHtml(req._id) +
    '" data-reason="' +
    escapeHtml(req.reason || "") +
    '">' +
    (coldTakeover
      ? '<div class="admin-recovery-risk-banner">' +
        "<strong>⚠ COLD TAKEOVER.</strong> Unclaimed profile, no prior owner email. " +
        "Public name + license is all that matched. <strong>Verify identity out-of-band " +
        "before approving</strong> (phone from DCA, practice website contact form, etc.)." +
        "</div>"
      : "") +
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
    (req.identityVerification
      ? "<dt>Identity verification</dt><dd><em>" +
        escapeHtml(req.identityVerification).replace(/\n/g, "<br/>") +
        "</em></dd>"
      : "") +
    (req.confirmationChannel
      ? "<dt>Confirmation sent to</dt><dd>" +
        escapeHtml(req.confirmationChannel) +
        (req.confirmationChannelContext
          ? " <small>(" + escapeHtml(req.confirmationChannelContext) + ")</small>"
          : "") +
        (req.confirmationResponse && req.confirmationResponse !== "pending"
          ? " · <strong>Therapist responded: " + escapeHtml(req.confirmationResponse) + "</strong>"
          : " · <em>Awaiting response</em>") +
        "</dd>"
      : "") +
    "</dl>" +
    (req.status === "approved"
      ? '<div class="admin-recovery-resend-signin">' +
        '<button type="button" class="btn-secondary admin-recovery-resend-signin-btn" data-request-id="' +
        escapeHtml(req._id) +
        '" title="Re-mint and resend the magic sign-in link to the requested email. Use if the original approval email bounced, went to spam, or the therapist didn\'t receive it.">Resend sign-in link</button>' +
        '<div class="admin-recovery-feedback" data-feedback-for="' +
        escapeHtml(req._id) +
        '" hidden></div>' +
        "</div>"
      : "") +
    (req.status === "pending"
      ? '<div class="admin-recovery-actions">' +
        renderConfirmationSection(req, coldTakeover) +
        (coldTakeover
          ? '<details class="admin-recovery-fallback"><summary>Fallback: skip therapist confirmation and approve manually</summary>' +
            '<label class="admin-recovery-verify-label" for="verify-' +
            escapeHtml(req._id) +
            '"><strong>Identity verification (required, 20+ chars)</strong><br/>' +
            "<small>Only use this path if you verified identity through a separate out-of-band channel " +
            "(phone call, video, etc.) AND the therapist-self-confirm email is not an option.</small>" +
            "</label>" +
            '<textarea class="admin-recovery-verify" id="verify-' +
            escapeHtml(req._id) +
            '" data-verify-for="' +
            escapeHtml(req._id) +
            '" rows="3" placeholder="Describe the out-of-band check you performed..."></textarea>' +
            "</details>"
          : "") +
        '<textarea class="admin-recovery-outcome" data-for="' +
        escapeHtml(req._id) +
        '" placeholder="Message for the therapist (optional, included in the email)" rows="2"></textarea>' +
        '<div class="admin-recovery-buttons">' +
        '<button type="button" class="btn-primary admin-recovery-approve" data-request-id="' +
        escapeHtml(req._id) +
        '"' +
        (coldTakeover ? " disabled" : "") +
        ">Approve + send sign-in link</button>" +
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
  // Cold-takeover cards gate the Approve button behind a 20+ char
  // identity-verification textarea. Wire the input listener first so
  // the button unlocks as the admin types.
  container.querySelectorAll(".admin-recovery-verify").forEach(function (textarea) {
    const id = textarea.getAttribute("data-verify-for");
    const button = container.querySelector('.admin-recovery-approve[data-request-id="' + id + '"]');
    if (!button) return;
    textarea.addEventListener("input", function () {
      button.disabled = textarea.value.trim().length < 20;
    });
  });

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

  container.querySelectorAll(".admin-recovery-confirm-send").forEach(function (button) {
    button.addEventListener("click", async function () {
      const id = button.getAttribute("data-request-id");
      const emailInput = container.querySelector(
        '.admin-recovery-confirm-email[data-confirm-email-for="' + id + '"]',
      );
      const contextInput = container.querySelector(
        '.admin-recovery-confirm-context[data-confirm-context-for="' + id + '"]',
      );
      const email = emailInput ? emailInput.value.trim() : "";
      const context = contextInput ? contextInput.value.trim() : "";
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        setFeedback(id, "warn", "Enter a valid confirmation channel email.");
        return;
      }
      if (context.length < 3) {
        setFeedback(
          id,
          "warn",
          "Note where you sourced this email (e.g., DCA record, PT profile).",
        );
        return;
      }
      button.disabled = true;
      setFeedback(id, "info", "Sending confirmation email to " + email + "...");
      try {
        await sendRecoveryConfirmation(id, {
          channel_email: email,
          channel_context: context,
        });
        setFeedback(
          id,
          "success",
          "Confirmation email sent. Therapist will click Yes or No to resolve this.",
        );
        window.setTimeout(loadRecoveryDashboard, 800);
      } catch (error) {
        const msg = (error && error.message) || "Send failed.";
        setFeedback(id, "warn", msg);
        button.disabled = false;
      }
    });
  });

  container.querySelectorAll(".admin-recovery-approve").forEach(function (button) {
    button.addEventListener("click", async function () {
      const id = button.getAttribute("data-request-id");
      const card = button.closest(".admin-recovery-card");
      const coldTakeover = card && card.classList.contains("is-cold-takeover");
      const outcomeBox = container.querySelector('.admin-recovery-outcome[data-for="' + id + '"]');
      const outcomeMessage = outcomeBox ? outcomeBox.value : "";
      const verifyBox = container.querySelector(
        '.admin-recovery-verify[data-verify-for="' + id + '"]',
      );
      const identityVerification = verifyBox ? verifyBox.value.trim() : "";
      if (coldTakeover && identityVerification.length < 20) {
        setFeedback(
          id,
          "warn",
          "Identity verification note is required (20+ chars) before approving a cold takeover.",
        );
        return;
      }
      const confirmMessage = coldTakeover
        ? "Approve this COLD TAKEOVER? A sign-in link will go to the requested email, granting full profile control. Your verification note will be saved on the request."
        : "Approve this recovery? This sends a sign-in link to the therapist.";
      if (!window.confirm(confirmMessage)) {
        return;
      }
      button.disabled = true;
      setFeedback(id, "info", "Approving and sending sign-in link...");
      try {
        await approveRecoveryRequest(id, {
          outcome_message: outcomeMessage,
          identity_verification: identityVerification,
        });
        setFeedback(id, "success", "Approved. Email sent.");
        window.setTimeout(loadRecoveryDashboard, 800);
      } catch (error) {
        setFeedback(id, "warn", (error && error.message) || "Approval failed.");
        button.disabled = coldTakeover && identityVerification.length < 20;
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
