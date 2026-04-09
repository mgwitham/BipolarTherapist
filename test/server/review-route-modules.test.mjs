import assert from "node:assert/strict";
import test from "node:test";

import { handleApplicationRoutes } from "../../server/review-application-routes.mjs";
import { handleAuthAndPortalRoutes } from "../../server/review-auth-portal-routes.mjs";
import { handleCandidateRoutes } from "../../server/review-candidate-routes.mjs";
import { handleOpsRoutes } from "../../server/review-ops-routes.mjs";
import { createReviewApiHandler } from "../../server/review-handler.mjs";
import {
  createJsonRequest,
  createMemoryClient,
  createResponseCapture,
  createSendJson,
  createTestApiConfig,
  createTransactionSpy,
  runHandlerRequest,
} from "./test-helpers.mjs";

test("auth routes create a signed session on valid login", async function () {
  const response = createResponseCapture();
  let parsedBodyCount = 0;

  const handled = await handleAuthAndPortalRoutes({
    client: {},
    config: {
      adminUsername: "architect",
      adminPassword: "secret-pass",
      allowLegacyKey: false,
      adminKey: "",
      sessionTtlMs: 60000,
    },
    deps: {
      buildPortalRequestDocument() {},
      canAttemptLogin() {
        return true;
      },
      clearFailedLogins() {},
      createSignedSession() {
        return "signed-session-token";
      },
      getSecurityWarnings() {
        return [];
      },
      isAuthorized() {
        return false;
      },
      normalizePortalRequest(value) {
        return value;
      },
      parseAuthorizationHeader() {
        return "";
      },
      async parseBody() {
        parsedBodyCount += 1;
        return { username: "architect", password: "secret-pass" };
      },
      readPortalClaimToken() {
        return null;
      },
      readSignedSession() {
        return null;
      },
      recordFailedLogin() {},
      sendJson: createSendJson(response),
      async sendPortalClaimLink() {},
      async updatePortalRequestFields() {},
    },
    origin: "",
    request: {
      method: "POST",
      headers: {},
    },
    response,
    routePath: "/auth/login",
    url: new URL("http://localhost/auth/login"),
  });

  assert.equal(handled, true);
  assert.equal(parsedBodyCount, 1);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, {
    ok: true,
    sessionToken: "signed-session-token",
    authMode: "password",
  });
});

test("application routes reject duplicate therapist submissions with conflict details", async function () {
  const response = createResponseCapture();

  const handled = await handleApplicationRoutes({
    client: {},
    config: {},
    deps: {
      async buildApplicationDocument() {
        throw new Error("should not build document when duplicate exists");
      },
      buildAppliedFieldReviewStatePatch() {
        return {};
      },
      async buildRevisionFieldUpdates() {
        return {};
      },
      buildTherapistApplicationFieldPatch() {
        return { appliedFields: [], patch: {} };
      },
      buildTherapistDocument() {
        return {};
      },
      buildTherapistOpsEvent() {
        return {};
      },
      async findDuplicateTherapistEntity() {
        return {
          kind: "therapist",
          id: "therapist-123",
          slug: "dr-rivera-los-angeles-ca",
          name: "Dr. Rivera",
          reasons: ["license", "email"],
        };
      },
      isAuthorized() {
        return false;
      },
      normalizeApplication(value) {
        return value;
      },
      async notifyAdminOfSubmission() {},
      async notifyApplicantOfDecision() {},
      async parseBody() {
        return { name: "Dr. Rivera" };
      },
      publishingHelpers: {},
      sendJson: createSendJson(response),
      slugify(value) {
        return value;
      },
      async updateApplicationFields() {
        return {};
      },
      validateRevisionInput() {},
    },
    origin: "",
    request: {
      method: "POST",
      headers: {},
    },
    response,
    routePath: "/applications",
  });

  assert.equal(handled, true);
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload.duplicate_kind, "therapist");
  assert.equal(response.payload.recommended_intake_type, "claim_existing");
  assert.deepEqual(response.payload.duplicate_reasons, ["license", "email"]);
});

