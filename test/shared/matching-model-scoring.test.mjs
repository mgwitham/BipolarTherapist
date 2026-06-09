import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateTherapistAgainstProfile,
  rankTherapistsForUser,
  getMatchTier,
} from "../../shared/matching-model.mjs";

// Regression net for the core ranking engine. Hard-failure paths and tier
// boundaries are pinned exactly (fully deterministic); per-dimension
// scoring is asserted via reason-presence and relative deltas so the suite
// stays meaningful without being brittle to weight tweaks elsewhere.

// A therapist that is compatible with the base profile below — telehealth
// in CA, a (non-psychiatric) therapist, accepting new patients.
function compatibleTherapist(overrides) {
  return Object.assign(
    {
      slug: "dr-compatible",
      name: "Dr. Compatible",
      credentials: "LMFT",
      title: "Licensed Marriage and Family Therapist",
      state: "CA",
      accepts_telehealth: true,
      telehealth_states: ["CA"],
      accepts_in_person: true,
      accepting_new_patients: true,
      insurance_accepted: [],
      specialties: ["Bipolar disorder"],
      treatment_modalities: ["CBT"],
    },
    overrides || {},
  );
}

function baseProfile(overrides) {
  return Object.assign(
    {
      care_state: "CA",
      care_intent: "Therapy",
      care_format: "Telehealth",
      needs_medication_management: "Open to either",
      insurance: "",
      priority_mode: "Best overall fit",
      urgency: "ASAP",
    },
    overrides || {},
  );
}

function evalFor(therapistOverrides, profileOverrides) {
  return evaluateTherapistAgainstProfile(
    compatibleTherapist(therapistOverrides),
    baseProfile(profileOverrides),
    null,
  );
}

function hasReason(ev, re) {
  return (ev.reasons || []).some((r) => re.test(typeof r === "string" ? r : r.text || ""));
}

// ── Hard failures (exact) ──────────────────────────────────────────────

test("hard fail: telehealth requested but therapist offers none", () => {
  const ev = evalFor(
    { accepts_telehealth: false, telehealth_states: [] },
    { care_format: "Telehealth" },
  );
  assert.equal(ev.hard_constraint_failed, true);
  assert.equal(ev.score, -1000);
});

test("hard fail: in-person requested but therapist is telehealth-only", () => {
  const ev = evalFor({ accepts_in_person: false }, { care_format: "In-Person" });
  assert.equal(ev.hard_constraint_failed, true);
  assert.equal(ev.score, -1000);
});

test("hard fail: psychiatry requested but provider is a (non-prescribing) therapist", () => {
  const ev = evalFor({}, { care_intent: "Psychiatry" });
  assert.equal(ev.hard_constraint_failed, true);
});

test("hard fail: medication management required but not provided", () => {
  const ev = evalFor(
    { medication_management: false },
    { needs_medication_management: "Yes", care_intent: "Either" },
  );
  assert.equal(ev.hard_constraint_failed, true);
});

test("hard fail: listing is paused (not accepting new patients)", () => {
  const ev = evalFor({ accepting_new_patients: false });
  assert.equal(ev.hard_constraint_failed, true);
});

test("compatible therapist does NOT hard fail", () => {
  const ev = evalFor({});
  assert.equal(ev.hard_constraint_failed, false);
  assert.ok(ev.score > 0);
});

// ── Scoring contributions ──────────────────────────────────────────────

test("telehealth availability credits the access dimension and a reason", () => {
  const ev = evalFor({});
  assert.ok(hasReason(ev, /telehealth/i), "expected a telehealth reason");
  assert.ok(ev.score_breakdown.access >= 30, "telehealth should add >= 30 access");
});

test("requested care-type match credits the clinical dimension", () => {
  const ev = evalFor({});
  assert.ok(hasReason(ev, /requested care type/i));
  assert.ok(ev.score_breakdown.clinical >= 18);
});

test("insurance match adds practical credit vs. an otherwise identical mismatch", () => {
  const withMatch = evalFor(
    { insurance_accepted: ["Anthem Blue Cross"] },
    { insurance: "Anthem Blue Cross" },
  );
  const noMatch = evalFor({ insurance_accepted: ["Aetna"] }, { insurance: "Anthem Blue Cross" });
  assert.ok(hasReason(withMatch, /requested insurance/i));
  assert.ok(
    withMatch.score_breakdown.practical > noMatch.score_breakdown.practical,
    "matching insurance should score higher on practical than a mismatch",
  );
});

test("medication management provided credits practical when requested", () => {
  const ev = evalFor(
    { medication_management: true, title: "Psychiatrist", credentials: "MD" },
    { needs_medication_management: "Yes", care_intent: "Psychiatry" },
  );
  assert.equal(ev.hard_constraint_failed, false);
  assert.ok(hasReason(ev, /medication management/i));
});

// ── rankTherapistsForUser drops hard-failed therapists ─────────────────

test("ranking excludes hard-failed therapists and keeps compatible ones", () => {
  const therapists = [
    compatibleTherapist({ slug: "ok-1" }),
    compatibleTherapist({ slug: "paused", accepting_new_patients: false }),
    compatibleTherapist({ slug: "no-tele", accepts_telehealth: false, telehealth_states: [] }),
  ];
  const results = rankTherapistsForUser(therapists, baseProfile(), null);
  const slugs = results.map((r) => r.therapist.slug);
  assert.ok(slugs.includes("ok-1"));
  assert.ok(!slugs.includes("paused"), "paused listing should be excluded");
  assert.ok(
    !slugs.includes("no-tele"),
    "no-telehealth should be excluded for a telehealth request",
  );
});

// ── getMatchTier boundaries (exact) ────────────────────────────────────

test("getMatchTier: Strong fit needs score >= 105 AND confidence >= 78", () => {
  assert.equal(getMatchTier({ score: 105, confidence_score: 78 }).tone, "high");
  assert.equal(getMatchTier({ score: 105, confidence_score: 77 }).tone, "medium"); // confidence too low
  assert.equal(getMatchTier({ score: 104, confidence_score: 99 }).tone, "medium"); // score too low
});

test("getMatchTier: Promising fit at score >= 80 AND confidence >= 60", () => {
  assert.equal(getMatchTier({ score: 80, confidence_score: 60 }).tone, "medium");
  assert.equal(getMatchTier({ score: 79, confidence_score: 99 }).tone, "light");
  assert.equal(getMatchTier({ score: 80, confidence_score: 59 }).tone, "light");
});

test("getMatchTier: a bare number assumes confidence 70 (so never 'Strong')", () => {
  assert.equal(getMatchTier(200).tone, "medium"); // 200>=105 but assumed confidence 70 < 78
  assert.equal(getMatchTier(50).tone, "light");
});
