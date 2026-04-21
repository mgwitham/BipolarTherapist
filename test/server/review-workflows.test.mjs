import assert from "node:assert/strict";
import test from "node:test";

import { createReviewApiHandler } from "../../server/review-handler.mjs";
import { createMemoryClient, createTestApiConfig, runHandlerRequest } from "./test-helpers.mjs";

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
      licenseState: "WA",
      licenseNumber: "LCSW98765",
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

  assert.equal(candidate.reviewStatus, "archived");
  assert.equal(candidate.reviewLane, "archived");
  assert.equal(candidate.publishRecommendation, "ready");
  assert.equal(candidate.publishedTherapistId, therapistId);
  assert.equal(Array.isArray(candidate.reviewHistory), true);
  assert.equal(candidate.reviewHistory.at(-1).decision, "publish");

  assert.equal(therapist._type, "therapist");
  assert.equal(therapist.name, "Dr. Casey North");
  assert.equal(therapist.licenseState, "WA");
  assert.equal(therapist.verificationStatus, "under_review");
  assert.deepEqual(therapist.supportingSourceUrls, ["https://example.com/casey/profile"]);

  const listResponse = await runHandlerRequest(handler, {
    headers: {
      authorization: `Bearer ${sessionToken}`,
      host: "localhost:8787",
    },
    method: "GET",
    url: "/candidates",
  });
  assert.equal(listResponse.statusCode, 200);
  const editorialQueue = listResponse.payload.filter(function (item) {
    const lane = String(item.review_lane || "").toLowerCase();
    const status = String(item.review_status || "").toLowerCase();
    return (
      status !== "published" &&
      status !== "archived" &&
      (lane === "editorial_review" || status === "queued" || status === "needs_review")
    );
  });
  assert.equal(
    editorialQueue.find(function (item) {
      return item.id === "candidate-workflow-1";
    }),
    undefined,
    "Published candidate should not appear in editorial_review/queued selection",
  );
});

