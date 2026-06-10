import assert from "node:assert/strict";
import test from "node:test";

import { createReviewApiHandler } from "../../server/review-handler.mjs";
import { THERAPIST_SESSION_COOKIE } from "../../server/review-http-auth.mjs";
import { createMemoryClient, readSetCookieHeader, runHandlerRequest } from "./test-helpers.mjs";

// Integration coverage for the listing-claim flow (server/review-claim-routes.mjs):
// claim-link issuance, magic-link token acceptance, replay protection, and the
// email-masking that keeps the open lookup endpoints from leaking addresses.
// This is the ownership path — a bug here hands a directory listing (and the
// subscription attached to it) to the wrong person — and it had no tests.

function claimTestConfig() {
  return {
    projectId: "test-project",
    dataset: "test-dataset",
    apiVersion: "2026-04-02",
    token: "",
    adminUsername: "architect",
    adminPassword: "secret-pass",
    sessionTtlMs: 60000,
    therapistSessionTtlMs: 60000,
    allowedOrigins: [],
    sessionSecret: "test-secret",
    loginWindowMs: 60000,
    loginMaxAttempts: 5,
    portalBaseUrl: "http://localhost:8787",
    resendApiKey: "re_test_key",
    emailFrom: "noreply@bipolartherapyhub.example",
    notificationTo: "founder@bipolartherapyhub.example",
  };
}

function unclaimedTherapist(overrides) {
  return {
    _id: "therapist-claim-target",
    _type: "therapist",
    name: "Dr. Morgan Lake",
    email: "morgan@example.com",
    city: "Fresno",
    state: "CA",
    credentials: "LMFT",
    licenseNumber: "LMFT77777",
    listingActive: true,
    claimStatus: "unclaimed",
    slug: { current: "dr-morgan-lake-fresno-ca" },
    ...(overrides || {}),
  };
}

