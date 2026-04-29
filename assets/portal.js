import "./funnel-analytics.js";
import { trackFunnelEvent } from "./funnel-analytics.js";
import { mountPortalTdCompleteness, shouldShowCompleteness } from "./portal-td-completeness.js";
import { fetchPublicTherapistBySlug } from "./cms.js";
import { getTherapistMatchReadiness } from "./matching-model.js";
import { getApplications } from "./store.js";
import { PORTAL_PICKER_OPTIONS } from "../shared/therapist-picker-options.mjs";
import {
  normalizeUrl,
  validateBookingUrl,
  validateEmail,
  validatePhone,
  validatePublicContactPresence,
  validateWebsite,
} from "../shared/contact-validation.mjs";
import {
  acceptTherapistClaim,
  clearTherapistSessionToken,
  createStripeBillingPortalSession,
  createStripeFeaturedCheckoutSession,
  devLoginAsTherapist,
  fetchPortalAnalytics,
  fetchTherapistClaimSession,
  fetchTherapistMe,
  fetchTherapistSubscription,
  getTherapistSessionToken,
  patchTherapistProfile,
  requestTherapistClaimLink,
  requestTherapistSignIn,
  setTherapistSessionToken,
  signOutTherapistSession,
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
      done: ["profile_submitted_after_claim", "profile_in_review_after_claim"].includes(
        portalState,
      ),
    },
  ];

  var nextAction = "Use the update flow if you need to change any operational details.";
  if (portalState === "claimed_ready_for_profile") {
    nextAction = "Complete your fuller profile so we can review trust, fit, and listing readiness.";
  } else if (portalState === "profile_submitted_after_claim") {
    nextAction = "Your fuller profile is submitted. We are preparing it for review.";
  } else if (portalState === "profile_in_review_after_claim") {
    nextAction =
      "Your fuller profile is in review. We are checking trust, fit, and publish readiness.";
  } else if (portalState === "claim_pending_review" || portalState === "claim_in_review") {
    nextAction = "We are still verifying ownership and your core profile details.";
  } else if (portalState === "claim_needs_attention") {
    nextAction = "Review the requested fixes so we can finish verifying your claim.";
  }

  return {
    statusLabel: application.portal_state_label || "In progress",
    nextStep: application.portal_next_step || nextAction,
    stages: stages,
  };
}

function buildPortalNextAction(therapist, application) {
  if (!application) {
    // Two shapes of "no application doc" therapist:
    //   1. Already claimed — typically a CMS-discovery-pipeline ingest
    //      who never went through the public signup form. They don't
    //      need to "claim first"; they need tools to update.
    //   2. Not yet claimed — public visitor or stub state; the original
    //      copy is still right here.
    if (therapist && therapist.claim_status === "claimed") {
      return {
        title: "You're all set",
        body: "Use 'Confirm or update profile' to submit any edits to your bio, headshot, accepting-status, or contact routes. We review and publish within a business day.",
        ctaLabel: "",
        href: "",
      };
    }
    return {
      title: "Claim your profile first",
      body: "Once your claim is verified, this portal can show your exact progress and next step.",
      ctaLabel: "",
      href: "",
    };
  }

  var focusField = getPortalResumeField(application);
  var focusLabel = getPortalResumeFieldLabel(focusField);
  var resumeHref = getPortalSignupHref(therapist, application, focusField);
  var liveProfileHref = "therapist.html?slug=" + encodeURIComponent(therapist.slug);
  var portalState = application.portal_state || "";

  if (portalState === "claimed_ready_for_profile") {
    return {
      title: "Complete your full profile",
      body:
        "Your claim is approved. Start with " +
        focusLabel +
        " so we can review your listing for trust, fit, and publish readiness.",
      ctaLabel: "Complete full profile",
      href: resumeHref,
    };
  }

  if (portalState === "profile_submitted_after_claim") {
    return {
      title: "Full profile received",
      body: "Your fuller profile arrived after claim approval and is queued for review.",
      ctaLabel: "View live profile",
      href: liveProfileHref,
    };
  }

  if (portalState === "profile_in_review_after_claim") {
    return {
      title: "Full profile in review",
      body: "We are reviewing trust, fit, and listing readiness before this profile moves toward publish.",
      ctaLabel: "View live profile",
      href: liveProfileHref,
    };
  }

  if (portalState === "claim_needs_attention") {
    return {
      title: "Your claim needs one more pass",
      body:
        "We still need a few ownership or profile basics tightened before we can finish verifying the claim. Start with " +
        focusLabel +
        ".",
      ctaLabel: "Update claim details",
      href: resumeHref,
    };
  }

  if (portalState === "claim_pending_review" || portalState === "claim_in_review") {
    return {
      title: "Claim review in progress",
      body: "We are verifying ownership and your core profile details. Once that clears, your next step will be the fuller profile.",
      ctaLabel: "View live profile",
      href: liveProfileHref,
    };
  }

  return {
    title: "Your profile is moving",
    body:
      application.portal_next_step ||
      "We will keep this portal aligned to your current review step.",
    ctaLabel: "View live profile",
    href: liveProfileHref,
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

function getPortalResumeFieldLabel(fieldName) {
  if (fieldName === "bio") return "your professional bio";
  if (fieldName === "care_approach") return "how you help bipolar clients";
  if (fieldName === "specialties") return "your specialties";
  if (fieldName === "treatment_modalities") return "your treatment modalities";
  if (fieldName === "contact_guidance") return "your contact guidance";
  if (fieldName === "first_step_expectation") return "what happens after outreach";
  if (fieldName === "preferred_contact_label") return "your primary contact button";
  if (fieldName === "estimated_wait_time") return "your wait-time details";
  if (fieldName === "telehealth_states") return "your telehealth states";
  return "your profile details";
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
      headline: "Claim review usually starts after ownership is confirmed.",
      body: "Once a claim is verified, the next milestone is completing the fuller profile so it can move into listing review.",
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
      "<p>Enter your email below and we'll send a fresh link. Links expire 15 minutes after sending.</p>" +
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
    '<p class="portal-signin-lede">Manage your listing, availability, and dashboard activity.</p>' +
    "</header>" +
    '<form id="portalSignInForm" class="portal-signin-form" novalidate>' +
    '<label for="portalSignInEmail" class="portal-signin-label">Work email</label>' +
    '<input type="email" id="portalSignInEmail" name="email" class="portal-signin-input" ' +
    'placeholder="you@practice.com" autocomplete="email" inputmode="email" ' +
    'autocapitalize="none" spellcheck="false" required ' +
    'aria-describedby="portalSignInHelper portalSignInFeedback" />' +
    '<p id="portalSignInHelper" class="portal-signin-helper">' +
    "We'll email a secure sign-in link to the address on your listing. It usually arrives within a minute." +
    "</p>" +
    '<button class="btn-primary portal-signin-submit" type="submit" id="portalSignInSubmit">' +
    "Email me a sign-in link" +
    "</button>" +
    '<p id="portalSignInFeedback" class="portal-signin-feedback" role="status" aria-live="polite"></p>' +
    "</form>" +
    '<p class="portal-signin-security">' +
    "For security, we use one-time email links instead of passwords. Links expire after 15 minutes." +
    "</p>" +
    "</section>" +
    '<section class="portal-card portal-signin-help" aria-labelledby="portalSignInHelpHeading">' +
    '<h2 id="portalSignInHelpHeading" class="portal-signin-help-title">Need help accessing your listing?</h2>' +
    '<ul class="portal-signin-help-list">' +
    '<li>Haven\'t claimed your profile yet? <a href="claim.html">Claim your profile</a>.</li>' +
    '<li>Used a different email? <a href="claim.html">Re-claim your profile</a> and we\'ll send a link to the email on your public listing.</li>' +
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
    var email = String((emailInput && emailInput.value) || "").trim();
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

    setBusy(true, false);
    setFeedback("Sending sign-in link...", "info");
    trackFunnelEvent("portal_signin_requested", { email_domain: email.split("@")[1] || "" });
    requestTherapistSignIn(email)
      .then(function () {
        lastSentAt = Date.now();
        setBusy(false, email);
        setFeedback(
          "Check your inbox. If " +
            email +
            " matches a claimed profile, we just sent a sign-in link. It usually arrives within a minute and expires in 15 minutes.",
          "success",
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
      });
  });
}

function describeFeaturedStatus(subscription) {
  if (!subscription || subscription.plan === "none" || !subscription.status) {
    return "You're on the free listing. Upgrade to unlock the weekly analytics dashboard, Monday digest email, and same-day profile edit review.";
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
        ". Your paid features (analytics, digest email, same-day edit review) continue through that date, then your listing reverts to free. Resume anytime from Manage subscription."
      );
    }
    if (subscription.status === "trialing") {
      var trialEnd = formatDate(subscription.trial_ends_at);
      return (
        "14-day free trial active." +
        (trialEnd ? " Trial ends " + trialEnd + "." : "") +
        " You can cancel anytime before then — no charge until day 15. " +
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
        if (result && result.url) {
          window.location.href = result.url;
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
        window.location.href = "/pricing.html?" + params.toString();
      }
    });
  }
}

