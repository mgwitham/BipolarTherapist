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
import { getInPersonProximityBonus, getZipDistanceMiles } from "./zip-lookup.js";
import { insuranceMatches } from "../shared/therapist-picker-options.mjs";
import { toFilterArray } from "./directory-filters.js";
import {
  phoneHref as normalizePhoneHref,
  emailHref as normalizeEmailHref,
  publicHttpUrl as normalizePublicHttpUrl,
} from "../shared/contact-href.mjs";

// Multi-select filter helper, "any selected value of the filter set
// is present in the therapist's list". Used by specialty / modality /
// population matchers after the step-4 state-shape migration.
function arrayAnyMatch(filterValue, therapistValues) {
  const filterArr = toFilterArray(filterValue);
  if (!filterArr.length) return true;
  const therapistArr = Array.isArray(therapistValues) ? therapistValues : [];
  if (!therapistArr.length) return false;
  const therapistSet = new Set(
    therapistArr.map(function (v) {
      return String(v || "").trim();
    }),
  );
  return filterArr.some(function (v) {
    return therapistSet.has(v);
  });
}

// Insurance multi-select uses the fuzzy `insuranceMatches` helper from
// the shared picker options module so brand aliases (e.g. "BCBS" vs
// "Blue Cross Blue Shield") still match. Returns true when ANY of the
// user's selected carriers fuzzy-matches the therapist's accepted list.
function insuranceFilterMatches(filterValue, therapistValues) {
  const filterArr = toFilterArray(filterValue);
  if (!filterArr.length) return true;
  return filterArr.some(function (v) {
    return insuranceMatches(v, therapistValues);
  });
}

const responsivenessRankCache = new WeakMap();
const freshnessBadgeCache = new WeakMap();
const freshnessRankCache = new WeakMap();
const decisionReadyScoreCache = new WeakMap();
const merchandisingQualityCache = new WeakMap();

// Per-sort memo for getMatchScore. The function is invoked from the sort
// comparator (compareTherapistsWithFilters), so each therapist is scored
// O(log n) times during a single sort. The therapist-derived signals it uses
// are already WeakMap-cached above, but the filter-derived work (specialty /
// modality / insurance matching) is not. The score depends on filterState, so
// the cache is keyed by therapist and invalidated wholesale whenever the
// filterState object identity changes. Callers build a fresh filters object
// per sort (directory.js getFilters() returns a new object each call), so the
// identity guard resets the memo exactly when the active filters change and
// never returns a score computed against a different filter set.
let matchScoreCache = new WeakMap();
let matchScoreCacheFilterRef = null;

function getRankingZip(filterState) {
  const rankingZip = String(
    (filterState && (filterState.explicit_zip || filterState.ranking_zip || filterState.zip)) || "",
  ).trim();
  return /^\d{5}$/.test(rankingZip) ? rankingZip : "";
}

function getTherapistZip(therapist) {
  const zip = String((therapist && therapist.zip) || "").trim();
  return /^\d{5}$/.test(zip) ? zip : "";
}

function getDirectoryProximityBoost(filterState, therapist) {
  const rankingZip = getRankingZip(filterState);
  const therapistZip = getTherapistZip(therapist);

  if (!rankingZip || !therapistZip || !therapist.accepts_in_person) {
    return 0;
  }

  return getInPersonProximityBonus(getZipDistanceMiles(rankingZip, therapistZip));
}

function getCachedMerchandisingQuality(therapist) {
  if (!therapist || typeof therapist !== "object") {
    return getTherapistMerchandisingQuality(therapist);
  }

  if (!merchandisingQualityCache.has(therapist)) {
    merchandisingQualityCache.set(therapist, getTherapistMerchandisingQuality(therapist));
  }

  return merchandisingQualityCache.get(therapist);
}

