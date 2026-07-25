import assert from "node:assert/strict";
import test from "node:test";

import { verifyAdminSession } from "../../api/_adminAuth.mjs";
import { createSignedSession } from "../../server/review-http-auth.mjs";

// api/_adminAuth.mjs guards the standalone outreach-CRM functions. It used to
// carry its own cookie parse + HMAC verify that read only
// REVIEW_API_SESSION_SECRET, so during a rotation overlap the review
// dispatcher still accepted a session signed with the previous secret while
// every api/admin/* endpoint rejected it — a half-broken admin UI instead of a
// clean re-login.

const CURRENT = "current-secret-aaaaaaaaaaaaaaaaaaaaaaaa";
const PREVIOUS = "previous-secret-bbbbbbbbbbbbbbbbbbbbbbb";

function requestWithSession(token) {
  return { headers: { cookie: `bt_admin_session=${encodeURIComponent(token)}` } };
}

function signWith(secret, overrides = {}) {
  return createSignedSession({ sessionSecret: secret, sessionTtlMs: 60 * 60 * 1000 }, overrides);
}

function withEnv(env, run) {
  const saved = {
    REVIEW_API_SESSION_SECRET: process.env.REVIEW_API_SESSION_SECRET,
    REVIEW_API_SESSION_SECRET_PREVIOUS: process.env.REVIEW_API_SESSION_SECRET_PREVIOUS,
  };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
  }
  try {
    run();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("accepts a session signed with the current secret", () => {
  const token = signWith(CURRENT);
  withEnv({ REVIEW_API_SESSION_SECRET: CURRENT }, () => {
    assert.equal(verifyAdminSession(requestWithSession(token)), true);
  });
});

test("accepts a session signed with a PREVIOUS secret during a rotation overlap", () => {
  const token = signWith(PREVIOUS);
  withEnv(
    {
      REVIEW_API_SESSION_SECRET: CURRENT,
      REVIEW_API_SESSION_SECRET_PREVIOUS: PREVIOUS,
    },
    () => {
      assert.equal(
        verifyAdminSession(requestWithSession(token)),
        true,
        "the review dispatcher accepts this session; these endpoints must agree",
      );
    },
  );
});

test("handles a comma-separated list of previous secrets", () => {
  const token = signWith(PREVIOUS);
  withEnv(
    {
      REVIEW_API_SESSION_SECRET: CURRENT,
      REVIEW_API_SESSION_SECRET_PREVIOUS: `older-secret-ccccccccccccc, ${PREVIOUS}`,
    },
    () => {
      assert.equal(verifyAdminSession(requestWithSession(token)), true);
    },
  );
});

test("rejects a session signed with a secret that is neither current nor listed", () => {
  const token = signWith("some-unrelated-secret-dddddddddddd");
  withEnv(
    {
      REVIEW_API_SESSION_SECRET: CURRENT,
      REVIEW_API_SESSION_SECRET_PREVIOUS: PREVIOUS,
    },
    () => {
      assert.equal(verifyAdminSession(requestWithSession(token)), false);
    },
  );
});

test("rejects an expired session even when correctly signed", () => {
  const token = signWith(CURRENT, { exp: Date.now() - 1000 });
  withEnv({ REVIEW_API_SESSION_SECRET: CURRENT }, () => {
    assert.equal(verifyAdminSession(requestWithSession(token)), false);
  });
});

test("rejects a therapist session presented to an admin endpoint", () => {
  const token = signWith(CURRENT, { sub: "therapist" });
  withEnv({ REVIEW_API_SESSION_SECRET: CURRENT }, () => {
    assert.equal(verifyAdminSession(requestWithSession(token)), false);
  });
});

test("fails closed with no cookie and with no secret configured", () => {
  withEnv({ REVIEW_API_SESSION_SECRET: CURRENT }, () => {
    assert.equal(verifyAdminSession({ headers: {} }), false);
    assert.equal(verifyAdminSession({ headers: { cookie: "bt_admin_session=garbage" } }), false);
  });
  const token = signWith(CURRENT);
  withEnv({ REVIEW_API_SESSION_SECRET: undefined }, () => {
    assert.equal(verifyAdminSession(requestWithSession(token)), false);
  });
});
