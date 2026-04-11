import {
  getDataFreshnessSummary,
  getEditoriallyVerifiedOperationalCount,
  getRecentAppliedSummary,
  getRecentConfirmationSummary,
  getTherapistMatchReadiness,
  getTherapistMerchandisingQuality,
} from "./matching-model.js";
import { getPublicResponsivenessSignal } from "./responsiveness-signal.js";
import { isBookingRouteHealthy, isWebsiteRouteHealthy } from "./route-health.js";

export function buildDirectoryStrategySegments(filterState) {
  var segments = ["all"];

  if (filterState.telehealth && !filterState.in_person) {
    segments.push("format:telehealth");
  } else if (filterState.in_person && !filterState.telehealth) {
    segments.push("format:in_person");
  }

  if (filterState.medication_management) {
    segments.push("intent:psychiatry");
    segments.push("medication:yes");
  }

  if (filterState.insurance) {
    segments.push("insurance:user");
  }

  if (filterState.accepting || filterState.sortBy === "soonest_availability") {
    segments.push("urgency:within-2-weeks");
  }

  return segments;
}

export function getDirectoryStrategyAudience(filterState) {
  var segments = buildDirectoryStrategySegments(filterState);

  if (
    segments.some(function (segment) {
      return segment.indexOf("urgency:") === 0;
    })
  ) {
    return "people browsing with timing in mind";
  }

  if (segments.includes("insurance:user")) {
    return "people browsing with cost or insurance in mind";
  }

  if (
    segments.some(function (segment) {
      return segment.indexOf("intent:psychiatry") === 0 || segment.indexOf("medication:yes") === 0;
    })
  ) {
    return "people browsing for psychiatry or medication support";
  }

  if (
    segments.some(function (segment) {
      return segment.indexOf("format:") === 0;
    })
  ) {
    return "people browsing with a stronger care-format preference";
  }

  return "people browsing like this";
}

export function matchesDirectoryFilters(filterState, therapist) {
  var haystack = [
    therapist.name,
    therapist.title,
    therapist.city,
    therapist.state,
    therapist.practice_name,
    therapist.bio_preview,
    therapist.care_approach,
  ]
    .concat(therapist.specialties || [])
    .concat(therapist.insurance_accepted || [])
    .concat(therapist.treatment_modalities || [])
    .concat(therapist.client_populations || [])
    .join(" ")
    .toLowerCase();

  if (filterState.q && !haystack.includes(String(filterState.q).toLowerCase())) return false;
  if (filterState.state && therapist.state !== filterState.state) return false;
  if (filterState.zip && String(therapist.zip || "") !== String(filterState.zip || "")) {
    return false;
  }
  if (filterState.specialty && !(therapist.specialties || []).includes(filterState.specialty)) {
    return false;
  }
  if (
    filterState.modality &&
    !(therapist.treatment_modalities || []).includes(filterState.modality)
  ) {
    return false;
  }
  if (
    filterState.population &&
    !(therapist.client_populations || []).includes(filterState.population)
  ) {
    return false;
  }
  if (
    filterState.verification &&
    String(therapist.verification_status || "") !== filterState.verification
  ) {
    return false;
  }
  if (
    filterState.bipolar_experience &&
    Number(therapist.bipolar_years_experience || 0) < Number(filterState.bipolar_experience)
  ) {
    return false;
  }
  if (
    filterState.insurance &&
    !(therapist.insurance_accepted || []).includes(filterState.insurance)
  ) {
    return false;
  }
  if (filterState.telehealth && !therapist.accepts_telehealth) return false;
  if (filterState.in_person && !therapist.accepts_in_person) return false;
  if (filterState.accepting && !therapist.accepting_new_patients) return false;
  if (filterState.medication_management && !therapist.medication_management) return false;
  if (filterState.responsive_contact && getResponsivenessRank(therapist) === 0) return false;
  if (filterState.recently_confirmed && getFreshnessRank(therapist) < 2) return false;
  return true;
}

