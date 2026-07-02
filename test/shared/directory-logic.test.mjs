import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  compareTherapistsWithFilters,
  getMatchScore,
  getWaitPriority,
  matchesDirectoryFilters,
} from "../../assets/directory-logic.js";
import { insuranceMatches, resolveInsuranceName } from "../../shared/therapist-picker-options.mjs";
import { preloadZipcodes } from "../../assets/zip-lookup.js";

const zipUrl = new URL("../../assets/ca-zipcodes.json", import.meta.url);
const zipData = JSON.parse(readFileSync(fileURLToPath(zipUrl), "utf8"));
globalThis.fetch = async () => ({ ok: true, json: async () => zipData });
await preloadZipcodes();

test("compareTherapistsWithFilters favors the stronger specialty match in best-match sorting", function () {
  const filters = {
    state: "",
    specialty: "Bipolar II",
    modality: "",
    population: "",
    verification: "",
    bipolar_experience: "",
    insurance: "",
    telehealth: false,
    in_person: false,
    accepting: false,
    medication_management: false,
    responsive_contact: false,
    recently_confirmed: false,
    sortBy: "best_match",
  };

  const strongerMatch = {
    name: "Alex Morgan",
    slug: "alex-morgan",
    specialties: ["Bipolar II"],
    treatment_modalities: [],
    client_populations: [],
    insurance_accepted: [],
    state: "CA",
    city: "Los Angeles",
    verification_status: "editorially_verified",
    field_review_states: {
      estimated_wait_time: "editorially_verified",
      insurance_accepted: "editorially_verified",
      telehealth_states: "unknown",
      bipolar_years_experience: "editorially_verified",
    },
    bipolar_years_experience: 9,
    bio_preview: "Specializes in bipolar II treatment planning.",
  };

  const weakerMatch = {
    name: "Bailey Stone",
    slug: "bailey-stone",
    specialties: ["Anxiety"],
    treatment_modalities: [],
    client_populations: [],
    insurance_accepted: [],
    state: "CA",
    city: "Los Angeles",
    verification_status: "",
    field_review_states: {},
    bipolar_years_experience: 2,
    bio_preview: "General therapy support.",
  };

  assert.ok(compareTherapistsWithFilters(filters, strongerMatch, weakerMatch) < 0);
  assert.ok(compareTherapistsWithFilters(filters, weakerMatch, strongerMatch) > 0);
});

test("compareTherapistsWithFilters default sort ranks completeness tiers (photo + bipolar years)", function () {
  const filters = {
    state: "",
    specialty: "",
    modality: "",
    population: "",
    verification: "",
    bipolar_experience: "",
    insurance: "",
    telehealth: false,
    in_person: false,
    accepting: false,
    medication_management: false,
    responsive_contact: false,
    recently_confirmed: false,
    sortBy: "stable_random",
    stableOrderMap: new Map(),
  };

  const both = {
    name: "Both Fields",
    slug: "both",
    accepting_new_patients: true,
    photo_url: "https://cdn.example.com/p.jpg",
    bipolar_years_experience: 5,
  };
  const photoOnly = {
    name: "Photo Only",
    slug: "photo-only",
    accepting_new_patients: true,
    photo_url: "https://cdn.example.com/p.jpg",
    bipolar_years_experience: 0,
  };
  const yearsOnly = {
    name: "Years Only",
    slug: "years-only",
    accepting_new_patients: true,
    photo_url: null,
    bipolar_years_experience: 7,
  };
  const neither = {
    name: "Neither",
    slug: "neither",
    accepting_new_patients: true,
    photo_url: null,
    bipolar_years_experience: 0,
  };

  // both > photoOnly > neither
  assert.ok(compareTherapistsWithFilters(filters, both, photoOnly) < 0);
  assert.ok(compareTherapistsWithFilters(filters, photoOnly, neither) < 0);
  assert.ok(compareTherapistsWithFilters(filters, both, neither) < 0);
  // photoOnly and yearsOnly are tied on tier — fall through to stable order
  assert.equal(compareTherapistsWithFilters(filters, photoOnly, yearsOnly), 0);
  // Not-accepting always sinks below any accepting tier
  const fullProfileNotAccepting = {
    name: "Closed",
    slug: "closed",
    accepting_new_patients: false,
    photo_url: "https://cdn.example.com/p.jpg",
    bipolar_years_experience: 10,
  };
  assert.ok(compareTherapistsWithFilters(filters, neither, fullProfileNotAccepting) < 0);
});

