import { fetchPublicTherapistBySlug } from "./cms.js";
import { getTherapistMatchReadiness } from "./matching-model.js";
import {
  acceptTherapistClaim,
  fetchTherapistClaimSession,
  requestTherapistClaimLink,
  submitTherapistPortalRequest,
} from "./review-api.js";

var slug = new URLSearchParams(window.location.search).get("slug") || "";
var token = new URLSearchParams(window.location.search).get("token") || "";
var claimSessionState = null;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeSlugInput(value) {
  var raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  try {
    var url = new URL(raw);
    return url.searchParams.get("slug") || raw;
  } catch (_error) {
    return raw;
  }
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  var date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getClaimStatusLabel(value) {
  if (value === "claimed") {
    return "Claimed";
  }
  if (value === "claim_requested") {
    return "Claim requested";
  }
  return "Unclaimed";
}

function getPhotoStatusLabel(therapist) {
  if (therapist.photo_source_type === "therapist_uploaded") {
    return "Therapist-uploaded headshot on file";
  }
  if (therapist.photo_source_type === "practice_uploaded") {
    return "Practice-uploaded headshot on file";
  }
  if (therapist.photo_source_type === "public_source") {
    return "Using public-source fallback photo";
  }
  return "No preferred headshot on file yet";
}

function getContactRouteLabel(therapist) {
  if (therapist.preferred_contact_label) {
    return therapist.preferred_contact_label;
  }
  if (therapist.preferred_contact_method === "booking_url") {
    return "Booking link";
  }
  if (therapist.preferred_contact_method === "email") {
    return "Email";
  }
  if (therapist.preferred_contact_method === "phone") {
    return "Phone";
  }
  if (therapist.preferred_contact_method === "website") {
    return "Website";
  }
  return "Profile contact path";
}

function getQuickAttentionItems(therapist) {
  var items = [];
  if (therapist.claim_status !== "claimed") {
    items.push("Confirm profile ownership so future updates are easier to manage.");
  }
  if (!therapist.photo_source_type || therapist.photo_source_type === "public_source") {
    items.push(
      "Upload a preferred headshot so the live profile relies less on public-source fallback.",
    );
  }
  if (!therapist.bipolar_years_experience) {
    items.push("Add bipolar-specific years experience to strengthen fit and trust signals.");
  }
  if (therapist.accepting_new_patients === false) {
    items.push(
      "Review your listing status so patients are not encouraged to reach out if you are closed.",
    );
  }
  if (!items.length) {
    items.push(
      "Your profile already covers the main trust and operational basics for this lightweight portal.",
    );
  }
  return items;
}

function buildPortalRequestOptions(verifiedClaim, therapist) {
  return [
    {
      value: "claim_profile",
      label: "Claim my profile",
      hidden: verifiedClaim,
    },
    {
      value: "profile_update",
      label: "Help me update my profile",
      selected: verifiedClaim,
    },
    {
      value: "pause_listing",
      label: "Pause my listing",
      hidden: Boolean(therapist.listing_pause_requested_at),
    },
    {
      value: "remove_listing",
      label: "Remove my listing",
      hidden: Boolean(therapist.listing_removal_requested_at),
    },
  ].filter(function (item) {
    return !item.hidden;
  });
}

function renderLookupState() {
  var shell = document.getElementById("portalShell");
  if (!shell) {
    return;
  }

  shell.innerHTML =
    '<section class="portal-card"><h2>Claim or manage your profile</h2><p class="portal-subtle">Paste your public profile link or slug and the public email already on your profile. If the email matches, we will send a secure manage link. If not, you can still submit a manual request.</p><form id="portalLookupForm" class="portal-form"><label>Profile link or slug<input type="text" id="portalSlugInput" placeholder="https://.../therapist.html?slug=dr-jane-smith-los-angeles-ca or dr-jane-smith-los-angeles-ca" /></label><label>Public profile email<input type="email" id="portalEmailInput" placeholder="you@example.com" /></label><button class="btn-primary" type="submit">Send secure manage link</button><div class="portal-feedback" id="portalLookupFeedback"></div></form></section>';

  document.getElementById("portalLookupForm").addEventListener("submit", function (event) {
    event.preventDefault();
    var nextSlug = normalizeSlugInput(document.getElementById("portalSlugInput").value);
    var email = String(document.getElementById("portalEmailInput").value || "").trim();
    var feedback = document.getElementById("portalLookupFeedback");
    if (!nextSlug || !email) {
      feedback.textContent = "Enter both the profile slug and the public email on the profile.";
      return;
    }
    feedback.textContent = "Sending secure manage link...";
    requestTherapistClaimLink({
      therapist_slug: nextSlug,
      requester_email: email,
    })
      .then(function () {
        feedback.textContent =
          "If the email matched the public profile email, a secure manage link has been sent.";
      })
      .catch(function (error) {
        feedback.textContent =
          (error && error.message) ||
          "We could not send a manage link. Use the manual request flow instead.";
      });
  });
}

function renderPortal(therapist, options) {
  var shell = document.getElementById("portalShell");
  if (!shell) {
    return;
  }

  var sessionMode = options && options.sessionMode ? options.sessionMode : "public";
  var verifiedClaim = sessionMode === "claimed";
  var readiness = getTherapistMatchReadiness(therapist);
  var claimStatus = getClaimStatusLabel(therapist.claim_status);
  var pauseRequested = Boolean(therapist.listing_pause_requested_at);
  var removalRequested = Boolean(therapist.listing_removal_requested_at);
  var requestOptions = buildPortalRequestOptions(verifiedClaim, therapist);
  var quickAttentionItems = getQuickAttentionItems(therapist);
  var claimedEmail = therapist.claimed_by_email || therapist.email || "";

  shell.innerHTML =
    '<section class="portal-card portal-hero"><div><p class="portal-eyebrow">Claim and manage your profile</p><h1>' +
    escapeHtml(therapist.name) +
    '</h1><p class="portal-subtle">' +
    escapeHtml(therapist.city + ", " + therapist.state) +
    (therapist.practice_name ? " · " + escapeHtml(therapist.practice_name) : "") +
    '</p></div><div class="portal-badges"><span class="portal-badge">' +
    escapeHtml(claimStatus) +
    '</span><span class="portal-badge">' +
    escapeHtml(readiness.label + " · " + readiness.score + "/100") +
    "</span></div></section>" +
    (sessionMode === "claim_token"
      ? '<section class="portal-card" style="margin-bottom:1rem"><h2>Verify claim</h2><p class="portal-subtle">This secure link matched the public profile email. Confirm the claim to unlock lightweight self-serve management for this profile.</p><div class="portal-actions"><button class="btn-primary" id="acceptClaimButton" type="button">Claim this profile</button><div class="portal-feedback" id="claimAcceptFeedback"></div></div></section>'
      : "") +
    '<section class="portal-grid">' +
    '<article class="portal-card"><h2>Profile status</h2><div class="portal-list">' +
    "<div><strong>Live listing:</strong> " +
    escapeHtml(therapist.status === "active" ? "Live" : therapist.status || "Unknown") +
    "</div>" +
    "<div><strong>Claim status:</strong> " +
    escapeHtml(claimStatus) +
    "</div>" +
    "<div><strong>Claimed email:</strong> " +
    escapeHtml(therapist.claimed_by_email || "Not set") +
    "</div>" +
    "<div><strong>Claimed at:</strong> " +
    escapeHtml(formatDate(therapist.claimed_at) || "Not set") +
    "</div>" +
    "<div><strong>Last seen in portal:</strong> " +
    escapeHtml(formatDate(therapist.portal_last_seen_at) || "Not tracked yet") +
    "</div>" +
    "<div><strong>Pause requested:</strong> " +
    escapeHtml(pauseRequested ? "Yes" : "No") +
    "</div>" +
    "<div><strong>Removal requested:</strong> " +
    escapeHtml(removalRequested ? "Yes" : "No") +
    "</div>" +
    "</div></article>" +
    '<article class="portal-card"><h2>Manage now</h2><p class="portal-subtle">' +
    escapeHtml(
      verifiedClaim
        ? "You now manage this profile through a lightweight reviewed workflow. Updates still go through review before they replace the live listing."
        : "Once you claim the profile, this becomes your lightweight control surface for updates, pause requests, and removal requests.",
    ) +
    '</p><div class="portal-list"><div><strong>Main contact route:</strong> ' +
    escapeHtml(getContactRouteLabel(therapist)) +
    "</div><div><strong>Headshot status:</strong> " +
    escapeHtml(getPhotoStatusLabel(therapist)) +
    "</div><div><strong>Accepting patients:</strong> " +
    escapeHtml(
      therapist.accepting_new_patients === false
        ? "Currently marked not accepting"
        : "Currently marked accepting or open to inquiry",
    ) +
    '</div></div><div class="portal-actions"><a class="btn-secondary" href="signup.html?confirm=' +
    encodeURIComponent(therapist.slug) +
    '">Confirm or update profile</a><a class="btn-secondary" href="therapist.html?slug=' +
    encodeURIComponent(therapist.slug) +
    '">View live profile</a>' +
    (verifiedClaim
      ? '<span class="portal-subtle">This profile is now claimed to ' +
        escapeHtml(therapist.claimed_by_email || "") +
        ".</span>"
      : "") +
    "</div></article>" +
    '<article class="portal-card"><h2>What needs attention</h2><div class="portal-list">' +
    quickAttentionItems
      .map(function (item) {
        return "<div>• " + escapeHtml(item) + "</div>";
      })
      .join("") +
    "</div></article>" +
    '<article class="portal-card"><h2>Portal requests</h2><p class="portal-subtle">This MVP routes claim, pause, removal, and profile-update requests into the review system without giving direct publish control yet.</p><form id="portalRequestForm" class="portal-form"><input type="hidden" name="therapist_slug" value="' +
    escapeHtml(therapist.slug) +
    '" /><input type="hidden" name="therapist_name" value="' +
    escapeHtml(therapist.name) +
    '" /><label>Your name<input type="text" name="requester_name" placeholder="Your name" value="' +
    escapeHtml(verifiedClaim ? therapist.name : "") +
    '" required /></label><label>Your email<input type="email" name="requester_email" placeholder="you@example.com" value="' +
    escapeHtml(claimedEmail) +
    '" required /></label><label>License number<input type="text" name="license_number" placeholder="Optional, helps with claim review" value="' +
    escapeHtml(therapist.license_number || "") +
    '" /></label><label>What do you need?<select name="request_type" required>' +
    requestOptions
      .map(function (option) {
        return (
          '<option value="' +
          escapeHtml(option.value) +
          '"' +
          (option.selected ? " selected" : "") +
          ">" +
          escapeHtml(option.label) +
          "</option>"
        );
      })
      .join("") +
    '</select></label><label>Message<textarea name="message" rows="4" placeholder="Add anything that helps us verify ownership or understand the request.">' +
    escapeHtml(
      verifiedClaim
        ? "I manage this claimed profile and would like help with the selected request."
        : "",
    ) +
    '</textarea></label><button class="btn-primary" type="submit">' +
    escapeHtml(verifiedClaim ? "Send managed request" : "Send request") +
    '</button><div class="portal-feedback" id="portalRequestFeedback"></div></form></article>' +
    '<article class="portal-card"><h2>Account controls</h2><div class="portal-list"><div><strong>Pause listing:</strong> Request a temporary pause instead of deleting your profile.</div><div><strong>Remove listing:</strong> Request permanent removal if you no longer want to appear in the directory.</div><div><strong>Headshot and profile updates:</strong> Use the update flow above. Your edits still go through review before they replace the live profile.</div></div></article>' +
    "</section>";

  document.getElementById("portalRequestForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var feedback = document.getElementById("portalRequestFeedback");
    var payload = {
      therapist_slug: form.elements.therapist_slug.value,
      therapist_name: form.elements.therapist_name.value,
      requester_name: form.elements.requester_name.value.trim(),
      requester_email: form.elements.requester_email.value.trim(),
      license_number: form.elements.license_number.value.trim(),
      request_type: form.elements.request_type.value,
      message: form.elements.message.value.trim(),
    };

    feedback.textContent = "Sending request...";
    try {
      await submitTherapistPortalRequest(payload);
      feedback.textContent =
        "Your request is in the review queue. We’ll use it to verify ownership or handle the listing change.";
      form.reset();
      form.elements.therapist_slug.value = therapist.slug;
      form.elements.therapist_name.value = therapist.name;
    } catch (error) {
      feedback.textContent =
        (error && error.message) || "Something went wrong while sending the request.";
    }
  });

  if (sessionMode === "claim_token") {
    document.getElementById("acceptClaimButton").addEventListener("click", async function () {
      var feedback = document.getElementById("claimAcceptFeedback");
      feedback.textContent = "Claiming profile...";
      try {
        var result = await acceptTherapistClaim(token);
        feedback.textContent = "Profile claimed. Loading your manage view...";
        claimSessionState = {
          therapist: {
            ...therapist,
            claim_status: "claimed",
            claimed_by_email:
              result.claimed_by_email || therapist.claimed_by_email || therapist.email || "",
            claimed_at: new Date().toISOString(),
            portal_last_seen_at: new Date().toISOString(),
          },
        };
        renderPortal(claimSessionState.therapist, {
          sessionMode: "claimed",
        });
      } catch (error) {
        feedback.textContent =
          (error && error.message) || "We could not complete the claim right now.";
      }
    });
  }
}

(async function init() {
  if (token) {
    try {
      var session = await fetchTherapistClaimSession(token);
      claimSessionState = session;
      renderPortal(session.therapist, {
        sessionMode: session.therapist.claim_status === "claimed" ? "claimed" : "claim_token",
      });
      return;
    } catch (_error) {
      renderLookupState();
      var tokenShell = document.getElementById("portalShell");
      if (tokenShell) {
        tokenShell.insertAdjacentHTML(
          "afterbegin",
          '<section class="portal-card"><p class="portal-subtle">That manage link is invalid or expired. Request a new one below.</p></section>',
        );
      }
      return;
    }
  }

  if (!slug) {
    renderLookupState();
    return;
  }

  var therapist = await fetchPublicTherapistBySlug(slug);
  if (!therapist) {
    renderLookupState();
    var shell = document.getElementById("portalShell");
    if (shell) {
      shell.insertAdjacentHTML(
        "afterbegin",
        '<section class="portal-card"><p class="portal-subtle">We could not find that profile. Double-check the slug or open this page from the live therapist profile.</p></section>',
      );
    }
    return;
  }

  renderPortal(therapist, {
    sessionMode: "public",
  });
})();
