import { isBookingRouteHealthy, isWebsiteRouteHealthy } from "./route-health.js";
import { insuranceMatches } from "../shared/therapist-picker-options.mjs";
import {
  phoneHref as normalizeTelHref,
  publicHttpUrl as normalizeExternalUrl,
} from "../shared/contact-href.mjs";

export const FEEDBACK_REASON_OPTIONS = [
  "Insurance mismatch",
  "Availability mismatch",
  "Needs medication management",
  "Wrong care format",
  "Weak bipolar specialization",
  "Other",
];

function buildRouteLearningMap(outcomes, buildLearningSegments) {
  const entries = Array.isArray(outcomes) ? outcomes : [];
  const learning = {};

  function ensureBucket(segment, routeType) {
    const key = "route::" + segment;
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

    const segments = buildLearningSegments(
      item.context && item.context.profile ? item.context.profile : null,
    );

    segments.forEach(function (segment) {
      const bucket = ensureBucket(segment, item.route_type);
      bucket.attempts += 1;
      if (item.outcome === "booked_consult" || item.outcome === "good_fit_call") {
        bucket.success += 1;
      }
    });
  });

  return learning;
}

export function rankEntriesForProfile(profile, options) {
  const settings = options || {};
  const baseEntries = settings.orderMatchEntries(
    settings.rankTherapistsForUser(settings.therapists, profile, settings.latestLearningSignals),
    profile,
  );
  return settings.applySecondPassRefinement(baseEntries, profile, settings.activeSecondPassMode);
}

export function getMatchAvailabilityBonus(therapist) {
  if (!therapist) {
    return 0;
  }
  let bonus = 0;
  if (therapist.accepting_new_patients) {
    bonus += 8;
  }
  if (therapist.estimated_wait_time && therapist.estimated_wait_time !== "Waitlist only") {
    bonus += 4;
  }
  return bonus;
}

export function getMatchContactClarityBonus(entry, options) {
  const settings = options || {};
  const readiness = settings.getContactReadiness(entry);
  if (!readiness) {
    return 0;
  }
  let bonus = readiness.tone === "high" ? 8 : readiness.tone === "medium" ? 5 : 2;
  if (readiness.guidance) {
    bonus += 2;
  }
  if (readiness.firstStep) {
    bonus += 2;
  }
  return bonus;
}

export function getSecondPassScore(entry, profile, mode, options) {
  const settings = options || {};
  const evaluation = entry && entry.evaluation ? entry.evaluation : {};
  const breakdown = evaluation.score_breakdown || {};
  const therapist = entry && entry.therapist ? entry.therapist : {};
  const base = Number(evaluation.score || 0) || 0;
  const trust = Number(breakdown.trust || 0) || 0;
  const clinical = Number(breakdown.clinical || 0) || 0;
  const access = Number(breakdown.access || 0) || 0;
  const practical = Number(breakdown.practical || 0) || 0;
  const learned = Number(breakdown.learned || 0) || 0;
  const confidence = Number(evaluation.confidence_score || 0) || 0;
  const completeness = Number(evaluation.completeness_score || 0) || 0;
  const bipolarYears = Math.min(Number(therapist.bipolar_years_experience || 0) || 0, 15);
  const responsiveness = settings.getPublicResponsivenessSignal(therapist) ? 3 : 0;
  const availability = getMatchAvailabilityBonus(therapist);
  const contactClarity = getMatchContactClarityBonus(entry, settings);

  if (mode === "reviewed") {
    return (
      base * 0.62 +
      trust * 1.55 +
      completeness * 0.14 +
      confidence * 0.12 +
      practical * 0.24 +
      (therapist.verification_status === "editorially_verified" ? 8 : 0)
    );
  }

  if (mode === "speed") {
    return base * 0.58 + access * 1.5 + availability + contactClarity * 0.8 + responsiveness;
  }

  if (mode === "specialization") {
    return (
      base * 0.58 +
      clinical * 1.6 +
      bipolarYears * 1.2 +
      (profile && profile.needs_medication_management === "Yes" && therapist.medication_management
        ? 5
        : 0)
    );
  }

  if (mode === "followthrough") {
    return (
      base * 0.58 +
      access * 1.15 +
      learned * 0.8 +
      contactClarity +
      responsiveness +
      availability * 0.35
    );
  }

  return base;
}