// When a subscription is flagged cancel_at_period_end, surface a
// prominent top-of-portal banner so the user isn't surprised by a
// sudden tier change on the end date. Idempotent — re-renders cleanly
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
    "Analytics, Monday digest email, and same-day edit review continue through that date. " +
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
    // Surface cancel intent front and center — this is the action users
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
  window.location.href = "/pricing.html?" + params.toString();
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
    if (result && result.url) {
      window.location.href = result.url;
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

// Portal analytics V0 — render five numbers summarizing this week's
// engagement: profile views total, contact intents (CTA clicks), views
// from match results, views from directory search, and a period label.
// Numbers come from the therapistEngagementSummary Sanity document for
// the current ISO week, populated in real time by /engagement/view
// and /engagement/cta-click endpoints.
//
// If there's no summary for the current month yet, render a gentle
// empty state instead of zeroes — a new listing literally has no data,
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
  if (match) return "Week " + Number(match[2]) + ", " + match[1];
  return "This week";
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
    '<div style="display:flex;justify-content:space-between;gap:1rem;align-items:baseline;margin-bottom:0.65rem"><h3 style="font-family:Lora,serif;font-size:1.02rem;margin:0;color:var(--navy)">' +
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
    '<div style="display:flex;justify-content:space-between;gap:1rem;align-items:baseline;margin-bottom:0.75rem"><h3 style="font-family:Lora,serif;font-size:1.08rem;margin:0;color:var(--navy)">Top actions this week</h3><span style="font-size:0.78rem;color:var(--muted)">ranked by likely impact</span></div>' +
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
    '<div><p class="portal-eyebrow" style="margin:0 0 0.35rem">Profile strength</p><h3 style="font-family:Lora,serif;font-size:1.15rem;margin:0;color:var(--navy)">Listing readiness</h3>' +
    '<p style="margin:0.4rem 0 0;color:var(--slate);font-size:0.9rem;line-height:1.5">' +
    escapeHtml(readiness.summary) +
    '</p><div class="portal-actions" style="margin-top:0.75rem">' +
    '<a class="btn-primary" href="#portalEditProfile" data-portal-editor-jump="1" data-analytics-action="open_profile_editor">Open profile editor</a>' +
    ((therapist && therapist.slug) || ""
      ? '<a class="btn-secondary" href="therapist.html?slug=' +
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
    '<h3 style="font-family:Lora,serif;font-size:1.02rem;margin:0;color:var(--navy)">' +
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
      '<a href="#portalFeaturedCard" class="td-bottom-card-cta" style="text-decoration:none;white-space:nowrap">' +
      "Start 14-day free trial →" +
      "</a>" +
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
    '<div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap"><div><p class="portal-eyebrow" style="margin:0 0 0.35rem">Most important takeaway</p><h3 style="font-family:Lora,serif;font-size:1.25rem;margin:0;color:var(--navy)">' +
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
    '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:1rem;margin-bottom:0.4rem"><h3 style="font-family:Lora,serif;font-size:1.02rem;margin:0;color:var(--navy)">12-week profile-view trend</h3>' +
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
    // blow up the other — analytics is always shown; subscription just
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
    // If subscription fetch failed, err on the side of showing the upsell —
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
      "Trial active. You're live in the directory the moment you save a bio below — no admin review, no waiting.";
    tone = "success";
  } else if (state === "cancel") {
    message = "Checkout canceled. No charge was made. You can try again anytime.";
  } else if (entry === "free") {
    message =
      "You're in on the free tier. Add a bio below to go live — you can upgrade to the trial anytime from your subscription card.";
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

function joinArray(value) {
  return Array.isArray(value) ? value.join(", ") : "";
}

// Candidates for the "next best add" nudge. Each tests a missing
// field by stubbing a plausible filled value and seeing how much
// getTherapistMatchReadiness moves. The nudge shows the biggest mover.
// Keep this list strictly to fields the therapist can edit from the
// portal — suggesting "add license number" would be useless since
// that's locked here.
var NEXT_BEST_FIELDS = [
  {
    key: "phone",
    label: "Add a public phone number",
    isEmpty: function (t) {
      return !String(t.phone || "").trim();
    },
    stub: function (t) {
      return Object.assign({}, t, { phone: "555-555-5555" });
    },
  },
  {
    key: "website",
    label: "Add your website",
    isEmpty: function (t) {
      return !String(t.website || "").trim();
    },
    stub: function (t) {
      return Object.assign({}, t, { website: "https://example.com" });
    },
  },
  {
    key: "care_approach",
    label: "Describe how you help bipolar clients",
    isEmpty: function (t) {
      return !String(t.care_approach || "").trim();
    },
    stub: function (t) {
      return Object.assign({}, t, { care_approach: "stub" });
    },
  },
  {
    key: "insurance_accepted",
    label: "List insurance accepted",
    isEmpty: function (t) {
      return !(t.insurance_accepted && t.insurance_accepted.length);
    },
    stub: function (t) {
      return Object.assign({}, t, { insurance_accepted: ["Aetna", "Cigna", "BCBS"] });
    },
  },
  {
    key: "treatment_modalities",
    label: "List your treatment modalities",
    isEmpty: function (t) {
      return !(t.treatment_modalities && t.treatment_modalities.length);
    },
    stub: function (t) {
      return Object.assign({}, t, { treatment_modalities: ["CBT", "DBT"] });
    },
  },
  {
    key: "client_populations",
    label: "Specify populations you serve",
    isEmpty: function (t) {
      return !(t.client_populations && t.client_populations.length);
    },
    stub: function (t) {
      return Object.assign({}, t, { client_populations: ["Adults"] });
    },
  },
  {
    key: "bipolar_years_experience",
    label: "Add years of bipolar-specific experience",
    isEmpty: function (t) {
      return !Number(t.bipolar_years_experience || 0);
    },
    stub: function (t) {
      return Object.assign({}, t, { bipolar_years_experience: 5 });
    },
  },
  {
    key: "telehealth_states",
    label: "List telehealth states you cover",
    isEmpty: function (t) {
      return !(t.accepts_telehealth && t.telehealth_states && t.telehealth_states.length);
    },
    stub: function (t) {
      return Object.assign({}, t, { accepts_telehealth: true, telehealth_states: ["CA"] });
    },
  },
];

function getProjectedTherapist(baseTherapist, form) {
  if (!form) return baseTherapist;
  var el = form.elements;
  function str(name) {
    var node = el[name];
    return node ? String(node.value || "").trim() : "";
  }
  function bool(name) {
    var node = el[name];
    return !!(node && node.checked);
  }
  function num(name) {
    var node = el[name];
    if (!node) return null;
    var v = String(node.value || "").trim();
    if (v === "") return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function csv(name) {
    var v = str(name);
    if (!v) return [];
    return v
      .split(",")
      .map(function (x) {
        return x.trim();
      })
      .filter(function (x) {
        return x.length > 0;
      });
  }
  return Object.assign({}, baseTherapist, {
    email: str("email") || baseTherapist.email || "",
    phone: str("phone") || baseTherapist.phone || "",
    website: str("website") || baseTherapist.website || "",
    booking_url: str("booking_url") || baseTherapist.booking_url || "",
    bio: str("bio") || baseTherapist.bio || "",
    credentials: str("credentials") || baseTherapist.credentials || "",
    practice_name: str("practice_name") || baseTherapist.practice_name || "",
    care_approach: str("care_approach") || baseTherapist.care_approach || "",
    contact_guidance: str("contact_guidance") || baseTherapist.contact_guidance || "",
    first_step_expectation:
      str("first_step_expectation") || baseTherapist.first_step_expectation || "",
    estimated_wait_time: str("estimated_wait_time") || baseTherapist.estimated_wait_time || "",
    preferred_contact_method:
      str("preferred_contact_method") || baseTherapist.preferred_contact_method || "",
    accepting_new_patients: bool("accepting_new_patients"),
    accepts_telehealth: bool("accepts_telehealth"),
    accepts_in_person: bool("accepts_in_person"),
    sliding_scale: bool("sliding_scale"),
    medication_management: bool("medication_management"),
    session_fee_min: num("session_fee_min"),
    session_fee_max: num("session_fee_max"),
    years_experience: num("years_experience"),
    bipolar_years_experience: num("bipolar_years_experience"),
    specialties: csv("specialties"),
    insurance_accepted: csv("insurance_accepted"),
    telehealth_states: csv("telehealth_states"),
    treatment_modalities: csv("treatment_modalities"),
    languages: csv("languages"),
    client_populations: csv("client_populations"),
  });
}

function computeNextBestAdd(projectedTherapist) {
  var baseScore = getTherapistMatchReadiness(projectedTherapist).score;
  var best = null;
  for (var i = 0; i < NEXT_BEST_FIELDS.length; i += 1) {
    var candidate = NEXT_BEST_FIELDS[i];
    if (!candidate.isEmpty(projectedTherapist)) continue;
    var stubbed = getTherapistMatchReadiness(candidate.stub(projectedTherapist)).score;
    var delta = stubbed - baseScore;
    if (delta <= 0) continue;
    if (!best || delta > best.delta) {
      best = { label: candidate.label, delta: delta, from: baseScore, to: stubbed };
    }
  }
  return best;
}

// Per-fieldset completion: fraction of trackable (non-boolean) inputs
// in the fieldset that have a non-empty value. Booleans are excluded
// because they're always "answered" (toggle defaults).
function fieldsetFillStats(fieldsetEl) {
  var inputs = fieldsetEl.querySelectorAll("input, select, textarea");
  var trackable = 0;
  var filled = 0;
  inputs.forEach(function (node) {
    if (node.type === "checkbox" || node.type === "hidden") return;
    trackable += 1;
    if (String(node.value || "").trim() !== "") filled += 1;
  });
  return { filled: filled, total: trackable };
}

// ─── TD-A score model ─────────────────────────────────────────────────
// 100-point system per the therapist-dashboard redesign spec.
//
// Base = 40 points: what's typically captured at signup (name + city +
// credentials + specialties + format) — so a freshly claimed listing
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
  // Mirror of computeScore in portal-td-completeness.js — keep the two
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

function updateReadinessUi(baseTherapist, form) {
  var projected = getProjectedTherapist(baseTherapist, form);
  var readiness = getTherapistMatchReadiness(projected);
  var score = readiness.score;

  var bar = document.getElementById("portalReadinessBarFill");
  var scoreEl = document.getElementById("portalReadinessScore");
  var labelEl = document.getElementById("portalReadinessLabel");
  var nudgeEl = document.getElementById("portalReadinessNudge");
  if (bar) bar.style.width = Math.max(3, score) + "%";
  if (scoreEl) scoreEl.textContent = score + "/100";
  if (labelEl) labelEl.textContent = readiness.label;

  if (nudgeEl) {
    var nextBest = computeNextBestAdd(projected);
    if (nextBest) {
      nudgeEl.innerHTML =
        "<strong>Biggest next jump:</strong> " +
        escapeHtml(nextBest.label) +
        " would move you from <strong>" +
        nextBest.from +
        "</strong> to <strong>" +
        nextBest.to +
        "</strong>.";
      nudgeEl.hidden = false;
    } else if (score >= 90) {
      nudgeEl.textContent = "Your profile is match-ready. Keep the details fresh.";
      nudgeEl.hidden = false;
    } else {
      nudgeEl.hidden = true;
    }
  }

  // Per-fieldset chips.
  var fieldsets = form ? form.querySelectorAll("fieldset.portal-edit-group") : [];
  fieldsets.forEach(function (fs) {
    var legend = fs.querySelector("legend");
    if (!legend) return;
    var chip = legend.querySelector(".portal-edit-chip");
    var stats = fieldsetFillStats(fs);
    if (!stats.total) {
      if (chip) chip.remove();
      return;
    }
    var text =
      stats.filled === stats.total ? "✓ complete" : stats.filled + "/" + stats.total + " filled";
    var className =
      stats.filled === stats.total ? "portal-edit-chip is-complete" : "portal-edit-chip";
    if (chip) {
      chip.textContent = text;
      chip.className = className;
    } else {
      var span = document.createElement("span");
      span.className = className;
      span.textContent = text;
      legend.appendChild(span);
    }
  });
}

function buildReadinessSectionHtml() {
  return (
    '<div class="portal-readiness" id="portalReadinessSection">' +
    '<div class="portal-readiness-head">' +
    '<span class="portal-readiness-title">Profile readiness</span>' +
    '<span class="portal-readiness-label" id="portalReadinessLabel">—</span>' +
    '<span class="portal-readiness-score" id="portalReadinessScore">—</span>' +
    "</div>" +
    '<div class="portal-readiness-bar" aria-hidden="true">' +
    '<div class="portal-readiness-bar-fill" id="portalReadinessBarFill" style="width:3%"></div>' +
    "</div>" +
    '<p class="portal-readiness-nudge" id="portalReadinessNudge" hidden></p>' +
    "</div>"
  );
}

function buildEditProfileHtml(therapist) {
  var t = therapist || {};
  var viewHref = t.slug ? "therapist.html?slug=" + encodeURIComponent(t.slug) : "";

  // Fields the therapist has already reviewed (either confirmed or
  // edited). Any field with a value that ISN'T in this set is
  // "editorially sourced" — likely scraped from public sources — and
  // gets a grey dot next to its label until the therapist saves it.
  var reportedList = Array.isArray(t.therapist_reported_fields) ? t.therapist_reported_fields : [];
  var reportedSet = {};
  reportedList.forEach(function (k) {
    reportedSet[String(k).trim()] = true;
    // Tolerate mixed camelCase/snake_case history by registering both
    // spellings. Older review events stored camelCase names.
    reportedSet[
      String(k)
        .replace(/([A-Z])/g, "_$1")
        .toLowerCase()
    ] = true;
  });

  function hasMeaningfulValue(value) {
    if (value == null || value === "") return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "string") return value.trim().length > 0;
    if (typeof value === "number") return true;
    return Boolean(value);
  }

  function reviewDot(name, value) {
    if (reportedSet[name]) return "";
    if (!hasMeaningfulValue(value)) return "";
    return '<span class="portal-review-dot" title="Pulled from public sources — please review and save to confirm" aria-label="Unreviewed field"></span>';
  }

  // The big banner shows when the therapist has never confirmed any
  // field AND the profile already has at least one pre-filled value
  // (i.e. this is a scraped profile they just claimed). If everything
  // is empty, there's nothing to review — no banner.
  var hasAnyPrefilledData =
    hasMeaningfulValue(t.bio) ||
    hasMeaningfulValue(t.credentials) ||
    hasMeaningfulValue(t.care_approach) ||
    hasMeaningfulValue(t.phone) ||
    hasMeaningfulValue(t.website) ||
    hasMeaningfulValue(t.specialties) ||
    hasMeaningfulValue(t.insurance_accepted) ||
    hasMeaningfulValue(t.telehealth_states) ||
    hasMeaningfulValue(t.session_fee_min);
  var showReviewBanner = reportedList.length === 0 && hasAnyPrefilledData;
  // Empty-state coaching — only for fresh signups with no pre-filled
  // data and zero prior saves. Pointing a new therapist directly at
  // bio + specialties is the single highest-leverage first-3-minutes
  // ask. Don't show if the profile is scraped/pre-filled (the review
  // banner handles that case) or if they've saved before.
  var isFirstTimeEmpty =
    !hasAnyPrefilledData && !((t && t.portal_save_count) > 0) && reportedList.length === 0;
  var coachingBannerHtml = isFirstTimeEmpty
    ? '<div class="portal-coaching-banner">' +
      "<strong>New to the directory?</strong> " +
      "Three minutes on <strong>Bio</strong> + <strong>Bipolar specialties</strong> puts you in front of patients by the end of the day. " +
      'Start with <a href="#" class="portal-coaching-jump" data-target="bio">your bio below ↓</a>.' +
      "</div>"
    : "";
  var reviewBannerHtml = showReviewBanner
    ? '<div class="portal-review-banner" id="portalReviewBanner">' +
      "<strong>We pre-filled your profile from public sources.</strong> " +
      "Please review each section — outdated info hurts your discoverability. " +
      "Any field with a " +
      '<span class="portal-review-dot" aria-hidden="true"></span> hasn\'t been confirmed by you yet. ' +
      "Saving a section marks it as reviewed." +
      "</div>"
    : "";

  function hintBlock(text) {
    return text ? '<small class="portal-hint">' + escapeHtml(text) + "</small>" : "";
  }

  function textInput(name, label, value, opts) {
    opts = opts || {};
    var type = opts.type || "text";
    var attrs = opts.attrs || "";
    return (
      '<label class="portal-edit-field"><span class="portal-edit-label"><strong>' +
      escapeHtml(label) +
      reviewDot(name, value) +
      "</strong>" +
      hintBlock(opts.hint) +
      "</span>" +
      '<input type="' +
      type +
      '" name="' +
      name +
      '" value="' +
      escapeAttr(value == null ? "" : value) +
      '" ' +
      attrs +
      " /></label>"
    );
  }

  function textarea(name, label, value, rows, opts) {
    opts = opts || {};
    var minLen = opts.minLen ? ' data-min-len="' + opts.minLen + '"' : "";
    var goodLen = opts.goodLen ? ' data-good-len="' + opts.goodLen + '"' : "";
    var hasCounter = opts.minLen || opts.goodLen;
    return (
      '<label class="portal-edit-field"><span class="portal-edit-label"><strong>' +
      escapeHtml(label) +
      reviewDot(name, value) +
      "</strong>" +
      hintBlock(opts.hint) +
      "</span>" +
      '<textarea name="' +
      name +
      '" rows="' +
      (rows || 4) +
      '"' +
      minLen +
      goodLen +
      (hasCounter ? ' data-has-counter="true"' : "") +
      ">" +
      escapeHtml(value || "") +
      "</textarea>" +
      (hasCounter
        ? '<div class="portal-char-counter" data-counter-for="' + name + '"></div>'
        : "") +
      "</label>"
    );
  }

  function checkbox(name, label, checked, hint) {
    return (
      '<label class="portal-edit-check"><input type="checkbox" name="' +
      name +
      '" ' +
      (checked ? "checked" : "") +
      " /><span><strong>" +
      escapeHtml(label) +
      "</strong>" +
      hintBlock(hint) +
      "</span></label>"
    );
  }

  function select(name, label, value, choices, hint) {
    var opts = choices
      .map(function (c) {
        return (
          '<option value="' +
          escapeAttr(c.value) +
          '" ' +
          (String(value || "") === c.value ? "selected" : "") +
          ">" +
          escapeHtml(c.label) +
          "</option>"
        );
      })
      .join("");
    return (
      '<label class="portal-edit-field"><span class="portal-edit-label"><strong>' +
      escapeHtml(label) +
      reviewDot(name, value) +
      "</strong>" +
      hintBlock(hint) +
      "</span>" +
      '<select name="' +
      name +
      '">' +
      opts +
      "</select></label>"
    );
  }

  function chipPicker(name, label, values, hint) {
    var current = Array.isArray(values) ? values : [];
    var chipsHtml = current
      .map(function (v) {
        return (
          '<span class="portal-chip">' +
          escapeHtml(v) +
          '<button type="button" class="portal-chip-remove" aria-label="Remove ' +
          escapeAttr(v) +
          '" data-val="' +
          escapeAttr(v) +
          '">×</button></span>'
        );
      })
      .join("");
    return (
      '<div class="portal-edit-field portal-chip-picker" data-field="' +
      name +
      '">' +
      '<span class="portal-edit-label"><strong>' +
      escapeHtml(label) +
      reviewDot(name, current) +
      "</strong>" +
      hintBlock(hint) +
      "</span>" +
      '<div class="portal-chip-list">' +
      chipsHtml +
      "</div>" +
      '<div class="portal-chip-input-wrap">' +
      '<input type="text" class="portal-chip-input" placeholder="Type to search or add…" autocomplete="off" />' +
      '<ul class="portal-chip-suggestions" hidden></ul>' +
      "</div>" +
      '<input type="hidden" name="' +
      name +
      '" value="' +
      escapeAttr(current.join(",")) +
      '" />' +
      "</div>"
    );
  }

  return (
    '<section class="portal-card portal-edit" id="portalEditCard" style="margin-bottom:1rem">' +
    '<div class="portal-edit-head">' +
    "<h2>Edit your profile</h2>" +
    (viewHref
      ? '<a class="btn-secondary portal-edit-view" href="' +
        escapeAttr(viewHref) +
        '" target="_blank" rel="noopener">View public listing ↗</a>'
      : "") +
    "</div>" +
    '<p class="portal-subtle" style="margin:0 0 0.75rem;font-size:0.85rem">Name and license are locked. To change those, use the request form below.</p>' +
    reviewBannerHtml +
    coachingBannerHtml +
    buildReadinessSectionHtml() +
    '<form id="portalEditForm" class="portal-edit-form">' +
    // About you — most conversion-critical, comes first.
    '<fieldset class="portal-edit-group"><legend>About you</legend>' +
    textarea("bio", "Bio", t.bio, 6, {
      hint: "Patients read this first. 150–300 words works best. Speak to them, not about yourself in third person.",
      minLen: 50,
      goodLen: 600,
    }) +
    textInput("credentials", "Credentials", t.credentials, {
      hint: 'Short form like "LMFT, PhD". Shown next to your name across the directory.',
    }) +
    textInput("practice_name", "Practice name", t.practice_name, {
      hint: "Optional. Leave blank if you practice under your own name.",
    }) +
    textarea("care_approach", "How you help bipolar clients", t.care_approach, 4, {
      hint: "What's distinctive about your bipolar work? Populations, modalities, mood-stabilization vs. relapse prevention, med-coordination. A specific answer beats a generic one.",
      minLen: 120,
      goodLen: 400,
    }) +
    textInput("years_experience", "Years of experience", t.years_experience, {
      type: "number",
      attrs: 'min="0" max="80"',
      hint: "Total years in practice.",
    }) +
    textInput(
      "bipolar_years_experience",
      "Years treating bipolar specifically",
      t.bipolar_years_experience,
      {
        type: "number",
        attrs: 'min="0" max="80"',
        hint: "Patients searching for specialists weight this heavily. 8+ years unlocks a readiness boost.",
      },
    ) +
    checkbox(
      "medication_management",
      "I provide medication management",
      t.medication_management === true,
      "Check only if you can prescribe or co-manage meds. This is a patient filter.",
    ) +
    "</fieldset>" +
    // Who you see + how — fit & filters. The chip pickers live here.
    '<fieldset class="portal-edit-group"><legend>Who you see and how</legend>' +
    chipPicker(
      "specialties",
      "Bipolar specialties",
      t.specialties,
      "Click to add. Patients filter by these. More specific > generic.",
    ) +
    chipPicker(
      "insurance_accepted",
      "Insurance accepted",
      t.insurance_accepted,
      "Patients filter by this. Without it, you're invisible in insurance-filtered searches. Type your own plan if not listed.",
    ) +
    chipPicker(
      "telehealth_states",
      "Telehealth states",
      t.telehealth_states,
      "Only list states where you're actually licensed. Required to appear in cross-state searches.",
    ) +
    chipPicker(
      "treatment_modalities",
      "Treatment modalities",
      t.treatment_modalities,
      "IPSRT and Family-Focused Therapy are bipolar-specific and score well with informed patients.",
    ) +
    chipPicker(
      "client_populations",
      "Populations you serve",
      t.client_populations,
      "Adolescents, couples, LGBTQ+, BIPOC — patients filter by these.",
    ) +
    chipPicker(
      "languages",
      "Languages",
      t.languages,
      "Any language you can conduct a full session in.",
    ) +
    "</fieldset>" +
    // Contact + availability
    '<fieldset class="portal-edit-group"><legend>Contact and availability</legend>' +
    checkbox(
      "accepting_new_patients",
      "Currently accepting new patients",
      t.accepting_new_patients !== false,
      "Patients filter on this. Toggle off when you're full — your listing stays up but drops from 'accepting' searches.",
    ) +
    checkbox("accepts_telehealth", "Offer telehealth sessions", t.accepts_telehealth !== false) +
    checkbox("accepts_in_person", "Offer in-person sessions", t.accepts_in_person !== false) +
    textInput("estimated_wait_time", "Estimated wait time", t.estimated_wait_time, {
      hint: '"2 weeks", "Immediately available", "4–6 weeks". Patients triage urgent vs. exploratory by this.',
    }) +
    textInput("email", "Public email", t.email, {
      type: "email",
      attrs: 'autocomplete="email" maxlength="254"',
      hint: "This is the email patients will see on your public profile. It can be the same as your login email or different. Leave blank if you don't want patients to email you directly.",
    }) +
    '<p class="portal-subtle portal-login-email-note" style="margin:-0.25rem 0 0.75rem;font-size:0.82rem">' +
    "You log in with <strong>" +
    escapeHtml(t.claimed_by_email || "") +
    "</strong>. This email is private and never shown to patients. To change it, email support." +
    "</p>" +
    textInput("phone", "Public phone", t.phone, {
      hint: "Shown on your public profile. Leave blank to keep it private.",
    }) +
    textInput("website", "Website", t.website, {
      attrs: 'placeholder="yourpractice.com" inputmode="url"',
      hint: "Builds trust and supports independent verification. You can type yourpractice.com and we'll add https:// for you.",
    }) +
    textInput("booking_url", "Booking URL", t.booking_url, {
      attrs: 'placeholder="calendly.com/you" inputmode="url"',
      hint: "Optional. Direct link to your scheduling tool (Calendly, SimplePractice, etc.).",
    }) +
    select(
      "preferred_contact_method",
      "Preferred contact method",
      t.preferred_contact_method,
      [
        { value: "", label: "— Not set —" },
        { value: "email", label: "Email" },
        { value: "phone", label: "Phone" },
        { value: "website", label: "Website" },
        { value: "booking", label: "Booking link" },
      ],
      "What the primary CTA button on your profile routes to.",
    ) +
    textarea("contact_guidance", "What to include when reaching out", t.contact_guidance, 3, {
      hint: "Tell patients what to send up front — state they're in, therapy vs. med needs, insurance. Reduces back-and-forth.",
      minLen: 60,
      goodLen: 250,
    }) +
    textarea(
      "first_step_expectation",
      "What happens after someone reaches out",
      t.first_step_expectation,
      3,
      {
        hint: "Do you call within 24h? Offer a 15-min consult? Describe the first step so patients can picture it.",
        minLen: 60,
        goodLen: 250,
      },
    ) +
    "</fieldset>" +
    // Fees
    '<fieldset class="portal-edit-group"><legend>Fees</legend>' +
    textInput("session_fee_min", "Session fee minimum ($)", t.session_fee_min, {
      type: "number",
      attrs: 'min="0" max="10000"',
      hint: "A range filters out price-mismatched inquiries before they waste your time.",
    }) +
    textInput("session_fee_max", "Session fee maximum ($)", t.session_fee_max, {
      type: "number",
      attrs: 'min="0" max="10000"',
    }) +
    checkbox(
      "sliding_scale",
      "I offer a sliding scale",
      t.sliding_scale === true,
      "Even a partial sliding scale is a discoverability boost — patients filter for this.",
    ) +
    "</fieldset>" +
    '<div class="portal-actions" style="margin-top:1rem"><button class="btn-primary" type="submit">Save changes</button><div class="portal-feedback" id="portalEditFeedback"></div></div>' +
    "</form></section>"
  );
}

function collectEditProfileUpdates(form) {
  var elements = form.elements;
  var payload = {};

  function str(name) {
    var el = elements[name];
    payload[name] = el ? String(el.value || "").trim() : "";
  }

  function num(name) {
    var el = elements[name];
    if (!el) return;
    var v = String(el.value || "").trim();
    payload[name] = v === "" ? "" : Number(v);
  }

  function bool(name) {
    var el = elements[name];
    payload[name] = !!(el && el.checked);
  }

  [
    "bio",
    "credentials",
    "practice_name",
    "email",
    "phone",
    "website",
    "booking_url",
    "preferred_contact_method",
    "contact_guidance",
    "first_step_expectation",
    "estimated_wait_time",
    "care_approach",
    "specialties",
    "insurance_accepted",
    "telehealth_states",
    "treatment_modalities",
    "languages",
    "client_populations",
  ].forEach(str);

  ["session_fee_min", "session_fee_max", "years_experience", "bipolar_years_experience"].forEach(
    num,
  );

  [
    "accepting_new_patients",
    "accepts_telehealth",
    "accepts_in_person",
    "sliding_scale",
    "medication_management",
  ].forEach(bool);

  return payload;
}

function attachChipPicker(picker) {
  var field = picker.dataset.field;
  var suggestions = PORTAL_PICKER_OPTIONS[field] || [];
  var list = picker.querySelector(".portal-chip-list");
  var input = picker.querySelector(".portal-chip-input");
  var suggestBox = picker.querySelector(".portal-chip-suggestions");
  var hidden = picker.querySelector('input[type="hidden"]');

  function currentValues() {
    return hidden.value
      ? hidden.value
          .split(",")
          .map(function (s) {
            return s.trim();
          })
          .filter(function (s) {
            return s.length > 0;
          })
      : [];
  }

  function renderChips(arr) {
    list.innerHTML = arr
      .map(function (v) {
        return (
          '<span class="portal-chip">' +
          escapeHtml(v) +
          '<button type="button" class="portal-chip-remove" aria-label="Remove ' +
          escapeAttr(v) +
          '" data-val="' +
          escapeAttr(v) +
          '">×</button></span>'
        );
      })
      .join("");
  }

  function setValues(arr) {
    hidden.value = arr.join(",");
    renderChips(arr);
    hidden.dispatchEvent(new window.Event("input", { bubbles: true }));
  }

  function showSuggestions(query) {
    var q = String(query || "")
      .toLowerCase()
      .trim();
    var taken = {};
    currentValues().forEach(function (v) {
      taken[v.toLowerCase()] = true;
    });
    var matches = suggestions.filter(function (s) {
      if (taken[s.toLowerCase()]) return false;
      if (!q) return true;
      return s.toLowerCase().indexOf(q) !== -1;
    });
    matches = matches.slice(0, 10);
    if (!matches.length) {
      suggestBox.hidden = true;
      suggestBox.innerHTML = "";
      return;
    }
    suggestBox.innerHTML = matches
      .map(function (m) {
        return '<li data-val="' + escapeAttr(m) + '" role="option">' + escapeHtml(m) + "</li>";
      })
      .join("");
    suggestBox.hidden = false;
  }

  function addValue(v) {
    v = String(v || "").trim();
    if (!v) return;
    var arr = currentValues();
    var lower = v.toLowerCase();
    for (var i = 0; i < arr.length; i += 1) {
      if (arr[i].toLowerCase() === lower) return;
    }
    arr.push(v);
    setValues(arr);
    input.value = "";
    showSuggestions("");
  }

  function removeValue(v) {
    setValues(
      currentValues().filter(function (x) {
        return x !== v;
      }),
    );
  }

  list.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-val]");
    if (btn) removeValue(btn.dataset.val);
  });

  input.addEventListener("input", function () {
    showSuggestions(input.value);
  });
  input.addEventListener("focus", function () {
    showSuggestions(input.value);
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addValue(input.value);
    } else if (e.key === "Backspace" && !input.value) {
      var arr = currentValues();
      if (arr.length) {
        arr.pop();
        setValues(arr);
      }
    } else if (e.key === "Escape") {
      suggestBox.hidden = true;
    }
  });

  suggestBox.addEventListener("mousedown", function (e) {
    var li = e.target.closest("li[data-val]");
    if (li) {
      e.preventDefault();
      addValue(li.dataset.val);
    }
  });

  document.addEventListener("click", function (e) {
    if (!picker.contains(e.target)) suggestBox.hidden = true;
  });
}

