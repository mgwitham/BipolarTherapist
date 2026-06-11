import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateTherapistAgainstProfile,
  rankTherapistsForUser,
  getMatchTier,
} from "../../shared/matching-model.mjs";

// Coverage for the matching engine's EXCLUSION logic — the dealbreakers that
// rule a therapist out entirely (hard_failures → hard_constraint_failed →
// score -1000 → dropped by rankTherapistsForUser). This is the most
// trust-sensitive code in the product: a regression here could start
// recommending out-of-state, wrong-type, or non-prescribing therapists to
// people who explicitly excluded them. Before this file, no test asserted a
// single exclusion.

function profile(overrides) {
  return {
    care_state: "CA",
    care_format: "Telehealth",
    care_intent: "Therapy",
    needs_medication_management: "Open to either",
    insurance: "",
    budget_max: null,
    priority_mode: "Best overall fit",
    urgency: "Flexible",
    ...overrides,
  };
}

// A therapist that satisfies the default profile (CA telehealth, therapy,
// accepting patients). Override one field per test to trip a single dealbreaker.
function therapist(overrides) {
  return {
    slug: "dr-eligible",
    name: "Dr. Eligible",
    state: "CA",
    credentials: "LMFT",
    accepts_telehealth: true,
    telehealth_states: ["CA"],
    accepts_in_person: false,
    accepting_new_patients: true,
    medication_management: false,
    specialties: ["Bipolar disorder"],
    treatment_modalities: ["CBT"],
    insurance_accepted: [],
    ...overrides,
  };
}

// --- Baseline: a fully-eligible therapist is NOT excluded ---

test("an eligible therapist has no hard failures and a real score", () => {
  const ev = evaluateTherapistAgainstProfile(therapist(), profile(), null);
  assert.equal(ev.hard_constraint_failed, false);
  assert.deepEqual(ev.hard_failures, []);
  assert.ok(ev.score > 0, "eligible therapist should score above zero");
});

// --- Telehealth dealbreakers ---

test("telehealth requested but the therapist does not offer telehealth → excluded", () => {
  const ev = evaluateTherapistAgainstProfile(
    therapist({ accepts_telehealth: false, telehealth_states: [] }),
    profile({ care_format: "Telehealth" }),
    null,
  );
  assert.equal(ev.hard_constraint_failed, true);
  assert.equal(ev.score, -1000, "a hard failure pins the score to -1000");
  assert.ok(
    ev.hard_failures.some((f) => /telehealth is not available/i.test(f)),
    "expected the telehealth dealbreaker",
  );
});

test("telehealth requested but the therapist is not licensed in the requested state → excluded", () => {
  const ev = evaluateTherapistAgainstProfile(
    therapist({ accepts_telehealth: true, telehealth_states: ["NY"] }),
    profile({ care_state: "CA", care_format: "Telehealth" }),
    null,
  );
  assert.equal(ev.hard_constraint_failed, true);
  assert.ok(ev.hard_failures.some((f) => /telehealth is not available/i.test(f)));
});

test("telehealth offered but state coverage unlisted is UNKNOWN, not a dealbreaker", () => {
  // accepts_telehealth true with no telehealth_states → "unknown": the engine
  // must keep the therapist eligible (with a caution), not exclude them.
  const ev = evaluateTherapistAgainstProfile(
    therapist({ accepts_telehealth: true, telehealth_states: [] }),
    profile({ care_format: "Telehealth" }),
    null,
  );
  assert.equal(ev.hard_constraint_failed, false);
  assert.deepEqual(ev.hard_failures, []);
  assert.ok(
    ev.cautions.some((c) => /coverage is not fully listed/i.test(c)),
    "unknown telehealth coverage should surface a caution",
  );
});

// --- In-person dealbreakers ---

test("in-person requested but the therapist is in a different state → excluded", () => {
  const ev = evaluateTherapistAgainstProfile(
    therapist({ accepts_in_person: true, state: "NY" }),
    profile({ care_state: "CA", care_format: "In-Person" }),
    null,
  );
  assert.equal(ev.hard_constraint_failed, true);
  assert.ok(ev.hard_failures.some((f) => /in-person care is not available/i.test(f)));
});

test("in-person requested but the therapist does not offer in-person → excluded", () => {
  const ev = evaluateTherapistAgainstProfile(
    therapist({ accepts_in_person: false, state: "CA" }),
    profile({ care_state: "CA", care_format: "In-Person" }),
    null,
  );
  assert.equal(ev.hard_constraint_failed, true);
  assert.ok(ev.hard_failures.some((f) => /in-person care is not available/i.test(f)));
});

// --- care_format "Either" is permissive (never a format dealbreaker) ---

test('care_format "Either" never excludes on format alone', () => {
  // No telehealth, and in-person only in a different state: under "Either"
  // this is a weak match, but it must NOT be a hard failure.
  const ev = evaluateTherapistAgainstProfile(
    therapist({
      accepts_telehealth: false,
      telehealth_states: [],
      accepts_in_person: true,
      state: "NY",
    }),
    profile({ care_state: "CA", care_format: "Either" }),
    null,
  );
  assert.equal(ev.hard_constraint_failed, false);
  assert.ok(
    !ev.hard_failures.some((f) => /telehealth|in-person/i.test(f)),
    'no format dealbreaker should fire under "Either"',
  );
});

// --- Provider-type (care_intent) dealbreaker ---

test("psychiatry requested but the provider is a therapist → excluded", () => {
  const ev = evaluateTherapistAgainstProfile(
    therapist({ credentials: "LMFT", treatment_modalities: ["CBT"] }),
    profile({ care_intent: "Psychiatry" }),
    null,
  );
  assert.equal(ev.hard_constraint_failed, true);
  assert.ok(ev.hard_failures.some((f) => /provider type does not match/i.test(f)));
});

