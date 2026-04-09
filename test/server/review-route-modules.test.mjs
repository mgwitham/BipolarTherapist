import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { handleApplicationRoutes } from "../../server/review-application-routes.mjs";
import { handleAuthAndPortalRoutes } from "../../server/review-auth-portal-routes.mjs";
import { handleCandidateRoutes } from "../../server/review-candidate-routes.mjs";
import { handleOpsRoutes } from "../../server/review-ops-routes.mjs";
import { createReviewApiHandler } from "../../server/review-handler.mjs";

function createResponseCapture() {
  return {
    statusCode: null,
    headers: null,
    payload: null,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.payload = body ? JSON.parse(body) : null;
    },
  };
}

function createJsonRequest({ body, headers, method, url }) {
  const payload = body ? JSON.stringify(body) : "";
  const request = Readable.from(payload ? [payload] : []);
  request.method = method;
  request.url = url;
  request.headers = headers || {};
  request.socket = {
    remoteAddress: "127.0.0.1",
  };
  request.destroy = function destroy() {};
  return request;
}

function createSendJson(response) {
  return function sendJson(_res, statusCode, payload) {
    response.statusCode = statusCode;
    response.payload = payload;
  };
}

function createTransactionSpy(state) {
  const operations = [];

  return {
    operations,
    create(document) {
      operations.push({ type: "create", document });
      return this;
    },
    createOrReplace(document) {
      operations.push({ type: "createOrReplace", document });
      return this;
    },
    delete(id) {
      operations.push({ type: "delete", id });
      return this;
    },
    patch(id, builder) {
      const patchState = {
        set: {},
        setIfMissing: {},
        append: {},
      };
      const patchApi = {
        set(fields) {
          patchState.set = { ...patchState.set, ...fields };
          return patchApi;
        },
        setIfMissing(fields) {
          patchState.setIfMissing = { ...patchState.setIfMissing, ...fields };
          return patchApi;
        },
        append(field, values) {
          patchState.append[field] = values;
          return patchApi;
        },
      };
      builder(patchApi);
      operations.push({ type: "patch", id, patchState });
      return this;
    },
    async commit() {
      state.lastTransaction = operations.slice();
      return { transactionId: "txn-1" };
    },
  };
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
  const handler = createReviewApiHandler(
    {
      projectId: "test-project",
      dataset: "test-dataset",
      apiVersion: "2026-04-02",
      token: "",
      adminUsername: "architect",
      adminPassword: "secret-pass",
      allowLegacyKey: false,
      adminKey: "",
      sessionTtlMs: 60000,
      allowedOrigins: [],
      sessionSecret: "test-secret",
      loginWindowMs: 60000,
      loginMaxAttempts: 5,
    },
    {
      async fetch() {
        return [];
      },
      async create() {
        return {};
      },
      async getDocument() {
        return null;
      },
      transaction() {
        return createTransactionSpy({});
      },
    },
  );

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
