import assert from "node:assert/strict";
import test from "node:test";

import { createReviewApiHandler } from "../../server/review-handler.mjs";
import { handleSignupRoutes } from "../../server/review-signup-routes.mjs";
import { createMemoryClient, createTestApiConfig, runHandlerRequest } from "./test-helpers.mjs";

function standardHeaders() {
  return { host: "localhost:8787" };
}

function createMockResponse() {
  return { statusCode: null, payload: null };
}

function createSendJson(response) {
  return function sendJson(_res, statusCode, payload) {
    response.statusCode = statusCode;
    response.payload = payload;
  };
}

function createBodyParser(body) {
  return async function parseBody() {
    return body;
  };
}

function buildSignupContext({ client, config, body, routePath, extraDeps }) {
  const response = createMockResponse();
  return {
    context: {
      client,
      config,
      origin: "",
      request: { method: "POST" },
      response,
      routePath,
      deps: {
        parseBody: createBodyParser(body),
        sendJson: createSendJson(response),
        ...(extraDeps || {}),
      },
    },
    response,
  };
}

test("signup draft: creates a new session when none provided and stores email", async function () {
  const { client, state } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { email: "Clinician@Example.com", current_step: 1 },
    headers: standardHeaders(),
    method: "POST",
    url: "/signup/draft",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.ok(response.payload.draft.session_id, "session id should be returned");
  assert.equal(response.payload.draft.email, "clinician@example.com");

  const drafts = Array.from(state.documents.values()).filter(
    (doc) => doc._type === "therapistSignupDraft",
  );
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].email, "clinician@example.com");
  assert.equal(drafts[0].currentStep, 1);
});

test("signup draft: subsequent upsert reuses the same session id", async function () {
  const { client, state } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const first = await runHandlerRequest(handler, {
    body: { email: "a@b.com" },
    headers: standardHeaders(),
    method: "POST",
    url: "/signup/draft",
  });
  const sessionId = first.payload.draft.session_id;

  await runHandlerRequest(handler, {
    body: {
      session_id: sessionId,
      license_number: "12345",
      license_type: "LMFT",
      current_step: 2,
    },
    headers: standardHeaders(),
    method: "POST",
    url: "/signup/draft",
  });

  const drafts = Array.from(state.documents.values()).filter(
    (doc) => doc._type === "therapistSignupDraft",
  );
  assert.equal(drafts.length, 1, "should not create a second draft");
  assert.equal(drafts[0].email, "a@b.com");
  assert.equal(drafts[0].licenseNumber, "12345");
  assert.equal(drafts[0].licenseType, "LMFT");
  assert.equal(drafts[0].currentStep, 2);
});

test("signup draft: rejects malformed email", async function () {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { email: "not-an-email" },
    headers: standardHeaders(),
    method: "POST",
    url: "/signup/draft",
  });

  assert.equal(response.statusCode, 400);
});

test("signup draft: rejects unsupported bipolar answer", async function () {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { email: "x@y.com", bipolar_answer: "maybe-later" },
    headers: standardHeaders(),
    method: "POST",
    url: "/signup/draft",
  });

  assert.equal(response.statusCode, 400);
});

test("signup verify-license: persists verification result and returns identity data", async function () {
  const { client, state } = createMemoryClient();

  // Prime a draft
  const first = await runHandlerRequest(createReviewApiHandler(createTestApiConfig(), client), {
    body: { email: "dr@example.com" },
    headers: standardHeaders(),
    method: "POST",
    url: "/signup/draft",
  });
  const sessionId = first.payload.draft.session_id;

  const fakeVerification = {
    sourceSystem: "california_dca_search",
    licenseType: "Licensed Marriage and Family Therapist",
    jurisdiction: "CA",
    primaryStatus: "active",
    disciplineFlag: false,
    rawSnapshot: JSON.stringify({
      name: { firstName: "Jane", lastName: "Smith" },
      address: { city: "Oakland", state: "CA" },
    }),
  };
  const verifyLicenseMock = async function () {
    return {
      verified: true,
      isActive: true,
      name: { firstName: "Jane", middleName: "", lastName: "Smith" },
      address: { city: "Oakland", state: "CA", zip: "94611" },
      licensureVerification: fakeVerification,
    };
  };
  const resolveLicenseTypeCodeMock = function () {
    return "2001";
  };

  const { context, response } = buildSignupContext({
    client,
    config: createTestApiConfig(),
    body: { session_id: sessionId, license_type: "LMFT", license_number: "12345" },
    routePath: "/signup/verify-license",
    extraDeps: {
      verifyLicense: verifyLicenseMock,
      resolveLicenseTypeCode: resolveLicenseTypeCodeMock,
    },
  });

  await handleSignupRoutes(context);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.verified, true);
  assert.equal(response.payload.name, "Jane Smith");
  assert.equal(response.payload.city, "Oakland");
  assert.equal(response.payload.is_active, true);

  const draft = Array.from(state.documents.values()).find(
    (doc) => doc._type === "therapistSignupDraft",
  );
  assert.equal(draft.licenseNumber, "12345");
  assert.equal(draft.currentStep, 3);
  assert.ok(draft.licensureVerification, "verification should persist on draft");
});