test("candidate routes publish a matched candidate into therapist documents", async function () {
  const response = createResponseCapture();
  const state = {
    lastTransaction: null,
  };
  const candidate = {
    _id: "candidate-1",
    _type: "therapistCandidate",
    matchedTherapistId: "",
    licensureVerification: { status: "verified" },
    supportingSourceUrls: ["https://source.example/profile"],
    reviewStatus: "queued",
    publishRecommendation: "",
    dedupeStatus: "unreviewed",
  };
  const createdTherapist = {
    _id: "therapist-candidate-1",
    _type: "therapist",
    name: "Dr. Candidate",
  };

  const client = {
    async getDocument(id) {
      if (id === "candidate-1") {
        return candidate;
      }
      return null;
    },
    transaction() {
      return createTransactionSpy(state);
    },
  };

  const handled = await handleCandidateRoutes({
    client,
    config: {},
    deps: {
      addDays(value) {
        return value;
      },
      buildCandidateReviewEvent(_candidate, details) {
        return { _type: "candidateReviewEvent", ...details };
      },
      buildFieldTrustMeta() {
        return {};
      },
      buildTherapistDocumentFromCandidate(_candidate, therapistId) {
        return {
          ...createdTherapist,
          _id: therapistId || createdTherapist._id,
        };
      },
      computeCandidateReviewMeta() {
        return {
          reviewLane: "ready_to_publish",
          reviewPriority: 10,
          nextReviewDueAt: "",
        };
      },
      computeTherapistVerificationMeta() {
        return {
          verificationPriority: 20,
          verificationLane: "healthy",
          nextReviewDueAt: "",
          lastOperationalReviewAt: "",
          dataCompletenessScore: 90,
        };
      },
      isAuthorized() {
        return true;
      },
      mergeLicensureVerification(primary) {
        return primary;
      },
      normalizeLicensureVerification(value) {
        return value;
      },
      normalizePortableCandidate(value) {
        return value;
      },
      async parseBody() {
        return { decision: "publish", notes: "Looks good" };
      },
      publishingHelpers: {},
      sendJson: createSendJson(response),
    },
    origin: "",
    request: {
      method: "POST",
      headers: {},
    },
    response,
    routePath: "/candidates/candidate-1/decision",
  });

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.ok(Array.isArray(state.lastTransaction));
  assert.equal(
    state.lastTransaction.some(function (entry) {
      return entry.type === "createOrReplace" && entry.document._type === "therapist";
    }),
    true,
  );
  assert.equal(
    state.lastTransaction.some(function (entry) {
      return entry.type === "delete" && entry.id === "drafts.therapist-candidate-1";
    }),
    true,
  );
});

test("ops routes can snooze therapist review work", async function () {
  const response = createResponseCapture();
  const state = {
    lastTransaction: null,
  };
  const therapist = {
    _id: "therapist-1",
    _type: "therapist",
    name: "Dr. Ops",
  };

  const client = {
    async getDocument(id) {
      if (id === "therapist-1") {
        return therapist;
      }
      return null;
    },
    transaction() {
      return createTransactionSpy(state);
    },
  };

  const handled = await handleOpsRoutes({
    client,
    config: {},
    deps: {
      addDays(_value, days) {
        return `plus-${days}-days`;
      },
      buildFieldTrustMeta() {
        return {};
      },
      buildLicensureOpsEvent() {
        return {};
      },
      buildTherapistOpsEvent(_therapist, details) {
        return { _type: "therapistOpsEvent", ...details };
      },
      computeTherapistVerificationMeta() {
        return {};
      },
      isAuthorized() {
        return true;
      },
      async parseBody() {
        return { decision: "snooze_30d", notes: "Waiting for refresh window" };
      },
      sendJson: createSendJson(response),
    },
    origin: "",
    request: {
      method: "POST",
      headers: {},
    },
    response,
    routePath: "/therapists/therapist-1/ops",
  });

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.ok(Array.isArray(state.lastTransaction));
  assert.equal(
    state.lastTransaction.some(function (entry) {
      return (
        entry.type === "patch" &&
        entry.id === "therapist-1" &&
        entry.patchState.set.nextReviewDueAt === "plus-30-days" &&
        entry.patchState.set.verificationLane === "refresh_soon"
      );
    }),
    true,
  );
});