function attachAllChipPickers(form) {
  form.querySelectorAll(".portal-chip-picker").forEach(attachChipPicker);
}

function updateCharCounter(node) {
  var name = node.name;
  var counter = document.querySelector('[data-counter-for="' + name + '"]');
  if (!counter) return;
  var len = String(node.value || "").length;
  var minLen = Number(node.dataset.minLen || 0);
  var goodLen = Number(node.dataset.goodLen || 0);
  var state = "short";
  var label = len + " chars";
  if (minLen && len < minLen) {
    state = "short";
    label = len + " / " + minLen + " min";
  } else if (goodLen && len >= goodLen) {
    state = "good";
    label = len + " chars · good length";
  } else if (minLen && len >= minLen) {
    state = "ok";
    label = len + " chars · ok";
  }
  counter.textContent = label;
  counter.className = "portal-char-counter is-" + state;
}

function attachAllCharCounters(form) {
  form.querySelectorAll('textarea[data-has-counter="true"]').forEach(function (node) {
    updateCharCounter(node);
    node.addEventListener("input", function () {
      updateCharCounter(node);
    });
  });
}

// Captures the current form state as a map keyed by input name.
// Used to diff against on submit so we only send fields the user
// actually changed. Keeps "reviewed" provenance honest — a therapist
// who hits Save without editing anything marks zero fields as
// reviewed (and gets a friendly "no changes" message).
function snapshotFormState(form) {
  var state = {};
  form.querySelectorAll("input, select, textarea").forEach(function (node) {
    if (!node.name) return;
    if (node.type === "checkbox") {
      state[node.name] = node.checked ? "true" : "false";
    } else {
      state[node.name] = String(node.value || "");
    }
  });
  return state;
}

