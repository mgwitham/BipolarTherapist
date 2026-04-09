import test from "node:test";
import assert from "node:assert/strict";

import { getTherapists } from "../../assets/store.js";
import { buildUserMatchProfile, rankTherapistsForUser } from "../../assets/matching-model.js";

function buildStarterProfile() {
  return buildUserMatchProfile({
    care_state: "CA",
    care_intent: "Therapy",
    care_format: "Telehealth",
    needs_medication_management: "Open to either",
    insurance: "",
    budget_max: "",
    priority_mode: "Best overall fit",
    urgency: "ASAP",
    bipolar_focus: [],
    preferred_modalities: [],
    population_fit: [],
    language_preferences: [],
    cultural_preferences: "",
    location_query: "",
  });
}

test("starter profile produces visible match results from seed therapists", function () {
  var therapists = getTherapists();
  var results = rankTherapistsForUser(therapists, buildStarterProfile(), null);

  assert.ok(Array.isArray(results), "expected ranked results array");
  assert.ok(results.length >= 3, "expected at least 3 starter results");
  results.slice(0, 3).forEach(function (entry) {
    assert.ok(entry && entry.therapist, "expected therapist entry");
    assert.ok(entry.therapist.slug, "expected therapist slug");
    assert.equal(entry.therapist.state, "CA");
  });
});

test("homepage-style basic handoff profile returns at least one match", function () {
  var therapists = getTherapists();
  var profile = buildUserMatchProfile({
    care_state: "CA",
    care_intent: "Therapy",
    care_format: "In-Person",
    needs_medication_management: "No",
    location_query: "90019",
    priority_mode: "Best overall fit",
    urgency: "ASAP",
  });
  var results = rankTherapistsForUser(therapists, profile, null);

  assert.ok(Array.isArray(results), "expected ranked results array");
  assert.ok(results.length >= 1, "expected at least one homepage handoff match");
  assert.ok(results[0].therapist, "expected top therapist result");
});
