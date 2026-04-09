import { isBookingRouteHealthy, isWebsiteRouteHealthy } from "./route-health.js";

function buildRouteLearningMap(outcomes, buildLearningSegments) {
  var entries = Array.isArray(outcomes) ? outcomes : [];
  var learning = {};

  function ensureBucket(segment, routeType) {
    var key = "route::" + segment;
    if (!learning[key]) {
      learning[key] = {};
    }
    if (!learning[key][routeType]) {
      learning[key][routeType] = {
        success: 0,
        attempts: 0,
      };
    }
    return learning[key][routeType];
  }

  entries.forEach(function (item) {
    if (!item || !item.route_type) {
      return;
    }

    var segments = buildLearningSegments(
      item.context && item.context.profile ? item.context.profile : null,
    );

    segments.forEach(function (segment) {
      var bucket = ensureBucket(segment, item.route_type);
      bucket.attempts += 1;
      if (item.outcome === "booked_consult" || item.outcome === "good_fit_call") {
        bucket.success += 1;
      }
    });
  });

  return learning;
}

export function rankEntriesForProfile(profile, options) {
  var settings = options || {};
  var baseEntries = settings.orderMatchEntries(
    settings.rankTherapistsForUser(settings.therapists, profile, settings.latestLearningSignals),
    profile,
  );
  return settings.applySecondPassRefinement(baseEntries, profile, settings.activeSecondPassMode);
}

export function buildStarterProfile(options) {
  var settings = options || {};
  return settings.buildUserMatchProfile({
    care_state: "CA",
    care_intent: "Therapy",
    care_format: "Telehealth",
    needs_medication_management: "Open to either",
    insurance: "",
    budget_max: "",
    priority_mode: "Best overall fit",
    urgency: "ASAP",
    bipolar_focus: [],
    preferred_modalities: [],
    population_fit: [],
    language_preferences: [],
    cultural_preferences: "",
    location_query: "",
  });
}

export function getResponsivenessScore(therapist, options) {
  var settings = options || {};
  var signal = settings.getPublicResponsivenessSignal(therapist);
  if (!signal) {
    return 0;
  }
  if (signal.tone === "positive") {
    return 2;
  }
  return 1;
}

export function buildLearningSegments(profile) {
  var normalized = profile || {};
  var segments = ["all"];

  if (normalized.care_format) {
    segments.push("format:" + normalized.care_format.toLowerCase());
  }
  if (normalized.care_intent) {
    segments.push("intent:" + normalized.care_intent.toLowerCase());
  }
  if (
    normalized.needs_medication_management &&
    normalized.needs_medication_management !== "Open to either"
  ) {
    segments.push(
      "medication:" +
        String(normalized.needs_medication_management).toLowerCase().replace(/\s+/g, "-"),
    );
  }
  if (normalized.insurance && String(normalized.insurance).trim()) {
    segments.push("insurance:user");
  }
  if (normalized.urgency && normalized.urgency !== "ASAP") {
    segments.push("urgency:" + String(normalized.urgency).toLowerCase().replace(/\s+/g, "-"));
  }

  return segments;
}

export function buildFallbackLearningMap(outcomes, options) {
  var settings = options || {};
  var entries = Array.isArray(outcomes) ? outcomes : [];
  var byJourney = entries.reduce(function (accumulator, item) {
    if (!item || !item.journey_id) {
      return accumulator;
    }
    if (!accumulator[item.journey_id]) {
      accumulator[item.journey_id] = [];
    }
    accumulator[item.journey_id].push(item);
    return accumulator;
  }, {});
  var learning = {};

  function ensureBucket(trigger, segment, slug) {
    var key = trigger + "::" + segment;
    if (!learning[key]) {
      learning[key] = {};
    }
    if (!learning[key][slug]) {
      learning[key][slug] = {
        success: 0,
        attempts: 0,
      };
    }
    return learning[key][slug];
  }

  Object.keys(byJourney).forEach(function (journeyId) {
    var journey = byJourney[journeyId].slice().sort(function (a, b) {
      return new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime();
    });
    var firstRankNegative = journey.find(function (item) {
      return (
        item.rank_position === 1 &&
        ["no_response", "waitlist", "insurance_mismatch"].includes(item.outcome)
      );
    });

    if (!firstRankNegative) {
      return;
    }

    var segments = settings.buildLearningSegments(
      firstRankNegative.context && firstRankNegative.context.profile
        ? firstRankNegative.context.profile
        : null,
    );
    var fallbackEvents = journey.filter(function (item) {
      return item.rank_position > 1;
    });

    fallbackEvents.forEach(function (event) {
      segments.forEach(function (segment) {
        var bucket = ensureBucket(firstRankNegative.outcome, segment, event.therapist_slug);
        bucket.attempts += 1;
        if (event.outcome === "booked_consult" || event.outcome === "good_fit_call") {
          bucket.success += 1;
        }
      });
    });
  });

  return learning;
}

