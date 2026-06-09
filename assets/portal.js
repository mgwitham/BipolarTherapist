import "./sentry-init.js";
import "./funnel-analytics.js";
import { escapeHtml } from "./escape-html.js";
import { safeStripeRedirectUrl } from "./safe-url.js";
import { trackFunnelEvent } from "./funnel-analytics.js";
import { mountPortalTdCompleteness, shouldShowCompleteness } from "./portal-td-completeness.js";
import { fetchPublicTherapistBySlug } from "./cms.js";
import { getTherapistMatchReadiness } from "../shared/matching-model.mjs";
import { getApplications } from "./store.js";
import {
  acceptTherapistClaim,
  clearTherapistSessionToken,
  createStripeBillingPortalSession,
  createStripeFeaturedCheckoutSession,
  fetchPortalAnalytics,
  fetchPortalDevLogin,
  fetchTherapistClaimSession,
  fetchTherapistMe,
  fetchTherapistSubscription,
  getTherapistSessionToken,
  patchTherapistProfile,
  requestTherapistSignIn,
  setTherapistSessionToken,
  signOutTherapistSession,
  submitTherapistPortalRequest,
} from "./review-api.js";

var slug = new URLSearchParams(window.location.search).get("slug") || "";
var token = new URLSearchParams(window.location.search).get("token") || "";
var devLoginEmail = new URLSearchParams(window.location.search).get("dev_login") || "";
var claimSessionState = null;

// Strip the magic-link token from the address bar as fast as possible.
// Runs synchronously at module load (before any fetch/await) so:
//   - Sentry's first error capture, if it fires, can't pull window.location
//     with the token in it (sentry-init.js also scrubs as defence in depth).
//   - A Referer header from any sub-resource fetch initiated by other module
//     imports doesn't ship the token to a third party.
//   - The back-button history entry doesn't expose the token.
// Token is already captured into the `token` variable above; the URL copy
// has served its purpose.
function scrubTokenFromUrl() {
  try {
    var params = new URLSearchParams(window.location.search);
    if (!params.has("token")) return;
    params.delete("token");
    var nextUrl =
      window.location.pathname +
      (params.toString() ? "?" + params.toString() : "") +
      window.location.hash;
    window.history.replaceState({}, document.title, nextUrl);
  } catch (_error) {
    // Non-fatal; the signed token is still short-lived and single-use.
  }
}

scrubTokenFromUrl();

// Late-flow hook: once the server resolves the session, update the
// module-scoped slug to match (server may canonicalize). Token is already
// gone from the URL by the time this runs.
function applyResolvedSlug(nextSlug) {
  if (!nextSlug) return;
  try {
    var params = new URLSearchParams(window.location.search);
    if (params.get("slug") !== nextSlug) {
      params.set("slug", nextSlug);
      var nextUrl =
        window.location.pathname +
        (params.toString() ? "?" + params.toString() : "") +
        window.location.hash;
      window.history.replaceState({}, document.title, nextUrl);
    }
    slug = nextSlug;
  } catch (_error) {
    slug = nextSlug;
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
    {
      value: "other",
      label: "Other",
    },
  ].filter(function (item) {
    return !item.hidden;
  });
}

function getRelatedApplication(therapist, options) {
  if (!therapist) {
    return null;
  }

  var claimedEmail = String(
    (options && options.claimedEmail) || therapist.claimed_by_email || therapist.email || "",
  )
    .trim()
    .toLowerCase();
  var therapistSlug = String(therapist.slug || "").trim();
  var applications = getApplications();

  return (
    applications.find(function (item) {
      var itemEmail = String(item.email || "")
        .trim()
        .toLowerCase();
      return (
        item.target_therapist_slug === therapistSlug ||
        item.slug === therapistSlug ||
        (claimedEmail && itemEmail === claimedEmail)
      );
    }) || null
  );
}

function buildPortalProgressData(application) {
  if (!application) {
    return null;
  }

  var portalState = application.portal_state || "";
  var followUpStatus = application.claim_follow_up_status || "not_started";
  var stages = [
    {
      label: "Claim submitted",
      done:
        ["claim_pending_review", "claim_in_review", "claim_needs_attention"].includes(
          portalState,
        ) ||
        application.submission_intent === "claim" ||
        application.status === "approved",
    },
    {
      label: "Claim approved",
      done: [
        "claimed_ready_for_profile",
        "profile_submitted_after_claim",
        "profile_in_review_after_claim",
        "approved_ready_to_publish",
        "live",
      ].includes(portalState),
    },
    {
      label: "Follow-up received",
      done: ["sent", "responded", "full_profile_started"].includes(followUpStatus),
    },
    {
      label: "Full profile started",
      done: followUpStatus === "full_profile_started",
    },
    {
      label: "Full profile submitted",
      done: [
        "profile_submitted_after_claim",
        "profile_in_review_after_claim",
        "approved_ready_to_publish",
        "live",
      ].includes(portalState),
    },
  ];

  var nextAction = "Use the update flow if you need to change any operational details.";
  // Each in-review state explains: what's happening, how long it
  // usually takes, and whether the therapist can keep editing. Without
  // that context, a generic "your profile is in review" leaves the
  // therapist guessing whether they should wait, follow up, or do
  // anything at all.
  if (portalState === "claimed_ready_for_profile") {
    nextAction =
      "Complete your fuller profile so we can review trust, fit, and listing readiness. You can save changes one field at a time.";
  } else if (portalState === "profile_submitted_after_claim") {
    nextAction =
      "Your fuller profile is submitted. We are preparing it for review, usually within 1 business day. Edits you make here will roll into the review.";
  } else if (portalState === "profile_in_review_after_claim") {
    nextAction =
      "Your fuller profile is in review. We typically wrap reviews within 2 business days and will email you when it's live. Keep editing in the meantime; changes are included.";
  } else if (portalState === "claim_pending_review" || portalState === "claim_in_review") {
    nextAction =
      "We are verifying ownership and your core profile details. Most claims clear within 1-2 business days. We'll email when verification is complete.";
  } else if (portalState === "claim_needs_attention") {
    nextAction =
      "Review the requested fixes so we can finish verifying your claim. Make the change here, then we'll re-review.";
  }

  return {
    statusLabel: application.portal_state_label || "In progress",
    nextStep: application.portal_next_step || nextAction,
    stages: stages,
  };
}

function getPortalResumeField(application) {
  if (!application) {
    return "";
  }

  if (!application.bio || String(application.bio).trim().length < 50) {
    return "bio";
  }
  if (!application.care_approach || String(application.care_approach).trim().length < 40) {
    return "care_approach";
  }
  if (!(application.specialties && application.specialties.length)) {
    return "specialties";
  }
  if (!(application.treatment_modalities && application.treatment_modalities.length)) {
    return "treatment_modalities";
  }
  if (!application.contact_guidance) {
    return "contact_guidance";
  }
  if (!application.first_step_expectation) {
    return "first_step_expectation";
  }
  if (!application.preferred_contact_label) {
    return "preferred_contact_label";
  }
  if (!application.estimated_wait_time) {
    return "estimated_wait_time";
  }
  if (
    application.accepts_telehealth &&
    !(application.telehealth_states && application.telehealth_states.length)
  ) {
    return "telehealth_states";
  }
  return "bio";
}

function getPortalSignupHref(therapist, application, focusField) {
  var focusSuffix = focusField ? "&focus=" + encodeURIComponent(focusField) : "";
  var targetSlug =
    (application && application.target_therapist_slug) || (therapist && therapist.slug) || "";

  if (application && application.portal_state === "claim_needs_attention" && application.id) {
    return "signup.html?revise=" + encodeURIComponent(application.id) + focusSuffix;
  }

  if (targetSlug) {
    return "claim.html?confirm=" + encodeURIComponent(targetSlug) + focusSuffix;
  }

  return "signup.html" + (focusField ? "?focus=" + encodeURIComponent(focusField) : "");
}

function buildPortalProfileCoaching(application) {
  if (!application) {
    return null;
  }

  var readiness = getTherapistMatchReadiness(application);
  var missingItems = Array.isArray(readiness.missing_items) ? readiness.missing_items : [];
  var strengths = Array.isArray(readiness.strengths) ? readiness.strengths : [];

  if (!missingItems.length && !strengths.length) {
    return null;
  }

  return {
    scoreLabel: readiness.label + " · " + readiness.score + "/100",
    missingItems: missingItems.slice(0, 4),
    strengths: strengths.slice(0, 3),
  };
}

function buildPortalTimeline(application, therapist) {
  var items = [];
  if (therapist && therapist.claimed_at) {
    items.push({
      label: "Profile claimed",
      date: therapist.claimed_at,
    });
  }
  if (application && application.created_at) {
    items.push({
      label:
        application.submission_intent === "claim"
          ? "Claim submitted"
          : "Profile submission received",
      date: application.created_at,
    });
  }
  if (application && application.claim_follow_up_sent_at) {
    items.push({
      label: "Follow-up sent",
      date: application.claim_follow_up_sent_at,
    });
  }
  if (application && application.claim_follow_up_response_at) {
    items.push({
      label:
        application.claim_follow_up_status === "full_profile_started"
          ? "Full profile started"
          : "Therapist responded",
      date: application.claim_follow_up_response_at,
    });
  }
  if (application && application.updated_at && application.portal_state) {
    items.push({
      label: application.portal_state_label || "Status updated",
      date: application.updated_at,
    });
  }

  return items
    .filter(function (item) {
      return item.date;
    })
    .sort(function (a, b) {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    })
    .slice(0, 5);
}

function buildPortalExpectations(application) {
  if (!application) {
    return {
      headline: "Next step: complete your profile.",
      body: "Fill in your contact route and card bio to go live. The completeness checklist above shows exactly what to add next.",
    };
  }

  var portalState = application.portal_state || "";

  if (portalState === "claim_pending_review" || portalState === "claim_in_review") {
    return {
      headline: "Next expected step: claim verification.",
      body: "Expect the next update to be either claim approval or a request for a few ownership details to be tightened.",
    };
  }

  if (portalState === "claim_needs_attention") {
    return {
      headline: "Next expected step: revised claim review.",
      body: "Once you update the requested details, the next milestone is finishing claim approval so you can move into the fuller profile.",
    };
  }

  if (portalState === "claimed_ready_for_profile") {
    return {
      headline: "Next expected step: fuller profile submission.",
      body: "The biggest unlock now is completing the richer trust, fit, and care details so your listing can move into review.",
    };
  }

  if (portalState === "profile_submitted_after_claim") {
    return {
      headline: "Next expected step: review start.",
      body: "Your fuller profile is in the queue. The next visible move should be review activity on trust, fit, and publish readiness.",
    };
  }

  if (portalState === "profile_in_review_after_claim") {
    return {
      headline: "Next expected step: publish decision or requested changes.",
      body: "Once review completes, the most likely outcomes are a publish-ready decision or a short list of profile fixes.",
    };
  }

  if (portalState === "approved_ready_to_publish" || portalState === "live") {
    return {
      headline: "Next expected step: live listing upkeep.",
      body: "From here, the main work is keeping operational details fresh so the profile stays trustworthy and match-ready.",
    };
  }

  return {
    headline: "Next expected step: review progress.",
    body:
      application.portal_next_step ||
      "We will keep this portal aligned to the next review milestone.",
  };
}