export function getPreferredContactRoute(therapist) {
  var emailAvailable = therapist.email && therapist.email !== "contact@example.com";
  var customLabel = String(therapist.preferred_contact_label || "").trim();
  var bookingHealthy = isBookingRouteHealthy(therapist);
  var websiteHealthy = isWebsiteRouteHealthy(therapist);
  var suppressedRoutes = [];
  if (therapist.booking_url && !bookingHealthy) {
    suppressedRoutes.push("booking link looks unavailable");
  }
  if (therapist.website && !websiteHealthy) {
    suppressedRoutes.push("website looks unavailable");
  }
  var fallbackDetail = suppressedRoutes.length
    ? "Using another contact route because the " + suppressedRoutes.join(" and the ") + "."
    : "";

  if (therapist.preferred_contact_method === "booking" && therapist.booking_url && bookingHealthy) {
    return {
      label: customLabel || "Book consultation",
      href: therapist.booking_url,
      external: true,
      detail: "Prefers booking link",
    };
  }

  if (therapist.preferred_contact_method === "website" && therapist.website && websiteHealthy) {
    return {
      label: customLabel || "Visit website",
      href: therapist.website,
      external: true,
      detail: "Prefers website intake",
    };
  }

  if (therapist.preferred_contact_method === "phone" && therapist.phone) {
    return {
      label: customLabel || "Call practice",
      href: "tel:" + therapist.phone,
      external: false,
      detail: fallbackDetail || "Prefers phone consults",
    };
  }

  if (therapist.preferred_contact_method === "email" && emailAvailable) {
    return {
      label: customLabel || "Email therapist",
      href: "mailto:" + therapist.email,
      external: false,
      detail: fallbackDetail || "Prefers direct email",
    };
  }

  if (therapist.booking_url && bookingHealthy) {
    return {
      label: customLabel || "Book consultation",
      href: therapist.booking_url,
      external: true,
      detail: "Booking link available",
    };
  }

  if (therapist.website && websiteHealthy) {
    return {
      label: customLabel || "Visit website",
      href: therapist.website,
      external: true,
      detail: "Website intake available",
    };
  }

  if (therapist.phone) {
    return {
      label: customLabel || "Call practice",
      href: "tel:" + therapist.phone,
      external: false,
      detail: fallbackDetail || "Phone contact available",
    };
  }

  if (emailAvailable) {
    return {
      label: customLabel || "Email therapist",
      href: "mailto:" + therapist.email,
      external: false,
      detail: fallbackDetail || "Direct email available",
    };
  }

  return null;
}

export function getWaitPriority(value) {
  var map = {
    "Immediate availability": 0,
    "Within 1 week": 1,
    "Within 2 weeks": 2,
    "2-4 weeks": 3,
    "1-2 months": 4,
    "Waitlist only": 5,
  };

  return Object.prototype.hasOwnProperty.call(map, value) ? map[value] : 99;
}

export function getPublicReadinessCopy(therapist) {
  var readiness = getTherapistMatchReadiness(therapist);

  if (readiness.score >= 85) {
    return "High match confidence";
  }

  if (readiness.score >= 65) {
    return "Good match confidence";
  }

  return "Profile still being completed";
}

export function getResponsivenessRank(therapist) {
  var signal = getPublicResponsivenessSignal(therapist);

  if (!signal) {
    return 0;
  }

  if (signal.tone === "positive") {
    return 2;
  }

  return 1;
}

export function getFreshnessBadgeData(therapist) {
  var recentApplied = getRecentAppliedSummary(therapist);
  if (recentApplied) {
    return {
      label: recentApplied.short_label || recentApplied.label,
      note: recentApplied.note,
      tone: "fresh",
    };
  }

  var recentConfirmation = getRecentConfirmationSummary(therapist);
  if (recentConfirmation) {
    return {
      label: recentConfirmation.short_label || recentConfirmation.label,
      note: recentConfirmation.note,
      tone: recentConfirmation.tone === "fresh" ? "fresh" : "recent",
    };
  }

  var freshness = getDataFreshnessSummary(therapist);
  return freshness
    ? {
        label: freshness.label,
        note: freshness.note,
        tone: freshness.status === "fresh" ? "fresh" : "stale",
      }
    : null;
}