test("matchesDirectoryFilters applies the shared directory predicate consistently", function () {
  const filters = {
    state: "CA",
    specialty: "Bipolar II",
    modality: "CBT",
    population: "Adults",
    verification: "editorially_verified",
    bipolar_experience: "5",
    insurance: "Aetna",
    telehealth: true,
    in_person: false,
    accepting: true,
    medication_management: false,
    responsive_contact: false,
    recently_confirmed: false,
  };

  const matchingTherapist = {
    name: "Jamie Rivera",
    slug: "jamie-rivera",
    title: "Therapist",
    city: "Los Angeles",
    state: "CA",
    practice_name: "Rivera Therapy",
    bio_preview: "Bipolar-focused CBT for adults.",
    care_approach: "Collaborative and practical.",
    specialties: ["Bipolar II"],
    treatment_modalities: ["CBT"],
    client_populations: ["Adults"],
    insurance_accepted: ["Aetna"],
    verification_status: "editorially_verified",
    bipolar_years_experience: 8,
    accepts_telehealth: true,
    accepts_in_person: false,
    accepting_new_patients: true,
    medication_management: false,
  };

  const nonMatchingTherapist = {
    ...matchingTherapist,
    slug: "sam-lee",
    insurance_accepted: ["United"],
  };

  assert.equal(matchesDirectoryFilters(filters, matchingTherapist), true);
  assert.equal(matchesDirectoryFilters(filters, nonMatchingTherapist), false);
});

test("compareTherapistsWithFilters uses ranking zip as a soft proximity boost", function () {
  const filters = {
    state: "CA",
    zip: "",
    ranking_zip: "92101",
    specialty: "",
    modality: "",
    population: "",
    verification: "",
    bipolar_experience: "",
    insurance: "",
    therapist: true,
    psychiatrist: false,
    telehealth: false,
    in_person: false,
    accepting: false,
    medication_management: false,
    responsive_contact: false,
    recently_confirmed: false,
    sortBy: "best_match",
  };

  const nearTherapist = {
    name: "Near Therapist",
    slug: "near-therapist",
    zip: "92103",
    title: "Therapist",
    state: "CA",
    city: "San Diego",
    accepts_in_person: true,
    accepts_telehealth: true,
    specialties: [],
    treatment_modalities: [],
    client_populations: [],
    insurance_accepted: [],
    field_review_states: {},
    verification_status: "",
    bipolar_years_experience: 2,
  };

  const farTherapist = {
    ...nearTherapist,
    name: "Far Therapist",
    slug: "far-therapist",
    zip: "94103",
    city: "San Francisco",
  };

  assert.ok(compareTherapistsWithFilters(filters, nearTherapist, farTherapist) < 0);
});

// Insurance normalization — resolveInsuranceName

test("resolveInsuranceName returns canonical name for exact match", function () {
  assert.equal(resolveInsuranceName("Aetna"), "Aetna");
  assert.equal(resolveInsuranceName("UnitedHealthcare"), "UnitedHealthcare");
});

test("resolveInsuranceName is case-insensitive for exact canonical names", function () {
  assert.equal(resolveInsuranceName("aetna"), "Aetna");
  assert.equal(resolveInsuranceName("CIGNA"), "Cigna");
});

test("resolveInsuranceName maps common aliases to canonical values", function () {
  assert.equal(resolveInsuranceName("Blue Cross"), "Anthem Blue Cross");
  assert.equal(resolveInsuranceName("blue cross"), "Anthem Blue Cross");
  assert.equal(resolveInsuranceName("BCBS"), "Anthem Blue Cross");
  assert.equal(resolveInsuranceName("Anthem"), "Anthem Blue Cross");
  assert.equal(resolveInsuranceName("Blue Shield"), "Blue Shield of California");
  assert.equal(resolveInsuranceName("United"), "UnitedHealthcare");
  assert.equal(resolveInsuranceName("UHC"), "UnitedHealthcare");
  assert.equal(resolveInsuranceName("Kaiser"), "Kaiser Permanente");
  assert.equal(resolveInsuranceName("Medicaid"), "Medi-Cal");
  assert.equal(resolveInsuranceName("Oscar"), "Oscar Health");
});

