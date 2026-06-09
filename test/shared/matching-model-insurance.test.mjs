import test from "node:test";
import assert from "node:assert/strict";

import { evaluateTherapistAgainstProfile } from "../../shared/matching-model.mjs";

// Regression for the insurance-alias drift bug: the guided match flow used
// a local plain-substring insuranceMatches, while the directory used the
// alias-aware shared matcher. A therapist listing an insurance alias (e.g.
// "BCBS") would therefore match in the directory but NOT in the match flow
// for the canonical query ("Anthem Blue Cross"). matching-model.js now uses
// the shared alias-aware matcher, so both paths agree.

function profileWantingAnthem() {
  return {
    care_state: "CA",
    care_intent: "Therapy",
    care_format: "Telehealth",
    needs_medication_management: "Open to either",
    insurance: "Anthem Blue Cross",
    priority_mode: "Best overall fit",
    urgency: "ASAP",
  };
}

function telehealthTherapist(insuranceAccepted) {
  return {
    slug:
      "t-" +
      insuranceAccepted
        .join("-")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-"),
    name: "Dr. Test",
    state: "CA",
    accepts_telehealth: true,
    telehealth_states: ["CA"],
    accepts_in_person: false,
    insurance_accepted: insuranceAccepted,
    specialties: ["Bipolar disorder"],
  };
}

function hasInsuranceMatchReason(evaluation) {
  return (evaluation.reasons || []).some((r) =>
    /requested insurance/i.test(typeof r === "string" ? r : r && r.text ? r.text : ""),
  );
}

test("match flow credits a canonical insurance the therapist lists verbatim", () => {
  const ev = evaluateTherapistAgainstProfile(
    telehealthTherapist(["Anthem Blue Cross"]),
    profileWantingAnthem(),
    null,
  );
  assert.ok(hasInsuranceMatchReason(ev), "canonical insurance should match");
});

test("match flow credits an ALIASED insurance (BCBS) for the canonical query", () => {
  const ev = evaluateTherapistAgainstProfile(
    telehealthTherapist(["BCBS"]),
    profileWantingAnthem(),
    null,
  );
  assert.ok(
    hasInsuranceMatchReason(ev),
    "aliased insurance (BCBS) should match Anthem Blue Cross — regression for the match-flow drift bug",
  );
});