export function getFreshnessRank(therapist) {
  var recentApplied = getRecentAppliedSummary(therapist);
  if (recentApplied) {
    return 3;
  }

  var recentConfirmation = getRecentConfirmationSummary(therapist);
  if (recentConfirmation) {
    return recentConfirmation.tone === "fresh" ? 3 : 2;
  }

  var freshness = getDataFreshnessSummary(therapist);
  if (!freshness) {
    return 0;
  }
  if (freshness.status === "fresh") {
    return 2;
  }
  if (freshness.status === "recent") {
    return 1;
  }

  return 0;
}

export function getDecisionReadyScore(therapist) {
  var score = 0;
  var readiness = getTherapistMatchReadiness(therapist);
  var freshnessRank = getFreshnessRank(therapist);
  var reviewedCount = getEditoriallyVerifiedOperationalCount(therapist);
  var contactRoute = getPreferredContactRoute(therapist);
  var responsivenessRank = getResponsivenessRank(therapist);

  score += Math.round((readiness.score || 0) * 0.35);
  score += freshnessRank * 10;
  score += Math.min(reviewedCount, 4) * 7;

  if (contactRoute) {
    score += 10;
  }
  if (therapist.accepting_new_patients) {
    score += 7;
  }
  if (therapist.estimated_wait_time) {
    score += 7;
  }
  if (therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale) {
    score += 7;
  }
  if (therapist.insurance_accepted && therapist.insurance_accepted.length) {
    score += 4;
  }
  if (Number(therapist.bipolar_years_experience || 0) >= 5) {
    score += 6;
  }
  if (responsivenessRank === 2) {
    score += 5;
  } else if (responsivenessRank === 1) {
    score += 2;
  }

  return score;
}

export function getDecisionReadyLabel(therapist) {
  var score = getDecisionReadyScore(therapist);

  if (score >= 80) {
    return "Highly decision-ready";
  }
  if (score >= 60) {
    return "Decision-ready";
  }
  if (score >= 40) {
    return "Some decision gaps";
  }

  return "Needs more confirming";
}

export function buildDecisionReadySummary(therapist) {
  var reasons = [];
  var freshnessRank = getFreshnessRank(therapist);
  var reviewedCount = getEditoriallyVerifiedOperationalCount(therapist);
  var contactRoute = getPreferredContactRoute(therapist);

  if (freshnessRank >= 2) {
    reasons.push("fresh confirmation signals");
  }
  if (reviewedCount >= 2) {
    reasons.push("reviewed operational details");
  }
  if (contactRoute) {
    reasons.push("a clear contact path");
  }
  if (therapist.accepting_new_patients || therapist.estimated_wait_time) {
    reasons.push("timing context");
  }
  if (therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale) {
    reasons.push("fee clarity");
  }

  if (!reasons.length) {
    return "This profile may still require more direct confirmation before someone can decide quickly.";
  }

  return "Decision-ready because it combines " + reasons.slice(0, 3).join(", ") + ".";
}

export function buildLikelyFitCopy(therapist) {
  var cues = [];

  if (therapist.medication_management) {
    cues.push("people who may need psychiatry or medication support");
  } else if ((therapist.client_populations || []).length) {
    cues.push(
      "people looking for " +
        String(therapist.client_populations[0] || "").toLowerCase() +
        " support",
    );
  }

  if ((therapist.specialties || []).includes("Bipolar I")) {
    cues.push("bipolar I care");
  } else if ((therapist.specialties || []).includes("Bipolar II")) {
    cues.push("bipolar II care");
  } else if ((therapist.specialties || []).length) {
    cues.push(String(therapist.specialties[0] || "").toLowerCase() + " care");
  }

  if (therapist.accepts_telehealth) {
    cues.push("telehealth access");
  }

  if (!cues.length) {
    return "Likely best for people who want a more structured bipolar-focused next step.";
  }

  return "Likely best for " + cues.slice(0, 2).join(" and ") + ".";
}

