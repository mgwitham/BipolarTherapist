import {
  getEditoriallyVerifiedOperationalCount,
  getOperationalTrustSummary,
  getTherapistMerchandisingQuality,
} from "./matching-model.js";
import { getPublicResponsivenessSignal } from "./responsiveness-signal.js";
import {
  buildCardFitSummary,
  buildCardReachabilityCopy,
  buildCardStandoutCopy,
  buildCardTrustSnapshot,
  buildDecisionReadySummary,
  buildLikelyFitCopy,
  buildReviewedDetailsCopy,
  getDecisionReadyLabel,
  getFreshnessBadgeData,
  getPreferredContactRoute,
  getPublicReadinessCopy,
} from "./directory-logic.js";

export function formatDirectoryFeeLabel(therapist, fallback) {
  if (!therapist) {
    return fallback || "Fees to confirm";
  }

  var minFee = therapist.session_fee_min || therapist.session_fee_max;
  var maxFee = therapist.session_fee_max;

  if (minFee) {
    return (
      "$" +
      String(minFee) +
      (maxFee && String(maxFee) !== String(minFee) ? "-$" + String(maxFee) : "") +
      "/Session"
    );
  }

  if (therapist.sliding_scale) {
    return "Sliding scale";
  }

  return fallback || "Fees to confirm";
}

export function buildCardViewModel(options) {
  var therapist = options.therapist;
  var filters = options.filters;
  var shortlist = options.shortlist;
  var shortlistPriorityOptions = options.shortlistPriorityOptions;
  var isShortlisted = options.isShortlisted;
  var shortlisted = isShortlisted(therapist.slug);
  var shortlistEntry = shortlist.find(function (item) {
    return item.slug === therapist.slug;
  });
  var freshnessBadge = getFreshnessBadgeData(therapist);
  var decisionReadyLabel = getDecisionReadyLabel(therapist);
  var contactRoute = getPreferredContactRoute(therapist);
  var trustSnapshot = buildCardTrustSnapshot(therapist);
  var reviewedDetailsCopy = buildReviewedDetailsCopy(therapist);
  var operationalTrustCopy = getOperationalTrustSummary(therapist);
  var reviewedCount = getEditoriallyVerifiedOperationalCount(therapist);

  function shortenCopy(value, fallback, maxWords) {
    var text = String(value || fallback || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) {
      return "";
    }

    var firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
    var words = firstSentence.split(" ").filter(Boolean);
    if (words.length <= maxWords) {
      return firstSentence;
    }
    return words.slice(0, maxWords).join(" ") + "...";
  }

  function buildCardSummary() {
    return shortenCopy(
      therapist.bio_preview || therapist.bio || buildLikelyFitCopy(therapist),
      buildLikelyFitCopy(therapist),
      22,
    );
  }

  function buildActionSummary() {
    if (therapist.first_step_expectation) {
      return shortenCopy(
        therapist.first_step_expectation,
        "Open the profile to confirm the best next step.",
        14,
      );
    }
    if (contactRoute) {
      return shortenCopy(contactRoute.detail, "Open the profile to confirm the best next step.", 8);
    }
    return "Open profile to confirm next step.";
  }

  function buildFreshnessSummary() {
    if (freshnessBadge && freshnessBadge.label) {
      return freshnessBadge.label;
    }
    return decisionReadyLabel;
  }

  function buildTrustSummary() {
    if (reviewedCount) {
      return reviewedCount + " verified detail" + (reviewedCount === 1 ? "" : "s");
    }
    return shortenCopy(trustSnapshot || operationalTrustCopy || reviewedDetailsCopy, "", 8);
  }

  return {
    therapist: therapist,
    shortlistEntry: shortlistEntry,
    shortlistPriorityOptions: shortlistPriorityOptions,
    shortlisted: shortlisted,
    freshnessBadge: freshnessBadge,
    decisionReadyLabel: decisionReadyLabel,
    decisionReadySummary: buildDecisionReadySummary(therapist),
    fitSummary: buildCardFitSummary(filters, therapist),
    likelyFitCopy: buildLikelyFitCopy(therapist),
    cardSummary: buildCardSummary(),
    actionSummary: buildActionSummary(),
    freshnessSummary: buildFreshnessSummary(),
    trustSummaryShort: buildTrustSummary(),
    contactRoute: contactRoute,
    reviewedDetailsCopy: reviewedDetailsCopy,
    operationalTrustCopy: operationalTrustCopy,
    standoutCopy: buildCardStandoutCopy(therapist),
    reachabilityCopy: buildCardReachabilityCopy(therapist),
    trustSnapshot: trustSnapshot,
    trustTags: [
      getTherapistMerchandisingQuality(therapist).score >= 90
        ? getTherapistMerchandisingQuality(therapist).label
        : "",
      therapist.verification_status === "editorially_verified" ? "Verified" : "",
      freshnessBadge ? freshnessBadge.label : "",
      getEditoriallyVerifiedOperationalCount(therapist)
        ? getEditoriallyVerifiedOperationalCount(therapist) +
          " key detail" +
          (getEditoriallyVerifiedOperationalCount(therapist) > 1 ? "s" : "") +
          " verified"
        : "",
      therapist.bipolar_years_experience
        ? therapist.bipolar_years_experience + " yrs bipolar care"
        : "",
      getPublicReadinessCopy(therapist),
      decisionReadyLabel,
      (function () {
        var signal = getPublicResponsivenessSignal(therapist);
        return signal ? signal.label : "";
      })(),
      therapist.medication_management ? "Medication management" : "",
    ].filter(Boolean),
    tags: (therapist.specialties || []).slice(0, 3),
    modes: [
      therapist.accepts_telehealth ? "Telehealth" : "",
      therapist.accepts_in_person ? "In-Person" : "",
    ].filter(Boolean),
    acceptance: therapist.accepting_new_patients ? "Accepting patients" : "Check current openings",
    acceptanceTone: therapist.accepting_new_patients ? "accepting" : "accepting not-acc",
    feeSummary: formatDirectoryFeeLabel(therapist, "Fees to confirm"),
    quickStats: [
      {
        label: "Fit",
        value: therapist.bipolar_years_experience
          ? therapist.bipolar_years_experience + " yrs bipolar care"
          : "Check bipolar depth",
        tone: therapist.bipolar_years_experience ? "green" : "teal",
      },
    ],
    decisionPills: [
      therapist.accepts_telehealth ? "Telehealth" : "",
      therapist.accepts_in_person ? "In-person" : "",
      therapist.medication_management ? "Medication support" : "",
      therapist.insurance_accepted && therapist.insurance_accepted.length
        ? therapist.insurance_accepted.slice(0, 1)[0]
        : "",
    ].filter(Boolean),
    nextStepLine: therapist.first_step_expectation
      ? therapist.first_step_expectation
      : contactRoute
        ? contactRoute.detail
        : "Open the profile to confirm the best next step.",
    footerLabel: contactRoute ? contactRoute.label : "Shortlist-ready",
  };
}

