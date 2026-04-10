import { buildProviderId, normalizeText } from "./therapist-domain.mjs";

const FIELD_LABELS = {
  specialties: "Specialties",
  treatmentModalities: "Treatment modalities",
  clientPopulations: "Client populations",
  insuranceAccepted: "Insurance accepted",
  languages: "Languages",
  telehealthStates: "Telehealth states",
  estimatedWaitTime: "Estimated wait time",
  bipolarYearsExperience: "Bipolar years experience",
  acceptsTelehealth: "Accepts telehealth",
  acceptsInPerson: "Accepts in-person",
  acceptingNewPatients: "Accepting new patients",
  medicationManagement: "Medication management",
  sessionFeeMin: "Session fee min",
  sessionFeeMax: "Session fee max",
  slidingScale: "Sliding scale",
};

const SOURCE_TYPE_LABELS = {
  therapist: "Therapist",
  therapistCandidate: "Therapist candidate",
  therapistApplication: "Therapist application",
  licensureRecord: "Licensure record",
  manual_review: "Manual review",
  import_pipeline: "Import pipeline",
};

const VERIFICATION_METHOD_LABELS = {
  primary_source_lookup: "Primary source lookup",
  therapist_confirmed: "Therapist confirmed",
  editorial_review: "Editorial review",
  import_pipeline: "Import pipeline",
};

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeList(value) {
  return ensureArray(value)
    .map(function (item) {
      return normalizeText(item);
    })
    .filter(Boolean);
}

function serializeValue(value) {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return normalizeText(value);
}

function parseSerializedValue(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  if (text === "true") {
    return true;
  }
  if (text === "false") {
    return false;
  }
  if (
    (text.startsWith("[") && text.endsWith("]")) ||
    (text.startsWith("{") && text.endsWith("}"))
  ) {
    try {
      return JSON.parse(text);
    } catch (_error) {
      return text;
    }
  }
  return text;
}

function labelFor(value, labels) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  return (
    labels[normalized] || normalized.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ")
  );
}

function hasMeaningfulValue(value) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.some(function (item) {
      return normalizeText(item);
    });
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return Boolean(normalizeText(value));
}

function normalizeFieldValue(fieldName, value) {
  if (fieldName === "languages") {
    const list = normalizeList(value);
    return JSON.stringify(list.length ? list : ["English"]);
  }

  if (
    fieldName === "specialties" ||
    fieldName === "treatmentModalities" ||
    fieldName === "clientPopulations" ||
    fieldName === "insuranceAccepted" ||
    fieldName === "telehealthStates"
  ) {
    return JSON.stringify(normalizeList(value));
  }

  if (
    fieldName === "acceptsTelehealth" ||
    fieldName === "acceptsInPerson" ||
    fieldName === "acceptingNewPatients" ||
    fieldName === "medicationManagement" ||
    fieldName === "slidingScale"
  ) {
    return value === true ? "true" : value === false ? "false" : "";
  }

  return serializeValue(value);
}