export function getRouteLearningForProfile(profile, entry, outcomes, options) {
  var settings = options || {};
  var routeType = settings.getPreferredRouteType(entry);
  var segments = settings.buildLearningSegments(profile);
  var routeLearning = buildRouteLearningMap(outcomes, settings.buildLearningSegments);
  var score = 0;
  var success = 0;
  var attempts = 0;

  segments.forEach(function (segment) {
    var bucket =
      routeLearning["route::" + segment] && routeLearning["route::" + segment][routeType];
    if (!bucket) {
      return;
    }
    success += bucket.success;
    attempts += bucket.attempts;
    score += bucket.success * 3 + Math.max(0, bucket.attempts - bucket.success);
  });

  return {
    routeType: routeType,
    score: score,
    success: success,
    attempts: attempts,
  };
}

export function getPreferredOutreach(entry, options) {
  var settings = options || {};
  if (!entry || !entry.therapist) {
    return null;
  }

  var therapist = entry.therapist;
  var customLabel = String(therapist.preferred_contact_label || "").trim();
  var bookingHealthy = isBookingRouteHealthy(therapist);
  var websiteHealthy = isWebsiteRouteHealthy(therapist);
  if (therapist.preferred_contact_method === "booking" && therapist.booking_url && bookingHealthy) {
    return {
      label: customLabel || "Book consultation",
      href: therapist.booking_url,
      external: true,
    };
  }
  if (therapist.preferred_contact_method === "website" && therapist.website && websiteHealthy) {
    return {
      label: customLabel || "Visit website",
      href: therapist.website,
      external: true,
    };
  }
  if (therapist.preferred_contact_method === "phone" && therapist.phone) {
    return {
      label: customLabel || "Call therapist",
      href: "tel:" + therapist.phone,
      external: false,
    };
  }

  var emailLink = settings.getTherapistContactEmailLink(entry);
  if (emailLink) {
    return {
      label: customLabel || "Email therapist",
      href: emailLink,
      external: false,
    };
  }

  return null;
}

export function getPreferredRouteType(entry) {
  var therapist = entry && entry.therapist ? entry.therapist : null;
  if (!therapist) {
    return "profile";
  }
  var bookingHealthy = isBookingRouteHealthy(therapist);
  var websiteHealthy = isWebsiteRouteHealthy(therapist);

  if (therapist.preferred_contact_method === "booking" && therapist.booking_url && bookingHealthy) {
    return "booking";
  }
  if (therapist.preferred_contact_method === "website" && therapist.website && websiteHealthy) {
    return "website";
  }
  if (therapist.preferred_contact_method === "phone" && therapist.phone) {
    return "phone";
  }
  if (
    therapist.preferred_contact_method === "email" &&
    therapist.email &&
    therapist.email !== "contact@example.com"
  ) {
    return "email";
  }
  if (therapist.booking_url && bookingHealthy) {
    return "booking";
  }
  if (therapist.website && websiteHealthy) {
    return "website";
  }
  if (therapist.phone) {
    return "phone";
  }
  if (therapist.email && therapist.email !== "contact@example.com") {
    return "email";
  }
  return "profile";
}

export function getRoutePriority(contactReadiness) {
  if (!contactReadiness) {
    return 0;
  }
  if (contactReadiness.tone === "high") {
    return 3;
  }
  if (contactReadiness.tone === "medium") {
    return 2;
  }
  return 1;
}

export function hasInsuranceClarity(profile, therapist) {
  if (!profile || !profile.insurance) {
    return false;
  }
  return (therapist.insurance_accepted || []).includes(profile.insurance);
}

export function hasCostClarity(therapist) {
  return Boolean(
    therapist &&
    (therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale),
  );
}

export function pickRecommendedFirstContact(profile, entries, options) {
  var settings = options || {};
  var shortlist = (entries || []).slice(0, settings.shortlistLimit || 3);
  if (!shortlist.length) {
    return null;
  }
  var outreachOutcomes = settings.readOutreachOutcomes();
  var shortcutInfluence = settings.getShortcutInfluence(profile, shortlist);

  var ranked = shortlist
    .map(function (entry, index) {
      var therapist = entry.therapist;
      var readiness = settings.getContactReadiness(entry);
      var routeLearning = settings.getRouteLearningForProfile(profile, entry, outreachOutcomes);
      var shortcutSignal = shortcutInfluence[therapist.slug] || null;
      var score = 0;

      score += Math.max(0, 30 - index * 8);
      score += settings.getRoutePriority(readiness) * 10;
      score += therapist.accepting_new_patients ? 6 : 0;
      score +=
        therapist.estimated_wait_time && therapist.estimated_wait_time !== "Waitlist only" ? 4 : 0;
      score += settings.hasInsuranceClarity(profile, therapist) ? 8 : 0;
      score += settings.hasCostClarity(therapist) ? 3 : 0;
      score +=
        therapist.medication_management && profile && profile.needs_medication_management === "Yes"
          ? 6
          : 0;
      score += readiness && readiness.guidance ? 3 : 0;
      score += settings.getResponsivenessScore(therapist) * 6;
      score += Math.min(8, routeLearning.score);
      if (shortcutSignal) {
        score += Math.min(12, shortcutSignal.preference.strong * 4);
        score -= Math.min(8, shortcutSignal.preference.weak * 3);
        if (shortcutSignal.rank === 1) {
          score += 4;
        }
      }

      return {
        entry: entry,
        readiness: readiness,
        routeLearning: routeLearning,
        shortcutSignal: shortcutSignal,
        score: score,
      };
    })
    .sort(function (a, b) {
      return b.score - a.score || a.entry.therapist.name.localeCompare(b.entry.therapist.name);
    });

  return ranked[0];
}
