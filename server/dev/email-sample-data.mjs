// Canonical sample data for the /dev/emails preview UI and the
// docs/email-snapshots build step. Every template renders against the
// same Jamie Rivera persona so previews feel consistent. To update copy
// or shape, edit this file and regenerate snapshots:
//
//   npm run cms:snapshot:emails

const SAMPLE_PORTAL_BASE = "https://www.bipolartherapyhub.com";

export const sampleTherapist = {
  _id: "therapist-jamie-rivera",
  name: "Jamie Rivera",
  slug: { current: "jamie-rivera" },
  email: "jamie.rivera@example-therapy.com",
  phone: "(310) 555-0142",
  city: "Los Angeles",
  state: "CA",
  zip: "90025",
  credentials: "LMFT",
  title: "Therapist",
  practiceName: "Rivera Therapy PLLC",
  licenseNumber: "109462",
  licenseState: "CA",
  licenseExpiration: "2027-08-31",
  bipolarYearsExperience: 8,
  acceptsTelehealth: true,
  acceptsInPerson: true,
  acceptingNewPatients: true,
  specialties: ["Bipolar I", "Bipolar II", "Anxiety"],
  insuranceAccepted: ["Aetna", "Anthem"],
  sessionFeeMin: 160,
  sessionFeeMax: 220,
  verificationStatus: "editorially_verified",
};

export const sampleApplication = {
  _id: "application-jamie-rivera",
  name: "Jamie Rivera",
  email: "jamie.rivera@example-therapy.com",
  city: "Los Angeles",
  state: "CA",
  credentials: "LMFT",
  specialties: ["Bipolar I", "Bipolar II", "Anxiety"],
  status: "pending_review",
  licenseNumber: "109462",
  practiceName: "Rivera Therapy PLLC",
};

export const sampleRecoveryRequest = {
  _id: "recovery-jamie-rivera",
  fullName: "Jamie Rivera",
  licenseNumber: "109462",
  requestedEmail: "jamie.rivera@example-therapy.com",
  priorEmail: "jamie@old-practice.com",
  reason: "We changed our practice email address last month.",
  requesterIp: "73.222.181.0",
};

export const sampleEngagementDigest = {
  weekEndingDate: "2026-04-28",
  profileViews: 12,
  uniqueViewers: 9,
  contactClicks: 3,
  contactRouteBreakdown: [
    { method: "website", count: 2 },
    { method: "phone", count: 1 },
  ],
  topSearches: [
    { query: "bipolar therapist los angeles", count: 4 },
    { query: "bipolar II treatment 90025", count: 2 },
  ],
  changeFromPriorWeek: { profileViews: 4, contactClicks: 2 },
};

// Shape matches buildFounderFunnelDigest expectations — types align with
// the PATIENT_STEPS / SIGNUP_STEPS / CLAIM_STEPS / PORTAL_STEPS keys in
// shared/founder-funnel-digest-domain.mjs. The digest aggregates by
// type within a 7-day window before nowIso.
export const sampleFunnelEvents = [
  // Patient funnel
  { type: "home_match_started", occurredAt: "2026-04-27T18:14:00Z" },
  { type: "home_match_started", occurredAt: "2026-04-26T16:14:00Z" },
  { type: "home_match_started", occurredAt: "2026-04-25T11:14:00Z" },
  { type: "match_intake_landed", occurredAt: "2026-04-27T18:15:00Z" },
  { type: "match_intake_landed", occurredAt: "2026-04-26T16:15:00Z" },
  { type: "match_submitted", occurredAt: "2026-04-27T18:18:00Z" },
  { type: "match_submitted", occurredAt: "2026-04-26T16:20:00Z" },
  { type: "match_results_viewed", occurredAt: "2026-04-27T18:18:30Z" },
  { type: "match_results_viewed", occurredAt: "2026-04-26T16:20:30Z" },
  { type: "match_result_profile_opened", occurredAt: "2026-04-27T18:20:00Z" },
  { type: "match_contact_modal_opened", occurredAt: "2026-04-27T18:22:00Z" },
  // Signup funnel
  { type: "signup_page_viewed", occurredAt: "2026-04-26T21:01:00Z" },
  { type: "signup_page_viewed", occurredAt: "2026-04-24T11:01:00Z" },
  { type: "signup_new_listing_form_started", occurredAt: "2026-04-26T21:02:00Z" },
  { type: "signup_new_listing_submitted", occurredAt: "2026-04-26T21:08:00Z" },
  // Claim funnel
  { type: "claim_page_viewed", occurredAt: "2026-04-25T09:11:00Z" },
  { type: "claim_listing_picked", occurredAt: "2026-04-25T09:12:00Z" },
  // Portal funnel
  { type: "portal_opened", occurredAt: "2026-04-26T13:40:00Z" },
  { type: "portal_first_edit", occurredAt: "2026-04-26T13:42:00Z" },
  { type: "portal_save_success", occurredAt: "2026-04-26T13:45:00Z" },
];