export function buildReviewedDetailsCopy(therapist) {
  if (therapist.verification_status === "editorially_verified") {
    return "Reviewed details include license, location, care format, and contact path.";
  }

  return "Core profile details are present, but some reviewed details may still need confirmation.";
}

export function buildCardStandoutCopy(therapist) {
  var reasons = [];

  if (therapist.verification_status === "editorially_verified") {
    reasons.push("editorial review is already in place");
  }
  if (getEditoriallyVerifiedOperationalCount(therapist) >= 2) {
    reasons.push("multiple practical details are editor-verified");
  }
  if (Number(therapist.bipolar_years_experience || 0) >= 8) {
    reasons.push("bipolar-specific experience is unusually clear");
  }
  if (therapist.medication_management) {
    reasons.push("medication support is part of the offering");
  }
  if (therapist.accepting_new_patients && therapist.estimated_wait_time) {
    reasons.push("the profile gives unusually clear availability context");
  }

  if (!reasons.length) {
    return "Worth a closer look because the profile gives a relatively clear picture of fit and next-step logistics.";
  }

  return reasons.slice(0, 2).join(" and ") + ".";
}

export function buildCardReachabilityCopy(therapist) {
  var route = getPreferredContactRoute(therapist);
  var routeCopy = route ? route.label : "Review the profile for the best next step";

  if (therapist.accepting_new_patients && therapist.estimated_wait_time) {
    return (
      "Reachability: a recent availability note suggests " +
      therapist.estimated_wait_time +
      ", and the clearest next move is to " +
      routeCopy +
      "."
    );
  }
  if (therapist.accepting_new_patients) {
    return (
      "Reachability: appears to be accepting new patients, with a clear next move to " +
      routeCopy +
      "."
    );
  }
  if (therapist.estimated_wait_time) {
    return (
      "Reachability: a recent availability note suggests " +
      therapist.estimated_wait_time +
      ", but live openings should still be confirmed directly. The clearest next move is to " +
      routeCopy +
      "."
    );
  }

  return "Reachability: the contact path is clear, but live timing still needs direct confirmation.";
}

export function buildCardTrustSnapshot(therapist) {
  var reviewedCount = getEditoriallyVerifiedOperationalCount(therapist);
  var recentApplied = getRecentAppliedSummary(therapist);
  var recentConfirmation = getRecentConfirmationSummary(therapist);

  if (recentApplied) {
    return recentApplied.label + ". " + recentApplied.note;
  }
  if (recentConfirmation) {
    return recentConfirmation.label + ". " + recentConfirmation.note;
  }
  if (reviewedCount >= 2) {
    return (
      reviewedCount +
      " key operational detail" +
      (reviewedCount === 1 ? "" : "s") +
      " are editor-verified."
    );
  }

  return buildReviewedDetailsCopy(therapist);
}

