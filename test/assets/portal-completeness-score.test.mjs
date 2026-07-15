import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PORTAL_COMPLETENESS_MAX_SCORE,
  PORTAL_COMPLETENESS_PREDICATES,
  computePortalProfileScore,
} from "../../assets/portal-completeness-score.js";
import { PORTAL_COMPLETENESS_FIELDS } from "../../shared/portal-completeness-registry.mjs";
import { computePortalCompletenessSnapshot } from "../../server/portal-completeness-snapshot.mjs";

// A therapist with every registry field complete — snake_case (browser
// shape) and camelCase (server Sanity shape) views of the same person.
const FULL_SNAKE = {
  care_approach: "I specialize in bipolar II and rapid cycling, using IPSRT and CBT daily.",
  preferred_contact_method: "email",
  email: "jane@janedoetherapy.com",
  photo_url: "https://cdn/x.jpg",
  name: "Jane Doe",
  city: "San Diego",
  state: "CA",
  bipolar_years_experience: 9,
  bio: "Long form bio.",
  practice_name: "Jane Doe Therapy",
  website: "https://janedoetherapy.com",
  languages: ["English", "Spanish"],
  session_fee_min: 150,
  treatment_modalities: ["IPSRT", "CBT"],
  accepts_telehealth: true,
  insurance_accepted: ["Aetna"],
  estimated_wait_time: "1-2 weeks",
  first_step_expectation: "A 15-minute intro call.",
  specialties: ["Bipolar II"],
  client_populations: ["Adults"],
  years_experience: 12,
  gender: "female",
};

const FULL_CAMEL = {
  careApproach: FULL_SNAKE.care_approach,
  preferredContactMethod: "email",
  email: FULL_SNAKE.email,
  hasPhoto: true,
  name: FULL_SNAKE.name,
  city: FULL_SNAKE.city,
  state: FULL_SNAKE.state,
  bipolarYearsExperience: 9,
  bio: FULL_SNAKE.bio,
  practiceName: FULL_SNAKE.practice_name,
  website: FULL_SNAKE.website,
  languages: FULL_SNAKE.languages,
  sessionFeeMin: 150,
  treatmentModalities: FULL_SNAKE.treatment_modalities,
  acceptsTelehealth: true,
  insuranceAccepted: FULL_SNAKE.insurance_accepted,
  estimatedWaitTime: FULL_SNAKE.estimated_wait_time,
  firstStepExpectation: FULL_SNAKE.first_step_expectation,
  specialties: FULL_SNAKE.specialties,
  clientPopulations: FULL_SNAKE.client_populations,
  yearsExperience: 12,
  gender: "female",
};

test("every registry field has a browser predicate", () => {
  for (const field of PORTAL_COMPLETENESS_FIELDS) {
    assert.equal(
      typeof PORTAL_COMPLETENESS_PREDICATES[field.key],
      "function",
      `missing predicate for "${field.key}"`,
    );
  }
});

test("empty therapist scores 0; complete therapist scores exactly the registry max (100)", () => {
  assert.equal(computePortalProfileScore(null), 0);
  assert.equal(computePortalProfileScore({}), 0);
  assert.equal(PORTAL_COMPLETENESS_MAX_SCORE, 100);
  assert.equal(computePortalProfileScore(FULL_SNAKE), 100);
});

test("PARITY: browser scorer and server snapshot agree on the same therapist", () => {
  // Complete profile
  assert.equal(
    computePortalProfileScore(FULL_SNAKE),
    computePortalCompletenessSnapshot(FULL_CAMEL).score,
  );

  // Partial profile: drop the same fields from both shapes
  const partialSnake = { ...FULL_SNAKE, photo_url: "", insurance_accepted: [], gender: "" };
  const partialCamel = { ...FULL_CAMEL, hasPhoto: false, insuranceAccepted: [], gender: "" };
  const browserScore = computePortalProfileScore(partialSnake);
  const serverScore = computePortalCompletenessSnapshot(partialCamel).score;
  assert.equal(browserScore, serverScore);
  assert.ok(browserScore < 100);

  // Freshly claimed listing: only signup fields present
  const signupSnake = {
    name: "Jane Doe",
    city: "San Diego",
    state: "CA",
    email: "jane@janedoetherapy.com",
    preferred_contact_method: "email",
    specialties: ["Bipolar II"],
  };
  const signupCamel = {
    name: "Jane Doe",
    city: "San Diego",
    state: "CA",
    email: "jane@janedoetherapy.com",
    preferredContactMethod: "email",
    specialties: ["Bipolar II"],
  };
  assert.equal(
    computePortalProfileScore(signupSnake),
    computePortalCompletenessSnapshot(signupCamel).score,
  );
});

test("contact route only counts when the chosen method has a value", () => {
  const base = { preferred_contact_method: "phone", email: "x@y.com" };
  const withoutPhone = computePortalProfileScore(base);
  const withPhone = computePortalProfileScore({ ...base, phone: "555-0100" });
  assert.ok(withPhone > withoutPhone);
});

test("card bio requires 50+ chars", () => {
  const short = computePortalProfileScore({ care_approach: "Too short." });
  const long = computePortalProfileScore({ care_approach: "x".repeat(50) });
  assert.ok(long > short);
});
