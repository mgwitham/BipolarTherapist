import "./funnel-analytics.js";
import { fetchPublicTherapistBySlug } from "./cms.js";
import { getTherapistMatchReadiness } from "./matching-model.js";
import { getApplications } from "./store.js";
import {
  acceptTherapistClaim,
  createStripeBillingPortalSession,
  fetchTherapistClaimSession,
  fetchTherapistSubscription,
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
    return "signup.html?confirm=" + encodeURIComponent(targetSlug) + focusSuffix;
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

function describeFeaturedStatus(subscription) {
  if (!subscription || subscription.plan === "none" || !subscription.status) {
    return "You're on the free listing. Upgrade to Featured to get a badge and priority placement in match results.";
  }
  if (subscription.has_active_featured) {
    var endDate = formatDate(subscription.current_period_ends_at);
    if (subscription.status === "trialing") {
      var trialEnd = formatDate(subscription.trial_ends_at);
      return (
        "Featured is active (free trial)." +
        (trialEnd ? " Trial ends " + trialEnd + "." : "") +
        " Card on file will be charged when the trial ends."
      );
    }
    if (subscription.cancel_at_period_end) {
      return (
        "Featured is active but set to end" +
        (endDate ? " on " + endDate : "") +
        ". You can resume anytime from billing."
      );
    }
    return "Featured is active." + (endDate ? " Renews " + endDate + "." : "");
  }
  if (subscription.status === "past_due" || subscription.status === "unpaid") {
    return "Featured billing needs attention. Open billing to fix your payment method.";
  }
  return "Featured is inactive. Upgrade again to restore your badge and priority placement.";
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
      '<button class="btn-primary" type="button" id="portalFeaturedUpgradeButton">Upgrade to Featured</button>';
  }
  if (hasCustomer) {
    buttons +=
      '<button class="btn-secondary" type="button" id="portalFeaturedBillingButton">Manage billing</button>';
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
      return_path: "/portal.html",
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

async function loadSubscriptionIntoFeaturedCard() {
  if (!document.getElementById("portalFeaturedCard")) {
    return;
  }
  try {
    var result = await fetchTherapistSubscription();
    renderFeaturedCard((result && result.subscription) || null);
  } catch (_error) {
    var body = document.getElementById("portalFeaturedBody");
    if (body) {
      body.textContent = "Featured status is unavailable right now. Refresh to try again.";
    }
  }
}

function renderStripeReturnBanner() {
  var params = new URLSearchParams(window.location.search);
  var state = params.get("stripe");
  if (!state) {
    return;
  }
  var shell = document.getElementById("portalShell");
  if (!shell) {
    return;
  }
  var message =
    state === "success"
      ? "Checkout complete. Featured placement activates within a minute of Stripe confirming the subscription."
      : state === "cancel"
        ? "Checkout canceled. No charge was made. You can try again anytime."
        : "";
  if (!message) {
    return;
  }
  shell.insertAdjacentHTML(
    "afterbegin",
    '<section class="portal-card" style="margin-bottom:1rem"><p class="portal-subtle">' +
      escapeHtml(message) +
      "</p></section>",
  );
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
      ? '<article class="portal-card" id="portalFeaturedCard" data-therapist-slug="' +
        escapeHtml(therapist.slug) +
        '" data-therapist-email="' +
        escapeHtml(claimedEmail) +
        '"><h2>Featured placement</h2><p class="portal-subtle" id="portalFeaturedBody">Checking your featured status...</p><div class="portal-actions" id="portalFeaturedActions"></div><div class="portal-feedback" id="portalFeaturedFeedback"></div></article>'
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
    loadSubscriptionIntoFeaturedCard();
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
}

(async function init() {
  renderStripeReturnBanner();

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
