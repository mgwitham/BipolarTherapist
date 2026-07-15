// Match-request persistence for the /results flow.
//
// The old /match.html intake was the only surface that POSTed
// /match/requests (stamping the referral code onto a matchRequest doc),
// but vercel.json redirects bare /match.html to "/" — patients enter
// through /results now, so match demand and referral attribution were
// never persisted. This module builds the same payload shape match.js
// sends; results.js fires it once per journey after the first render.
//
// Kept separate from results.js (an entry script that boots on import)
// so the payload logic is unit-testable in node.

import { buildRequestSummary, hasMeaningfulRefinements } from "./match-intake.js";

const RESULTS_JOURNEY_KEY = "bth_results_journey_v1";

// One journey per browser session: filter tweaks and refreshes update the
// same matchRequest doc (the server createOrReplaces on journey_id) instead
// of minting new ones — Sanity document count is the plan's binding
// constraint. Returns "" when sessionStorage is unavailable; callers skip
// persistence rather than create an unbounded doc per page load.
export function getOrCreateResultsJourneyId(storage) {
  try {
    const store = storage || window.sessionStorage;
    let id = store.getItem(RESULTS_JOURNEY_KEY);
    if (!id) {
      id = "results:" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
      store.setItem(RESULTS_JOURNEY_KEY, id);
    }
    return id;
  } catch (_error) {
    return "";
  }
}

// Mirrors match.js's persistMatchRequest payload so the admin match views
// and the referral-attribution report see one shape regardless of surface.
export function buildResultsMatchRequestPayload(profile, entries, options) {
  const opts = options || {};
  const p = profile || {};
  const list = Array.isArray(entries) ? entries : [];
  return {
    journey_id: String(opts.journeyId || ""),
    source_surface: "results_page",
    created_at: opts.now || new Date().toISOString(),
    // "" unless the visitor arrived from a clinician's referral link.
    referral_code: String(opts.referralCode || ""),
    request_summary: profile
      ? buildRequestSummary(p, hasMeaningfulRefinements)
      : "Results page search",
    care_state: p.care_state || "",
    care_format: p.care_format || "",
    care_intent: p.care_intent || "",
    needs_medication_management: p.needs_medication_management || "",
    insurance: p.insurance || "",
    budget_max: p.budget_max || null,
    priority_mode: p.priority_mode || "",
    urgency: p.urgency || "",
    bipolar_focus: Array.isArray(p.bipolar_focus) ? p.bipolar_focus : [],
    preferred_modalities: Array.isArray(p.preferred_modalities) ? p.preferred_modalities : [],
    population_fit: Array.isArray(p.population_fit) ? p.population_fit : [],
    language_preferences: Array.isArray(p.language_preferences) ? p.language_preferences : [],
    cultural_preferences: p.cultural_preferences || "",
    top_slug: list[0] && list[0].therapist ? list[0].therapist.slug || "" : "",
    result_count: list.length,
  };
}