// Weekly digest "current" + "previous" period rollups. Shape matches
// what buildWeeklyDigest in shared/weekly-digest-domain.mjs expects.
export const sampleWeeklyDigestPeriods = {
  current: {
    periodKey: "2026-W17",
    periodStart: "2026-04-21T00:00:00Z",
    profileViewsTotal: 12,
    ctaClicksTotal: 3,
  },
  previous: {
    periodKey: "2026-W16",
    periodStart: "2026-04-14T00:00:00Z",
    profileViewsTotal: 8,
    ctaClicksTotal: 1,
  },
};

export const samplePortalContactForm = {
  requesterName: "Jamie Rivera",
  requesterEmail: "jamie.rivera@example-therapy.com",
  requestType: "update_listing",
  requestLabel: "Update listing details",
  therapistName: "Jamie Rivera",
  therapistSlug: "jamie-rivera",
  licenseNumber: "109462",
  message:
    "Hi — I just moved practices and need to update my street address and primary phone. Can you walk me through it?",
};

// Sample fixture for the portal completeness nudge preview. Field keys
// must match COMPLETENESS_FIELD_LABELS in server/review-email.mjs so the
// rendered rows look like a real low-score therapist.
export const sampleCompletenessSnapshot = {
  completenessScore: 38,
  missingFields: ["contact", "headshot", "first_step", "languages", "wait_time"],
};

export const sampleLinks = {
  portalBaseUrl: SAMPLE_PORTAL_BASE,
  portalUrl: SAMPLE_PORTAL_BASE + "/portal",
  listingUrl: SAMPLE_PORTAL_BASE + "/therapists/jamie-rivera/",
  magicLink:
    SAMPLE_PORTAL_BASE +
    "/portal?token=eyJzdWIiOiJ0aGVyYXBpc3QtcG9ydGFsIiwiZXhwIjoxNzY0MDI4ODAwfQ.SAMPLE_TOKEN",
  activationUrl:
    SAMPLE_PORTAL_BASE +
    "/claim?token=eyJzdWIiOiJ0aGVyYXBpc3QtcG9ydGFsIiwiZXhwIjoxNzY0MDI4ODAwfQ.SAMPLE_TOKEN",
  confirmUrl:
    SAMPLE_PORTAL_BASE +
    "/confirm-claim?token=eyJzdWIiOiJyZWNvdmVyeS1jb25maXJtIn0.SAMPLE_TOKEN&decision=confirm",
  denyUrl:
    SAMPLE_PORTAL_BASE +
    "/confirm-claim?token=eyJzdWIiOiJyZWNvdmVyeS1jb25maXJtIn0.SAMPLE_TOKEN&decision=deny",
  removalUrl:
    SAMPLE_PORTAL_BASE + "/remove.html?token=eyJzdWIiOiJsaXN0aW5nLXJlbW92YWwifQ.SAMPLE_TOKEN",
  adminUrl: SAMPLE_PORTAL_BASE + "/admin.html",
};

// A minimal config snippet — the preview registry merges this with the live
// review config so capture-mode renders work even if RESEND_API_KEY is unset.
// hasEmailConfig() is bypassed in capture mode.
export function buildSampleEmailConfig(baseConfig) {
  const merged = Object.assign({}, baseConfig || {});
  if (!merged.emailFrom) merged.emailFrom = "BipolarTherapyHub <support@bipolartherapyhub.com>";
  if (!merged.notificationTo) merged.notificationTo = "support@bipolartherapyhub.com";
  if (!merged.portalBaseUrl) merged.portalBaseUrl = SAMPLE_PORTAL_BASE;
  if (!merged.resendApiKey) merged.resendApiKey = "re_PREVIEW_KEY_NOT_USED";
  return merged;
}
