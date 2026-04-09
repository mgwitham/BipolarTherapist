export function splitList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(function (item) {
      return String(item || "").trim();
    })
    .filter(Boolean);
}

export function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

export function parseNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function normalizeLicensureVerification(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const normalized = {
    jurisdiction: String(value.jurisdiction || "").trim(),
    sourceSystem: String(value.sourceSystem || "").trim(),
    boardName: String(value.boardName || "").trim(),
    boardCode: String(value.boardCode || "").trim(),
    licenseType: String(value.licenseType || "").trim(),
    primaryStatus: String(value.primaryStatus || "").trim(),
    statusStanding: String(value.statusStanding || "").trim(),
    issueDate: String(value.issueDate || "").trim(),
    expirationDate: String(value.expirationDate || "").trim(),
    addressOfRecord: String(value.addressOfRecord || "").trim(),
    addressCity: String(value.addressCity || "").trim(),
    addressState: String(value.addressState || "").trim(),
    addressZip: String(value.addressZip || "").trim(),
    county: String(value.county || "").trim(),
    professionalUrl: String(value.professionalUrl || "").trim(),
    profileUrl: String(value.profileUrl || "").trim(),
    searchUrl: String(value.searchUrl || "").trim(),
    verifiedAt: String(value.verifiedAt || "").trim(),
    verificationMethod: String(value.verificationMethod || "").trim(),
    confidenceScore: Number.isFinite(Number(value.confidenceScore))
      ? Number(value.confidenceScore)
      : undefined,
    disciplineFlag: Boolean(value.disciplineFlag),
    disciplineSummary: String(value.disciplineSummary || "").trim(),
    rawSnapshot: String(value.rawSnapshot || "").trim(),
  };

  const hasValue = Object.values(normalized).some(function (entry) {
    return entry !== "" && entry !== false && entry !== undefined;
  });
  return hasValue ? normalized : null;
}

export function mergeLicensureVerification(existingValue, incomingValue) {
  const existing = normalizeLicensureVerification(existingValue);
  const incoming = normalizeLicensureVerification(incomingValue);
  if (!existing) return incoming;
  if (!incoming) return existing;

  const existingVerifiedAt = existing.verifiedAt ? new Date(existing.verifiedAt).getTime() : 0;
  const incomingVerifiedAt = incoming.verifiedAt ? new Date(incoming.verifiedAt).getTime() : 0;
  const preferred = incomingVerifiedAt >= existingVerifiedAt ? incoming : existing;
  const secondary = preferred === incoming ? existing : incoming;

  return normalizeLicensureVerification({
    ...secondary,
    ...preferred,
    disciplineFlag: Boolean(existing.disciplineFlag || incoming.disciplineFlag),
    disciplineSummary: [secondary.disciplineSummary, preferred.disciplineSummary]
      .filter(Boolean)
      .join("\n\n"),
  });
}

export function parsePhotoSourceType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    normalized === "therapist_uploaded" ||
    normalized === "practice_uploaded" ||
    normalized === "public_source"
  ) {
    return normalized;
  }
  return "";
}

export function decodeBase64FilePayload(payload, options) {
  const raw = String(payload || "").trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid headshot upload format.");
  }

  const mimeType = String(match[1] || "")
    .trim()
    .toLowerCase();
  const base64 = String(match[2] || "").trim();
  if (!options.allowedMimeTypes.has(mimeType)) {
    throw new Error("Headshot must be a JPG, PNG, or WebP image.");
  }

  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) {
    throw new Error("Headshot upload was empty.");
  }
  if (buffer.length > options.maxPhotoUploadBytes) {
    throw new Error("Headshot image is too large. Keep it under 4 MB.");
  }

  return {
    mimeType: mimeType,
    buffer: buffer,
  };
}

export async function uploadPhotoAssetIfPresent(client, input, options) {
  const decoded = decodeBase64FilePayload(input.photo_upload_base64, options);
  if (!decoded) {
    return null;
  }

  const filename =
    String(input.photo_filename || "therapist-headshot").trim() || "therapist-headshot";
  const asset = await client.assets.upload("image", decoded.buffer, {
    filename: filename,
    contentType: decoded.mimeType,
  });

  return {
    _type: "image",
    asset: {
      _type: "reference",
      _ref: asset._id,
    },
  };
}