// Wrap fetch to capture Resend sends; returns captured calls + restore().
function captureResendEmails() {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    let host = "";
    try {
      host = new URL(String(url)).host;
    } catch (_error) {
      /* relative/non-absolute URL — not the Resend endpoint */
    }
    if (host === "api.resend.com") {
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
  return { calls, restore: () => (globalThis.fetch = originalFetch) };
}

function extractClaimToken(emailHtml) {
  const match = /portal\?token=([^"&\s]+)/.exec(String(emailHtml || ""));
  return match ? decodeURIComponent(match[1]) : "";
}

const HOST_HEADERS = { host: "localhost:8787" };

test("claim lifecycle: claim-by-slug emails a magic link, claim-accept claims the doc and opens a session", async function () {
  const emails = captureResendEmails();
  try {
    const { client, state } = createMemoryClient({
      "therapist-claim-target": unclaimedTherapist(),
    });
    const handler = createReviewApiHandler(claimTestConfig(), client);

    const linkResponse = await runHandlerRequest(handler, {
      body: { slug: "dr-morgan-lake-fresno-ca" },
      headers: HOST_HEADERS,
      method: "POST",
      url: "/portal/claim-by-slug",
    });
    assert.equal(linkResponse.statusCode, 200);
    assert.equal(linkResponse.payload.verification_method, "email_on_file");
    // Response only carries the masked hint, never the raw address.
    assert.equal(linkResponse.payload.email_hint, "m***@e***.com");
    assert.ok(!JSON.stringify(linkResponse.payload).includes("morgan@example.com"));

    // The doc is flagged claim_requested and the rate-limit history advances.
    const afterLink = state.documents.get("therapist-claim-target");
    assert.equal(afterLink.claimStatus, "claim_requested");
    assert.equal(afterLink.claimLinkRequests.length, 1);

    const claimEmail = emails.calls.find(
      (call) => Array.isArray(call.to) && call.to.includes("morgan@example.com"),
    );
    assert.ok(claimEmail, "claim link email should go to the on-file address");
    const token = extractClaimToken(claimEmail.html);
    assert.ok(token, "claim email must contain a portal magic-link token");

    // The magic link hydrates the portal (claim-session) without claiming.
    const sessionResponse = await runHandlerRequest(handler, {
      body: { token },
      headers: HOST_HEADERS,
      method: "POST",
      url: "/portal/claim-session",
    });
    assert.equal(sessionResponse.statusCode, 200);
    assert.equal(sessionResponse.payload.therapist.name, "Dr. Morgan Lake");
    assert.equal(state.documents.get("therapist-claim-target").claimStatus, "claim_requested");

    // Accepting the claim flips the doc and sets a therapist session cookie.
    const acceptResponse = await runHandlerRequest(handler, {
      body: { token },
      headers: HOST_HEADERS,
      method: "POST",
      url: "/portal/claim-accept",
    });
    assert.equal(acceptResponse.statusCode, 200);
    assert.equal(acceptResponse.payload.claimed_by_email, "morgan@example.com");
    assert.ok(readSetCookieHeader(acceptResponse, THERAPIST_SESSION_COOKIE));

    const claimed = state.documents.get("therapist-claim-target");
    assert.equal(claimed.claimStatus, "claimed");
    assert.equal(claimed.claimedByEmail, "morgan@example.com");
    assert.ok(claimed.claimedAt);
    assert.equal(claimed.usedClaimTokenNonces.length, 1, "token nonce must be recorded as used");

    // unclaimed → claimed fires the welcome email and the founder alert.
    const welcome = emails.calls.find(
      (call) =>
        Array.isArray(call.to) &&
        call.to.includes("morgan@example.com") &&
        /welcome/i.test(String(call.subject || "")),
    );
    assert.ok(welcome, "welcome email should fire on the unclaimed → claimed transition");
    const founderAlert = emails.calls.find((call) => /\[CLAIM\]/.test(String(call.subject || "")));
    assert.ok(founderAlert, "founder alert should fire on a new claim");
  } finally {
    emails.restore();
  }
});

test("claim-accept: re-clicking the same link after claiming is a legitimate re-entry, not a dead-end", async function () {
  const emails = captureResendEmails();
  try {
    const { client, state } = createMemoryClient({
      "therapist-claim-target": unclaimedTherapist(),
    });
    const handler = createReviewApiHandler(claimTestConfig(), client);

    await runHandlerRequest(handler, {
      body: { slug: "dr-morgan-lake-fresno-ca" },
      headers: HOST_HEADERS,
      method: "POST",
      url: "/portal/claim-by-slug",
    });
    const token = extractClaimToken(emails.calls[0] && emails.calls[0].html);
    const first = await runHandlerRequest(handler, {
      body: { token },
      headers: HOST_HEADERS,
      method: "POST",
      url: "/portal/claim-accept",
    });
    assert.equal(first.statusCode, 200);
    const emailCountAfterFirstAccept = emails.calls.length;

    const second = await runHandlerRequest(handler, {
      body: { token },
      headers: HOST_HEADERS,
      method: "POST",
      url: "/portal/claim-accept",
    });
    assert.equal(second.statusCode, 200, "same-email re-entry must issue a fresh session");
    assert.ok(readSetCookieHeader(second, THERAPIST_SESSION_COOKIE));
    // But the onboarding side-effects must not refire.
    assert.equal(
      emails.calls.length,
      emailCountAfterFirstAccept,
      "welcome email and founder alert fire only on the first claim",
    );
    assert.equal(state.documents.get("therapist-claim-target").claimStatus, "claimed");
  } finally {
    emails.restore();
  }
});

test("claim-accept: a consumed token is rejected once the profile belongs to a different email", async function () {
  const emails = captureResendEmails();
  try {
    const { client, state } = createMemoryClient({
      "therapist-claim-target": unclaimedTherapist(),
    });
    const handler = createReviewApiHandler(claimTestConfig(), client);

    await runHandlerRequest(handler, {
      body: { slug: "dr-morgan-lake-fresno-ca" },
      headers: HOST_HEADERS,
      method: "POST",
      url: "/portal/claim-by-slug",
    });
    const token = extractClaimToken(emails.calls[0] && emails.calls[0].html);
    const first = await runHandlerRequest(handler, {
      body: { token },
      headers: HOST_HEADERS,
      method: "POST",
      url: "/portal/claim-accept",
    });
    assert.equal(first.statusCode, 200);

    // Ownership later moves to a different inbox (e.g. an admin-approved
    // recovery). Replaying the old consumed token must NOT re-take the
    // profile or mint a session for the previous email.
    const doc = state.documents.get("therapist-claim-target");
    doc.claimedByEmail = "newowner@example.com";

    const replay = await runHandlerRequest(handler, {
      body: { token },
      headers: HOST_HEADERS,
      method: "POST",
      url: "/portal/claim-accept",
    });
    assert.equal(replay.statusCode, 401);
    assert.equal(replay.payload.reason, "token_already_used");
    assert.equal(
      state.documents.get("therapist-claim-target").claimedByEmail,
      "newowner@example.com",
      "replay must not steal the claim back",
    );
  } finally {
    emails.restore();
  }
});

test("claim-session and claim-accept reject garbage and unsigned tokens", async function () {
  const { client } = createMemoryClient({
    "therapist-claim-target": unclaimedTherapist(),
  });
  const handler = createReviewApiHandler(claimTestConfig(), client);

  for (const url of ["/portal/claim-session", "/portal/claim-accept"]) {
    const response = await runHandlerRequest(handler, {
      body: { token: "not-a-real-token" },
      headers: HOST_HEADERS,
      method: "POST",
      url,
    });
    assert.equal(response.statusCode, 401, `${url} must reject an unsigned token`);
  }
});

test("claim-by-slug: profile without any email on file returns 409 instead of pretending to send", async function () {
  const { client } = createMemoryClient({
    "therapist-claim-target": unclaimedTherapist({ email: "" }),
  });
  const handler = createReviewApiHandler(claimTestConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { slug: "dr-morgan-lake-fresno-ca" },
    headers: HOST_HEADERS,
    method: "POST",
    url: "/portal/claim-by-slug",
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload.reason, "no_email_on_file");
});

test("claim-by-slug: fourth link request inside an hour is rate-limited", async function () {
  const now = Date.now();
  const recent = [1, 2, 3].map((minutes) => new Date(now - minutes * 60 * 1000).toISOString());
  const { client } = createMemoryClient({
    "therapist-claim-target": unclaimedTherapist({ claimLinkRequests: recent }),
  });
  const handler = createReviewApiHandler(claimTestConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { slug: "dr-morgan-lake-fresno-ca" },
    headers: HOST_HEADERS,
    method: "POST",
    url: "/portal/claim-by-slug",
  });
  assert.equal(response.statusCode, 429);
  assert.equal(response.payload.reason, "rate_limited");
});

test("claim-by-slug on an already-claimed profile sends a sign-in link to the claiming inbox, not the public email", async function () {
  const emails = captureResendEmails();
  try {
    const { client } = createMemoryClient({
      "therapist-claim-target": unclaimedTherapist({
        claimStatus: "claimed",
        claimedByEmail: "private-inbox@example.com",
        email: "frontdesk@example.com",
      }),
    });
    const handler = createReviewApiHandler(claimTestConfig(), client);

    const response = await runHandlerRequest(handler, {
      body: { slug: "dr-morgan-lake-fresno-ca" },
      headers: HOST_HEADERS,
      method: "POST",
      url: "/portal/claim-by-slug",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.email_hint, "p***@e***.com");

    const sent = emails.calls.find((call) => Array.isArray(call.to));
    assert.ok(sent);
    assert.deepEqual(sent.to, ["private-inbox@example.com"]);
    assert.ok(
      !emails.calls.some(
        (call) => Array.isArray(call.to) && call.to.includes("frontdesk@example.com"),
      ),
      "the public contact email must not receive the sign-in link",
    );
  } finally {
    emails.restore();
  }
});

test("quick-claim lookup masks the on-file email and never leaks the raw address", async function () {
  const { client } = createMemoryClient({
    "therapist-claim-target": unclaimedTherapist(),
  });
  const handler = createReviewApiHandler(claimTestConfig(), client);

  const response = await runHandlerRequest(handler, {
    headers: HOST_HEADERS,
    method: "GET",
    url: "/portal/quick-claim/lookup?slug=dr-morgan-lake-fresno-ca",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.result.email_hint, "m***@e***.com");
  assert.equal(response.payload.result.has_email, true);
  assert.ok(!String(response.rawBody).includes("morgan@example.com"));
});

// --- Cross-state license-number collisions (multi-state Phase 0) ---
// Two states can issue the same license digits. The quick-claim lookup is
// scoped to one state's namespace (defaulting to CA while the form has no
// state field), so a future NY therapist with the same digits can never be
// resolved — and claimed — in place of the CA one.

test("quick-claim resolves the CA therapist, not a different-state therapist with the same digits", async function () {
  const emails = captureResendEmails();
  try {
    const { client } = createMemoryClient({
      "therapist-ny-collider": {
        _id: "therapist-ny-collider",
        _type: "therapist",
        name: "Dr. Morgan Lake", // same name, same digits, different state
        email: "ny-morgan@example.com",
        city: "Albany",
        state: "NY",
        licenseState: "NY",
        licenseNumber: "LMFT77777",
        listingActive: true,
        claimStatus: "unclaimed",
        slug: { current: "dr-morgan-lake-albany-ny" },
      },
      "therapist-claim-target": unclaimedTherapist({ licenseState: "CA" }),
    });
    const handler = createReviewApiHandler(claimTestConfig(), client);

    const response = await runHandlerRequest(handler, {
      body: {
        full_name: "Dr. Morgan Lake",
        email: "morgan@example.com",
        license_number: "77777",
        // no license_state → defaults to CA
      },
      headers: HOST_HEADERS,
      method: "POST",
      url: "/portal/quick-claim",
    });

    assert.equal(response.statusCode, 200);
    // The claim link must go to the CA profile's on-file email, never the
    // NY collider's.
    const sent = emails.calls.find((call) => Array.isArray(call.to));
    assert.ok(sent, "a claim link should be sent");
    assert.deepEqual(sent.to, ["morgan@example.com"]);
    assert.ok(
      !emails.calls.some(
        (call) => Array.isArray(call.to) && call.to.includes("ny-morgan@example.com"),
      ),
      "the NY therapist with colliding digits must not receive the claim link",
    );
  } finally {
    emails.restore();
  }
});

test("quick-claim with an explicit license_state scopes to that state's namespace", async function () {
  const emails = captureResendEmails();
  try {
    const { client } = createMemoryClient({
      "therapist-ny-collider": {
        _id: "therapist-ny-collider",
        _type: "therapist",
        name: "Dr. Morgan Lake",
        email: "ny-morgan@example.com",
        city: "Albany",
        state: "NY",
        licenseState: "NY",
        licenseNumber: "LMFT77777",
        listingActive: true,
        claimStatus: "unclaimed",
        slug: { current: "dr-morgan-lake-albany-ny" },
      },
      "therapist-claim-target": unclaimedTherapist({ licenseState: "CA" }),
    });
    const handler = createReviewApiHandler(claimTestConfig(), client);

    const response = await runHandlerRequest(handler, {
      body: {
        full_name: "Dr. Morgan Lake",
        email: "ny-morgan@example.com",
        license_number: "77777",
        license_state: "NY",
      },
      headers: HOST_HEADERS,
      method: "POST",
      url: "/portal/quick-claim",
    });

    assert.equal(response.statusCode, 200);
    const sent = emails.calls.find((call) => Array.isArray(call.to));
    assert.ok(sent, "a claim link should be sent");
    assert.deepEqual(sent.to, ["ny-morgan@example.com"], "NY scope must resolve the NY profile");
  } finally {
    emails.restore();
  }
});

test("quick-claim still resolves legacy docs that predate the licenseState field", async function () {
  const emails = captureResendEmails();
  try {
    const legacy = unclaimedTherapist();
    delete legacy.licenseState; // pre-backfill doc: no licenseState at all
    const { client } = createMemoryClient({ "therapist-claim-target": legacy });
    const handler = createReviewApiHandler(claimTestConfig(), client);

    const response = await runHandlerRequest(handler, {
      body: {
        full_name: "Dr. Morgan Lake",
        email: "morgan@example.com",
        license_number: "77777",
      },
      headers: HOST_HEADERS,
      method: "POST",
      url: "/portal/quick-claim",
    });

    assert.equal(response.statusCode, 200);
    const sent = emails.calls.find((call) => Array.isArray(call.to));
    assert.ok(sent, "legacy docs without licenseState must remain claimable");
  } finally {
    emails.restore();
  }
});
