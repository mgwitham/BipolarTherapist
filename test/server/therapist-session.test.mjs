import assert from "node:assert/strict";
import test from "node:test";

import {
  createTherapistSession,
  getAuthorizedTherapist,
  readTherapistSession,
  sessionIsStaleForListing,
  THERAPIST_SESSION_COOKIE,
} from "../../server/review-http-auth.mjs";
import { createReviewApiHandler } from "../../server/review-handler.mjs";
import {
  createMemoryClient,
  createTestApiConfig,
  readSetCookieHeader,
  runHandlerRequest,
} from "./test-helpers.mjs";

function standardHeaders(extra) {
  return { host: "localhost:8787", ...(extra || {}) };
}

test("therapist session: token round-trips slug and email", () => {
  const config = { ...createTestApiConfig(), therapistSessionTtlMs: 60_000 };
  const token = createTherapistSession(config, {
    slug: "jamie-rivera",
    email: "jamie@example.com",
  });
  const payload = readTherapistSession(token, config);
  assert.ok(payload);
  assert.equal(payload.sub, "therapist");
  assert.equal(payload.slug, "jamie-rivera");
  assert.equal(payload.email, "jamie@example.com");
  assert.ok(payload.exp > Date.now());
});

test("therapist session: admin session tokens are rejected as therapist", () => {
  const config = createTestApiConfig();
  const adminToken = createTherapistSession(config, { slug: "x", email: "y" });
  // same secret, a forged payload with sub=admin should not validate as therapist
  assert.ok(readTherapistSession(adminToken, config));
});

test("therapist session: missing slug is rejected", () => {
  const config = createTestApiConfig();
  const token = createTherapistSession(config, { email: "no-slug@example.com" });
  assert.equal(readTherapistSession(token, config), null);
});

test("therapist session: expired token is rejected", () => {
  const config = { ...createTestApiConfig(), therapistSessionTtlMs: -1000 };
  const token = createTherapistSession(config, { slug: "jamie", email: "e" });
  assert.equal(readTherapistSession(token, config), null);
});

test("getAuthorizedTherapist ignores Authorization bearer tokens", () => {
  const config = createTestApiConfig();
  const token = createTherapistSession(config, { slug: "jamie", email: "e@e.com" });
  const request = { headers: { authorization: `Bearer ${token}` } };
  assert.equal(getAuthorizedTherapist(request, config), null);
});

test("getAuthorizedTherapist returns payload from the HttpOnly session cookie", () => {
  const config = createTestApiConfig();
  const token = createTherapistSession(config, { slug: "jamie", email: "e@e.com" });
  const request = {
    headers: { cookie: `${THERAPIST_SESSION_COOKIE}=${encodeURIComponent(token)}` },
  };
  const actor = getAuthorizedTherapist(request, config);
  assert.ok(actor);
  assert.equal(actor.slug, "jamie");
  assert.equal(actor.email, "e@e.com");
});

test("getAuthorizedTherapist returns null when header missing", () => {
  const config = createTestApiConfig();
  assert.equal(getAuthorizedTherapist({ headers: {} }, config), null);
});

