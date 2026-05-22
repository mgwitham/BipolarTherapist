import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  ADMIN_SESSION_COOKIE,
  THERAPIST_SESSION_COOKIE,
  buildExpiredSessionCookie,
  buildSessionCookie,
  canAttemptLogin,
  canAttemptIntake,
  canAttemptPortalAuth,
  clearFailedLogins,
  createSignedPayload,
  createSignedSession,
  createTherapistSession,
  getAuthorizedActor,
  getAuthorizedTherapist,
  getClientAddress,
  isAuthorized,
  readAdminSessionFromRequest,
  readSignedPayload,
  readSignedSession,
  readTherapistSession,
  recordFailedLogin,
  recordIntakeAttempt,
  recordPortalAuthAttempt,
  refreshTherapistSessionIfStale,
} from "../../server/review-http-auth.mjs";
import { createTestApiConfig } from "./test-helpers.mjs";

// ─── Admin session lifecycle ──────────────────────────────────────────────────

test("admin session: token round-trips sub and exp", () => {
  const config = createTestApiConfig();
  const token = createSignedSession(config, { username: "architect" });
  const payload = readSignedSession(token, config);
  assert.ok(payload, "expected valid payload");
  assert.equal(payload.sub, "admin");
  assert.ok(payload.exp > Date.now(), "expected non-expired token");
  assert.ok(payload.nonce, "expected nonce");
});

test("admin session: expired token is rejected", () => {
  const config = { ...createTestApiConfig(), sessionTtlMs: -1000 };
  const token = createSignedSession(config, {});
  assert.equal(readSignedSession(token, config), null);
});

test("admin session: wrong secret is rejected", () => {
  const config = createTestApiConfig();
  const token = createSignedSession(config, {});
  const wrongConfig = { ...config, sessionSecret: "different-secret-entirely" };
  assert.equal(readSignedSession(token, wrongConfig), null);
});

test("admin session: therapist token is rejected as admin session", () => {
  const config = createTestApiConfig();
  const token = createTherapistSession(config, { slug: "jamie", email: "j@j.com" });
  assert.equal(
    readSignedSession(token, config),
    null,
    "therapist sub should not validate as admin",
  );
});

// ─── Tampered token rejection ──────────────────────────────────────────────────

test("signed payload: tampered payload is rejected", () => {
  const config = createTestApiConfig();
  const token = createSignedPayload({ sub: "admin", role: "viewer" }, config.sessionSecret);
  const parts = token.split(".");
  // Flip a character in the signature
  const badSig = parts[1].slice(0, -1) + (parts[1].endsWith("a") ? "b" : "a");
  const tampered = `${parts[0]}.${badSig}`;
  assert.equal(readSignedPayload(tampered, config.sessionSecret), null);
});

test("signed payload: modified payload (different claims) is rejected", () => {
  const secret = "test-secret";
  const token = createSignedPayload({ sub: "admin", role: "viewer" }, secret);
  const parts = token.split(".");
  // Re-encode a different payload but keep the original signature
  const fakePayload = Buffer.from(JSON.stringify({ sub: "admin", role: "superuser" })).toString(
    "base64url",
  );
  const tampered = `${fakePayload}.${parts[1]}`;
  assert.equal(readSignedPayload(tampered, secret), null);
});

test("signed payload: wrong number of parts is rejected", () => {
  const secret = "test-secret";
  assert.equal(readSignedPayload("onlyone", secret), null);
  assert.equal(readSignedPayload("a.b.c", secret), null);
  assert.equal(readSignedPayload("", secret), null);
  assert.equal(readSignedPayload(null, secret), null);
});

test("signed payload: invalid base64 payload is rejected gracefully", () => {
  const secret = "test-secret";
  const badToken = "!!!not-base64!!!.validenough";
  assert.equal(readSignedPayload(badToken, secret), null);
});

// ─── Cookie reading ────────────────────────────────────────────────────────────

