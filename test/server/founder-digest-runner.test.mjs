import assert from "node:assert/strict";
import test from "node:test";

import { runFounderDigest } from "../../server/review-founder-digest.mjs";

const NOW = "2026-05-24T12:00:00.000Z";

function daysAgo(days) {
  return new Date(new Date(NOW).getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function makeClient({ events, therapists }) {
  return {
    async getDocument(id) {
      assert.equal(id, "funnelEventLog.singleton");
      return { _id: id, events: events || [] };
    },
    async fetch(query) {
      assert.match(query, /_type == "therapist"/);
      return therapists || [];
    },
  };
}

test("runFounderDigest sends when directory integrity needs attention even without funnel activity", async () => {
  const sentEmails = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function (url, init) {
    sentEmails.push({ url, init });
    return {
      ok: true,
      json: async () => ({ id: "email-1" }),
    };
  };

  try {
    const summary = await runFounderDigest({
      nowIso: NOW,
      adminUrl: "https://www.bipolartherapyhub.com/admin.html",
      config: {
        resendApiKey: "rk_test",
        emailFrom: "hello@bipolartherapyhub.com",
        notificationTo: "ops@bipolartherapyhub.com",
      },
      client: makeClient({
        events: [],
        therapists: [
          {
            _id: "therapist-missing-license",
            _updatedAt: daysAgo(3),
            _type: "therapist",
            name: "Dr. Missing License",
            slug: "dr-missing-license",
            lifecycle: "approved",
            visibilityIntent: "listed",
            listingActive: true,
            status: "active",
            licenseNumber: "",
            website: "https://example.com",
            sourceReviewedAt: daysAgo(10),
          },
        ],
      }),
    });

    assert.equal(summary.sent, true);
    assert.equal(summary.directory_integrity.needs_attention, 1);
    assert.equal(summary.directory_integrity.missing_license, 1);
    assert.equal(sentEmails.length, 1);
    const body = JSON.parse(sentEmails[0].init.body);
    assert.match(body.text, /Directory integrity:/);
    assert.match(body.text, /Dr\. Missing License/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
