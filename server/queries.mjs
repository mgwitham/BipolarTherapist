/**
 * Named GROQ query constants shared across route modules.
 *
 * Keeping projections here means a field addition or rename touches one
 * file instead of every route that reads therapist documents.
 */

// ---------------------------------------------------------------------------
// Shared projection field lists (no braces — composed into full queries below)
// ---------------------------------------------------------------------------

const PORTAL_FIELDS = `
  _id, name, email, city, state, zip, practiceName, status, listingActive,
  claimStatus, claimedByEmail, claimedAt,
  portalLastSeenAt, listingPauseRequestedAt, listingRemovalRequestedAt,
  "slug": slug.current,
  bio, credentials, title, phone, website, bookingUrl, gender,
  preferredContactMethod, preferredContactLabel, contactGuidance, firstStepExpectation,
  acceptingNewPatients, acceptsTelehealth, acceptsInPerson,
  sessionFeeMin, sessionFeeMax, slidingScale,
  specialties, insuranceAccepted, telehealthStates, treatmentModalities, languages, clientPopulations,
  careApproach, estimatedWaitTime, yearsExperience, bipolarYearsExperience,
  medicationManagement, therapistReportedFields, portalFirstSaveAt, portalLastSaveAt, portalSaveCount
`.trim();

const ADMIN_FIELDS = `
  _id, _createdAt, _updatedAt, name, credentials, title, bio, bioPreview,
  "photo": photo{asset->{url}}, photoSourceType, photoReviewedAt, photoUsagePermissionConfirmed,
  email, phone, website, preferredContactMethod, preferredContactLabel, contactGuidance,
  firstStepExpectation, bookingUrl,
  claimStatus, claimedByEmail, claimedAt, portalLastSeenAt,
  listingPauseRequestedAt, listingRemovalRequestedAt,
  practiceName, gender, city, state, zip, country, licenseState, licenseNumber,
  specialties, treatmentModalities, clientPopulations, insuranceAccepted,
  acceptsTelehealth, acceptsInPerson, acceptingNewPatients,
  yearsExperience, bipolarYearsExperience, languages, telehealthStates,
  estimatedWaitTime, careApproach, medicationManagement,
  verificationStatus, sourceUrl, supportingSourceUrls, sourceReviewedAt,
  therapistReportedFields, therapistReportedConfirmedAt,
  fieldReviewStates, sessionFeeMin, sessionFeeMax, slidingScale,
  listingActive, status, lifecycle, visibilityIntent, notes, auditLog,
  "slug": slug.current
`.trim();

// ---------------------------------------------------------------------------
// Portal queries — used by /portal/me, /portal/claim-session
// ---------------------------------------------------------------------------

export const THERAPIST_PORTAL_BY_SLUG = `*[_type == "therapist" && slug.current == $slug][0]{
  ${PORTAL_FIELDS}
}`;

// Post-save re-fetch: includes completeness snapshot fields and hasPhoto so
// the portal UI can update the completeness meter without a second request.
export const THERAPIST_PORTAL_SAVE_BY_SLUG = `*[_type == "therapist" && slug.current == $slug][0]{
  ${PORTAL_FIELDS},
  portalCompletenessScore, portalCompletionFields,
  "hasPhoto": defined(photo.asset)
}`;

// ---------------------------------------------------------------------------
// Admin queries — used by /therapists/:id/admin and /therapists/by-slug/:slug/admin
// ---------------------------------------------------------------------------

export const THERAPIST_ADMIN_BY_ID = `*[_type == "therapist" && _id == $id][0]{
  ${ADMIN_FIELDS}
}`;

export const THERAPIST_ADMIN_BY_SLUG = `*[_type == "therapist" && slug.current == $slug][0]{
  ${ADMIN_FIELDS}
}`;