function buildPortalUrgency(application) {
  if (!application) {
    return null;
  }

  var portalState = application.portal_state || "";
  var updatedAt = application.updated_at ? new Date(application.updated_at) : null;
  var now = new Date();
  var ageDays =
    updatedAt && !Number.isNaN(updatedAt.getTime())
      ? Math.max(0, Math.floor((now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

  if (portalState === "claimed_ready_for_profile" && ageDays >= 3) {
    return {
      label: "Recommended this week",
      body: "Your claim is already approved. Completing the fuller profile now is the fastest way to keep your listing momentum moving.",
    };
  }

  if (portalState === "claim_needs_attention") {
    return {
      label: "Needs attention",
      body: "There are still a few details to tighten before we can finish claim verification.",
    };
  }

  if (portalState === "profile_submitted_after_claim" && ageDays >= 2) {
    return {
      label: "In queue now",
      body: "Your fuller profile is already submitted and should be moving through review next.",
    };
  }

  if (portalState === "profile_in_review_after_claim" && ageDays >= 5) {
    return {
      label: "Review taking longer",
      body: "Your fuller profile is still in review. Nothing is wrong on its face, but this is taking longer than the fastest review path.",
    };
  }

  return null;
}

function buildPortalReviewerFeedback(application) {
  if (!application) {
    return null;
  }

  var message = String(application.review_request_message || "").trim();
  var history = Array.isArray(application.revision_history) ? application.revision_history : [];
  var latestRequest = history
    .slice()
    .reverse()
    .find(function (entry) {
      return entry && entry.type === "requested_changes";
    });

  if (!message && !(latestRequest && latestRequest.message)) {
    return null;
  }

  return {
    message: message || (latestRequest && latestRequest.message) || "",
    requestedAt: latestRequest && latestRequest.at ? latestRequest.at : "",
  };
}

function buildPortalReviewReadinessSignal(application) {
  if (!application) {
    return null;
  }

  var portalState = String(application.portal_state || "");
  var readiness = getTherapistMatchReadiness(application);
  var missingItems = Array.isArray(readiness.missing_items) ? readiness.missing_items : [];

  if (
    ["profile_submitted_after_claim", "profile_in_review_after_claim"].includes(portalState) &&
    readiness.score >= 85 &&
    readiness.completeness_score >= 80
  ) {
    return {
      label: "Strong review candidate",
      body: "Your fuller profile is detailed enough that it looks close to publish-ready after review. Keep practical details fresh while it moves through the queue.",
    };
  }

  if (portalState === "profile_in_review_after_claim") {
    var updatedAt = application.updated_at ? new Date(application.updated_at) : null;
    var ageDays =
      updatedAt && !Number.isNaN(updatedAt.getTime())
        ? Math.max(
            0,
            Math.floor((new Date().getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)),
          )
        : 0;
    if (ageDays >= 5) {
      return {
        label: "Still moving, just slower",
        body: "Your profile is already in the real review queue. This step is taking longer than the fastest cases, but the right move is still to keep practical details accurate while we finish the review pass.",
      };
    }
  }

  if (portalState === "claimed_ready_for_profile" && readiness.score >= 75) {
    return {
      label: "Close to review-ready",
      body: "You already have a strong base. Finishing the remaining trust and fit details should move this much closer to a real review pass.",
    };
  }

  if (portalState === "claim_needs_attention" && missingItems.length) {
    return {
      label: "One focused update helps most",
      body:
        "Tightening the next missing item is the fastest way to keep this moving: " +
        missingItems[0],
    };
  }

  return null;
}

function buildPortalReviewTiming(application) {
  if (!application) {
    return null;
  }

  var portalState = String(application.portal_state || "");
  var updatedAt = application.updated_at ? new Date(application.updated_at) : null;
  var createdAt = application.created_at ? new Date(application.created_at) : null;
  var now = new Date();
  var updatedAgeDays =
    updatedAt && !Number.isNaN(updatedAt.getTime())
      ? Math.max(0, Math.floor((now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;
  var createdAgeDays =
    createdAt && !Number.isNaN(createdAt.getTime())
      ? Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

  if (portalState === "profile_in_review_after_claim") {
    return {
      label: "Current review age",
      body:
        "Your fuller profile has been in the review phase for " +
        updatedAgeDays +
        " day" +
        (updatedAgeDays === 1 ? "" : "s") +
        ".",
    };
  }

  if (portalState === "profile_submitted_after_claim") {
    return {
      label: "Waiting in queue",
      body:
        "Your fuller profile was submitted " +
        createdAgeDays +
        " day" +
        (createdAgeDays === 1 ? "" : "s") +
        " ago and is waiting for the next review pass.",
    };
  }

  if (portalState === "claimed_ready_for_profile") {
    return {
      label: "Time since claim approval",
      body:
        "Your approved claim has been waiting on the fuller profile for " +
        updatedAgeDays +
        " day" +
        (updatedAgeDays === 1 ? "" : "s") +
        ".",
    };
  }

  return null;
}

var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var SIGNIN_RESEND_COOLDOWN_MS = 30 * 1000;

function normalizeSignInEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function renderSignInFlash(kind) {
  if (!kind) return "";
  if (kind === "signed_out") {
    return (
      '<section class="portal-signin-flash portal-signin-flash--info" role="status">' +
      "<p><strong>You're signed out.</strong></p>" +
      "<p>Sign back in below whenever you want to manage your listing.</p>" +
      "</section>"
    );
  }
  if (kind === "invalid_link") {
    return (
      '<section class="portal-signin-flash portal-signin-flash--warn" role="alert">' +
      "<p><strong>That sign-in link is expired or already used.</strong></p>" +
      "<p>Enter your email below and we'll send a fresh link. Valid for 24 hours.</p>" +
      "</section>"
    );
  }
  if (kind === "not_found") {
    return (
      '<section class="portal-signin-flash portal-signin-flash--warn" role="alert">' +
      "<p><strong>We couldn't find that profile.</strong></p>" +
      "<p>Sign in below, or open this page from your public listing.</p>" +
      "</section>"
    );
  }
  return "";
}

function renderLookupState(options) {
  var shell = document.getElementById("portalShell");
  if (!shell) {
    return;
  }

  var opts = options || {};
  var flashKind =
    opts.flash ||
    (new URLSearchParams(window.location.search).get("signed_out") === "1" ? "signed_out" : "");

  shell.innerHTML =
    renderSignInFlash(flashKind) +
    '<section class="portal-card portal-signin-card" aria-labelledby="portalSignInHeading">' +
    '<header class="portal-signin-head">' +
    '<p class="portal-eyebrow">Therapist portal</p>' +
    '<h1 id="portalSignInHeading" class="portal-signin-title">Sign in to manage your listing</h1>' +
    '<p class="portal-signin-lede">Edit your profile, update availability, and see who\'s been viewing your listing.</p>' +
    "</header>" +
    '<form id="portalSignInForm" class="portal-signin-form" novalidate>' +
    '<label for="portalSignInEmail" class="portal-signin-label">Your listing email</label>' +
    '<input type="email" id="portalSignInEmail" name="email" class="portal-signin-input" ' +
    'placeholder="you@practice.com" autocomplete="email" inputmode="email" ' +
    'autocapitalize="none" spellcheck="false" required ' +
    'aria-describedby="portalSignInHelper portalSignInFeedback" />' +
    '<p id="portalSignInHelper" class="portal-signin-helper">' +
    "We'll email a secure sign-in link to the address on your listing. It usually arrives within a minute." +
    "</p>" +
    '<p class="portal-signin-helper">' +
    'Not sure which email is on your listing? <a href="/claim">Find your listing →</a>' +
    "</p>" +
    '<p class="portal-signin-security">' +
    "No password needed. We'll email you a sign-in link, valid for 24 hours." +
    "</p>" +
    '<button class="btn-primary portal-signin-submit" type="submit" id="portalSignInSubmit">' +
    "Email me a sign-in link" +
    "</button>" +
    '<p id="portalSignInFeedback" class="portal-signin-feedback" role="status" aria-live="polite"></p>' +
    "</form>" +
    "</section>" +
    '<section class="portal-card portal-signin-help" aria-labelledby="portalSignInHelpHeading">' +
    '<h2 id="portalSignInHelpHeading" class="portal-signin-help-title">Need help accessing your listing?</h2>' +
    '<ul class="portal-signin-help-list">' +
    '<li>Haven\'t claimed your profile yet? <a href="/claim">Claim your profile</a>.</li>' +
    '<li>Need to update your email? <a href="/claim">Update the email on your listing</a>.</li>' +
    '<li>Still stuck? <a href="mailto:support@bipolartherapyhub.com">Email support</a>.</li>' +
    "</ul>" +
    "</section>";

  if (flashKind === "invalid_link") {
    trackFunnelEvent("portal_signin_expired_link_shown", {});
  }
  trackFunnelEvent("portal_signin_viewed", { flash: flashKind || "none" });

  var form = document.getElementById("portalSignInForm");
  var emailInput = document.getElementById("portalSignInEmail");
  var submitBtn = document.getElementById("portalSignInSubmit");
  var feedback = document.getElementById("portalSignInFeedback");
  var lastSentAt = 0;
  var signInRequestInFlight = false;

  if (opts.prefillEmail && emailInput) {
    emailInput.value = opts.prefillEmail;
  }

  function setFeedback(message, tone) {
    if (!feedback) return;
    feedback.textContent = message || "";
    feedback.dataset.tone = tone || "";
  }

  function setBusy(isBusy, sentEmail) {
    if (!submitBtn) return;
    submitBtn.disabled = isBusy;
    if (isBusy) {
      submitBtn.dataset.labelRest = submitBtn.dataset.labelRest || submitBtn.textContent;
      submitBtn.textContent = "Sending sign-in link...";
    } else if (sentEmail) {
      submitBtn.textContent = "Resend sign-in link";
    } else if (submitBtn.dataset.labelRest) {
      submitBtn.textContent = submitBtn.dataset.labelRest;
    }
  }

  if (emailInput) {
    emailInput.addEventListener("input", function () {
      if (feedback && feedback.dataset.tone === "error") {
        setFeedback("", "");
      }
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var email = normalizeSignInEmail(emailInput && emailInput.value);
    if (!email) {
      setFeedback("Enter the email on your listing.", "error");
      emailInput && emailInput.focus();
      return;
    }
    if (!EMAIL_REGEX.test(email)) {
      setFeedback("That doesn't look like a valid email. Double-check and try again.", "error");
      trackFunnelEvent("portal_signin_invalid_email", {});
      emailInput && emailInput.focus();
      return;
    }
    if (emailInput) {
      emailInput.value = email;
    }
    if (signInRequestInFlight) {
      return;
    }

    var now = Date.now();
    var sinceLast = now - lastSentAt;
    if (lastSentAt && sinceLast < SIGNIN_RESEND_COOLDOWN_MS) {
      var wait = Math.ceil((SIGNIN_RESEND_COOLDOWN_MS - sinceLast) / 1000);
      setFeedback(
        "You just requested a link. Check your inbox, or try again in " + wait + " seconds.",
        "info",
      );
      trackFunnelEvent("portal_signin_resend_rate_limited", {});
      return;
    }

    signInRequestInFlight = true;
    setBusy(true, false);
    setFeedback("Sending sign-in link...", "info");
    trackFunnelEvent("portal_signin_requested", { email_domain: email.split("@")[1] || "" });
    requestTherapistSignIn(email)
      .then(function () {
        lastSentAt = Date.now();
        setBusy(false, email);
        setFeedback(
          "If that address is linked to a claimed profile, a sign-in link is on its way. Check your inbox in a moment. Valid for 24 hours.",
          "info",
        );
        trackFunnelEvent("portal_signin_link_sent", {});
      })
      .catch(function (error) {
        setBusy(false, false);
        setFeedback(
          (error && error.message) ||
            "We couldn't send a sign-in link right now. Try again in a moment, or email support@bipolartherapyhub.com if it keeps failing.",
          "error",
        );
        trackFunnelEvent("portal_signin_failure_shown", {});
      })
      .finally(function () {
        signInRequestInFlight = false;
      });
  });
}

function describeFeaturedStatus(subscription) {
  if (!subscription || subscription.plan === "none" || !subscription.status) {
    return 'You\'re on the free listing. Upgrade to unlock the weekly analytics dashboard, Monday digest email, and same-day profile edits. <a href="/pricing" style="color:var(--teal)">See what\'s included →</a>';
  }
  if (subscription.has_active_featured) {
    var endDate = formatDate(subscription.current_period_ends_at);
    if (subscription.cancel_at_period_end) {
      // Trial-with-scheduled-cancel is the most common way a user ends up
      // here. The end date comes from trialEndsAt (trial cancels never
      // reach a billed period), falling back to currentPeriodEndsAt for
      // post-trial cancels.
      var cancelDate = formatDate(subscription.trial_ends_at) || endDate;
      return (
        "Cancellation scheduled" +
        (cancelDate ? " for " + cancelDate : "") +
        ". Your paid features (analytics, digest email, same-day profile edits) continue through that date, then your listing reverts to free. Resume anytime from Manage subscription."
      );
    }
    if (subscription.status === "trialing") {
      var trialEnd = formatDate(subscription.trial_ends_at);
      return (
        "14-day free trial active." +
        (trialEnd ? " Trial ends " + trialEnd + "." : "") +
        " You can cancel anytime before then, no charge until day 15. " +
        "Use Manage subscription below to cancel in one click."
      );
    }
    return (
      "Subscription active." +
      (endDate ? " Renews " + endDate + "." : "") +
      " Cancel or update payment anytime from Manage subscription."
    );
  }
  if (subscription.status === "past_due" || subscription.status === "unpaid") {
    return "Your subscription needs attention. Open Manage subscription to fix your payment method.";
  }
  return "No active subscription. Start a 14-day free trial to unlock analytics and enhanced profile.";
}

// Welcome-upsell banner reveal. Called once subscription loads. Paid
// therapists never see it; free-tier therapists see it until they
// dismiss it (tracked per-slug in localStorage so returning visits
// don't re-show after explicit dismissal).
var PORTAL_UPSELL_DISMISS_KEY = "bth_portal_upsell_dismissed_v1";

function isUpsellDismissed(slug) {
  try {
    var raw = window.localStorage.getItem(PORTAL_UPSELL_DISMISS_KEY) || "{}";
    var parsed = JSON.parse(raw);
    return Boolean(parsed && parsed[String(slug || "")]);
  } catch (_error) {
    return false;
  }
}

function markUpsellDismissed(slug) {
  try {
    var key = String(slug || "");
    if (!key) return;
    var raw = window.localStorage.getItem(PORTAL_UPSELL_DISMISS_KEY) || "{}";
    var parsed = {};
    try {
      parsed = JSON.parse(raw) || {};
    } catch (_error) {
      parsed = {};
    }
    parsed[key] = new Date().toISOString();
    window.localStorage.setItem(PORTAL_UPSELL_DISMISS_KEY, JSON.stringify(parsed));
  } catch (_error) {
    // best-effort; refusing to persist is fine
  }
}

function renderPortalWelcomeUpsell(subscription, therapistSlug, therapistEmail) {
  var banner = document.getElementById("portalWelcomeUpsell");
  if (!banner) return;
  var isPaid = Boolean(subscription && subscription.has_active_featured);
  if (isPaid) {
    banner.hidden = true;
    return;
  }
  if (isUpsellDismissed(therapistSlug)) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  var dismiss = document.getElementById("portalWelcomeUpsellDismiss");
  if (dismiss && !dismiss.dataset.wired) {
    dismiss.dataset.wired = "1";
    dismiss.addEventListener("click", function () {
      markUpsellDismissed(therapistSlug);
      banner.hidden = true;
    });
  }
  var cta = document.getElementById("portalWelcomeUpsellCta");
  if (cta && !cta.dataset.wired) {
    cta.dataset.wired = "1";
    cta.addEventListener("click", async function (event) {
      if (event && event.preventDefault) event.preventDefault();
      if (!therapistSlug) return;
      var originalLabel = cta.textContent;
      cta.disabled = true;
      cta.textContent = "Opening secure checkout...";
      try {
        var result = await createStripeFeaturedCheckoutSession({
          therapist_slug: therapistSlug,
          email: therapistEmail || "",
          plan: "paid_monthly",
          return_path: "/portal.html?slug=" + encodeURIComponent(therapistSlug),
        });
        var checkoutUrl = result && result.url ? safeStripeRedirectUrl(result.url) : "";
        if (checkoutUrl) {
          window.location.href = checkoutUrl;
          return;
        }
        throw new Error("No checkout URL returned.");
      } catch (_error) {
        // Fall back to /pricing so the user still has a path forward.
        cta.disabled = false;
        cta.textContent = originalLabel;
        var params = new URLSearchParams();
        params.set("slug", therapistSlug);
        if (therapistEmail) params.set("email", therapistEmail);
        window.location.href = "/pricing?" + params.toString();
      }
    });
  }
}

// When a subscription is flagged cancel_at_period_end, surface a
// prominent top-of-portal banner so the user isn't surprised by a
// sudden tier change on the end date. Idempotent, re-renders cleanly
// if subscription state changes without leaving a duplicate element.
function renderCancelScheduledBanner(subscription) {
  var existing = document.getElementById("portalCancelScheduledBanner");
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }
  if (!subscription || !subscription.cancel_at_period_end || !subscription.has_active_featured) {
    return;
  }
  var endIso = subscription.trial_ends_at || subscription.current_period_ends_at || "";
  var endLabel = endIso ? formatDate(endIso) : "";
  var shell = document.getElementById("portalShell");
  if (!shell) return;
  var hero = shell.querySelector(".portal-hero");
  var banner = document.createElement("section");
  banner.id = "portalCancelScheduledBanner";
  banner.className = "portal-card";
  banner.style.cssText = "border:1px solid #f59e0b;background:#fffbeb;margin-bottom:1rem";
  banner.innerHTML =
    '<p class="portal-eyebrow" style="color:#92400e;margin:0 0 0.35rem">Cancellation scheduled</p>' +
    '<h2 style="margin:0 0 0.35rem">Your paid features end' +
    (endLabel ? " " + escapeHtml(endLabel) : "") +
    "</h2>" +
    '<p class="portal-subtle" style="margin:0">' +
    "Analytics, Monday digest email, and same-day profile edits continue through that date. " +
    "Your listing then reverts to the free tier (still ranked by fit, still listed in the directory). " +
    "Resume anytime from the Subscription card below." +
    "</p>";
  if (hero && hero.nextSibling) {
    hero.parentNode.insertBefore(banner, hero.nextSibling);
  } else {
    shell.insertBefore(banner, shell.firstChild);
  }
}

function renderFeaturedCard(subscription) {
  var body = document.getElementById("portalFeaturedBody");
  var actions = document.getElementById("portalFeaturedActions");
  if (!body || !actions) {
    return;
  }
  body.textContent = describeFeaturedStatus(subscription);
  var hasCustomer = Boolean(
    subscription && subscription.plan && subscription.plan !== "none" && subscription.status,
  );
  var showUpgrade = !subscription || !subscription.has_active_featured;
  var buttons = "";
  if (showUpgrade) {
    buttons +=
      '<button class="btn-primary" type="button" id="portalFeaturedUpgradeButton">Start 14-day free trial</button>';
  }
  if (hasCustomer) {
    // Surface cancel intent front and center, this is the action users
    // look for most urgently on a trial and it was buried under "Manage
    // billing" (sounded like a payment-method update, not a cancel path).
    var billingLabel =
      subscription && subscription.status === "trialing"
        ? "Manage subscription · Cancel trial"
        : "Manage subscription";
    buttons +=
      '<button class="btn-primary" type="button" id="portalFeaturedBillingButton">' +
      billingLabel +
      "</button>";
  }
  actions.innerHTML = buttons;

  var upgradeButton = document.getElementById("portalFeaturedUpgradeButton");
  if (upgradeButton) {
    upgradeButton.addEventListener("click", handleFeaturedUpgradeClick);
  }
  var billingButton = document.getElementById("portalFeaturedBillingButton");
  if (billingButton) {
    billingButton.addEventListener("click", handleFeaturedBillingClick);
  }
}

function handleFeaturedUpgradeClick(event) {
  var card = document.getElementById("portalFeaturedCard");
  if (!card) {
    return;
  }
  var slug = card.getAttribute("data-therapist-slug") || "";
  var email = card.getAttribute("data-therapist-email") || "";
  if (!slug) {
    return;
  }
  var params = new URLSearchParams();
  params.set("slug", slug);
  if (email) {
    params.set("email", email);
  }
  if (event && event.preventDefault) {
    event.preventDefault();
  }
  window.location.href = "/pricing?" + params.toString();
}

async function handleFeaturedBillingClick(event) {
  var feedback = document.getElementById("portalFeaturedFeedback");
  var button = event.currentTarget;
  button.disabled = true;
  if (feedback) {
    feedback.textContent = "Opening billing...";
  }
  try {
    var result = await createStripeBillingPortalSession({
      // Return the therapist to their own portal (with slug) instead of
      // the unslugged lookup state. stripe=managed lets the portal know
      // the user just came back from Stripe billing so it can refresh
      // subscription state rather than relying on cached render data.
      return_path: "/portal.html?slug=" + encodeURIComponent(slug || "") + "&stripe=managed",
    });
    var billingUrl = result && result.url ? safeStripeRedirectUrl(result.url) : "";
    if (billingUrl) {
      window.location.href = billingUrl;
      return;
    }
    throw new Error("No billing portal URL returned.");
  } catch (error) {
    button.disabled = false;
    if (feedback) {
      feedback.textContent =
        (error && error.message) || "We could not open billing. Try again in a moment.";
    }
  }
}

// Portal analytics V0, render five numbers summarizing this week's
// engagement: profile views total, contact intents (CTA clicks), views
// from match results, views from directory search, and a period label.
// Numbers come from the therapistEngagementSummary Sanity document for
// the current ISO week, populated in real time by /engagement/view
// and /engagement/cta-click endpoints.
//
// If there's no summary for the current month yet, render a gentle
// empty state instead of zeroes, a new listing literally has no data,
// and "0 views" in big type reads worse than "No activity yet."
// Format an ISO-week period key (e.g. "2026-W16") for the analytics card.
// Prefer "Week of Apr 13" when we have a periodStart datetime from the
// server; fall back to "Week 16, 2026" if only the key is available.
function formatAnalyticsPeriodLabel(periodKey, periodStart) {
  if (periodStart) {
    const date = new Date(periodStart);
    if (!Number.isNaN(date.getTime())) {
      const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      return "Week of " + months[date.getUTCMonth()] + " " + date.getUTCDate();
    }
  }
  const match = String(periodKey || "").match(/^(\d{4})-W(\d{2})$/);
  if (match) return "this week";
  return "this week";
}

function renderAnalyticsStat(number, subLabel, detail) {
  return (
    '<div class="portal-analytics-stat" style="padding:0.8rem 0.9rem;border:1px solid var(--border);border-radius:14px;background:#fbfefe">' +
    '<div style="font-size:1.65rem;font-weight:800;color:var(--navy);line-height:1.05">' +
    escapeHtml(String(number)) +
    "</div>" +
    '<div style="font-size:0.78rem;color:var(--muted);margin-top:0.18rem">' +
    escapeHtml(subLabel) +
    "</div>" +
    (detail
      ? '<div style="font-size:0.76rem;color:var(--teal-dark, #155f70);font-weight:700;margin-top:0.35rem">' +
        escapeHtml(detail) +
        "</div>"
      : "") +
    "</div>"
  );
}

function formatAnalyticsPercent(value) {
  if (!Number.isFinite(value)) return "0%";
  if (value > 0 && value < 1) return "<1%";
  return Math.round(value) + "%";
}

function formatAnalyticsRate(part, total) {
  const denominator = Number(total || 0);
  if (!denominator) return "Not enough data";
  return formatAnalyticsPercent((Number(part || 0) / denominator) * 100);
}

function getAnalyticsTrend(currentValue, previousValue) {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);
  if (!previous && current > 0) return { direction: "new", label: "new activity" };
  if (!previous && !current) return { direction: "flat", label: "no activity yet" };
  const diff = current - previous;
  if (Math.abs(diff) < 1) return { direction: "flat", label: "unchanged" };
  const pct = Math.round((Math.abs(diff) / previous) * 100);
  return {
    direction: diff > 0 ? "up" : "down",
    label: (diff > 0 ? "up " : "down ") + pct + "% vs last week",
    diff: diff,
  };
}

function getPreviousAnalyticsSummary(summaries, currentPeriodKey) {
  const sorted = (Array.isArray(summaries) ? summaries : []).slice().sort(function (a, b) {
    return String(a.periodKey || "").localeCompare(String(b.periodKey || ""));
  });
  const currentIndex = sorted.findIndex(function (item) {
    return item && item.periodKey === currentPeriodKey;
  });
  if (currentIndex > 0) {
    return sorted[currentIndex - 1];
  }
  return sorted.length > 1 ? sorted[sorted.length - 2] : null;
}

function getAnalyticsSignalLabel(views, clicks) {
  const total = Number(views || 0) + Number(clicks || 0);
  if (total < 5) return "Low-signal week";
  if (total < 15) return "Directional signal";
  return "Strong enough for weekly decisions";
}

function getAnalyticsSignalCopy(views, clicks) {
  const total = Number(views || 0) + Number(clicks || 0);
  if (total < 5) {
    return "Activity is light, so treat changes as directional. Use the readiness checks below instead of over-reading one quiet week.";
  }
  if (total < 15) {
    return "There is enough activity to spot direction, but one or two patient actions can still move the percentages.";
  }
  return "This week has enough activity to compare source mix, contact behavior, and next-step opportunities.";
}

function buildAnalyticsBreakdown(items, total, label) {
  const safeTotal = Math.max(Number(total || 0), 0);
  const ranked = items
    .map(function (item) {
      return Object.assign({}, item, { count: Number(item.count || 0) });
    })
    .sort(function (a, b) {
      return b.count - a.count;
    });
  const top = ranked.find(function (item) {
    return item.count > 0;
  });
  return {
    label: label,
    total: safeTotal,
    items: ranked,
    top: top || null,
  };
}

function renderAnalyticsBreakdownCard(title, breakdown, emptyCopy, insightCopy) {
  const max = breakdown.items.reduce(function (highest, item) {
    return Math.max(highest, item.count);
  }, 0);
  const rows = breakdown.items
    .map(function (item) {
      const width = max > 0 ? Math.max(4, Math.round((item.count / max) * 100)) : 0;
      const percent = breakdown.total ? formatAnalyticsRate(item.count, breakdown.total) : "0%";
      return (
        '<div style="display:grid;grid-template-columns:minmax(7rem,0.7fr) minmax(6rem,1fr) 3.4rem;gap:0.6rem;align-items:center;font-size:0.88rem">' +
        '<span style="color:var(--navy);font-weight:650">' +
        escapeHtml(item.label) +
        "</span>" +
        '<span style="height:0.7rem;border-radius:999px;background:#e5eef1;overflow:hidden" aria-hidden="true"><span style="display:block;height:100%;width:' +
        width +
        '%;border-radius:999px;background:linear-gradient(90deg,var(--teal),#72b7c7)"></span></span>' +
        '<span style="color:var(--muted);text-align:right">' +
        escapeHtml(String(item.count)) +
        " · " +
        escapeHtml(percent) +
        "</span></div>"
      );
    })
    .join("");
  return (
    '<section aria-label="' +
    escapeAttr(title) +
    '" style="padding:0.95rem;border:1px solid var(--border);border-radius:16px;background:#fbfefe">' +
    '<div style="display:flex;justify-content:space-between;gap:1rem;align-items:baseline;margin-bottom:0.65rem"><h3 style="font-family:Fraunces,serif;font-size:1.02rem;margin:0;color:var(--navy)">' +
    escapeHtml(title) +
    '</h3><span style="font-size:0.78rem;color:var(--muted)">ranked by volume</span></div>' +
    (breakdown.total
      ? '<div style="display:grid;gap:0.55rem">' + rows + "</div>"
      : '<p class="portal-subtle" style="margin:0">' + escapeHtml(emptyCopy) + "</p>") +
    (insightCopy
      ? '<p style="margin:0.75rem 0 0;color:var(--slate);font-size:0.88rem;line-height:1.5">' +
        escapeHtml(insightCopy) +
        "</p>"
      : "") +
    "</section>"
  );
}

function buildAnalyticsRecommendations(data) {
  const actions = [];
  const rate = data.views > 0 ? (data.clicks / data.views) * 100 : 0;
  const topGap = data.readiness.gaps[0] || null;
  const secondGap = data.readiness.gaps[1] || null;

  if (data.views >= 8 && data.clicks === 0 && topGap) {
    actions.push({
      label: "Action 1",
      title: topGap.actionLabel,
      text: "You had " + data.views + " profile views but no contact clicks. " + topGap.reason,
      benefit: "Expected benefit: clearer next steps for patients who already found you.",
      ctaLabel: topGap.actionLabel,
      ctaKey: topGap.key,
    });
  } else if (topGap) {
    actions.push({
      label: "Action 1",
      title: topGap.actionLabel,
      text: topGap.reason,
      benefit:
        "Expected benefit: stronger listing readiness for future match and contact activity.",
      ctaLabel: topGap.actionLabel,
      ctaKey: topGap.key,
    });
  } else if (data.topContact) {
    actions.push({
      label: "Action 1",
      title: "Protect the strongest contact path",
      text:
        data.topContact.label +
        " drove the clearest patient intent this week with " +
        data.topContact.count +
        " clicks.",
      benefit:
        "Expected benefit: preserve what is already working while you refine the rest of the profile.",
      ctaLabel: "Review contact options",
      ctaKey: "contact_path",
    });
  } else {
    actions.push({
      label: "Action 1",
      title: "Review profile clarity",
      text: "No single signal is dominant yet, so use this week to tighten the profile before volume increases.",
      benefit: "Expected benefit: stronger readiness before the next meaningful traffic week.",
      ctaLabel: "Edit profile",
      ctaKey: "profile_clarity",
    });
  }

  if (data.topSource && data.topSource.key === "match") {
    actions.push({
      label: "Action 2",
      title: "Strengthen match-fit language",
      text: "Match flow is your strongest discovery source, so specialty wording and bipolar-fit signals likely matter more than broad browse traffic right now.",
      benefit: "Expected benefit: improve how confidently patients choose you in guided matching.",
      ctaLabel: "Review specialties",
      ctaKey: "bipolar_fit",
    });
  } else if (secondGap) {
    actions.push({
      label: "Action 2",
      title: secondGap.actionLabel,
      text: secondGap.reason,
      benefit: "Expected benefit: remove another point of hesitation before contact.",
      ctaLabel: secondGap.actionLabel,
      ctaKey: secondGap.key,
    });
  } else if (data.topSource && data.topSource.key === "directory") {
    actions.push({
      label: "Action 2",
      title: "Tighten browse-facing clarity",
      text: "Directory discovery is leading this week. Patients browsing tend to respond best to clear specialties, fees, and availability.",
      benefit: "Expected benefit: convert more directory views into contact intent.",
      ctaLabel: "Edit profile",
      ctaKey: "directory_clarity",
    });
  }

  actions.push({
    label: "Watch next week",
    title: "Monitor contact intent rate",
    text:
      data.views < 5
        ? "Wait for a stronger week before drawing conclusions from source mix. Use next Monday to see whether activity rises after your profile updates."
        : "Watch whether contact intent rate stays near " +
          formatAnalyticsPercent(rate) +
          " as profile views change. If traffic rises but the rate falls, profile clarity is likely the next bottleneck.",
    benefit:
      "Why it matters: this tells you whether profile changes are improving patient action, not just visibility.",
    ctaLabel: "Review profile",
    ctaKey: "watch_next_week",
  });
  return actions;
}

function renderAnalyticsRecommendations(actions) {
  return (
    '<section aria-label="Top actions this week" style="grid-column:1 / -1;padding:1rem;border:1px solid rgba(31,122,143,0.24);border-radius:18px;background:linear-gradient(135deg,#e8f5f8 0%,#fff 78%)">' +
    '<div style="display:flex;justify-content:space-between;gap:1rem;align-items:baseline;margin-bottom:0.75rem"><h3 style="font-family:Fraunces,serif;font-size:1.08rem;margin:0;color:var(--navy)">Top actions this week</h3><span style="font-size:0.78rem;color:var(--muted)">ranked by likely impact</span></div>' +
    '<div style="display:grid;gap:0.65rem">' +
    actions
      .map(function (action) {
        return (
          '<div style="padding:0.85rem 0.9rem;border-left:4px solid var(--teal);border-radius:14px;background:#fff">' +
          '<div style="font-size:0.76rem;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--teal-dark,#155f70)">' +
          escapeHtml(action.label) +
          "</div>" +
          '<div style="margin-top:0.2rem;font-weight:800;color:var(--navy);font-size:0.98rem">' +
          escapeHtml(action.title) +
          "</div>" +
          '<div style="margin-top:0.28rem;color:var(--slate);font-size:0.9rem;line-height:1.5">' +
          escapeHtml(action.text) +
          "</div>" +
          '<div style="margin-top:0.38rem;color:var(--muted);font-size:0.82rem;line-height:1.45">' +
          escapeHtml(action.benefit) +
          "</div>" +
          '<div style="margin-top:0.65rem"><a class="btn-secondary" href="#portalEditProfile" data-portal-editor-jump="1" data-analytics-action="' +
          escapeAttr(action.ctaKey) +
          '" style="padding:0.48rem 0.8rem;font-size:0.85rem">' +
          escapeHtml(action.ctaLabel) +
          "</a></div></div>"
        );
      })
      .join("") +
    "</div></section>"
  );
}

function buildListingReadiness(therapist) {
  const t = therapist || {};
  const lastSavedAt = t.portal_last_save_at || t.portalLastSaveAt || "";
  const lastSavedDate = lastSavedAt ? new Date(lastSavedAt) : null;
  const now = Date.now();
  const daysSinceSave =
    lastSavedDate && !Number.isNaN(lastSavedDate.getTime())
      ? Math.floor((now - lastSavedDate.getTime()) / (1000 * 60 * 60 * 24))
      : null;
  const specialties = Array.isArray(t.specialties) ? t.specialties : [];
  const insuranceAccepted = Array.isArray(t.insurance_accepted || t.insuranceAccepted)
    ? t.insurance_accepted || t.insuranceAccepted
    : [];
  const telehealthStates = Array.isArray(t.telehealth_states || t.telehealthStates)
    ? t.telehealth_states || t.telehealthStates
    : [];
  const bipolarSignal =
    typeof t.bipolar_years_experience === "number" ||
    typeof t.bipolarYearsExperience === "number" ||
    specialties.some(function (item) {
      return String(item || "")
        .toLowerCase()
        .includes("bipolar");
    });
  const hasAvailabilityDetail = Boolean(
    String(
      t.estimated_wait_time || t.estimatedWaitTime || t.contact_guidance || t.contactGuidance || "",
    ).trim().length,
  );
  const items = [
    {
      key: "booking_link",
      label: "Booking link",
      ok: Boolean(String(t.booking_url || t.bookingUrl || "").trim()),
      impact: "Improves the easiest next step for high-intent patients.",
      actionLabel: "Add booking link",
      reason: "Patients are more likely to act when the next step is obvious.",
      priority: 5,
    },
    {
      key: "availability",
      label: "Availability details",
      ok: hasAvailabilityDetail,
      impact: "Reduces uncertainty once patients land on the profile.",
      actionLabel: "Update availability",
      reason: "Availability language helps traffic turn into next-step action.",
      priority: 5,
    },
    {
      key: "fees",
      label: "Fee or insurance clarity",
      ok:
        typeof t.session_fee_min === "number" ||
        typeof t.sessionFeeMin === "number" ||
        t.sliding_scale === true ||
        t.slidingScale === true ||
        insuranceAccepted.length > 0,
      impact: "Helps patients decide fit before they reach out.",
      actionLabel: "Add fee details",
      reason: "Patients often need cost clarity before they contact.",
      priority: 4,
    },
    {
      key: "bipolar_fit",
      label: "Bipolar fit signals",
      ok: bipolarSignal,
      impact: "Supports stronger performance in guided match flow.",
      actionLabel: "Strengthen specialty language",
      reason: "Match flow depends on credible fit signals, not just traffic.",
      priority: 4,
    },
    {
      key: "care_approach",
      label: "Profile summary strength",
      ok:
        String(t.bio || "").trim().length >= 140 ||
        String(t.care_approach || t.careApproach || "").trim().length >= 90,
      impact: "Helps patients understand how you work before they contact.",
      actionLabel: "Improve profile summary",
      reason: "A stronger summary makes profile traffic more useful.",
      priority: 3,
    },
    {
      key: "care_mode",
      label: "Care mode setup",
      ok:
        t.accepts_telehealth !== false ||
        t.acceptsTelehealth !== false ||
        t.accepts_in_person !== false ||
        t.acceptsInPerson !== false ||
        telehealthStates.length > 0,
      impact: "Clarifies whether telehealth or in-person care is available.",
      actionLabel: "Review care setup",
      reason: "Patients need to know whether your care mode fits their needs.",
      priority: 2,
    },
    {
      key: "recency",
      label: "Recent profile update",
      ok: daysSinceSave !== null && daysSinceSave <= 45,
      impact: "Keeps the listing current when profile performance changes.",
      actionLabel: "Review profile",
      reason:
        daysSinceSave === null
          ? "Recent edits are not showing yet."
          : "The profile has not been updated in " + daysSinceSave + " days.",
      priority: 1,
    },
  ];
  const strengths = items.filter(function (item) {
    return item.ok;
  });
  const gaps = items
    .filter(function (item) {
      return !item.ok;
    })
    .sort(function (a, b) {
      return b.priority - a.priority;
    });
  return {
    score: strengths.length,
    total: items.length,
    strengths: strengths,
    gaps: gaps,
    items: items,
    summary:
      gaps.length === 0
        ? "Your profile is covering the main readiness signals patients need before contacting."
        : "Profile quality still has room to improve, and those gaps can limit match confidence or next-step action.",
  };
}

function renderListingReadiness(readiness, therapist) {
  const readinessScore = readiness.score + " / " + readiness.total;
  const topGap = readiness.gaps[0] || null;
  return (
    '<section aria-label="Profile strength" style="grid-column:1 / -1;padding:1rem;border:1px solid rgba(21,95,112,0.18);border-radius:18px;background:#fff">' +
    '<div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap;margin-bottom:0.8rem">' +
    '<div><p class="portal-eyebrow" style="margin:0 0 0.35rem">Profile strength</p><h3 style="font-family:Fraunces,serif;font-size:1.15rem;margin:0;color:var(--navy)">Listing readiness</h3>' +
    '<p style="margin:0.4rem 0 0;color:var(--slate);font-size:0.9rem;line-height:1.5">' +
    escapeHtml(readiness.summary) +
    '</p><div class="portal-actions" style="margin-top:0.75rem">' +
    '<a class="btn-primary" href="#portalEditProfile" data-portal-editor-jump="1" data-analytics-action="open_profile_editor">Open profile editor</a>' +
    ((therapist && therapist.slug) || ""
      ? '<a class="btn-secondary" href="/therapists/' +
        encodeURIComponent(therapist.slug) +
        '" target="_blank" rel="noopener">View public listing ↗</a>'
      : "") +
    "</div></div>" +
    '<div style="min-width:128px;padding:0.85rem 0.95rem;border:1px solid #b8dfe7;border-radius:16px;background:#f4fbfc;text-align:center"><div style="font-size:0.76rem;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--teal-dark,#155f70)">Signals present</div><div style="font-size:1.75rem;font-weight:800;color:var(--navy);line-height:1.1;margin-top:0.15rem">' +
    escapeHtml(readinessScore) +
    "</div></div></div>" +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:0.65rem">' +
    readiness.items
      .map(function (item) {
        return (
          '<div style="padding:0.78rem;border:1px solid ' +
          (item.ok ? "#b8dfe7" : "#ead0ba") +
          ";border-radius:14px;background:" +
          (item.ok ? "#f4fbfc" : "#fff8f0") +
          '">' +
          '<div style="font-weight:800;color:var(--navy);font-size:0.9rem">' +
          (item.ok ? "Strong: " : "Missing: ") +
          escapeHtml(item.label) +
          "</div>" +
          '<div style="margin-top:0.25rem;color:var(--slate);font-size:0.82rem;line-height:1.45">' +
          escapeHtml(item.impact) +
          "</div>" +
          (!item.ok
            ? '<div style="margin-top:0.55rem"><a class="btn-secondary" href="#portalEditProfile" data-portal-editor-jump="1" data-analytics-action="' +
              escapeAttr(item.key) +
              '" style="padding:0.48rem 0.8rem;font-size:0.85rem">' +
              escapeHtml(item.actionLabel) +
              "</a></div>"
            : "") +
          "</div>"
        );
      })
      .join("") +
    "</div>" +
    (topGap
      ? '<div style="margin-top:0.8rem;padding:0.8rem 0.9rem;border-radius:14px;background:#f8fbfc;border:1px dashed #b8dfe7"><strong style="color:var(--navy)">Highest-impact profile update:</strong> ' +
        escapeHtml(topGap.actionLabel) +
        '. <span style="color:var(--slate)">' +
        escapeHtml(topGap.reason) +
        "</span></div>"
      : "") +
    "</section>"
  );
}

function renderAnalyticsWatchModule(action) {
  return (
    '<section aria-label="What to watch next week" style="grid-column:1 / -1;padding:0.95rem;border:1px solid var(--border);border-radius:16px;background:#fbfefe">' +
    '<p class="portal-eyebrow" style="margin:0 0 0.35rem">What to watch next week</p>' +
    '<h3 style="font-family:Fraunces,serif;font-size:1.02rem;margin:0;color:var(--navy)">' +
    escapeHtml(action.title) +
    "</h3>" +
    '<p style="margin:0.45rem 0 0;color:var(--slate);font-size:0.9rem;line-height:1.55">' +
    escapeHtml(action.text) +
    "</p>" +
    '<p style="margin:0.45rem 0 0;color:var(--muted);font-size:0.82rem;line-height:1.45">' +
    escapeHtml(action.benefit) +
    "</p></section>"
  );
}

function wireAnalyticsActionHandlers(therapist) {
  document.querySelectorAll("[data-analytics-action]").forEach(function (link) {
    if (link.dataset.analyticsWired === "1") return;
    link.dataset.analyticsWired = "1";
    link.addEventListener("click", function () {
      trackFunnelEvent("portal_analytics_action_clicked", {
        slug: (therapist && therapist.slug) || "",
        action: link.getAttribute("data-analytics-action") || "",
      });
    });
  });
}

// Inline sparkline SVG for weekly trend. Expects an array of 12 weekly
// counts in chronological order (oldest first). Empty/zero arrays render
// a flat line without scaling noise.
function renderAnalyticsSparkline(weeklyCounts) {
  var counts = Array.isArray(weeklyCounts) ? weeklyCounts.slice(-12) : [];
  while (counts.length < 12) counts.unshift(0);
  var max = counts.reduce(function (m, v) {
    return Math.max(m, Number(v) || 0);
  }, 0);
  var w = 280;
  var h = 48;
  var step = w / (counts.length - 1 || 1);
  var points = counts
    .map(function (v, i) {
      var y = max > 0 ? h - ((Number(v) || 0) / max) * (h - 6) - 3 : h / 2;
      return i * step + "," + y.toFixed(1);
    })
    .join(" ");
  var lastIdx = counts.length - 1;
  var lastY = max > 0 ? h - ((Number(counts[lastIdx]) || 0) / max) * (h - 6) - 3 : h / 2;
  return (
    '<svg viewBox="0 0 ' +
    w +
    " " +
    h +
    '" width="100%" height="' +
    h +
    '" preserveAspectRatio="none" style="display:block;margin-top:0.4rem">' +
    '<polyline fill="none" stroke="var(--teal)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="' +
    points +
    '"/>' +
    '<circle cx="' +
    (lastIdx * step).toFixed(1) +
    '" cy="' +
    lastY.toFixed(1) +
    '" r="3" fill="var(--teal)"/>' +
    "</svg>"
  );
}

function renderAnalyticsBlock(payload, subscription, therapist) {
  const card = document.getElementById("portalAnalyticsCard");
  const body = document.getElementById("portalAnalyticsBody");
  const grid = document.getElementById("portalAnalyticsGrid");
  if (!card || !body || !grid) return;

  const isPaid = Boolean(subscription && subscription.has_active_featured);
  const current = payload && payload.current;
  const summaries = (payload && Array.isArray(payload.summaries) && payload.summaries) || [];
  const readiness = buildListingReadiness(therapist);
  const label = formatAnalyticsPeriodLabel(
    (current && current.periodKey) || (payload && payload.current_period_key),
    current && current.periodStart,
  );

  if (!current) {
    body.textContent =
      "Once you're live, this is where you'll see weekly profile views, match appearances, and contact events." +
      (label ? " (" + label + ")" : "");
    grid.hidden = false;
    grid.style.display = "block";
    grid.style.marginTop = "0.65rem";
    grid.innerHTML = isPaid
      ? renderListingReadiness(readiness, therapist) +
        renderAnalyticsWatchModule({
          title: "Profile strength before volume returns",
          text: "Use this quiet week to fill the biggest readiness gaps first. That way the profile is stronger before the next wave of traffic arrives.",
          benefit:
            "Why it matters: low-activity weeks are still useful when they help you improve contact clarity and match fit.",
        })
      : '<p style="font-size:0.86rem;color:var(--muted);margin:0">' +
        "Once patients start viewing or contacting your profile, you'll see a weekly breakdown here. " +
        '<a href="#portalFeaturedCard" style="color:var(--teal);font-weight:600;text-decoration:none">Upgrade for the full picture →</a>' +
        "</p>";
    if (isPaid) {
      wireAnalyticsActionHandlers(therapist);
    }
    return;
  }

  body.textContent = label + " · updated " + formatDate(current.lastEventAt || "");

  const views = Number(current.profileViewsTotal || 0);
  const ctaClicks = Number(current.ctaClicksTotal || 0);
  const previous = getPreviousAnalyticsSummary(
    summaries,
    (current && current.periodKey) || (payload && payload.current_period_key),
  );
  const viewsTrend = getAnalyticsTrend(views, previous && previous.profileViewsTotal);
  const clicksTrend = getAnalyticsTrend(ctaClicks, previous && previous.ctaClicksTotal);
  const contactRate = views > 0 ? (ctaClicks / views) * 100 : 0;

  // Free tier: headline numbers only + clear upgrade CTA.
  if (!isPaid) {
    grid.hidden = false;
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(140px, 1fr))";
    grid.style.gap = "0.85rem";
    grid.style.marginTop = "0.65rem";
    grid.innerHTML =
      renderAnalyticsStat(views, "Profile views this week", viewsTrend.label) +
      renderAnalyticsStat(ctaClicks, "Contact clicks this week", clicksTrend.label) +
      '<div style="grid-column:1 / -1;padding:0.85rem 1rem;border:1px dashed var(--teal);border-radius:12px;background:var(--teal-faint, #e8f5f8);display:flex;align-items:center;justify-content:space-between;gap:1rem">' +
      '<div style="font-weight:700;color:var(--teal-dark, #155f70);font-size:0.95rem">Upgrade to see your full analytics</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">' +
      '<a href="#portalFeaturedCard" class="td-bottom-card-cta" style="text-decoration:none;white-space:nowrap">Start 14-day free trial →</a>' +
      '<a href="/pricing" style="color:var(--teal-dark,#155f70);font-size:0.82rem;white-space:nowrap">See pricing</a>' +
      "</div>" +
      "</div>";
    return;
  }

  // Paid tier: full weekly decision dashboard.
  grid.hidden = false;
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(180px, 1fr))";
  grid.style.gap = "0.95rem";
  grid.style.marginTop = "0.85rem";

  const viewsMatch = Number(current.profileViewsMatch || 0);
  const viewsDirectory = Number(current.profileViewsDirectory || 0);
  const viewsDirect = Number(current.profileViewsDirect || 0);
  const viewsOther =
    Number(current.profileViewsOther || 0) +
    Number(current.profileViewsSearch || 0) +
    Number(current.profileViewsEmail || 0);

  const ctaPhone = Number(current.ctaClicksPhone || 0);
  const ctaEmail = Number(current.ctaClicksEmail || 0);
  const ctaBooking = Number(current.ctaClicksBooking || 0);
  const ctaWebsite = Number(current.ctaClicksWebsite || 0);

  const sourceBreakdown = buildAnalyticsBreakdown(
    [
      { key: "match", label: "Match flow", count: viewsMatch },
      { key: "directory", label: "Directory", count: viewsDirectory },
      { key: "direct", label: "Direct / link", count: viewsDirect },
      { key: "other", label: "Other", count: viewsOther },
    ],
    views,
    "source",
  );
  const contactBreakdown = buildAnalyticsBreakdown(
    [
      { key: "booking", label: "Booking link", count: ctaBooking },
      { key: "phone", label: "Phone", count: ctaPhone },
      { key: "email", label: "Email", count: ctaEmail },
      { key: "website", label: "Website", count: ctaWebsite },
    ],
    ctaClicks,
    "contact path",
  );
  const topSource = sourceBreakdown.top;
  const topContact = contactBreakdown.top;
  const signalLabel = getAnalyticsSignalLabel(views, ctaClicks);
  const signalCopy = getAnalyticsSignalCopy(views, ctaClicks);
  const topGap = readiness.gaps[0] || null;
  const topTakeaway =
    views < 5 && ctaClicks < 1
      ? "Activity is light this week, so the best use of the dashboard is readiness: make sure contact paths, fee clarity, and availability are easy to understand."
      : topGap && topSource && topSource.key === "match"
        ? topSource.label +
          " is driving discovery, but " +
          topGap.label.toLowerCase() +
          " is still a likely profile bottleneck."
        : topGap && views >= 8 && ctaClicks <= 1
          ? "Your listing is getting seen, but " +
            topGap.label.toLowerCase() +
            " may still be limiting patient follow-through."
          : topContact
            ? topContact.label +
              " is capturing the clearest patient intent this week, while " +
              (topSource ? topSource.label.toLowerCase() : "your visible listing") +
              " is driving discovery."
            : topSource
              ? topSource.label +
                " is driving discovery, but contact clicks have not followed yet. Treat that as a profile clarity opportunity."
              : "This week has activity, but no single source or contact path is dominant enough to act on yet.";
  const changedCopy =
    viewsTrend.direction === "new"
      ? "This is the first tracked activity for the week, so compare next Monday before treating it as a trend."
      : viewsTrend.direction === "flat" && clicksTrend.direction === "flat"
        ? "Performance is mostly stable. Use the recommendation below to improve contact clarity rather than reacting to noise."
        : "Views are " +
          viewsTrend.label +
          " and contact clicks are " +
          clicksTrend.label +
          ". The useful question is whether contact intent is keeping pace with visibility.";
  const sourceInsight = topSource
    ? topSource.label +
      " accounts for " +
      formatAnalyticsRate(topSource.count, views) +
      " of profile views this week."
    : "No source has enough activity to interpret yet.";
  const contactInsight = topContact
    ? topContact.label +
      " accounts for " +
      formatAnalyticsRate(topContact.count, ctaClicks) +
      " of contact clicks this week."
    : views
      ? "Patients are viewing the profile, but no contact path has activity yet."
      : "Contact path performance will appear once patients click phone, email, booking, or website.";
  const recommendations = buildAnalyticsRecommendations({
    views: views,
    clicks: ctaClicks,
    topSource: topSource,
    topContact: topContact,
    readiness: readiness,
  });
  const watchAction = recommendations[recommendations.length - 1];

  const weeklyViews = summaries
    .slice()
    .sort(function (a, b) {
      return String(a.periodKey || "").localeCompare(String(b.periodKey || ""));
    })
    .map(function (s) {
      return Number(s.profileViewsTotal || 0);
    });
  const latestWeeklyViews = weeklyViews.length ? weeklyViews[weeklyViews.length - 1] : views;
  const previousWeeklyViews =
    weeklyViews.length > 1
      ? weeklyViews[weeklyViews.length - 2]
      : previous && previous.profileViewsTotal;

  grid.innerHTML =
    '<section aria-label="Top insight" style="grid-column:1 / -1;padding:1rem;border:1px solid rgba(31,122,143,0.28);border-radius:18px;background:#fff">' +
    '<div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap"><div><p class="portal-eyebrow" style="margin:0 0 0.35rem">Most important takeaway</p><h3 style="font-family:Fraunces,serif;font-size:1.25rem;margin:0;color:var(--navy)">' +
    escapeHtml(topTakeaway) +
    '</h3></div><span style="border:1px solid #b8dfe7;border-radius:999px;background:#e8f5f8;color:var(--teal-dark,#155f70);font-size:0.78rem;font-weight:800;padding:0.35rem 0.55rem">' +
    escapeHtml(signalLabel) +
    "</span></div>" +
    '<p style="margin:0.75rem 0 0;color:var(--slate);font-size:0.9rem;line-height:1.55">' +
    escapeHtml(signalCopy) +
    "</p></section>" +
    renderListingReadiness(readiness, therapist) +
    renderAnalyticsRecommendations(recommendations.slice(0, 2)) +
    '<section aria-label="Performance summary" style="grid-column:1 / -1;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0.75rem;padding:0.95rem;border:1px solid rgba(31,122,143,0.25);border-radius:18px;background:linear-gradient(135deg,#f4fbfc 0%,#fff 72%)">' +
    renderAnalyticsStat(views, "Profile views", viewsTrend.label) +
    renderAnalyticsStat(ctaClicks, "Contact clicks", clicksTrend.label) +
    renderAnalyticsStat(
      formatAnalyticsPercent(contactRate),
      "Contact intent rate",
      "clicks / views",
    ) +
    renderAnalyticsStat(
      topSource ? topSource.label : "No clear source",
      "Top discovery source",
      topSource ? topSource.count + " views" : "",
    ) +
    renderAnalyticsStat(
      topContact ? topContact.label : "No clear path",
      "Top contact path",
      topContact ? topContact.count + " clicks" : "",
    ) +
    "</section>" +
    '<section aria-label="What changed this week" style="grid-column:1 / -1;padding:0.95rem;border:1px solid var(--border);border-radius:16px;background:#fbfefe">' +
    '<p class="portal-eyebrow" style="margin:0 0 0.35rem">What changed this week</p>' +
    '<p style="margin:0;color:var(--slate);font-size:0.92rem;line-height:1.55">' +
    escapeHtml(changedCopy) +
    "</p></section>" +
    renderAnalyticsBreakdownCard(
      "How patients found you",
      sourceBreakdown,
      "Source data will appear once patients discover your profile.",
      sourceInsight,
    ) +
    renderAnalyticsBreakdownCard(
      "How patients tried to reach you",
      contactBreakdown,
      "Contact-path data will appear once patients click phone, email, booking, or website.",
      contactInsight,
    ) +
    '<section aria-label="12-week trend" style="grid-column:1 / -1;padding:0.95rem;border:1px solid var(--border);border-radius:16px;background:#fbfefe">' +
    '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:1rem;margin-bottom:0.4rem"><h3 style="font-family:Fraunces,serif;font-size:1.02rem;margin:0;color:var(--navy)">12-week profile-view trend</h3>' +
    '<span style="font-size:0.78rem;color:var(--muted)">current ' +
    escapeHtml(String(latestWeeklyViews || views)) +
    " / previous " +
    escapeHtml(String(previousWeeklyViews || 0)) +
    "</span></div>" +
    renderAnalyticsSparkline(weeklyViews.length ? weeklyViews : [views]) +
    '<p style="margin:0.65rem 0 0;color:var(--slate);font-size:0.88rem;line-height:1.5">Use this as direction, not a guarantee. A single high week can be a spike; repeated movement across several Mondays is a stronger trend.</p>' +
    "</section>" +
    renderAnalyticsWatchModule(watchAction);
  wireAnalyticsActionHandlers(therapist);
}

async function loadAnalyticsIntoPortal(therapist) {
  if (!document.getElementById("portalAnalyticsCard")) {
    return;
  }
  try {
    // Fetch analytics + subscription in parallel; subscription drives the
    // free-vs-paid render split. Either failing independently shouldn't
    // blow up the other, analytics is always shown; subscription just
    // toggles depth.
    const [analyticsResult, subscriptionResult] = await Promise.all([
      fetchPortalAnalytics().catch(function () {
        return null;
      }),
      fetchTherapistSubscription().catch(function () {
        return null;
      }),
    ]);
    if (!analyticsResult) {
      const body = document.getElementById("portalAnalyticsBody");
      if (body) {
        body.textContent = "Profile activity is unavailable right now. Refresh to try again.";
      }
      return;
    }
    trackFunnelEvent("portal_analytics_viewed", {
      slug: (therapist && therapist.slug) || "",
      has_current_week_data: Boolean(analyticsResult && analyticsResult.current),
      paid_dashboard: Boolean(
        subscriptionResult &&
        subscriptionResult.subscription &&
        subscriptionResult.subscription.has_active_featured,
      ),
    });
    renderAnalyticsBlock(
      analyticsResult,
      (subscriptionResult && subscriptionResult.subscription) || null,
      therapist,
    );
  } catch (_error) {
    const body = document.getElementById("portalAnalyticsBody");
    if (body) {
      body.textContent = "Profile activity is unavailable right now. Refresh to try again.";
    }
  }
}

async function loadSubscriptionIntoFeaturedCard() {
  if (!document.getElementById("portalFeaturedCard")) {
    // Still try to reveal the welcome upsell for cases where only the
    // unclaimed shell is rendered. No subscription data available here,
    // so the banner falls back to showing (free-tier assumption). The
    // banner itself is only injected when verifiedClaim is true, so
    // this is effectively a no-op for unclaimed states.
    renderPortalWelcomeUpsell(null, slug, "");
    return;
  }
  var card = document.getElementById("portalFeaturedCard");
  var therapistSlug = (card && card.getAttribute("data-therapist-slug")) || slug || "";
  var therapistEmail = (card && card.getAttribute("data-therapist-email")) || "";
  try {
    var result = await fetchTherapistSubscription();
    var subscription = (result && result.subscription) || null;
    renderFeaturedCard(subscription);
    renderPortalWelcomeUpsell(subscription, therapistSlug, therapistEmail);
    renderCancelScheduledBanner(subscription);
  } catch (_error) {
    var body = document.getElementById("portalFeaturedBody");
    if (body) {
      body.textContent = "Featured status is unavailable right now. Refresh to try again.";
    }
    // If subscription fetch failed, err on the side of showing the upsell,
    // worst case a paid therapist sees a prompt they can dismiss.
    renderPortalWelcomeUpsell(null, therapistSlug, therapistEmail);
  }
}

function renderStripeReturnBanner() {
  var params = new URLSearchParams(window.location.search);
  var state = params.get("stripe");
  var entry = params.get("entry");
  if (!state && !entry) {
    return;
  }
  var shell = document.getElementById("portalShell");
  if (!shell) {
    return;
  }
  var message = "";
  var tone = "neutral";
  if (state === "success") {
    message =
      "Trial active. You're live in the directory the moment you save a bio below, no admin review, no waiting.";
    tone = "success";
  } else if (state === "cancel") {
    message = "Checkout canceled. No charge was made. You can try again anytime.";
  } else if (entry === "free") {
    message = "You're in. Add a bio below to go live.";
    tone = "success";
  }
  if (!message) {
    return;
  }
  var bg = tone === "success" ? "#ecfdf5" : "#f1f5f9";
  var border = tone === "success" ? "#10b981" : "#cbd5e1";
  var color = tone === "success" ? "#065f46" : "#334155";
  shell.insertAdjacentHTML(
    "afterbegin",
    '<section class="portal-card" style="margin-bottom:1rem;background:' +
      bg +
      ";border:1px solid " +
      border +
      ';"><p style="margin:0;color:' +
      color +
      ';font-weight:600">' +
      escapeHtml(message) +
      "</p></section>",
  );
}

// After a first-time signup landing (trial return or free-path entry),
// scroll the editor into view so the therapist's next step is obvious
// rather than buried below status cards. One-shot per page load, keyed
// off the query params so refreshing or clicking around doesn't re-jump.
function scrollToEditorOnSignupLanding() {
  var params = new URLSearchParams(window.location.search);
  var state = params.get("stripe");
  var entry = params.get("entry");
  var isSignupLanding = state === "success" || entry === "free";
  if (!isSignupLanding) return;
  window.setTimeout(function () {
    var target = document.getElementById("portalEditProfile");
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, 600);
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function safeExternalUrl(value) {
  var raw = String(value || "").trim();
  if (!raw) return "";
  try {
    var url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch (_error) {
    return "";
  }
}

// ─── TD-A score model ─────────────────────────────────────────────────
// 100-point system per the therapist-dashboard redesign spec.
//
// Base = 40 points: what's typically captured at signup (name + city +
// credentials + specialties + format), so a freshly claimed listing
// lands in the "Needs work · 50/100" range until the optional rows
// start filling in.
//
// Bio (care_approach ≥ 50 chars) and contact route are required-but-
// zero-point gates. They block "going live" but don't add points; the
// header score reflects discoverability, not live status.
//
// Optional fields per spec:
//   Headshot: +15
//   Treatment modalities: +10
//   Session fee: +10
//   Insurance accepted: +7
//   Populations served: +8
//   Session format: +5  (auto-credited if either accepts_in_person
//                        or accepts_telehealth is on)
//   Years of experience: +5
//
// Maximum: 40 + 60 = 100.
function computeProfileScore(therapist) {
  // Mirror of computeScore in portal-td-completeness.js, keep the two
  // in sync so the header badge and the panel both display the same
  // number on every render.
  var t = therapist || {};
  var score = 40; // signup baseline
  if (t.photo_url) score += 15;
  if (Array.isArray(t.treatment_modalities) && t.treatment_modalities.filter(Boolean).length)
    score += 10;
  if (Number(t.session_fee_min) > 0 || Number(t.session_fee_max) > 0 || t.sliding_scale)
    score += 10;
  if (Array.isArray(t.client_populations) && t.client_populations.filter(Boolean).length)
    score += 8;
  if (String(t.bio || "").trim()) score += 8;
  if (Array.isArray(t.insurance_accepted) && t.insurance_accepted.filter(Boolean).length)
    score += 7;
  if (Array.isArray(t.specialties) && t.specialties.filter(Boolean).length) score += 6;
  if (t.accepts_in_person || t.accepts_telehealth) score += 5;
  if (Number(t.bipolar_years_experience) > 0) score += 5;
  if (Array.isArray(t.languages) && t.languages.filter(Boolean).length) score += 4;
  if (String(t.estimated_wait_time || "").trim()) score += 4;
  if (String(t.first_step_expectation || "").trim()) score += 4;
  if (String(t.practice_name || "").trim()) score += 3;
  if (String(t.website || "").trim()) score += 3;
  if (Number(t.years_experience) > 0) score += 3;
  if (score > 100) score = 100;
  if (score < 0) score = 0;
  return score;
}

// Score band labels per spec. Tones drive the badge colour: amber for
// anything below 80, green for 80+, with a special "complete" tone at
// the cap.
function getScoreBand(score) {
  if (score >= 100) return { label: "Complete", tone: "complete" };
  if (score >= 80) return { label: "Looking good", tone: "good" };
  if (score >= 60) return { label: "Getting there", tone: "fair" };
  return { label: "Needs work", tone: "needs" };
}

var PORTAL_PHOTO_MAX_BYTES = 4 * 1024 * 1024;
var PORTAL_PHOTO_ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

function readFileAsDataUrl(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      resolve(String(reader.result || ""));
    };
    reader.onerror = function () {
      reject(reader.error || new Error("Could not read the file."));
    };
    reader.readAsDataURL(file);
  });
}

function bindPortalPhotoUpload(therapist) {
  var input = document.getElementById("portalPhotoInput");
  if (!input) return;
  var preview = document.getElementById("portalPhotoPreview");
  var feedback = document.getElementById("portalPhotoFeedback");
  var btnLabel = document.getElementById("portalPhotoBtnLabel");
  if (!preview || !feedback || !btnLabel) return;

  function setFeedback(message, tone) {
    feedback.textContent = message || "";
    feedback.classList.remove("is-error", "is-success");
    if (tone === "error") feedback.classList.add("is-error");
    if (tone === "success") feedback.classList.add("is-success");
  }

  input.addEventListener("change", async function () {
    var file = input.files && input.files[0];
    if (!file) return;
    if (!PORTAL_PHOTO_ALLOWED_MIMES.has(file.type)) {
      setFeedback("Photo must be a JPG, PNG, or WebP.", "error");
      input.value = "";
      return;
    }
    if (file.size > PORTAL_PHOTO_MAX_BYTES) {
      setFeedback("Photo is over 4 MB. Try a smaller image.", "error");
      input.value = "";
      return;
    }
    var dataUrl;
    try {
      dataUrl = await readFileAsDataUrl(file);
    } catch (_error) {
      setFeedback("Couldn't read that file.", "error");
      input.value = "";
      return;
    }
    btnLabel.textContent = "Uploading...";
    setFeedback("Uploading your headshot...", null);
    try {
      var result = await uploadPortalPhoto(dataUrl, file.name || "headshot");
      if (result && result.photo_url) {
        var photoUrl = safeExternalUrl(result.photo_url);
        if (!photoUrl) {
          throw new Error("Upload completed but returned an invalid photo URL.");
        }
        var image = document.createElement("img");
        image.src = photoUrl;
        image.alt = "";
        preview.replaceChildren(image);
        btnLabel.textContent = "Replace photo";
        setFeedback("Headshot uploaded. Your live profile updates within a minute.", "success");
        // Surface the change in any cached therapist state so the rest of
        // the dashboard reflects it without a full reload.
        if (therapist) {
          therapist.photo_url = result.photo_url;
          therapist.photo_source_type = "therapist_uploaded";
        }
      } else {
        setFeedback("Upload completed but no photo URL came back. Try refreshing.", "error");
        btnLabel.textContent = "Try again";
      }
    } catch (error) {
      setFeedback(
        (error && error.message) || "Couldn't upload the photo. Try again in a moment.",
        "error",
      );
      btnLabel.textContent = "Try again";
    } finally {
      input.value = "";
    }
  });
}

async function uploadPortalPhoto(dataUrl, filename) {
  var response = await fetch("/api/review/portal/photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      photo_upload_base64: dataUrl,
      photo_filename: filename || "headshot",
    }),
  });
  var data = null;
  try {
    data = await response.json();
  } catch (_error) {
    // ignore
  }
  if (!response.ok) {
    var message = (data && data.error) || "Upload failed (HTTP " + response.status + ").";
    throw new Error(message);
  }
  return data || {};
}