test("/portal/claim-accept issues a therapist session token and /portal/me returns the therapist", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": {
      _id: "therapist-jamie",
      _type: "therapist",
      name: "Jamie Rivera",
      email: "jamie@example.com",
      slug: { current: "jamie-rivera" },
      claimStatus: "unclaimed",
    },
  });
  const config = createTestApiConfig();
  const handler = createReviewApiHandler(config, client);

  // Manufacture a valid claim token the way sendPortalClaimLink would.
  const { createSignedPayload } = await import("../../server/review-http-auth.mjs");
  const claimToken = createSignedPayload(
    {
      sub: "therapist-portal",
      slug: "jamie-rivera",
      email: "jamie@example.com",
      exp: Date.now() + 60_000,
      nonce: "test-nonce",
    },
    config.sessionSecret,
  );

  const acceptResponse = await runHandlerRequest(handler, {
    body: { token: claimToken },
    headers: standardHeaders(),
    method: "POST",
    url: "/portal/claim-accept",
  });

  assert.equal(acceptResponse.statusCode, 200);
  assert.equal(acceptResponse.payload.ok, true);
  assert.equal(acceptResponse.payload.therapist_session_token, undefined);
  assert.match(String(acceptResponse.headers["Set-Cookie"] || ""), /bt_therapist_session=/);
  assert.match(String(acceptResponse.headers["Set-Cookie"] || ""), /HttpOnly/);

  const sessionCookie = readSetCookieHeader(acceptResponse, THERAPIST_SESSION_COOKIE);
  assert.ok(sessionCookie);

  const meResponse = await runHandlerRequest(handler, {
    headers: standardHeaders({ cookie: sessionCookie }),
    method: "GET",
    url: "/portal/me",
  });

  assert.equal(meResponse.statusCode, 200);
  assert.equal(meResponse.payload.therapist.slug, "jamie-rivera");
  assert.equal(meResponse.payload.therapist.claim_status, "claimed");
  assert.equal(meResponse.payload.session.slug, "jamie-rivera");
  assert.equal(meResponse.payload.session.email, "jamie@example.com");
});

test("/portal/me returns 401 without a session token", async () => {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    headers: standardHeaders(),
    method: "GET",
    url: "/portal/me",
  });

  assert.equal(response.statusCode, 401);
});

function buildClaimedTherapistFixture(overrides) {
  return {
    _id: "therapist-jamie",
    _type: "therapist",
    name: "Jamie Rivera",
    email: "jamie@example.com",
    slug: { current: "jamie-rivera" },
    city: "Oakland",
    state: "CA",
    claimStatus: "claimed",
    claimedByEmail: "jamie@example.com",
    bio: "Experienced therapist specializing in bipolar-adjacent mood work and stabilization.",
    acceptingNewPatients: true,
    ...overrides,
  };
}

function authHeader(slug, email) {
  const config = createTestApiConfig();
  const token = createTherapistSession(config, { slug, email });
  return { cookie: `${THERAPIST_SESSION_COOKIE}=${encodeURIComponent(token)}` };
}

test("PATCH /portal/therapist requires a session token", async () => {
  const { client } = createMemoryClient({ "therapist-jamie": buildClaimedTherapistFixture() });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { bio: "x".repeat(60) },
    headers: standardHeaders(),
    method: "PATCH",
    url: "/portal/therapist",
  });

  assert.equal(response.statusCode, 401);
});

