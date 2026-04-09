import test from "node:test";
import assert from "node:assert/strict";

import {
  annotateProviderFieldObservationForDisplay,
  buildProviderFieldObservationId,
  buildProviderFieldObservationsFromSource,
  createProviderFieldObservation,
} from "../../shared/provider-field-observation-domain.mjs";

test("createProviderFieldObservation normalizes list fields and preserves source metadata", function () {
  const observation = createProviderFieldObservation({
    providerId: "provider-ca-lmft12345",
    fieldName: "specialties",
    rawValue: [" Bipolar Disorder ", "Trauma"],
    sourceType: "therapistApplication",
    sourceDocumentType: "therapistApplication",
    sourceDocumentId: "application-123",
    sourceUrl: "https://example.com/profile",
    observedAt: "2026-04-08T10:00:00.000Z",
    verifiedAt: "2026-04-08T10:05:00.000Z",
    confidenceScore: 92,
    verificationMethod: "editorial_review",
  });

  assert.equal(observation._type, "providerFieldObservation");
  assert.equal(observation.providerId, "provider-ca-lmft12345");
  assert.equal(observation.fieldName, "specialties");
  assert.equal(observation.normalizedValue, JSON.stringify(["Bipolar Disorder", "Trauma"]));
  assert.equal(observation.sourceDocumentId, "application-123");
  assert.equal(observation.confidenceScore, 92);
  assert.equal(observation.verificationMethod, "editorial_review");
  assert.equal(observation.isCurrent, true);
});

test("buildProviderFieldObservationId is deterministic for the same provider field source tuple", function () {
  const first = buildProviderFieldObservationId({
    providerId: "provider-ca-lmft12345",
    fieldName: "insuranceAccepted",
    sourceType: "therapist",
    sourceDocumentId: "therapist-jamie-rivera-los-angeles-ca",
  });

  const second = buildProviderFieldObservationId({
    providerId: "provider-ca-lmft12345",
    fieldName: "insuranceAccepted",
    sourceType: "therapist",
    sourceDocumentId: "therapist-jamie-rivera-los-angeles-ca",
  });

  assert.equal(first, second);
  assert.match(
    first,
    /^provider-field-observation-provider-ca-lmft12345-insuranceaccepted-therapist-[a-z0-9]+$/,
  );
});

test("buildProviderFieldObservationsFromSource creates observations for configured matching fields", function () {
  const observations = buildProviderFieldObservationsFromSource(
    {
      _id: "therapist-1",
      _type: "therapist",
      providerId: "provider-ca-lmft12345",
      sourceUrl: "https://example.com/profile",
      sourceReviewedAt: "2026-04-08T10:00:00.000Z",
      specialties: ["Bipolar Disorder"],
      languages: ["English"],
      acceptsTelehealth: true,
      estimatedWaitTime: "Within 2 weeks",
    },
    {
      confidenceScore: 88,
      verificationMethod: "primary_source_lookup",
    },
  );

  assert.equal(observations.length, 4);

  const byField = Object.fromEntries(
    observations.map(function (item) {
      return [item.fieldName, item];
    }),
  );

  assert.equal(byField.specialties.sourceType, "therapist");
  assert.equal(byField.specialties.normalizedValue, JSON.stringify(["Bipolar Disorder"]));
  assert.equal(byField.languages.normalizedValue, JSON.stringify(["English"]));
  assert.equal(byField.acceptsTelehealth.normalizedValue, "true");
  assert.equal(byField.estimatedWaitTime.normalizedValue, "Within 2 weeks");
  assert.equal(byField.specialties.confidenceScore, 88);
});

test("buildProviderFieldObservationsFromSource skips blank and unknown values", function () {
  const observations = buildProviderFieldObservationsFromSource({
    _id: "therapist-2",
    _type: "therapist",
    providerId: "provider-ca-blank-check",
    sourceUrl: "https://example.com/profile",
    sourceReviewedAt: "2026-04-08T10:00:00.000Z",
    specialties: [],
    estimatedWaitTime: "",
    medicationManagement: undefined,
    acceptsTelehealth: false,
  });

  assert.equal(observations.length, 1);
  assert.equal(observations[0].fieldName, "acceptsTelehealth");
  assert.equal(observations[0].normalizedValue, "false");
});

test("annotateProviderFieldObservationForDisplay adds readable labels and parsed values", function () {
  const annotated = annotateProviderFieldObservationForDisplay({
    fieldName: "languages",
    rawValue: JSON.stringify(["English", "Spanish"]),
    normalizedValue: JSON.stringify(["English", "Spanish"]),
    sourceType: "therapistApplication",
    verificationMethod: "editorial_review",
    isCurrent: true,
  });

  assert.equal(annotated.labels.fieldName, "Languages");
  assert.equal(annotated.labels.sourceType, "Therapist application");
  assert.equal(annotated.labels.verificationMethod, "Editorial review");
  assert.equal(annotated.labels.currentState, "Current");
  assert.deepEqual(annotated.parsedRawValue, ["English", "Spanish"]);
  assert.deepEqual(annotated.parsedNormalizedValue, ["English", "Spanish"]);
});
