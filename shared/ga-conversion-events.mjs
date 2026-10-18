// Funnel events forwarded to GA4 as events. GA4 is the only tool that joins
// conversions to the Search Console query that produced them, so only the
// handful of events that mark real patient intent or therapist revenue go
// here, not the full ~150-event funnel taxonomy. Names match the in-house
// funnel event names so GA4 and the admin Funnel dashboard line up 1:1.
//
// HARD RULE: every name here MUST be an event the app actually emits via
// trackFunnelEvent. test/assets/ga-conversion-events.test.mjs enforces it
// against assets/ so a renamed or dead event can't silently read zero in GA4
// (match_submitted did exactly that after the guided intake was retired).
//
// Pure: no I/O.

export const GA_CONVERSION_EVENTS = new Set([
  // Live patient path: home -> /results -> profile or directory contact.
  "home_match_started", // patient started the match from the homepage (funnel entry)
  "match_results_page_viewed", // patient saw their matches (qualified intent)
  "match_results_card_clicked", // patient opened a therapist from their matches
  "directory_card_contact_action", // patient contacted a provider from the directory
  "profile_contact_route_clicked", // patient clicked a contact route on a profile
  "saved_list_email_requested", // patient asked us to email their saved list
  // Legacy guided intake (/match?shortlist=...). Still reachable from saved
  // links, so keep forwarding if it ever fires.
  "match_submitted",
  "match_contact_completed",
  // Therapist revenue intent.
  "pricing_checkout_clicked",
]);

/** @param {unknown} type */
export function isGaConversionEvent(type) {
  return typeof type === "string" && GA_CONVERSION_EVENTS.has(type);
}
