import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  verifyGitHubActionsToken,
  isAuthorizedGitHubActionsRequest,
  GITHUB_OIDC_ISSUER,
  GITHUB_OIDC_AUDIENCE,
  GITHUB_OIDC_ALLOWED_REPOSITORY,
  GITHUB_OIDC_ALLOWED_REF,
  _resetJwksCacheForTests,
} from "../../server/github-oidc.mjs";

// Build a real RS256-signed JWT with a locally generated keypair, and a
// fetch stub that serves the matching JWKS — exercising the actual
// signature path, not a mocked verifier.
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-key-1";

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const NOW_MS = 1_780_000_000_000; // fixed clock for determinism

function signToken(payloadOverrides = {}, headerOverrides = {}) {
  const header = { alg: "RS256", typ: "JWT", kid: KID, ...headerOverrides };
  const payload = {
    iss: GITHUB_OIDC_ISSUER,
    aud: GITHUB_OIDC_AUDIENCE,
    repository: GITHUB_OIDC_ALLOWED_REPOSITORY,
    ref: GITHUB_OIDC_ALLOWED_REF,
    exp: Math.floor(NOW_MS / 1000) + 300,
    iat: Math.floor(NOW_MS / 1000) - 30,
    ...payloadOverrides,
  };
  const signingInput = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(payload));
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return signingInput + "." + b64url(signature);
}

function jwksFetchStub() {
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };
  return async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
}

function verifyOpts(extra = {}) {
  _resetJwksCacheForTests();
  return { fetchImpl: jwksFetchStub(), nowMs: NOW_MS, ...extra };
}

test("verifies a correctly signed token pinned to this repo and main", async () => {
  const payload = await verifyGitHubActionsToken(signToken(), verifyOpts());
  assert.ok(payload);
  assert.equal(payload.repository, GITHUB_OIDC_ALLOWED_REPOSITORY);
});

test("rejects a token signed by a different key", async () => {
  const { privateKey: otherKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const header = { alg: "RS256", typ: "JWT", kid: KID };
  const payload = {
    iss: GITHUB_OIDC_ISSUER,
    aud: GITHUB_OIDC_AUDIENCE,
    repository: GITHUB_OIDC_ALLOWED_REPOSITORY,
    ref: GITHUB_OIDC_ALLOWED_REF,
    exp: Math.floor(NOW_MS / 1000) + 300,
  };
  const signingInput = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(payload));
  const forged =
    signingInput + "." + b64url(crypto.sign("RSA-SHA256", Buffer.from(signingInput), otherKey));
  assert.equal(await verifyGitHubActionsToken(forged, verifyOpts()), null);
});

test("rejects tampered payloads (signature no longer matches)", async () => {
  const token = signToken();
  const [h, p, s] = token.split(".");
  const tampered = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  tampered.repository = "attacker/repo";
  // Keep pinned claims valid-looking but change repository — then restore
  // the expected repo in options to prove the SIGNATURE is what fails.
  const forged = h + "." + b64url(JSON.stringify(tampered)) + "." + s;
  assert.equal(
    await verifyGitHubActionsToken(forged, verifyOpts({ repository: "attacker/repo" })),
    null,
  );
});

test("rejects wrong issuer, audience, repository, ref, and expiry", async () => {
  assert.equal(
    await verifyGitHubActionsToken(signToken({ iss: "https://evil.example" }), verifyOpts()),
    null,
  );
  assert.equal(
    await verifyGitHubActionsToken(signToken({ aud: "someone-elses-api" }), verifyOpts()),
    null,
  );
  assert.equal(
    await verifyGitHubActionsToken(signToken({ repository: "other/repo" }), verifyOpts()),
    null,
  );
  assert.equal(
    await verifyGitHubActionsToken(signToken({ ref: "refs/heads/feature" }), verifyOpts()),
    null,
  );
  assert.equal(
    await verifyGitHubActionsToken(
      signToken({ exp: Math.floor(NOW_MS / 1000) - 10 }),
      verifyOpts(),
    ),
    null,
  );
});

test("rejects unknown kid, non-RS256, and malformed tokens", async () => {
  assert.equal(
    await verifyGitHubActionsToken(signToken({}, { kid: "unknown" }), verifyOpts()),
    null,
  );
  assert.equal(await verifyGitHubActionsToken(signToken({}, { alg: "HS256" }), verifyOpts()), null);
  assert.equal(await verifyGitHubActionsToken("not.a.jwt", verifyOpts()), null);
  assert.equal(await verifyGitHubActionsToken("", verifyOpts()), null);
});

test("returns null (not a throw) when the JWKS fetch fails", async () => {
  _resetJwksCacheForTests();
  const result = await verifyGitHubActionsToken(signToken(), {
    fetchImpl: async () => ({ ok: false, status: 503 }),
    nowMs: NOW_MS,
  });
  assert.equal(result, null);
});

test("isAuthorizedGitHubActionsRequest reads the Bearer header", async () => {
  const good = { headers: { authorization: "Bearer " + signToken() } };
  assert.equal(await isAuthorizedGitHubActionsRequest(good, verifyOpts()), true);
  const bad = { headers: { authorization: "Bearer nope" } };
  assert.equal(await isAuthorizedGitHubActionsRequest(bad, verifyOpts()), false);
  assert.equal(await isAuthorizedGitHubActionsRequest({ headers: {} }, verifyOpts()), false);
});