test("workflow: candidate publish is blocked without a license number", async function () {
  const { client } = createMemoryClient({
    "candidate-no-license": {
      _id: "candidate-no-license",
      _type: "therapistCandidate",
      name: "Dr. No License",
      credentials: "LMFT",
      city: "San Francisco",
      state: "CA",
      sourceUrl: "https://example.com/no-license",
      reviewStatus: "queued",
      publishRecommendation: "",
      dedupeStatus: "unreviewed",
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const sessionToken = await loginAsAdmin(handler);

  const response = await runHandlerRequest(handler, {
    body: { decision: "publish" },
    headers: {
      authorization: `Bearer ${sessionToken}`,
      host: "localhost:8787",
    },
    method: "POST",
    url: "/candidates/candidate-no-license/decision",
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.payload.error, /license number/i);
});

test("workflow: application approval is blocked without a license number", async function () {
  const { client } = createMemoryClient({
    "application-no-license": {
      _id: "application-no-license",
      _type: "therapistApplication",
      name: "Dr. No License App",
      email: "nolicense@example.com",
      city: "Oakland",
      state: "CA",
      submittedSlug: "dr-no-license-app-oakland-ca",
      status: "pending",
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const sessionToken = await loginAsAdmin(handler);

  const response = await runHandlerRequest(handler, {
    body: {},
    headers: {
      authorization: `Bearer ${sessionToken}`,
      host: "localhost:8787",
    },
    method: "POST",
    url: "/applications/application-no-license/approve",
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.payload.error, /license number/i);
});

// --- /applications/intake (short-form new-therapist signup) ---

// Helpers for DCA mocking in the new synchronous-verify intake flow.
// The server's verifyLicense() hits iservices.dca.ca.gov via global
// fetch — monkey-patching that gives us deterministic test behavior
// without adding an injectable client.
function withDcaFetchStub(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async function (url, init) {
    const href = String(url);
    if (href.includes("iservices.dca.ca.gov")) {
      return handler(url);
    }
    if (original) return original(url, init);
    throw new Error("No fetch stub for " + href);
  };
  return function restore() {
    globalThis.fetch = original;
  };
}

test("intake: sync-verifies the license and publishes a therapist doc (listingActive=false, pending_profile)", async function () {
  const { client, state } = createMemoryClient();
  const handler = createReviewApiHandler(
    { ...createTestApiConfig(), dcaAppId: "app", dcaAppKey: "key" },
    client,
  );
  // Only the MFT type (2001) returns a license hit; the other 5 types
  // return empty so we exercise the "race all types" path.
  const restore = withDcaFetchStub((url) => {
    const match = String(url).match(/licType=(\d+)/);
    const typeCode = match ? match[1] : "";
    if (typeCode === "2001") {
      return {
        ok: true,
        async json() {
          return {
            licenseDetails: [
              {
                getFullLicenseDetail: [
                  {
                    getLicenseDetails: [
                      {
                        primaryStatusCode: "20",
                        expDate: "20990101",
                        issueDate: "20100101",
                        licenseNumber: "12345",
                        boardCode: "04",
                      },
                    ],
                    getNameDetails: [
                      {
                        individualNameDetails: [
                          { firstName: "Jamie", middleName: "", lastName: "Rivera" },
                        ],
                      },
                    ],
                    getAddressDetail: [
                      {
                        address: [{ city: "Los Angeles", state: "CA" }],
                      },
                    ],
                  },
                ],
              },
            ],
          };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return { licenseDetails: [] };
      },
    };
  });

  try {
    const response = await runHandlerRequest(handler, {
      body: {
        name: "Dr. Jamie Rivera",
        email: "jamie@example.com",
        license_number: "12345",
        city: "Los Angeles",
        state: "CA",
        treats_bipolar: true,
      },
      headers: { host: "localhost:8787" },
      method: "POST",
      url: "/applications/intake",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(typeof response.payload.therapist_slug, "string");
    assert.equal(typeof response.payload.therapist_id, "string");
    assert.equal(typeof response.payload.claim_token, "string");
    // stripe_url is empty in tests because no Stripe keys are configured;
    // the intake gracefully degrades so the client can still fall back
    // to the portal + claim-token path.
    assert.equal(typeof response.payload.stripe_url, "string");

    // Therapist doc was created with the hidden-listing gate so the
    // stub bio doesn't leak to the directory.
    const therapist = state.documents.get(response.payload.therapist_id);
    assert.ok(therapist, "therapist doc should have been created in Sanity");
    assert.equal(therapist._type, "therapist");
    assert.equal(therapist.listingActive, false);
    assert.equal(therapist.status, "pending_profile");
    assert.equal(therapist.claimStatus, "unclaimed");
    assert.equal(therapist.intakeSource, "signup_instant_checkout");

    // Audit-trail application doc still exists; status is auto_approved
    // with the therapist id linked so admin can trace origin.
    const applications = Array.from(state.documents.values()).filter(
      (d) => d._type === "therapistApplication",
    );
    assert.equal(applications.length, 1, "one audit application doc");
    const app = applications[0];
    assert.equal(app.status, "auto_approved");
    assert.equal(app.publishedTherapistId, therapist._id);
  } finally {
    restore();
  }
});

test("intake: license-not-verified returns 422 and does NOT create any docs", async function () {
  const { client, state } = createMemoryClient();
  const handler = createReviewApiHandler(
    { ...createTestApiConfig(), dcaAppId: "app", dcaAppKey: "key" },
    client,
  );
  // DCA returns empty arrays for every license type -> no verification
  const restore = withDcaFetchStub(() => ({
    ok: true,
    async json() {
      return { licenseDetails: [] };
    },
  }));
  try {
    const response = await runHandlerRequest(handler, {
      body: {
        name: "Dr. Fake Name",
        email: "fake@example.com",
        license_number: "99999",
        city: "Los Angeles",
        state: "CA",
        treats_bipolar: true,
      },
      headers: { host: "localhost:8787" },
      method: "POST",
      url: "/applications/intake",
    });

    assert.equal(response.statusCode, 422);
    assert.equal(response.payload.reason, "license_not_verified");
    assert.match(response.payload.error, /verify/i);
    // No doc should have been created when the license fails verification.
    const docs = Array.from(state.documents.values());
    assert.equal(docs.length, 0);
  } finally {
    restore();
  }
});

test("intake: missing fields returns 400", async function () {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: {
      name: "Dr. Jamie Rivera",
      // missing email + license_number
      treats_bipolar: true,
    },
    headers: { host: "localhost:8787" },
    method: "POST",
    url: "/applications/intake",
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.payload.error, /required/i);
});

test("intake: missing treats_bipolar checkbox returns 400", async function () {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: {
      name: "Dr. Jamie Rivera",
      email: "jamie@example.com",
      license_number: "LMFT12345",
      city: "Los Angeles",
      treats_bipolar: false,
    },
    headers: { host: "localhost:8787" },
    method: "POST",
    url: "/applications/intake",
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.payload.error, /bipolar/i);
});

test("intake: duplicate license (existing therapist) returns 409 with claim guidance", async function () {
  const { client } = createMemoryClient({
    "therapist-existing": {
      _id: "therapist-existing",
      _type: "therapist",
      name: "Dr. Jamie Rivera",
      email: "jamie@example.com",
      licenseNumber: "LMFT12345",
      licenseState: "CA",
      state: "CA",
      slug: { current: "dr-jamie-rivera-los-angeles-ca", _type: "slug" },
      listingActive: true,
      status: "active",
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: {
      name: "Dr. Jamie Rivera",
      email: "jamie@example.com",
      license_number: "LMFT12345",
      city: "Los Angeles",
      state: "CA",
      treats_bipolar: true,
    },
    headers: { host: "localhost:8787" },
    method: "POST",
    url: "/applications/intake",
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.payload.recommended_intake_type, "claim_existing");
  assert.match(response.payload.error, /claim/i);
});

test("approval: emits a portal magic link to the applicant so they can finish their profile", async function () {
  // Spy on Resend sends by wrapping fetch — the email helper calls
  // api.resend.com directly, so intercepting fetch is the simplest
  // way to assert on outgoing email bodies without mocking deep into
  // the helper graph.
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.resend.com")) {
      let body = {};
      try {
        body = JSON.parse(String((init && init.body) || "{}"));
      } catch (_error) {
        /* ignore */
      }
      calls.push(body);
      return new Response(JSON.stringify({ id: "email_test" }), { status: 200 });
    }
    return originalFetch(url, init);
  };

  try {
    const { client } = createMemoryClient();
    const config = {
      ...createTestApiConfig(),
      resendApiKey: "re_test_key",
      emailFrom: "noreply@bipolartherapyhub.example",
      notificationTo: "admin@bipolartherapyhub.example",
    };
    const handler = createReviewApiHandler(config, client);

    const submitResponse = await runHandlerRequest(handler, {
      body: {
        name: "Dr. Avery Approval",
        credentials: "LMFT",
        email: "avery@example.com",
        city: "San Francisco",
        state: "CA",
        bio: "I help adults with bipolar disorder build stable routines.",
        license_state: "CA",
        license_number: "LMFT90001",
        care_approach: "Practical and relapse-prevention oriented.",
      },
      headers: { host: "localhost:8787" },
      method: "POST",
      url: "/applications",
    });
    assert.equal(submitResponse.statusCode, 201);
    const applicationId = submitResponse.payload.id;

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

    // The approval email goes to the applicant. Filter by recipient
    // to skip the admin notification (which was sent at submit time
    // to a different address).
    const approvalCall = calls.find(
      (call) => Array.isArray(call.to) && call.to.includes("avery@example.com"),
    );
    assert.ok(approvalCall, "approval email should be sent to the applicant");
    assert.match(approvalCall.subject, /approved/i);
    // Magic link points at /portal.html with a signed token in the
    // URL param — that's the "complete your profile" hop.
    assert.match(approvalCall.html, /portal\.html\?token=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- /applications/free-path-selected (plan-choice "List free for now") ---

// Helper: run an intake call that will succeed and return the claim_token
// the subsequent free-path endpoint expects. Mocks DCA so the license
// verifies inline.
async function runSuccessfulIntake(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function (url, init) {
    const href = String(url);
    if (href.includes("iservices.dca.ca.gov")) {
      const match = href.match(/licType=(\d+)/);
      const typeCode = match ? match[1] : "";
      if (typeCode === "2001") {
        return {
          ok: true,
          async json() {
            return {
              licenseDetails: [
                {
                  getFullLicenseDetail: [
                    {
                      getLicenseDetails: [
                        {
                          primaryStatusCode: "20",
                          expDate: "20990101",
                          issueDate: "20100101",
                          licenseNumber: "45678",
                          boardCode: "04",
                        },
                      ],
                      getNameDetails: [
                        {
                          individualNameDetails: [
                            { firstName: "Jordan", middleName: "", lastName: "Free" },
                          ],
                        },
                      ],
                      getAddressDetail: [{ address: [{ city: "Oakland", state: "CA" }] }],
                    },
                  ],
                },
              ],
            };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return { licenseDetails: [] };
        },
      };
    }
    if (originalFetch) return originalFetch(url, init);
    throw new Error("No fetch stub for " + href);
  };
  try {
    const response = await runHandlerRequest(handler, {
      body: {
        name: "Dr. Jordan Free",
        email: "jordan@example.com",
        license_number: "45678",
        city: "Oakland",
        state: "CA",
        treats_bipolar: true,
      },
      headers: { host: "localhost:8787" },
      method: "POST",
      url: "/applications/intake",
    });
    return { response, restore: () => (globalThis.fetch = originalFetch) };
  } catch (error) {
    globalThis.fetch = originalFetch;
    throw error;
  }
}

test("free-path-selected: with a valid claim_token sends a magic-login email and returns email_sent=true", async function () {
  const { client } = createMemoryClient();
  const config = {
    ...createTestApiConfig(),
    dcaAppId: "app",
    dcaAppKey: "key",
    resendApiKey: "re_test_key",
    emailFrom: "noreply@bipolartherapyhub.example",
    notificationTo: "admin@bipolartherapyhub.example",
  };
  const handler = createReviewApiHandler(config, client);

  const resendCalls = [];
  const origFetch = globalThis.fetch;
  const { response: intakeResponse, restore: restoreDca } = await runSuccessfulIntake(handler);
  // After the intake helper restores fetch, swap in a Resend spy so we
  // can assert the free-path email is actually sent.
  restoreDca();
  const capturedFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.resend.com")) {
      let body = {};
      try {
        body = JSON.parse(String((init && init.body) || "{}"));
      } catch (_error) {
        /* ignore */
      }
      resendCalls.push(body);
      return new Response(JSON.stringify({ id: "email_test" }), { status: 200 });
    }
    if (capturedFetch) return capturedFetch(url, init);
    return origFetch(url, init);
  };
  try {
    assert.equal(intakeResponse.statusCode, 200);
    const claimToken = intakeResponse.payload.claim_token;
    assert.ok(claimToken, "intake should return a claim token");

    const response = await runHandlerRequest(handler, {
      body: { claim_token: claimToken },
      headers: { host: "localhost:8787" },
      method: "POST",
      url: "/applications/free-path-selected",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.email_sent, true);

    const claimEmail = resendCalls.find(
      (call) => Array.isArray(call.to) && call.to.includes("jordan@example.com"),
    );
    assert.ok(claimEmail, "free-path email should be sent to the applicant");
    assert.match(claimEmail.subject, /activate/i);
    assert.match(claimEmail.html, /portal\.html\?token=/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("free-path-selected: missing claim_token returns 400", async function () {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const response = await runHandlerRequest(handler, {
    body: {},
    headers: { host: "localhost:8787" },
    method: "POST",
    url: "/applications/free-path-selected",
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.payload.error, /claim_token/i);
});

test("free-path-selected: invalid claim_token returns 401", async function () {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const response = await runHandlerRequest(handler, {
    body: { claim_token: "not-a-real-token" },
    headers: { host: "localhost:8787" },
    method: "POST",
    url: "/applications/free-path-selected",
  });
  assert.equal(response.statusCode, 401);
  assert.match(response.payload.error, /invalid|expired/i);
});
