import assert from "node:assert/strict";
import test from "node:test";

import {
  createSignedSession,
  createTherapistSession,
  readSignedSession,
  readTherapistSession,
  sessionVerificationSecrets,
} from "../../server/review-http-auth.mjs";

const OLD = "old-secret-old-secret-old-secret-0123456789";
const NEW = "new-secret-new-secret-new-secret-0123456789";

test("sessionVerificationSecrets: current first, then previous, deduped/filtered", () => {
  assert.deepEqual(
    sessionVerificationSecrets({ sessionSecret: NEW, sessionSecretsPrevious: [OLD, ""] }),
    [NEW, OLD],
  );
  assert.deepEqual(sessionVerificationSecrets({ sessionSecret: NEW }), [NEW]);
});

test("admin session signed with the old secret still verifies after rotation", () => {
  const oldConfig = { sessionSecret: OLD, sessionTtlMs: 60000 };
  const token = createSignedSession(oldConfig, {});

  // After rotation: new current secret, old kept as previous.
  const rotated = { sessionSecret: NEW, sessionSecretsPrevious: [OLD], sessionTtlMs: 60000 };
  assert.ok(readSignedSession(token, rotated), "old token should still verify during overlap");

  // Once the previous secret is dropped, the old token no longer verifies.
  const finalized = { sessionSecret: NEW, sessionSecretsPrevious: [], sessionTtlMs: 60000 };
  assert.equal(readSignedSession(token, finalized), null);
});

test("therapist session: new secret signs, old secret still accepted during overlap", () => {
  const rotated = {
    sessionSecret: NEW,
    sessionSecretsPrevious: [OLD],
    therapistSessionTtlMs: 60000,
  };
  // Signing uses the CURRENT secret; verifies under the rotated config...
  const token = createTherapistSession(rotated, { slug: "jane-doe" });
  assert.equal(readTherapistSession(token, rotated).slug, "jane-doe");
  // ...and also verifies under a config where NEW has become "previous".
  const nextRotation = {
    sessionSecret: "third-secret-third-secret-third-secret-01",
    sessionSecretsPrevious: [NEW],
    therapistSessionTtlMs: 60000,
  };
  assert.equal(readTherapistSession(token, nextRotation).slug, "jane-doe");
});

test("a token signed with an unrelated secret never verifies", () => {
  const stranger = {
    sessionSecret: "attacker-secret-attacker-secret-attacker-1",
    sessionTtlMs: 60000,
  };
  const forged = createSignedSession(stranger, {});
  const real = { sessionSecret: NEW, sessionSecretsPrevious: [OLD], sessionTtlMs: 60000 };
  assert.equal(readSignedSession(forged, real), null);
});
