// Single source of truth for funnel step definitions, shared by the
// founder digest (shared/founder-funnel-digest-domain.mjs) and the admin
// Funnel dashboard (assets/admin-funnel.js) so the two can never drift.
//
// HARD RULE: every `key` below MUST be an event the app actually emits
// via trackFunnelEvent. test/assets/funnel-step-keys.test.mjs enforces
// this against the live assets/ source, so a renamed or deleted event
// can't silently leave a funnel reading zero.
//
// Funnels are kept monotonic (each step a strict subset of the prior)
// because consumers render conversion as count/first-step. Per-event
// counters that fire multiple times per session (e.g. portal_td_field_saved)
// are deliberately NOT used as steps — they'd push conversion over 100%.

// Demand path. Anchored on the live results page (home -> /results), not
// the deprecated match.html guided-intake flow whose events
// (match_submitted, match_intake_landed) are redirected away in
// vercel.json and so never fire for real users.
export const PATIENT_STEPS = [
  { key: "match_results_page_viewed", label: "Saw matches" },
  { key: "match_results_card_clicked", label: "Opened a therapist" },
  { key: "profile_contact_route_clicked", label: "Reached out" },
];

export const SIGNUP_STEPS = [
  { key: "signup_page_viewed", label: "Viewed signup" },
  { key: "signup_new_listing_form_started", label: "Started the form" },
  { key: "signup_new_listing_submit_attempted", label: "Attempted submit" },
  { key: "signup_new_listing_submitted", label: "Submitted" },
];

// Now extended past the "link sent" step to capture what happens
// after the magic-link email lands in the therapist's inbox — the
// previously-dark transitions between email arrival and a finalized
// claim. claim_link_opened fires on portal load with a claim_token;
// claim_accepted fires after the confirm-button click succeeds.
export const CLAIM_STEPS = [
  { key: "claim_page_viewed", label: "Viewed claim" },
  { key: "claim_listing_selected", label: "Selected a listing" },
  { key: "claim_send_link_clicked", label: "Requested claim link" },
  { key: "claim_link_sent", label: "Claim link sent" },
  { key: "claim_link_opened", label: "Opened claim link" },
  { key: "claim_accepted", label: "Claim accepted" },
];

// Login → first publish. portal_first_save fires once per session
// when a profile transitions from not-live to live (i.e. both
// required fields completed). This is distinct from
// portal_td_field_saved which fires per-field and would push
// conversion over 100%.
export const PORTAL_STEPS = [
  { key: "portal_signin_viewed", label: "Viewed sign-in" },
  { key: "portal_signin_completed", label: "Signed in" },
  { key: "portal_first_save", label: "Listing went live" },
];

export const REMOVAL_STEPS = [
  { key: "removal_page_viewed", label: "Viewed removal" },
  { key: "removal_listing_selected", label: "Selected a listing" },
  { key: "removal_link_sent", label: "Removal link sent" },
];
