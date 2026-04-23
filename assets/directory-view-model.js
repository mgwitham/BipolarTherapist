import {
  buildCardFitSummary,
  buildLikelyFitCopy,
  getFreshnessBadgeData,
  getPreferredContactRoute,
  getResponsivenessRank,
  isPsychiatristProvider,
} from "./directory-logic.js";
import { renderValuePillRow } from "./therapist-pills.js";

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

function cleanSentence(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLocationSummary(therapist) {
  var parts = [];
  if (therapist.city) {
    parts.push(therapist.city);
  }
  if (therapist.state) {
    parts.push(therapist.state);
  }
  return parts.join(", ");
}

function buildCareFormatSummary(therapist) {
  var formats = [];
  if (therapist.accepts_in_person) {
    formats.push("In person");
  }
  if (therapist.accepts_telehealth) {
    formats.push("Telehealth");
  }
  return formats.join(" • ") || "Care format to confirm";
}

function buildInsuranceSummary(therapist) {
  if (!Array.isArray(therapist.insurance_accepted) || !therapist.insurance_accepted.length) {
    return "";
  }

  return therapist.insurance_accepted.slice(0, 2).join(", ");
}

function buildPrimaryFitReasons(filters, therapist) {
  var reasons = [];
  var locationSummary = buildLocationSummary(therapist);
  var freshness = getFreshnessBadgeData(therapist);

  if (filters.in_person && therapist.accepts_in_person && locationSummary) {
    reasons.push("Matches your preference for in person care in " + locationSummary);
  } else if (therapist.accepts_in_person && locationSummary) {
    reasons.push("In person in " + locationSummary);
  }

  if (filters.telehealth && therapist.accepts_telehealth) {
    reasons.push("Matches your telehealth preference");
  } else if (!reasons.length && therapist.accepts_telehealth) {
    reasons.push("Telehealth is available");
  }

  if (filters.accepting && therapist.accepting_new_patients) {
    reasons.push("Accepting new patients");
  } else if (therapist.accepting_new_patients) {
    reasons.push("Appears to be accepting new patients");
  }

  if (filters.medication_management && therapist.medication_management) {
    reasons.push("Good option if you want medication support");
  } else if (therapist.medication_management) {
    reasons.push("Good option if you want medication support");
  } else if (!isPsychiatristProvider(therapist)) {
    reasons.push("Good option if you want therapy only");
  }

  if (filters.insurance && (therapist.insurance_accepted || []).includes(filters.insurance)) {
    reasons.push("Accepts " + filters.insurance);
  }

  if (
    (therapist.specialties || []).includes("Bipolar I") ||
    (therapist.specialties || []).includes("Bipolar II") ||
    Number(therapist.bipolar_years_experience || 0) >= 5
  ) {
    reasons.push("Strong bipolar informed care fit");
  }

  if (freshness && /recent|updated|confirmed/i.test(freshness.label || "")) {
    reasons.push("Recently updated practice details");
  }

  if (!reasons.length) {
    reasons.push(
      cleanSentence(
        buildLikelyFitCopy(therapist)
          .replace(/^Likely best for\s*/i, "")
          .replace(/\.$/, ""),
      ),
    );
  }

  return reasons.filter(Boolean);
}

function buildTrustSignals(therapist) {
  var signals = [];
  var freshness = getFreshnessBadgeData(therapist);
  var locationSummary = buildLocationSummary(therapist);

  if (therapist.verification_status === "editorially_verified") {
    signals.push("Verified profile");
  }
  if (Number(therapist.bipolar_years_experience || 0) >= 5) {
    signals.push("Bipolar informed");
  }
  if (therapist.accepting_new_patients) {
    signals.push("Accepting new patients");
  }
  if (locationSummary && therapist.accepts_in_person) {
    signals.push("Near " + locationSummary);
  } else if (therapist.accepts_telehealth) {
    signals.push("Telehealth available");
  }
  if (freshness && freshness.label) {
    signals.push(freshness.label);
  }
  if (getResponsivenessRank(therapist) > 0) {
    signals.push("Responsive contact path");
  }

  return signals.slice(0, 4);
}

function buildAvailabilitySummary(therapist) {
  if (therapist.accepting_new_patients && therapist.estimated_wait_time) {
    return therapist.estimated_wait_time;
  }
  if (therapist.accepting_new_patients) {
    return "Accepting new patients";
  }
  if (therapist.estimated_wait_time) {
    return therapist.estimated_wait_time;
  }
  return "";
}

function buildDetailSections(therapist, filters) {
  var sections = [];
  var insuranceSummary = buildInsuranceSummary(therapist);
  var availabilitySummary = buildAvailabilitySummary(therapist);
  var specialties = Array.isArray(therapist.specialties) ? therapist.specialties.slice(0, 4) : [];
  var populations = Array.isArray(therapist.client_populations)
    ? therapist.client_populations.slice(0, 3)
    : [];

  sections.push({
    label: "Care format",
    value: buildCareFormatSummary(therapist),
  });

  if (insuranceSummary) {
    sections.push({
      label: "Insurance",
      value: insuranceSummary,
    });
  }

  var feeSummary = formatDirectoryFeeLabel(therapist, "");
  if (feeSummary) {
    sections.push({
      label: "Fees",
      value: feeSummary,
    });
  }

  if (availabilitySummary) {
    sections.push({
      label: "Availability",
      value: availabilitySummary,
    });
  }

  if (specialties.length) {
    sections.push({
      label: "Specialties",
      value: specialties.join(", "),
    });
  }

  if (populations.length) {
    sections.push({
      label: "Populations served",
      value: populations.join(", "),
    });
  }

  if (therapist.medication_management) {
    sections.push({
      label: "Medication support",
      value: "Available",
    });
  } else if (filters.medication_management) {
    sections.push({
      label: "Medication support",
      value: "Not listed for this provider",
    });
  }

  return sections;
}

export function buildCardViewModel(options) {
  var therapist = options.therapist;
  var filters = options.filters || {};
  var shortlist = options.shortlist;
  var isShortlisted = options.isShortlisted;
  var shortlisted = isShortlisted(therapist.slug);
  var shortlistEntry = shortlist.find(function (item) {
    return item.slug === therapist.slug;
  });
  var contactRoute = getPreferredContactRoute(therapist);
  var fitReasons = buildPrimaryFitReasons(filters, therapist);

  return {
    therapist: therapist,
    locationSummary: buildLocationSummary(therapist),
    careFormatSummary: buildCareFormatSummary(therapist),
    shortlistEntry: shortlistEntry,
    shortlisted: shortlisted,
    contactRoute: contactRoute,
    contactLabel: "Contact therapist",
    acceptance: therapist.accepting_new_patients ? "Accepting new patients" : "Openings to confirm",
    acceptanceTone: therapist.accepting_new_patients ? "accepting" : "not-acc",
    feeSummary: formatDirectoryFeeLabel(therapist, "Fees to confirm"),
    availabilitySummary: buildAvailabilitySummary(therapist),
    fitReasons: fitReasons,
    fitSummary: fitReasons[0] || buildCardFitSummary(filters, therapist),
    trustSignals: buildTrustSignals(therapist),
    valuePillHtml: renderValuePillRow(therapist, "value-pill"),
  };
}

export function buildDirectoryDecisionPreviewModel(options) {
  var therapist = options.therapist;
  var filters = options.filters;
  var isShortlisted = options.isShortlisted;
  var feeCopy = formatDirectoryFeeLabel(therapist, "Fees to confirm");
  var contactRoute = getPreferredContactRoute(therapist);
  var fitReasons = buildPrimaryFitReasons(filters, therapist);

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
    locationSummary: buildLocationSummary(therapist),
    careFormatSummary: buildCareFormatSummary(therapist),
    shortlisted: isShortlisted(therapist.slug),
    contactRoute: contactRoute,
    contactLabel: "Contact therapist",
    openReason: fitReasons[0] || buildPreviewOpenReason(),
    fitReasons: fitReasons.slice(0, 3),
    trustSignals: buildTrustSignals(therapist),
    secondaryReasons: fitReasons.slice(1, 3),
    valuePillHtml: renderValuePillRow(therapist, "value-pill"),
    quickStats: [
      {
        label: "Care format",
        value: buildCareFormatSummary(therapist),
        plain: true,
        tone: "",
      },
      {
        label: "Fees",
        value: feeCopy,
        plain: true,
        tone:
          therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale
            ? "teal"
            : "",
      },
      {
        label: "Availability",
        value: buildAvailabilitySummary(therapist) || "Availability to confirm",
        plain: true,
        tone: therapist.accepting_new_patients ? "green" : "",
      },
    ],
  };
}