test("resolveInsuranceName returns trimmed original for unrecognized input", function () {
  assert.equal(resolveInsuranceName("  Premera  "), "Premera");
  assert.equal(resolveInsuranceName(""), "");
});

// Insurance normalization — insuranceMatches

test("insuranceMatches returns true for exact canonical match", function () {
  assert.equal(insuranceMatches("Aetna", ["Aetna", "Cigna"]), true);
  assert.equal(insuranceMatches("Cigna", ["Aetna", "Cigna"]), true);
});

test("insuranceMatches returns false when no match", function () {
  assert.equal(insuranceMatches("Aetna", ["Cigna", "Kaiser Permanente"]), false);
  assert.equal(insuranceMatches("Aetna", []), false);
  assert.equal(insuranceMatches("", ["Aetna"]), false);
});

test("insuranceMatches resolves aliases — Blue Cross matches Anthem Blue Cross", function () {
  assert.equal(insuranceMatches("Blue Cross", ["Anthem Blue Cross"]), true);
  assert.equal(insuranceMatches("blue cross", ["Anthem Blue Cross"]), true);
  assert.equal(insuranceMatches("BCBS", ["Anthem Blue Cross"]), true);
  assert.equal(insuranceMatches("Anthem", ["Anthem Blue Cross"]), true);
});

test("insuranceMatches resolves aliases — Blue Shield matches Blue Shield of California", function () {
  assert.equal(insuranceMatches("Blue Shield", ["Blue Shield of California"]), true);
});

test("insuranceMatches resolves aliases — United matches UnitedHealthcare", function () {
  assert.equal(insuranceMatches("United", ["UnitedHealthcare"]), true);
  assert.equal(insuranceMatches("UHC", ["UnitedHealthcare"]), true);
});

test("insuranceMatches resolves aliases — Kaiser matches Kaiser Permanente", function () {
  assert.equal(insuranceMatches("Kaiser", ["Kaiser Permanente"]), true);
});

test("insuranceMatches resolves aliases — Medicaid matches Medi-Cal", function () {
  assert.equal(insuranceMatches("Medicaid", ["Medi-Cal"]), true);
});

test("insuranceMatches directory filter: Blue Cross patient sees Anthem Blue Cross therapist", function () {
  const filters = { insurance: "Blue Cross" };
  const therapist = { insurance_accepted: ["Anthem Blue Cross", "Cigna"] };
  assert.equal(matchesDirectoryFilters(filters, therapist), true);
});

test("insuranceMatches directory filter: exact plan still works", function () {
  const filters = { insurance: "Aetna" };
  assert.equal(matchesDirectoryFilters(filters, { insurance_accepted: ["Aetna"] }), true);
  assert.equal(matchesDirectoryFilters(filters, { insurance_accepted: ["Cigna"] }), false);
});

// getMatchScore is memoized per sort pass (keyed by therapist, invalidated when
// the filterState object identity changes). These tests pin that the memo
// returns stable scores within a filter set and never leaks a score across
// different filter sets — the correctness contract the optimization relies on.
test("getMatchScore returns a stable score on repeated calls with the same filter set", function () {
  const filters = { specialty: "Bipolar II", sortBy: "best_match" };
  const therapist = {
    name: "Casey Lin",
    slug: "casey-lin",
    specialties: ["Bipolar II"],
    treatment_modalities: [],
    client_populations: [],
    insurance_accepted: [],
    state: "CA",
    field_review_states: {},
  };

  const first = getMatchScore(filters, therapist);
  const second = getMatchScore(filters, therapist);
  const third = getMatchScore(filters, therapist);
  assert.equal(first, second);
  assert.equal(second, third);
});

test("getMatchScore does not leak a cached score across different filter sets", function () {
  const therapist = {
    name: "Casey Lin",
    slug: "casey-lin",
    specialties: ["Bipolar II"],
    treatment_modalities: [],
    client_populations: [],
    insurance_accepted: [],
    state: "CA",
    field_review_states: {},
  };

  // Distinct filter objects: one selects the matching specialty, one does not.
  const withSpecialty = { specialty: "Bipolar II", sortBy: "best_match" };
  const withoutSpecialty = { specialty: "", sortBy: "best_match" };

  const scoredWithSpecialty = getMatchScore(withSpecialty, therapist);
  // A different filterState object must invalidate the memo and recompute.
  const scoredWithoutSpecialty = getMatchScore(withoutSpecialty, therapist);
  // The specialty match is worth +26, so dropping it must lower the score —
  // proving the second call recomputed against the new filters rather than
  // returning the cached value from the first call.
  assert.ok(
    scoredWithoutSpecialty < scoredWithSpecialty,
    "expected the specialty match to raise the score; memo leaked across filter sets",
  );

  // Re-scoring with the original filter object recomputes to the same value.
  assert.equal(getMatchScore(withSpecialty, therapist), scoredWithSpecialty);
});

