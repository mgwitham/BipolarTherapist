import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDuplicateIdentity,
  buildProviderId,
  classifyDuplicateCertainty,
  compareDuplicateIdentity,
  mapFieldReviewStatesToCamelCase,
  mapFieldReviewStatesToSnakeCase,
  normalizeFieldReviewStates,
  pickStrongestDuplicateMatch,
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

test("classifyDuplicateCertainty returns definite only when license and name both match", function () {
  assert.equal(classifyDuplicateCertainty(["license", "name_location"]), "definite");
  assert.equal(classifyDuplicateCertainty(["name_location", "license"]), "definite");
  assert.equal(classifyDuplicateCertainty(["license", "name_location", "email"]), "definite");
  // The import script emits "name_location_phone" as its confirmed-name signal.
  assert.equal(classifyDuplicateCertainty(["license", "name_location_phone"]), "definite");
});

test("classifyDuplicateCertainty returns possible for single strong or weak signals", function () {
  assert.equal(classifyDuplicateCertainty(["license"]), "possible");
  assert.equal(classifyDuplicateCertainty(["email"]), "possible");
  assert.equal(classifyDuplicateCertainty(["slug"]), "possible");
  assert.equal(classifyDuplicateCertainty(["name_location"]), "possible");
  assert.equal(classifyDuplicateCertainty(["license", "email"]), "possible");
  assert.equal(classifyDuplicateCertainty(["license", "slug"]), "possible");
});

test("classifyDuplicateCertainty returns unique for empty or invalid input", function () {
  assert.equal(classifyDuplicateCertainty([]), "unique");
  assert.equal(classifyDuplicateCertainty(null), "unique");
  assert.equal(classifyDuplicateCertainty(undefined), "unique");
  assert.equal(classifyDuplicateCertainty("license"), "unique");
});

test("pickStrongestDuplicateMatch prefers entries with stronger reasons", function () {
  const therapistA = { id: "A" };
  const therapistB = { id: "B" };
  const therapistC = { id: "C" };

  const best = pickStrongestDuplicateMatch([
    { record: therapistA, reasons: ["name_location"] },
    { record: therapistB, reasons: ["license", "name_location"] },
    { record: therapistC, reasons: ["slug"] },
  ]);

  assert.equal(best.record, therapistB);
  assert.deepEqual(best.reasons, ["license", "name_location"]);
});

test("pickStrongestDuplicateMatch returns null when no reasons match", function () {
  assert.equal(pickStrongestDuplicateMatch([]), null);
  assert.equal(pickStrongestDuplicateMatch([{ record: { id: "A" }, reasons: [] }]), null);
  assert.equal(pickStrongestDuplicateMatch(null), null);
});

test("pickStrongestDuplicateMatch tiebreaks on reason count when top reason ties", function () {
  const therapistA = { id: "A" };
  const therapistB = { id: "B" };

  const best = pickStrongestDuplicateMatch([
    { record: therapistA, reasons: ["license"] },
    { record: therapistB, reasons: ["license", "email"] },
  ]);

  assert.equal(best.record, therapistB);
});