export function buildDirectoryRecommendationModel(options) {
  var featured = options.featuredTherapist || null;
  var backups = options.backupTherapists || [];
  var filters = options.filters || {};
  var shortlist = options.shortlist || [];
  var isShortlisted = options.isShortlisted;
  var presentation = options.presentation || {};

  return {
    recommendationKicker: presentation.kicker || "Strong starting options",
    recommendationTitle:
      presentation.title || "Start with one strong option, then use the backups if needed.",
    recommendationCopy:
      presentation.copy ||
      "You do not need to get this perfect. These are strong options to begin with.",
    recommendationContext: presentation.context || "",
    recommendationReassurance:
      presentation.reassurance || "You can contact one now and come back if needed.",
    featured: featured
      ? buildDirectoryDecisionPreviewModel({
          therapist: featured,
          filters: filters,
          shortlist: shortlist,
          isShortlisted: isShortlisted,
        })
      : null,
    backups: backups.map(function (therapist) {
      return buildCardViewModel({
        therapist: therapist,
        filters: filters,
        shortlist: shortlist,
        isShortlisted: isShortlisted,
      });
    }),
  };
}

export function buildDirectoryDetailsViewModel(options) {
  var therapist = options.therapist;
  var filters = options.filters || {};
  var shortlist = options.shortlist || [];
  var isShortlisted = options.isShortlisted;
  var baseModel = buildCardViewModel({
    therapist: therapist,
    filters: filters,
    shortlist: shortlist,
    isShortlisted: isShortlisted,
  });

  return Object.assign({}, baseModel, {
    detailSections: buildDetailSections(therapist, filters),
    reassurance:
      "You do not need to get this perfect. If this feels like a strong option, contacting them is a reasonable next step.",
  });
}
