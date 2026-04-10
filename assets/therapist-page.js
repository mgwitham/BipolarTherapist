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

var profileParams = new URLSearchParams(window.location.search);
var slug = profileParams.get("slug");
var profileSource = profileParams.get("source") || "";
var DIRECTORY_SHORTLIST_KEY = "bth_directory_shortlist_v1";
var OUTREACH_OUTCOMES_KEY = "bth_outreach_outcomes_v1";
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

function renderTagList(items, className) {
  return (items || [])
    .filter(Boolean)
    .map(function (item) {
      return '<span class="' + className + '">' + escapeHtml(item) + "</span>";
    })
    .join("");
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

function buildOutreachScript(therapist) {
  var opener =
    therapist.preferred_contact_method === "phone"
      ? "Hi, I am looking for bipolar-focused support"
      : "Hi, I am looking for bipolar-focused support and wanted to ask about fit";
  var formatCue =
    therapist.accepts_telehealth && therapist.accepts_in_person
      ? "I am open to either telehealth or in-person care."
      : therapist.accepts_telehealth
        ? "I would be hoping for telehealth."
        : therapist.accepts_in_person
          ? "I would be hoping for in-person care."
          : "";
  var medicationCue = therapist.medication_management
    ? "I may also want medication support or coordination."
    : "";

  return [
    opener + ".",
    formatCue,
    medicationCue,
    "Are you currently taking new clients, and what would the first step usually look like?",
  ]
    .filter(Boolean)
    .join(" ");
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
          : "If this stalls after one follow-up, move on to your next shortlist option instead of waiting indefinitely.";

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
    .slice(0, 3);
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
    .slice(0, 3);
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
    copy: "This therapist is already on your shortlist. Start the outreach queue when you want a clear contact-first plan and backup path.",
    ctaLabel: "Start outreach queue",
    ctaHref: queueUrl,
    actions: ["reached_out", "heard_back", "no_response"],
  };
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
        ctaLabel: "Compare shortlist",
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
          " is already on your shortlist as " +
          String(backup.shortlistEntry.priority || "").toLowerCase() +
          ". Keep this option close so you can move without restarting your search."
        : backup.therapist.name +
          " is the clearest backup already on your shortlist if this first path slows down.",
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

  return {
    title: shortlistEntry.priority
      ? "You saved this as " + String(shortlistEntry.priority || "").toLowerCase()
      : "You already saved this therapist",
    copy: shortlistEntry.note
      ? 'Your note: "' + String(shortlistEntry.note || "").trim() + '"'
      : "Add a quick note or shortlist label so future-you can remember why this therapist stood out.",
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
    '</div><a href="' +
    escapeHtml(memoryState.compareHref) +
    '" class="profile-decision-memory-link">Review shortlist</a></div>'
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

  var appended = shortlist.concat({ slug: slugValue, priority: "", note: "" }).slice(0, 3);
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
    button.textContent = shortlisted ? "Saved to shortlist" : "Save to shortlist";
    button.classList.toggle("is-saved", shortlisted);
  });
  status.textContent = shortlisted
    ? "This therapist is saved for comparison in your shortlist."
    : "Save up to 3 therapists to compare later as you narrow toward the right fit.";

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
  var outreachQueueState = buildProfileOutreachQueueState(t.slug);
  trackDirectoryProfileOpenQuality(t, readiness, freshness);
  var readinessTitle =
    readiness.score >= 85
      ? "High match confidence"
      : readiness.score >= 65
        ? "Good match confidence"
        : "Profile still being completed";
  var readinessCopy =
    readiness.score >= 85
      ? "This profile includes the details people usually need to make a confident shortlist decision."
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
  var fitSummaryCopy = fitReasons.length
    ? "This clinician may be worth shortlisting because " +
      fitReasons.slice(0, 3).join(", ") +
      ". You should still confirm availability, insurance, and personal fit directly."
    : "Use this profile to make a first-pass decision on fit, access, and trust. The remaining unknowns are best handled with one focused outreach rather than more scrolling.";
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

  var trustPillItems = [
    t.verification_status === "editorially_verified"
      ? "Editorially verified"
      : "Recently reviewed profile",
    freshnessSignal ? freshnessSignal.label : "",
    t.bipolar_years_experience ? t.bipolar_years_experience + " yrs bipolar care" : "",
    readinessTitle,
    t.medication_management ? "Medication management" : "",
    t.accepts_telehealth ? "Telehealth available" : "",
  ].slice(0, 4);
  var trustPills = trustPillItems
    .filter(Boolean)
    .map(function (pill) {
      return '<span class="trust-pill">' + escapeHtml(pill) + "</span>";
    })
    .join("");

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
  var fitHeadline = "";
  var fitSubheadline = "";
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
    '<button type="button" class="btn-website shortlist-profile-btn" id="profileShortlistButton">Save to shortlist</button>';
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

  var specialties = renderTagList(t.specialties, "spec-tag");
  var modalities = renderTagList(t.treatment_modalities, "spec-tag");
  var populations = renderTagList(t.client_populations, "spec-tag");
  var insTags = renderList(t.insurance_accepted, "ins-item");
  var langPills = renderTagList(t.languages || ["English"], "lang-pill");
  var telehealthStates = renderTagList(t.telehealth_states, "lang-pill");
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
  var outreachScript = buildOutreachScript(t);
  var contactStrategy = getContactStrategy(
    t,
    responsivenessSignal,
    routePerformance,
    routeOutcomePerformance,
  );
  var contactScriptLabel =
    activeTherapistContactExperimentVariant === "action_plan"
      ? "Use this first message"
      : "Simple outreach script";
  var contactQuestionsLabel =
    activeTherapistContactExperimentVariant === "action_plan"
      ? "Ask these first"
      : "Good questions to ask";
  var contactPlanLabel =
    activeTherapistContactExperimentVariant === "action_plan"
      ? "Use this outreach plan"
      : "Reach out with this plan";
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

  fitHeadline = quickFitItems.length
    ? "This looks like a credible bipolar-care option."
    : "This could still be worth contacting, but the page leaves a few key questions for outreach.";
  fitSubheadline = quickFitItems.length
    ? "The first screen should tell you why this profile could be worth contacting."
    : "Use the strongest trust and logistics cues here to decide whether this is a smart first message or a better save-for-later option.";

  var quickFitHtml = renderList(quickFitItems.slice(0, 3), "decision-list-item");
  var bipolarTrustHtml = renderList(bipolarTrustItems.slice(0, 4), "decision-list-item");
  var practicalDetailsHtml = renderList(practicalDetailsItems.slice(0, 4), "decision-list-item");
  var contactChecklistHtml = renderList(
    contactChecklistItems.slice(0, 4),
    "contact-checklist-item",
  );
  var contactQuestionHtml = renderList(contactQuestionItems.slice(0, 4), "contact-checklist-item");
  var fitSnapshotHtml = [
    readiness.score >= 85 ? "High-confidence profile" : readinessTitle,
    bipolarExperience ? bipolarExperience + " yrs bipolar care" : "",
    t.accepting_new_patients ? "Accepting patients" : "Openings to confirm",
    t.medication_management ? "Medication support" : "",
    t.accepts_telehealth ? "Telehealth" : "",
  ]
    .filter(Boolean)
    .map(function (item) {
      return '<span class="snapshot-pill">' + escapeHtml(item) + "</span>";
    })
    .join("");
  var fitSnapshotPanel = fitSnapshotHtml
    ? '<div class="hero-snapshot-panel"><div class="hero-freshness-label">At a glance</div><div class="fit-snapshot-pills">' +
      fitSnapshotHtml +
      "</div></div>"
    : "";
  var summaryStats = [
    {
      label: "Bipolar fit",
      value: bipolarExperience ? bipolarExperience + " years listed" : "Focus areas listed",
      tone: bipolarExperience >= 8 ? "green" : "teal",
    },
    {
      label: "Availability",
      value: t.accepting_new_patients
        ? t.estimated_wait_time || "Accepting patients"
        : "Timing not listed",
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
      label: "Cost path",
      value:
        t.session_fee_min || t.session_fee_max || t.sliding_scale
          ? t.session_fee_min && t.session_fee_max
            ? "$" + t.session_fee_min + "-$" + t.session_fee_max
            : t.sliding_scale
              ? "Sliding scale"
              : "Fee info listed"
          : "Fees to confirm",
      tone: t.session_fee_min || t.session_fee_max || t.sliding_scale ? "teal" : "",
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
  var sectionNavHtml =
    '<div class="profile-section-nav" id="profileSectionNav">' +
    '<a href="#section-fit" class="section-nav-link is-active" data-section-link="section-fit">Fit</a>' +
    '<a href="#section-trust" class="section-nav-link" data-section-link="section-trust">Trust</a>' +
    '<a href="#section-logistics" class="section-nav-link" data-section-link="section-logistics">Logistics</a>' +
    '<a href="#section-contact" class="section-nav-link" data-section-link="section-contact">Contact</a>' +
    '<a href="#section-bio" class="section-nav-link" data-section-link="section-bio">Deep dive</a>' +
    "</div>";
  var decisionRailRows = [
    {
      label: "Best next step",
      value: contactStrategy.routeLabel,
      tone: "green",
    },
    {
      label: "Availability",
      value: t.accepting_new_patients
        ? t.estimated_wait_time || "Accepting patients"
        : "Openings to confirm",
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
    '<button type="button" class="btn-website shortlist-profile-btn" data-shortlist-trigger="profile">Save to shortlist</button>';
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
    '<div class="profile-actions-header"><div class="profile-actions-kicker">Best next step</div><div class="profile-actions-title">' +
    escapeHtml(contactStrategy.routeLabel) +
    "</div></div>" +
    '<div class="contact-strategy-card"><div class="contact-strategy-kicker">Best contact strategy</div><div class="contact-strategy-title">' +
    escapeHtml(contactStrategy.routeLabel) +
    '</div><div class="contact-strategy-copy">' +
    escapeHtml(contactStrategy.routeReason) +
    '</div><div class="contact-strategy-proof">' +
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
    '<div class="profile-primary-action">' +
    (primaryButton || '<a href="directory.html" class="btn-contact">Back to directory</a>') +
    '<div class="profile-primary-caption">' +
    escapeHtml(bestNextStepCopy) +
    "</div></div>" +
    renderBackupCard(backupState) +
    '<div class="profile-secondary-actions"><div class="profile-secondary-label">More ways to act</div>' +
    secondaryButtons +
    "</div>";

  var html =
    '<div class="profile-header">' +
    '<div class="profile-hero-main"><div class="profile-identity"><div class="avatar">' +
    avatar +
    '</div><div class="profile-main"><div class="eyebrow">Bipolar-informed therapist profile</div>' +
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
    acceptingBadge +
    (trustPills ? '<div class="trust-pills">' + trustPills + "</div>" : "") +
    (freshnessSignal || fitSnapshotPanel
      ? '<div class="hero-signal-grid">' +
        (freshnessSignal
          ? '<div class="hero-freshness-banner tone-' +
            escapeHtml(freshnessSignal.tone) +
            '"><div class="hero-freshness-label">Trust freshness</div><div class="hero-freshness-value">' +
            escapeHtml(freshnessSignal.label) +
            '</div><div class="hero-freshness-note">' +
            escapeHtml(freshnessSignal.note) +
            "</div></div>"
          : "") +
        fitSnapshotPanel +
        "</div>"
      : "") +
    "</div>" +
    '<div class="profile-shortlist-status" id="profileShortlistStatus"></div>' +
    '<div class="hero-support-grid">' +
    '<div class="profile-uncertainty-state">' +
    renderUncertaintyCard(uncertaintyState) +
    "</div>" +
    '<div class="profile-decision-memory" id="profileDecisionMemory">' +
    renderDecisionMemoryCard(decisionMemoryState) +
    "</div>" +
    '<div class="profile-queue-status" id="profileQueueStatus">' +
    renderQueueStatusCard(outreachQueueState) +
    "</div>" +
    "</div>" +
    '<div class="profile-shortlist-priority" id="profileShortlistPriorityWrap" style="display:none"><label for="profileShortlistPriority">Shortlist label</label><select id="profileShortlistPriority"><option value="">No label yet</option>' +
    SHORTLIST_PRIORITY_OPTIONS.map(function (option) {
      return '<option value="' + escapeHtml(option) + '">' + escapeHtml(option) + "</option>";
    }).join("") +
    '</select><label for="profileShortlistNote" style="margin-top:0.7rem">Personal note</label><input id="profileShortlistNote" type="text" maxlength="120" placeholder="What stands out about this therapist?" /></div>' +
    "</div></div>" +
    '<div class="hero-verdict-card"><div class="hero-summary-label">Fast fit verdict</div><h2>' +
    escapeHtml(fitHeadline) +
    "</h2><p>" +
    escapeHtml(fitSubheadline) +
    '</p><div class="fit-summary">' +
    escapeHtml(fitSummaryCopy) +
    "</div></div>" +
    '<div class="hero-decision-grid"><div class="hero-summary-card"><div class="hero-summary-label">Why this could fit</div>' +
    (quickFitHtml ||
      '<div class="decision-list-item">Use the focus areas, logistics, and contact strategy below to make a quick first-pass fit decision.</div>') +
    '</div><div class="hero-summary-card"><div class="hero-summary-label">Why this looks trustworthy</div>' +
    (bipolarTrustHtml ||
      '<div class="decision-list-item">Trust details are lighter here, so the best next move is one focused message rather than a long review session.</div>') +
    '</div><div class="hero-summary-card"><div class="hero-summary-label">Practical details up front</div>' +
    (practicalDetailsHtml ||
      '<div class="decision-list-item">Practical details are lighter here, so outreach is the fastest way to confirm cost, timing, and next steps.</div>') +
    "</div></div>" +
    '<div class="profile-summary-strip">' +
    summaryStats +
    "</div>" +
    '<div class="profile-actions">' +
    contactBtns +
    '<div class="contact-checklist"><div class="profile-secondary-label">' +
    escapeHtml(contactPlanLabel) +
    "</div>" +
    contactChecklistHtml +
    "</div>" +
    (contactGuidance
      ? '<div class="action-panel-note">' + escapeHtml(contactGuidance) + "</div>"
      : "") +
    "</div>" +
    "</div>" +
    sectionNavHtml +
    '<div class="profile-body">' +
    "<div>" +
    '<section class="profile-section profile-section-collapsible" id="section-fit" data-profile-section><button type="button" class="profile-section-header" aria-expanded="true"><span><span class="section-kicker">Fit</span><h2>Why this profile may fit</h2></span><span class="section-toggle">Hide</span></button><div class="profile-section-content"><div class="bio-text">' +
    escapeHtml(fitSummaryCopy) +
    "</div>" +
    (quickFitHtml
      ? '<div class="decision-list" style="margin-top:0.95rem">' + quickFitHtml + "</div>"
      : "") +
    (specialties
      ? '<div class="profile-subsection"><div class="mini-section-label">Conditions and focus areas</div><div class="specialty-grid">' +
        specialties +
        "</div></div>"
      : "") +
    (modalities
      ? '<div class="profile-subsection"><div class="mini-section-label">Treatment approach</div><div class="specialty-grid">' +
        modalities +
        "</div></div>"
      : "") +
    (populations
      ? '<div class="profile-subsection"><div class="mini-section-label">Populations served</div><div class="specialty-grid">' +
        populations +
        "</div></div>"
      : "") +
    "</div></section>" +
    '<section class="profile-section profile-section-collapsible" id="section-trust" data-profile-section><button type="button" class="profile-section-header" aria-expanded="true"><span><span class="section-kicker">Trust</span><h2>Why this looks credible</h2></span><span class="section-toggle">Hide</span></button><div class="profile-section-content"><div class="bio-text">' +
    escapeHtml(reviewedDetailsCopy) +
    "</div>" +
    (bipolarTrustHtml
      ? '<div class="decision-list" style="margin-top:0.95rem">' + bipolarTrustHtml + "</div>"
      : "") +
    (therapistReportedCopy
      ? '<div class="bio-text" style="margin-top:0.8rem">' +
        escapeHtml(therapistReportedCopy) +
        "</div>"
      : "") +
    (recentApplied
      ? '<div class="bio-text" style="margin-top:0.8rem;color:var(--teal-dark)">' +
        escapeHtml(recentApplied.note) +
        "</div>"
      : "") +
    (recentConfirmation
      ? '<div class="bio-text" style="margin-top:0.8rem;color:var(--teal-dark)">' +
        escapeHtml(recentConfirmation.note) +
        "</div>"
      : "") +
    (sourceReviewCopy
      ? '<div class="bio-text" style="margin-top:0.8rem">' + escapeHtml(sourceReviewCopy) + "</div>"
      : "") +
    (freshness.status !== "fresh"
      ? '<div class="bio-text" style="margin-top:0.8rem">' + escapeHtml(freshness.note) + "</div>"
      : "") +
    (operationalTrustSummary
      ? '<div class="bio-text" style="margin-top:0.8rem;color:var(--teal-dark)">' +
        escapeHtml(operationalTrustSummary) +
        "</div>"
      : "") +
    "</div></section>" +
    '<section class="profile-section profile-section-collapsible" id="section-logistics" data-profile-section><button type="button" class="profile-section-header" aria-expanded="true"><span><span class="section-kicker">Logistics</span><h2>Practical details before you contact</h2></span><span class="section-toggle">Hide</span></button><div class="profile-section-content">' +
    (practicalDetailsHtml ? '<div class="decision-list">' + practicalDetailsHtml + "</div>" : "") +
    (insTags
      ? '<div class="profile-subsection"><div class="mini-section-label">Insurance accepted</div><div class="ins-list">' +
        insTags +
        "</div></div>"
      : "") +
    '<div class="profile-subsection"><div class="mini-section-label">Fees</div>' +
    feesHtml +
    "</div>" +
    "</div></section>" +
    '<section class="profile-section profile-section-collapsible" id="section-contact" data-profile-section data-profile-contact-section><button type="button" class="profile-section-header" aria-expanded="true"><span><span class="section-kicker">Contact</span><h2>How to reach out well</h2></span><span class="section-toggle">Hide</span></button><div class="profile-section-content"><div class="next-step-card">' +
    '<div class="next-step-item"><div class="next-step-label">Best first step</div><div class="next-step-value">' +
    escapeHtml(contactStrategy.routeLabel) +
    '</div><div class="next-step-helper">' +
    escapeHtml(contactStrategy.routeReason) +
    "</div></div>" +
    '<div class="next-step-item"><div class="next-step-label">Expected reply window</div><div class="next-step-value ' +
    escapeHtml(contactStrategy.timingTone) +
    '">' +
    escapeHtml(contactStrategy.replyWindowCopy) +
    "</div></div>" +
    '<div class="next-step-item" data-profile-outreach-script><div class="next-step-label">' +
    escapeHtml(contactScriptLabel) +
    '</div><div class="next-step-value">' +
    escapeHtml(outreachScript) +
    "</div></div>" +
    (t.estimated_wait_time
      ? '<div class="next-step-item"><div class="next-step-label">Recent availability note</div><div class="next-step-value">' +
        escapeHtml(t.estimated_wait_time) +
        "</div></div>"
      : "") +
    (contactGuidance
      ? '<div class="next-step-item"><div class="next-step-label">What to include</div><div class="next-step-value">' +
        escapeHtml(contactGuidance) +
        "</div></div>"
      : "") +
    (contactQuestionHtml
      ? '<div class="next-step-item" data-profile-contact-questions><div class="next-step-label">' +
        escapeHtml(contactQuestionsLabel) +
        '</div><div class="next-step-question-list">' +
        contactQuestionHtml +
        "</div></div>"
      : "") +
    '<div class="next-step-item"><div class="next-step-label">Follow up if needed</div><div class="next-step-value">' +
    escapeHtml(contactStrategy.followUpCopy) +
    "</div></div>" +
    '<div class="next-step-item"><div class="next-step-label">If this stalls</div><div class="next-step-value">' +
    escapeHtml(contactStrategy.backupPlanCopy) +
    "</div></div>" +
    (outreachQueueState
      ? '<div class="next-step-item"><div class="next-step-label">Queue status</div><div class="next-step-value">' +
        escapeHtml(outreachQueueState.title) +
        '</div><div class="next-step-helper">' +
        escapeHtml(outreachQueueState.copy) +
        '</div><a href="' +
        escapeHtml(outreachQueueState.ctaHref) +
        '" class="profile-queue-inline-link">' +
        escapeHtml(outreachQueueState.ctaLabel) +
        "</a>" +
        renderQueueActionButtons(outreachQueueState) +
        "</div>"
      : "") +
    '<div class="next-step-item"><div class="next-step-label">What usually comes next</div><div class="next-step-value">' +
    escapeHtml(bestNextStepCopy) +
    "</div></div></div></div></section>" +
    '<section class="profile-section profile-section-collapsible" id="section-bio" data-profile-section><button type="button" class="profile-section-header" aria-expanded="false"><span><span class="section-kicker">Deep dive</span><h2>About this therapist</h2></span><span class="section-toggle">Show</span></button><div class="profile-section-content is-collapsed"><div class="bio-text">' +
    escapeHtml(
      t.bio ||
        "A longer bio is not available on this profile yet. Use the fit, trust, and contact sections above to decide whether this therapist is worth a first outreach.",
    ) +
    "</div>" +
    (t.care_approach
      ? '<div class="bio-text" style="margin-top:0.8rem;color:var(--teal-dark)">' +
        escapeHtml(t.care_approach) +
        "</div>"
      : "") +
    "</div></section>" +
    "</div>" +
    '<div class="profile-sidebar-stack">' +
    '<div class="sidebar-panel decision-rail-panel"><h3>Decision rail</h3>' +
    '<div class="match-confidence-note" style="margin-bottom:0.8rem">' +
    escapeHtml(
      "Use this rail to decide quickly whether to contact now, save for later, or keep comparing.",
    ) +
    "</div>" +
    decisionRailRows +
    "</div>" +
    '<div class="sidebar-panel trust-panel"><h3>Trust and fit</h3>' +
    '<div class="match-confidence-note" style="margin-bottom:0.8rem">' +
    escapeHtml(standoutCopy) +
    "</div>" +
    '<div class="info-row"><span class="info-label">Match confidence</span><span class="info-val green">' +
    escapeHtml(readinessTitle) +
    "</span></div>" +
    '<div class="match-confidence-note">' +
    escapeHtml(readinessCopy) +
    '</div><div class="match-confidence-note">' +
    escapeHtml(
      "This signal reflects how complete and decision-ready the profile appears. It does not guarantee personal chemistry, exact live availability, or clinical quality.",
    ) +
    "</div>" +
    (responsivenessSignal
      ? '<div class="info-row"><span class="info-label">Contact responsiveness</span><span class="info-val ' +
        (responsivenessSignal.tone === "positive" ? "green" : "teal") +
        '">' +
        escapeHtml(responsivenessSignal.label) +
        '</span></div><div class="responsiveness-note">' +
        escapeHtml(responsivenessSignal.note) +
        '</div><div class="responsiveness-note">' +
        escapeHtml(
          "This speaks only to contact follow-through patterns, not care quality or clinical outcomes.",
        ) +
        "</div>"
      : "") +
    '<div class="info-row"><span class="info-label">Verification</span><span class="info-val green">' +
    escapeHtml(
      t.verification_status === "editorially_verified"
        ? "Editorially verified"
        : "Recently reviewed profile",
    ) +
    '</span></div><div class="responsiveness-note">' +
    escapeHtml(
      t.verification_status === "editorially_verified"
        ? "Editorial verification means key profile details were reviewed. It is not a rating of therapeutic quality or fit."
        : "This profile still gives a useful first-pass picture, but some details may need a direct check before you decide.",
    ) +
    "</div>" +
    (sourceReviewedDate
      ? '<div class="info-row"><span class="info-label">Source review</span><span class="info-val">' +
        escapeHtml(sourceReviewedDate) +
        "</span></div>"
      : "") +
    (recentConfirmation && therapistReportedDate
      ? '<div class="info-row"><span class="info-label">Therapist re-confirmed</span><span class="info-val green">' +
        escapeHtml(therapistReportedDate) +
        '</span></div><div class="responsiveness-note">' +
        escapeHtml(
          "This means key operational details were recently re-confirmed directly by the specialist. It does not guarantee exact live availability or personal fit.",
        ) +
        "</div>"
      : "") +
    (recentApplied
      ? '<div class="info-row"><span class="info-label">Recently updated</span><span class="info-val green">' +
        escapeHtml(recentApplied.label) +
        '</span></div><div class="responsiveness-note">' +
        escapeHtml(recentApplied.note) +
        "</div>"
      : "") +
    '<div class="info-row"><span class="info-label">Freshness</span><span class="info-val ' +
    (freshness.status === "fresh" ? "green" : "teal") +
    '">' +
    escapeHtml(freshness.label) +
    "</span></div>" +
    '<div class="info-row"><span class="info-label">License</span><span class="info-val">' +
    escapeHtml([t.license_state, t.license_number].filter(Boolean).join(" · ") || "Not listed") +
    "</span></div>" +
    (t.preferred_contact_method
      ? '<div class="info-row"><span class="info-label">Preferred contact</span><span class="info-val">' +
        escapeHtml(
          t.preferred_contact_method === "booking" ? "Booking link" : t.preferred_contact_method,
        ) +
        "</span></div>"
      : "") +
    (t.preferred_contact_label
      ? '<div class="info-row"><span class="info-label">Primary CTA</span><span class="info-val">' +
        escapeHtml(t.preferred_contact_label) +
        "</span></div>"
      : "") +
    (t.bipolar_years_experience
      ? '<div class="info-row"><span class="info-label">Bipolar-specific experience</span><span class="info-val">' +
        escapeHtml(t.bipolar_years_experience) +
        " years</span></div>"
      : "") +
    (t.years_experience
      ? '<div class="info-row"><span class="info-label">Total experience</span><span class="info-val">' +
        escapeHtml(t.years_experience) +
        " years</span></div>"
      : "") +
    "</div>" +
    '<div class="sidebar-panel"><h3>Access details</h3>' +
    '<div class="match-confidence-note" style="margin-bottom:0.8rem">' +
    escapeHtml(reachabilityCopy) +
    "</div>" +
    '<div class="info-row"><span class="info-label">Status</span><span class="info-val ' +
    (t.accepting_new_patients ? "green" : "") +
    '">' +
    escapeHtml(t.accepting_new_patients ? "Accepting patients" : "Waitlist") +
    "</span></div>" +
    '<div class="info-row"><span class="info-label">Telehealth</span><span class="info-val ' +
    (t.accepts_telehealth ? "green" : "") +
    '">' +
    escapeHtml(t.accepts_telehealth ? "Available" : "Not offered") +
    "</span></div>" +
    '<div class="info-row"><span class="info-label">In-person</span><span class="info-val ' +
    (t.accepts_in_person ? "teal" : "") +
    '">' +
    escapeHtml(t.accepts_in_person ? "Available" : "Not offered") +
    "</span></div>" +
    '<div class="info-row"><span class="info-label">Medication management</span><span class="info-val">' +
    escapeHtml(t.medication_management ? "Offered" : "No") +
    "</span></div>" +
    (t.estimated_wait_time
      ? '<div class="info-row"><span class="info-label">Availability note</span><span class="info-val">' +
        escapeHtml(t.estimated_wait_time) +
        "</span></div>"
      : "") +
    (langPills
      ? '<div class="info-row"><span class="info-label">Languages</span><div class="lang-pills">' +
        langPills +
        "</div></div>"
      : "") +
    (telehealthStates
      ? '<div class="info-row"><span class="info-label">Telehealth states</span><div class="lang-pills">' +
        telehealthStates +
        "</div></div>"
      : "") +
    "</div>" +
    '<div class="sidebar-panel"><h3>Session fees</h3>' +
    feesHtml +
    "</div>" +
    '<div class="sidebar-panel"><h3>Contact</h3>' +
    (contactGuidance
      ? '<p class="action-panel-note" style="margin-bottom:0.8rem">' +
        escapeHtml(contactGuidance) +
        "</p>"
      : "") +
    (t.phone
      ? '<div class="contact-item"><span class="contact-icon">📞</span><a href="tel:' +
        escapeHtml(t.phone) +
        '">' +
        escapeHtml(t.phone) +
        "</a></div>"
      : "") +
    (t.email && t.email !== "contact@example.com"
      ? '<div class="contact-item"><span class="contact-icon">✉️</span><a href="mailto:' +
        escapeHtml(t.email) +
        '">' +
        escapeHtml(t.email) +
        "</a></div>"
      : "") +
    (t.website
      ? '<div class="contact-item"><span class="contact-icon">🌐</span><a href="' +
        escapeHtml(t.website) +
        '" target="_blank" rel="noopener">' +
        escapeHtml(t.website.replace(/^https?:\/\//, "")) +
        "</a></div>"
      : "") +
    (!t.phone && (!t.email || t.email === "contact@example.com") && !t.website
      ? '<p style="font-size:.85rem;color:var(--muted)">A direct contact path is not listed here yet. If this profile still looks promising, save it and compare it with stronger-contact options.</p>'
      : "") +
    "</div></div>" +
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
    noteInput.addEventListener("change", function () {
      updateShortlistNote(t.slug, noteInput.value);
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