export function buildCardFitSummary(filterState, therapist) {
  var reasons = [];

  if (filterState.specialty && (therapist.specialties || []).includes(filterState.specialty)) {
    reasons.push("focuses on " + filterState.specialty.toLowerCase());
  }
  if (
    filterState.modality &&
    (therapist.treatment_modalities || []).includes(filterState.modality)
  ) {
    reasons.push("offers " + filterState.modality);
  }
  if (
    filterState.population &&
    (therapist.client_populations || []).includes(filterState.population)
  ) {
    reasons.push("works with " + filterState.population.toLowerCase());
  }
  if (
    filterState.insurance &&
    (therapist.insurance_accepted || []).includes(filterState.insurance)
  ) {
    reasons.push("accepts " + filterState.insurance);
  }
  if (filterState.telehealth && therapist.accepts_telehealth) {
    reasons.push("offers telehealth");
  }
  if (filterState.in_person && therapist.accepts_in_person) {
    reasons.push("offers in-person care");
  }
  if (filterState.accepting && therapist.accepting_new_patients) {
    reasons.push("is accepting new patients");
  }
  if (filterState.medication_management && therapist.medication_management) {
    reasons.push("includes medication management");
  }
  if (filterState.responsive_contact && getResponsivenessRank(therapist) > 0) {
    reasons.push("has a stronger early contact responsiveness signal");
  }

  if (!reasons.length && therapist.verification_status === "editorially_verified") {
    reasons.push("has been editorially verified");
  }
  if (!reasons.length && Number(therapist.bipolar_years_experience || 0) >= 8) {
    reasons.push("has substantial bipolar-specific experience");
  }
  if (!reasons.length && therapist.estimated_wait_time) {
    reasons.push("typically has " + therapist.estimated_wait_time.toLowerCase() + " availability");
  }
  if (!reasons.length && therapist.medication_management) {
    reasons.push("offers therapy plus medication support");
  }
  if (!reasons.length && therapist.accepts_telehealth) {
    reasons.push("offers telehealth access");
  }
  if (!reasons.length && (therapist.care_approach || therapist.bio_preview || therapist.bio)) {
    reasons.push("has a clearly described care approach");
  }

  if (!reasons.length) {
    return "May be worth a closer look based on the current filters.";
  }

  return "May fit because this clinician " + reasons.slice(0, 2).join(" and ") + ".";
}

export function getMatchScore(filterState, therapist) {
  var score = 0;
  var quality = getTherapistMerchandisingQuality(therapist);
  var responsivenessRank = getResponsivenessRank(therapist);
  var query = filterState.q.trim().toLowerCase();

  if (query) {
    if ((therapist.name || "").toLowerCase().includes(query)) {
      score += 30;
    }
    if ((therapist.practice_name || "").toLowerCase().includes(query)) {
      score += 16;
    }
    if ((therapist.title || "").toLowerCase().includes(query)) {
      score += 10;
    }
    if ((therapist.bio_preview || therapist.bio || "").toLowerCase().includes(query)) {
      score += 14;
    }
    if ((therapist.care_approach || "").toLowerCase().includes(query)) {
      score += 18;
    }
    (therapist.specialties || []).forEach(function (value) {
      if (String(value).toLowerCase().includes(query)) {
        score += 14;
      }
    });
    (therapist.treatment_modalities || []).forEach(function (value) {
      if (String(value).toLowerCase().includes(query)) {
        score += 12;
      }
    });
    (therapist.client_populations || []).forEach(function (value) {
      if (String(value).toLowerCase().includes(query)) {
        score += 10;
      }
    });
  }

  if (filterState.specialty && (therapist.specialties || []).includes(filterState.specialty)) {
    score += 26;
  }
  if (
    filterState.modality &&
    (therapist.treatment_modalities || []).includes(filterState.modality)
  ) {
    score += 18;
  }
  if (
    filterState.population &&
    (therapist.client_populations || []).includes(filterState.population)
  ) {
    score += 18;
  }
  if (
    filterState.insurance &&
    (therapist.insurance_accepted || []).includes(filterState.insurance)
  ) {
    score += 12;
  }
  if (filterState.state && therapist.state === filterState.state) {
    score += 10;
  }
  if (filterState.zip && String(therapist.zip || "") === String(filterState.zip || "")) {
    score += 14;
  }
  if (filterState.accepting && therapist.accepting_new_patients) {
    score += 10;
  }
  if (filterState.telehealth && therapist.accepts_telehealth) {
    score += 8;
  }
  if (filterState.in_person && therapist.accepts_in_person) {
    score += 8;
  }
  if (filterState.medication_management && therapist.medication_management) {
    score += 12;
  }
  if (filterState.responsive_contact && responsivenessRank > 0) {
    score += responsivenessRank === 2 ? 16 : 8;
  }
  if (filterState.recently_confirmed && getFreshnessRank(therapist) >= 2) {
    score += 18;
  }
  if (filterState.verification && therapist.verification_status === filterState.verification) {
    score += 14;
  }

  score += Math.round(quality.score * 0.45);
  score += getFreshnessRank(therapist) * 5;
  score += Math.round(getDecisionReadyScore(therapist) * 0.35);
  if (responsivenessRank === 2) {
    score += 4;
  } else if (responsivenessRank === 1) {
    score += 1;
  }

  return score;
}

