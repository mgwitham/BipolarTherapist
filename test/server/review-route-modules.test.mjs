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
    actorId: "architect",
    actorName: "architect",
    authMode: "password",
  });
});

test("read routes return a shared reviewer roster for authorized admins", async function () {
  const { client } = createMemoryClient({
    siteSettings: {
      _id: "siteSettings",
      _type: "siteSettings",
      reviewerDirectory: [
        { reviewerId: "architect", name: "architect", active: true },
        { reviewerId: "reviewer-two", name: "reviewer-two", active: true },
        { reviewerId: "former-reviewer", name: "former-reviewer", active: false },
      ],
    },
    therapistApplications: [
      {
        _id: "application-1",
        _type: "therapistApplication",
        reviewFollowUp: { assignee: "architect" },
      },
    ],
    therapistCandidates: [
      {
        _id: "candidate-1",
        _type: "therapistCandidate",
        reviewFollowUp: { assignee: "reviewer-two" },
      },
    ],
    therapistPublishEvents: [
      {
        _id: "event-1",
        _type: "therapistPublishEvent",
        actorName: "ops-lead",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
    ],
  });
  const handler = createReviewApiHandler(
    createTestApiConfig(),
    client,
  );
  const sessionToken = await loginAsAdmin(handler);
  const response = await runHandlerRequest(handler, {
    headers: {
      authorization: `Bearer ${sessionToken}`,
      host: "localhost:8787",
    },
    method: "GET",
    url: "/reviewers",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, [
    { id: "architect", name: "architect", active: true },
    { id: "ops-lead", name: "ops-lead", active: true },
    { id: "reviewer-two", name: "reviewer-two", active: true },
  ]);
});

test("read routes persist reviewer directory updates for authorized admins", async function () {
  const { client } = createMemoryClient({
    siteSettings: {
      _id: "siteSettings",
      _type: "siteSettings",
      reviewerDirectory: [{ reviewerId: "architect", name: "architect", active: true }],
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const sessionToken = await loginAsAdmin(handler);
  const response = await runHandlerRequest(handler, {
    body: {
      reviewers: [
        { id: "architect", name: "architect", active: true },
        { id: "reviewer-two", name: "reviewer-two", active: true },
        { id: "former-reviewer", name: "former-reviewer", active: false },
      ],
    },
    headers: {
      authorization: `Bearer ${sessionToken}`,
      host: "localhost:8787",
    },
    method: "PATCH",
    url: "/reviewers",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, [
    { id: "architect", name: "architect", active: true },
    { id: "reviewer-two", name: "reviewer-two", active: true },
  ]);
  const siteSettings = await client.getDocument("siteSettings");
  assert.deepEqual(siteSettings.reviewerDirectory, [
    { reviewerId: "architect", name: "architect", active: true },
    { reviewerId: "reviewer-two", name: "reviewer-two", active: true },
    { reviewerId: "former-reviewer", name: "former-reviewer", active: false },
  ]);
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

test("application routes emit follow-up audit events on shared follow-up updates", async function () {
  const response = createResponseCapture();
  const application = {
    _id: "application-follow-up-1",
    _type: "therapistApplication",
    status: "reviewing",
    publishedTherapistId: "therapist-55",
  };
  let createdEvent = null;

  const handled = await handleApplicationRoutes({
    client: {
      async create(document) {
        createdEvent = document;
        return document;
      },
      async getDocument(id) {
        if (id === "application-follow-up-1") {
          return application;
        }
        return null;
      },
    },
    config: {},
    deps: {
      async buildApplicationDocument() {
        return {};
      },
      buildAppliedFieldReviewStatePatch() {
        return {};
      },
      buildApplicationReviewEvent(_application, details) {
        return { _type: "therapistPublishEvent", ...details };
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
      async findDuplicateTherapistEntity() {
        return null;
      },
      getAuthorizedActor() {
        return "architect";
      },
      isAuthorized() {
        return true;
      },
      normalizeApplication(value) {
        return value;
      },
      async notifyAdminOfSubmission() {},
      async notifyApplicantOfDecision() {},
      async parseBody() {
        return {
          review_follow_up: {
            status: "blocked",
            note: "Waiting on insurer confirmation",
            assignee: "michael",
            due_at: "2026-04-15",
          },
        };
      },
      publishingHelpers: {},
      sendJson: createSendJson(response),
      slugify(value) {
        return value;
      },
      async updateApplicationFields() {
        return {
          ...application,
          reviewFollowUp: {
            status: "blocked",
            note: "Waiting on insurer confirmation",
            assignee: "michael",
            dueAt: "2026-04-15",
            updatedAt: "2026-04-08T12:00:00.000Z",
          },
        };
      },
      validateRevisionInput() {},
    },
    origin: "",
    request: {
      method: "PATCH",
      headers: {},
    },
    response,
    routePath: "/applications/application-follow-up-1",
  });

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.reviewFollowUp.status, "blocked");
  assert.equal(response.payload.reviewFollowUp.assignee, "michael");
  assert.equal(response.payload.reviewFollowUp.dueAt, "2026-04-15");
  assert.equal(createdEvent.eventType, "application_follow_up_updated");
  assert.equal(createdEvent.actorName, "architect");
  assert.deepEqual(createdEvent.changedFields, ["reviewFollowUp"]);
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
      getAuthorizedActor() {
        return "architect";
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

test("candidate routes persist shared review follow-up updates", async function () {
  const response = createResponseCapture();
  const candidate = {
    _id: "candidate-2",
    _type: "therapistCandidate",
    name: "Dr. Shared Task",
  };
  let createdEvent = null;

  const client = {
    async create(document) {
      createdEvent = document;
      return document;
    },
    async getDocument(id) {
      if (id === "candidate-2") {
        return candidate;
      }
      return null;
    },
    patch() {
      return {
        set() {
          return this;
        },
        async commit() {
          return {
            ...candidate,
            reviewFollowUp: {
              status: "blocked",
              note: "Waiting on licensure clarification",
              assignee: "michael",
              dueAt: "2026-04-16",
              updatedAt: "2026-04-08T12:00:00.000Z",
            },
          };
        },
      };
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
        return details;
      },
      buildFieldTrustMeta() {
        return {};
      },
      buildTherapistDocumentFromCandidate() {
        return {};
      },
      computeCandidateReviewMeta() {
        return {};
      },
      computeTherapistVerificationMeta() {
        return {};
      },
      getAuthorizedActor() {
        return "architect";
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
        return {
          review_follow_up: {
            status: "blocked",
            note: "Waiting on licensure clarification",
            assignee: "michael",
            due_at: "2026-04-16",
          },
        };
      },
      publishingHelpers: {},
      sendJson: createSendJson(response),
    },
    origin: "",
    request: {
      method: "PATCH",
      headers: {},
    },
    response,
    routePath: "/candidates/candidate-2",
  });

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.reviewFollowUp.status, "blocked");
  assert.equal(response.payload.reviewFollowUp.note, "Waiting on licensure clarification");
  assert.equal(response.payload.reviewFollowUp.assignee, "michael");
  assert.equal(response.payload.reviewFollowUp.dueAt, "2026-04-16");
  assert.equal(createdEvent.eventType, "candidate_follow_up_updated");
  assert.equal(createdEvent.actorName, "architect");
  assert.deepEqual(createdEvent.changedFields, ["reviewFollowUp"]);
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
      getAuthorizedActor() {
        return "architect";
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

test("top-level review handler returns normalized review events for authorized admins", async function () {
  const { client } = createMemoryClient({
    "event-1": {
      _id: "event-1",
      _type: "therapistPublishEvent",
      eventType: "candidate_published",
      providerId: "provider-123",
      candidateId: "cand-123",
      candidateDocumentId: "candidate-123",
      therapistId: "therapist-123",
      decision: "publish",
      reviewStatus: "published",
      publishRecommendation: "ready",
      actorName: "architect",
      rationale: "Final trust pass looked strong",
      notes: "Published after final review",
      changedFields: ["reviewStatus", "publishedTherapistId"],
      createdAt: "2026-04-08T12:00:00.000Z",
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const sessionToken = await loginAsAdmin(handler);

  const response = await runHandlerRequest(handler, {
    headers: {
      authorization: `Bearer ${sessionToken}`,
      host: "localhost:8787",
    },
    method: "GET",
    url: "/events",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(Array.isArray(response.payload.items), true);
  assert.equal(response.payload.items.length, 1);
  assert.equal(response.payload.next_cursor, "");
  assert.equal(response.payload.items[0].event_type, "candidate_published");
  assert.equal(response.payload.items[0].provider_id, "provider-123");
  assert.equal(response.payload.items[0].actor_name, "architect");
  assert.equal(response.payload.items[0].rationale, "Final trust pass looked strong");
  assert.deepEqual(response.payload.items[0].changed_fields, [
    "reviewStatus",
    "publishedTherapistId",
  ]);
});

test("top-level review handler exports filtered review events as csv for authorized admins", async function () {
  const { client } = createMemoryClient({
    "event-1": {
      _id: "event-1",
      _type: "therapistPublishEvent",
      eventType: "candidate_published",
      providerId: "provider-123",
      candidateId: "cand-123",
      candidateDocumentId: "candidate-123",
      therapistId: "therapist-123",
      actorName: "architect",
      rationale: "Publish now",
      notes: "Looks good",
      createdAt: "2026-04-08T12:00:00.000Z",
    },
    "event-2": {
      _id: "event-2",
      _type: "therapistPublishEvent",
      eventType: "therapist_review_deferred",
      therapistId: "therapist-ops-1",
      actorName: "architect",
      rationale: "Wait 7 days",
      createdAt: "2026-04-07T12:00:00.000Z",
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const sessionToken = await loginAsAdmin(handler);

  const response = await runHandlerRequest(handler, {
    headers: {
      authorization: `Bearer ${sessionToken}`,
      host: "localhost:8787",
    },
    method: "GET",
    url: "/events/export?format=csv&lane=candidate",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(typeof response.payload, "string");
  assert.equal(response.payload.includes("candidate_published"), true);
  assert.equal(response.payload.includes("therapist_review_deferred"), false);
  assert.equal(response.payload.includes("actor_name"), true);
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