export async function buildApplicationDocument(client, input, deps) {
  const slug = deps.slugify(
    input.slug || [input.name, input.city, input.state].filter(Boolean).join(" "),
  );
  const now = new Date().toISOString();
  const photo = await uploadPhotoAssetIfPresent(client, input, deps.photoOptions);
  const photoSourceType = parsePhotoSourceType(input.photo_source_type);
  const intakeType = deps.resolveApplicationIntakeType(input);
  const providerId = deps.buildProviderId(input);

  if (
    !input.name ||
    !input.credentials ||
    !input.email ||
    !input.city ||
    !input.state ||
    !input.bio ||
    !input.license_state ||
    !input.license_number ||
    !input.care_approach
  ) {
    throw new Error("Missing required application fields.");
  }

  return {
    _id: `therapist-application-${slug || Date.now()}-${Date.now()}`,
    _type: "therapistApplication",
    intakeType: intakeType,
    providerId: providerId,
    targetTherapistSlug: String(input.target_therapist_slug || input.slug || "").trim(),
    targetTherapistId: String(
      input.target_therapist_id || input.published_therapist_id || "",
    ).trim(),
    name: input.name.trim(),
    email: input.email.trim(),
    credentials: input.credentials.trim(),
    title: (input.title || "").trim(),
    ...(photo ? { photo: photo } : {}),
    photoSourceType: photoSourceType,
    photoReviewedAt: photoSourceType ? now : "",
    photoUsagePermissionConfirmed: parseBoolean(input.photo_usage_permission_confirmed, false),
    practiceName: (input.practice_name || "").trim(),
    phone: (input.phone || "").trim(),
    website: (input.website || "").trim(),
    preferredContactMethod: (input.preferred_contact_method || "").trim(),
    preferredContactLabel: (input.preferred_contact_label || "").trim(),
    contactGuidance: (input.contact_guidance || "").trim(),
    firstStepExpectation: (input.first_step_expectation || "").trim(),
    bookingUrl: (input.booking_url || "").trim(),
    city: input.city.trim(),
    state: input.state.trim(),
    zip: (input.zip || "").trim(),
    country: "US",
    licenseState: (input.license_state || "").trim().toUpperCase(),
    licenseNumber: (input.license_number || "").trim(),
    licensureVerification: normalizeLicensureVerification(input.licensure_verification),
    bio: input.bio.trim(),
    careApproach: (input.care_approach || "").trim(),
    specialties: splitList(input.specialties),
    treatmentModalities: splitList(input.treatment_modalities),
    clientPopulations: splitList(input.client_populations),
    insuranceAccepted: splitList(input.insurance_accepted),
    languages: splitList(input.languages).length ? splitList(input.languages) : ["English"],
    yearsExperience: parseNumber(input.years_experience),
    bipolarYearsExperience: parseNumber(input.bipolar_years_experience),
    acceptsTelehealth: parseBoolean(input.accepts_telehealth, true),
    acceptsInPerson: parseBoolean(input.accepts_in_person, true),
    acceptingNewPatients: true,
    telehealthStates: splitList(input.telehealth_states),
    estimatedWaitTime: (input.estimated_wait_time || "").trim(),
    medicationManagement: parseBoolean(input.medication_management, false),
    verificationStatus: "under_review",
    sourceUrl: (input.source_url || input.website || "").trim(),
    supportingSourceUrls: splitList(input.supporting_source_urls),
    sourceReviewedAt: (input.source_reviewed_at || "").trim(),
    therapistReportedFields: splitList(input.therapist_reported_fields),
    therapistReportedConfirmedAt: (input.therapist_reported_confirmed_at || "").trim() || now,
    fieldReviewStates: deps.createTherapistConfirmedFieldReviewStates({
      keyStyle: "camelCase",
    }),
    sessionFeeMin: parseNumber(input.session_fee_min),
    sessionFeeMax: parseNumber(input.session_fee_max),
    slidingScale: parseBoolean(input.sliding_scale, false),
    status: "pending",
    notes: (input.notes || "").trim(),
    publishedTherapistId: (input.published_therapist_id || "").trim(),
    submittedSlug: slug,
    submittedAt: now,
    updatedAt: now,
  };
}

