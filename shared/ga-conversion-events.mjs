// What reaches GA4, and under which names. GA4 should hold outcomes and the few
// funnel milestones that matter for acquisition and SEO reporting, not
// keystroke-level behavior (that stays in PostHog and the in-house log).
//
// Where Google defines a recommended event for the meaning (generate_lead,
// sign_up, begin_checkout) we use it, so GA4's built-in reporting and modeling
// apply. In-house funnel names are unchanged; only the GA4 side is mapped, so
// the admin Funnel dashboard keeps working.
//
// HARD RULE: every funnel name listed here MUST be an event the app emits via
// trackFunnelEvent. test/assets/ga-conversion-events.test.mjs enforces it
// against assets/ so a renamed or dead event can't silently read zero in GA4
// (match_submitted did exactly that after the guided intake was retired).
//
// Pure: no I/O.

const MAX_PARAMS = 10;
const MAX_STRING = 100;

/**
 * Keep only GA-safe primitives: strings (trimmed to 100 chars), finite numbers
 * and booleans, at most 10 params.
 * @param {Record<string, unknown>} params
 * @returns {Record<string, string | number | boolean>}
 */
export function sanitizeGaParams(params) {
  /** @type {Record<string, string | number | boolean>} */
  const clean = {};
  let count = 0;
  for (const key of Object.keys(params || {})) {
    if (count >= MAX_PARAMS) break;
    const value = params[key];
    if (typeof value === "string") {
      if (!value) continue;
      clean[key] = value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      clean[key] = value;
    } else if (typeof value === "boolean") {
      clean[key] = value;
    } else {
      continue;
    }
    count += 1;
  }
  return clean;
}

/** @param {Record<string, unknown> | null | undefined} payload @param {string[]} keys */
function pick(payload, keys) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of keys) {
    if (payload && payload[key] !== undefined) out[key] = payload[key];
  }
  return out;
}

/** @typedef {(payload: Record<string, unknown> | null | undefined) => { name: string, params: Record<string, unknown> }} GaMapper */

/** @type {Record<string, GaMapper>} */
const FUNNEL_TO_GA = {
  // Live patient path: home -> /results -> profile or directory contact.
  home_match_started: (p) => ({
    name: "home_match_started",
    params: pick(p, ["interest_type", "has_location"]),
  }),
  match_results_page_viewed: (p) => ({
    name: "match_results_page_viewed",
    params: pick(p, ["result_count"]),
  }),
  match_results_card_clicked: (p) => ({
    name: "match_results_card_clicked",
    params: pick(p, ["therapist_slug"]),
  }),
  // The patient conversion: a contact action, whichever surface it came from.
  profile_contact_route_clicked: (p) => ({
    name: "generate_lead",
    params: {
      lead_source: "profile",
      method: (p && p.route) || "",
      ...pick(p, ["therapist_slug"]),
    },
  }),
  directory_card_contact_action: (p) => ({
    name: "generate_lead",
    params: { lead_source: "directory", ...pick(p, ["therapist_slug"]) },
  }),
  // Legacy guided intake (/match?shortlist=...). Still reachable from saved
  // links, so keep forwarding if it ever fires.
  match_contact_completed: (p) => ({
    name: "generate_lead",
    params: { lead_source: "match", ...pick(p, ["therapist_slug"]) },
  }),
  match_submitted: () => ({ name: "match_submitted", params: {} }),
  saved_list_email_requested: () => ({ name: "saved_list_email_requested", params: {} }),
  // Therapist side.
  pricing_checkout_clicked: (p) => ({
    name: "begin_checkout",
    params: { source: "pricing_page", ...pick(p, ["therapist_slug"]) },
  }),
  claim_accepted: (p) => ({ name: "claim_accepted", params: pick(p, ["therapist_slug"]) }),
};

export const GA_CONVERSION_EVENTS = new Set(Object.keys(FUNNEL_TO_GA));

/** @param {unknown} type */
export function isGaConversionEvent(type) {
  return typeof type === "string" && Object.hasOwn(FUNNEL_TO_GA, type);
}

/**
 * Map an in-house funnel event to the GA4 event to send, or null to send none.
 * @param {unknown} type
 * @param {Record<string, unknown> | null | undefined} payload
 * @returns {{ name: string, params: Record<string, string | number | boolean> } | null}
 */
export function toGaEvent(type, payload) {
  if (!isGaConversionEvent(type)) return null;
  const mapped = FUNNEL_TO_GA[/** @type {string} */ (type)](payload);
  return { name: mapped.name, params: sanitizeGaParams(mapped.params) };
}

/**
 * The therapist signup and claim flows call gtag directly (they predate the
 * funnel bridge). Everything not listed here is dropped: ~30 micro events such
 * as signup_field_focused used to flow into GA4 and bury the outcomes.
 * @type {Record<string, GaMapper>}
 */
const DIRECT_TO_GA = {
  signup_verification_succeeded: (p) => ({
    name: "sign_up",
    params: { method: "license_verified", ...pick(p, ["duration_ms"]) },
  }),
  claim_link_sent: (p) => ({
    name: "claim_link_sent",
    params: pick(p, ["therapist_slug", "method"]),
  }),
};

/**
 * @param {unknown} name
 * @param {Record<string, unknown> | null | undefined} params
 * @returns {{ name: string, params: Record<string, string | number | boolean> } | null}
 */
export function toGaDirectEvent(name, params) {
  if (typeof name !== "string" || !Object.hasOwn(DIRECT_TO_GA, name)) return null;
  const mapped = DIRECT_TO_GA[name](params);
  return { name: mapped.name, params: sanitizeGaParams(mapped.params) };
}