test("psychiatry requested and the provider is a psychiatrist → eligible", () => {
  const ev = evaluateTherapistAgainstProfile(
    therapist({ credentials: "MD", title: "Psychiatrist", medication_management: true }),
    profile({ care_intent: "Psychiatry" }),
    null,
  );
  assert.equal(ev.hard_constraint_failed, false);
  assert.ok(!ev.hard_failures.some((f) => /provider type/i.test(f)));
});

// --- Medication-management dealbreaker ---

test("medication management required but not provided → excluded", () => {
  const ev = evaluateTherapistAgainstProfile(
    therapist({ medication_management: false }),
    profile({ needs_medication_management: "Yes" }),
    null,
  );
  assert.equal(ev.hard_constraint_failed, true);
  assert.ok(ev.hard_failures.some((f) => /does not provide medication management/i.test(f)));
});

test("medication management required and provided → not excluded on that axis", () => {
  const ev = evaluateTherapistAgainstProfile(
    therapist({ medication_management: true }),
    profile({ needs_medication_management: "Yes" }),
    null,
  );
  assert.ok(!ev.hard_failures.some((f) => /medication management/i.test(f)));
});

// --- Paused listing dealbreaker ---

test("a paused listing (not accepting new patients) is excluded", () => {
  const ev = evaluateTherapistAgainstProfile(
    therapist({ accepting_new_patients: false }),
    profile(),
    null,
  );
  assert.equal(ev.hard_constraint_failed, true);
  assert.ok(ev.hard_failures.some((f) => /not accepting new patients/i.test(f)));
});

// --- Multiple dealbreakers accumulate ---

test("multiple violated constraints all appear in hard_failures", () => {
  const ev = evaluateTherapistAgainstProfile(
    therapist({
      accepts_telehealth: false,
      telehealth_states: [],
      accepting_new_patients: false,
      medication_management: false,
    }),
    profile({ care_format: "Telehealth", needs_medication_management: "Yes" }),
    null,
  );
  assert.equal(ev.hard_constraint_failed, true);
  assert.ok(ev.hard_failures.length >= 3, "every violated constraint should be listed");
});

// --- rankTherapistsForUser drops the excluded and orders the rest ---

test("rankTherapistsForUser excludes hard-failed therapists and keeps the eligible", () => {
  const eligible = therapist({ slug: "keep-me" });
  const excluded = therapist({ slug: "drop-me", accepts_telehealth: false, telehealth_states: [] });

  const ranked = rankTherapistsForUser(
    [excluded, eligible],
    profile({ care_format: "Telehealth" }),
    null,
  );

  assert.equal(ranked.length, 1, "the hard-failed therapist must be filtered out");
  assert.equal(ranked[0].therapist.slug, "keep-me");
});

test("rankTherapistsForUser orders eligible therapists by descending score", () => {
  // Both eligible; the insurance match gives `strong` a higher practical score
  // than `weak` (which takes an insurance-mismatch penalty).
  const strong = therapist({ slug: "strong", insurance_accepted: ["Aetna"] });
  const weak = therapist({ slug: "weak", insurance_accepted: ["Cigna"] });

  const ranked = rankTherapistsForUser(
    [weak, strong],
    profile({ care_format: "Telehealth", insurance: "Aetna" }),
    null,
  );

  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].therapist.slug, "strong", "higher score ranks first");
  assert.ok(ranked[0].evaluation.score >= ranked[1].evaluation.score);
});

test("rankTherapistsForUser returns an empty list when everyone is excluded", () => {
  const ranked = rankTherapistsForUser(
    [
      therapist({ slug: "a", accepting_new_patients: false }),
      therapist({ slug: "b", accepts_telehealth: false, telehealth_states: [] }),
    ],
    profile({ care_format: "Telehealth" }),
    null,
  );
  assert.deepEqual(ranked, []);
});

// --- getMatchTier boundaries ---

test("getMatchTier: strong fit requires both high score AND high confidence", () => {
  assert.deepEqual(getMatchTier({ score: 110, confidence_score: 80 }), {
    label: "Strong fit",
    tone: "high",
  });
});

test("getMatchTier: a high score with mid confidence is only Promising, not Strong", () => {
  // score >= 105 but confidence < 78 must fall through to the Promising band.
  assert.deepEqual(getMatchTier({ score: 110, confidence_score: 70 }), {
    label: "Promising fit",
    tone: "medium",
  });
});

test("getMatchTier: mid score and mid confidence is Promising", () => {
  assert.deepEqual(getMatchTier({ score: 90, confidence_score: 65 }), {
    label: "Promising fit",
    tone: "medium",
  });
});

test("getMatchTier: a low score is Worth reviewing even with high confidence", () => {
  assert.deepEqual(getMatchTier({ score: 50, confidence_score: 95 }), {
    label: "Worth reviewing",
    tone: "light",
  });
});

test("getMatchTier: a bare number uses the default confidence of 70 (never Strong)", () => {
  // The numeric overload defaults confidence to 70, which is below the Strong
  // threshold (78) — so a number alone can never reach Strong fit.
  assert.deepEqual(getMatchTier(120), { label: "Promising fit", tone: "medium" });
  assert.deepEqual(getMatchTier(40), { label: "Worth reviewing", tone: "light" });
});

// --- Guard: care_state is required ---

test("evaluateTherapistAgainstProfile throws without a care_state", () => {
  assert.throws(
    () => evaluateTherapistAgainstProfile(therapist(), profile({ care_state: "" }), null),
    /care_state/,
  );
});
