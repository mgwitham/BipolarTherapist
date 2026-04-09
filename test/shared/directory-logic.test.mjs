import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDirectoryStrategySegments,
  compareTherapistsWithFilters,
} from "../../assets/directory-logic.js";

test("buildDirectoryStrategySegments captures the active directory filter intent", function () {
  const segments = buildDirectoryStrategySegments({
    telehealth: true,
    in_person: false,
    medication_management: true,
    insurance: "Aetna",
    accepting: false,
    sortBy: "soonest_availability",
  });

  assert.deepEqual(segments, [
    "all",
    "format:telehealth",
    "intent:psychiatry",
    "medication:yes",
    "insurance:user",
    "urgency:within-2-weeks",
  ]);
});

test("compareTherapistsWithFilters favors the stronger specialty match in best-match sorting", function () {
  const filters = {
    q: "",
    state: "",
    city: "",
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
