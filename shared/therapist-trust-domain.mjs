const FIELD_TRUST_KEYS = [
  "estimatedWaitTime",
  "insuranceAccepted",
  "telehealthStates",
  "bipolarYearsExperience",
];

const FIELD_STALE_AFTER_DAYS = {
  estimatedWaitTime: 21,
  insuranceAccepted: 45,
  telehealthStates: 45,
  bipolarYearsExperience: 180,
};

function addDays(isoString, days) {
  const base = isoString ? new Date(isoString) : new Date();
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date();
    fallback.setUTCDate(fallback.getUTCDate() + days);
    return fallback.toISOString();
  }
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString();
}

function toValidDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getFieldReviewState(record, fieldName) {
  return (record.fieldReviewStates && record.fieldReviewStates[fieldName]) || "unknown";
}

function getFieldSourceKind(record, fieldName, reviewState) {
  const hasSourceReview = Boolean(record.sourceReviewedAt);
  const hasTherapistConfirmation = Boolean(record.therapistReportedConfirmedAt);
  const reportedFields = Array.isArray(record.therapistReportedFields)
    ? record.therapistReportedFields
    : [];
  const sourceHealthDegraded =
    record.sourceHealthStatus &&
    !["healthy", "redirected"].includes(String(record.sourceHealthStatus));

  if (sourceHealthDegraded && reviewState === "needs_reconfirmation") {
    return "degraded_source";
  }
  if (
    reviewState === "editorially_verified" &&
    hasSourceReview &&
    hasTherapistConfirmation &&
    reportedFields.includes(fieldName)
  ) {
    return "blended";
  }
  if (reviewState === "editorially_verified" && hasSourceReview) {
    return "editorial_source_review";
  }
  if (hasTherapistConfirmation && reportedFields.includes(fieldName)) {
    return "therapist_confirmed";
  }
  if (hasSourceReview && hasTherapistConfirmation) {
    return "blended";
  }
  return "unknown";
}

function getFieldVerifiedAt(record, fieldName, sourceKind) {
  const sourceReviewedAt = toValidDate(record.sourceReviewedAt);
  const therapistConfirmedAt = toValidDate(record.therapistReportedConfirmedAt);

  if (sourceKind === "editorial_source_review" && sourceReviewedAt) {
    return sourceReviewedAt.toISOString();
  }
  if (sourceKind === "therapist_confirmed" && therapistConfirmedAt) {
    return therapistConfirmedAt.toISOString();
  }
  if (sourceKind === "blended") {
    const dates = [sourceReviewedAt, therapistConfirmedAt].filter(Boolean);
    if (dates.length) {
      return new Date(Math.max.apply(null, dates.map((value) => value.getTime()))).toISOString();
    }
  }
  if (therapistConfirmedAt && Array.isArray(record.therapistReportedFields)) {
    if (record.therapistReportedFields.includes(fieldName)) {
      return therapistConfirmedAt.toISOString();
    }
  }
  if (sourceReviewedAt) {
    return sourceReviewedAt.toISOString();
  }
  if (therapistConfirmedAt) {
    return therapistConfirmedAt.toISOString();
  }
  return "";
}

function computeFieldConfidenceScore(record, fieldName, reviewState, sourceKind) {
  let score =
    reviewState === "editorially_verified"
      ? 92
      : reviewState === "needs_reconfirmation"
        ? 44
        : 76;

  if (sourceKind === "blended") {
    score += 3;
  } else if (sourceKind === "degraded_source") {
    score -= 16;
  } else if (sourceKind === "unknown") {
    score -= 10;
  }

  const sourceAgeDays = toValidDate(record.sourceReviewedAt)
    ? Math.max(0, Math.floor((Date.now() - new Date(record.sourceReviewedAt).getTime()) / 86400000))
    : null;
  const confirmationAgeDays = toValidDate(record.therapistReportedConfirmedAt)
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(record.therapistReportedConfirmedAt).getTime()) / 86400000),
      )
    : null;

  if (sourceAgeDays !== null && sourceAgeDays >= 120) {
    score -= 12;
  } else if (sourceAgeDays !== null && sourceAgeDays >= 75) {
    score -= 6;
  }

  if (confirmationAgeDays !== null && confirmationAgeDays >= 120) {
    score -= 16;
  } else if (confirmationAgeDays !== null && confirmationAgeDays >= 60) {
    score -= 8;
  }

  return Math.max(5, Math.min(99, score));
}