test("readAdminSessionFromRequest: reads valid admin token from cookie", () => {
  const config = createTestApiConfig();
  const token = createSignedSession(config, { username: "architect" });
  const request = {
    headers: { cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}` },
    socket: { remoteAddress: "127.0.0.1" },
  };
  const payload = readAdminSessionFromRequest(request, config);
  assert.ok(payload, "expected valid session from cookie");
  assert.equal(payload.sub, "admin");
});

test("readAdminSessionFromRequest: missing cookie returns null", () => {
  const config = createTestApiConfig();
  const request = { headers: {}, socket: { remoteAddress: "127.0.0.1" } };
  assert.equal(readAdminSessionFromRequest(request, config), null);
});

test("readAdminSessionFromRequest: therapist cookie is not accepted for admin", () => {
  const config = createTestApiConfig();
  const therapistToken = createTherapistSession(config, { slug: "jamie", email: "j@j.com" });
  const request = {
    headers: { cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(therapistToken)}` },
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.equal(readAdminSessionFromRequest(request, config), null);
});

test("isAuthorized: returns true with valid admin cookie", () => {
  const config = createTestApiConfig();
  const token = createSignedSession(config, {});
  const request = {
    headers: { cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}` },
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.equal(isAuthorized(request, config), true);
});

test("isAuthorized: returns false with no cookie", () => {
  const config = createTestApiConfig();
  const request = { headers: {}, socket: { remoteAddress: "127.0.0.1" } };
  assert.equal(isAuthorized(request, config), false);
});

test("getAuthorizedActor: returns username from session claims", () => {
  const config = createTestApiConfig();
  const token = createSignedSession(config, { username: "architect" });
  const request = {
    headers: { cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}` },
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.equal(getAuthorizedActor(request, config), "architect");
});

test("getAuthorizedActor: returns empty string when not authorized", () => {
  const config = createTestApiConfig();
  const request = { headers: {}, socket: { remoteAddress: "127.0.0.1" } };
  assert.equal(getAuthorizedActor(request, config), "");
});

// ─── Therapist session ─────────────────────────────────────────────────────────

test("therapist session: reads from correct cookie name", () => {
  const config = createTestApiConfig();
  const token = createTherapistSession(config, { slug: "jamie-rivera", email: "j@j.com" });
  const request = {
    headers: { cookie: `${THERAPIST_SESSION_COOKIE}=${encodeURIComponent(token)}` },
    socket: { remoteAddress: "127.0.0.1" },
  };
  const result = getAuthorizedTherapist(request, config);
  assert.ok(result);
  assert.equal(result.slug, "jamie-rivera");
  assert.equal(result.email, "j@j.com");
});