export function getEditorialLaneCandidates(results) {
  var list = Array.isArray(results) ? results.slice() : [];
  var psychiatry = list
    .filter(function (therapist) {
      return (
        therapist.medication_management ||
        /psychiatrist|psychiatric|pmhnp|np|md/i.test(
          String((therapist.title || "") + " " + (therapist.credentials || "")),
        )
      );
    })
    .sort(function (a, b) {
      return getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score;
    })[0];

  var therapy = list
    .filter(function (therapist) {
      return !therapist.medication_management;
    })
    .sort(function (a, b) {
      return getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score;
    })[0];

  var fastest = list
    .filter(function (therapist) {
      return therapist.accepting_new_patients;
    })
    .sort(function (a, b) {
      return (
        getWaitPriority(a.estimated_wait_time) - getWaitPriority(b.estimated_wait_time) ||
        getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score
      );
    })[0];

  return [
    {
      title: "Strongest psychiatry option",
      therapist: psychiatry,
      copy: "Best when medication support or psychiatry coordination may matter.",
    },
    {
      title: "Strongest therapy option",
      therapist: therapy,
      copy: "Best when you want a high-quality therapy-first profile with strong bipolar detail.",
    },
    {
      title: "Fastest next step",
      therapist: fastest,
      copy: "Best when speed, availability, and follow-through matter most right now.",
    },
  ].filter(function (lane) {
    return Boolean(lane.therapist);
  });
}

export function compareTherapistsWithFilters(filterState, a, b) {
  if (filterState.sortBy === "most_responsive") {
    return (
      getResponsivenessRank(b) - getResponsivenessRank(a) ||
      getMatchScore(filterState, b) - getMatchScore(filterState, a) ||
      a.name.localeCompare(b.name)
    );
  }

  if (filterState.sortBy === "most_experienced") {
    return (
      Number(b.bipolar_years_experience || 0) - Number(a.bipolar_years_experience || 0) ||
      getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score ||
      Number(b.years_experience || 0) - Number(a.years_experience || 0) ||
      a.name.localeCompare(b.name)
    );
  }

  if (filterState.sortBy === "soonest_availability") {
    return (
      getWaitPriority(a.estimated_wait_time) - getWaitPriority(b.estimated_wait_time) ||
      getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score ||
      (b.accepting_new_patients === true) - (a.accepting_new_patients === true) ||
      a.name.localeCompare(b.name)
    );
  }

  if (filterState.sortBy === "lowest_fee") {
    var aFee = Number(a.session_fee_min || a.session_fee_max || 999999);
    var bFee = Number(b.session_fee_min || b.session_fee_max || 999999);

    return (
      aFee - bFee ||
      getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score ||
      a.name.localeCompare(b.name)
    );
  }

  if (filterState.sortBy === "freshest_details") {
    return (
      getFreshnessRank(b) - getFreshnessRank(a) ||
      getDecisionReadyScore(b) - getDecisionReadyScore(a) ||
      getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score ||
      getMatchScore(filterState, b) - getMatchScore(filterState, a) ||
      a.name.localeCompare(b.name)
    );
  }

  return (
    getMatchScore(filterState, b) - getMatchScore(filterState, a) ||
    getDecisionReadyScore(b) - getDecisionReadyScore(a) ||
    getFreshnessRank(b) - getFreshnessRank(a) ||
    getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score ||
    a.name.localeCompare(b.name)
  );
}
