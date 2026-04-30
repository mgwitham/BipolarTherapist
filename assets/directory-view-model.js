import {
  buildCardFitSummary,
  buildLikelyFitCopy,
  getFreshnessBadgeData,
  getPreferredContactRoute,
  getResponsivenessRank,
  isPsychiatristProvider,
} from "./directory-logic.js";
import { renderValuePillRow } from "./therapist-pills.js";
import { getZipDistanceMiles } from "./zip-lookup.js";

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

function buildMetaLine(therapist) {
  var parts = [];
  var specialty = (therapist.specialties || [])[0] || "";
  if (specialty) {
    parts.push(specialty);
  }
  if (therapist.city) {
    parts.push(therapist.city);
  }
  var formats = [];
  if (therapist.accepts_in_person) {
    formats.push("In person");
  }
  if (therapist.accepts_telehealth) {
    formats.push("Telehealth");
  }
  if (formats.length) {
    parts.push(formats.join(" + "));
  }
  return parts.join(" · ");
}

function extractVoiceQuote(therapist) {
  var src = String(therapist.care_approach || therapist.bio_preview || therapist.bio || "").trim();
  if (!src) {
    return "";
  }
  var match = src.match(/^[^.!?]+[.!?]/);
  if (match && match[0].length <= 140) {
    return match[0].trim();
  }
  if (src.length <= 140) {
    return src;
  }
  return src.slice(0, 137) + "...";
}

function buildMethodContactLabel(therapist, contactRoute) {
  if (!contactRoute) {
    return "View profile";
  }
  var firstName = String(therapist.name || "")
    .split(/[\s,]/)[0]
    .trim();
  var href = String(contactRoute.href || "");
  if (href.startsWith("tel:")) {
    return "Call " + firstName;
  }
  if (href.startsWith("mailto:")) {
    return "Email " + firstName;
  }
  if (href.startsWith("http") && /book|calendly|acuity|schedule/i.test(href)) {
    return "Book with " + firstName;
  }
  var method = therapist.preferred_contact_method || "";
  if (method === "booking") {
    return "Book with " + firstName;
  }
  if (method === "website") {
    return "Visit website";
  }
  return contactRoute.label || "Contact therapist";
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
  var locationSummary = buildLocationSummary(therapist);

  if (therapist.verification_status === "editorially_verified") {
    signals.push("Verified profile");
  }
  if (Number(therapist.bipolar_years_experience || 0) >= 5) {
    signals.push("Bipolar informed");
  }
  if (locationSummary && therapist.accepts_in_person) {
    signals.push("Near " + locationSummary);
  } else if (therapist.accepts_telehealth) {
    signals.push("Telehealth available");
  }
  if (getResponsivenessRank(therapist) > 0) {
    signals.push("Responsive contact path");
  }

  return signals.slice(0, 4);
}