export function buildDirectoryDecisionPreviewModel(options) {
  var therapist = options.therapist;
  var filters = options.filters;
  var isShortlisted = options.isShortlisted;
  var feeCopy = formatDirectoryFeeLabel(therapist, "Fees to confirm");
  var opennessCopy = therapist.accepting_new_patients
    ? therapist.estimated_wait_time || "Accepting new patients"
    : "Current openings to confirm";

  function buildPreviewOpenReason() {
    var fitReason = buildCardFitSummary(filters, therapist);
    var likelyFit = buildLikelyFitCopy(therapist);
    var hasUserSelectedFitReason =
      Boolean(filters.specialty) ||
      Boolean(filters.modality) ||
      Boolean(filters.population) ||
      Boolean(filters.insurance) ||
      Boolean(filters.telehealth) ||
      Boolean(filters.in_person) ||
      Boolean(filters.accepting) ||
      Boolean(filters.medication_management) ||
      Boolean(filters.responsive_contact);

    if (hasUserSelectedFitReason && fitReason) {
      return fitReason
        .replace(/^May fit because this clinician /, "")
        .replace(
          /^May be worth a closer look based on the current filters\./,
          "Matches your current filters.",
        )
        .replace(/\s+/g, " ")
        .trim();
    }

    return likelyFit
      .replace(/^Likely best for /, "Best for ")
      .replace(/^Likely /, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  return {
    therapist: therapist,
    shortlisted: isShortlisted(therapist.slug),
    openReason: buildPreviewOpenReason(),
    quickStats: [
      {
        label: "",
        value: opennessCopy,
        plain: true,
        tone: therapist.accepting_new_patients || therapist.estimated_wait_time ? "green" : "",
      },
      {
        label: "",
        value: feeCopy,
        plain: true,
        tone:
          therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale
            ? "teal"
            : "",
      },
    ],
  };
}