export function matchesDirectoryFilters(filterState, therapist) {
  const isPsychiatrist = isPsychiatristProvider(therapist);

  if (filterState.state && therapist.state !== filterState.state) return false;
  if (!arrayAnyMatch(filterState.specialty, therapist.specialties)) {
    return false;
  }
  if (!arrayAnyMatch(filterState.modality, therapist.treatment_modalities)) {
    return false;
  }
  if (!arrayAnyMatch(filterState.population, therapist.client_populations)) {
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
  if (!insuranceFilterMatches(filterState.insurance, therapist.insurance_accepted)) {
    return false;
  }
  // Session fee range, exclude therapists whose published range is
  // entirely outside the requested window. Range-overlap test: therapist
  // is in-range when therapist.max >= filter.min AND therapist.min <= filter.max.
  // Therapists with no fee data published bypass the filter (we don't
  // want to hide them just for missing data; step 5 doesn't introduce a
  // "show only with published fees" toggle).
  const feeMinFilter = Number(filterState.session_fee_min || 0);
  const feeMaxFilter = Number(filterState.session_fee_max || 0);
  if (feeMinFilter > 0 || feeMaxFilter > 0) {
    const tFeeMin = Number(therapist.session_fee_min || 0);
    const tFeeMax = Number(therapist.session_fee_max || tFeeMin || 0);
    if (tFeeMin > 0 || tFeeMax > 0) {
      if (feeMinFilter > 0 && tFeeMax > 0 && tFeeMax < feeMinFilter) return false;
      if (feeMaxFilter > 0 && tFeeMin > 0 && tFeeMin > feeMaxFilter) return false;
    }
  }
  if (filterState.sliding_scale && !therapist.sliding_scale) return false;
  if (filterState.gender && therapist.gender !== filterState.gender) return false;
  if (filterState.therapist && !filterState.psychiatrist && isPsychiatrist) return false;
  if (filterState.psychiatrist && !filterState.therapist && !isPsychiatrist) return false;
  if (filterState.telehealth && therapist.accepts_telehealth === false) return false;
  if (filterState.in_person && therapist.accepts_in_person === false) return false;
  if (filterState.accepting && !therapist.accepting_new_patients) return false;
  if (filterState.medication_management && therapist.medication_management === false) return false;
  if (filterState.responsive_contact && getResponsivenessRank(therapist) === 0) return false;
  if (filterState.recently_confirmed && getFreshnessRank(therapist) < 2) return false;
  return true;
}

export function isPsychiatristProvider(therapist) {
  const title = String((therapist && therapist.title) || "").toLowerCase();
  const credentials = String((therapist && therapist.credentials) || "").toLowerCase();

  return (
    title.includes("psychiatric") ||
    title.includes("psychiatry") ||
    credentials.includes("pmhnp") ||
    /\bm\.d\.|\bmd\b/.test(credentials) ||
    /\bd\.o\.|\bdo\b/.test(credentials)
  );
}

export function getPreferredContactRoute(therapist) {
  const bookingUrl = normalizePublicHttpUrl(therapist.booking_url);
  const websiteUrl = normalizePublicHttpUrl(therapist.website);
  const phoneHref = normalizePhoneHref(therapist.phone);
  const emailHref =
    therapist.email && therapist.email !== "contact@example.com"
      ? normalizeEmailHref(therapist.email)
      : "";
  const emailAvailable = Boolean(emailHref);
  const customLabel = String(therapist.preferred_contact_label || "").trim();
  const bookingHealthy = Boolean(bookingUrl && isBookingRouteHealthy(therapist));
  const websiteHealthy = Boolean(websiteUrl && isWebsiteRouteHealthy(therapist));
  const suppressedRoutes = [];
  if (therapist.booking_url && !bookingHealthy) {
    suppressedRoutes.push("booking link looks unavailable");
  }
  if (therapist.website && !websiteHealthy) {
    suppressedRoutes.push("website looks unavailable");
  }
  const fallbackDetail = suppressedRoutes.length
    ? "Using another contact route because the " + suppressedRoutes.join(" and the ") + "."
    : "";

  if (therapist.preferred_contact_method === "booking" && bookingUrl && bookingHealthy) {
    return {
      label: customLabel || "Book consultation",
      href: bookingUrl,
      external: true,
      detail: "Prefers booking link",
    };
  }

  if (therapist.preferred_contact_method === "website" && websiteUrl && websiteHealthy) {
    return {
      label: customLabel || "Visit website",
      href: websiteUrl,
      external: true,
      detail: "Prefers website intake",
    };
  }

  if (therapist.preferred_contact_method === "phone" && phoneHref) {
    return {
      label: customLabel || "Call practice",
      href: phoneHref,
      external: false,
      detail: fallbackDetail || "Prefers phone consults",
    };
  }

  if (therapist.preferred_contact_method === "email" && emailAvailable) {
    return {
      label: customLabel || "Email therapist",
      href: emailHref,
      external: false,
      detail: fallbackDetail || "Prefers direct email",
    };
  }

  if (bookingUrl && bookingHealthy) {
    return {
      label: customLabel || "Book consultation",
      href: bookingUrl,
      external: true,
      detail: "Booking link available",
    };
  }

  if (websiteUrl && websiteHealthy) {
    return {
      label: customLabel || "Visit website",
      href: websiteUrl,
      external: true,
      detail: "Website intake available",
    };
  }

  if (phoneHref) {
    return {
      label: customLabel || "Call practice",
      href: phoneHref,
      external: false,
      detail: fallbackDetail || "Phone contact available",
    };
  }

  if (emailAvailable) {
    return {
      label: customLabel || "Email therapist",
      href: emailHref,
      external: false,
      detail: fallbackDetail || "Direct email available",
    };
  }

  return null;
}

export function getWaitPriority(value) {
  const map = {
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
  const readiness = getTherapistMatchReadiness(therapist);

  if (readiness.score >= 85) {
    return "High match confidence";
  }

  if (readiness.score >= 65) {
    return "Good match confidence";
  }

  return "Profile still being completed";
}

export function getResponsivenessRank(therapist) {
  if (therapist && typeof therapist === "object" && responsivenessRankCache.has(therapist)) {
    return responsivenessRankCache.get(therapist);
  }

  const signal = getPublicResponsivenessSignal(therapist);
  let rank = 0;

  if (!signal) {
    rank = 0;
  } else if (signal.tone === "positive") {
    rank = 2;
  } else {
    rank = 1;
  }

  if (therapist && typeof therapist === "object") {
    responsivenessRankCache.set(therapist, rank);
  }

  return rank;
}

export function getFreshnessBadgeData(therapist) {
  if (therapist && typeof therapist === "object" && freshnessBadgeCache.has(therapist)) {
    return freshnessBadgeCache.get(therapist);
  }

  let badge = null;
  const recentApplied = getRecentAppliedSummary(therapist);
  if (recentApplied) {
    badge = {
      label: recentApplied.short_label || recentApplied.label,
      note: recentApplied.note,
      tone: "fresh",
    };
  } else {
    const recentConfirmation = getRecentConfirmationSummary(therapist);
    if (recentConfirmation) {
      badge = {
        label: recentConfirmation.short_label || recentConfirmation.label,
        note: recentConfirmation.note,
        tone: recentConfirmation.tone === "fresh" ? "fresh" : "recent",
      };
    } else {
      const freshness = getDataFreshnessSummary(therapist);
      badge = freshness
        ? {
            label: freshness.label,
            note: freshness.note,
            tone: freshness.status === "fresh" ? "fresh" : "stale",
          }
        : null;
    }
  }

  if (therapist && typeof therapist === "object") {
    freshnessBadgeCache.set(therapist, badge);
  }

  return badge;
}

export function getFreshnessRank(therapist) {
  if (therapist && typeof therapist === "object" && freshnessRankCache.has(therapist)) {
    return freshnessRankCache.get(therapist);
  }

  let rank = 0;
  const recentApplied = getRecentAppliedSummary(therapist);
  if (recentApplied) {
    rank = 3;
  } else {
    const recentConfirmation = getRecentConfirmationSummary(therapist);
    if (recentConfirmation) {
      rank = recentConfirmation.tone === "fresh" ? 3 : 2;
    } else {
      const freshness = getDataFreshnessSummary(therapist);
      if (!freshness) {
        rank = 0;
      } else if (freshness.status === "fresh") {
        rank = 2;
      } else if (freshness.status === "recent") {
        rank = 1;
      }
    }
  }

  if (therapist && typeof therapist === "object") {
    freshnessRankCache.set(therapist, rank);
  }

  return rank;
}

export function getDecisionReadyScore(therapist) {
  if (therapist && typeof therapist === "object" && decisionReadyScoreCache.has(therapist)) {
    return decisionReadyScoreCache.get(therapist);
  }

  let score = 0;
  const readiness = getTherapistMatchReadiness(therapist);
  const freshnessRank = getFreshnessRank(therapist);
  const reviewedCount = getEditoriallyVerifiedOperationalCount(therapist);
  const contactRoute = getPreferredContactRoute(therapist);
  const responsivenessRank = getResponsivenessRank(therapist);

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

  if (therapist && typeof therapist === "object") {
    decisionReadyScoreCache.set(therapist, score);
  }

  return score;
}

export function getDecisionReadyLabel(therapist) {
  const score = getDecisionReadyScore(therapist);

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
  const reasons = [];
  const freshnessRank = getFreshnessRank(therapist);
  const reviewedCount = getEditoriallyVerifiedOperationalCount(therapist);
  const contactRoute = getPreferredContactRoute(therapist);

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
  const cues = [];

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
  const reasons = [];

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
  const route = getPreferredContactRoute(therapist);
  const routeCopy = route ? route.label : "Review the profile for the best next step";

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
  const reviewedCount = getEditoriallyVerifiedOperationalCount(therapist);
  const recentApplied = getRecentAppliedSummary(therapist);
  const recentConfirmation = getRecentConfirmationSummary(therapist);

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
  const reasons = [];

  // Find the first overlap so we can quote the actual matched value in
  // the fit-summary reason ("focuses on Bipolar II"). Multi-select keys
  // can hold N values; reason copy stays singular for readability.
  function findOverlap(filterValue, therapistValues) {
    const filterArr = toFilterArray(filterValue);
    if (!filterArr.length) return "";
    const therapistArr = Array.isArray(therapistValues) ? therapistValues : [];
    if (!therapistArr.length) return "";
    const therapistSet = new Set(
      therapistArr.map(function (v) {
        return String(v || "").trim();
      }),
    );
    for (let i = 0; i < filterArr.length; i += 1) {
      if (therapistSet.has(filterArr[i])) return filterArr[i];
    }
    return "";
  }
  function findInsuranceOverlap(filterValue, therapistValues) {
    const filterArr = toFilterArray(filterValue);
    for (let i = 0; i < filterArr.length; i += 1) {
      if (insuranceMatches(filterArr[i], therapistValues)) return filterArr[i];
    }
    return "";
  }

  const specMatch = findOverlap(filterState.specialty, therapist.specialties);
  if (specMatch) reasons.push("focuses on " + specMatch.toLowerCase());
  const modMatch = findOverlap(filterState.modality, therapist.treatment_modalities);
  if (modMatch) reasons.push("offers " + modMatch);
  const popMatch = findOverlap(filterState.population, therapist.client_populations);
  if (popMatch) reasons.push("works with " + popMatch.toLowerCase());
  const insMatch = findInsuranceOverlap(filterState.insurance, therapist.insurance_accepted);
  if (insMatch) reasons.push("accepts " + insMatch);
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
  if (filterState !== matchScoreCacheFilterRef) {
    matchScoreCache = new WeakMap();
    matchScoreCacheFilterRef = filterState;
  }
  const canCache = therapist !== null && typeof therapist === "object";
  if (canCache) {
    const cachedScore = matchScoreCache.get(therapist);
    if (cachedScore !== undefined) {
      return cachedScore;
    }
  }

  let score = 0;
  const quality = getCachedMerchandisingQuality(therapist);
  const responsivenessRank = getResponsivenessRank(therapist);

  // Multi-select filters: award the score when ANY of the user's selected
  // values matches the therapist's array. (Pre-step-4 used .includes on a
  // single string value.)
  if (arrayAnyMatch(filterState.specialty, therapist.specialties)) {
    if (toFilterArray(filterState.specialty).length > 0) score += 26;
  }
  if (arrayAnyMatch(filterState.modality, therapist.treatment_modalities)) {
    if (toFilterArray(filterState.modality).length > 0) score += 18;
  }
  if (arrayAnyMatch(filterState.population, therapist.client_populations)) {
    if (toFilterArray(filterState.population).length > 0) score += 18;
  }
  if (insuranceFilterMatches(filterState.insurance, therapist.insurance_accepted)) {
    if (toFilterArray(filterState.insurance).length > 0) score += 12;
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
  score += getDirectoryProximityBoost(filterState, therapist);
  if (responsivenessRank === 2) {
    score += 4;
  } else if (responsivenessRank === 1) {
    score += 1;
  }

  if (canCache) {
    matchScoreCache.set(therapist, score);
  }
  return score;
}

// Default-sort completeness signal. Rewards profiles that have both a
// headshot and a stated bipolar-years-experience over profiles that
// have one or neither. Three tiers (2 / 1 / 0) so the stable-random
// shuffle still operates within each tier, we don't want the top
// row to be the same person every reload.
function getCompletenessTier(therapist) {
  const hasPhoto = Boolean(therapist && therapist.photo_url);
  const hasBipolarYears = Number((therapist && therapist.bipolar_years_experience) || 0) >= 1;
  if (hasPhoto && hasBipolarYears) return 2;
  if (hasPhoto || hasBipolarYears) return 1;
  return 0;
}

// Fee used for "lowest fee" sorting. A missing fee already falls back to a
// large sentinel, but a non-numeric value (e.g. a "sliding scale" string)
// makes Number(...) return NaN, and `aFee - bFee` then yields NaN — which is
// falsy, so the comparison silently falls through and scatters those
// providers unpredictably instead of sorting them last. Treat any
// non-finite fee as unknown so it sorts to the bottom, like a missing fee.
function feeSortValue(therapist) {
  const fee = Number(
    (therapist && (therapist.session_fee_min || therapist.session_fee_max)) || 999999,
  );
  return Number.isFinite(fee) ? fee : 999999;
}

export function compareTherapistsWithFilters(filterState, a, b) {
  if (filterState.sortBy === "stable_random" || filterState.sortBy === "near_zip") {
    if (filterState.sortBy === "near_zip") {
      const sortZipVal = String(filterState.sortZip || "").trim();
      if (/^\d{5}$/.test(sortZipVal)) {
        const aZip = getTherapistZip(a);
        const bZip = getTherapistZip(b);
        const aProx = aZip
          ? getInPersonProximityBonus(getZipDistanceMiles(sortZipVal, aZip))
          : -9999;
        const bProx = bZip
          ? getInPersonProximityBonus(getZipDistanceMiles(sortZipVal, bZip))
          : -9999;
        return (
          (b.accepting_new_patients ? 1 : 0) - (a.accepting_new_patients ? 1 : 0) ||
          bProx - aProx ||
          a.name.localeCompare(b.name)
        );
      }
    }
    const acceptDiff = (b.accepting_new_patients ? 1 : 0) - (a.accepting_new_patients ? 1 : 0);
    if (acceptDiff !== 0) return acceptDiff;
    const tierDiff = getCompletenessTier(b) - getCompletenessTier(a);
    if (tierDiff !== 0) return tierDiff;
    const orderA = filterState.stableOrderMap ? filterState.stableOrderMap.get(a.slug) || 0 : 0;
    const orderB = filterState.stableOrderMap ? filterState.stableOrderMap.get(b.slug) || 0 : 0;
    return orderA - orderB;
  }

  if (filterState.sortBy === "most_responsive") {
    return (
      getResponsivenessRank(b) - getResponsivenessRank(a) ||
      (b.accepting_new_patients === true) - (a.accepting_new_patients === true) ||
      getWaitPriority(a.estimated_wait_time) - getWaitPriority(b.estimated_wait_time) ||
      getCachedMerchandisingQuality(b).score - getCachedMerchandisingQuality(a).score ||
      getMatchScore(filterState, b) - getMatchScore(filterState, a) ||
      a.name.localeCompare(b.name)
    );
  }

  if (filterState.sortBy === "most_experienced") {
    return (
      Number(b.bipolar_years_experience || 0) - Number(a.bipolar_years_experience || 0) ||
      (b.accepting_new_patients === true) - (a.accepting_new_patients === true) ||
      getWaitPriority(a.estimated_wait_time) - getWaitPriority(b.estimated_wait_time) ||
      Number(b.years_experience || 0) - Number(a.years_experience || 0) ||
      getCachedMerchandisingQuality(b).score - getCachedMerchandisingQuality(a).score ||
      a.name.localeCompare(b.name)
    );
  }

  if (filterState.sortBy === "soonest_availability") {
    return (
      getWaitPriority(a.estimated_wait_time) - getWaitPriority(b.estimated_wait_time) ||
      getCachedMerchandisingQuality(b).score - getCachedMerchandisingQuality(a).score ||
      (b.accepting_new_patients === true) - (a.accepting_new_patients === true) ||
      a.name.localeCompare(b.name)
    );
  }

  if (filterState.sortBy === "lowest_fee") {
    const aFee = feeSortValue(a);
    const bFee = feeSortValue(b);

    return (
      aFee - bFee ||
      getCachedMerchandisingQuality(b).score - getCachedMerchandisingQuality(a).score ||
      a.name.localeCompare(b.name)
    );
  }

  return (
    getMatchScore(filterState, b) - getMatchScore(filterState, a) ||
    getDecisionReadyScore(b) - getDecisionReadyScore(a) ||
    getFreshnessRank(b) - getFreshnessRank(a) ||
    getCachedMerchandisingQuality(b).score - getCachedMerchandisingQuality(a).score ||
    a.name.localeCompare(b.name)
  );
}
