// Browser-side portal-completeness scoring (snake_case portal shape).
//
// One scorer for every browser surface: the TD-A header badge (portal.js)
// and the TD-B completeness editor (portal-td-completeness.js). Point
// values come from shared/portal-completeness-registry.mjs — the same
// source the server snapshot (server/portal-completeness-snapshot.mjs)
// uses — so all three surfaces show the same number for the same
// therapist. The predicates live here (not in the registry) because they
// read the browser's snake_case shape; the server keeps camelCase twins.
//
// History: the TD-A header previously used a hand-coded "40-point
// baseline + weights" model that predated the registry and had drifted
// from it (no card-bio or contact scoring, weights summing past 100).
// Therapists could see one score in the header and another in the
// completeness panel below it.

import {
  PORTAL_COMPLETENESS_FIELDS,
  PORTAL_COMPLETENESS_MAX_SCORE,
} from "../shared/portal-completeness-registry.mjs";

// "Your card bio", short bipolar-specific paragraph that powers the
// patient match-card voice slot. Required, ≥50 chars to gate going-live.
// NOT the same as t.bio (the long-form full profile body).
export function isCardBioComplete(t) {
  return Boolean(t && String(t.care_approach || "").trim().length >= 50);
}
// "Full bio", long-form text shown on the public profile page. Optional,
// no char minimum.
export function isFullBioComplete(t) {
  return Boolean(t && String(t.bio || "").trim());
}
export function isContactRouteComplete(t) {
  if (!t) return false;
  const method = String(t.preferred_contact_method || "").toLowerCase();
  if (method === "email") return Boolean(String(t.email || "").trim());
  if (method === "phone") return Boolean(String(t.phone || "").trim());
  if (method === "booking") return Boolean(String(t.booking_url || "").trim());
  return false;
}
export function isHeadshotComplete(t) {
  return Boolean(t && t.photo_url);
}
export function isNameComplete(t) {
  return Boolean(t && String(t.name || "").trim());
}
export function isLocationComplete(t) {
  return Boolean(t && String(t.city || "").trim() && String(t.state || "").trim());
}
export function isFeeComplete(t) {
  if (!t) return false;
  return Number(t.session_fee_min) > 0 || Number(t.session_fee_max) > 0 || Boolean(t.sliding_scale);
}
export function isModalitiesComplete(t) {
  return Boolean(
    t && Array.isArray(t.treatment_modalities) && t.treatment_modalities.filter(Boolean).length > 0,
  );
}
export function isFormatComplete(t) {
  return Boolean(t && (t.accepts_in_person || t.accepts_telehealth));
}
export function isInsuranceComplete(t) {
  return Boolean(
    t && Array.isArray(t.insurance_accepted) && t.insurance_accepted.filter(Boolean).length > 0,
  );
}
export function isPopulationsComplete(t) {
  return Boolean(
    t && Array.isArray(t.client_populations) && t.client_populations.filter(Boolean).length > 0,
  );
}
export function isYearsComplete(t) {
  return Number(t && t.bipolar_years_experience) > 0;
}
export function isPracticeNameComplete(t) {
  return Boolean(t && String(t.practice_name || "").trim());
}
export function isWebsiteComplete(t) {
  return Boolean(t && String(t.website || "").trim());
}
export function isLanguagesComplete(t) {
  return Boolean(t && Array.isArray(t.languages) && t.languages.filter(Boolean).length > 0);
}
export function isWaitTimeComplete(t) {
  return Boolean(t && String(t.estimated_wait_time || "").trim());
}
export function isFirstStepComplete(t) {
  return Boolean(t && String(t.first_step_expectation || "").trim());
}
export function isSpecialtiesComplete(t) {
  return Boolean(t && Array.isArray(t.specialties) && t.specialties.filter(Boolean).length > 0);
}
export function isTotalYearsComplete(t) {
  return Number(t && t.years_experience) > 0;
}
export function isGenderComplete(t) {
  const g = String((t && t.gender) || "").trim();
  return g === "male" || g === "female" || g === "non_binary";
}

// Registry key → predicate. Every registry field MUST have an entry here;
// computePortalProfileScore throws on a missing one so adding a field to
// the registry without a browser predicate fails loudly in tests, not
// silently as a score that can never reach 100.
export const PORTAL_COMPLETENESS_PREDICATES = {
  card_bio: isCardBioComplete,
  contact: isContactRouteComplete,
  headshot: isHeadshotComplete,
  name: isNameComplete,
  location: isLocationComplete,
  years: isYearsComplete,
  full_bio: isFullBioComplete,
  practice_name: isPracticeNameComplete,
  website: isWebsiteComplete,
  languages: isLanguagesComplete,
  fee: isFeeComplete,
  modalities: isModalitiesComplete,
  format: isFormatComplete,
  insurance: isInsuranceComplete,
  wait_time: isWaitTimeComplete,
  first_step: isFirstStepComplete,
  specialties: isSpecialtiesComplete,
  populations: isPopulationsComplete,
  total_years: isTotalYearsComplete,
  gender: isGenderComplete,
};

export { PORTAL_COMPLETENESS_MAX_SCORE };

// Registry-driven score. Sum of all registry `pts` = 100, so the score
// only reaches 100 when every field is complete.
export function computePortalProfileScore(t) {
  if (!t) return 0;
  let score = 0;
  for (const field of PORTAL_COMPLETENESS_FIELDS) {
    const isComplete = PORTAL_COMPLETENESS_PREDICATES[field.key];
    if (typeof isComplete !== "function") {
      throw new Error(`No completeness predicate for registry field "${field.key}"`);
    }
    if (isComplete(t)) score += field.pts;
  }
  return score;
}
