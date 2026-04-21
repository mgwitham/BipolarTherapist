import "./funnel-analytics.js";
import { trackFunnelEvent } from "./funnel-analytics.js";
import { fetchPublicTherapistBySlug } from "./cms.js";
import { getTherapistMatchReadiness } from "./matching-model.js";
import { getApplications } from "./store.js";
import { PORTAL_PICKER_OPTIONS } from "../shared/therapist-picker-options.mjs";
import {
  acceptTherapistClaim,
  createStripeBillingPortalSession,
  createStripeFeaturedCheckoutSession,
  fetchPortalAnalytics,
  fetchTherapistClaimSession,
  fetchTherapistMe,
  fetchTherapistSubscription,
  getTherapistSessionToken,
  patchTherapistProfile,
  requestTherapistClaimLink,
  requestTherapistSignIn,
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

function renderLookupState() {
  var shell = document.getElementById("portalShell");
  if (!shell) {
    return;
  }

  shell.innerHTML =
    '<section class="portal-card">' +
    "<h2>Sign in to your listing</h2>" +
    '<p class="portal-subtle">Enter the email you claimed with. We\'ll send you a sign-in link.</p>' +
    '<form id="portalSignInForm" class="portal-form">' +
    '<label>Email<input type="email" id="portalSignInEmail" placeholder="you@example.com" autocomplete="email" required /></label>' +
    '<button class="btn-primary" type="submit">Email me a sign-in link</button>' +
    '<div class="portal-feedback" id="portalSignInFeedback"></div>' +
    "</form>" +
    '<p class="portal-subtle" style="margin-top:1rem;font-size:0.88rem;">' +
    'Haven\'t claimed yet? <a href="claim.html">Claim your profile</a>. ' +
    "Don't remember which email you used? <a href=\"claim.html\">Re-claim your profile</a> — we'll send a link to the email on your public listing." +
    "</p>" +
    "</section>";

  trackFunnelEvent("portal_signin_viewed", {});

  document.getElementById("portalSignInForm").addEventListener("submit", function (event) {
    event.preventDefault();
    var emailInput = document.getElementById("portalSignInEmail");
    var email = String((emailInput && emailInput.value) || "").trim();
    var feedback = document.getElementById("portalSignInFeedback");
    if (!email) {
      feedback.textContent = "Enter the email you claimed with.";
      return;
    }
    feedback.textContent = "Sending sign-in link...";
    trackFunnelEvent("portal_signin_requested", { email_domain: email.split("@")[1] || "" });
    requestTherapistSignIn(email)
      .then(function () {
        feedback.textContent =
          "Check your inbox. If that email matches a claimed profile, we just sent a sign-in link. It expires in 15 minutes.";
        trackFunnelEvent("portal_signin_link_sent", {});
      })
      .catch(function (error) {
        feedback.textContent =
          (error && error.message) || "We couldn't send a sign-in link. Try again in a moment.";
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

function renderAnalyticsStat(number, subLabel) {
  return (
    '<div style="padding:0.7rem 0.85rem;border:1px solid var(--border);border-radius:12px;background:#fafdfd">' +
    '<div style="font-size:1.55rem;font-weight:700;color:var(--navy);line-height:1.1">' +
    escapeHtml(String(number)) +
    "</div>" +
    '<div style="font-size:0.78rem;color:var(--muted);margin-top:0.15rem">' +
    escapeHtml(subLabel) +
    "</div></div>"
  );
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

function renderAnalyticsBlock(payload, subscription) {
  const card = document.getElementById("portalAnalyticsCard");
  const body = document.getElementById("portalAnalyticsBody");
  const grid = document.getElementById("portalAnalyticsGrid");
  if (!card || !body || !grid) return;

  const isPaid = Boolean(subscription && subscription.has_active_featured);
  const current = payload && payload.current;
  const summaries = (payload && Array.isArray(payload.summaries) && payload.summaries) || [];
  const label = formatAnalyticsPeriodLabel(
    (current && current.periodKey) || (payload && payload.current_period_key),
    current && current.periodStart,
  );

  if (!current) {
    body.textContent =
      "No patient activity recorded for " +
      label +
      " yet. Views and contact clicks will appear here as patients interact with your profile.";
    grid.hidden = false;
    grid.style.display = "block";
    grid.style.marginTop = "0.65rem";
    grid.innerHTML = isPaid
      ? ""
      : '<p style="font-size:0.86rem;color:var(--muted);margin:0">' +
        "Once patients start viewing or contacting your profile, you'll see a weekly breakdown here. " +
        '<a href="#portalFeaturedCard" style="color:var(--teal);font-weight:600;text-decoration:none">Upgrade for the full picture →</a>' +
        "</p>";
    return;
  }

  body.textContent = label + " · updated " + formatDate(current.lastEventAt || "");

  const views = Number(current.profileViewsTotal || 0);
  const ctaClicks = Number(current.ctaClicksTotal || 0);

  // Free tier: headline numbers only + clear upgrade CTA.
  if (!isPaid) {
    grid.hidden = false;
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(140px, 1fr))";
    grid.style.gap = "0.85rem";
    grid.style.marginTop = "0.65rem";
    grid.innerHTML =
      renderAnalyticsStat(views, "Profile views this week") +
      renderAnalyticsStat(ctaClicks, "Contact clicks this week") +
      '<div style="grid-column:1 / -1;padding:0.85rem 1rem;border:1px dashed var(--teal);border-radius:12px;background:var(--teal-faint, #e8f5f8)">' +
      '<div style="font-weight:700;color:var(--teal-dark, #155f70);margin-bottom:0.25rem">See your full analytics</div>' +
      '<div style="font-size:0.88rem;color:var(--navy);margin-bottom:0.55rem">' +
      "12-week trendline, view sources (match flow vs directory vs direct), and which contact methods patients actually use. " +
      "Start a 14-day free trial to unlock." +
      "</div>" +
      '<a href="#portalFeaturedCard" class="btn-primary" style="display:inline-block;padding:0.55rem 0.95rem;border-radius:10px;background:var(--teal);color:#fff;text-decoration:none;font-weight:700;font-size:0.9rem">' +
      "Start 14-day free trial →" +
      "</a>" +
      "</div>";
    return;
  }

  // Paid tier: full breakdown + sparkline.
  grid.hidden = false;
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(140px, 1fr))";
  grid.style.gap = "0.85rem";
  grid.style.marginTop = "0.65rem";

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

  const weeklyViews = summaries
    .slice()
    .sort(function (a, b) {
      return String(a.periodKey || "").localeCompare(String(b.periodKey || ""));
    })
    .map(function (s) {
      return Number(s.profileViewsTotal || 0);
    });

  grid.innerHTML =
    renderAnalyticsStat(views, "Profile views this week") +
    renderAnalyticsStat(ctaClicks, "Contact clicks this week") +
    // 12-week trendline spans the full row so it reads as a trend, not a stat.
    '<div style="grid-column:1 / -1;padding:0.7rem 0.85rem;border:1px solid var(--border);border-radius:12px;background:#fafdfd">' +
    '<div style="display:flex;justify-content:space-between;align-items:baseline"><div style="font-size:0.82rem;color:var(--muted);font-weight:600">Profile views · last 12 weeks</div>' +
    '<div style="font-size:0.78rem;color:var(--muted)">peak ' +
    escapeHtml(String(Math.max.apply(null, weeklyViews.length ? weeklyViews : [0]))) +
    "/wk</div></div>" +
    renderAnalyticsSparkline(weeklyViews) +
    "</div>" +
    // Source breakdown
    '<div style="grid-column:1 / -1;padding:0.7rem 0.85rem;border:1px solid var(--border);border-radius:12px;background:#fafdfd">' +
    '<div style="font-size:0.82rem;color:var(--muted);font-weight:600;margin-bottom:0.4rem">How patients found you this week</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:0.5rem">' +
    renderAnalyticsStat(viewsMatch, "From match flow") +
    renderAnalyticsStat(viewsDirectory, "From directory") +
    renderAnalyticsStat(viewsDirect, "Direct / link") +
    renderAnalyticsStat(viewsOther, "Other sources") +
    "</div></div>" +
    // Contact-intent breakdown
    '<div style="grid-column:1 / -1;padding:0.7rem 0.85rem;border:1px solid var(--border);border-radius:12px;background:#fafdfd">' +
    '<div style="font-size:0.82rem;color:var(--muted);font-weight:600;margin-bottom:0.4rem">How patients tried to reach you this week</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:0.5rem">' +
    renderAnalyticsStat(ctaPhone, "Phone") +
    renderAnalyticsStat(ctaEmail, "Email") +
    renderAnalyticsStat(ctaBooking, "Booking link") +
    renderAnalyticsStat(ctaWebsite, "Website") +
    "</div></div>";
}

async function loadAnalyticsIntoPortal() {
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
    renderAnalyticsBlock(
      analyticsResult,
      (subscriptionResult && subscriptionResult.subscription) || null,
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
    preferred_contact_label:
      str("preferred_contact_label") || baseTherapist.preferred_contact_label || "",
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
    '<p class="portal-subtle" style="margin:0 0 0.75rem;font-size:0.85rem">Name, license, and public email are locked. To change those, use the request form below.</p>' +
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
    textInput("phone", "Public phone", t.phone, {
      hint: "Shown on your public profile. Leave blank to keep it private.",
    }) +
    textInput("website", "Website", t.website, {
      type: "url",
      attrs: 'placeholder="https://"',
      hint: "Builds trust and supports independent verification.",
    }) +
    textInput("booking_url", "Booking URL", t.booking_url, {
      type: "url",
      attrs: 'placeholder="https://"',
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
    textInput("preferred_contact_label", "Contact button label", t.preferred_contact_label, {
      hint: '"Book a consultation", "Request an intake", "Email me". Overrides the default label.',
    }) +
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
    "phone",
    "website",
    "booking_url",
    "preferred_contact_method",
    "preferred_contact_label",
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

function wireEditProfileHandlers(therapist) {
  var form = document.getElementById("portalEditForm");
  if (!form) return;

  attachAllChipPickers(form);
  attachAllCharCounters(form);

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

  // Welcome-upsell banner. Shown on any portal state where we know the
  // therapist's identity — claimed OR claim_token (they arrived via a
  // magic link, which proves ownership even if they haven't clicked the
  // ceremonial "Claim this profile" button yet). Letting free-tier users
  // upgrade before completing the verify ceremony also provides an
  // escape hatch if they get stuck on a replayed / used token.
  // Starts hidden; renderPortalWelcomeUpsell() decides whether to reveal
  // based on subscription state + a localStorage dismiss flag.
  var welcomeUpsellEligible = verifiedClaim || sessionMode === "claim_token";
  var welcomeUpsellBanner = welcomeUpsellEligible
    ? '<section class="portal-card" id="portalWelcomeUpsell" hidden style="border:2px solid #1a7a8f;background:linear-gradient(180deg,#ecf7f9 0%,#fff 70%);margin-bottom:1rem">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap">' +
      '<div><p class="portal-eyebrow" style="color:#155f70;margin:0 0 0.35rem">Welcome to your dashboard</p>' +
      '<h2 style="margin:0 0 0.35rem">Unlock your growth toolkit — 14 days free</h2>' +
      '<p class="portal-subtle" style="margin:0">' +
      "$19/mo after trial. Cancel anytime from this dashboard. No charge until day 15." +
      "</p></div>" +
      '<button type="button" id="portalWelcomeUpsellDismiss" aria-label="Dismiss" style="background:transparent;border:0;color:#6b8290;font-size:0.85rem;cursor:pointer;padding:0.3rem 0.5rem">Maybe later</button>' +
      "</div>" +
      '<ul class="pricing-features" style="list-style:none;padding:0;margin:0.85rem 0 1rem;display:grid;gap:0.5rem">' +
      '<li style="padding-left:1.4rem;position:relative;color:#1d3a4a;font-size:0.94rem"><span style="position:absolute;left:0;color:#1a7a8f;font-weight:700">✓</span><strong>12-week analytics dashboard</strong> view trend, how patients found you (match flow vs directory vs direct), and which contact methods they actually used.</li>' +
      '<li style="padding-left:1.4rem;position:relative;color:#1d3a4a;font-size:0.94rem"><span style="position:absolute;left:0;color:#1a7a8f;font-weight:700">✓</span><strong>Monday morning digest email</strong> last week\'s numbers + trend vs prior week, delivered to you automatically.</li>' +
      '<li style="padding-left:1.4rem;position:relative;color:#1d3a4a;font-size:0.94rem"><span style="position:absolute;left:0;color:#1a7a8f;font-weight:700">✓</span><strong>14-day free trial</strong> full dashboard and digest email, no charge until day 15, cancel in one click.</li>' +
      "</ul>" +
      '<button type="button" id="portalWelcomeUpsellCta" class="btn-primary" style="background:#1a7a8f;color:#fff;border:0;border-radius:12px;padding:0.85rem 1.2rem;font-weight:700;font-size:0.95rem;cursor:pointer">Start 14-day free trial — $0 today →</button>' +
      "</section>"
    : "";

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

  shell.innerHTML =
    '<section class="portal-card portal-hero"><div><p class="portal-eyebrow">' +
    escapeHtml(heroEyebrow) +
    "</p><h1>" +
    escapeHtml(therapist.name) +
    '</h1><p class="portal-subtle">' +
    escapeHtml(therapist.city + ", " + therapist.state) +
    (therapist.practice_name ? " · " + escapeHtml(therapist.practice_name) : "") +
    '</p></div><div class="portal-badges"><span class="portal-badge">' +
    escapeHtml(claimStatus) +
    '</span><span class="portal-badge">' +
    escapeHtml(readiness.label + " · " + readiness.score + "/100") +
    "</span></div></section>" +
    notYetPublicBanner +
    welcomeUpsellBanner +
    (sessionMode === "claim_token"
      ? '<section class="portal-card" style="margin-bottom:1rem"><h2>Verify claim</h2><p class="portal-subtle">This secure link matched the public profile email. Confirm the claim to unlock lightweight self-serve management for this profile.</p><div class="portal-actions"><button class="btn-primary" id="acceptClaimButton" type="button">Claim this profile</button><div class="portal-feedback" id="claimAcceptFeedback"></div></div></section>'
      : "") +
    (verifiedClaim ? buildEditProfileHtml(therapist) : "") +
    '<section class="portal-grid">' +
    '<article class="portal-card"><h2>Profile status</h2><div class="portal-list">' +
    "<div><strong>Live listing:</strong> " +
    escapeHtml(
      therapist.listing_active === false
        ? "Paused (hidden from directory)"
        : therapist.status === "active"
          ? "Live"
          : therapist.status
            ? therapist.status.charAt(0).toUpperCase() + therapist.status.slice(1)
            : "Not yet published",
    ) +
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
    '</div></div><div class="portal-actions"><a class="btn-secondary" href="claim.html?confirm=' +
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
    '<article class="portal-card"><h2>Recommended next step</h2><div class="portal-list"><div><strong>' +
    escapeHtml(nextAction.title) +
    "</strong></div><div>" +
    escapeHtml(nextAction.body) +
    "</div></div>" +
    (nextAction.href && nextAction.ctaLabel
      ? '<div class="portal-actions" style="margin-top:0.85rem"><a class="btn-primary" href="' +
        escapeHtml(nextAction.href) +
        '">' +
        escapeHtml(nextAction.ctaLabel) +
        "</a></div>"
      : "") +
    "</article>" +
    (progress
      ? '<article class="portal-card"><h2>Your progress</h2><div class="portal-list"><div><strong>Current status:</strong> ' +
        escapeHtml(progress.statusLabel) +
        "</div><div><strong>Next step:</strong> " +
        escapeHtml(progress.nextStep) +
        '</div></div><div class="portal-list" style="margin-top:0.85rem">' +
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
        "</div></article>"
      : "") +
    (profileCoaching
      ? '<article class="portal-card"><h2>What Will Strengthen Your Profile</h2><div class="portal-list"><div><strong>Current readiness:</strong> ' +
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
        "</div></article>"
      : "") +
    (portalTimeline.length
      ? '<article class="portal-card"><h2>Recent Progress</h2><div class="portal-list">' +
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
        "</div></article>"
      : "") +
    (expectations
      ? '<article class="portal-card"><h2>What To Expect Next</h2><div class="portal-list"><div><strong>' +
        escapeHtml(expectations.headline) +
        "</strong></div><div>" +
        escapeHtml(expectations.body) +
        "</div></div></article>"
      : "") +
    (urgency
      ? '<article class="portal-card"><h2>Priority Signal</h2><div class="portal-list"><div><strong>' +
        escapeHtml(urgency.label) +
        "</strong></div><div>" +
        escapeHtml(urgency.body) +
        "</div></div></article>"
      : "") +
    (reviewReadinessSignal
      ? '<article class="portal-card"><h2>Review Readiness Signal</h2><div class="portal-list"><div><strong>' +
        escapeHtml(reviewReadinessSignal.label) +
        "</strong></div><div>" +
        escapeHtml(reviewReadinessSignal.body) +
        "</div></div></article>"
      : "") +
    (reviewTiming
      ? '<article class="portal-card"><h2>Review Timing</h2><div class="portal-list"><div><strong>' +
        escapeHtml(reviewTiming.label) +
        "</strong></div><div>" +
        escapeHtml(reviewTiming.body) +
        "</div></div></article>"
      : "") +
    (reviewerFeedback
      ? '<article class="portal-card"><h2>Reviewer Feedback</h2><div class="portal-list">' +
        (reviewerFeedback.requestedAt
          ? "<div><strong>Requested:</strong> " +
            escapeHtml(formatDate(reviewerFeedback.requestedAt) || "Recently") +
            "</div>"
          : "") +
        "<div>" +
        escapeHtml(reviewerFeedback.message) +
        "</div></div></article>"
      : "") +
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
    (verifiedClaim
      ? '<article class="portal-card" id="portalAnalyticsCard"><h2>This week at a glance</h2><p class="portal-subtle" id="portalAnalyticsBody">Loading your profile activity...</p><div id="portalAnalyticsGrid" hidden></div></article>'
      : "") +
    (verifiedClaim
      ? '<article class="portal-card" id="portalFeaturedCard" data-therapist-slug="' +
        escapeHtml(therapist.slug) +
        '" data-therapist-email="' +
        escapeHtml(claimedEmail) +
        '"><h2>Your subscription</h2><p class="portal-subtle" id="portalFeaturedBody">Checking your subscription status...</p><div class="portal-actions" id="portalFeaturedActions"></div><div class="portal-feedback" id="portalFeaturedFeedback"></div></article>'
      : "") +
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

  if (verifiedClaim) {
    wireEditProfileHandlers(therapist);
    loadAnalyticsIntoPortal();
    loadSubscriptionIntoFeaturedCard();
  } else if (sessionMode === "claim_token") {
    // Still reveal the welcome-upsell banner on the unverified claim-token
    // state. The magic-link arrival is itself proof of ownership, so there's
    // no reason to hide the upgrade CTA behind the ceremonial "Claim this
    // profile" button — especially when that button can get stuck on
    // replayed / used tokens and leave the user with no way forward.
    renderPortalWelcomeUpsell(null, therapist.slug || slug, therapist.email || "");
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
