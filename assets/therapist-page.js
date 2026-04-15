import { fetchPublicTherapistBySlug, fetchPublicTherapists } from "./cms.js";
import {
  getDataFreshnessSummary,
  getEditoriallyVerifiedOperationalCount,
  getOperationalTrustSummary,
  getRecentAppliedSummary,
  getRecentConfirmationSummary,
  getTherapistMatchReadiness,
} from "./matching-model.js";
import {
  getPublicResponsivenessSignal,
  summarizeTherapistContactRouteOutcomes,
} from "./responsiveness-signal.js";
import {
  getExperimentVariant,
  readFunnelEvents,
  rememberTherapistContactRoute,
  summarizeProfileBackupSignals,
  summarizeTherapistContactRoutePerformance,
  trackExperimentExposure,
  trackFunnelEvent,
} from "./funnel-analytics.js";
import { isBookingRouteHealthy, isWebsiteRouteHealthy } from "./route-health.js";
import { renderValuePillRow, initValuePillPopover } from "./therapist-pills.js";

var profileParams = new URLSearchParams(window.location.search);
var slug = profileParams.get("slug");
var profileSource = profileParams.get("source") || "";
var DIRECTORY_SHORTLIST_KEY = "bth_directory_shortlist_v1";
var OUTREACH_OUTCOMES_KEY = "bth_outreach_outcomes_v1";
var DIRECTORY_LIST_LIMIT = 6;
var SHORTLIST_PRIORITY_OPTIONS = ["Best fit", "Best availability", "Best value"];
var activeTherapistContactExperimentVariant = "control";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCompactTagList(items, className, limit, overflowLabel) {
  var safeItems = (items || []).filter(Boolean);
  var visibleItems = safeItems.slice(0, limit || safeItems.length);
  var hiddenCount = Math.max(0, safeItems.length - visibleItems.length);

  return (
    visibleItems
      .map(function (item) {
        return '<span class="' + className + '">' + escapeHtml(item) + "</span>";
      })
      .join("") +
    (hiddenCount
      ? '<span class="' +
        className +
        " " +
        className +
        '-overflow">+' +
        hiddenCount +
        " more" +
        (overflowLabel ? " " + escapeHtml(overflowLabel) : "") +
        "</span>"
      : "")
  );
}

function renderList(items, className) {
  return (items || [])
    .filter(Boolean)
    .map(function (item) {
      return '<div class="' + className + '">' + escapeHtml(item) + "</div>";
    })
    .join("");
}

function joinNaturalList(items) {
  var safeItems = (items || []).filter(Boolean);
  if (!safeItems.length) {
    return "";
  }
  if (safeItems.length === 1) {
    return safeItems[0];
  }
  if (safeItems.length === 2) {
    return safeItems[0] + " and " + safeItems[1];
  }
  return safeItems.slice(0, -1).join(", ") + ", and " + safeItems[safeItems.length - 1];
}

