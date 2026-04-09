import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDuplicateIdentity,
  buildProviderId,
  compareDuplicateIdentity,
  mapFieldReviewStatesToCamelCase,
  mapFieldReviewStatesToSnakeCase,
  normalizeFieldReviewStates,
  resolveApplicationIntakeType,
} from "../../shared/therapist-domain.mjs";

test("duplicate identity matches by license and canonical website data", function () {
  const identity = buildDuplicateIdentity({
    name: "Dr. Jamie Rivera",
    city: "Los Angeles",
    state: "CA",
    credentials: "LMFT",
    email: "hello@example.com",
    website: "https://example.com/practice/",
    license_state: "CA",
    license_number: "LMFT-12345",
  });

  const reasons = compareDuplicateIdentity(identity, {
    slug: "dr-jamie-rivera-los-angeles-ca",
    name: "Dr. Jamie Rivera",
    city: "Los Angeles",
    state: "CA",
    credentials: "LMFT",
    email: "hello@example.com",
    website: "http://example.com/practice",
    licenseState: "CA",
    licenseNumber: "LMFT12345",
  });

  assert.deepEqual(reasons, ["license", "slug", "email", "name_location"]);
});

test("application intake type falls back to confirmation update when a published therapist target exists", function () {
  assert.equal(
    resolveApplicationIntakeType({
      published_therapist_id: "therapist-123",
    }),
    "confirmation_update",
  );
});

test("provider id prefers license-based identity and otherwise falls back to normalized name/location", function () {
  assert.equal(
    buildProviderId({
      license_state: "CA",
      license_number: "LMFT-12345",
    }),
    "provider-ca-lmft12345",
  );

  assert.equal(
    buildProviderId({
      name: "Dr. Jamie Rivera",
      city: "Los Angeles",
      state: "CA",
    }),
    "provider-dr-jamie-rivera-los-angeles-ca",
  );
});

test("field review state normalization defaults to unknown and maps between key styles", function () {
  assert.deepEqual(
    normalizeFieldReviewStates(
      {
        estimated_wait_time: "editorially_verified",
      },
      { keyStyle: "snake_case" },
    ),
    {
      estimated_wait_time: "editorially_verified",
      insurance_accepted: "unknown",
      telehealth_states: "unknown",
      bipolar_years_experience: "unknown",
    },
  );

  assert.deepEqual(
    mapFieldReviewStatesToCamelCase({
      estimated_wait_time: "needs_reconfirmation",
      insurance_accepted: "therapist_confirmed",
    }),
    {
      estimatedWaitTime: "needs_reconfirmation",
      insuranceAccepted: "therapist_confirmed",
      telehealthStates: "unknown",
      bipolarYearsExperience: "unknown",
    },
  );

  assert.deepEqual(
    mapFieldReviewStatesToSnakeCase({
      estimatedWaitTime: "editorially_verified",
      telehealthStates: "needs_reconfirmation",
    }),
    {
      estimated_wait_time: "editorially_verified",
      insurance_accepted: "unknown",
      telehealth_states: "needs_reconfirmation",
      bipolar_years_experience: "unknown",
    },
  );
});