// ── Sort-mode coverage + the lowest_fee NaN guard ────────────────
function baseTherapist(overrides) {
  return Object.assign(
    {
      name: "Test Provider",
      slug: "test-provider",
      specialties: [],
      treatment_modalities: [],
      client_populations: [],
      insurance_accepted: [],
      state: "CA",
      city: "Los Angeles",
      verification_status: "",
      field_review_states: {},
      bipolar_years_experience: 0,
      bio_preview: "",
    },
    overrides,
  );
}

test("compareTherapistsWithFilters lowest_fee sorts ascending; unknown/non-numeric fees sort last", () => {
  const filters = { sortBy: "lowest_fee" };
  const cheap = baseTherapist({ name: "Zara Cheap", slug: "cheap", session_fee_min: 90 });
  const pricey = baseTherapist({ name: "Aaron Pricey", slug: "pricey", session_fee_min: 200 });
  // Non-numeric fee: Number("sliding scale") is NaN. Before the guard this
  // poisoned the comparison and scattered the provider unpredictably.
  const sliding = baseTherapist({
    name: "Mara Sliding",
    slug: "sliding",
    session_fee_min: "sliding scale",
  });
  const missing = baseTherapist({ name: "Noah Missing", slug: "missing" });

  const order = [pricey, sliding, missing, cheap]
    .sort((a, b) => compareTherapistsWithFilters(filters, a, b))
    .map((t) => t.slug);

  assert.equal(order[0], "cheap", "lowest valid fee first");
  assert.equal(order[1], "pricey", "next valid fee second");
  // Both unknown-fee providers land in the last two slots, not ahead of a real fee.
  assert.deepEqual(order.slice(2).sort(), ["missing", "sliding"]);
});

test("compareTherapistsWithFilters most_experienced ranks higher bipolar experience first", () => {
  const filters = { sortBy: "most_experienced" };
  const veteran = baseTherapist({ slug: "veteran", bipolar_years_experience: 12 });
  const newer = baseTherapist({ slug: "newer", bipolar_years_experience: 3 });
  assert.ok(compareTherapistsWithFilters(filters, veteran, newer) < 0);
  assert.ok(compareTherapistsWithFilters(filters, newer, veteran) > 0);
});

test("compareTherapistsWithFilters soonest_availability ranks shorter waits first", () => {
  const filters = { sortBy: "soonest_availability" };
  const soon = baseTherapist({ slug: "soon", estimated_wait_time: "Immediate availability" });
  const later = baseTherapist({ slug: "later", estimated_wait_time: "1-2 months" });
  assert.ok(compareTherapistsWithFilters(filters, soon, later) < 0);
  assert.ok(compareTherapistsWithFilters(filters, later, soon) > 0);
});

test("matchesDirectoryFilters tolerates a null specialties field without throwing", () => {
  const provider = baseTherapist({ slug: "x", specialties: null });
  // Specialty filter + provider missing the field => excluded, no throw.
  assert.equal(matchesDirectoryFilters({ specialty: "Bipolar II" }, provider), false);
  // No meaningful filter => included.
  assert.equal(matchesDirectoryFilters({}, provider), true);
});

test("getWaitPriority knows every canonical wait-time label (none fall to the 99 bucket)", function () {
  const canonical = [
    "Immediate availability",
    "Within 1 week",
    "Within 2 weeks",
    "2-4 weeks",
    "Within a month",
    "1-2 months",
    "Waitlist only",
  ];
  for (const label of canonical) {
    assert.ok(
      getWaitPriority(label) < 99,
      `"${label}" should map to a real priority, not the unknown bucket`,
    );
  }
  assert.equal(getWaitPriority("Same week"), 99, "unknown labels fall to the 99 bucket");
});