function normalizeIdSegment(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hashString(value) {
  const input = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildProviderFieldObservationId(input) {
  const providerId = normalizeIdSegment(input.providerId || buildProviderId(input));
  const fieldName = normalizeIdSegment(input.fieldName);
  const sourceType = normalizeIdSegment(input.sourceType);
  const sourceDocumentId = normalizeIdSegment(input.sourceDocumentId);
  const suffix = hashString([providerId, fieldName, sourceType, sourceDocumentId].join("|"));

  return [
    "provider-field-observation",
    providerId || "provider",
    fieldName || "field",
    sourceType || "source",
    suffix,
  ].join("-");
}

export function createProviderFieldObservation(input) {
  const providerId = String(input.providerId || "").trim() || buildProviderId(input);
  const fieldName = normalizeText(input.fieldName);
  const observedAt = normalizeText(input.observedAt) || new Date().toISOString();
  const verifiedAt = normalizeText(input.verifiedAt);

  return {
    _id:
      input.id ||
      buildProviderFieldObservationId({
        providerId,
        fieldName,
        sourceType: input.sourceType,
        sourceDocumentId: input.sourceDocumentId,
      }),
    _type: "providerFieldObservation",
    providerId,
    fieldName,
    rawValue: serializeValue(input.rawValue),
    normalizedValue:
      input.normalizedValue === undefined
        ? normalizeFieldValue(fieldName, input.rawValue)
        : serializeValue(input.normalizedValue),
    sourceType: normalizeText(input.sourceType),
    sourceDocumentType: normalizeText(input.sourceDocumentType),
    sourceDocumentId: normalizeText(input.sourceDocumentId),
    sourceUrl: normalizeText(input.sourceUrl),
    observedAt,
    verifiedAt,
    confidenceScore:
      typeof input.confidenceScore === "number" && Number.isFinite(input.confidenceScore)
        ? Math.max(0, Math.min(100, input.confidenceScore))
        : undefined,
    verificationMethod: normalizeText(input.verificationMethod),
    isCurrent: input.isCurrent !== false,
  };
}

export function buildProviderFieldObservationsFromSource(source, options = {}) {
  const doc = source && typeof source === "object" ? source : {};
  const fields = ensureArray(options.fields).length
    ? ensureArray(options.fields)
    : [
        "specialties",
        "treatmentModalities",
        "clientPopulations",
        "insuranceAccepted",
        "languages",
        "telehealthStates",
        "estimatedWaitTime",
        "bipolarYearsExperience",
        "acceptsTelehealth",
        "acceptsInPerson",
        "acceptingNewPatients",
        "medicationManagement",
        "sessionFeeMin",
        "sessionFeeMax",
        "slidingScale",
      ];

  const sourceType =
    normalizeText(options.sourceType) ||
    normalizeText(doc._type) ||
    normalizeText(doc.sourceDocumentType) ||
    "manual_review";
  const sourceDocumentType =
    normalizeText(options.sourceDocumentType) || normalizeText(doc._type) || "";
  const sourceDocumentId = normalizeText(options.sourceDocumentId) || normalizeText(doc._id);
  const sourceUrl =
    normalizeText(options.sourceUrl) ||
    normalizeText(
      doc.sourceUrl || doc.source_url || doc.website || doc.bookingUrl || doc.booking_url,
    );
  const providerId =
    normalizeText(options.providerId) ||
    normalizeText(doc.providerId || doc.provider_id) ||
    buildProviderId(doc);
  const observedAt =
    normalizeText(options.observedAt) ||
    normalizeText(
      doc.sourceReviewedAt || doc.source_reviewed_at || doc._updatedAt || doc.updatedAt,
    );
  const verifiedAt =
    normalizeText(options.verifiedAt) ||
    normalizeText(
      doc.therapistReportedConfirmedAt || doc.therapist_reported_confirmed_at || observedAt,
    );

  return fields
    .filter(function (fieldName) {
      return hasMeaningfulValue(doc[fieldName]);
    })
    .map(function (fieldName) {
      return createProviderFieldObservation({
        providerId,
        fieldName,
        rawValue: doc[fieldName],
        sourceType,
        sourceDocumentType,
        sourceDocumentId,
        sourceUrl,
        observedAt,
        verifiedAt,
        confidenceScore: options.confidenceScore,
        verificationMethod: options.verificationMethod,
        isCurrent: options.isCurrent,
      });
    });
}

export function annotateProviderFieldObservationForDisplay(observation) {
  const source = observation && typeof observation === "object" ? observation : {};
  return {
    ...source,
    parsedRawValue: parseSerializedValue(source.rawValue),
    parsedNormalizedValue: parseSerializedValue(source.normalizedValue),
    labels: {
      fieldName: labelFor(source.fieldName, FIELD_LABELS),
      sourceType: labelFor(source.sourceType, SOURCE_TYPE_LABELS),
      verificationMethod: labelFor(source.verificationMethod, VERIFICATION_METHOD_LABELS),
      currentState: source.isCurrent === false ? "Historical" : "Current",
    },
  };
}