export function applySecondPassRefinement(entries, profile, mode, options) {
  // Adaptive ranking disabled: every code path resolves to "balanced"
  // and returns the base order untouched. The branch below is preserved
  // for future reactivation but is currently unreachable.
  if (!mode || mode === "balanced") {
    return (entries || []).slice();
  }

  return (entries || []).slice().sort(function (a, b) {
    const aScore = getSecondPassScore(a, profile, mode, options);
    const bScore = getSecondPassScore(b, profile, mode, options);

    return (
      bScore - aScore ||
      (Number(b?.evaluation?.score) || 0) - (Number(a?.evaluation?.score) || 0) ||
      String(a?.therapist?.name || "").localeCompare(String(b?.therapist?.name || "")) ||
      String(a?.therapist?.slug || "").localeCompare(String(b?.therapist?.slug || ""))
    );
  });
}

export function buildStarterProfile(options) {
  const settings = options || {};
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
  const settings = options || {};
  const signal = settings.getPublicResponsivenessSignal(therapist);
  if (!signal) {
    return 0;
  }
  if (signal.tone === "positive") {
    return 2;
  }
  return 1;
}

export function buildLearningSegments(profile) {
  const normalized = profile || {};
  const segments = ["all"];

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
  const settings = options || {};
  const entries = Array.isArray(outcomes) ? outcomes : [];
  const byJourney = entries.reduce(function (accumulator, item) {
    if (!item || !item.journey_id) {
      return accumulator;
    }
    if (!accumulator[item.journey_id]) {
      accumulator[item.journey_id] = [];
    }
    accumulator[item.journey_id].push(item);
    return accumulator;
  }, {});
  const learning = {};

  function ensureBucket(trigger, segment, slug) {
    const key = trigger + "::" + segment;
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
    const journey = byJourney[journeyId].slice().sort(function (a, b) {
      return new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime();
    });
    const firstRankNegative = journey.find(function (item) {
      return (
        item.rank_position === 1 &&
        ["no_response", "waitlist", "insurance_mismatch"].includes(item.outcome)
      );
    });

    if (!firstRankNegative) {
      return;
    }

    const segments = settings.buildLearningSegments(
      firstRankNegative.context && firstRankNegative.context.profile
        ? firstRankNegative.context.profile
        : null,
    );
    const fallbackEvents = journey.filter(function (item) {
      return item.rank_position > 1;
    });

    fallbackEvents.forEach(function (event) {
      segments.forEach(function (segment) {
        const bucket = ensureBucket(firstRankNegative.outcome, segment, event.therapist_slug);
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
  const settings = options || {};
  const routeType = settings.getPreferredRouteType(entry);
  const segments = settings.buildLearningSegments(profile);
  const routeLearning = buildRouteLearningMap(outcomes, settings.buildLearningSegments);
  let score = 0;
  let success = 0;
  let attempts = 0;

  segments.forEach(function (segment) {
    const bucket =
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
  const settings = options || {};
  if (!entry || !entry.therapist) {
    return null;
  }

  const therapist = entry.therapist;
  const customLabel = String(therapist.preferred_contact_label || "").trim();
  const bookingHealthy = isBookingRouteHealthy(therapist);
  const websiteHealthy = isWebsiteRouteHealthy(therapist);
  const emailLink =
    settings.getTherapistContactEmailLink && settings.getTherapistContactEmailLink(entry);

  // Build every working route in priority order: website → booking → email → phone
  const available = [];
  const websiteHref = normalizeExternalUrl(therapist.website);
  if (websiteHref && websiteHealthy) {
    available.push({
      type: "website",
      label: "Visit their website",
      href: websiteHref,
      external: true,
    });
  }
  const bookingHref = normalizeExternalUrl(therapist.booking_url);
  if (bookingHref && bookingHealthy) {
    available.push({
      type: "booking",
      label: "Book a session",
      href: bookingHref,
      external: true,
    });
  }
  if (emailLink) {
    available.push({ type: "email", label: "Email therapist", href: emailLink, external: false });
  }
  const telHref = normalizeTelHref(therapist.phone);
  if (telHref) {
    available.push({
      type: "phone",
      label: "Call therapist",
      href: telHref,
      external: false,
    });
  }

  if (!available.length) {
    return null;
  }

  // Honour preferred method if it is actually reachable, otherwise fall back
  const preferred = String(therapist.preferred_contact_method || "").trim();
  const match = preferred
    ? available.find(function (r) {
        return r.type === preferred;
      })
    : null;
  const best = match || available[0];

  return { label: customLabel || best.label, href: best.href, external: best.external };
}

export function getPreferredRouteType(entry) {
  const therapist = entry && entry.therapist ? entry.therapist : null;
  if (!therapist) {
    return "profile";
  }
  const bookingHealthy = isBookingRouteHealthy(therapist);
  const websiteHealthy = isWebsiteRouteHealthy(therapist);

  // Build working types in priority order (mirrors getPreferredOutreach): website → booking → email → phone
  const available = [];
  if (normalizeExternalUrl(therapist.website) && websiteHealthy) available.push("website");
  if (normalizeExternalUrl(therapist.booking_url) && bookingHealthy) available.push("booking");
  if (therapist.email && therapist.email !== "contact@example.com") available.push("email");
  if (normalizeTelHref(therapist.phone)) available.push("phone");

  if (!available.length) return "profile";

  const preferred = String(therapist.preferred_contact_method || "").trim();
  if (preferred && available.indexOf(preferred) !== -1) return preferred;
  return available[0];
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
  return insuranceMatches(profile.insurance, therapist.insurance_accepted);
}

export function hasCostClarity(therapist) {
  return Boolean(
    therapist &&
    (therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale),
  );
}

export function pickRecommendedFirstContact(profile, entries, options) {
  const settings = options || {};
  const shortlist = (entries || []).slice(0, settings.shortlistLimit || 6);
  if (!shortlist.length) {
    return null;
  }
  const outreachOutcomes = settings.readOutreachOutcomes();
  const shortcutInfluence = settings.getShortcutInfluence(profile, shortlist);

  const ranked = shortlist
    .map(function (entry, index) {
      const therapist = entry.therapist;
      const readiness = settings.getContactReadiness(entry);
      const routeLearning = settings.getRouteLearningForProfile(profile, entry, outreachOutcomes);
      const shortcutSignal = shortcutInfluence[therapist.slug] || null;
      let score = 0;

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

export function analyzeConciergePatterns(requests) {
  const entries = Array.isArray(requests) ? requests : [];
  const totals = {
    insurance: 0,
    availability: 0,
    medication: 0,
    contact_first: 0,
    fit_uncertainty: 0,
  };

  entries.forEach(function (request) {
    const haystack = [
      request && request.help_topic ? request.help_topic : "",
      request && request.request_note ? request.request_note : "",
      request && request.request_summary ? request.request_summary : "",
    ]
      .join(" ")
      .toLowerCase();

    if (
      haystack.includes("insurance") ||
      haystack.includes("cost") ||
      haystack.includes("coverage")
    ) {
      totals.insurance += 1;
    }
    if (
      haystack.includes("availability") ||
      haystack.includes("wait") ||
      haystack.includes("timing") ||
      haystack.includes("schedule")
    ) {
      totals.availability += 1;
    }
    if (
      haystack.includes("medication") ||
      haystack.includes("psychiatry") ||
      haystack.includes("med support")
    ) {
      totals.medication += 1;
    }
    if (
      haystack.includes("who should i contact first") ||
      haystack.includes("contact first") ||
      haystack.includes("one person first")
    ) {
      totals.contact_first += 1;
    }
    if (
      haystack.includes("best fit") ||
      haystack.includes("fit") ||
      haystack.includes("not sure") ||
      haystack.includes("uncertain")
    ) {
      totals.fit_uncertainty += 1;
    }
  });

  return totals;
}

export function buildLearningSignals(feedback, outreachOutcomes) {
  const entries = Array.isArray(feedback) ? feedback : [];
  const outreach = Array.isArray(outreachOutcomes) ? outreachOutcomes : [];
  const segmentMap = {};

  function ensureSegment(name) {
    if (!segmentMap[name]) {
      segmentMap[name] = {
        negative_reasons: [],
        therapist_adjustments: {},
        outreach_adjustments: {},
      };
    }
    return segmentMap[name];
  }

  entries.forEach(function (item) {
    const profile = item && item.context ? item.context.profile : null;
    const segments = buildLearningSegments(profile);

    segments.forEach(function (segment) {
      const bucket = ensureSegment(segment);
      if (item && item.value === "negative" && Array.isArray(item.reasons)) {
        bucket.negative_reasons = bucket.negative_reasons.concat(item.reasons);
      }
      if (item && item.type === "therapist_feedback" && item.therapist_slug) {
        if (!bucket.therapist_adjustments[item.therapist_slug]) {
          bucket.therapist_adjustments[item.therapist_slug] = 0;
        }
        bucket.therapist_adjustments[item.therapist_slug] += item.value === "positive" ? 3 : -3;
      }
    });
  });

  outreach.forEach(function (item) {
    if (!item || !item.therapist_slug) {
      return;
    }

    const profile = item && item.context ? item.context.profile : null;
    const segments = buildLearningSegments(profile);

    segments.forEach(function (segment) {
      const bucket = ensureSegment(segment);
      if (!bucket.outreach_adjustments[item.therapist_slug]) {
        bucket.outreach_adjustments[item.therapist_slug] = 0;
      }

      if (item.outcome === "heard_back") {
        bucket.outreach_adjustments[item.therapist_slug] += 4;
      } else if (item.outcome === "booked_consult") {
        bucket.outreach_adjustments[item.therapist_slug] += 7;
      } else if (item.outcome === "good_fit_call") {
        bucket.outreach_adjustments[item.therapist_slug] += 8;
      } else if (item.outcome === "reached_out") {
        bucket.outreach_adjustments[item.therapist_slug] += 1;
      } else if (item.outcome === "insurance_mismatch") {
        bucket.outreach_adjustments[item.therapist_slug] -= 4;
      } else if (item.outcome === "waitlist") {
        bucket.outreach_adjustments[item.therapist_slug] -= 3;
      } else if (item.outcome === "no_response") {
        bucket.outreach_adjustments[item.therapist_slug] -= 2;
      }
    });
  });

  const normalizedSegments = Object.keys(segmentMap).reduce(function (accumulator, segment) {
    const bucket = segmentMap[segment];
    const reasonWeights = FEEDBACK_REASON_OPTIONS.reduce(function (reasonAccumulator, reason) {
      const count = bucket.negative_reasons.filter(function (value) {
        return value === reason;
      }).length;

      if (count > 0) {
        reasonAccumulator[reason] = Math.min(8, 2 + count * 2);
      }
      return reasonAccumulator;
    }, {});

    Object.keys(bucket.therapist_adjustments).forEach(function (slug) {
      bucket.therapist_adjustments[slug] = Math.max(
        -10,
        Math.min(10, bucket.therapist_adjustments[slug]),
      );
    });

    Object.keys(bucket.outreach_adjustments).forEach(function (slug) {
      bucket.outreach_adjustments[slug] = Math.max(
        -8,
        Math.min(10, bucket.outreach_adjustments[slug]),
      );
    });

    accumulator[segment] = {
      reason_weights: reasonWeights,
      therapist_adjustments: bucket.therapist_adjustments,
      outreach_adjustments: bucket.outreach_adjustments,
    };
    return accumulator;
  }, {});

  const global = normalizedSegments.all || {
    reason_weights: {},
    therapist_adjustments: {},
    outreach_adjustments: {},
  };

  return {
    reason_weights: global.reason_weights,
    therapist_adjustments: global.therapist_adjustments,
    outreach_adjustments: global.outreach_adjustments,
    segments: normalizedSegments,
  };
}

export function buildShortcutLearningMap(feedback, outreachOutcomes) {
  const entries = Array.isArray(feedback) ? feedback : [];
  const outcomes = Array.isArray(outreachOutcomes) ? outreachOutcomes : [];
  const learning = {};

  function ensureBucket(segment, shortcutType) {
    const key = "shortcut::" + segment;
    if (!learning[key]) {
      learning[key] = {};
    }
    if (!learning[key][shortcutType]) {
      learning[key][shortcutType] = {
        draft: 0,
        compare: 0,
        strong: 0,
        weak: 0,
      };
    }
    return learning[key][shortcutType];
  }

  entries.forEach(function (item) {
    if (!item || item.type !== "shortcut_interaction" || !item.shortcut_type) {
      return;
    }

    const segments = buildLearningSegments(
      item.context && item.context.profile ? item.context.profile : null,
    );
    segments.forEach(function (segment) {
      const bucket = ensureBucket(segment, item.shortcut_type);
      if (item.action === "copy_draft") {
        bucket.draft += 1;
      }
      if (item.action === "focus_compare") {
        bucket.compare += 1;
      }
    });
  });

  outcomes.forEach(function (item) {
    if (!item || !item.shortcut_type) {
      return;
    }

    const segments = buildLearningSegments(
      item.context && item.context.profile ? item.context.profile : null,
    );
    segments.forEach(function (segment) {
      const bucket = ensureBucket(segment, item.shortcut_type);
      if (item.outcome === "booked_consult" || item.outcome === "good_fit_call") {
        bucket.strong += 1;
      }
      if (
        item.outcome === "insurance_mismatch" ||
        item.outcome === "waitlist" ||
        item.outcome === "no_response"
      ) {
        bucket.weak += 1;
      }
    });
  });

  return learning;
}

export function getShortcutPreference(profile, shortcutType, shortcutLearningMap) {
  const segments = buildLearningSegments(profile);
  let score = 0;
  let draft = 0;
  let compare = 0;
  let strong = 0;
  let weak = 0;

  segments.forEach(function (segment) {
    const bucket =
      shortcutLearningMap["shortcut::" + segment] &&
      shortcutLearningMap["shortcut::" + segment][shortcutType];
    if (!bucket) {
      return;
    }
    draft += bucket.draft;
    compare += bucket.compare;
    strong += bucket.strong || 0;
    weak += bucket.weak || 0;
    score +=
      bucket.draft * 3 + bucket.compare * 2 + (bucket.strong || 0) * 8 - (bucket.weak || 0) * 5;
  });

  return {
    score: score,
    draft: draft,
    compare: compare,
    strong: strong,
    weak: weak,
  };
}

export function analyzeOutreachJourneys(outcomes) {
  const entries = Array.isArray(outcomes) ? outcomes : [];
  const byJourney = entries.reduce(function (accumulator, item) {
    if (!item || !item.journey_id) {
      return accumulator;
    }
    if (!accumulator[item.journey_id]) {
      accumulator[item.journey_id] = [];
    }
    accumulator[item.journey_id].push(item);
    return accumulator;
  }, {});

  const totals = {
    fallback_after_no_response: 0,
    fallback_after_waitlist: 0,
    fallback_after_insurance_mismatch: 0,
    second_choice_success: 0,
  };

  Object.keys(byJourney).forEach(function (journeyId) {
    const journey = byJourney[journeyId].slice().sort(function (a, b) {
      return new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime();
    });
    const byRank = {};

    journey.forEach(function (item) {
      if (!byRank[item.rank_position]) {
        byRank[item.rank_position] = [];
      }
      byRank[item.rank_position].push(item.outcome);
    });

    const first = byRank[1] || [];
    const second = byRank[2] || [];

    if (first.includes("no_response") && second.length) {
      totals.fallback_after_no_response += 1;
    }
    if (first.includes("waitlist") && second.length) {
      totals.fallback_after_waitlist += 1;
    }
    if (first.includes("insurance_mismatch") && second.length) {
      totals.fallback_after_insurance_mismatch += 1;
    }
    if (
      second.some(function (outcome) {
        return outcome === "booked_consult" || outcome === "good_fit_call";
      })
    ) {
      totals.second_choice_success += 1;
    }
  });

  return totals;
}

export function analyzePivotTiming(outcomes) {
  const entries = Array.isArray(outcomes) ? outcomes : [];
  const byJourney = entries.reduce(function (accumulator, item) {
    if (!item || !item.journey_id) {
      return accumulator;
    }
    if (!accumulator[item.journey_id]) {
      accumulator[item.journey_id] = [];
    }
    accumulator[item.journey_id].push(item);
    return accumulator;
  }, {});

  const totals = {
    on_time_pivots: 0,
    early_pivots: 0,
    late_pivots: 0,
  };

  Object.keys(byJourney).forEach(function (journeyId) {
    const journey = byJourney[journeyId].slice().sort(function (a, b) {
      return new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime();
    });
    const firstNegative = journey.find(function (item) {
      return (
        item.rank_position === 1 &&
        ["no_response", "waitlist", "insurance_mismatch"].includes(item.outcome)
      );
    });
    const fallbackAttempt = journey.find(function (item) {
      return item.rank_position > 1;
    });

    if (!firstNegative || !fallbackAttempt || !firstNegative.pivot_at) {
      return;
    }

    const pivotAt = new Date(firstNegative.pivot_at).getTime();
    const fallbackAt = new Date(fallbackAttempt.recorded_at).getTime();
    const delta = fallbackAt - pivotAt;
    const tolerance = 12 * 60 * 60 * 1000;

    if (Math.abs(delta) <= tolerance) {
      totals.on_time_pivots += 1;
    } else if (delta < -tolerance) {
      totals.early_pivots += 1;
    } else {
      totals.late_pivots += 1;
    }
  });

  return totals;
}

export function analyzePivotTimingByUrgency(outcomes, profile) {
  const entries = Array.isArray(outcomes) ? outcomes : [];
  const targetUrgency = profile && profile.urgency ? String(profile.urgency) : "";
  if (!targetUrgency || targetUrgency === "ASAP") {
    return {
      on_time_pivots: 0,
      early_pivots: 0,
      late_pivots: 0,
    };
  }

  return analyzePivotTiming(
    entries.filter(function (item) {
      return (
        item &&
        item.context &&
        item.context.profile &&
        String(item.context.profile.urgency || "") === targetUrgency
      );
    }),
  );
}