test("top-level review handler dispatches auth routes before falling through", async function () {
  const response = createResponseCapture();
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  await handler(
    createJsonRequest({
      body: {
        username: "architect",
        password: "secret-pass",
      },
      headers: {
        host: "localhost:8787",
      },
      method: "POST",
      url: "/auth/login",
    }),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(typeof response.payload.sessionToken, "string");
  assert.equal(response.payload.authMode, "password");
});

test("top-level review handler supports authenticated portal request creation and listing", async function () {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const loginResponse = await runHandlerRequest(handler, {
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

  const sessionToken = loginResponse.payload.sessionToken;
  assert.equal(typeof sessionToken, "string");

  const createResponse = await runHandlerRequest(handler, {
    body: {
      therapist_slug: "dr-rivera-los-angeles-ca",
      therapist_name: "Dr. Rivera",
      request_type: "claim_profile",
      requester_name: "Dr. Rivera",
      requester_email: "dr.rivera@example.com",
      message: "Please help me claim my profile.",
    },
    headers: {
      host: "localhost:8787",
    },
    method: "POST",
    url: "/portal/requests",
  });

  assert.equal(createResponse.statusCode, 201);
  assert.equal(createResponse.payload.therapist_slug, "dr-rivera-los-angeles-ca");
  assert.equal(createResponse.payload.status, "open");

  const listResponse = await runHandlerRequest(handler, {
    headers: {
      authorization: `Bearer ${sessionToken}`,
      host: "localhost:8787",
    },
    method: "GET",
    url: "/portal/requests",
  });

  assert.equal(listResponse.statusCode, 200);
  assert.equal(Array.isArray(listResponse.payload), true);
  assert.equal(listResponse.payload.length, 1);
  assert.equal(listResponse.payload[0].request_type, "claim_profile");
  assert.equal(listResponse.payload[0].requester_email, "dr.rivera@example.com");
});

test("top-level review handler rejects invalid portal claim tokens", async function () {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    headers: {
      host: "localhost:8787",
    },
    method: "GET",
    url: "/portal/claim-session?token=not-a-real-token",
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.payload.error, "Claim link is invalid or expired.");
});

test("top-level review handler returns normalized candidate lists for authorized admins", async function () {
  const { client } = createMemoryClient({
    "candidate-list-1": {
      _id: "candidate-list-1",
      _type: "therapistCandidate",
      name: "Dr. Listy McListface",
      city: "Oakland",
      state: "CA",
      sourceUrl: "https://example.com/listy",
      reviewStatus: "queued",
      publishRecommendation: "",
      dedupeStatus: "unreviewed",
      licensureVerification: { status: "verified" },
      supportingSourceUrls: [],
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const loginResponse = await runHandlerRequest(handler, {
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

  const response = await runHandlerRequest(handler, {
    headers: {
      authorization: `Bearer ${loginResponse.payload.sessionToken}`,
      host: "localhost:8787",
    },
    method: "GET",
    url: "/candidates",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(Array.isArray(response.payload), true);
  assert.equal(response.payload.length, 1);
  assert.equal(response.payload[0].id, "candidate-list-1");
  assert.equal(response.payload[0].name, "Dr. Listy McListface");
});

test("top-level review handler supports authenticated application approval", async function () {
  const { client, state } = createMemoryClient({
    "application-1": {
      _id: "application-1",
      _type: "therapistApplication",
      name: "Dr. Jamie Rivera",
      email: "jamie@example.com",
      city: "Los Angeles",
      state: "CA",
      submittedSlug: "dr-jamie-rivera-los-angeles-ca",
      status: "pending",
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const loginResponse = await runHandlerRequest(handler, {
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

  const approveResponse = await runHandlerRequest(handler, {
    body: {},
    headers: {
      authorization: `Bearer ${loginResponse.payload.sessionToken}`,
      host: "localhost:8787",
    },
    method: "POST",
    url: "/applications/application-1/approve",
  });

  assert.equal(approveResponse.statusCode, 200);
  assert.equal(approveResponse.payload.ok, true);
  assert.equal(
    approveResponse.payload.therapistId,
    "therapist-dr-jamie-rivera-los-angeles-ca",
  );

  const updatedApplication = state.documents.get("application-1");
  const therapist = state.documents.get("therapist-dr-jamie-rivera-los-angeles-ca");
  assert.equal(updatedApplication.status, "approved");
  assert.equal(
    updatedApplication.publishedTherapistId,
    "therapist-dr-jamie-rivera-los-angeles-ca",
  );
  assert.equal(therapist._type, "therapist");
});

test("top-level review handler rejects unauthorized application approval attempts", async function () {
  const { client, state } = createMemoryClient({
    "application-unauthorized": {
      _id: "application-unauthorized",
      _type: "therapistApplication",
      name: "Dr. Unauthorized",
      email: "unauthorized@example.com",
      city: "Portland",
      state: "OR",
      submittedSlug: "dr-unauthorized-portland-or",
      status: "pending",
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: {},
    headers: {
      host: "localhost:8787",
    },
    method: "POST",
    url: "/applications/application-unauthorized/approve",
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.payload.error, "Unauthorized.");
  assert.equal(state.documents.get("application-unauthorized").status, "pending");
  assert.equal(state.documents.has("therapist-dr-unauthorized-portland-or"), false);
});

test("top-level review handler rejects unauthorized therapist ops actions", async function () {
  const { client, state } = createMemoryClient({
    "therapist-ops-unauthorized": {
      _id: "therapist-ops-unauthorized",
      _type: "therapist",
      name: "Dr. Ops Guard",
      verificationLane: "needs_verification",
      nextReviewDueAt: "",
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: {
      decision: "snooze_30d",
      notes: "Should not be applied",
    },
    headers: {
      host: "localhost:8787",
    },
    method: "POST",
    url: "/therapists/therapist-ops-unauthorized/ops",
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.payload.error, "Unauthorized.");
  assert.equal(
    state.documents.get("therapist-ops-unauthorized").verificationLane,
    "needs_verification",
  );
  assert.equal(state.documents.get("therapist-ops-unauthorized").nextReviewDueAt, "");
});

test("top-level review handler supports authenticated candidate publish decisions", async function () {
  const { client, state } = createMemoryClient({
    "candidate-42": {
      _id: "candidate-42",
      _type: "therapistCandidate",
      name: "Dr. Casey North",
      city: "Seattle",
      state: "WA",
      sourceUrl: "https://example.com/casey",
      supportingSourceUrls: ["https://example.com/casey/bio"],
      reviewStatus: "queued",
      publishRecommendation: "",
      dedupeStatus: "unreviewed",
      licensureVerification: { status: "verified" },
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const loginResponse = await runHandlerRequest(handler, {
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

  const decisionResponse = await runHandlerRequest(handler, {
    body: {
      decision: "publish",
      notes: "Ready for launch",
    },
    headers: {
      authorization: `Bearer ${loginResponse.payload.sessionToken}`,
      host: "localhost:8787",
    },
    method: "POST",
    url: "/candidates/candidate-42/decision",
  });

  assert.equal(decisionResponse.statusCode, 200);
  assert.equal(decisionResponse.payload.ok, true);
  assert.equal(decisionResponse.payload.therapistId, "therapist-dr-casey-north-seattle-wa");

  const updatedCandidate = state.documents.get("candidate-42");
  const publishedTherapist = state.documents.get("therapist-dr-casey-north-seattle-wa");
  assert.equal(updatedCandidate.reviewStatus, "published");
  assert.equal(
    updatedCandidate.publishedTherapistId,
    "therapist-dr-casey-north-seattle-wa",
  );
  assert.equal(publishedTherapist._type, "therapist");
});