export async function buildRevisionFieldUpdates(client, input, existingApplication, deps) {
  const photo = await uploadPhotoAssetIfPresent(client, input, deps.photoOptions);
  const photoSourceType = parsePhotoSourceType(input.photo_source_type);
  return {
    name: String(input.name || "").trim(),
    email: String(input.email || "").trim(),
    credentials: String(input.credentials || "").trim(),
    title: String(input.title || "").trim(),
    ...(photo ? { photo: photo } : {}),
    photoSourceType: photoSourceType || existingApplication.photoSourceType || "",
    photoReviewedAt:
      photo || photoSourceType
        ? new Date().toISOString()
        : String(existingApplication.photoReviewedAt || "").trim(),
    photoUsagePermissionConfirmed: parseBoolean(
      input.photo_usage_permission_confirmed,
      Boolean(existingApplication.photoUsagePermissionConfirmed),
    ),
    practiceName: String(input.practice_name || "").trim(),
    phone: String(input.phone || "").trim(),
    website: String(input.website || "").trim(),
    preferredContactMethod: String(input.preferred_contact_method || "").trim(),
    preferredContactLabel: String(input.preferred_contact_label || "").trim(),
    contactGuidance: String(input.contact_guidance || "").trim(),
    firstStepExpectation: String(input.first_step_expectation || "").trim(),
    bookingUrl: String(input.booking_url || "").trim(),
    city: String(input.city || "").trim(),
    state: String(input.state || "").trim(),
    zip: String(input.zip || "").trim(),
    licenseState: String(input.license_state || "")
      .trim()
      .toUpperCase(),
    licenseNumber: String(input.license_number || "").trim(),
    licensureVerification: normalizeLicensureVerification(
      input.licensure_verification || existingApplication.licensureVerification,
    ),
    bio: String(input.bio || "").trim(),
    careApproach: String(input.care_approach || "").trim(),
    specialties: splitList(input.specialties),
    treatmentModalities: splitList(input.treatment_modalities),
    clientPopulations: splitList(input.client_populations),
    insuranceAccepted: splitList(input.insurance_accepted),
    languages: splitList(input.languages).length ? splitList(input.languages) : ["English"],
    yearsExperience: parseNumber(input.years_experience),
    bipolarYearsExperience: parseNumber(input.bipolar_years_experience),
    acceptsTelehealth: parseBoolean(input.accepts_telehealth, true),
    acceptsInPerson: parseBoolean(input.accepts_in_person, true),
    telehealthStates: splitList(input.telehealth_states),
    estimatedWaitTime: String(input.estimated_wait_time || "").trim(),
    medicationManagement: parseBoolean(input.medication_management, false),
    sourceUrl: String(input.source_url || input.website || "").trim(),
    supportingSourceUrls: splitList(input.supporting_source_urls),
    sourceReviewedAt: String(input.source_reviewed_at || "").trim(),
    therapistReportedFields: splitList(input.therapist_reported_fields),
    therapistReportedConfirmedAt: String(input.therapist_reported_confirmed_at || "").trim(),
    fieldReviewStates: deps.mapFieldReviewStatesToCamelCase(input.field_review_states, {
      fallbackState: "therapist_confirmed",
    }),
    sessionFeeMin: parseNumber(input.session_fee_min),
    sessionFeeMax: parseNumber(input.session_fee_max),
    slidingScale: parseBoolean(input.sliding_scale, false),
  };
}

export function validateRevisionInput(input) {
  if (
    !input.name ||
    !input.credentials ||
    !input.email ||
    !input.city ||
    !input.state ||
    !input.bio ||
    !input.license_state ||
    !input.license_number ||
    !input.care_approach
  ) {
    throw new Error("Missing required application fields.");
  }
}

export async function updateApplicationFields(client, applicationId, fields) {
  const allowedUpdates = {};

  if (typeof fields.notes === "string") {
    allowedUpdates.notes = fields.notes.trim();
  }

  if (
    typeof fields.status === "string" &&
    ["pending", "reviewing", "requested_changes", "approved", "rejected"].includes(fields.status)
  ) {
    allowedUpdates.status = fields.status;
  }

  if (typeof fields.review_request_message === "string") {
    allowedUpdates.reviewRequestMessage = fields.review_request_message.trim();
  }

  if (!Object.keys(allowedUpdates).length && !fields.revision_history_entry) {
    throw new Error("No valid application updates were provided.");
  }

  allowedUpdates.updatedAt = new Date().toISOString();
  const patch = client.patch(applicationId).set(allowedUpdates);

  if (fields.revision_history_entry && typeof fields.revision_history_entry === "object") {
    patch.setIfMissing({ revisionHistory: [] }).append("revisionHistory", [
      {
        _key: `${Date.now()}`,
        type: String(fields.revision_history_entry.type || "updated"),
        at: new Date().toISOString(),
        message: String(fields.revision_history_entry.message || "").trim(),
      },
    ]);
  }

  return patch.commit({ visibility: "sync" });
}