function formatSourceDate(value) {
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

function getProminentFreshnessSignal(therapist, recentApplied, recentConfirmation, freshness) {
  if (recentApplied) {
    return {
      label: recentApplied.short_label || recentApplied.label,
      note: recentApplied.note,
      tone: "fresh",
    };
  }
  if (recentConfirmation) {
    return {
      label: recentConfirmation.short_label || recentConfirmation.label,
      note: recentConfirmation.note,
      tone: recentConfirmation.tone === "fresh" ? "fresh" : "recent",
    };
  }
  if (freshness) {
    return {
      label: freshness.label,
      note: freshness.note,
      tone: freshness.status === "fresh" ? "fresh" : "stale",
    };
  }
  return null;
}

function getSourceHostLabel(value) {
  if (!value) {
    return "";
  }

  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch (_error) {
    return "";
  }
}

function buildProfileEntryState(source, therapist, backupState) {
  var value = String(source || "").trim();
  if (!value) {
    return {
      kicker: "Profile handoff",
      title: "Use this profile to make a stronger first-pass decision.",
      copy: "This page is built to help you decide quickly whether to contact now, save for later, or keep comparing without reopening the whole directory.",
      cards: [
        {
          label: "What to do here",
          value:
            "Check fit, trust, and logistics before you decide whether this is your first outreach.",
        },
        {
          label: "If it does not fit",
          value:
            "Return to your list or compare the backup path instead of restarting the whole search.",
        },
      ],
    };
  }

  if (value === "preview") {
    return {
      kicker: "Recommended profile handoff",
      title: "This profile was surfaced as one of the strongest places to open first.",
      copy: "Use this screen to confirm whether the recommendation still feels right once you see the trust, logistics, and outreach details together.",
      cards: [
        {
          label: "What to confirm fast",
          value:
            "Does the trust and logistics detail here support contacting this therapist before the rest of the list?",
        },
        {
          label: "If it still fits",
          value: "Move into the recommended outreach path instead of going back to broad browsing.",
        },
      ],
    };
  }

  if (value === "card_profile" || value === "card_primary") {
    return {
      kicker: "Directory handoff",
      title: "You moved from a saved card into the full profile.",
      copy: "This is the point where a promising listing becomes a real decision. The sections below are organized to help you validate the card’s promise quickly.",
      cards: [
        {
          label: "What should get clearer",
          value:
            "Why this therapist may fit, how credible the profile feels, and what the first outreach should look like.",
        },
        {
          label: "If the promise breaks",
          value:
            "Use the list and backup tools here to keep momentum instead of reopening the whole directory.",
        },
      ],
    };
  }

  if (value === "profile_backup") {
    return {
      kicker: "Backup handoff",
      title: "You are reviewing the backup option in case the first path stalls.",
      copy: "Treat this page like a pivot screen: decide whether this is a credible second move before you widen the search any further.",
      cards: [
        {
          label: "What matters most",
          value:
            "Look for enough trust and practical clarity to justify opening the backup route if timing or fit breaks on the first option.",
        },
        {
          label: "If this works better",
          value:
            "Use the contact rail to switch momentum here instead of holding two uncertain paths in your head.",
        },
      ],
    };
  }

  return {
    kicker: "Profile handoff",
    title: "Use this profile to make a stronger first-pass decision.",
    copy: "This page is built to help you decide quickly whether to contact now, save for later, or keep comparing without reopening the whole directory.",
    cards: [
      {
        label: "What to do here",
        value:
          "Check fit, trust, and logistics before you decide whether this is your first outreach.",
      },
      {
        label: "If it does not fit",
        value:
          backupState && backupState.backup
            ? "Review the backup path before widening your search."
            : "Return to your list and keep the strongest backup in reserve.",
      },
    ],
  };
}

function buildCallScript(therapist) {
  var formatLine = "";
  if (therapist.accepts_telehealth && therapist.accepts_in_person) {
    formatLine = "Either telehealth or in-person would work for me.";
  } else if (therapist.accepts_telehealth) {
    formatLine = "I'm hoping for telehealth if that's available.";
  } else if (therapist.accepts_in_person) {
    formatLine = "I'm hoping for in-person care if that's available.";
  }
  var medicationLine = therapist.medication_management
    ? "Medication support or coordination may also be part of the picture."
    : "";
  var insuranceLine =
    therapist.insurance_accepted && therapist.insurance_accepted.length
      ? "I'd also love to confirm insurance or fee details before going further."
      : "I'd also love to briefly confirm fees or payment options.";

  var liveOpener =
    "Hi, my name is [your name]. I found your profile on BipolarTherapyHub and I'm looking for a therapist who works with bipolar disorder. Are you currently taking new clients?";

  var liveContextParts = [formatLine, medicationLine, insuranceLine].filter(Boolean);
  var liveContext = liveContextParts.length ? "If they are: " + liveContextParts.join(" ") : "";

  var voicemail =
    "Hi, my name is [your name] and my number is [your number]. I found your profile on BipolarTherapyHub and I'm looking for a therapist experienced with bipolar disorder. Please give me a call back when you have a moment. Thank you so much.";

  return {
    liveOpener: liveOpener,
    liveContext: liveContext,
    voicemail: voicemail,
  };
}

function buildOutreachScript(therapist, contactStrategy) {
  var route = contactStrategy && contactStrategy.route ? contactStrategy.route : "profile";

  var greeting = "Hi,";

  var intro =
    "I found your profile on BipolarTherapyHub and wanted to see if you might be a good fit for bipolar-focused support.";

  var contextParts = [];
  if (therapist.accepts_telehealth && therapist.accepts_in_person) {
    contextParts.push("I'm open to either telehealth or in-person care");
  } else if (therapist.accepts_telehealth) {
    contextParts.push("I'm hoping for telehealth");
  } else if (therapist.accepts_in_person) {
    contextParts.push("I'm hoping for in-person care");
  }
  if (therapist.medication_management) {
    contextParts.push("medication support or coordination may also be part of the picture");
  }
  if (therapist.insurance_accepted && therapist.insurance_accepted.length) {
    contextParts.push("and I'd love to confirm insurance or cost details before going further");
  }
  var contextLine = contextParts.length
    ? contextParts.join(", ").replace(/, and /g, " and ") + "."
    : "";
  if (contextLine) {
    contextLine = contextLine.charAt(0).toUpperCase() + contextLine.slice(1);
  }

  var questions = ["Are you currently taking new clients?"];
  if (therapist.accepts_telehealth && therapist.accepts_in_person) {
    questions.push("Would you recommend starting with telehealth or in-person care?");
  } else if (therapist.accepts_telehealth) {
    questions.push("Are you offering telehealth openings right now?");
  } else if (therapist.accepts_in_person) {
    questions.push("Are you offering in-person openings right now?");
  }
  if (therapist.insurance_accepted && therapist.insurance_accepted.length) {
    questions.push(
      "Anything I should know about insurance, fees, or out-of-pocket costs before scheduling?",
    );
  }
  var closingQuestion;
  if (route === "booking") {
    closingQuestion = "If it seems like a fit, is the booking link the best place to start?";
  } else if (route === "email") {
    closingQuestion = "If it seems like a fit, is email the best way to begin?";
  } else if (route === "phone") {
    closingQuestion = "If it seems like a fit, is a phone call still the best way to begin?";
  } else if (route === "website") {
    closingQuestion =
      "If it seems like a fit, is the website inquiry form the best place to start?";
  } else {
    closingQuestion = "If it seems like a fit, what's the best first step?";
  }
  questions.push(closingQuestion);

  var questionsBlock =
    "A few quick questions:\n\n" +
    questions
      .map(function (q) {
        return "• " + q;
      })
      .join("\n\n");

  var closing = "Thanks so much,";

  return [greeting, intro, contextLine, questionsBlock, closing].filter(Boolean).join("\n\n");
}

function getFirstMeaningfulSentence(value) {
  var text = String(value || "").trim();
  if (!text) {
    return "";
  }
  var match = text.match(/^.*?[.!?](?:\s|$)/);
  return match ? match[0].trim() : text;
}

function getContactStrategy(
  therapist,
  responsivenessSignal,
  routePerformance,
  routeOutcomePerformance,
) {
  var bookingHealthy = isBookingRouteHealthy(therapist);
  var websiteHealthy = isWebsiteRouteHealthy(therapist);
  var suppressedRouteNote = "";
  if (therapist.booking_url && !bookingHealthy && therapist.website && !websiteHealthy) {
    suppressedRouteNote =
      " The booking link and website both look unavailable right now, so a direct route is safer.";
  } else if (therapist.booking_url && !bookingHealthy) {
    suppressedRouteNote =
      " The booking link looks unavailable right now, so a different contact route is safer.";
  } else if (therapist.website && !websiteHealthy) {
    suppressedRouteNote =
      " The website looks unavailable right now, so a different contact route is safer.";
  }
  var route = "profile";
  var routeLabel = "Use the clearest listed contact path";
  var routeReason = websiteHealthy
    ? "The clearest contact path on this profile is the best place to start."
    : "A direct contact route is a safer starting point than the website on this profile.";

  if (therapist.preferred_contact_method === "booking" && therapist.booking_url && bookingHealthy) {
    route = "booking";
    routeLabel = "Use the booking link first";
    routeReason = "A booking link usually gives the fastest path to a consult or intake.";
  } else if (therapist.preferred_contact_method === "phone" && therapist.phone) {
    route = "phone";
    routeLabel = "Call the practice first";
    routeReason =
      "Phone is marked as the preferred route, so it is the best shot for a quick response.";
  } else if (therapist.preferred_contact_method === "email" && therapist.email) {
    route = "email";
    routeLabel = "Email first";
    routeReason = "Email is the clearest documented route for a direct first message.";
  } else if (
    therapist.preferred_contact_method === "website" &&
    therapist.website &&
    websiteHealthy
  ) {
    route = "website";
    routeLabel = "Use the practice website first";
    routeReason = "The profile points to the website as the preferred contact path.";
  } else if (therapist.booking_url && bookingHealthy) {
    route = "booking";
    routeLabel = "Use the booking link first";
    routeReason = "The booking link creates the most executable next step on this profile.";
  } else if (therapist.phone) {
    route = "phone";
    routeLabel = "Call the practice first";
    routeReason = "Phone is the most direct route available on this profile.";
  } else if (therapist.email && therapist.email !== "contact@example.com") {
    route = "email";
    routeLabel = "Email first";
    routeReason = "Email is the cleanest direct route available on this profile.";
  }

  var outcomeRoute =
    routeOutcomePerformance &&
    routeOutcomePerformance.top_route &&
    routeOutcomePerformance.confidence !== "none" &&
    routeOutcomePerformance.top_route.route &&
    routeOutcomePerformance.top_route.route !== "unknown"
      ? routeOutcomePerformance.top_route.route
      : "";
  var performanceRoute =
    routePerformance &&
    routePerformance.top_route &&
    routePerformance.confidence !== "none" &&
    routePerformance.top_route.route &&
    routePerformance.top_route.route !== "unknown"
      ? routePerformance.top_route.route
      : "";
  var performanceRouteAvailable =
    (performanceRoute === "booking" && therapist.booking_url && bookingHealthy) ||
    (performanceRoute === "website" && therapist.website && websiteHealthy) ||
    (performanceRoute === "phone" && therapist.phone) ||
    (performanceRoute === "email" && therapist.email && therapist.email !== "contact@example.com");

  var outcomeRouteAvailable =
    (outcomeRoute === "booking" && therapist.booking_url && bookingHealthy) ||
    (outcomeRoute === "website" && therapist.website && websiteHealthy) ||
    (outcomeRoute === "phone" && therapist.phone) ||
    (outcomeRoute === "email" && therapist.email && therapist.email !== "contact@example.com");

  if (outcomeRoute && outcomeRouteAvailable && outcomeRoute !== route) {
    route = outcomeRoute;
    routeLabel =
      route === "booking"
        ? "Use the booking link first"
        : route === "phone"
          ? "Call the practice first"
          : route === "email"
            ? "Email first"
            : "Use the practice website first";
    routeReason =
      routeOutcomePerformance.confidence === "strong"
        ? "Past outreach outcomes most strongly point to this route as the one most likely to lead somewhere useful."
        : "Past outreach outcomes lean toward this route over the other options so far.";
  } else if (performanceRoute && performanceRouteAvailable && performanceRoute !== route) {
    route = performanceRoute;
    routeLabel =
      route === "booking"
        ? "Use the booking link first"
        : route === "phone"
          ? "Call the practice first"
          : route === "email"
            ? "Email first"
            : "Use the practice website first";
    routeReason =
      routePerformance.confidence === "strong"
        ? "Real profile behavior most clearly points to this route as the one users choose first."
        : "Observed profile behavior leans toward this route over the other contact options so far.";
  } else if (routeOutcomePerformance && routeOutcomePerformance.note) {
    routeReason =
      routeOutcomePerformance.confidence === "light"
        ? routeReason + " " + routeOutcomePerformance.note
        : routeReason;
  } else if (routePerformance && routePerformance.note) {
    routeReason =
      routePerformance.confidence === "light"
        ? routeReason + " " + routePerformance.note
        : routeReason;
  }

  var replyWindowCopy = therapist.estimated_wait_time
    ? "Expect the first useful answer to clarify whether timing is still around " +
      therapist.estimated_wait_time +
      "."
    : therapist.accepting_new_patients
      ? "If this profile is current, you should expect a reply that clarifies intake timing rather than leaving you guessing."
      : responsivenessSignal && responsivenessSignal.tone === "positive"
        ? "Public follow-through looks better than usual here, so a reply may still be worth waiting for briefly."
        : "Treat reply timing as uncertain and use a faster backup plan if you hear nothing.";

  if (responsivenessSignal && responsivenessSignal.tone === "positive") {
    replyWindowCopy += " Early reply follow-through also looks better than usual here.";
  }

  var followUpCopy =
    route === "phone"
      ? "If you reach voicemail, leave one concise message and try one more call in 2 to 3 business days."
      : route === "booking"
        ? "If the booking link does not lead to a real opening, switch to phone or email within 1 to 2 business days."
        : route === "email"
          ? "If there is no response after 2 business days, send one short follow-up and then move to the next route."
          : "If you do not hear back after 2 to 3 business days, follow up once or switch to a more direct route.";

  var backupPlanCopy =
    therapist.phone && route !== "phone"
      ? "If this stalls, call the practice next and ask whether they are still taking new bipolar-care inquiries."
      : therapist.email && therapist.email !== "contact@example.com" && route !== "email"
        ? "If this stalls, send a short email with your fit question and availability question together."
        : therapist.website && websiteHealthy && route !== "website"
          ? "If this stalls, use the website contact form as a second route before moving on."
          : "If this stalls after one follow-up, move on to your next saved option instead of waiting indefinitely.";

  var confidenceLabel = "Based on profile details";
  var confidenceNote =
    "This recommendation is based on the contact routes and practical details listed on the profile.";
  var confidenceTone = "profile";
  var proofLine = "";

  if (outcomeRoute && outcomeRouteAvailable) {
    confidenceLabel =
      routeOutcomePerformance.confidence === "strong"
        ? "Based on real outcomes"
        : "Leaning on early outcomes";
    confidenceNote = routeOutcomePerformance.note
      ? routeOutcomePerformance.note
      : "This recommendation is informed by past replies or consult outcomes tied to this therapist.";
    confidenceTone = "outcomes";
  } else if (performanceRoute && performanceRouteAvailable) {
    confidenceLabel =
      routePerformance.confidence === "strong"
        ? "Based on observed behavior"
        : "Leaning on observed behavior";
    confidenceNote = routePerformance.note
      ? routePerformance.note
      : "This recommendation is informed by the contact route people are choosing most on this profile.";
    confidenceTone = "behavior";
  }

  if (route === "booking" && therapist.booking_url) {
    proofLine = therapist.accepting_new_patients
      ? "Why this route: there is a live booking path and the profile indicates they are accepting new patients."
      : "Why this route: there is a live booking path, which is still the most direct way to test current openings.";
  } else if (
    route === "phone" &&
    responsivenessSignal &&
    responsivenessSignal.tone === "positive"
  ) {
    proofLine =
      "Why this route: early reply follow-through looks better than usual here, so a direct call is worth trying first.";
  } else if (route === "phone" && therapist.preferred_contact_method === "phone") {
    proofLine =
      "Why this route: the profile explicitly marks phone as the preferred contact method.";
  } else if (route === "email" && therapist.preferred_contact_method === "email") {
    proofLine =
      "Why this route: the profile explicitly marks email as the preferred first-contact path.";
  } else if (route === "website" && therapist.preferred_contact_method === "website") {
    proofLine =
      "Why this route: the profile points to the website as the intended first step for inquiries.";
  } else if (therapist.estimated_wait_time) {
    proofLine =
      "Why this route: the profile includes a recent timing note of " +
      therapist.estimated_wait_time +
      ", so this is the fastest way to confirm whether that is still current.";
  } else if (therapist.accepting_new_patients) {
    proofLine =
      "Why this route: the profile says they are accepting new patients, so this route is the clearest way to verify the next opening.";
  } else if (routeOutcomePerformance && routeOutcomePerformance.note) {
    proofLine = "Why this route: " + routeOutcomePerformance.note;
  } else if (routePerformance && routePerformance.note) {
    proofLine = "Why this route: " + routePerformance.note;
  } else {
    proofLine =
      "Why this route: it is the clearest documented way to confirm fit, timing, and next steps on this profile.";
  }

  if (suppressedRouteNote) {
    routeReason += suppressedRouteNote;
  }

  return {
    route: route,
    routeLabel: routeLabel,
    routeReason: routeReason,
    proofLine: proofLine,
    replyWindowCopy: replyWindowCopy,
    followUpCopy: followUpCopy,
    backupPlanCopy: backupPlanCopy,
    timingTone:
      therapist.accepting_new_patients || therapist.estimated_wait_time ? "green" : "teal",
    confidenceLabel: confidenceLabel,
    confidenceNote: confidenceNote,
    confidenceTone: confidenceTone,
    performanceConfidence:
      routePerformance && routePerformance.confidence ? routePerformance.confidence : "none",
    performanceNote: routePerformance && routePerformance.note ? routePerformance.note : "",
    outcomeConfidence:
      routeOutcomePerformance && routeOutcomePerformance.confidence
        ? routeOutcomePerformance.confidence
        : "none",
    outcomeNote:
      routeOutcomePerformance && routeOutcomePerformance.note ? routeOutcomePerformance.note : "",
  };
}

function getContactAnalyticsMeta(therapist, route) {
  return {
    therapist_slug: therapist.slug || "",
    preferred_contact_method: therapist.preferred_contact_method || "unknown",
    route: route || "unknown",
    accepting_new_patients: Boolean(therapist.accepting_new_patients),
    has_wait_time: Boolean(therapist.estimated_wait_time),
    has_fee_details: Boolean(
      therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale,
    ),
    has_insurance_details: Boolean(
      therapist.insurance_accepted && therapist.insurance_accepted.length,
    ),
    experiments: {
      therapist_contact_guidance: activeTherapistContactExperimentVariant,
    },
  };
}

function getContactTimingGuidance(contactStrategy) {
  if (!contactStrategy) {
    return {
      title: "Review before deciding on contact.",
      copy: "Use the full profile to decide whether this should become a lead route or stay in reserve.",
    };
  }

  if (contactStrategy.confidenceTone === "outcomes") {
    return {
      title: "Strong enough to move toward outreach now.",
      copy: "Past outcomes are doing real work here, so this profile looks more ready for first contact after a quick final review.",
    };
  }

  if (contactStrategy.confidenceTone === "behavior") {
    return {
      title: "Open now, then decide on first contact.",
      copy: "Observed route behavior suggests this is close to outreach-ready, but the full profile should still confirm whether it deserves the lead spot.",
    };
  }

  return {
    title: "Pressure-test fit first, then choose whether to contact.",
    copy: "The route looks usable on profile details alone, but this still works best as a review-first decision before you spend energy reaching out.",
  };
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function getDecisionTone(score) {
  if (score >= 80) {
    return "strong";
  }
  if (score >= 60) {
    return "steady";
  }
  return "watch";
}

function getDecisionLabel(score) {
  if (score >= 80) {
    return "Strong";
  }
  if (score >= 60) {
    return "Solid";
  }
  return "Needs confirmation";
}

function buildProfileDecisionSystem(options) {
  var therapist = options.therapist || {};
  var readiness = options.readiness || { score: 0 };
  var freshness = options.freshness || { status: "" };
  var therapistReportedFields = Array.isArray(options.therapistReportedFields)
    ? options.therapistReportedFields
    : [];
  var responsivenessSignal = options.responsivenessSignal || null;
  var contactStrategy = options.contactStrategy || null;
  var sourceReviewedDate = options.sourceReviewedDate || "";
  var bipolarExperience = Number(therapist.bipolar_years_experience || 0);
  var explicitBipolarFocus =
    (therapist.specialties || []).includes("Bipolar I") ||
    (therapist.specialties || []).includes("Bipolar II");
  var hasFees = Boolean(
    therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale,
  );
  var hasInsurance = Boolean(therapist.insurance_accepted && therapist.insurance_accepted.length);
  var hasFormat = Boolean(therapist.accepts_telehealth || therapist.accepts_in_person);
  var fitScore =
    (explicitBipolarFocus ? 26 : therapist.specialties && therapist.specialties.length ? 14 : 0) +
    (bipolarExperience >= 8 ? 34 : bipolarExperience >= 3 ? 24 : bipolarExperience ? 14 : 0) +
    ((therapist.client_populations || []).length ? 12 : 0) +
    ((therapist.treatment_modalities || []).length ? 10 : 0) +
    (therapist.medication_management ? 16 : 0);
  var trustScore =
    (therapist.verification_status === "editorially_verified" ? 32 : 14) +
    (sourceReviewedDate ? 18 : 0) +
    (therapistReportedFields.length ? 18 : 0) +
    (freshness.status === "fresh" ? 18 : freshness.status ? 10 : 4) +
    (readiness.score >= 85 ? 14 : readiness.score >= 65 ? 8 : 2);
  var accessScore =
    (therapist.accepting_new_patients ? 24 : 10) +
    (therapist.estimated_wait_time ? 18 : 4) +
    (hasFormat ? 16 : 4) +
    (hasInsurance ? 18 : 0) +
    (hasFees ? 16 : 0) +
    ((therapist.languages || []).length ? 8 : 0);
  var actionScore =
    (contactStrategy && contactStrategy.routeLabel ? 26 : 8) +
    (contactStrategy && contactStrategy.confidenceTone === "outcomes"
      ? 26
      : contactStrategy && contactStrategy.confidenceTone === "behavior"
        ? 18
        : 10) +
    (responsivenessSignal && responsivenessSignal.tone === "positive" ? 20 : 10) +
    (therapist.preferred_contact_method ? 12 : 6) +
    (therapist.phone || therapist.email || therapist.website || therapist.booking_url ? 16 : 0);

  fitScore = clampScore(fitScore);
  trustScore = clampScore(trustScore);
  accessScore = clampScore(accessScore);
  actionScore = clampScore(actionScore);

  var overallScore = clampScore((fitScore + trustScore + accessScore + actionScore) / 4);
  var stanceLabel =
    overallScore >= 82
      ? "Ready to contact"
      : overallScore >= 68
        ? "Strong list candidate"
        : overallScore >= 52
          ? "Worth one focused message"
          : "Keep as a backup path";
  var stanceCopy =
    overallScore >= 82
      ? "The fit, trust, logistics, and contact signals are aligned well enough that this can be treated like a real lead instead of just another open tab."
      : overallScore >= 68
        ? "This profile is carrying enough signal to deserve a spot on your list, but you should still confirm one or two practical details before making it your only next move."
        : overallScore >= 52
          ? "The profile is usable, but the smartest move is a short message aimed at the biggest unknowns rather than a full commitment."
          : "There may still be a fit here, but operational uncertainty is high enough that this works best as a reserve option unless the specialty match is unusually strong.";

  var bestFor = [];
  if (explicitBipolarFocus || bipolarExperience >= 3) {
    bestFor.push("People who want clearly documented bipolar-spectrum experience up front.");
  }
  if (therapist.medication_management) {
    bestFor.push(
      "Anyone who may want medication support or psychiatry coordination in the same path.",
    );
  }
  if (therapist.accepts_telehealth && therapist.accepts_in_person) {
    bestFor.push("People who want flexibility between telehealth and in-person care.");
  } else if (therapist.accepts_telehealth) {
    bestFor.push("People who prefer telehealth or broader location flexibility.");
  } else if (therapist.accepts_in_person) {
    bestFor.push("People who want an in-person care option.");
  }
  if ((therapist.client_populations || []).length) {
    bestFor.push(
      "People looking for support tailored to " +
        String(therapist.client_populations[0] || "").toLowerCase() +
        ".",
    );
  }
  if (!bestFor.length) {
    bestFor.push(
      "People who are open to confirming fit directly rather than requiring every answer on-page first.",
    );
  }

  var confirmFirst = [];
  if (!therapist.accepting_new_patients || !therapist.estimated_wait_time) {
    confirmFirst.push("Current opening timeline and whether they are actively taking new clients.");
  }
  if (!hasInsurance || !hasFees) {
    confirmFirst.push(
      "What your real cost path looks like, including insurance, superbills, or sliding scale.",
    );
  }
  if (!therapistReportedFields.length && freshness.status !== "fresh") {
    confirmFirst.push("How current the practical details still are before you rely on them.");
  }
  if (!confirmFirst.length) {
    confirmFirst.push(
      "Personal fit and chemistry, since the operational basics are already more visible than average.",
    );
  }

  var managementTitle =
    overallScore >= 82
      ? "Treat this like a lead"
      : overallScore >= 68
        ? "Save and rank it"
        : "Keep it organized";
  var managementCopy =
    overallScore >= 82
      ? "Label it, leave one sentence about why it stands out, and move it into outreach instead of re-reviewing it later."
      : overallScore >= 68
        ? "Save it with a priority label so you can compare it against one backup without losing your reasoning."
        : "Use the list note to capture the one thing that keeps this profile alive, then compare it against stronger operational options.";

  return {
    overallScore: overallScore,
    scoreLabel: getDecisionLabel(overallScore),
    stanceLabel: stanceLabel,
    stanceCopy: stanceCopy,
    tone: getDecisionTone(overallScore),
    dimensions: [
      {
        label: "Clinical fit",
        score: fitScore,
        tone: getDecisionTone(fitScore),
        summary:
          fitScore >= 80
            ? "The specialty signal is strong enough to justify real attention."
            : fitScore >= 60
              ? "There is a credible fit story here, but it is not airtight."
              : "The fit signal is still more implied than proven.",
      },
      {
        label: "Trust signal",
        score: trustScore,
        tone: getDecisionTone(trustScore),
        summary:
          trustScore >= 80
            ? "Verification and freshness reduce trust drag meaningfully."
            : trustScore >= 60
              ? "There is enough trust to proceed, with a little confirmation."
              : "Trust is usable, but it still leans on your own validation work.",
      },
      {
        label: "Access clarity",
        score: accessScore,
        tone: getDecisionTone(accessScore),
        summary:
          accessScore >= 80
            ? "Timing, format, and cost are more visible than usual."
            : accessScore >= 60
              ? "Key logistics are partly visible, but not fully settled."
              : "Too much of the real-world access path still needs confirmation.",
      },
      {
        label: "Action readiness",
        score: actionScore,
        tone: getDecisionTone(actionScore),
        summary:
          actionScore >= 80
            ? "There is a clean first move and a clear fallback if it stalls."
            : actionScore >= 60
              ? "You can act here without much confusion."
              : "The page still needs a more deliberate outreach choice to avoid drift.",
      },
    ],
    bestFor: bestFor.slice(0, 3),
    confirmFirst: confirmFirst.slice(0, 3),
    managementTitle: managementTitle,
    managementCopy: managementCopy,
  };
}

function trackDirectoryProfileOpenQuality(therapist, readiness, freshness) {
  if (!profileSource) {
    return;
  }
  trackFunnelEvent("directory_profile_open_quality", {
    source: profileSource,
    therapist_slug: therapist.slug || "",
    readiness_score: readiness && typeof readiness.score === "number" ? readiness.score : 0,
    freshness_status: freshness && freshness.status ? freshness.status : "unknown",
    accepting_new_patients: Boolean(therapist.accepting_new_patients),
    has_bipolar_experience: Boolean(Number(therapist.bipolar_years_experience || 0)),
    has_fee_details: Boolean(
      therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale,
    ),
    has_wait_time: Boolean(therapist.estimated_wait_time),
  });
}

function readShortlist() {
  try {
    return normalizeShortlist(
      JSON.parse(window.localStorage.getItem(DIRECTORY_SHORTLIST_KEY) || "[]"),
    );
  } catch (_error) {
    return [];
  }
}

function normalizeShortlist(value) {
  return (Array.isArray(value) ? value : [])
    .map(function (item) {
      if (typeof item === "string") {
        return {
          slug: item,
          priority: "",
          note: "",
        };
      }
      if (!item || !item.slug) {
        return null;
      }
      return {
        slug: String(item.slug),
        priority: String(item.priority || ""),
        note: String(item.note || ""),
      };
    })
    .filter(Boolean)
    .slice(0, DIRECTORY_LIST_LIMIT);
}

function writeShortlist(value) {
  try {
    window.localStorage.setItem(DIRECTORY_SHORTLIST_KEY, JSON.stringify(value));
  } catch (_error) {
    return;
  }
}

function readOutreachOutcomes() {
  try {
    return JSON.parse(window.localStorage.getItem(OUTREACH_OUTCOMES_KEY) || "[]");
  } catch (_error) {
    return [];
  }
}

function buildOutreachQueueUrl(focusSlug) {
  var shortlist = readShortlist();
  var slugs = shortlist
    .map(function (item) {
      return item.slug;
    })
    .filter(Boolean);
  if (!slugs.length) {
    return "match.html";
  }

  var params = new URLSearchParams();
  params.set("shortlist", slugs.join(","));
  params.set("entry", "directory_shortlist_queue");
  if (focusSlug) {
    params.set("focus", focusSlug);
  }
  return "match.html?" + params.toString();
}

function buildShortlistCompareUrl() {
  var shortlist = readShortlist();
  var slugs = shortlist
    .map(function (item) {
      return item.slug;
    })
    .filter(Boolean);
  if (!slugs.length) {
    return "match.html";
  }

  var params = new URLSearchParams();
  params.set("shortlist", slugs.join(","));
  return "match.html?" + params.toString();
}

function formatSavedOutcomeLabel(outcome) {
  var labels = {
    reached_out: "Reached out",
    heard_back: "Heard back",
    booked_consult: "Booked consult",
    good_fit_call: "Good fit call",
    insurance_mismatch: "Insurance mismatch",
    waitlist: "Waitlist",
    no_response: "No response yet",
  };
  return labels[String(outcome || "")] || "";
}

function getLatestOutreachOutcomeForSlug(slugValue) {
  return (
    readOutreachOutcomes().find(function (item) {
      return item && item.therapist_slug === slugValue;
    }) || null
  );
}

function recordProfileOutreachOutcome(therapist, outcome) {
  if (!therapist || !therapist.slug || !outcome) {
    return null;
  }

  var shortlist = readShortlist();
  var shortlistSlugs = shortlist
    .map(function (item) {
      return item.slug;
    })
    .filter(Boolean)
    .slice(0, DIRECTORY_LIST_LIMIT);
  var existing = readOutreachOutcomes();
  var now = new Date().toISOString();
  var entryIndex = shortlistSlugs.indexOf(therapist.slug);

  existing.unshift({
    recorded_at: now,
    journey_id: ["profile", now, shortlistSlugs.join("-") || therapist.slug].join(":"),
    therapist_slug: therapist.slug,
    therapist_name: therapist.name,
    rank_position: entryIndex === -1 ? 1 : entryIndex + 1,
    outcome: outcome,
    route_type: therapist.preferred_contact_method || "",
    actual_route_type: therapist.preferred_contact_method || "",
    route_signal_source: "profile",
    shortcut_type: "",
    pivot_at: "",
    recommended_wait_window: "",
    request_summary: "Therapist profile outreach update",
    context: {
      created_at: now,
      summary: "Therapist profile outreach update",
      profile: null,
      therapist_slugs: shortlistSlugs,
    },
  });

  try {
    window.localStorage.setItem(OUTREACH_OUTCOMES_KEY, JSON.stringify(existing.slice(0, 150)));
  } catch (_error) {
    return null;
  }

  return getLatestOutreachOutcomeForSlug(therapist.slug);
}

function buildProfileOutreachQueueState(slugValue) {
  var shortlist = readShortlist();
  var shortlistEntry = shortlist.find(function (item) {
    return item.slug === slugValue;
  });
  var latestOutcome = getLatestOutreachOutcomeForSlug(slugValue);
  var queueUrl = buildOutreachQueueUrl(slugValue);

  if (!shortlistEntry && !latestOutcome) {
    return null;
  }

  if (
    latestOutcome &&
    ["no_response", "waitlist", "insurance_mismatch"].indexOf(
      String(latestOutcome.outcome || ""),
    ) !== -1
  ) {
    return {
      tone: "watch",
      label: "Outreach queue status",
      title: "This contact path may be stalled",
      copy:
        "You already tried this therapist and hit " +
        formatSavedOutcomeLabel(latestOutcome.outcome).toLowerCase() +
        ". Resume your queue and move to the clearest backup instead of waiting here.",
      ctaLabel: "Resume outreach queue",
      ctaHref: queueUrl,
      actions: ["heard_back", "no_response"],
    };
  }

  if (latestOutcome) {
    return {
      tone: "fresh",
      label: "Outreach queue status",
      title: "This therapist is already in motion",
      copy:
        "Latest saved outreach outcome: " +
        formatSavedOutcomeLabel(latestOutcome.outcome) +
        ". Reopen your queue if you want to keep momentum or compare your backup.",
      ctaLabel: "Resume outreach queue",
      ctaHref: queueUrl,
      actions: ["heard_back", "good_fit_call"],
    };
  }

  return {
    tone: "teal",
    label: "Outreach queue status",
    title: "Saved, but not contacted yet",
    copy: "This therapist is already on your list. Start the outreach queue when you want a clear contact-first plan and backup path.",
    ctaLabel: "Start outreach queue",
    ctaHref: queueUrl,
    actions: ["reached_out", "heard_back", "no_response"],
  };
}

function buildProfileFollowThroughItems(latestOutcome, backupState, bestNextStepCopy) {
  var outcome = latestOutcome ? String(latestOutcome.outcome || "") : "";
  var backupName =
    backupState && backupState.therapist && backupState.therapist.name
      ? backupState.therapist.name
      : "your backup";

  var replyCopy =
    outcome === "heard_back"
      ? "You have a live reply now. Use it to confirm fit, timing, and logistics before you treat this as the clear winner."
      : outcome === "booked_consult" || outcome === "good_fit_call"
        ? "A real path is now open here. Stay focused on whether this looks meaningfully better than your backup, not just active."
        : "If they reply, use that moment to confirm whether this route is actually viable instead of sliding into a vague exchange.";
  var consultCopy =
    outcome === "booked_consult" || outcome === "good_fit_call"
      ? "Go into the consult ready to judge clinical fit, practical fit, and whether the next step feels clear enough to continue."
      : "If a consult gets booked, compare how concrete the next step feels here versus whether " +
        backupName +
        " still deserves to stay warm.";
  var backupCopy = backupState
    ? "Keep " +
      backupName +
      " warm until this route earns the lead. One good fallback protects momentum without scattering your attention."
    : "If this route starts to convert, keep one other credible option saved so you are not rebuilding the search if timing slips.";

  return [
    {
      label: "If they reply",
      value: replyCopy,
      helper:
        "A strong reply should reduce uncertainty quickly. Look for direct answers on fit, timing, cost, and next step.",
    },
    {
      label: "If a consult gets booked",
      value: consultCopy,
      helper:
        bestNextStepCopy ||
        "Use the consult to decide whether this deserves the lead spot, not just whether it sounds good in theory.",
    },
    {
      label: "Keep your backup working for you",
      value: backupCopy,
      helper:
        "The goal is calm momentum with insurance. Protect one good fallback instead of reopening the whole search every time a route slows down.",
    },
  ];
}

function getShortlistPriorityRank(value) {
  var normalized = String(value || "").toLowerCase();
  if (normalized === "best fit") {
    return 3;
  }
  if (normalized === "best availability") {
    return 2;
  }
  if (normalized === "best value") {
    return 1;
  }
  return 0;
}

function buildProfileBackupState(currentTherapist, therapistDirectory) {
  var shortlist = readShortlist();
  var backupSignals = summarizeProfileBackupSignals(
    readFunnelEvents(),
    currentTherapist && currentTherapist.slug,
  );
  if (!currentTherapist || !shortlist.length) {
    return null;
  }

  var alternatives = shortlist
    .filter(function (item) {
      return item.slug !== currentTherapist.slug;
    })
    .map(function (item) {
      var therapist = (therapistDirectory || []).find(function (candidate) {
        return candidate.slug === item.slug;
      });
      return therapist
        ? {
            therapist: therapist,
            shortlistEntry: item,
            rank: getShortlistPriorityRank(item.priority),
          }
        : null;
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return (
        b.rank - a.rank ||
        Number(Boolean(b.therapist.accepting_new_patients)) -
          Number(Boolean(a.therapist.accepting_new_patients)) ||
        Number(Boolean(b.therapist.bipolar_years_experience)) -
          Number(Boolean(a.therapist.bipolar_years_experience))
      );
    });

  var backup = alternatives[0] || null;
  if (!backup) {
    if (
      shortlist.some(function (item) {
        return item.slug === currentTherapist.slug;
      })
    ) {
      return {
        mode: "needs_backup",
        title: "Strong option, but no backup yet",
        copy: "If you like this therapist, keep momentum by saving one more credible option. That makes it easier to move quickly if this path stalls.",
        ctaLabel: "Compare list",
        ctaHref: buildShortlistCompareUrl(),
      };
    }
    return null;
  }

  return {
    mode: "has_backup",
    therapist: backup.therapist,
    title: "Best backup if this one stalls",
    copy:
      backup.shortlistEntry && backup.shortlistEntry.priority
        ? backup.therapist.name +
          " is already on your list as " +
          String(backup.shortlistEntry.priority || "").toLowerCase() +
          ". Keep this option close so you can move without restarting your search."
        : backup.therapist.name +
          " is the clearest backup already on your list if this first path slows down.",
    note: backupSignals && backupSignals.interpretation ? backupSignals.interpretation : "",
    ctaLabel:
      backupSignals && backupSignals.preferred_action === "open_backup"
        ? "Compare after backup review"
        : "Compare these two",
    ctaHref: buildShortlistCompareUrl(),
    profileHref:
      "therapist.html?slug=" + encodeURIComponent(backup.therapist.slug) + "&source=profile_backup",
    primaryAction: backupSignals ? backupSignals.preferred_action : "balanced",
  };
}

function buildProfileDecisionMemoryState(slugValue) {
  var shortlistEntry = readShortlist().find(function (item) {
    return item.slug === slugValue;
  });
  if (!shortlistEntry) {
    return null;
  }

  var latestOutcome = getLatestOutreachOutcomeForSlug(slugValue);
  var changedCopy = latestOutcome
    ? "Since you saved this, the newest signal is " +
      formatSavedOutcomeLabel(latestOutcome.outcome).toLowerCase() +
      ". Use that as more important than your earlier hunch if the two are in conflict."
    : "Nothing live has changed yet, so your saved note and the current profile details should still do most of the decision work.";

  return {
    title: shortlistEntry.priority
      ? "You saved this as " + String(shortlistEntry.priority || "").toLowerCase()
      : "You already saved this therapist",
    copy: shortlistEntry.note
      ? 'Your note: "' + String(shortlistEntry.note || "").trim() + '"'
      : "Add a quick note or list label so future-you can remember why this therapist stood out.",
    changedCopy: changedCopy,
    tone: shortlistEntry.note || shortlistEntry.priority ? "fresh" : "teal",
    compareHref: buildShortlistCompareUrl(),
  };
}

function buildProfileUncertaintyState(therapist, readiness) {
  var missingFit = !Number(therapist && therapist.bipolar_years_experience);
  var missingTrust =
    therapist && therapist.verification_status !== "editorially_verified"
      ? !therapist.source_reviewed_at && !therapist.therapist_reported_confirmed_at
      : false;
  var missingLogistics = !(
    (therapist && therapist.estimated_wait_time) ||
    (therapist && therapist.session_fee_min) ||
    (therapist && therapist.session_fee_max) ||
    (therapist && therapist.insurance_accepted && therapist.insurance_accepted.length)
  );

  var unknowns = [];
  if (missingFit) {
    unknowns.push("bipolar-specific depth");
  }
  if (missingTrust) {
    unknowns.push("recent source confirmation");
  }
  if (missingLogistics) {
    unknowns.push("timing, fees, or coverage");
  }

  if (!unknowns.length || (readiness && readiness.score >= 72)) {
    return null;
  }

  return {
    title: "A few decision-critical details are still thin",
    copy:
      "The biggest remaining unknowns here are " +
      joinNaturalList(unknowns) +
      ". That does not make this a bad option, but it does mean the smartest next move is one focused outreach instead of more page-reading.",
    actionLabel: "Use the contact plan below",
    actionCopy:
      missingLogistics || missingFit
        ? "Lead with one direct question about fit and one about logistics so you can rule this in or out quickly."
        : "Use one short message to confirm the missing trust details before investing more time.",
    tone: "watch",
  };
}

function renderQueueActionButtons(queueState) {
  var actions = Array.isArray(queueState && queueState.actions) ? queueState.actions : [];
  if (!actions.length) {
    return "";
  }

  return (
    '<div class="profile-queue-actions">' +
    actions
      .map(function (action) {
        return (
          '<button type="button" class="profile-queue-action-btn" data-profile-queue-outcome="' +
          escapeHtml(action) +
          '">' +
          escapeHtml(formatSavedOutcomeLabel(action) || action) +
          "</button>"
        );
      })
      .join("") +
    "</div>"
  );
}

function renderDecisionMemoryCard(memoryState) {
  if (!memoryState) {
    return "";
  }

  return (
    '<div class="profile-decision-memory-card tone-' +
    escapeHtml(memoryState.tone) +
    '"><div class="profile-decision-memory-label">Your decision memory</div><div class="profile-decision-memory-title">' +
    escapeHtml(memoryState.title) +
    '</div><div class="profile-decision-memory-copy">' +
    escapeHtml(memoryState.copy) +
    '</div><div class="profile-decision-memory-subtitle">What changed since you saved it</div><div class="profile-decision-memory-copy">' +
    escapeHtml(
      memoryState.changedCopy ||
        "Reopen your list if you want to compare this against your strongest backup.",
    ) +
    '</div><a href="' +
    escapeHtml(memoryState.compareHref) +
    '" class="profile-decision-memory-link">Review list</a></div>'
  );
}

function renderQueueStatusCard(queueState) {
  if (!queueState) {
    return "";
  }

  return (
    '<div class="profile-queue-status-card tone-' +
    escapeHtml(queueState.tone) +
    '"><div class="profile-queue-status-label">' +
    escapeHtml(queueState.label) +
    '</div><div class="profile-queue-status-title">' +
    escapeHtml(queueState.title) +
    '</div><div class="profile-queue-status-copy">' +
    escapeHtml(queueState.copy) +
    '</div><a href="' +
    escapeHtml(queueState.ctaHref) +
    '" class="profile-queue-status-link">' +
    escapeHtml(queueState.ctaLabel) +
    "</a>" +
    renderQueueActionButtons(queueState) +
    "</div>"
  );
}

function renderBackupCard(backupState) {
  if (!backupState) {
    return "";
  }

  return (
    '<div class="profile-backup-card"><div class="profile-backup-kicker">' +
    escapeHtml(backupState.title) +
    '</div><div class="profile-backup-copy">' +
    escapeHtml(backupState.copy) +
    "</div>" +
    (backupState.note
      ? '<div class="profile-backup-note">' + escapeHtml(backupState.note) + "</div>"
      : "") +
    '<div class="profile-backup-actions">' +
    (backupState.primaryAction === "open_backup" && backupState.profileHref
      ? '<a href="' +
        escapeHtml(backupState.profileHref) +
        '" class="btn-website profile-backup-link" data-profile-backup-link="' +
        escapeHtml(backupState.therapist.slug) +
        '">Open backup profile</a><a href="' +
        escapeHtml(backupState.ctaHref) +
        '" class="btn-website" data-profile-backup-compare="true">' +
        escapeHtml(backupState.ctaLabel) +
        "</a>"
      : '<a href="' +
        escapeHtml(backupState.ctaHref) +
        '" class="btn-website" data-profile-backup-compare="true">' +
        escapeHtml(backupState.ctaLabel) +
        "</a>" +
        (backupState.profileHref
          ? '<a href="' +
            escapeHtml(backupState.profileHref) +
            '" class="btn-website profile-backup-link" data-profile-backup-link="' +
            escapeHtml(backupState.therapist.slug) +
            '">Open backup profile</a>'
          : "")) +
    "</div></div>"
  );
}

function renderUncertaintyCard(uncertaintyState) {
  if (!uncertaintyState) {
    return "";
  }

  return (
    '<div class="profile-uncertainty-card tone-' +
    escapeHtml(uncertaintyState.tone) +
    '"><div class="profile-uncertainty-label">How to use this profile well</div><div class="profile-uncertainty-title">' +
    escapeHtml(uncertaintyState.title) +
    '</div><div class="profile-uncertainty-copy">' +
    escapeHtml(uncertaintyState.copy) +
    '</div><div class="profile-uncertainty-action"><span class="profile-uncertainty-action-label">' +
    escapeHtml(uncertaintyState.actionLabel) +
    '</span><span class="profile-uncertainty-action-copy">' +
    escapeHtml(uncertaintyState.actionCopy) +
    "</span></div></div>"
  );
}

function toggleShortlist(slugValue) {
  var shortlist = readShortlist();
  if (
    shortlist.some(function (item) {
      return item.slug === slugValue;
    })
  ) {
    var next = shortlist.filter(function (item) {
      return item.slug !== slugValue;
    });
    writeShortlist(next);
    return false;
  }

  var appended = shortlist
    .concat({ slug: slugValue, priority: "", note: "" })
    .slice(0, DIRECTORY_LIST_LIMIT);
  writeShortlist(appended);
  return true;
}

function updateShortlistPriority(slugValue, priority) {
  writeShortlist(
    readShortlist().map(function (item) {
      if (item.slug !== slugValue) {
        return item;
      }
      return {
        slug: item.slug,
        priority: priority,
        note: item.note || "",
      };
    }),
  );
}

function updateShortlistNote(slugValue, note) {
  writeShortlist(
    readShortlist().map(function (item) {
      if (item.slug !== slugValue) {
        return item;
      }
      return {
        slug: item.slug,
        priority: item.priority || "",
        note: String(note || "")
          .trim()
          .slice(0, 120),
      };
    }),
  );
}

function updateShortlistNoteMeta(currentValue) {
  var noteMeta = document.getElementById("profileShortlistNoteMeta");
  if (!noteMeta) {
    return;
  }
  var length = String(currentValue || "").trim().length;
  noteMeta.textContent = length
    ? length + "/120 characters"
    : "Keep this to one sharp reminder for future-you.";
}

function updateShortlistAction(slugValue) {
  var buttons = Array.prototype.slice.call(
    document.querySelectorAll("[data-shortlist-trigger='profile']"),
  );
  var status = document.getElementById("profileShortlistStatus");
  var decisionMemory = document.getElementById("profileDecisionMemory");
  var queueStatus = document.getElementById("profileQueueStatus");
  if (!buttons.length || !status) {
    return;
  }

  var shortlistEntry = readShortlist().find(function (item) {
    return item.slug === slugValue;
  });
  var shortlisted = !!shortlistEntry;
  buttons.forEach(function (button) {
    button.textContent = shortlisted ? "Saved to list" : "Save to list";
    button.classList.toggle("is-saved", shortlisted);
  });
  status.textContent = shortlisted
    ? "Saved in your list on this browser. You can come back, compare, add a note, or move into outreach without losing your place."
    : "Save up to 6 therapists so you can compare, leave a note, and return later without having to rebuild your search.";

  if (decisionMemory) {
    var memoryState = buildProfileDecisionMemoryState(slugValue);
    decisionMemory.innerHTML = renderDecisionMemoryCard(memoryState);
  }

  if (queueStatus) {
    var queueState = buildProfileOutreachQueueState(slugValue);
    queueStatus.innerHTML = renderQueueStatusCard(queueState);
  }

  var priorityWrap = document.getElementById("profileShortlistPriorityWrap");
  var prioritySelect = document.getElementById("profileShortlistPriority");
  var noteInput = document.getElementById("profileShortlistNote");
  if (priorityWrap && prioritySelect && noteInput) {
    priorityWrap.style.display = shortlisted ? "block" : "none";
    prioritySelect.value = shortlistEntry ? shortlistEntry.priority : "";
    noteInput.value = shortlistEntry ? shortlistEntry.note : "";
    updateShortlistNoteMeta(noteInput.value);
  }
}

async function resolveTherapistForProfile(slugValue) {
  var exact = await fetchPublicTherapistBySlug(slugValue);
  if (exact) {
    return exact;
  }

  var normalizedSlug = String(slugValue || "")
    .trim()
    .toLowerCase();
  if (!normalizedSlug) {
    return null;
  }

  var therapists = await fetchPublicTherapists();
  return (
    therapists.find(function (item) {
      var itemSlug = String((item && item.slug) || "").toLowerCase();
      return itemSlug === normalizedSlug || itemSlug.indexOf(normalizedSlug + "-") === 0;
    }) || null
  );
}

(async function init() {
  try {
    if (!slug) {
      document.getElementById("profileWrap").innerHTML =
        '<div class="not-found"><h2>Choose a therapist to review</h2><p>Open a profile from the directory to compare bipolar-care fit, practical details, and the best next step in one place.</p><a href="directory.html" class="back-link">← Back to Directory</a></div>';
      return;
    }

    var therapist = await resolveTherapistForProfile(slug);
    var therapistDirectory = await fetchPublicTherapists();
    if (!therapist) {
      document.getElementById("profileWrap").innerHTML =
        '<div class="not-found"><h2>This profile is not available right now</h2><p>The link may be out of date, or the therapist may no longer be listed. You can return to the directory to compare other bipolar-informed options.</p><a href="directory.html" class="back-link">← Back to Directory</a></div>';
      return;
    }

    activeTherapistContactExperimentVariant = getExperimentVariant("therapist_contact_guidance", [
      "control",
      "action_plan",
    ]);
    trackExperimentExposure("therapist_contact_guidance", activeTherapistContactExperimentVariant, {
      therapist_slug: therapist.slug || "",
      preferred_contact_method: therapist.preferred_contact_method || "unknown",
    });
    renderProfile(therapist, therapistDirectory);
    initValuePillPopover();
  } catch (error) {
    console.error("Therapist profile failed to load.", error);
    document.getElementById("profileWrap").innerHTML =
      '<div class="not-found"><h2>We could not load this profile</h2><p>Something went wrong while opening the therapist page. Please go back to the directory and try again.</p><a href="directory.html" class="back-link">← Back to Directory</a></div>';
    var breadcrumbName = document.getElementById("breadcrumbName");
    if (breadcrumbName) {
      breadcrumbName.textContent = "Profile unavailable";
    }
  }
})();

function renderProfile(t, therapistDirectory) {
  var readiness = getTherapistMatchReadiness(t);
  var freshness = getDataFreshnessSummary(t);
  var recentApplied = getRecentAppliedSummary(t);
  var recentConfirmation = getRecentConfirmationSummary(t);
  var responsivenessSignal = getPublicResponsivenessSignal(t);
  var routePerformance = summarizeTherapistContactRoutePerformance(readFunnelEvents(), t.slug);
  var routeOutcomePerformance = summarizeTherapistContactRouteOutcomes(t);
  var freshnessSignal = getProminentFreshnessSignal(
    t,
    recentApplied,
    recentConfirmation,
    freshness,
  );
  var decisionMemoryState = buildProfileDecisionMemoryState(t.slug);
  var uncertaintyState = buildProfileUncertaintyState(t, readiness);
  var backupState = buildProfileBackupState(t, therapistDirectory || []);
  buildProfileEntryState(profileSource, t, backupState);
  var outreachQueueState = buildProfileOutreachQueueState(t.slug);
  var latestOutreachOutcome = getLatestOutreachOutcomeForSlug(t.slug);
  trackDirectoryProfileOpenQuality(t, readiness, freshness);
  var readinessTitle =
    readiness.score >= 85
      ? "High match confidence"
      : readiness.score >= 65
        ? "Good match confidence"
        : "Profile still being completed";
  var readinessCopy =
    readiness.score >= 85
      ? "This profile includes the details people usually need to make a confident save decision."
      : readiness.score >= 65
        ? "This profile covers most of the practical and clinical details people usually compare."
        : "This profile is still lighter than ideal, but there is enough here to judge basic fit and decide whether a first outreach is worth it.";
  var fitReasons = [];
  if (t.verification_status === "editorially_verified") {
    fitReasons.push("editorial verification is in place");
  }
  if (getEditoriallyVerifiedOperationalCount(t) >= 2) {
    fitReasons.push("multiple access details have been editor-verified");
  }
  if (Number(t.bipolar_years_experience || 0) >= 8) {
    fitReasons.push("they have substantial bipolar-specific experience");
  }
  if (t.medication_management) {
    fitReasons.push("they offer medication-management support");
  }
  if (t.accepting_new_patients) {
    fitReasons.push("they appear to be accepting new patients");
  }
  if (t.accepts_telehealth) {
    fitReasons.push("they offer telehealth access");
  }
  if (responsivenessSignal && responsivenessSignal.tone === "positive") {
    fitReasons.push("earlier outreach patterns suggest stronger follow-through");
  }
  var likelyFitAudience = [];
  if (t.medication_management) {
    likelyFitAudience.push("people who may need psychiatry or medication support");
  } else if ((t.client_populations || []).length) {
    likelyFitAudience.push(
      "people looking for " + String(t.client_populations[0] || "").toLowerCase() + " support",
    );
  }
  if ((t.specialties || []).includes("Bipolar I")) {
    likelyFitAudience.push("bipolar I care");
  } else if ((t.specialties || []).includes("Bipolar II")) {
    likelyFitAudience.push("bipolar II care");
  } else if ((t.specialties || []).length) {
    likelyFitAudience.push(String(t.specialties[0] || "").toLowerCase() + " care");
  }
  if (t.accepts_telehealth) {
    likelyFitAudience.push("telehealth access");
  }
  var reviewedDetails = [];
  if (t.verification_status === "editorially_verified") {
    reviewedDetails.push("license and location");
    reviewedDetails.push("care format and availability details");
    reviewedDetails.push("public contact path");
  }
  if (t.contact_guidance || t.first_step_expectation) {
    reviewedDetails.push("first-contact guidance");
  }
  var reviewedDetailsCopy = reviewedDetails.length
    ? "Reviewed details currently include " +
      reviewedDetails.slice(0, 3).join(", ") +
      ". This is a trust and clarity check, not a quality rating."
    : "This profile has a usable trust foundation, but some practical details still need direct confirmation before you commit.";
  var operationalTrustSummary = getOperationalTrustSummary(t);
  var standoutReasons = [];
  if (t.verification_status === "editorially_verified") {
    standoutReasons.push("editorial review is already in place");
  }
  if (getEditoriallyVerifiedOperationalCount(t) >= 2) {
    standoutReasons.push("multiple operational details are editor-verified");
  }
  if (Number(t.bipolar_years_experience || 0) >= 8) {
    standoutReasons.push("bipolar-specific experience is clearly documented");
  }
  if (t.medication_management) {
    standoutReasons.push("psychiatry or medication support is available");
  }
  if (t.accepting_new_patients && t.estimated_wait_time) {
    standoutReasons.push("availability context is clearer than usual");
  }
  var standoutCopy = standoutReasons.length
    ? "What looks especially strong on this profile right now: " +
      standoutReasons.slice(0, 3).join(", ") +
      "."
    : "This profile is most useful for making a quick yes, maybe, or no decision before you spend more time reaching out.";
  var reachabilityCopy =
    t.accepting_new_patients && t.estimated_wait_time
      ? "Reachability looks relatively strong here: the profile shows a clear contact path, indicates new-patient availability, and includes a recent availability note suggesting " +
        t.estimated_wait_time.toLowerCase() +
        " timing."
      : t.accepting_new_patients
        ? "Reachability looks relatively strong here: the profile suggests this clinician is accepting new patients and gives a clear next step."
        : t.estimated_wait_time
          ? "Reachability is partly clear here: the profile includes availability context, but live openings should still be confirmed directly."
          : "Reachability is decent here: the contact path is clear, even if live timing still needs a quick confirmation.";
  document.title = t.name + " — BipolarTherapyHub";
  document.getElementById("breadcrumbName").textContent = t.name;
  var navClaimLink = document.getElementById("navClaimLink");
  var footerClaimLink = document.getElementById("footerClaimLink");
  if (navClaimLink) {
    navClaimLink.href = "signup.html?confirm=" + encodeURIComponent(t.slug);
  }
  if (footerClaimLink) {
    footerClaimLink.href = "signup.html?confirm=" + encodeURIComponent(t.slug);
  }

  var initials = (t.name || "")
    .split(" ")
    .map(function (n) {
      return n[0];
    })
    .join("")
    .substring(0, 2);
  var avatar = t.photo_url
    ? '<img src="' + escapeHtml(t.photo_url) + '" alt="' + escapeHtml(t.name) + '" />'
    : escapeHtml(initials);

  var acceptingBadge = t.accepting_new_patients
    ? '<span class="status-badge badge-accepting">Accepting new patients</span>'
    : '<span class="status-badge badge-waitlist">Waitlist only</span>';

  var trustPills = renderValuePillRow(t, "value-pill");

  var contactBtns = "";
  var primaryContactLabel = String(t.preferred_contact_label || "").trim();
  var contactGuidance = String(t.contact_guidance || "").trim();
  var firstStepExpectation = String(t.first_step_expectation || "").trim();
  var therapistReportedFields = Array.isArray(t.therapist_reported_fields)
    ? t.therapist_reported_fields
    : [];
  var therapistReportedDate = formatSourceDate(t.therapist_reported_confirmed_at);
  var sourceReviewedDate = formatSourceDate(t.source_reviewed_at);
  var sourceHost = getSourceHostLabel(t.source_url);
  var supportingSourceCount = Array.isArray(t.supporting_source_urls)
    ? t.supporting_source_urls.filter(Boolean).length
    : 0;
  var totalExperience = Number(t.years_experience || 0);
  var bipolarExperience = Number(t.bipolar_years_experience || 0);
  var quickFitItems = [];
  var bipolarTrustItems = [];
  var practicalDetailsItems = [];
  var contactChecklistItems = [];
  var contactQuestionItems = [];
  var bookingHealthy = isBookingRouteHealthy(t);
  var websiteHealthy = isWebsiteRouteHealthy(t);
  var contactRouteLabel =
    t.preferred_contact_method === "booking"
      ? "Use the booking link"
      : t.preferred_contact_method === "website" && websiteHealthy
        ? "Reach out through the practice website"
        : t.preferred_contact_method === "phone"
          ? "Call the practice"
          : t.preferred_contact_method === "email"
            ? "Email the therapist"
            : "Reach out using the listed contact method";
  function buildPreferredContactButton() {
    if (t.preferred_contact_method === "booking" && t.booking_url && bookingHealthy) {
      return (
        '<a href="' +
        escapeHtml(t.booking_url) +
        '" target="_blank" rel="noopener" class="btn-contact" data-profile-contact-route="booking" data-profile-contact-priority="primary">' +
        escapeHtml(primaryContactLabel || "Book consultation") +
        "</a>"
      );
    }
    if (t.preferred_contact_method === "website" && t.website && websiteHealthy) {
      return (
        '<a href="' +
        escapeHtml(t.website) +
        '" target="_blank" rel="noopener" class="btn-contact" data-profile-contact-route="website" data-profile-contact-priority="primary">' +
        escapeHtml(primaryContactLabel || "Visit website") +
        "</a>"
      );
    }
    if (t.preferred_contact_method === "phone" && t.phone) {
      return (
        '<a href="tel:' +
        escapeHtml(t.phone) +
        '" class="btn-contact" data-profile-contact-route="phone" data-profile-contact-priority="primary">' +
        escapeHtml(primaryContactLabel || "Call " + t.phone) +
        "</a>"
      );
    }
    if (t.email && t.email !== "contact@example.com") {
      return (
        '<a href="mailto:' +
        escapeHtml(t.email) +
        '" class="btn-contact" data-profile-contact-route="email" data-profile-contact-priority="primary">' +
        escapeHtml(primaryContactLabel || "Email") +
        "</a>"
      );
    }
    return "";
  }
  contactBtns +=
    '<button type="button" class="btn-website shortlist-profile-btn" id="profileShortlistButton" data-shortlist-trigger="profile">Save to list</button>';
  contactBtns += buildPreferredContactButton();
  contactBtns +=
    '<a href="portal.html?slug=' +
    encodeURIComponent(t.slug) +
    '" class="btn-website btn-contact-secondary">Claim or manage profile</a>';
  if (t.phone && t.preferred_contact_method !== "phone") {
    contactBtns +=
      '<a href="tel:' +
      escapeHtml(t.phone) +
      '" class="btn-contact btn-contact-secondary" data-profile-contact-route="phone" data-profile-contact-priority="secondary">Call ' +
      escapeHtml(t.phone) +
      "</a>";
  }
  if (t.email && t.email !== "contact@example.com" && t.preferred_contact_method !== "email") {
    contactBtns +=
      '<a href="mailto:' +
      escapeHtml(t.email) +
      '" class="btn-contact btn-contact-secondary" data-profile-contact-route="email" data-profile-contact-priority="secondary">Email</a>';
  }
  if (t.website && websiteHealthy && t.preferred_contact_method !== "website") {
    contactBtns +=
      '<a href="' +
      escapeHtml(t.website) +
      '" target="_blank" rel="noopener" class="btn-website" data-profile-contact-route="website" data-profile-contact-priority="secondary">Visit website</a>';
  }
  if (t.booking_url && bookingHealthy && t.preferred_contact_method !== "booking") {
    contactBtns +=
      '<a href="' +
      escapeHtml(t.booking_url) +
      '" target="_blank" rel="noopener" class="btn-website" data-profile-contact-route="booking" data-profile-contact-priority="secondary">Booking link</a>';
  }

  var insTags = renderList(t.insurance_accepted, "ins-item");
  var langPills = renderCompactTagList(t.languages || ["English"], "lang-pill", 3);
  var telehealthStates = renderCompactTagList(t.telehealth_states, "lang-pill", 4);
  var therapistReportedCopy = therapistReportedFields.length
    ? "Some operational details here were confirmed directly by the specialist" +
      (therapistReportedDate ? " on " + therapistReportedDate : "") +
      ", including " +
      therapistReportedFields.join(", ").replace(/_/g, " ") +
      "."
    : "";
  var sourceReviewCopy = sourceReviewedDate
    ? "This profile was last reviewed against public sources on " +
      sourceReviewedDate +
      (sourceHost ? ", with " + sourceHost + " as the primary source" : "") +
      (supportingSourceCount
        ? " and " +
          supportingSourceCount +
          " supporting source" +
          (supportingSourceCount > 1 ? "s" : "")
        : "") +
      "."
    : "";
  var trustSectionCards = [
    {
      label: "Reviewed details",
      title:
        t.verification_status === "editorially_verified"
          ? "The profile has already passed an editorial clarity pass"
          : "This profile still depends more on your own confirmation",
      copy: reviewedDetailsCopy,
    },
    {
      label: "Direct confirmation",
      title: therapistReportedFields.length
        ? "Some access details came directly from the therapist"
        : "Direct therapist confirmation is still thin here",
      copy:
        therapistReportedCopy ||
        "That does not make the profile unusable, but it does mean logistics deserve a little more skepticism before you act.",
    },
    {
      label: "What this means for you",
      title:
        freshness && freshness.status === "fresh"
          ? "You can move faster with a little more confidence"
          : "A short message is still the fastest way to reduce uncertainty",
      copy:
        freshness && freshness.status === "fresh"
          ? "The trust signals here are stronger than average, so you can spend less time validating basics and more time deciding whether the fit is right."
          : "This profile may still be worth contacting, but use the outreach to confirm timing, cost, and any missing trust details before you overcommit.",
    },
  ];
  var trustSectionCardsHtml = trustSectionCards
    .map(function (item) {
      return (
        '<div class="trust-section-card"><div class="trust-section-label">' +
        escapeHtml(item.label) +
        '</div><div class="trust-section-title">' +
        escapeHtml(item.title) +
        '</div><div class="trust-section-copy">' +
        escapeHtml(item.copy) +
        "</div></div>"
      );
    })
    .join("");

  var feesHtml = "";
  if (t.session_fee_min || t.session_fee_max) {
    feesHtml =
      '<div class="fee-range">$' +
      escapeHtml(t.session_fee_min || "") +
      (t.session_fee_max ? "–$" + escapeHtml(t.session_fee_max) : "") +
      "/session</div>";
    if (t.sliding_scale) {
      feesHtml += '<div class="fee-note">Sliding scale available</div>';
    }
  } else if (t.sliding_scale) {
    feesHtml =
      '<div class="fee-note">Sliding scale is available. Reach out for the current fee range.</div>';
  } else {
    feesHtml =
      '<div class="fee-note">Fee details are not listed here yet, so cost is worth confirming in your first message.</div>';
  }
  var bestNextStepCopy =
    firstStepExpectation ||
    "After first contact, the next step is usually a brief fit conversation or intake review before a full appointment is scheduled.";
  var contactStrategy = getContactStrategy(
    t,
    responsivenessSignal,
    routePerformance,
    routeOutcomePerformance,
  );
  var outreachScript = buildOutreachScript(t, contactStrategy);
  var shortlistCompareUrl = buildShortlistCompareUrl();
  var outreachQueueUrl = buildOutreachQueueUrl(t.slug);
  var decisionSystem = buildProfileDecisionSystem({
    therapist: t,
    readiness: readiness,
    freshness: freshness,
    therapistReportedFields: therapistReportedFields,
    responsivenessSignal: responsivenessSignal,
    contactStrategy: contactStrategy,
    sourceReviewedDate: sourceReviewedDate,
  });
  var contactScriptLabel =
    activeTherapistContactExperimentVariant === "action_plan"
      ? "Use this first message"
      : "Simple outreach script";
  var contactQuestionsLabel =
    activeTherapistContactExperimentVariant === "action_plan"
      ? "Ask these first"
      : "Good questions to ask";
  var primaryButton = buildPreferredContactButton();

  if (bipolarExperience >= 8) {
    quickFitItems.push("Strong bipolar-specific experience is documented.");
  } else if (bipolarExperience >= 3) {
    quickFitItems.push("Bipolar-specific experience is clearly documented.");
  }
  if ((t.specialties || []).includes("Bipolar I") || (t.specialties || []).includes("Bipolar II")) {
    quickFitItems.push("The listed focus areas explicitly include bipolar-spectrum care.");
  } else if ((t.specialties || []).length) {
    quickFitItems.push(
      "The profile highlights " +
        String(t.specialties[0] || "").toLowerCase() +
        " among its focus areas.",
    );
  }
  if ((t.client_populations || []).length) {
    quickFitItems.push(
      "This may be especially relevant if you want support tailored to " +
        String(t.client_populations[0] || "").toLowerCase() +
        ".",
    );
  }
  if (t.medication_management) {
    quickFitItems.push("Medication-management support is available here.");
  }
  if (t.accepts_telehealth && t.accepts_in_person) {
    practicalDetailsItems.push("Offers both telehealth and in-person care.");
  } else if (t.accepts_telehealth) {
    practicalDetailsItems.push("Offers telehealth care.");
  } else if (t.accepts_in_person) {
    practicalDetailsItems.push("Offers in-person care.");
  }
  if (t.accepting_new_patients) {
    practicalDetailsItems.push("The profile indicates they are accepting new patients.");
  }
  if (t.estimated_wait_time) {
    practicalDetailsItems.push("Recent availability note: " + t.estimated_wait_time + ".");
  }
  if ((t.insurance_accepted || []).length) {
    practicalDetailsItems.push(
      "Insurance info is visible, including " +
        joinNaturalList(t.insurance_accepted.slice(0, 3)) +
        ".",
    );
  } else if (t.sliding_scale || t.session_fee_min || t.session_fee_max) {
    practicalDetailsItems.push("Pricing details are surfaced on the page before outreach.");
  }

  if (t.verification_status === "editorially_verified") {
    bipolarTrustItems.push("Key profile details were editorially verified.");
  }
  if (therapistReportedFields.length) {
    bipolarTrustItems.push(
      "Some operational details were confirmed directly by the therapist" +
        (therapistReportedDate ? " on " + therapistReportedDate : "") +
        ".",
    );
  }
  if (sourceReviewedDate) {
    bipolarTrustItems.push(
      "Public sources were reviewed" +
        (sourceReviewedDate ? " on " + sourceReviewedDate : "") +
        (sourceHost ? " using " + sourceHost : "") +
        ".",
    );
  }
  if (bipolarExperience) {
    bipolarTrustItems.push(
      "Bipolar-specific experience is listed as " + bipolarExperience + " years.",
    );
  } else if (totalExperience) {
    bipolarTrustItems.push(
      "Overall clinical experience is listed as " + totalExperience + " years.",
    );
  }

  contactChecklistItems.push(primaryContactLabel || contactRouteLabel);
  if (contactGuidance) {
    contactChecklistItems.push(contactGuidance);
  } else if ((t.specialties || []).length || (t.client_populations || []).length) {
    contactChecklistItems.push(
      "Mention what kind of bipolar-related support you want and ask whether it matches their focus.",
    );
  }
  if (t.estimated_wait_time) {
    contactChecklistItems.push(
      "Ask whether the current opening timeline is still around " + t.estimated_wait_time + ".",
    );
  } else if (t.accepting_new_patients) {
    contactChecklistItems.push(
      "Confirm what the current timeline is for a first consult or intake.",
    );
  }
  contactChecklistItems.push(bestNextStepCopy);

  contactQuestionItems.push("Do you work often with bipolar-spectrum care like what I need?");
  if (t.estimated_wait_time || t.accepting_new_patients) {
    contactQuestionItems.push(
      t.estimated_wait_time
        ? "Is the current opening timeline still around " + t.estimated_wait_time + "?"
        : "What is the current timeline for a first consult or intake?",
    );
  }
  if (!((t.insurance_accepted || []).length && (t.session_fee_min || t.session_fee_max))) {
    contactQuestionItems.push(
      "Can you confirm fees, insurance, or superbill details for my situation?",
    );
  }
  contactQuestionItems.push("What usually happens after the first message or consult?");

  var bipolarTrustHtml = renderList(bipolarTrustItems.slice(0, 4), "decision-list-item");
  var practicalDetailsHtml = renderList(practicalDetailsItems.slice(0, 4), "decision-list-item");
  var contactQuestionHtml = renderList(contactQuestionItems.slice(0, 4), "contact-checklist-item");
  var contactMessageOpener =
    getFirstMeaningfulSentence(outreachScript) ||
    "Lead with one calm sentence about the kind of bipolar-focused help you want.";
  var contactQuestionPreview = contactQuestionItems.slice(0, 2).join(" ");
  var consultConfirmItems = [];
  var strongReplyItems = [];
  var pivotFastItems = [];

  consultConfirmItems.push(
    t.accepting_new_patients || t.estimated_wait_time
      ? "Whether the actual opening timeline still matches what is listed here."
      : "Whether they have a realistic opening path for you right now.",
  );
  consultConfirmItems.push(
    (t.insurance_accepted || []).length || t.session_fee_min || t.session_fee_max || t.sliding_scale
      ? "What your real cost path would be after insurance, fee range, or superbill details are clarified."
      : "What fees, insurance, or superbill details would apply in your situation.",
  );
  consultConfirmItems.push(
    t.medication_management
      ? "How therapy and medication support would actually be coordinated if you move forward."
      : "Whether their bipolar-related experience and care style match what you want help with right now.",
  );

  strongReplyItems.push(
    "They answer the fit question directly instead of sending only a generic intake response.",
  );
  strongReplyItems.push(
    "They give a concrete next step, timeline, or availability window instead of leaving you guessing.",
  );
  strongReplyItems.push(
    (t.insurance_accepted || []).length || t.session_fee_min || t.session_fee_max || t.sliding_scale
      ? "They help clarify cost or insurance fit early instead of making you chase basic logistics."
      : "They are clear about practical next steps even if some cost details still need follow-up.",
  );

  pivotFastItems.push(
    "They cannot explain how they would support the kind of bipolar care you are looking for.",
  );
  pivotFastItems.push(
    "They stay vague about timing, next steps, or whether they are truly taking new clients.",
  );
  pivotFastItems.push("The route creates more confusion than clarity after one real follow-up.");

  var consultConfirmPreview = consultConfirmItems.slice(0, 2).join(" ");
  var followThroughItems = buildProfileFollowThroughItems(
    latestOutreachOutcome,
    backupState,
    bestNextStepCopy,
  );
  var followThroughHtml = followThroughItems
    .map(function (item) {
      return (
        '<div class="next-step-item"><div class="next-step-label">' +
        escapeHtml(item.label) +
        '</div><div class="next-step-value">' +
        escapeHtml(item.value) +
        '</div><div class="next-step-helper">' +
        escapeHtml(item.helper) +
        "</div></div>"
      );
    })
    .join("");
  var contactPrepCardsHtml = [
    {
      label: "Lead with",
      title: "A calm first opener",
      copy:
        "<strong>" +
        escapeHtml(contactMessageOpener) +
        "</strong> Then keep the next line focused on fit or timing instead of writing a long backstory.",
    },
    {
      label: "Confirm first",
      title: "The two fastest questions",
      copy: escapeHtml(
        contactQuestionPreview ||
          "Ask one fit question and one timing question so you can rule this option in or out quickly.",
      ),
    },
    {
      label: "Use the first reply well",
      title: "Confirm these before you commit",
      copy: escapeHtml(
        consultConfirmPreview ||
          "Use the first reply to confirm fit, timing, and cost path before you treat this as your lead route.",
      ),
    },
    {
      label: "Keep momentum",
      title: "Know the pivot before you start",
      copy: escapeHtml(
        contactStrategy.backupPlanCopy ||
          "If this route stalls after one follow-up, move to the clearest backup instead of waiting indefinitely.",
      ),
    },
  ]
    .map(function (item) {
      return (
        '<div class="profile-cockpit-card"><div class="profile-cockpit-label">' +
        item.label +
        '</div><div class="profile-cockpit-title">' +
        item.title +
        '</div><div class="profile-cockpit-copy">' +
        item.copy +
        "</div></div>"
      );
    })
    .join("");
  var consultPrepHtml =
    '<div class="next-step-item"><div class="next-step-label">Use the first reply to judge fit fast</div><div class="next-step-helper">A strong reply should lower uncertainty quickly. If it does not, keep your backup route warm instead of overinvesting here.</div><div class="next-step-question-list">' +
    renderList(strongReplyItems.slice(0, 3), "contact-checklist-item") +
    '</div></div><div class="next-step-item"><div class="next-step-label">Confirm before booking or committing</div><div class="next-step-question-list">' +
    renderList(consultConfirmItems.slice(0, 3), "contact-checklist-item") +
    '</div></div><div class="next-step-item"><div class="next-step-label">Pivot faster if you hear this</div><div class="next-step-question-list">' +
    renderList(pivotFastItems.slice(0, 3), "contact-checklist-item") +
    "</div></div>";
  var insuranceList = Array.isArray(t.insurance_accepted) ? t.insurance_accepted : [];
  var insuranceSummary = insuranceList.length
    ? insuranceList.length <= 2
      ? joinNaturalList(insuranceList)
      : insuranceList.slice(0, 2).join(", ") + " +" + (insuranceList.length - 2) + " more"
    : "Contact to confirm";
  var languageList = Array.isArray(t.languages) && t.languages.length ? t.languages : ["English"];
  var languageSummary =
    languageList.length <= 2
      ? joinNaturalList(languageList)
      : languageList.slice(0, 2).join(", ") + " +" + (languageList.length - 2) + " more";
  var summaryStats = [
    {
      label: "Openings",
      value: t.accepting_new_patients ? "Accepting patients" : "Confirm directly",
      tone: t.accepting_new_patients ? "green" : "teal",
    },
    {
      label: "Format",
      value:
        t.accepts_telehealth && t.accepts_in_person
          ? "Telehealth + in-person"
          : t.accepts_telehealth
            ? "Telehealth"
            : t.accepts_in_person
              ? "In-person"
              : "Format to confirm",
      tone: t.accepts_telehealth || t.accepts_in_person ? "teal" : "",
    },
    {
      label: "Session fee",
      value:
        t.session_fee_min && t.session_fee_max
          ? "$" + t.session_fee_min + "-$" + t.session_fee_max
          : t.session_fee_min
            ? "From $" + t.session_fee_min
            : t.sliding_scale
              ? "Sliding scale"
              : "Fees to confirm",
      tone: t.session_fee_min || t.session_fee_max || t.sliding_scale ? "teal" : "",
    },
    {
      label: "Insurance",
      value: insuranceSummary,
      tone: insuranceList.length ? "teal" : "",
    },
    {
      label: "Languages",
      value: languageSummary,
      tone: "",
    },
  ]
    .map(function (item) {
      return (
        '<div class="summary-stat"><div class="summary-stat-label">' +
        escapeHtml(item.label) +
        '</div><div class="summary-stat-value ' +
        escapeHtml(item.tone || "") +
        '">' +
        escapeHtml(item.value) +
        "</div></div>"
      );
    })
    .join("");

  var licenseValue =
    [t.license_state, t.license_number].filter(Boolean).join(" · ") || "Not listed";
  var primaryCtaValue = t.preferred_contact_label || "Not specified";
  var experienceParts = [];
  if (t.bipolar_years_experience) {
    experienceParts.push(String(t.bipolar_years_experience) + "y bipolar");
  }
  if (t.years_experience) {
    experienceParts.push(String(t.years_experience) + "y total");
  }
  var experienceValue = experienceParts.length ? experienceParts.join(" · ") : "Not listed";
  var credentialStats = [
    { label: "License", value: licenseValue, tone: t.license_number ? "teal" : "" },
    {
      label: "Primary CTA",
      value: primaryCtaValue,
      tone: t.preferred_contact_label ? "teal" : "",
    },
    {
      label: "Experience",
      value: experienceValue,
      tone: t.bipolar_years_experience ? "green" : t.years_experience ? "teal" : "",
    },
  ]
    .map(function (item) {
      return (
        '<div class="summary-stat"><div class="summary-stat-label">' +
        escapeHtml(item.label) +
        '</div><div class="summary-stat-value ' +
        escapeHtml(item.tone || "") +
        '">' +
        escapeHtml(item.value) +
        "</div></div>"
      );
    })
    .join("");
  var contactTiming = getContactTimingGuidance(contactStrategy);
  var logisticsSectionLeadHtml =
    '<div class="section-story-card"><div class="section-story-kicker">Access read</div><div class="section-story-title">' +
    escapeHtml(
      t.accepting_new_patients || t.estimated_wait_time
        ? "The access path is visible enough to act on."
        : "This is still more of a logistics check than a ready-now option.",
    ) +
    '</div><div class="section-story-copy">' +
    escapeHtml(reachabilityCopy) +
    "</div></div>";
  var logisticsSignalStripHtml = [
    {
      label: "Openings",
      value: t.accepting_new_patients ? "Accepting now" : "Confirm directly",
    },
    {
      label: "Coverage",
      value: (t.insurance_accepted || []).length
        ? joinNaturalList(t.insurance_accepted.slice(0, 2))
        : "Ask directly",
    },
    {
      label: "Format",
      value:
        t.accepts_telehealth && t.accepts_in_person
          ? "Telehealth + in-person"
          : t.accepts_telehealth
            ? "Telehealth"
            : t.accepts_in_person
              ? "In-person"
              : "Confirm directly",
    },
  ]
    .map(function (item) {
      return (
        '<div class="section-mini-stat"><div class="section-mini-stat-label">' +
        escapeHtml(item.label) +
        '</div><div class="section-mini-stat-value">' +
        escapeHtml(item.value) +
        "</div></div>"
      );
    })
    .join("");
  var sectionNavHtml = "";
  var decisionRailRows = [
    {
      label: "Best next move now",
      value: contactStrategy.routeLabel,
      tone: "green",
    },
    {
      label: "Action timing",
      value: contactTiming.title,
      tone: contactStrategy.confidenceTone === "outcomes" ? "green" : "teal",
    },
    {
      label: "Availability",
      value: t.accepting_new_patients ? "Accepting patients" : "Openings to confirm",
      tone: t.accepting_new_patients ? "green" : "",
    },
    {
      label: "Insurance",
      value: (t.insurance_accepted || []).length
        ? joinNaturalList(t.insurance_accepted.slice(0, 2))
        : "Coverage to confirm",
      tone: (t.insurance_accepted || []).length ? "teal" : "",
    },
    {
      label: "Fees",
      value:
        t.session_fee_min && t.session_fee_max
          ? "$" + t.session_fee_min + "-$" + t.session_fee_max
          : t.sliding_scale
            ? "Sliding scale"
            : "Fees to confirm",
      tone: t.session_fee_min || t.session_fee_max || t.sliding_scale ? "teal" : "",
    },
  ]
    .map(function (item) {
      return (
        '<div class="rail-row"><span class="info-label">' +
        escapeHtml(item.label) +
        '</span><span class="info-val ' +
        escapeHtml(item.tone || "") +
        '">' +
        escapeHtml(item.value) +
        "</span></div>"
      );
    })
    .join("");

  var secondaryButtons =
    '<button type="button" class="btn-website shortlist-profile-btn" data-shortlist-trigger="profile">Save to list</button>';
  if (t.phone && t.preferred_contact_method !== "phone") {
    secondaryButtons +=
      '<a href="tel:' + escapeHtml(t.phone) + '" class="btn-website">Call practice</a>';
  }
  if (t.email && t.email !== "contact@example.com" && t.preferred_contact_method !== "email") {
    secondaryButtons +=
      '<a href="mailto:' + escapeHtml(t.email) + '" class="btn-website">Email</a>';
  }
  if (t.website && websiteHealthy && t.preferred_contact_method !== "website") {
    secondaryButtons +=
      '<a href="' +
      escapeHtml(t.website) +
      '" target="_blank" rel="noopener" class="btn-website">Visit website</a>';
  }
  if (t.booking_url && bookingHealthy && t.preferred_contact_method !== "booking") {
    secondaryButtons +=
      '<a href="' +
      escapeHtml(t.booking_url) +
      '" target="_blank" rel="noopener" class="btn-website">Booking link</a>';
  }
  secondaryButtons +=
    '<a href="portal.html?slug=' +
    encodeURIComponent(t.slug) +
    '" class="btn-website">Claim or manage profile</a>';
  contactBtns =
    '<div class="profile-actions-intro"><div class="profile-actions-intro-label">Recommended first move</div><div class="profile-actions-intro-title">' +
    escapeHtml(contactStrategy.routeLabel) +
    '</div><div class="profile-actions-intro-copy">' +
    escapeHtml(contactStrategy.routeReason) +
    "</div></div>" +
    '<div class="profile-actions-header"><div class="profile-actions-kicker">Outreach cockpit</div><div class="profile-actions-title">Make one strong first move, not three hesitant ones.</div><div class="profile-actions-microcopy">This rail is built to help you choose the safest route, send a more credible first message, and know exactly when to pivot if the first path stalls.</div></div>' +
    '<div class="contact-strategy-card"><div class="contact-strategy-kicker">Best outreach path</div><div class="contact-strategy-title">' +
    escapeHtml(contactStrategy.routeLabel) +
    '</div><div class="contact-strategy-copy">' +
    escapeHtml(contactStrategy.routeReason) +
    '</div><div class="contact-strategy-highlight"><strong>Why this route now:</strong> ' +
    escapeHtml(contactStrategy.proofLine) +
    '</div><div class="contact-strategy-confidence tone-' +
    escapeHtml(contactStrategy.confidenceTone) +
    '"><div class="contact-strategy-confidence-label">' +
    escapeHtml(contactStrategy.confidenceLabel) +
    '</div><div class="contact-strategy-confidence-note">' +
    escapeHtml(contactStrategy.confidenceNote) +
    '</div></div><div class="contact-strategy-grid"><div class="contact-strategy-item"><div class="contact-strategy-label">Expected reply window</div><div class="contact-strategy-value ' +
    escapeHtml(contactStrategy.timingTone) +
    '">' +
    escapeHtml(contactStrategy.replyWindowCopy) +
    '</div></div><div class="contact-strategy-item"><div class="contact-strategy-label">Follow up if needed</div><div class="contact-strategy-value">' +
    escapeHtml(contactStrategy.followUpCopy) +
    '</div></div><div class="contact-strategy-item"><div class="contact-strategy-label">If this stalls</div><div class="contact-strategy-value">' +
    escapeHtml(contactStrategy.backupPlanCopy) +
    "</div></div></div></div>" +
    '<div class="profile-cockpit-strip">' +
    contactPrepCardsHtml +
    "</div>" +
    '<div class="profile-primary-action"><div class="primary-action-frame"><div class="primary-action-label">Primary action</div>' +
    (primaryButton || '<a href="directory.html" class="btn-contact">Back to directory</a>') +
    '<div class="profile-primary-caption">' +
    escapeHtml(bestNextStepCopy) +
    "</div></div></div>" +
    renderBackupCard(backupState) +
    '<div class="profile-secondary-actions"><div class="profile-secondary-label">More ways to act</div>' +
    secondaryButtons +
    "</div>";
  void contactBtns;

  var bioBodyHtml =
    (t.bio
      ? '<p class="profile-bio-paragraph">' + escapeHtml(t.bio) + "</p>"
      : '<p class="profile-bio-paragraph profile-bio-empty">No extended bio has been added to this profile yet.</p>') +
    (t.care_approach
      ? '<p class="profile-bio-paragraph profile-bio-approach">' +
        escapeHtml(t.care_approach) +
        "</p>"
      : "");

  var html =
    '<div class="profile-header">' +
    '<div class="profile-hero-main">' +
    '<div class="profile-hero-top">' +
    '<div class="profile-identity">' +
    '<div class="avatar">' +
    avatar +
    "</div>" +
    '<div class="profile-main"><div class="profile-eyebrow-row"><div class="eyebrow">Bipolar-informed therapist profile</div>' +
    acceptingBadge +
    "</div>" +
    "<h1>" +
    escapeHtml(t.name) +
    "</h1>" +
    (t.credentials ? '<div class="creds">' + escapeHtml(t.credentials) + "</div>" : "") +
    (t.title ? '<div class="title-text">' + escapeHtml(t.title) + "</div>" : "") +
    (t.practice_name
      ? '<div class="title-text practice-line">' + escapeHtml(t.practice_name) + "</div>"
      : "") +
    '<div class="location">📍 ' +
    escapeHtml(t.city) +
    ", " +
    escapeHtml(t.state) +
    (t.zip ? " " + escapeHtml(t.zip) : "") +
    "</div>" +
    '<div class="hero-meta">' +
    (trustPills ? '<div class="trust-pills">' + trustPills + "</div>" : "") +
    "</div></div></div>" +
    '<div class="profile-contact-card">' +
    '<div class="profile-contact-card-label">Contact</div>' +
    (t.phone
      ? '<a href="tel:' +
        escapeHtml(t.phone) +
        '" class="profile-contact-row"><span class="profile-contact-icon" aria-hidden="true">📞</span><span class="profile-contact-value">' +
        escapeHtml(t.phone) +
        "</span></a>"
      : "") +
    (t.email && t.email !== "contact@example.com"
      ? '<a href="mailto:' +
        escapeHtml(t.email) +
        '" class="profile-contact-row"><span class="profile-contact-icon" aria-hidden="true">✉️</span><span class="profile-contact-value">' +
        escapeHtml(t.email) +
        "</span></a>"
      : "") +
    (t.website && websiteHealthy
      ? '<a href="' +
        escapeHtml(t.website) +
        '" target="_blank" rel="noopener" class="profile-contact-row"><span class="profile-contact-icon" aria-hidden="true">🌐</span><span class="profile-contact-value">' +
        escapeHtml(t.website.replace(/^https?:\/\//, "")) +
        "</span></a>"
      : "") +
    (t.booking_url && bookingHealthy
      ? '<a href="' +
        escapeHtml(t.booking_url) +
        '" target="_blank" rel="noopener" class="profile-contact-row"><span class="profile-contact-icon" aria-hidden="true">📅</span><span class="profile-contact-value">Booking link</span></a>'
      : "") +
    (!t.phone &&
    (!t.email || t.email === "contact@example.com") &&
    !(t.website && websiteHealthy) &&
    !(t.booking_url && bookingHealthy)
      ? '<div class="profile-contact-empty">No direct contact path listed yet.</div>'
      : "") +
    "</div>" +
    "</div>" +
    '<div class="profile-bio-toggle" data-profile-bio-toggle>' +
    '<button type="button" class="profile-bio-toggle-btn" aria-expanded="false" aria-controls="profileBioPanel">' +
    '<span class="profile-bio-toggle-label">Read full bio</span>' +
    '<span class="profile-bio-toggle-icon" aria-hidden="true">+</span>' +
    "</button>" +
    '<div class="profile-bio-panel is-collapsed" id="profileBioPanel">' +
    bioBodyHtml +
    "</div>" +
    "</div>" +
    '<div class="profile-summary-strip">' +
    summaryStats +
    "</div>" +
    '<div class="profile-summary-strip profile-summary-strip-secondary">' +
    credentialStats +
    "</div>" +
    '<div class="profile-hero-actions"><div class="profile-primary-action"><div class="primary-action-frame"><div class="primary-action-label">Primary action</div>' +
    (primaryButton || '<a href="directory.html" class="btn-contact">Back to directory</a>') +
    '<div class="profile-primary-caption">' +
    escapeHtml(bestNextStepCopy) +
    "</div></div></div></div>" +
    "</div>" +
    sectionNavHtml +
    '<div class="profile-body">' +
    "<div>" +
    (function () {
      var hasTextChannel =
        (t.email && t.email !== "contact@example.com") ||
        (t.website && websiteHealthy) ||
        (t.booking_url && bookingHealthy);
      var hasPhone = Boolean(t.phone);
      var callScript = hasPhone ? buildCallScript(t) : null;

      var afterItems = [
        "Notice how the reply lands — warm, informed, and responsive is a good sign.",
        "Ask for a short consult call before committing to ongoing sessions.",
        "It's completely fine to message two or three therapists at once to compare fit.",
      ];

      var renderTipList = function (items) {
        return (
          '<ul class="outreach-tip-list">' +
          items
            .map(function (item) {
              return '<li class="outreach-tip-item">' + escapeHtml(item) + "</li>";
            })
            .join("") +
          "</ul>"
        );
      };

      var messageCardHtml = hasTextChannel
        ? '<div class="next-step-item is-emphasis" data-profile-outreach-script tabindex="-1"><div class="next-step-label">✉️ Draft first message</div><div class="next-step-helper outreach-card-intro">Use this when you\'re sending an email, a website inquiry, or a booking form.</div><div class="contact-script-shell"><div class="contact-script-preview" id="profileContactScriptPreview">' +
          escapeHtml(outreachScript) +
          '</div><div class="contact-script-actions"><button type="button" class="btn-contact" data-profile-copy-script>Copy first message</button><div class="contact-script-helper">Swap the greeting or add one personal detail if you\'d like — you don\'t need to overwork it.</div></div></div></div>'
        : "";

      var callCardHtml = "";
      if (hasPhone && callScript) {
        var phoneDigits = String(t.phone || "").replace(/[^0-9+]/g, "");
        callCardHtml =
          '<div class="next-step-item is-emphasis"><div class="next-step-label">📞 Calling? Here\'s what to say</div><div class="next-step-helper outreach-card-intro">A calm script for when you pick up the phone. Take a breath — you\'ve got this.</div>' +
          '<div class="call-script-shell">' +
          '<div class="call-script-block"><div class="call-script-block-label">When someone answers</div><div class="call-script-block-body"><p>' +
          escapeHtml(callScript.liveOpener) +
          "</p>" +
          (callScript.liveContext
            ? '<p class="call-script-context">' + escapeHtml(callScript.liveContext) + "</p>"
            : "") +
          "</div></div>" +
          '<div class="call-script-block"><div class="call-script-block-label">If you get voicemail</div><div class="call-script-block-body"><p>' +
          escapeHtml(callScript.voicemail) +
          "</p></div></div>" +
          (phoneDigits
            ? '<a href="tel:' +
              escapeHtml(phoneDigits) +
              '" class="btn-contact call-script-cta">Call ' +
              escapeHtml(t.phone) +
              "</a>"
            : "") +
          "</div></div>";
      }

      return (
        '<section class="profile-section profile-section-collapsible" id="section-contact" data-profile-section data-profile-contact-section><button type="button" class="profile-section-header" aria-expanded="true"><span><span class="section-kicker">Outreach</span><h2>How to reach out</h2></span><span class="section-toggle">Hide</span></button><div class="profile-section-content"><div class="outreach-intro">Reaching out is easier than it feels. Pick the path that feels calmest — a written message or a phone call — and use the script below as a starting point.</div><div class="next-step-card">' +
        messageCardHtml +
        callCardHtml +
        (contactGuidance
          ? '<div class="next-step-item"><div class="next-step-label">What this therapist asks you to include</div><div class="outreach-therapist-note">' +
            escapeHtml(contactGuidance) +
            "</div></div>"
          : "") +
        '<div class="next-step-item"><div class="next-step-label">After you hear back</div>' +
        renderTipList(afterItems) +
        "</div>" +
        "</div></div></section>"
      );
    })() +
    "</div>" +
    '<div class="profile-sidebar-stack">' +
    "</div>" +
    '<div style="text-align:center;margin-top:1rem;padding-top:1rem"><a href="directory.html" style="color:var(--teal);text-decoration:none;font-size:.85rem;font-weight:600">← Back to Directory</a></div>';

  document.getElementById("profileWrap").innerHTML = html;
  updateShortlistAction(t.slug);
  var shortlistButtons = Array.prototype.slice.call(
    document.querySelectorAll("[data-shortlist-trigger='profile']"),
  );
  shortlistButtons.forEach(function (shortlistButton) {
    shortlistButton.addEventListener("click", function () {
      toggleShortlist(t.slug);
      updateShortlistAction(t.slug);
      if (typeof window.refreshShortlistNav === "function") {
        window.refreshShortlistNav();
      }
    });
  });
  var prioritySelect = document.getElementById("profileShortlistPriority");
  if (prioritySelect) {
    prioritySelect.addEventListener("change", function () {
      updateShortlistPriority(t.slug, prioritySelect.value);
      updateShortlistAction(t.slug);
      if (typeof window.refreshShortlistNav === "function") {
        window.refreshShortlistNav();
      }
    });
  }
  var noteInput = document.getElementById("profileShortlistNote");
  if (noteInput) {
    noteInput.addEventListener("input", function () {
      updateShortlistNote(t.slug, noteInput.value);
      updateShortlistNoteMeta(noteInput.value);
    });
    noteInput.addEventListener("change", function () {
      updateShortlistNote(t.slug, noteInput.value);
      updateShortlistNoteMeta(noteInput.value);
      updateShortlistAction(t.slug);
      if (typeof window.refreshShortlistNav === "function") {
        window.refreshShortlistNav();
      }
    });
  }
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-contact-route]"))
    .forEach(function (link) {
      link.addEventListener("click", function () {
        var route = link.getAttribute("data-profile-contact-route") || "";
        rememberTherapistContactRoute(t.slug, route, "profile");
        trackFunnelEvent("profile_contact_route_clicked", {
          priority: link.getAttribute("data-profile-contact-priority") || "unknown",
          ...getContactAnalyticsMeta(t, route),
        });
      });
    });
  var contactSection = document.querySelector("[data-profile-contact-section]");
  var contactSectionTracked = false;
  if (contactSection && typeof window.IntersectionObserver === "function") {
    var contactObserver = new window.IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting || contactSectionTracked) {
            return;
          }
          contactSectionTracked = true;
          trackFunnelEvent("profile_contact_section_viewed", getContactAnalyticsMeta(t, "section"));
          contactObserver.disconnect();
        });
      },
      {
        threshold: 0.45,
      },
    );
    contactObserver.observe(contactSection);
  }
  var outreachScriptCard = document.querySelector("[data-profile-outreach-script]");
  if (outreachScriptCard) {
    outreachScriptCard.addEventListener("click", function () {
      trackFunnelEvent("profile_outreach_script_engaged", getContactAnalyticsMeta(t, "script"));
    });
  }
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-focus-script]"))
    .forEach(function (button) {
      button.addEventListener("click", function () {
        var scriptCard = document.querySelector("[data-profile-outreach-script]");
        if (!scriptCard) {
          return;
        }
        scriptCard.scrollIntoView({ behavior: "smooth", block: "center" });
        window.setTimeout(function () {
          scriptCard.focus({ preventScroll: true });
        }, 220);
        trackFunnelEvent("profile_outreach_script_focused", getContactAnalyticsMeta(t, "script"));
      });
    });
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-copy-script]"))
    .forEach(function (button) {
      button.addEventListener("click", async function () {
        var message = String(outreachScript || "").trim();
        if (!message) {
          return;
        }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(message);
            button.textContent = "Copied first message";
            window.setTimeout(function () {
              button.textContent = "Copy first message";
            }, 1800);
          }
        } catch (_error) {
          button.textContent = "Copy manually below";
          window.setTimeout(function () {
            button.textContent = "Copy first message";
          }, 1800);
        }
        trackFunnelEvent("profile_outreach_script_copied", getContactAnalyticsMeta(t, "script"));
      });
    });
  var contactQuestionsCard = document.querySelector("[data-profile-contact-questions]");
  if (contactQuestionsCard) {
    contactQuestionsCard.addEventListener("click", function () {
      trackFunnelEvent(
        "profile_contact_questions_engaged",
        getContactAnalyticsMeta(t, "questions"),
      );
    });
  }
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-backup-link]"))
    .forEach(function (link) {
      link.addEventListener("click", function () {
        trackFunnelEvent("profile_backup_opened", {
          therapist_slug: t.slug || "",
          backup_slug: link.getAttribute("data-profile-backup-link") || "",
          source: profileSource || "profile",
        });
      });
    });
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-backup-compare]"))
    .forEach(function (link) {
      link.addEventListener("click", function () {
        trackFunnelEvent("profile_backup_compared", {
          therapist_slug: t.slug || "",
          source: profileSource || "profile",
        });
      });
    });
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-queue-outcome]"))
    .forEach(function (button) {
      button.addEventListener("click", function () {
        var outcome = button.getAttribute("data-profile-queue-outcome") || "";
        var saved = recordProfileOutreachOutcome(t, outcome);
        if (!saved) {
          return;
        }
        trackFunnelEvent("profile_queue_outcome_recorded", {
          therapist_slug: t.slug || "",
          source: profileSource || "profile",
          outcome: outcome,
        });
        updateShortlistAction(t.slug);
      });
    });
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-bio-toggle] .profile-bio-toggle-btn"))
    .forEach(function (button) {
      button.addEventListener("click", function () {
        var wrap = button.closest("[data-profile-bio-toggle]");
        var panel = wrap ? wrap.querySelector(".profile-bio-panel") : null;
        var label = button.querySelector(".profile-bio-toggle-label");
        var icon = button.querySelector(".profile-bio-toggle-icon");
        if (!panel) {
          return;
        }
        var collapsed = panel.classList.toggle("is-collapsed");
        button.setAttribute("aria-expanded", collapsed ? "false" : "true");
        if (label) {
          label.textContent = collapsed ? "Read full bio" : "Hide bio";
        }
        if (icon) {
          icon.textContent = collapsed ? "+" : "−";
        }
      });
    });
  Array.prototype.slice
    .call(document.querySelectorAll(".profile-section-header"))
    .forEach(function (button) {
      button.addEventListener("click", function () {
        var section = button.closest("[data-profile-section]");
        var content = section ? section.querySelector(".profile-section-content") : null;
        var toggle = button.querySelector(".section-toggle");
        if (!content || !toggle) {
          return;
        }
        var collapsed = content.classList.toggle("is-collapsed");
        button.setAttribute("aria-expanded", collapsed ? "false" : "true");
        toggle.textContent = collapsed ? "Show" : "Hide";
      });
    });
  if (typeof window.IntersectionObserver === "function") {
    var navLinks = Array.prototype.slice.call(document.querySelectorAll("[data-section-link]"));
    var sectionObserver = new window.IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) {
            return;
          }
          var id = entry.target.id;
          navLinks.forEach(function (link) {
            link.classList.toggle("is-active", link.getAttribute("data-section-link") === id);
          });
        });
      },
      {
        rootMargin: "-20% 0px -60% 0px",
        threshold: 0.1,
      },
    );
    Array.prototype.slice
      .call(document.querySelectorAll("[data-profile-section]"))
      .forEach(function (section) {
        sectionObserver.observe(section);
      });
  }
}