function renderPortal(therapist, options) {
  var shell = document.getElementById("portalShell");
  if (!shell) {
    return;
  }

  var sessionMode = options && options.sessionMode ? options.sessionMode : "public";
  var verifiedClaim = sessionMode === "claimed";
  var requestOptions = buildPortalRequestOptions(verifiedClaim, therapist);
  var claimedEmail = therapist.claimed_by_email || therapist.email || "";
  var relatedApplication = verifiedClaim
    ? getRelatedApplication(therapist, { claimedEmail: claimedEmail })
    : null;
  var progress = verifiedClaim ? buildPortalProgressData(relatedApplication) : null;
  var profileCoaching = verifiedClaim ? buildPortalProfileCoaching(relatedApplication) : null;
  var portalTimeline = verifiedClaim ? buildPortalTimeline(relatedApplication, therapist) : [];
  var expectations = verifiedClaim ? buildPortalExpectations(relatedApplication) : null;
  var urgency = verifiedClaim ? buildPortalUrgency(relatedApplication) : null;
  var reviewerFeedback = verifiedClaim ? buildPortalReviewerFeedback(relatedApplication) : null;
  var reviewReadinessSignal = verifiedClaim
    ? buildPortalReviewReadinessSignal(relatedApplication)
    : null;
  var reviewTiming = verifiedClaim ? buildPortalReviewTiming(relatedApplication) : null;

  // Upsell banner: only shown on the direct post-signup landing (entry=free).
  // Skipped for returning visits, renderPortalWelcomeUpsell checks the
  // per-slug dismiss state so it never re-appears after the therapist
  // closes it. For all other visits the banner stays empty per the
  // portal redesign decision (premature upsells hurt first impressions).
  var isSignupFreeLanding =
    verifiedClaim && new URLSearchParams(window.location.search).get("entry") === "free";
  var welcomeUpsellBanner = isSignupFreeLanding
    ? '<section id="portalWelcomeUpsell" class="portal-card" style="border:2px solid #2a9cb3;background:#f0f9fb;margin-bottom:1rem" hidden>' +
      '<div style="display:flex;align-items:flex-start;gap:0.75rem">' +
      '<div style="flex:1">' +
      '<p class="portal-eyebrow" style="color:#155f70;margin:0 0 0.3rem">Listing created</p>' +
      '<h2 style="margin:0 0 0.4rem;font-size:1.1rem">Add a bio to go live</h2>' +
      '<p class="portal-subtle" style="margin:0 0 0.75rem">Know how patients find you and how they reach out. Visibility analytics shows your source breakdown, contact clicks, and 12-week trends, sent to your inbox every Monday.</p>' +
      '<button class="btn-primary" type="button" id="portalWelcomeUpsellCta">Start 14-day free trial →</button>' +
      "</div>" +
      '<button type="button" id="portalWelcomeUpsellDismiss" aria-label="Dismiss" style="background:none;border:none;cursor:pointer;color:#6b8290;font-size:1.3rem;line-height:1;padding:0;flex-shrink:0">×</button>' +
      "</div>" +
      "</section>"
    : "";

  // Sign-out affordance only renders for authenticated sessions. Public
  // viewers don't have a session to sign out of. Stateless tokens mean
  // we can only clear the client-side entry; the server logout endpoint
  // is for funnel instrumentation, not revocation.
  var signOutControl =
    sessionMode === "claimed" || sessionMode === "claim_token"
      ? '<button type="button" id="portalSignOut" class="td-header-signout">Sign out</button>'
      : "";

  // ─── TD-A score model ───────────────────────────────────────────────
  // 100-point system per the therapist-dashboard spec. Bio + contact
  // route are required-but-zero-point gates; everything else is the
  // sum below. Base of 40 represents what's typically captured at
  // signup (name / location / credentials / specialties / format) so a
  // freshly claimed listing lands around 50–60 per spec.
  var tdScore = computeProfileScore(therapist);
  var tdBand = getScoreBand(tdScore);
  var tdViewPublicHref = "/therapists/" + encodeURIComponent(therapist.slug || "");
  var tdAccepting = therapist.accepting_new_patients === true;
  var tdAcceptingHidden = therapist.accepting_new_patients === false;

  // Headshot upload is handled inline by the completeness panel. These
  // hidden hooks keep the shared upload handler available without
  // rendering a duplicate standalone card.
  var hasPhoto = Boolean(therapist.photo_url);
  var photoZone = verifiedClaim
    ? '<form class="portal-photo-shell" id="portalPhotoShell" hidden>' +
      '<div id="portalPhotoPreview" hidden></div>' +
      '<input type="file" id="portalPhotoInput" accept="image/jpeg,image/png,image/webp" hidden />' +
      '<span id="portalPhotoBtnLabel" hidden>' +
      (hasPhoto ? "Replace photo" : "Upload headshot") +
      "</span>" +
      '<div id="portalPhotoFeedback" role="status" aria-live="polite" hidden></div>' +
      "</form>"
    : "";

  // Zone 3, Bottom row per spec Section 6: "This week" analytics card
  // (left) + "Your plan" subscription card (right), equal-width.
  // Existing handlers paint these cards by ID:
  //   - #portalAnalyticsBody / #portalAnalyticsGrid (analytics fetcher)
  //   - #portalFeaturedBody / #portalFeaturedActions (subscription)
  // We keep those IDs on the new structure so the existing JS hydrates
  // active states (e.g. real numbers for paid users) over our static
  // empty-state copy without any handler changes.
  var planZone = verifiedClaim
    ? '<section class="td-bottom-grid">' +
      // "This week", analytics card. Empty-state copy comes from the
      // spec; handlers replace #portalAnalyticsBody when real numbers
      // are available.
      '<article class="portal-card td-bottom-card" id="portalAnalyticsCard">' +
      '<p class="portal-eyebrow">This week</p>' +
      '<h2 class="td-bottom-card-title">Patient activity</h2>' +
      '<p class="portal-subtle td-bottom-card-body" id="portalAnalyticsBody">' +
      "Once you're live, this is where you'll see weekly profile views, match appearances, and contact events. " +
      "Upgrade for the full breakdown." +
      "</p>" +
      '<div id="portalAnalyticsGrid" hidden></div>' +
      "</article>" +
      // "Your plan", subscription card. Free-listing static copy
      // until the subscription handler hydrates the active plan state.
      '<article class="portal-card td-bottom-card" id="portalFeaturedCard" ' +
      'data-therapist-slug="' +
      escapeHtml(therapist.slug) +
      '" data-therapist-email="' +
      escapeHtml(claimedEmail) +
      '">' +
      '<p class="portal-eyebrow">Your plan</p>' +
      '<h2 class="td-bottom-card-title">Free listing</h2>' +
      '<p class="portal-subtle td-bottom-card-body" id="portalFeaturedBody">' +
      "Upgrade to unlock weekly analytics, Monday digest emails, and same-day profile edits." +
      "</p>" +
      '<div class="portal-actions td-bottom-card-actions" id="portalFeaturedActions">' +
      '<button type="button" class="td-bottom-card-cta" id="portalFeaturedTrialCta">' +
      "Start 14-day free trial" +
      "</button>" +
      "</div>" +
      '<div class="portal-feedback" id="portalFeaturedFeedback"></div>' +
      "</article>" +
      "</section>"
    : "";

  // Zone 4, Review activity & coaching. Collapsed under one disclosure.
  var hasReviewContent = Boolean(
    progress ||
    profileCoaching ||
    portalTimeline.length ||
    expectations ||
    urgency ||
    reviewReadinessSignal ||
    reviewTiming ||
    reviewerFeedback,
  );
  var reviewZoneIsActive =
    relatedApplication &&
    !["approved_ready_to_publish", "live"].includes(relatedApplication.portal_state || "");
  var reviewZone = hasReviewContent
    ? '<details class="portal-card portal-review-details"' +
      (reviewZoneIsActive ? " open" : "") +
      '><summary><strong>Review activity &amp; coaching</strong><span class="portal-subtle" style="font-size:0.85rem;margin-left:0.5rem">See your claim status and next steps</span></summary><div class="portal-review-body">' +
      (progress
        ? '<section class="portal-review-block"><h3>Progress</h3><div class="portal-list"><div><strong>Current:</strong> ' +
          escapeHtml(progress.statusLabel) +
          "</div><div><strong>Next step:</strong> " +
          escapeHtml(progress.nextStep) +
          '</div></div><div class="portal-list" style="margin-top:0.6rem">' +
          progress.stages
            .map(function (stage) {
              return "<div>" + (stage.done ? "✓ " : "○ ") + escapeHtml(stage.label) + "</div>";
            })
            .join("") +
          (relatedApplication && relatedApplication.portal_state === "claimed_ready_for_profile"
            ? '<div class="portal-actions" style="margin-top:0.85rem"><a class="btn-primary" href="' +
              escapeHtml(
                getPortalSignupHref(
                  therapist,
                  relatedApplication,
                  getPortalResumeField(relatedApplication),
                ),
              ) +
              '">Complete full profile</a></div>'
            : "") +
          "</div></section>"
        : "") +
      (profileCoaching
        ? '<section class="portal-review-block"><h3>What will strengthen your profile</h3><div class="portal-list"><div><strong>Current readiness:</strong> ' +
          escapeHtml(profileCoaching.scoreLabel) +
          "</div>" +
          (profileCoaching.missingItems.length
            ? '<div><strong>Best next additions:</strong></div><div class="portal-list">' +
              profileCoaching.missingItems
                .map(function (item) {
                  return "<div>• " + escapeHtml(item) + "</div>";
                })
                .join("") +
              "</div>"
            : "") +
          (profileCoaching.strengths.length
            ? '<div style="margin-top:0.4rem"><strong>Already helping your profile:</strong></div><div class="portal-list">' +
              profileCoaching.strengths
                .map(function (item) {
                  return "<div>✓ " + escapeHtml(item) + "</div>";
                })
                .join("") +
              "</div>"
            : "") +
          "</div></section>"
        : "") +
      (portalTimeline.length
        ? '<section class="portal-review-block"><h3>Recent progress</h3><div class="portal-list">' +
          portalTimeline
            .map(function (item) {
              return (
                "<div><strong>" +
                escapeHtml(item.label) +
                ":</strong> " +
                escapeHtml(formatDate(item.date) || "Recently") +
                "</div>"
              );
            })
            .join("") +
          "</div></section>"
        : "") +
      (expectations
        ? '<section class="portal-review-block"><h3>What to expect next</h3><div><strong>' +
          escapeHtml(expectations.headline) +
          "</strong></div><div>" +
          escapeHtml(expectations.body) +
          "</div></section>"
        : "") +
      (urgency
        ? '<section class="portal-review-block"><h3>Priority signal</h3><div><strong>' +
          escapeHtml(urgency.label) +
          "</strong></div><div>" +
          escapeHtml(urgency.body) +
          "</div></section>"
        : "") +
      (reviewReadinessSignal
        ? '<section class="portal-review-block"><h3>Review readiness signal</h3><div><strong>' +
          escapeHtml(reviewReadinessSignal.label) +
          "</strong></div><div>" +
          escapeHtml(reviewReadinessSignal.body) +
          "</div></section>"
        : "") +
      (reviewTiming
        ? '<section class="portal-review-block"><h3>Review timing</h3><div><strong>' +
          escapeHtml(reviewTiming.label) +
          "</strong></div><div>" +
          escapeHtml(reviewTiming.body) +
          "</div></section>"
        : "") +
      (reviewerFeedback
        ? '<section class="portal-review-block"><h3>Reviewer feedback</h3>' +
          (reviewerFeedback.requestedAt
            ? "<div><strong>Requested:</strong> " +
              escapeHtml(formatDate(reviewerFeedback.requestedAt) || "Recently") +
              "</div>"
            : "") +
          "<div>" +
          escapeHtml(reviewerFeedback.message) +
          "</div></section>"
        : "") +
      "</div></details>"
    : "";

  // Zone 5, Help & account requests. Demoted behind one disclosure.
  var helpZone =
    '<details class="portal-card portal-help-details"><summary><strong>Help &amp; account requests</strong><span class="portal-subtle" style="font-size:0.85rem;margin-left:0.5rem">Pause, remove, update, or ask a question</span></summary>' +
    '<p class="portal-subtle" style="margin:0.5rem 0 0.9rem">Claim, pause, removal, and profile-update requests route to the review team. Your edits above still publish directly; this form is for things the editor can\'t change.</p>' +
    '<form id="portalRequestForm" class="portal-form"><input type="hidden" name="therapist_slug" value="' +
    escapeHtml(therapist.slug) +
    '" /><input type="hidden" name="therapist_name" value="' +
    escapeHtml(therapist.name) +
    '" /><label>Your name<input type="text" name="requester_name" placeholder="Your name" value="' +
    escapeHtml(therapist.name || "") +
    '" required /></label><label>Your email<input type="email" name="requester_email" placeholder="you@example.com" value="' +
    escapeHtml(claimedEmail) +
    '" required /></label><label>License number<input type="text" name="license_number" placeholder="Optional" value="' +
    escapeHtml(therapist.license_number || "") +
    '" /></label><label>What do you need?<select name="request_type" required><option value="" disabled selected>Select a topic…</option>' +
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
    '</select></label><label>Message<textarea name="message" rows="4" placeholder="Anything else we should know?"></textarea></label><button class="btn-primary" type="submit">Send message</button><div class="portal-feedback" id="portalRequestFeedback"></div></form>' +
    "</details>";

  // ─── TD-A header ───────────────────────────────────────────────────
  // Two-row header.
  //   Row 1: name + city/state | score badge + compact accepting chip +
  //          View public listing pill
  //   Row 2: sign out only (muted)
  //
  // The accepting chip is intentionally compact, it's an operational
  // control, not a status banner. The "Not live yet" onboarding state
  // lives separately above the completeness editor (renderNotLiveBar in
  // portal-td-completeness.js), which is the right place for it.
  var tdAcceptingChipClass =
    "td-accepting-chip" + (tdAccepting ? " is-on" : tdAcceptingHidden ? " is-off" : " is-unset");
  var tdAcceptingChipLabel = tdAccepting
    ? "Accepting patients"
    : tdAcceptingHidden
      ? "Paused"
      : "Set status";

  var tdHeader =
    verifiedClaim || sessionMode === "claim_token"
      ? '<section class="portal-card td-header" id="portalTdHeader">' +
        '<div class="td-header-row td-header-row-primary">' +
        '<div class="td-header-ident">' +
        '<h1 class="td-header-name">' +
        escapeHtml(therapist.name || "") +
        "</h1>" +
        '<p class="td-header-loc">' +
        escapeHtml([therapist.city, therapist.state].filter(Boolean).join(", ")) +
        (therapist.practice_name ? " · " + escapeHtml(therapist.practice_name) : "") +
        "</p>" +
        "</div>" +
        '<div class="td-header-actions">' +
        '<span class="td-score td-score-' +
        tdBand.tone +
        '" id="portalTdScore">' +
        escapeHtml(tdBand.label) +
        " · " +
        tdScore +
        "/100</span>" +
        '<button type="button" class="' +
        tdAcceptingChipClass +
        '" id="portalTdAccepting" aria-pressed="' +
        (tdAccepting ? "true" : "false") +
        '" title="' +
        (tdAccepting
          ? "Click to pause your listing"
          : tdAcceptingHidden
            ? "Click to resume accepting patients"
            : "Click to confirm you are accepting patients") +
        '">' +
        '<span class="td-accepting-dot" aria-hidden="true"></span>' +
        '<span id="portalTdAcceptingTitle">' +
        escapeHtml(tdAcceptingChipLabel) +
        "</span>" +
        "</button>" +
        (therapist.slug
          ? '<a class="td-view-public" href="' +
            escapeHtml(tdViewPublicHref) +
            '" target="_blank" rel="noopener">View public listing →</a>'
          : "") +
        "</div>" +
        "</div>" +
        '<div class="td-header-row td-header-row-secondary">' +
        signOutControl +
        '<p class="td-header-feedback" id="portalTdAcceptingFeedback" role="status" aria-live="polite"></p>' +
        "</div>" +
        "</section>"
      : "";

  shell.innerHTML =
    tdHeader +
    welcomeUpsellBanner +
    (sessionMode === "claim_token"
      ? '<section class="portal-card" style="margin-bottom:1rem"><h2>You\'re in</h2><p class="portal-subtle">Your secure link matched the email on this profile. Confirm to start editing.</p><div class="portal-actions"><button class="btn-primary" id="acceptClaimButton" type="button">Continue to your profile</button><div class="portal-feedback" id="claimAcceptFeedback"></div></div></section>'
      : "") +
    '<div id="portalTdCompletenessMount"></div>' +
    photoZone +
    planZone +
    reviewZone +
    helpZone;

  bindPortalPhotoUpload(therapist);

  // Phase 1, focused onboarding flow for clinicians who haven't yet
  // satisfied the minimum go-live requirements (specialties + practice
  // TD-B: Profile completeness, the unified editor. Replaces Phase 1
  // and Phase 2 with a single accordion of every editable field. The
  // legacy long-form editor stays in the DOM for now but is hidden;
  // any field whose inline form hasn't been built yet (TD-C / TD-D
  // scope) routes to it via the placeholder body.
  var tdcApi = null;
  if (verifiedClaim && shouldShowCompleteness(therapist)) {
    var tdcMount = document.getElementById("portalTdCompletenessMount");
    if (tdcMount) {
      tdcApi = mountPortalTdCompleteness(tdcMount, therapist, {
        onSaved: function (updatedTherapist) {
          if (updatedTherapist) {
            claimSessionState = { therapist: updatedTherapist };
            therapist = updatedTherapist;
          }
        },
        onScoreChange: function (score) {
          var headerScore = document.getElementById("portalTdScore");
          if (!headerScore) return;
          var bandLabel = "Needs work";
          var tone = "needs";
          if (score >= 100) {
            bandLabel = "Complete";
            tone = "complete";
          } else if (score >= 80) {
            bandLabel = "Looking good";
            tone = "good";
          } else if (score >= 60) {
            bandLabel = "Getting there";
            tone = "fair";
          }
          headerScore.textContent = bandLabel + " · " + score + "/100";
          headerScore.className = "td-score td-score-" + tone;
        },
      });
    }
  }

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
      feedback.textContent = "Message sent. We'll follow up at the email you provided.";
      form.elements.message.value = "";
      form.elements.request_type.selectedIndex = 0;
    } catch (error) {
      feedback.textContent =
        (error && error.message) || "Something went wrong while sending the request.";
    }
  });

  // Editor-jump affordance, coaching / progress / review-zone deep
  // links still emit "[data-portal-editor-jump]" anchors pointing at
  // #portalEditProfile. The legacy editor was removed in TF-C, so we
  // redirect those clicks to the new completeness panel and smooth-
  // scroll the clinician there instead.
  document.querySelectorAll('[data-portal-editor-jump="1"]').forEach(function (link) {
    link.addEventListener("click", function (event) {
      var target = document.getElementById("portalTdCompletenessMount");
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  if (verifiedClaim) {
    loadAnalyticsIntoPortal(therapist);
    loadSubscriptionIntoFeaturedCard();
  } else if (sessionMode === "claim_token") {
    // Still reveal the welcome-upsell banner on the unverified claim-token
    // state. The magic-link arrival is itself proof of ownership, so there's
    // no reason to hide the upgrade CTA behind the ceremonial "Claim this
    // profile" button, especially when that button can get stuck on
    // replayed / used tokens and leave the user with no way forward.
    renderPortalWelcomeUpsell(null, therapist.slug || slug, therapist.email || "");
    // Measure the email-click step of the claim funnel. This was a
    // dark transition before — we knew when the email was sent
    // (`claim_link_sent`) and when the claim was finalized, but the
    // step in between (user actually opens the magic link) had no
    // event, so we couldn't separate "email never delivered" from
    // "delivered but they didn't click" from "clicked but bounced
    // off the claim card."
    trackFunnelEvent("claim_link_opened", {
      therapist_slug: therapist.slug || slug || "",
    });
  }

  // ─── TD-A accepting-patients toggle ─────────────────────────────────
  // Tap immediately PATCHes accepting_new_patients. Optimistically
  // updates the visual state, reverts on error. Score badge is
  // independent of this field, so we don't need to recompute it here.
  var acceptingBtn = document.getElementById("portalTdAccepting");
  if (acceptingBtn) {
    acceptingBtn.addEventListener("click", async function () {
      var prev = therapist.accepting_new_patients;
      var next = prev === true ? false : true;
      var feedbackEl = document.getElementById("portalTdAcceptingFeedback");
      var titleEl = document.getElementById("portalTdAcceptingTitle");

      function paint(state) {
        acceptingBtn.classList.remove("is-on", "is-off", "is-unset");
        if (state === true) acceptingBtn.classList.add("is-on");
        else if (state === false) acceptingBtn.classList.add("is-off");
        else acceptingBtn.classList.add("is-unset");
        acceptingBtn.setAttribute("aria-pressed", state === true ? "true" : "false");
        acceptingBtn.title =
          state === true
            ? "Click to pause your listing"
            : state === false
              ? "Click to resume accepting patients"
              : "Click to confirm you are accepting patients";
        if (titleEl) {
          titleEl.textContent =
            state === true ? "Accepting patients" : state === false ? "Paused" : "Set status";
        }
      }

      acceptingBtn.disabled = true;
      paint(next); // optimistic
      if (feedbackEl) feedbackEl.textContent = "Saving…";

      try {
        var result = await patchTherapistProfile({ accepting_new_patients: next });
        therapist.accepting_new_patients = next;
        if (result && result.therapist) {
          claimSessionState = { therapist: result.therapist };
          therapist = result.therapist;
        }
        if (feedbackEl) {
          feedbackEl.textContent = "";
        }
        if (tdcApi) tdcApi.notifyAcceptingChanged(next);
        trackFunnelEvent("portal_accepting_toggled", {
          slug: therapist.slug,
          accepting: next,
        });
      } catch (err) {
        paint(prev);
        if (feedbackEl) {
          feedbackEl.textContent = (err && err.message) || "Couldn't save. Try again in a moment.";
          feedbackEl.style.color = "#b03636";
        }
      } finally {
        acceptingBtn.disabled = false;
      }
    });
  }

  var signOutButton = document.getElementById("portalSignOut");
  if (signOutButton) {
    signOutButton.addEventListener("click", async function () {
      signOutButton.disabled = true;
      signOutButton.textContent = "Signing out...";
      trackFunnelEvent("portal_signed_out", { therapist_slug: therapist.slug || slug });
      // Fire-and-forget: the server endpoint is an instrumentation hook,
      // not a revocation step. Stateless tokens mean the client clear
      // below is the actual sign-out.
      try {
        await signOutTherapistSession();
      } catch (_error) {
        // Ignore, we still want to clear locally and redirect.
      }
      clearTherapistSessionToken();
      var redirect = new URL(window.location.href);
      redirect.searchParams.delete("token");
      redirect.searchParams.delete("slug");
      redirect.searchParams.set("signed_out", "1");
      window.location.replace(redirect.pathname + "?" + redirect.searchParams.toString());
    });
  }

  if (sessionMode === "claim_token") {
    document.getElementById("acceptClaimButton").addEventListener("click", async function () {
      var feedback = document.getElementById("claimAcceptFeedback");
      feedback.textContent = "Claiming profile...";
      try {
        var result = await acceptTherapistClaim(token);
        // Conversion event for the claim funnel — marks the
        // transition from "clicked the magic link" to "owns the
        // listing." Pairs with claim_link_opened above so the admin
        // dashboard can measure the drop-off between the two steps.
        trackFunnelEvent("claim_accepted", {
          therapist_slug: therapist.slug || slug || "",
        });
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

  // Post-signup: if the therapist just returned from Stripe checkout
  // or picked the free path, scroll them to the editor. Their next
  // real step is writing a bio; surfacing it reduces the odds they
  // bounce off the dashboard before going live.
  scrollToEditorOnSignupLanding();
}

(async function init() {
  renderStripeReturnBanner();

  if (devLoginEmail) {
    try {
      var devResult = await fetchPortalDevLogin(devLoginEmail);
      if (devResult && devResult.ok) {
        setTherapistSessionToken("cookie");
        var devParams = new URLSearchParams(window.location.search);
        devParams.delete("dev_login");
        devParams.set("slug", devResult.slug);
        window.location.replace(window.location.pathname + "?" + devParams.toString());
        return;
      }
    } catch (_devError) {
      // API not running with ALLOW_DEV_LOGIN=true, fall through to normal flow.
    }
  }

  if (token) {
    // Auto-accept on magic-link arrival. Email receipt is already proof
    // of ownership, making the user click an additional "Claim this
    // profile" button is ceremony, and created a failure mode where
    // replayed / used tokens dead-ended the user with no recovery.
    // The server's claim-accept is now idempotent for already-claimed
    // same-email docs (see server/review-auth-portal-routes.mjs), so
    // refresh / back-button / Stripe-return all land cleanly. Accept
    // result is discarded; we always read the full therapist payload
    // via claim-session below.
    try {
      await acceptTherapistClaim(token);
    } catch (_acceptError) {
      // Non-fatal at this stage, if the token is invalid/expired we'll
      // surface it below via claim-session; if it's the rare
      // not-yet-covered failure mode, the "Verify claim" fallback will
      // still render.
    }

    try {
      var session = await fetchTherapistClaimSession(token);
      claimSessionState = session;
      if (session.therapist && session.therapist.claim_status === "claimed") {
        trackFunnelEvent("portal_signin_completed", {
          therapist_slug: session.therapist.slug || "",
        });
      }
      applyResolvedSlug((session.therapist && session.therapist.slug) || "");
      token = "";
      renderPortal(session.therapist, {
        sessionMode: session.therapist.claim_status === "claimed" ? "claimed" : "claim_token",
      });
      return;
    } catch (_error) {
      renderLookupState({ flash: "invalid_link" });
      return;
    }
  }

  if (!slug) {
    // Try to auto-resolve the therapist from an existing session before
    // falling back to the generic lookup form. This covers:
    //   - Return from Stripe billing portal (session was created with a
    //     stale return_url missing the slug)
    //   - Bookmarks of bare /portal
    //   - Any page load after a prior successful claim
    if (getTherapistSessionToken()) {
      try {
        var me = await fetchTherapistMe();
        var mySlug =
          (me && me.therapist && me.therapist.slug) || (me && me.session && me.session.slug) || "";
        if (mySlug) {
          // Preserve any stripe=managed / stripe=success query so the
          // portal's existing stripe-return UI can light up appropriately.
          var pass = new URLSearchParams(window.location.search);
          pass.set("slug", mySlug);
          window.location.replace(
            window.location.pathname + "?" + pass.toString() + window.location.hash,
          );
          return;
        }
      } catch (_error) {
        // Session token invalid / expired, fall through to lookup.
      }
    }
    renderLookupState();
    return;
  }

  // If the user has an authenticated therapist session AND it matches
  // the slug we were given, use /portal/me instead of the public CDN
  // fetch. The public fetch filters on listingActive=true + status=active,
  // which would lock a paused/inactive therapist out of their own portal.
  // /portal/me is session-authed and doesn't apply those visibility
  // filters, so a claimed therapist always reaches their own dashboard.
  var meTherapist = null;
  if (getTherapistSessionToken()) {
    try {
      var meResp = await fetchTherapistMe();
      if (meResp && meResp.therapist && meResp.therapist.slug === slug) {
        meTherapist = meResp.therapist;
      }
    } catch (_error) {
      // Session probably expired; fall through to public path.
    }
  }

  if (meTherapist) {
    renderPortal(meTherapist, { sessionMode: "claimed" });
    return;
  }

  var therapist = await fetchPublicTherapistBySlug(slug);
  if (!therapist) {
    renderLookupState({ flash: "not_found" });
    return;
  }

  renderPortal(therapist, {
    sessionMode: "public",
  });
})();
