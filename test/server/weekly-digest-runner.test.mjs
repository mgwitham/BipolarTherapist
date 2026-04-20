import assert from "node:assert/strict";
import test from "node:test";

import { deriveDigestWindow, runWeeklyDigest } from "../../server/review-weekly-digest.mjs";

function makeStubClient(initial) {
  const recipients = initial && initial.recipients ? initial.recipients.slice() : [];
  const patches = [];
  return {
    fetch: async (_query, _params) => recipients,
    patch(id) {
      const state = { id, set: null };
      return {
        set(fields) {
          state.set = fields;
          return this;
        },
        async commit() {
          patches.push(state);
          return { id };
        },
      };
    },
    _patches: patches,
  };
}

test("deriveDigestWindow returns the ISO week prior to the given date", () => {
  const window = deriveDigestWindow("2026-04-20T09:00:00.000Z");
  assert.match(window.targetKey, /^\d{4}-W\d{2}$/);
  // Running Monday 2026-04-20 should target the week that closed Sunday
  // 2026-04-19, which is ISO week 16 (Apr 13-19).
  assert.equal(window.targetKey, "2026-W16");
  // Prior week = 2026-W15 (Apr 6-12).
  assert.equal(window.priorKey, "2026-W15");
});

test("runWeeklyDigest: sends to a paid therapist with activity, patches lastWeeklyDigestSentAt", async () => {
  const sentEmails = [];
  const client = makeStubClient({
    recipients: [
      {
        therapistSlug: "paid-one",
        therapist: {
          _id: "therapist-paid-one",
          name: "Dr. Paid One",
          email: "paid@example.com",
          slug: "paid-one",
          listingActive: true,
          lastWeeklyDigestSentAt: "",
        },
        current: { profileViewsTotal: 10, ctaClicksTotal: 1, profileViewsMatch: 7 },
        previous: { profileViewsTotal: 5, ctaClicksTotal: 0 },
      },
    ],
  });

  const config = {
    resendApiKey: "rk_test",
    emailFrom: "hello@bipolartherapyhub.com",
    notificationTo: "ops@bipolartherapyhub.com",
  };

  // Monkey-patch fetch so sendEmail's Resend call resolves without network.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function (url, init) {
    sentEmails.push({ url, init });
    return {
      ok: true,
      json: async () => ({ id: "email-1" }),
    };
  };

  try {
    const summary = await runWeeklyDigest({
      client,
      config,
      nowIso: "2026-04-20T09:00:00.000Z",
      portalBaseUrl: "https://www.bipolartherapyhub.com",
    });
    assert.equal(summary.sent, 1);
    assert.equal(summary.skipped_no_activity, 0);
    assert.equal(summary.send_errors, 0);
    assert.equal(sentEmails.length, 1);
    const body = JSON.parse(sentEmails[0].init.body);
    assert.deepEqual(body.to, ["paid@example.com"]);
    assert.match(body.subject, /10 views/);
    assert.match(body.text, /\/portal\?slug=paid-one/);
    assert.equal(client._patches.length, 1);
    assert.equal(client._patches[0].id, "therapist-paid-one");
    assert.equal(client._patches[0].set.lastWeeklyDigestSentAt, "2026-04-20T09:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runWeeklyDigest: skips zero-activity therapist", async () => {
  const client = makeStubClient({
    recipients: [
      {
        therapistSlug: "quiet-one",
        therapist: {
          _id: "therapist-quiet",
          name: "Dr. Quiet",
          email: "quiet@example.com",
          slug: "quiet-one",
          listingActive: true,
          lastWeeklyDigestSentAt: "",
        },
        current: null,
        previous: null,
      },
    ],
  });
  const summary = await runWeeklyDigest({
    client,
    config: { resendApiKey: "rk", emailFrom: "a", notificationTo: "b" },
    nowIso: "2026-04-20T09:00:00.000Z",
  });
  assert.equal(summary.sent, 0);
  assert.equal(summary.skipped_no_activity, 1);
  assert.equal(client._patches.length, 0);
});

test("runWeeklyDigest: skips when already sent this ISO week", async () => {
  const client = makeStubClient({
    recipients: [
      {
        therapistSlug: "already-sent",
        therapist: {
          _id: "therapist-already",
          name: "Dr. Already",
          email: "already@example.com",
          slug: "already-sent",
          listingActive: true,
          lastWeeklyDigestSentAt: "2026-04-20T08:00:00.000Z",
        },
        current: { profileViewsTotal: 5, ctaClicksTotal: 0, profileViewsMatch: 5 },
        previous: { profileViewsTotal: 0, ctaClicksTotal: 0 },
      },
    ],
  });
  const summary = await runWeeklyDigest({
    client,
    config: { resendApiKey: "rk", emailFrom: "a", notificationTo: "b" },
    nowIso: "2026-04-20T09:00:00.000Z",
  });
  assert.equal(summary.sent, 0);
  assert.equal(summary.skipped_already_sent, 1);
});

test("runWeeklyDigest: skips therapists whose listings are inactive", async () => {
  const client = makeStubClient({
    recipients: [
      {
        therapistSlug: "paused",
        therapist: {
          _id: "therapist-paused",
          name: "Paused",
          email: "paused@example.com",
          slug: "paused",
          listingActive: false,
        },
        current: { profileViewsTotal: 4, ctaClicksTotal: 1, profileViewsDirect: 4 },
        previous: { profileViewsTotal: 2 },
      },
    ],
  });
  const summary = await runWeeklyDigest({
    client,
    config: { resendApiKey: "rk", emailFrom: "a", notificationTo: "b" },
    nowIso: "2026-04-20T09:00:00.000Z",
  });
  assert.equal(summary.sent, 0);
  assert.equal(summary.skipped_listing_inactive, 1);
});