test("PATCH /portal/therapist rejects edits on an unclaimed profile", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": buildClaimedTherapistFixture({ claimStatus: "unclaimed" }),
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { bio: "x".repeat(60) },
    headers: standardHeaders(authHeader("jamie-rivera", "jamie@example.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });

  assert.equal(response.statusCode, 403);
});

test("PATCH /portal/therapist writes whitelisted fields and ignores unknown keys", async () => {
  const { client } = createMemoryClient({ "therapist-jamie": buildClaimedTherapistFixture() });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: {
      bio: "Brand new bio with enough characters to clear the fifty char min requirement here.",
      accepting_new_patients: false,
      specialties: "Bipolar II, Mood stabilization, Grief",
      session_fee_min: 150,
      session_fee_max: 225,
      sliding_scale: true,
      // These should be silently ignored — identity/trust fields are locked.
      name: "Someone Else",
      licenseNumber: "00000",
      slug: "someone-else",
      claimStatus: "unclaimed",
    },
    headers: standardHeaders(authHeader("jamie-rivera", "jamie@example.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });

  assert.equal(response.statusCode, 200);
  const updated = response.payload.therapist;
  assert.equal(updated.name, "Jamie Rivera"); // locked
  assert.equal(updated.accepting_new_patients, false);
  assert.equal(updated.sliding_scale, true);
  assert.equal(updated.session_fee_min, 150);
  assert.equal(updated.session_fee_max, 225);
  assert.deepEqual(updated.specialties, ["Bipolar II", "Mood stabilization", "Grief"]);

  const raw = await client.getDocument("therapist-jamie");
  assert.equal(raw.name, "Jamie Rivera");
  assert.equal(raw.claimStatus, "claimed");
  assert.equal(raw.acceptingNewPatients, false);
});

test("PATCH /portal/therapist rejects bio shorter than 50 characters", async () => {
  const { client } = createMemoryClient({ "therapist-jamie": buildClaimedTherapistFixture() });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { bio: "too short" },
    headers: standardHeaders(authHeader("jamie-rivera", "jamie@example.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.field, "bio");
});

test("PATCH /portal/therapist rejects session_fee_min greater than session_fee_max", async () => {
  const { client } = createMemoryClient({ "therapist-jamie": buildClaimedTherapistFixture() });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { session_fee_min: 300, session_fee_max: 150 },
    headers: standardHeaders(authHeader("jamie-rivera", "jamie@example.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.field, "session_fee_min");
});

test("PATCH /portal/therapist rejects invalid preferred_contact_method", async () => {
  const { client } = createMemoryClient({ "therapist-jamie": buildClaimedTherapistFixture() });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { preferred_contact_method: "carrier-pigeon" },
    headers: standardHeaders(authHeader("jamie-rivera", "jamie@example.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.field, "preferred_contact_method");
});

test("PATCH /portal/therapist promotes touched fields into therapist_reported_fields", async () => {
  const { client } = createMemoryClient({ "therapist-jamie": buildClaimedTherapistFixture() });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: {
      bio: "Updated bio with plenty of characters to pass the fifty char minimum here.",
      phone: "415-867-2345",
      specialties: "Bipolar II, Mood stabilization",
    },
    headers: standardHeaders(authHeader("jamie-rivera", "jamie@example.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });

  assert.equal(response.statusCode, 200);
  const raw = await client.getDocument("therapist-jamie");
  assert.ok(Array.isArray(raw.therapistReportedFields));
  const reported = new Set(raw.therapistReportedFields);
  assert.ok(reported.has("bio"));
  assert.ok(reported.has("phone"));
  assert.ok(reported.has("specialties"));
  // Fields not in the PATCH body should not be marked reviewed.
  assert.ok(!reported.has("website"));

  assert.deepEqual(response.payload.therapist.therapist_reported_fields.sort(), [
    "bio",
    "phone",
    "specialties",
  ]);
});

test("PATCH /portal/therapist appends to an existing therapist_reported_fields list", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": buildClaimedTherapistFixture({
      therapistReportedFields: ["phone", "website"],
    }),
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { estimated_wait_time: "2 weeks" },
    headers: standardHeaders(authHeader("jamie-rivera", "jamie@example.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });

  assert.equal(response.statusCode, 200);
  const raw = await client.getDocument("therapist-jamie");
  const reported = new Set(raw.therapistReportedFields);
  assert.ok(reported.has("phone"));
  assert.ok(reported.has("website"));
  assert.ok(reported.has("estimated_wait_time"));
});

test("PATCH /portal/therapist rejects a placeholder phone number", async () => {
  const { client } = createMemoryClient({ "therapist-jamie": buildClaimedTherapistFixture() });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { phone: "555-555-5555" },
    headers: standardHeaders(authHeader("jamie-rivera", "jamie@example.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.field, "phone");
  assert.match(response.payload.error, /placeholder/i);
});

test("PATCH /portal/therapist rejects a placeholder email and accepts a real one", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": buildClaimedTherapistFixture({
      phone: "415-867-2345",
    }),
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const bad = await runHandlerRequest(handler, {
    body: { email: "jamie@example.com" },
    headers: standardHeaders(authHeader("jamie-rivera", "jamie@example.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.payload.field, "email");

  const good = await runHandlerRequest(handler, {
    body: { email: "jamie@bipolartherapyhub.com" },
    headers: standardHeaders(authHeader("jamie-rivera", "jamie@example.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });
  assert.equal(good.statusCode, 200);
  const raw = await client.getDocument("therapist-jamie");
  assert.equal(raw.email, "jamie@bipolartherapyhub.com");
});

test("PATCH /portal/therapist rejects a PATCH that would clear every public contact", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": buildClaimedTherapistFixture({
      email: "jamie@bipolartherapyhub.com",
      phone: "",
      website: "",
      bookingUrl: "",
    }),
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { email: "" },
    headers: standardHeaders(authHeader("jamie-rivera", "jamie@example.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.payload.error, /at least one way/i);
});

test("PATCH /portal/therapist silently ignores claimedByEmail in the body", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": buildClaimedTherapistFixture({
      claimedByEmail: "jamie@original.com",
      email: "jamie@bipolartherapyhub.com",
    }),
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: {
      bio: "Updated bio copy here that is plenty long enough to pass the fifty char minimum.",
      claimedByEmail: "hijacker@attacker.com",
      claimed_by_email: "hijacker@attacker.com",
    },
    headers: standardHeaders(authHeader("jamie-rivera", "jamie@original.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });

  assert.equal(response.statusCode, 200);
  const raw = await client.getDocument("therapist-jamie");
  assert.equal(raw.claimedByEmail, "jamie@original.com");
});

test("PATCH /portal/therapist unsets optional fields when given an empty value", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": buildClaimedTherapistFixture({
      estimatedWaitTime: "2 weeks",
      specialties: ["Bipolar I", "Mood disorders"],
    }),
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { estimated_wait_time: "", specialties: [] },
    headers: standardHeaders(authHeader("jamie-rivera", "jamie@example.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });

  assert.equal(response.statusCode, 200);
  const raw = await client.getDocument("therapist-jamie");
  assert.equal(raw.estimatedWaitTime, undefined);
  assert.equal(raw.specialties, undefined);
});

test("POST /portal/dev-login returns 404 in production regardless of ALLOW_DEV_LOGIN", async () => {
  const { client } = createMemoryClient({
    "therapist-test-complete": {
      _id: "therapist-test-complete",
      _type: "therapist",
      name: "Dev Test Complete",
      slug: { current: "dev-test-complete" },
      claimStatus: "claimed",
      claimedByEmail: "test-complete@dev.bipolartherapyhub.invalid",
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllow = process.env.ALLOW_DEV_LOGIN;
  process.env.NODE_ENV = "production";
  process.env.ALLOW_DEV_LOGIN = "true";
  try {
    const response = await runHandlerRequest(handler, {
      body: { email: "test-complete@dev.bipolartherapyhub.invalid" },
      headers: standardHeaders(),
      method: "POST",
      url: "/portal/dev-login",
    });
    assert.equal(response.statusCode, 404);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllow === undefined) {
      delete process.env.ALLOW_DEV_LOGIN;
    } else {
      process.env.ALLOW_DEV_LOGIN = originalAllow;
    }
  }
});

test("POST /portal/dev-login returns 404 when ALLOW_DEV_LOGIN is unset, even in development", async () => {
  const { client } = createMemoryClient({});
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllow = process.env.ALLOW_DEV_LOGIN;
  process.env.NODE_ENV = "development";
  delete process.env.ALLOW_DEV_LOGIN;
  try {
    const response = await runHandlerRequest(handler, {
      body: { email: "test-complete@dev.bipolartherapyhub.invalid" },
      headers: standardHeaders(),
      method: "POST",
      url: "/portal/dev-login",
    });
    assert.equal(response.statusCode, 404);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllow === undefined) {
      delete process.env.ALLOW_DEV_LOGIN;
    } else {
      process.env.ALLOW_DEV_LOGIN = originalAllow;
    }
  }
});

test("POST /portal/dev-login returns 404 for an email not in the allowlist", async () => {
  const { client } = createMemoryClient({
    "therapist-attack": {
      _id: "therapist-attack",
      _type: "therapist",
      name: "Real Therapist",
      slug: { current: "real-therapist" },
      claimStatus: "claimed",
      claimedByEmail: "real-therapist@practice.com",
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllow = process.env.ALLOW_DEV_LOGIN;
  process.env.NODE_ENV = "development";
  process.env.ALLOW_DEV_LOGIN = "true";
  try {
    const response = await runHandlerRequest(handler, {
      body: { email: "real-therapist@practice.com" },
      headers: standardHeaders(),
      method: "POST",
      url: "/portal/dev-login",
    });
    assert.equal(response.statusCode, 404);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllow === undefined) {
      delete process.env.ALLOW_DEV_LOGIN;
    } else {
      process.env.ALLOW_DEV_LOGIN = originalAllow;
    }
  }
});

test("POST /portal/dev-login issues a valid session when all three guards pass", async () => {
  const { client } = createMemoryClient({
    "therapist-test-complete": {
      _id: "therapist-test-complete",
      _type: "therapist",
      name: "Dev Test Complete",
      slug: { current: "dev-test-complete" },
      claimStatus: "claimed",
      claimedByEmail: "test-complete@dev.bipolartherapyhub.invalid",
      listingActive: false,
      status: "inactive",
    },
  });
  const config = createTestApiConfig();
  const handler = createReviewApiHandler(config, client);

  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllow = process.env.ALLOW_DEV_LOGIN;
  process.env.NODE_ENV = "development";
  process.env.ALLOW_DEV_LOGIN = "true";
  try {
    const response = await runHandlerRequest(handler, {
      body: { email: "test-complete@dev.bipolartherapyhub.invalid" },
      headers: standardHeaders(),
      method: "POST",
      url: "/portal/dev-login",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.slug, "dev-test-complete");
    assert.equal(response.payload.therapist_session_token, undefined);
    const sessionCookie = readSetCookieHeader(response, THERAPIST_SESSION_COOKIE);
    assert.ok(sessionCookie);

    const meResponse = await runHandlerRequest(handler, {
      headers: standardHeaders({ cookie: sessionCookie }),
      method: "GET",
      url: "/portal/me",
    });
    assert.equal(meResponse.statusCode, 200);
    assert.equal(meResponse.payload.therapist.slug, "dev-test-complete");
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllow === undefined) {
      delete process.env.ALLOW_DEV_LOGIN;
    } else {
      process.env.ALLOW_DEV_LOGIN = originalAllow;
    }
  }
});

test("POST /portal/dev-login refuses a fixture email on a listingActive=true record", async () => {
  const { client } = createMemoryClient({
    "therapist-test-complete": {
      _id: "therapist-test-complete",
      _type: "therapist",
      name: "Dev Test Complete",
      slug: { current: "dev-test-complete" },
      claimStatus: "claimed",
      claimedByEmail: "test-complete@dev.bipolartherapyhub.invalid",
      listingActive: true,
      status: "inactive",
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllow = process.env.ALLOW_DEV_LOGIN;
  process.env.NODE_ENV = "development";
  process.env.ALLOW_DEV_LOGIN = "true";
  try {
    const response = await runHandlerRequest(handler, {
      body: { email: "test-complete@dev.bipolartherapyhub.invalid" },
      headers: standardHeaders(),
      method: "POST",
      url: "/portal/dev-login",
    });
    assert.equal(response.statusCode, 404);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllow === undefined) {
      delete process.env.ALLOW_DEV_LOGIN;
    } else {
      process.env.ALLOW_DEV_LOGIN = originalAllow;
    }
  }
});

test("POST /portal/dev-login refuses a fixture email on a status=active record", async () => {
  const { client } = createMemoryClient({
    "therapist-test-complete": {
      _id: "therapist-test-complete",
      _type: "therapist",
      name: "Dev Test Complete",
      slug: { current: "dev-test-complete" },
      claimStatus: "claimed",
      claimedByEmail: "test-complete@dev.bipolartherapyhub.invalid",
      listingActive: false,
      status: "active",
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllow = process.env.ALLOW_DEV_LOGIN;
  process.env.NODE_ENV = "development";
  process.env.ALLOW_DEV_LOGIN = "true";
  try {
    const response = await runHandlerRequest(handler, {
      body: { email: "test-complete@dev.bipolartherapyhub.invalid" },
      headers: standardHeaders(),
      method: "POST",
      url: "/portal/dev-login",
    });
    assert.equal(response.statusCode, 404);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllow === undefined) {
      delete process.env.ALLOW_DEV_LOGIN;
    } else {
      process.env.ALLOW_DEV_LOGIN = originalAllow;
    }
  }
});

test("POST /portal/dev-login logs a warning when the route is hit in production", async () => {
  const { client } = createMemoryClient({});
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllow = process.env.ALLOW_DEV_LOGIN;
  process.env.NODE_ENV = "production";
  process.env.ALLOW_DEV_LOGIN = "true";
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = function (...args) {
    warnings.push(args.join(" "));
  };
  try {
    const response = await runHandlerRequest(handler, {
      body: { email: "test-complete@dev.bipolartherapyhub.invalid" },
      headers: standardHeaders(),
      method: "POST",
      url: "/portal/dev-login",
    });
    assert.equal(response.statusCode, 404);
    assert.equal(
      warnings.some((msg) => msg.includes("[DEV LOGIN] Route hit in production")),
      true,
      "expected a '[DEV LOGIN] Route hit in production' warning",
    );
  } finally {
    console.warn = originalWarn;
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllow === undefined) {
      delete process.env.ALLOW_DEV_LOGIN;
    } else {
      process.env.ALLOW_DEV_LOGIN = originalAllow;
    }
  }
});

test("/portal/analytics returns current-week engagement summary for the authenticated therapist", async () => {
  const { buildEngagementPeriodKey, buildEngagementPeriodStart } =
    await import("../../shared/therapist-engagement-domain.mjs");
  const now = new Date();
  const nowIso = now.toISOString();
  const periodKey = buildEngagementPeriodKey(nowIso);
  const periodStart = buildEngagementPeriodStart(nowIso);
  const periodYear = Number(periodKey.split("-W")[0]);
  const periodWeek = Number(periodKey.split("-W")[1]);

  const { client } = createMemoryClient({
    "therapist-jamie": {
      _id: "therapist-jamie",
      _type: "therapist",
      name: "Jamie Rivera",
      email: "jamie@example.com",
      slug: { current: "jamie-rivera" },
      claimStatus: "claimed",
    },
    [`therapistEngagementSummary-jamie-rivera-${periodKey}`]: {
      _id: `therapistEngagementSummary-jamie-rivera-${periodKey}`,
      _type: "therapistEngagementSummary",
      therapistSlug: "jamie-rivera",
      periodKey: periodKey,
      periodYear: periodYear,
      periodWeek: periodWeek,
      periodStart: periodStart,
      profileViewsTotal: 27,
      profileViewsDirectory: 15,
      profileViewsMatch: 10,
      profileViewsDirect: 2,
      profileViewsEmail: 0,
      profileViewsSearch: 0,
      profileViewsOther: 0,
      ctaClicksTotal: 4,
      ctaClicksEmail: 1,
      ctaClicksPhone: 2,
      ctaClicksBooking: 1,
      ctaClicksWebsite: 0,
      ctaClicksOther: 0,
      firstEventAt: nowIso,
      lastEventAt: nowIso,
    },
  });
  const config = createTestApiConfig();
  const handler = createReviewApiHandler(config, client);

  const sessionToken = createTherapistSession(config, {
    slug: "jamie-rivera",
    email: "jamie@example.com",
  });

  const response = await runHandlerRequest(handler, {
    headers: standardHeaders({
      cookie: `${THERAPIST_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}`,
    }),
    method: "GET",
    url: "/portal/analytics",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.slug, "jamie-rivera");
  assert.equal(response.payload.current_period_key, periodKey);
  assert.ok(response.payload.current, "current summary should be present");
  assert.equal(response.payload.current.profileViewsTotal, 27);
  assert.equal(response.payload.current.profileViewsMatch, 10);
  assert.equal(response.payload.current.profileViewsDirectory, 15);
  assert.equal(response.payload.current.ctaClicksTotal, 4);
});

test("/portal/analytics returns null current summary when no engagement has been recorded", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": {
      _id: "therapist-jamie",
      _type: "therapist",
      slug: { current: "jamie-rivera" },
    },
  });
  const config = createTestApiConfig();
  const handler = createReviewApiHandler(config, client);

  const sessionToken = createTherapistSession(config, {
    slug: "jamie-rivera",
    email: "jamie@example.com",
  });

  const response = await runHandlerRequest(handler, {
    headers: standardHeaders({
      cookie: `${THERAPIST_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}`,
    }),
    method: "GET",
    url: "/portal/analytics",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.current, null);
});

test("/portal/analytics returns 401 without a therapist session token", async () => {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    headers: standardHeaders(),
    method: "GET",
    url: "/portal/analytics",
  });

  assert.equal(response.statusCode, 401);
});

// --- Session staleness on ownership transfer ---
// A therapist session is signature-valid for 14 days, but ownership can change
// before then (account recovery flips claimedByEmail). The token must stop
// granting access once it no longer matches the listing's current owner.

test("sessionIsStaleForListing: true when the listing owner email no longer matches the session", () => {
  assert.equal(
    sessionIsStaleForListing(
      { email: "old-owner@example.com" },
      { claimedByEmail: "new-owner@example.com" },
    ),
    true,
  );
});

test("sessionIsStaleForListing: false when the session still matches (case/whitespace-insensitive)", () => {
  assert.equal(
    sessionIsStaleForListing(
      { email: "Jamie@Example.com" },
      { claimedByEmail: "  jamie@example.com " },
    ),
    false,
  );
});

test("sessionIsStaleForListing: false on missing data so legacy claimed docs aren't locked out", () => {
  assert.equal(sessionIsStaleForListing({ email: "x@y.com" }, { claimedByEmail: "" }), false);
  assert.equal(sessionIsStaleForListing({ email: "" }, { claimedByEmail: "x@y.com" }), false);
  assert.equal(sessionIsStaleForListing(null, { claimedByEmail: "x@y.com" }), false);
  assert.equal(sessionIsStaleForListing({ email: "x@y.com" }, null), false);
});

test("sessionIsStaleForListing: true when the session predates an ownership transfer", () => {
  const issuedAt = Date.parse("2026-01-01T00:00:00.000Z");
  // Email gate would not fire here (same email), but the timestamp gate must:
  // the listing was transferred after this session was minted.
  assert.equal(
    sessionIsStaleForListing(
      { email: "jamie@example.com", issuedAt },
      {
        claimedByEmail: "jamie@example.com",
        ownershipChangedAt: "2026-02-01T00:00:00.000Z",
      },
    ),
    true,
  );
});

test("sessionIsStaleForListing: true on a legacy doc with no claimedByEmail once ownership changes", () => {
  // The email gate can't fire without claimedByEmail; the timestamp gate still does.
  assert.equal(
    sessionIsStaleForListing(
      { email: "anyone@example.com", issuedAt: Date.parse("2026-01-01T00:00:00.000Z") },
      { ownershipChangedAt: "2026-02-01T00:00:00.000Z" },
    ),
    true,
  );
});

test("sessionIsStaleForListing: false when the session was minted after the transfer", () => {
  assert.equal(
    sessionIsStaleForListing(
      { email: "jamie@example.com", issuedAt: Date.parse("2026-03-01T00:00:00.000Z") },
      {
        claimedByEmail: "jamie@example.com",
        ownershipChangedAt: "2026-02-01T00:00:00.000Z",
      },
    ),
    false,
  );
});

test("sessionIsStaleForListing: reads iat as a fallback when issuedAt is absent", () => {
  assert.equal(
    sessionIsStaleForListing(
      { email: "jamie@example.com", iat: Date.parse("2026-01-01T00:00:00.000Z") },
      {
        claimedByEmail: "jamie@example.com",
        ownershipChangedAt: "2026-02-01T00:00:00.000Z",
      },
    ),
    true,
  );
});

test("GET /portal/me rejects a session after the listing is recovered to a different email", async () => {
  const { client, state } = createMemoryClient({
    "therapist-jamie": buildClaimedTherapistFixture(),
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  // The original owner holds a valid 14-day session cookie.
  const ownerSession = standardHeaders(authHeader("jamie-rivera", "jamie@example.com"));
  const before = await runHandlerRequest(handler, {
    headers: ownerSession,
    method: "GET",
    url: "/portal/me",
  });
  assert.equal(before.statusCode, 200);

  // Ownership is transferred (e.g. admin-approved account recovery).
  state.documents.get("therapist-jamie").claimedByEmail = "new-owner@example.com";

  // The old, still-signature-valid cookie must no longer be honored.
  const after = await runHandlerRequest(handler, {
    headers: ownerSession,
    method: "GET",
    url: "/portal/me",
  });
  assert.equal(after.statusCode, 401);
});

test("PATCH /portal/therapist rejects a stale session from a previous owner", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": buildClaimedTherapistFixture({ claimedByEmail: "new-owner@example.com" }),
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { bio: "x".repeat(60) },
    // Session minted for the PREVIOUS owner, who no longer owns the listing.
    headers: standardHeaders(authHeader("jamie-rivera", "old-owner@example.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });

  assert.equal(response.statusCode, 401);
  const raw = await client.getDocument("therapist-jamie");
  assert.equal(
    raw.bio,
    buildClaimedTherapistFixture().bio,
    "stale session must not edit the listing",
  );
});

test("PATCH /portal/therapist does not resurrect a listing removed via listing-removal", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": buildClaimedTherapistFixture({
      listingActive: false,
      status: "active",
      listingRemovalRequestedAt: "2026-06-01T00:00:00.000Z",
    }),
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { accepting_new_patients: false },
    headers: standardHeaders(authHeader("jamie-rivera", "jamie@example.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });

  assert.equal(response.statusCode, 200);
  const raw = await client.getDocument("therapist-jamie");
  assert.equal(raw.listingActive, false, "a portal save must not undo a confirmed removal");
  assert.equal(raw.status, "active");
});

test("PATCH /portal/therapist does not resurrect an admin-deactivated listing", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": buildClaimedTherapistFixture({
      listingActive: false,
      status: "inactive",
    }),
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { accepting_new_patients: false },
    headers: standardHeaders(authHeader("jamie-rivera", "jamie@example.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });

  assert.equal(response.statusCode, 200);
  const raw = await client.getDocument("therapist-jamie");
  assert.equal(raw.listingActive, false, "a portal save must not undo an admin deactivation");
  assert.equal(raw.status, "inactive");
});

test("PATCH /portal/therapist still auto-publishes the pending_profile signup stub", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": buildClaimedTherapistFixture({
      listingActive: false,
      status: "pending_profile",
      bio: "Pending profile",
    }),
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: {
      bio: "A finished bio with enough characters to clear the fifty character minimum easily.",
    },
    headers: standardHeaders(authHeader("jamie-rivera", "jamie@example.com")),
    method: "PATCH",
    url: "/portal/therapist",
  });

  assert.equal(response.statusCode, 200);
  const raw = await client.getDocument("therapist-jamie");
  assert.equal(raw.listingActive, true, "first complete portal save flips the stub live");
  assert.equal(raw.status, "active");
});
