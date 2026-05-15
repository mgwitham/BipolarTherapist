// Server-side portal-completeness scoring.
//
// Used by:
//   - server/review-portal-profile-routes.mjs (therapist saves from portal)
//   - server/review-ops-routes.mjs            (admin saves from God-mode drawer)
//
// Both consumers feed in the post-save therapist doc (camelCase Sanity
// shape) and persist the resulting snapshot so the Completeness Tracker
// always reflects the latest edits — regardless of which surface made
// them. Browser-side scoring lives in assets/portal-td-completeness.js
// and reads a different (snake_case) shape; both sides pull point
// values from shared/portal-completeness-registry.mjs so the score
// is impossible to drift between server and browser.
import { PORTAL_COMPLETENESS_POINTS as PTS } from "../shared/portal-completeness-registry.mjs";

// Point values come from the shared registry; the per-field "done"
// predicates stay here because they read the camelCase Sanity doc shape.
export function computePortalCompletenessSnapshot(t) {
  if (!t) return { score: 0, missingFields: [] };
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const str = (v) => String(v || "").trim();
  const num = (v) => Number(v) || 0;
  const method = str(t.preferredContactMethod).toLowerCase();
  const fields = [
    { key: "card_bio", pts: PTS.card_bio, done: str(t.careApproach).length >= 50 },
    {
      key: "contact",
      pts: PTS.contact,
      done:
        method === "email"
          ? Boolean(str(t.email))
          : method === "phone"
            ? Boolean(str(t.phone))
            : method === "booking"
              ? Boolean(str(t.bookingUrl))
              : false,
    },
    { key: "headshot", pts: PTS.headshot, done: Boolean(t.hasPhoto) },
    { key: "name", pts: PTS.name, done: Boolean(str(t.name)) },
    { key: "location", pts: PTS.location, done: Boolean(str(t.city) && str(t.state)) },
    { key: "years", pts: PTS.years, done: num(t.bipolarYearsExperience) > 0 },
    { key: "full_bio", pts: PTS.full_bio, done: Boolean(str(t.bio)) },
    { key: "practice_name", pts: PTS.practice_name, done: Boolean(str(t.practiceName)) },
    { key: "website", pts: PTS.website, done: Boolean(str(t.website)) },
    { key: "languages", pts: PTS.languages, done: arr(t.languages).length > 0 },
    {
      key: "fee",
      pts: PTS.fee,
      done: num(t.sessionFeeMin) > 0 || num(t.sessionFeeMax) > 0 || t.slidingScale === true,
    },
    { key: "modalities", pts: PTS.modalities, done: arr(t.treatmentModalities).length > 0 },
    { key: "format", pts: PTS.format, done: Boolean(t.acceptsInPerson || t.acceptsTelehealth) },
    { key: "insurance", pts: PTS.insurance, done: arr(t.insuranceAccepted).length > 0 },
    { key: "wait_time", pts: PTS.wait_time, done: Boolean(str(t.estimatedWaitTime)) },
    { key: "first_step", pts: PTS.first_step, done: Boolean(str(t.firstStepExpectation)) },
    { key: "specialties", pts: PTS.specialties, done: arr(t.specialties).length > 0 },
    { key: "populations", pts: PTS.populations, done: arr(t.clientPopulations).length > 0 },
    { key: "total_years", pts: PTS.total_years, done: num(t.yearsExperience) > 0 },
    {
      key: "gender",
      pts: PTS.gender,
      done:
        str(t.gender) === "male" || str(t.gender) === "female" || str(t.gender) === "non_binary",
    },
  ];
  let score = 0;
  const missingFields = [];
  for (const f of fields) {
    if (f.done) score += f.pts;
    else missingFields.push(f.key);
  }
  return { score, missingFields };
}

// Writes the completeness snapshot onto the therapist doc. Fire-and-forget —
// do NOT await this; the caller's response does not need to block on it.
// Caller can pass `hasPhoto` separately if the snapshot input doesn't carry
// the post-patch photo state (e.g. when computing from a merged patch shape).
export function persistCompletenessSnapshot(client, therapistId, snapshot, nowIso) {
  client
    .patch(therapistId)
    .set({
      portalCompletenessScore: snapshot.score,
      portalCompletionFields: snapshot.missingFields,
      portalCompletenessUpdatedAt: nowIso,
    })
    .commit({ visibility: "async" })
    .catch(() => {});
}