function currentFormState(form) {
  return snapshotFormState(form);
}

var PORTAL_DRAFT_KEY_PREFIX = "portal-draft-";

function portalDraftKey(slug) {
  return PORTAL_DRAFT_KEY_PREFIX + String(slug || "");
}

function readPortalDraft(slug) {
  try {
    var raw = window.localStorage.getItem(portalDraftKey(slug));
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.state) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

function writePortalDraft(slug, state) {
  try {
    window.localStorage.setItem(
      portalDraftKey(slug),
      JSON.stringify({ state: state, saved_at: new Date().toISOString() }),
    );
  } catch (_error) {
    // localStorage might be unavailable (private mode, disk full). Drafts
    // are a convenience — failing silently is correct here.
  }
}

function clearPortalDraft(slug) {
  try {
    window.localStorage.removeItem(portalDraftKey(slug));
  } catch (_error) {
    // nothing to do — draft was already unreadable
  }
}

function applyDraftToForm(form, state) {
  if (!state) return;
  form.querySelectorAll("input, select, textarea").forEach(function (node) {
    if (!node.name || !(node.name in state)) return;
    if (node.type === "checkbox") {
      node.checked = state[node.name] === "true";
    } else {
      node.value = state[node.name];
    }
  });
  // Chip pickers re-render from their hidden inputs. Re-trigger.
  form.querySelectorAll(".portal-chip-picker").forEach(function (picker) {
    var hidden = picker.querySelector('input[type="hidden"]');
    if (!hidden) return;
    hidden.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

var PORTAL_CONTACT_VALIDATORS = {
  email: validateEmail,
  phone: validatePhone,
  website: validateWebsite,
  booking_url: validateBookingUrl,
};

function setPortalFieldError(field, message) {
  if (!field) return;
  var label = field.closest("label.portal-edit-field") || field.parentElement;
  if (!label) return;
  var existing = label.querySelector(".portal-field-error");
  if (!message) {
    if (existing) existing.remove();
    field.removeAttribute("aria-invalid");
    return;
  }
  if (!existing) {
    existing = document.createElement("small");
    existing.className = "portal-field-error";
    existing.setAttribute("role", "alert");
    existing.style.color = "#b03636";
    existing.style.display = "block";
    existing.style.marginTop = "0.25rem";
    label.appendChild(existing);
  }
  existing.textContent = message;
  field.setAttribute("aria-invalid", "true");
}

function setPortalFormError(form, message) {
  var host = form.querySelector(".portal-form-error");
  if (!message) {
    if (host) host.remove();
    return;
  }
  if (!host) {
    host = document.createElement("div");
    host.className = "portal-form-error";
    host.setAttribute("role", "alert");
    host.style.color = "#b03636";
    host.style.border = "1px solid #e7b4b4";
    host.style.background = "#fbeeee";
    host.style.padding = "0.6rem 0.75rem";
    host.style.borderRadius = "6px";
    host.style.margin = "0 0 0.75rem";
    form.insertBefore(host, form.firstChild);
  }
  host.textContent = message;
}

function runPortalContactFieldValidation(form) {
  var firstError = null;
  Object.keys(PORTAL_CONTACT_VALIDATORS).forEach(function (name) {
    var el = form.elements[name];
    if (!el) return;
    var result = PORTAL_CONTACT_VALIDATORS[name](el.value);
    if (result.valid) {
      setPortalFieldError(el, "");
    } else {
      setPortalFieldError(el, result.error);
      if (!firstError) firstError = { name: name, el: el, error: result.error };
    }
  });
  return firstError;
}

function runPortalPresenceValidation(form) {
  var values = {};
  ["email", "phone", "website", "booking_url"].forEach(function (name) {
    var el = form.elements[name];
    values[name === "booking_url" ? "bookingUrl" : name] = el ? String(el.value || "").trim() : "";
  });
  return validatePublicContactPresence(values);
}

function wireEditProfileHandlers(therapist) {
  var form = document.getElementById("portalEditForm");
  if (!form) return;

  attachAllChipPickers(form);
  attachAllCharCounters(form);

  Object.keys(PORTAL_CONTACT_VALIDATORS).forEach(function (name) {
    var el = form.elements[name];
    if (!el) return;
    el.addEventListener("blur", function () {
      var result = PORTAL_CONTACT_VALIDATORS[name](el.value);
      setPortalFieldError(el, result.valid ? "" : result.error);
    });
    el.addEventListener("input", function () {
      if (el.getAttribute("aria-invalid") === "true") {
        var result = PORTAL_CONTACT_VALIDATORS[name](el.value);
        if (result.valid) setPortalFieldError(el, "");
      }
    });
  });

  // Coaching banner "jump" link — focus the bio field and scroll it
  // into view. Only lives on the page for fresh/empty profiles.
  var coachingJump = document.querySelector(".portal-coaching-jump");
  if (coachingJump) {
    coachingJump.addEventListener("click", function (event) {
      event.preventDefault();
      var bio = form.elements.bio;
      if (bio) {
        bio.scrollIntoView({ behavior: "smooth", block: "center" });
        bio.focus();
        trackFunnelEvent("portal_coaching_jumped", { target: "bio" });
      }
    });
  }

  // Initial snapshot captured AFTER chip pickers render so their
  // hidden inputs have their starting values. Used to diff on submit.
  var initialSnapshot = snapshotFormState(form);

  // Check for an unsaved draft from a prior session (tab closed
  // before save, browser crash, etc.). Only offer restore if the
  // draft is actually different from what's on the doc.
  var draftSlug = therapist && therapist.slug;
  var draft = draftSlug ? readPortalDraft(draftSlug) : null;
  if (draft && draft.state) {
    var differsFromDoc = Object.keys(draft.state).some(function (k) {
      return draft.state[k] !== initialSnapshot[k];
    });
    if (!differsFromDoc) {
      clearPortalDraft(draftSlug);
      draft = null;
    }
  }
  if (draft) {
    var draftBanner = document.createElement("div");
    draftBanner.className = "portal-draft-banner";
    var savedDate = new Date(draft.saved_at);
    var dateStr = Number.isFinite(savedDate.getTime())
      ? savedDate.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "earlier";
    draftBanner.innerHTML =
      "<span>Unsaved draft from <strong>" +
      escapeHtml(dateStr) +
      "</strong>. Restore?</span>" +
      '<div><button type="button" class="portal-draft-restore">Restore</button>' +
      '<button type="button" class="portal-draft-discard">Discard</button></div>';
    form.parentElement.insertBefore(draftBanner, form);
    draftBanner.querySelector(".portal-draft-restore").addEventListener("click", function () {
      applyDraftToForm(form, draft.state);
      updateReadinessUi(therapist, form);
      draftBanner.remove();
      trackFunnelEvent("portal_draft_restored", { slug: draftSlug });
    });
    draftBanner.querySelector(".portal-draft-discard").addEventListener("click", function () {
      clearPortalDraft(draftSlug);
      draftBanner.remove();
      trackFunnelEvent("portal_draft_discarded", { slug: draftSlug });
    });
  }

  // Funnel instrumentation. Track portal-open once, first-edit once
  // per session, and readiness-threshold crossings so we can measure
  // whether the UX polish is actually moving therapists toward
  // "match-ready" within the target window.
  trackFunnelEvent("portal_opened", {
    slug: draftSlug,
    claim_status: therapist && therapist.claim_status,
    save_count: (therapist && therapist.portal_save_count) || 0,
    initial_readiness: getTherapistMatchReadiness(therapist).score,
  });

  var firstEditFired = false;
  var lastReadinessScore = getTherapistMatchReadiness(therapist).score;

  // Unsaved-changes guard. beforeunload asks the browser to warn the
  // clinician if they try to close the tab or navigate with dirty edits.
  // Cleared on successful save below. Modern browsers ignore the string
  // — event.preventDefault() is what actually triggers the native prompt.
  var isDirty = false;
  function setDirty(next) {
    isDirty = Boolean(next);
    document.body.classList.toggle("portal-has-unsaved", isDirty);
  }
  function beforeUnloadHandler(event) {
    if (!isDirty) return undefined;
    event.preventDefault();
    event.returnValue = "";
    return "";
  }
  window.addEventListener("beforeunload", beforeUnloadHandler);

  // Debounced draft autosave on edit. 600ms covers a natural typing
  // pause without burning writes on every keystroke.
  var draftSaveTimer = null;
  function scheduleDraftSave() {
    if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(function () {
      if (!draftSlug) return;
      var currentState = snapshotFormState(form);
      // Only write draft if it differs from the current doc baseline.
      var differs = Object.keys(currentState).some(function (k) {
        return currentState[k] !== initialSnapshot[k];
      });
      if (differs) {
        writePortalDraft(draftSlug, currentState);
      } else {
        clearPortalDraft(draftSlug);
      }
    }, 600);
  }

  // Prime the readiness UI with initial values, then update on any
  // edit. Using both input + change covers text/number (input) and
  // checkbox/select (change). Chip pickers dispatch 'input' on their
  // hidden inputs when values change, so the form-level listener
  // catches them through bubbling.
  updateReadinessUi(therapist, form);
  var onEdit = function () {
    updateReadinessUi(therapist, form);
    scheduleDraftSave();
    // Dirty-tracks against the last saved snapshot so toggling a field
    // back to its original value clears the guard.
    var currentState = snapshotFormState(form);
    var differs = Object.keys(currentState).some(function (k) {
      return currentState[k] !== initialSnapshot[k];
    });
    setDirty(differs);
    if (!firstEditFired) {
      firstEditFired = true;
      trackFunnelEvent("portal_first_edit", { slug: draftSlug });
    }
    // Readiness threshold crossings (from below only).
    var nextScore = getTherapistMatchReadiness(getProjectedTherapist(therapist, form)).score;
    if (lastReadinessScore < 65 && nextScore >= 65) {
      trackFunnelEvent("portal_readiness_crossed_65", { slug: draftSlug, score: nextScore });
    }
    if (lastReadinessScore < 85 && nextScore >= 85) {
      trackFunnelEvent("portal_readiness_crossed_85", { slug: draftSlug, score: nextScore });
    }
    lastReadinessScore = nextScore;
  };
  form.addEventListener("input", onEdit);
  form.addEventListener("change", onEdit);

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var feedback = document.getElementById("portalEditFeedback");
    var submitBtn = form.querySelector('button[type="submit"]');

    setPortalFormError(form, "");
    var fieldError = runPortalContactFieldValidation(form);
    if (fieldError) {
      feedback.textContent = fieldError.error;
      feedback.style.color = "#b03636";
      if (fieldError.el && typeof fieldError.el.focus === "function") {
        fieldError.el.focus();
      }
      return;
    }
    var presence = runPortalPresenceValidation(form);
    if (!presence.valid) {
      setPortalFormError(form, presence.error);
      feedback.textContent = presence.error;
      feedback.style.color = "#b03636";
      return;
    }

    var snapshotNow = currentFormState(form);
    var changedNames = Object.keys(snapshotNow).filter(function (name) {
      return snapshotNow[name] !== initialSnapshot[name];
    });
    if (!changedNames.length) {
      feedback.textContent = "No changes to save.";
      feedback.style.color = "#6b8290";
      trackFunnelEvent("portal_save_no_changes", { slug: draftSlug });
      return;
    }

    // Build the typed payload from every field, then drop any key
    // whose snapshot didn't change. This keeps coercion logic in one
    // place (collectEditProfileUpdates) and limits the request to
    // fields the user actually touched.
    var fullPayload = collectEditProfileUpdates(form);
    // Auto-prepend https:// for URL fields so therapists can type bare
    // domains like "practice.com". Matches server-side normalization in
    // validatePortalTherapistUpdates so stored values always have a protocol.
    if (typeof fullPayload.website === "string" && fullPayload.website) {
      fullPayload.website = normalizeUrl(fullPayload.website);
    }
    if (typeof fullPayload.booking_url === "string" && fullPayload.booking_url) {
      fullPayload.booking_url = normalizeUrl(fullPayload.booking_url);
    }
    var payload = {};
    changedNames.forEach(function (name) {
      if (name in fullPayload) payload[name] = fullPayload[name];
    });

    if (submitBtn) submitBtn.disabled = true;
    feedback.textContent = "Saving...";
    feedback.style.color = "";
    try {
      var result = await patchTherapistProfile(payload);
      feedback.textContent = "Saved. Your public listing is updated.";
      feedback.style.color = "#1a7a8f";
      if (result && result.therapist) {
        claimSessionState = { therapist: result.therapist };
        therapist = result.therapist;
        updateReadinessUi(therapist, form);
        // Re-snapshot so the next save diffs against the new baseline.
        initialSnapshot = snapshotFormState(form);
        clearPortalDraft(draftSlug);
      }
      setDirty(false);
      trackFunnelEvent("portal_save_success", {
        slug: draftSlug,
        changed_fields: changedNames,
        save_count: (therapist && therapist.portal_save_count) || 0,
        readiness_score: getTherapistMatchReadiness(therapist).score,
      });
    } catch (error) {
      feedback.textContent = (error && error.message) || "Something went wrong while saving.";
      feedback.style.color = "#b03636";
      trackFunnelEvent("portal_save_error", {
        slug: draftSlug,
        message: error && error.message,
      });
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
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
        preview.innerHTML = '<img src="' + result.photo_url.replace(/"/g, "&quot;") + '" alt="" />';
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
  var readiness = getTherapistMatchReadiness(therapist);
  var claimStatus = getClaimStatusLabel(therapist.claim_status);
  var pauseRequested = Boolean(therapist.listing_pause_requested_at);
  var removalRequested = Boolean(therapist.listing_removal_requested_at);
  var requestOptions = buildPortalRequestOptions(verifiedClaim, therapist);
  var quickAttentionItems = getQuickAttentionItems(therapist);
  var claimedEmail = therapist.claimed_by_email || therapist.email || "";
  var relatedApplication = verifiedClaim
    ? getRelatedApplication(therapist, { claimedEmail: claimedEmail })
    : null;
  var progress = verifiedClaim ? buildPortalProgressData(relatedApplication) : null;
  var nextAction = buildPortalNextAction(therapist, relatedApplication);
  var profileCoaching = verifiedClaim ? buildPortalProfileCoaching(relatedApplication) : null;
  var portalTimeline = verifiedClaim ? buildPortalTimeline(relatedApplication, therapist) : [];
  var expectations = verifiedClaim ? buildPortalExpectations(relatedApplication) : null;
  var urgency = verifiedClaim ? buildPortalUrgency(relatedApplication) : null;
  var reviewerFeedback = verifiedClaim ? buildPortalReviewerFeedback(relatedApplication) : null;
  var reviewReadinessSignal = verifiedClaim
    ? buildPortalReviewReadinessSignal(relatedApplication)
    : null;
  var reviewTiming = verifiedClaim ? buildPortalReviewTiming(relatedApplication) : null;

  // The "$19/mo growth toolkit — 14 days free" welcome upsell was
  // removed in the portal redesign. It surfaced before clinicians had
  // received any value from the listing and set the wrong first
  // impression. The eventual replacement is a deferred analytics teaser
  // inside the Listing-strength panel that fires only after 7+ days
  // live and only when real "patients searched in your area" data is
  // available. See spec Step 9.
  var welcomeUpsellBanner = "";

  // Hero eyebrow adapts to the user's actual state so we don't keep
  // saying "claim and manage" to someone who already claimed.
  var heroEyebrow = verifiedClaim
    ? "Your profile dashboard"
    : sessionMode === "claim_token"
      ? "Welcome to your dashboard"
      : "Claim and manage your profile";

  // "One step from live" banner. Fires for signup-instant-checkout
  // therapists whose listing was created with listingActive=false +
  // status=pending_profile so their stub bio didn't leak into the
  // directory. Saving a bio (50+ chars) via the editor auto-publishes
  // them. Framed as a forward step rather than a warning — the
  // therapist has already completed signup and shouldn't feel
  // penalized by an amber "not public" state.
  var isPendingProfile =
    verifiedClaim && (therapist.listing_active === false || therapist.status === "pending_profile");
  var notYetPublicBanner = isPendingProfile
    ? '<section class="portal-card" style="border:2px solid #10b981;background:#ecfdf5;margin-bottom:1rem">' +
      '<p class="portal-eyebrow" style="color:#065f46;margin:0 0 0.35rem">One step from live</p>' +
      '<h2 style="margin:0 0 0.35rem">Add a bio to publish your listing</h2>' +
      '<p class="portal-subtle" style="margin:0 0 0.75rem">' +
      "Write a short paragraph (50+ characters) about how you work with bipolar clients in the editor below. " +
      "Your listing goes live the moment you save. No admin review, no waiting." +
      "</p>" +
      '<a href="#portalEditProfile" class="btn-primary" style="display:inline-block;padding:0.65rem 1rem;border-radius:10px;background:#10b981;color:#fff;text-decoration:none;font-weight:700;font-size:0.95rem">Go to editor ↓</a>' +
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
  var tdViewPublicHref = "therapist.html?slug=" + encodeURIComponent(therapist.slug || "");
  var tdAccepting = therapist.accepting_new_patients === true;
  var tdAcceptingHidden = therapist.accepting_new_patients === false;

  // Phase-aware listing status. Replaces the older "Paused (hidden from
  // directory)" framing per the redesign spec. The full Phase 1 / Phase 2
  // gating logic lands in PR-C; here we already check the same minimums
  // (specialties + practice mode) so the message is consistent.
  var portalSpecialties = Array.isArray(therapist.specialties)
    ? therapist.specialties.filter(Boolean)
    : [];
  var portalHasPracticeMode = Boolean(therapist.accepts_in_person || therapist.accepts_telehealth);
  var portalMissingForLive = [];
  if (!portalSpecialties.length) portalMissingForLive.push("specialties");
  if (!portalHasPracticeMode) portalMissingForLive.push("practice mode");
  var portalIsLive =
    therapist.listing_active !== false &&
    portalMissingForLive.length === 0 &&
    therapist.status !== "pending_profile";

  var liveLabel = portalIsLive
    ? "Your card is live"
    : portalMissingForLive.length
      ? "Add " + portalMissingForLive.join(" and ") + " to go live"
      : therapist.status === "pending_profile" || therapist.listing_active === false
        ? "Add a bio to go live"
        : "Not yet published";

  // Auto-open editor only when the clinician clearly needs it:
  // fresh claim_token session, pre-publish state, explicit deep-link to
  // #portalEditProfile, or no saves yet. Otherwise keep overview first.
  var editorAutoOpen =
    isPendingProfile ||
    sessionMode === "claim_token" ||
    (typeof window !== "undefined" &&
      window.location &&
      window.location.hash === "#portalEditProfile") ||
    (verifiedClaim && !(therapist && therapist.portal_save_count > 0));

  var nextStepCta =
    nextAction.href && nextAction.ctaLabel
      ? '<div class="portal-actions" style="margin-top:0.85rem"><a class="btn-primary" href="' +
        escapeHtml(nextAction.href) +
        '">' +
        escapeHtml(nextAction.ctaLabel) +
        "</a></div>"
      : verifiedClaim
        ? '<div class="portal-actions" style="margin-top:0.85rem"><a class="btn-primary" href="#portalEditProfile" data-portal-editor-jump="1">Edit profile</a></div>'
        : "";

  // Zone 1 — Listing snapshot only. The "What to do next / You're all
  // set" next-step card was removed in the portal redesign; its job is
  // now done by Phase 1 ("Get your card live") and Phase 2 ("Improve
  // your listing") which sit just below this zone.
  var priorityZone =
    '<div style="margin-bottom:1rem">' +
    '<article class="portal-card portal-listing-snapshot">' +
    '<p class="portal-eyebrow">Listing status</p>' +
    '<h2 style="margin:0 0 0.35rem">' +
    escapeHtml(liveLabel) +
    "</h2>" +
    (portalIsLive && therapist.slug
      ? '<p class="portal-subtle" style="margin:0 0 0.5rem"><a href="therapist.html?slug=' +
        escapeHtml(therapist.slug) +
        '" target="_blank" rel="noopener" class="portal-public-listing-link">View public listing →</a></p>'
      : "") +
    '<ul class="portal-snapshot-list">' +
    "<li><span>Claim</span><strong>" +
    escapeHtml(claimStatus) +
    "</strong></li>" +
    "<li><span>Accepting patients</span><strong>" +
    escapeHtml(therapist.accepting_new_patients === false ? "Not accepting" : "Accepting or open") +
    "</strong></li>" +
    "<li><span>Headshot</span><strong>" +
    escapeHtml(getPhotoStatusLabel(therapist)) +
    "</strong></li>" +
    "<li><span>Main contact route</span><strong>" +
    escapeHtml(getContactRouteLabel(therapist)) +
    "</strong></li>" +
    (pauseRequested ? "<li><span>Pause</span><strong>Requested</strong></li>" : "") +
    (removalRequested ? "<li><span>Removal</span><strong>Requested</strong></li>" : "") +
    "</ul>" +
    (quickAttentionItems && quickAttentionItems.length
      ? '<details class="portal-attention"><summary>' +
        quickAttentionItems.length +
        " item" +
        (quickAttentionItems.length === 1 ? "" : "s") +
        ' to review</summary><ul class="portal-list" style="margin-top:0.5rem">' +
        quickAttentionItems
          .map(function (item) {
            return "<li>• " + escapeHtml(item) + "</li>";
          })
          .join("") +
        "</ul></details>"
      : "") +
    '<div class="portal-actions portal-snapshot-actions" style="margin-top:0.9rem">' +
    '<a class="btn-secondary" href="therapist.html?slug=' +
    encodeURIComponent(therapist.slug) +
    '" target="_blank" rel="noopener">View public listing ↗</a>' +
    (verifiedClaim
      ? '<a class="btn-secondary" href="#portalEditProfile" data-portal-editor-jump="1">Edit profile</a>'
      : "") +
    "</div>" +
    "</article>" +
    "</div>";

  // Zone 1.5 — Headshot upload. A dedicated, prominent control so a
  // photo is one click away from the dashboard. Only appears once the
  // claim is verified (uploads require an authenticated session).
  // Headshot is now handled inline by Phase 1 (Field 1) and Phase 2
  // (improvement item), per the portal redesign. The standalone
  // "Add your headshot" card was a duplicate, so we removed the
  // visual chrome but kept the DOM hooks bindPortalPhotoUpload()
  // already wires onto. Phase 1/2 click the hidden file input
  // directly to trigger the same upload flow.
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

  // Zone 2 — Legacy "More fields" disclosure was removed in TF-C.
  // Every editable field now lives inline in the completeness panel
  // above. The buildEditProfileHtml(), bindPortalEditor(),
  // snapshotFormState(), getProjectedTherapist() helpers and their
  // related click/save handlers are intentionally left in place per
  // the spec's "schedule as follow-up cleanup" — the dead-code prune
  // is its own PR so this one stays surgical.
  var editorZone = "";

  // Zone 3 — Bottom row per spec Section 6: "This week" analytics card
  // (left) + "Your plan" subscription card (right), equal-width.
  // Existing handlers paint these cards by ID:
  //   - #portalAnalyticsBody / #portalAnalyticsGrid (analytics fetcher)
  //   - #portalFeaturedBody / #portalFeaturedActions (subscription)
  // We keep those IDs on the new structure so the existing JS hydrates
  // active states (e.g. real numbers for paid users) over our static
  // empty-state copy without any handler changes.
  var planZone = verifiedClaim
    ? '<section class="td-bottom-grid">' +
      // "This week" — analytics card. Empty-state copy comes from the
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
      '<a class="td-bottom-card-link" href="#portalFeaturedCard" data-tdc-jump-plan="1">' +
      "Upgrade for full analytics →" +
      "</a>" +
      "</article>" +
      // "Your plan" — subscription card. Free-listing static copy
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

  // Zone 4 — Review activity & coaching. Collapsed under one disclosure.
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
  var reviewZone = hasReviewContent
    ? '<details class="portal-card portal-review-details"><summary><strong>Review activity &amp; coaching</strong><span class="portal-subtle" style="font-size:0.85rem;margin-left:0.5rem">Progress, feedback, and timing</span></summary><div class="portal-review-body">' +
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

  // Zone 5 — Help & account requests. Demoted behind one disclosure.
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
    '</select></label><label>Message<textarea name="message" rows="4" placeholder="Anything else we should know?"></textarea></label><button class="btn-primary" type="submit">Send message</button><div class="portal-feedback" id="portalRequestFeedback"></div></form>' +
    "</details>";

  // ─── TD-A header ───────────────────────────────────────────────────
  // Two-row header.
  //   Row 1: name + city/state | score badge + compact accepting chip +
  //          View public listing pill
  //   Row 2: sign out only (muted)
  //
  // The accepting chip is intentionally compact — it's an operational
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
      ? '<section class="portal-card" style="margin-bottom:1rem"><h2>Verify claim</h2><p class="portal-subtle">This secure link matched the public profile email. Confirm the claim to unlock lightweight self-serve management for this profile.</p><div class="portal-actions"><button class="btn-primary" id="acceptClaimButton" type="button">Claim this profile</button><div class="portal-feedback" id="claimAcceptFeedback"></div></div></section>'
      : "") +
    '<div id="portalTdCompletenessMount"></div>' +
    photoZone +
    editorZone +
    planZone +
    reviewZone +
    helpZone;

  bindPortalPhotoUpload(therapist);

  // Phase 1 — focused onboarding flow for clinicians who haven't yet
  // satisfied the minimum go-live requirements (specialties + practice
  // TD-B: Profile completeness — the unified editor. Replaces Phase 1
  // and Phase 2 with a single accordion of every editable field. The
  // legacy long-form editor stays in the DOM for now but is hidden;
  // any field whose inline form hasn't been built yet (TD-C / TD-D
  // scope) routes to it via the placeholder body.
  if (verifiedClaim && shouldShowCompleteness(therapist)) {
    var tdcMount = document.getElementById("portalTdCompletenessMount");
    if (tdcMount) {
      mountPortalTdCompleteness(tdcMount, therapist, {
        onSaved: function (updatedTherapist) {
          if (updatedTherapist) {
            claimSessionState = { therapist: updatedTherapist };
            therapist = updatedTherapist;
            updateReadinessUi(therapist, document.getElementById("portalEditProfileForm"));
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

    // Legacy editor stays visible. The "More fields" disclosure (renamed
    // from "Edit profile") sits below the completeness list and holds
    // the ~10 fields the unified editor doesn't expose inline (long-form
    // bio, practice name, specialties chip picker, telehealth_states,
    // languages, wait time, website, contact_guidance,
    // first_step_expectation). It's a real complementary surface, not
    // a fallback — so we don't hide it.
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

  // Editor-jump affordance — coaching / progress / review-zone deep
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
    wireEditProfileHandlers(therapist);
    loadAnalyticsIntoPortal(therapist);
    loadSubscriptionIntoFeaturedCard();
  } else if (sessionMode === "claim_token") {
    // Still reveal the welcome-upsell banner on the unverified claim-token
    // state. The magic-link arrival is itself proof of ownership, so there's
    // no reason to hide the upgrade CTA behind the ceremonial "Claim this
    // profile" button — especially when that button can get stuck on
    // replayed / used tokens and leave the user with no way forward.
    renderPortalWelcomeUpsell(null, therapist.slug || slug, therapist.email || "");
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
      trackFunnelEvent("portal_signed_out", { slug: therapist.slug || slug });
      // Fire-and-forget: the server endpoint is an instrumentation hook,
      // not a revocation step. Stateless tokens mean the client clear
      // below is the actual sign-out.
      try {
        await signOutTherapistSession();
      } catch (_error) {
        // Ignore — we still want to clear locally and redirect.
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
  // Dev-only login bypass. Triggered by ?dev_login=<email>. Calls the
  // server's /portal/dev-login endpoint, which is guarded server-side
  // by NODE_ENV + ALLOW_DEV_LOGIN + an email allowlist + an inactive-
  // listing assertion. On success we install the returned session and
  // redirect to a clean ?slug=<slug> URL.
  //
  // The whole block is wrapped in `if (import.meta.env.DEV)` so Vite
  // statically replaces it with `if (false)` in production builds and
  // tree-shakes the body out of the shipped bundle. The server-side
  // guards are the authoritative security boundary; this wrapper is
  // belt-and-braces so zero dev-login code ever reaches end users.
  if (import.meta.env && import.meta.env.DEV) {
    var devLoginEmail = new URLSearchParams(window.location.search).get("dev_login") || "";
    if (devLoginEmail) {
      try {
        clearTherapistSessionToken();
        var devResult = await devLoginAsTherapist(devLoginEmail);
        if (devResult && devResult.therapist_session_token) {
          setTherapistSessionToken(devResult.therapist_session_token);
          var nextParams = new URLSearchParams();
          if (devResult.slug) nextParams.set("slug", devResult.slug);
          window.location.replace(
            window.location.pathname + (nextParams.toString() ? "?" + nextParams.toString() : ""),
          );
          return;
        }
      } catch (_devLoginError) {
        // Fall through — server returned 404 (env not allowed, allowlist
        // miss, or inactive-listing assertion refused the match).
      }
    }
  }

  renderStripeReturnBanner();

  if (token) {
    // Auto-accept on magic-link arrival. Email receipt is already proof
    // of ownership — making the user click an additional "Claim this
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
      // Non-fatal at this stage — if the token is invalid/expired we'll
      // surface it below via claim-session; if it's the rare
      // not-yet-covered failure mode, the "Verify claim" fallback will
      // still render.
    }

    try {
      var session = await fetchTherapistClaimSession(token);
      claimSessionState = session;
      if (session.therapist && session.therapist.claim_status === "claimed") {
        trackFunnelEvent("portal_signin_completed", { slug: session.therapist.slug || "" });
      }
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
        // Session token invalid / expired — fall through to lookup.
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