function buildQuickAnswerPills(therapist) {
  var pills = [];

  var feeLabel = formatDirectoryFeeLabel(therapist, "");
  if (feeLabel) {
    pills.push(feeLabel);
  }

  var ins = Array.isArray(therapist.insurance_accepted) ? therapist.insurance_accepted : [];
  if (ins.length === 1) {
    pills.push("Accepts " + ins[0]);
  } else if (ins.length > 1) {
    pills.push("Accepts insurance");
  }

  var avail = buildAvailabilitySummary(therapist);
  if (avail) {
    pills.push(avail);
  }

  var formats = [];
  if (therapist.accepts_telehealth) {
    formats.push("Telehealth");
  }
  if (therapist.accepts_in_person) {
    formats.push("In person");
  }
  if (formats.length) {
    pills.push(formats.join(" + "));
  }

  return pills.slice(0, 5);
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
  var specialties = Array.isArray(therapist.specialties) ? therapist.specialties.slice(0, 4) : [];
  var populations = Array.isArray(therapist.client_populations)
    ? therapist.client_populations.slice(0, 3)
    : [];

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
    metaLine: buildMetaLine(therapist),
    voiceQuote: extractVoiceQuote(therapist),
    shortlistEntry: shortlistEntry,
    shortlisted: shortlisted,
    contactRoute: contactRoute,
    contactLabel: buildMethodContactLabel(therapist, contactRoute),
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

  var panelTrustSignals = (baseModel.trustSignals || []).filter(function (s) {
    return s !== "Accepting new patients" && !/^Near /.test(s) && s !== "Telehealth available";
  });

  // Distance pill — uses search zip, never device location
  var distancePill = "";
  var sortZip = String(filters.sortZip || "").trim();
  var providerZip = String(therapist.zip || "").trim();
  if (/^\d{5}$/.test(sortZip) && /^\d{5}$/.test(providerZip)) {
    var miles = getZipDistanceMiles(sortZip, providerZip);
    if (miles !== null && miles >= 0) {
      distancePill = "~" + Math.round(miles) + " mi from " + sortZip;
    }
  }

  // Fee display for bottom sheet: "$150–$175 / session"
  var feeDisplay = "";
  var minFee = therapist.session_fee_min || therapist.session_fee_max;
  var maxFee = therapist.session_fee_max;
  if (minFee) {
    feeDisplay =
      "$" +
      String(minFee) +
      (maxFee && String(maxFee) !== String(minFee) ? "–$" + String(maxFee) : "") +
      " / session";
  } else if (therapist.sliding_scale) {
    feeDisplay = "Sliding scale";
  }

  // Availability chips for bottom sheet
  var availabilityChips = [];
  if (therapist.accepting_new_patients) {
    availabilityChips.push({ label: "Accepting new patients", tone: "green" });
  }
  if (therapist.accepts_telehealth && therapist.accepts_in_person) {
    availabilityChips.push({ label: "Telehealth + in person", tone: "blue" });
  } else if (therapist.accepts_telehealth) {
    availabilityChips.push({ label: "Telehealth only", tone: "blue" });
  } else if (therapist.accepts_in_person) {
    availabilityChips.push({ label: "In person only", tone: "blue" });
  }
  if (therapist.medication_management) {
    availabilityChips.push({ label: "Rx support", tone: "amber" });
  }

  // Contact footnote — names what's on the full profile but not in the CTA button
  var contactFootnote = "";
  var contactRoute = baseModel.contactRoute;
  var contactHref = String((contactRoute && contactRoute.href) || "");
  var hasEmail = Boolean(therapist.email && therapist.email !== "contact@example.com");
  var hasPhone = Boolean(therapist.phone);
  var isEmailCta = contactHref.startsWith("mailto:");
  var isPhoneCta = contactHref.startsWith("tel:");
  if (isEmailCta) {
    if (hasPhone) contactFootnote = "Phone available on full profile.";
  } else if (isPhoneCta) {
    if (hasEmail) contactFootnote = "Email available on full profile.";
  } else {
    var available = [];
    if (hasPhone) available.push("Phone");
    if (hasEmail) available.push("Email");
    if (available.length) {
      contactFootnote = available.join(" & ") + " available on full profile.";
    }
  }

  return Object.assign({}, baseModel, {
    detailSections: buildDetailSections(therapist, filters),
    bio: String(therapist.care_approach || therapist.bio_preview || therapist.bio || "").trim(),
    bipolarApproach: String(therapist.bipolar_approach || "").trim(),
    quickAnswerPills: buildQuickAnswerPills(therapist),
    panelTrustSignals: panelTrustSignals,
    profileHref: "/therapists/" + encodeURIComponent(therapist.slug) + "/",
    reassurance:
      "You do not need to get this perfect. If this feels like a strong option, contacting them is a reasonable next step.",
    distancePill: distancePill,
    feeDisplay: feeDisplay,
    availabilityChips: availabilityChips,
    contactFootnote: contactFootnote,
  });
}
