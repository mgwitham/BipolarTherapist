import {
  buildCardFitSummary,
  buildLikelyFitCopy,
  getPreferredContactRoute,
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
  var shortlist = options.shortlist;
  var isShortlisted = options.isShortlisted;
  var shortlisted = isShortlisted(therapist.slug);
  var shortlistEntry = shortlist.find(function (item) {
    return item.slug === therapist.slug;
  });
  var contactRoute = getPreferredContactRoute(therapist);

  return {
    therapist: therapist,
    shortlistEntry: shortlistEntry,
    shortlisted: shortlisted,
    contactRoute: contactRoute,
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