test("therapist session: admin cookie is not read from therapist cookie name", () => {
  const config = createTestApiConfig();
  const adminToken = createSignedSession(config, {});
  const request = {
    // Token is in the therapist cookie slot, but it has sub=admin
    headers: { cookie: `${THERAPIST_SESSION_COOKIE}=${encodeURIComponent(adminToken)}` },
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.equal(getAuthorizedTherapist(request, config), null);
});

// ─── Session cookie attributes ────────────────────────────────────────────────

test("buildSessionCookie: sets HttpOnly and SameSite=Lax", () => {
  const request = {
    headers: { host: "localhost:8787" },
    socket: { remoteAddress: "127.0.0.1" },
  };
  const cookie = buildSessionCookie(request, ADMIN_SESSION_COOKIE, "token-value", 3600);
  assert.ok(cookie.includes("HttpOnly"), "expected HttpOnly");
  assert.ok(cookie.includes("SameSite=Lax"), "expected SameSite=Lax");
  assert.ok(cookie.includes("Max-Age=3600"), "expected Max-Age");
  assert.ok(!cookie.includes("Secure"), "localhost should not set Secure");
});

test("buildSessionCookie: adds Secure flag for non-localhost request", () => {
  const request = {
    headers: { "x-forwarded-proto": "https", host: "www.bipolartherapyhub.com" },
    socket: { remoteAddress: "1.2.3.4" },
  };
  const cookie = buildSessionCookie(request, ADMIN_SESSION_COOKIE, "token-value", 3600);
  assert.ok(cookie.includes("Secure"), "expected Secure on https request");
});

test("buildExpiredSessionCookie: sets Max-Age=0", () => {
  const request = {
    headers: { host: "localhost:8787" },
    socket: { remoteAddress: "127.0.0.1" },
  };
  const cookie = buildExpiredSessionCookie(request, ADMIN_SESSION_COOKIE);
  assert.ok(cookie.includes("Max-Age=0"), "expected Max-Age=0 for logout cookie");
});

// ─── Client IP resolution (anti-spoofing) ─────────────────────────────────────

test("getClientAddress: platform-trusted header beats a spoofed x-forwarded-for", () => {
  const request = {
    headers: {
      "x-forwarded-for": "1.2.3.4",
      "x-real-ip": "203.0.113.9",
    },
    socket: { remoteAddress: "10.0.0.1" },
  };
  // An attacker controls x-forwarded-for, but Vercel sets x-real-ip; the
  // trusted header must win so rate limits can't be bypassed.
  assert.equal(getClientAddress(request), "203.0.113.9");
});

test("getClientAddress: x-vercel-forwarded-for is preferred over x-real-ip and xff", () => {
  const request = {
    headers: {
      "x-forwarded-for": "1.2.3.4",
      "x-real-ip": "5.6.7.8",
      "x-vercel-forwarded-for": "203.0.113.10",
    },
  };
  assert.equal(getClientAddress(request), "203.0.113.10");
});

test("getClientAddress: falls back to x-forwarded-for when no trusted header (local/non-Vercel)", () => {
  const request = {
    headers: { "x-forwarded-for": "198.51.100.7, 70.0.0.1" },
    socket: { remoteAddress: "10.0.0.1" },
  };
  assert.equal(getClientAddress(request), "198.51.100.7");
});

test("getClientAddress: falls back to socket address, then 'unknown'", () => {
  assert.equal(
    getClientAddress({ headers: {}, socket: { remoteAddress: "10.0.0.2" } }),
    "10.0.0.2",
  );
  assert.equal(getClientAddress({ headers: {} }), "unknown");
});

// ─── Admin login brute-force protection ───────────────────────────────────────

test("canAttemptLogin: allows attempts below threshold", async () => {
  const config = { ...createTestApiConfig(), loginMaxAttempts: 3, loginWindowMs: 60_000 };
  const request = {
    headers: { "x-forwarded-for": "10.0.0.1" },
    socket: { remoteAddress: "10.0.0.1" },
  };
  // Fresh IP — should be allowed
  assert.equal(await canAttemptLogin(request, config), true);
});

test("canAttemptLogin: blocks after max failed attempts", async () => {
  const config = { ...createTestApiConfig(), loginMaxAttempts: 3, loginWindowMs: 60_000 };
  const request = {
    headers: { "x-forwarded-for": "10.0.0.2" },
    socket: { remoteAddress: "10.0.0.2" },
  };
  await recordFailedLogin(request, config);
  await recordFailedLogin(request, config);
  await recordFailedLogin(request, config);
  assert.equal(await canAttemptLogin(request, config), false);
});

test("clearFailedLogins: resets attempt count for IP", async () => {
  const config = { ...createTestApiConfig(), loginMaxAttempts: 2, loginWindowMs: 60_000 };
  const request = {
    headers: { "x-forwarded-for": "10.0.0.3" },
    socket: { remoteAddress: "10.0.0.3" },
  };
  await recordFailedLogin(request, config);
  await recordFailedLogin(request, config);
  assert.equal(await canAttemptLogin(request, config), false, "should be blocked");
  await clearFailedLogins(request, config);
  assert.equal(await canAttemptLogin(request, config), true, "should be unblocked after clear");
});

test("canAttemptLogin: different IPs have independent counters", async () => {
  const config = { ...createTestApiConfig(), loginMaxAttempts: 2, loginWindowMs: 60_000 };
  const requestA = {
    headers: { "x-forwarded-for": "10.1.0.1" },
    socket: { remoteAddress: "10.1.0.1" },
  };
  const requestB = {
    headers: { "x-forwarded-for": "10.1.0.2" },
    socket: { remoteAddress: "10.1.0.2" },
  };
  await recordFailedLogin(requestA, config);
  await recordFailedLogin(requestA, config);
  assert.equal(await canAttemptLogin(requestA, config), false, "A should be blocked");
  assert.equal(await canAttemptLogin(requestB, config), true, "B should be unaffected");
});

// ─── Intake rate limiting ──────────────────────────────────────────────────────

test("canAttemptIntake: allows fresh IP", async () => {
  const request = {
    headers: { "x-forwarded-for": "20.0.0.1" },
    socket: { remoteAddress: "20.0.0.1" },
  };
  assert.equal(await canAttemptIntake(request, {}), true);
});

test("canAttemptIntake: blocks after 5 attempts", async () => {
  const request = {
    headers: { "x-forwarded-for": "20.0.0.2" },
    socket: { remoteAddress: "20.0.0.2" },
  };
  for (let i = 0; i < 5; i++) await recordIntakeAttempt(request, {});
  assert.equal(await canAttemptIntake(request, {}), false);
});

// ─── Portal auth rate limiting ────────────────────────────────────────────────

test("canAttemptPortalAuth: allows fresh IP", async () => {
  const request = {
    headers: { "x-forwarded-for": "30.0.0.1" },
    socket: { remoteAddress: "30.0.0.1" },
  };
  assert.equal(await canAttemptPortalAuth(request, {}), true);
});

test("canAttemptPortalAuth: blocks after 10 attempts", async () => {
  const request = {
    headers: { "x-forwarded-for": "30.0.0.2" },
    socket: { remoteAddress: "30.0.0.2" },
  };
  for (let i = 0; i < 10; i++) await recordPortalAuthAttempt(request, {});
  assert.equal(await canAttemptPortalAuth(request, {}), false);
});

// ─── Session rotation ─────────────────────────────────────────────────────────

test("refreshTherapistSessionIfStale: no-ops when no session cookie present", () => {
  const config = createTestApiConfig();
  const request = { headers: {}, socket: { remoteAddress: "127.0.0.1" } };
  const setCookieCalls = [];
  const response = { setHeader: (name, value) => setCookieCalls.push({ name, value }) };
  refreshTherapistSessionIfStale(request, response, config);
  assert.equal(
    setCookieCalls.length,
    0,
    "no Set-Cookie should be emitted for unauthenticated request",
  );
});

test("refreshTherapistSessionIfStale: no-ops when token is fresh (< 1h old)", () => {
  const config = createTestApiConfig();
  const token = createTherapistSession(config, { slug: "jamie", email: "j@j.com" });
  const request = {
    headers: { cookie: `${THERAPIST_SESSION_COOKIE}=${encodeURIComponent(token)}` },
    socket: { remoteAddress: "127.0.0.1" },
  };
  const setCookieCalls = [];
  const response = { setHeader: (name, value) => setCookieCalls.push({ name, value }) };
  refreshTherapistSessionIfStale(request, response, config);
  assert.equal(setCookieCalls.length, 0, "fresh token should not trigger rotation");
});

test("refreshTherapistSessionIfStale: rotates when token iat is > 1h ago", () => {
  const config = { ...createTestApiConfig(), therapistSessionTtlMs: 14 * 24 * 60 * 60 * 1000 };
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  const stalePayload = {
    sub: "therapist",
    iat: twoHoursAgo,
    exp: twoHoursAgo + 14 * 24 * 60 * 60 * 1000,
    nonce: crypto.randomBytes(12).toString("hex"),
    slug: "jamie-stale",
    email: "stale@example.com",
  };
  // createSignedPayload is the same signing path used by createTherapistSession
  const staleToken = createSignedPayload(stalePayload, config.sessionSecret);

  const request = {
    headers: { cookie: `${THERAPIST_SESSION_COOKIE}=${encodeURIComponent(staleToken)}` },
    socket: { remoteAddress: "127.0.0.1" },
  };
  const setCookieCalls = [];
  const response = { setHeader: (name, value) => setCookieCalls.push({ name, value }) };
  refreshTherapistSessionIfStale(request, response, config);
  assert.equal(setCookieCalls.length, 1, "stale token should trigger rotation");
  assert.equal(setCookieCalls[0].name, "Set-Cookie");
  assert.ok(
    setCookieCalls[0].value.includes(THERAPIST_SESSION_COOKIE),
    "new cookie should use correct name",
  );
});
