// Single source of truth for which US states the PATIENT-FACING product is
// live in — i.e. where a ZIP/city search should run a real match instead of
// routing to the out-of-state waitlist.
//
// Deliberately separate from server/license-states.mjs
// SUPPORTED_LICENSE_STATES (which therapists can sign up and be
// license-verified). The two dials usually move together, but launching a
// state needs supply first: a state can accept therapist signups for weeks
// before there's enough density to turn the patient experience on here.
//
// TO LAUNCH A STATE for patients:
//   1. Ship its ZIP dataset (see assets/zip-lookup.js — today only
//      ca-zipcodes.json exists; per-state chunks land with the first
//      expansion state).
//   2. Add the state code below.
//   3. The out-of-state waitlist gate, directory ZIP sort, and match
//      intake all read this list via isLiveMarketState().

export const LIVE_MARKET_STATES = ["CA"];

const LIVE_MARKET_SET = new Set(LIVE_MARKET_STATES);

export function isLiveMarketState(state) {
  return LIVE_MARKET_SET.has(
    String(state || "")
      .trim()
      .toUpperCase(),
  );
}