export function computeTherapistCompletenessScore(record) {
  const checks = [
    Boolean(record.name),
    Boolean(record.credentials),
    Boolean(record.city && record.state),
    Boolean(record.email || record.phone || record.website || record.bookingUrl),
    Boolean(record.careApproach || record.bio),
    Array.isArray(record.specialties) ? record.specialties.length > 0 : Boolean(record.specialties),
    Array.isArray(record.insuranceAccepted)
      ? record.insuranceAccepted.length > 0
      : Boolean(record.insuranceAccepted),
    Array.isArray(record.languages) ? record.languages.length > 0 : Boolean(record.languages),
    Boolean(record.sourceUrl),
    Boolean(record.sourceReviewedAt || record.therapistReportedConfirmedAt),
  ];
  const passed = checks.filter(Boolean).length;
  return Math.round((passed / checks.length) * 100);
}

export function buildFieldTrustMeta(record) {
  return FIELD_TRUST_KEYS.reduce(function (accumulator, fieldName) {
    const reviewState = getFieldReviewState(record, fieldName);
    const sourceKind = getFieldSourceKind(record, fieldName, reviewState);
    const verifiedAt = getFieldVerifiedAt(record, fieldName, sourceKind);
    const staleAfterDays = FIELD_STALE_AFTER_DAYS[fieldName];
    accumulator[fieldName] = {
      reviewState,
      confidenceScore: computeFieldConfidenceScore(record, fieldName, reviewState, sourceKind),
      sourceKind,
      verifiedAt,
      staleAfterDays,
      staleAfterAt: verifiedAt ? addDays(verifiedAt, staleAfterDays) : "",
    };
    return accumulator;
  }, {});
}

export function computeTherapistVerificationMeta(record) {
  const now = new Date();
  const sourceReviewedAt = record.sourceReviewedAt ? new Date(record.sourceReviewedAt) : null;
  const therapistConfirmedAt = record.therapistReportedConfirmedAt
    ? new Date(record.therapistReportedConfirmedAt)
    : null;
  const validDates = [sourceReviewedAt, therapistConfirmedAt].filter(function (value) {
    return value instanceof Date && !Number.isNaN(value.getTime());
  });
  const lastOperationalReviewAt = validDates.length
    ? new Date(Math.max.apply(null, validDates.map((value) => value.getTime()))).toISOString()
    : "";
  const needsReconfirmationFields = Object.entries(record.fieldReviewStates || {})
    .filter(function (entry) {
      return entry[1] === "needs_reconfirmation";
    })
    .map(function (entry) {
      return entry[0];
    });
  const sourceAgeDays =
    sourceReviewedAt && !Number.isNaN(sourceReviewedAt.getTime())
      ? Math.max(0, Math.floor((now.getTime() - sourceReviewedAt.getTime()) / 86400000))
      : null;

  if (!lastOperationalReviewAt) {
    return {
      lastOperationalReviewAt: "",
      nextReviewDueAt: now.toISOString(),
      verificationPriority: 95,
      verificationLane: "needs_verification",
      dataCompletenessScore: computeTherapistCompletenessScore(record),
    };
  }

  if (needsReconfirmationFields.length) {
    return {
      lastOperationalReviewAt,
      nextReviewDueAt: addDays(lastOperationalReviewAt, 7),
      verificationPriority: Math.min(98, 82 + needsReconfirmationFields.length * 4),
      verificationLane: "needs_reconfirmation",
      dataCompletenessScore: computeTherapistCompletenessScore(record),
    };
  }

  if (sourceAgeDays !== null && sourceAgeDays >= 120) {
    return {
      lastOperationalReviewAt,
      nextReviewDueAt: addDays(lastOperationalReviewAt, 120),
      verificationPriority: 84,
      verificationLane: "refresh_now",
      dataCompletenessScore: computeTherapistCompletenessScore(record),
    };
  }

  if (sourceAgeDays !== null && sourceAgeDays >= 75) {
    return {
      lastOperationalReviewAt,
      nextReviewDueAt: addDays(lastOperationalReviewAt, 105),
      verificationPriority: 61,
      verificationLane: "refresh_soon",
      dataCompletenessScore: computeTherapistCompletenessScore(record),
    };
  }

  return {
    lastOperationalReviewAt,
    nextReviewDueAt: addDays(lastOperationalReviewAt, 120),
    verificationPriority: 28,
    verificationLane: "fresh",
    dataCompletenessScore: computeTherapistCompletenessScore(record),
  };
}
