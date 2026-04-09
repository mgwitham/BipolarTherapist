import assert from "node:assert/strict";
import test from "node:test";

import { createReviewApiHandler } from "../../server/review-handler.mjs";
import {
  createMemoryClient,
  createTestApiConfig,
  runHandlerRequest,
} from "./test-helpers.mjs";

async function loginAsAdmin(handler) {
  const response = await runHandlerRequest(handler, {
    body: {
      username: "architect",
      password: "secret-pass",
    },
    headers: {
      host: "localhost:8787",
    },
    method: "POST",
    url: "/auth/login",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(typeof response.payload.sessionToken, "string");
  return response.payload.sessionToken;
}

test("workflow: public application submission can be approved into a live therapist profile", async function () {
  const { client, state } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const submitResponse = await runHandlerRequest(handler, {
    body: {
      name: "Dr. Jamie Rivera",
      credentials: "LMFT",
      email: "jamie@example.com",
      city: "Los Angeles",
      state: "CA",
      bio: "I help adults with bipolar disorder build stable, sustainable routines.",
      license_state: "CA",
      license_number: "LMFT12345",
      care_approach: "Collaborative, practical, and relapse-prevention oriented.",
      specialties: ["Bipolar disorder", "Mood disorders"],
      treatment_modalities: ["CBT", "Psychoeducation"],
      client_populations: ["Adults"],
      insurance_accepted: ["Aetna"],
      languages: ["English"],
      website: "https://example.com/jamie-rivera",
      source_url: "https://example.com/jamie-rivera",
    },
    headers: {
      host: "localhost:8787",
    },
    method: "POST",
    url: "/applications",
  });

  assert.equal(submitResponse.statusCode, 201);
  assert.equal(submitResponse.payload.status, "pending");
  const applicationId = submitResponse.payload.id;
  assert.equal(typeof applicationId, "string");

  const sessionToken = await loginAsAdmin(handler);
  const approveResponse = await runHandlerRequest(handler, {
    body: {},
    headers: {
      authorization: `Bearer ${sessionToken}`,
      host: "localhost:8787",
    },
    method: "POST",
    url: `/applications/${applicationId}/approve`,
  });

  assert.equal(approveResponse.statusCode, 200);
  assert.equal(approveResponse.payload.ok, true);

  const therapistId = approveResponse.payload.therapistId;
  const application = state.documents.get(applicationId);
  const therapist = state.documents.get(therapistId);

  assert.equal(application.status, "approved");
  assert.equal(application.publishedTherapistId, therapistId);
  assert.equal(therapist._type, "therapist");
  assert.equal(therapist.name, "Dr. Jamie Rivera");
  assert.equal(therapist.licenseNumber, "LMFT12345");
  assert.equal(therapist.verificationStatus, "editorially_verified");
  assert.equal(therapist.providerId, application.providerId);
});

test("workflow: apply-live-fields updates only selected live therapist fields and review states", async function () {
  const { client, state } = createMemoryClient({
    "therapist-existing": {
      _id: "therapist-existing",
      _type: "therapist",
      name: "Dr. Avery Stone",
      website: "https://old.example.com",
      insuranceAccepted: ["Old Insurance"],
      telehealthStates: ["CA"],
      fieldReviewStates: {
        insuranceAccepted: "unknown",
        telehealthStates: "unknown",
      },
      supportingSourceUrls: ["https://old.example.com"],
      verificationLane: "needs_verification",
      verificationPriority: 90,
      dataCompletenessScore: 50,
      sourceReviewedAt: "",
      therapistReportedFields: [],
      therapistReportedConfirmedAt: "",
    },
    "application-live-fields": {
      _id: "application-live-fields",
      _type: "therapistApplication",
      name: "Dr. Avery Stone",
      credentials: "PsyD",
      city: "San Diego",
      state: "CA",
      website: "https://new.example.com",
      insuranceAccepted: ["Aetna", "Blue Shield"],
      telehealthStates: ["CA", "WA"],
      sourceUrl: "https://new.example.com",
      supportingSourceUrls: ["https://new.example.com/profile"],
      sourceReviewedAt: "2026-04-08T00:00:00.000Z",
      licensureVerification: { verifiedAt: "2026-04-08T00:00:00.000Z", statusStanding: "clear" },
      therapistReportedFields: ["insurance_accepted", "telehealth_states"],
      therapistReportedConfirmedAt: "2026-04-08T00:00:00.000Z",
      fieldReviewStates: {
        insuranceAccepted: "therapist_confirmed",
        telehealthStates: "therapist_confirmed",
      },
      publishedTherapistId: "therapist-existing",
      status: "pending",
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const sessionToken = await loginAsAdmin(handler);

  const response = await runHandlerRequest(handler, {
    body: {
      fields: ["insurance_accepted", "telehealth_states"],
    },
    headers: {
      authorization: `Bearer ${sessionToken}`,
      host: "localhost:8787",
    },
    method: "POST",
    url: "/applications/application-live-fields/apply-live-fields",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload.applied_fields, ["insurance_accepted", "telehealth_states"]);

  const therapist = state.documents.get("therapist-existing");
  const application = state.documents.get("application-live-fields");

  assert.deepEqual(therapist.insuranceAccepted, ["Aetna", "Blue Shield"]);
  assert.deepEqual(therapist.telehealthStates, ["CA", "WA"]);
  assert.equal(therapist.website, "https://old.example.com");
  assert.equal(therapist.fieldReviewStates.insuranceAccepted, "editorially_verified");
  assert.equal(therapist.fieldReviewStates.telehealthStates, "editorially_verified");

  assert.equal(application.status, "approved");
  assert.equal(application.publishedTherapistId, "therapist-existing");
  assert.equal(application.fieldReviewStates.insuranceAccepted, "editorially_verified");
  assert.equal(application.fieldReviewStates.telehealthStates, "editorially_verified");
  assert.equal(Array.isArray(application.revisionHistory), true);
  assert.equal(application.revisionHistory.at(-1).type, "applied_live_fields");
});

test("workflow: candidate publish creates therapist and records candidate review history", async function () {
  const { client, state } = createMemoryClient({
    "candidate-workflow-1": {
      _id: "candidate-workflow-1",
      _type: "therapistCandidate",
      name: "Dr. Casey North",
      credentials: "LCSW",
      city: "Seattle",
      state: "WA",
      sourceUrl: "https://example.com/casey",
      supportingSourceUrls: ["https://example.com/casey/profile"],
      careApproach: "Structured and skills-based bipolar care.",
      specialties: ["Bipolar disorder"],
      insuranceAccepted: ["Premera"],
      languages: ["English"],
      reviewStatus: "queued",
      publishRecommendation: "",
      dedupeStatus: "unreviewed",
      licensureVerification: {
        verifiedAt: "2026-04-08T00:00:00.000Z",
        statusStanding: "clear",
      },
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const sessionToken = await loginAsAdmin(handler);

  const response = await runHandlerRequest(handler, {
    body: {
      decision: "publish",
      notes: "Ready to go live",
    },
    headers: {
      authorization: `Bearer ${sessionToken}`,
      host: "localhost:8787",
    },
    method: "POST",
    url: "/candidates/candidate-workflow-1/decision",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);

  const therapistId = response.payload.therapistId;
  const candidate = state.documents.get("candidate-workflow-1");
  const therapist = state.documents.get(therapistId);

  assert.equal(candidate.reviewStatus, "published");
  assert.equal(candidate.publishRecommendation, "ready");
  assert.equal(candidate.publishedTherapistId, therapistId);
  assert.equal(Array.isArray(candidate.reviewHistory), true);
  assert.equal(candidate.reviewHistory.at(-1).decision, "publish");

  assert.equal(therapist._type, "therapist");
  assert.equal(therapist.name, "Dr. Casey North");
  assert.equal(therapist.licenseState, "");
  assert.equal(therapist.verificationStatus, "under_review");
  assert.deepEqual(therapist.supportingSourceUrls, ["https://example.com/casey/profile"]);
});