test("signup verify-license: saves license number even when DCA returns unverified", async function () {
  const { client, state } = createMemoryClient();

  const first = await runHandlerRequest(createReviewApiHandler(createTestApiConfig(), client), {
    body: { email: "dr@example.com" },
    headers: standardHeaders(),
    method: "POST",
    url: "/signup/draft",
  });
  const sessionId = first.payload.draft.session_id;

  const verifyLicenseMock = async function () {
    return { verified: false, error: "License not found in DCA database" };
  };

  const { context, response } = buildSignupContext({
    client,
    config: createTestApiConfig(),
    body: { session_id: sessionId, license_type: "LMFT", license_number: "99999" },
    routePath: "/signup/verify-license",
    extraDeps: {
      verifyLicense: verifyLicenseMock,
      resolveLicenseTypeCode: () => "2001",
    },
  });

  await handleSignupRoutes(context);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.verified, false);
  assert.match(response.payload.error, /not found/i);

  const draft = Array.from(state.documents.values()).find(
    (doc) => doc._type === "therapistSignupDraft",
  );
  assert.equal(draft.licenseNumber, "99999");
  assert.equal(draft.currentStep, 2);
});

test("signup complete: promotes to claim link when a therapist already exists for the license", async function () {
  const initial = {
    "therapist-1": {
      _id: "therapist-1",
      _type: "therapist",
      name: "Jane Smith",
      email: "jane@existing.com",
      licenseNumber: "12345",
      licenseState: "CA",
      listingActive: true,
      slug: { current: "jane-smith" },
    },
  };
  const { client, state } = createMemoryClient(initial);

  const draft = {
    _id: "therapist-signup-draft-sess123",
    _type: "therapistSignupDraft",
    sessionId: "sess123",
    email: "dr@example.com",
    licenseNumber: "12345",
    licenseType: "LMFT",
    licenseState: "CA",
    bipolarAnswer: "yes",
    currentStep: 4,
    outcome: "pending",
    licensureVerification: { rawSnapshot: "{}" },
  };
  state.documents.set(draft._id, draft);

  const claimLinksSent = [];
  const { context, response } = buildSignupContext({
    client,
    config: { ...createTestApiConfig(), portalBaseUrl: "http://localhost:5173" },
    body: { session_id: "sess123" },
    routePath: "/signup/complete",
    extraDeps: {
      sendPortalClaimLink: async function (_config, therapist, requesterEmail) {
        claimLinksSent.push({ slug: therapist.slug.current, requesterEmail });
      },
      sendSignupAcknowledgment: async function () {},
      notifyAdminOfSubmission: async function () {},
    },
  });

  await handleSignupRoutes(context);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.outcome, "claim_sent");
  assert.equal(response.payload.therapist_name, "Jane Smith");
  assert.equal(claimLinksSent.length, 1);
  assert.equal(claimLinksSent[0].slug, "jane-smith");
  assert.equal(claimLinksSent[0].requesterEmail, "dr@example.com");

  const updatedDraft = state.documents.get("therapist-signup-draft-sess123");
  assert.equal(updatedDraft.outcome, "promoted_claim");
  assert.equal(updatedDraft.promotedTherapistSlug, "jane-smith");
});

test("signup complete: creates a new application when license has no existing therapist", async function () {
  const { client, state } = createMemoryClient();

  const draft = {
    _id: "therapist-signup-draft-new1",
    _type: "therapistSignupDraft",
    sessionId: "new1",
    email: "newbie@example.com",
    licenseNumber: "77777",
    licenseType: "LCSW",
    licenseState: "CA",
    bipolarAnswer: "sometimes",
    currentStep: 4,
    outcome: "pending",
    licensureVerification: {
      rawSnapshot: JSON.stringify({
        name: { firstName: "Pat", lastName: "Lee" },
        address: { city: "San Diego", state: "CA" },
      }),
    },
  };
  state.documents.set(draft._id, draft);

  const acks = [];
  const { context, response } = buildSignupContext({
    client,
    config: createTestApiConfig(),
    body: { session_id: "new1" },
    routePath: "/signup/complete",
    extraDeps: {
      sendPortalClaimLink: async function () {
        throw new Error("should not be called for new signups");
      },
      sendSignupAcknowledgment: async function (_config, applicant) {
        acks.push(applicant);
      },
      notifyAdminOfSubmission: async function () {},
    },
  });

  await handleSignupRoutes(context);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.outcome, "application_created");
  assert.equal(response.payload.therapist_name, "Pat Lee");

  const applications = Array.from(state.documents.values()).filter(
    (doc) => doc._type === "therapistApplication",
  );
  assert.equal(applications.length, 1);
  assert.equal(applications[0].email, "newbie@example.com");
  assert.equal(applications[0].licenseNumber, "77777");
  assert.equal(applications[0].credentials, "LCSW");
  assert.equal(applications[0].city, "San Diego");
  assert.equal(applications[0].signupWizardBipolarAnswer, "sometimes");

  assert.equal(acks.length, 1);
  assert.equal(acks[0].email, "newbie@example.com");
});

test("signup complete: rejects when required draft fields are missing", async function () {
  const { client, state } = createMemoryClient();
  const draft = {
    _id: "therapist-signup-draft-partial",
    _type: "therapistSignupDraft",
    sessionId: "partial",
    email: "only@example.com",
    currentStep: 1,
    outcome: "pending",
  };
  state.documents.set(draft._id, draft);

  const { context, response } = buildSignupContext({
    client,
    config: createTestApiConfig(),
    body: { session_id: "partial" },
    routePath: "/signup/complete",
    extraDeps: {
      sendPortalClaimLink: async function () {},
      sendSignupAcknowledgment: async function () {},
      notifyAdminOfSubmission: async function () {},
    },
  });

  await handleSignupRoutes(context);

  assert.equal(response.statusCode, 400);
});
