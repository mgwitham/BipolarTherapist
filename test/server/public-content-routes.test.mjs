import assert from "node:assert/strict";
import test from "node:test";

import { createPublicContentHandler } from "../../server/public-content-handler.mjs";
import { createMemoryClient, createTestApiConfig, runHandlerRequest } from "./test-helpers.mjs";

const SENSITIVE_KEYS = new Set([
  "auditLog",
  "audit_log",
  "claimedAt",
  "claimed_at",
  "claimedByEmail",
  "claimed_by_email",
  "listingPauseRequestedAt",
  "listing_pause_requested_at",
  "listingRemovalRequestedAt",
  "listing_removal_requested_at",
  "notes",
  "portalLastSeenAt",
  "portal_last_seen_at",
  "reviewFollowUp",
  "review_follow_up",
]);

function collectSensitiveKeys(value, found = []) {
  if (!value || typeof value !== "object") {
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach(function (item) {
      collectSensitiveKeys(item, found);
    });
    return found;
  }
  Object.entries(value).forEach(function ([key, child]) {
    if (SENSITIVE_KEYS.has(key)) {
      found.push(key);
    }
    collectSensitiveKeys(child, found);
  });
  return found;
}

function publicTherapist(overrides) {
  return {
    _id: "therapist-public",
    _type: "therapist",
    name: "Dr. Public Boundary",
    email: "public@example.com",
    phone: "555-202-4040",
    slug: { current: "dr-public-boundary" },
    listingActive: true,
    status: "active",
    visibilityIntent: "listed",
    lifecycle: "approved",
    claimedByEmail: "private-owner@example.com",
    claimedAt: "2026-04-01T00:00:00.000Z",
    portalLastSeenAt: "2026-04-15T00:00:00.000Z",
    listingPauseRequestedAt: "2026-04-16T00:00:00.000Z",
    listingRemovalRequestedAt: "2026-04-17T00:00:00.000Z",
    notes: "Internal editorial note",
    auditLog: [{ at: "2026-04-01T00:00:00.000Z", message: "private" }],
    reviewFollowUp: { status: "open" },
    specialties: ["Bipolar Disorder"],
    insuranceAccepted: ["Aetna"],
    ...overrides,
  };
}

test("public content API lists only live therapists and strips private fields", async function () {
  const { client } = createMemoryClient({
    public: publicTherapist(),
    paused: publicTherapist({
      _id: "therapist-paused",
      slug: { current: "paused" },
      listingActive: false,
    }),
    draft: publicTherapist({
      _id: "drafts.therapist-draft",
      slug: { current: "draft" },
    }),
  });
  const handler = createPublicContentHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    headers: { host: "localhost:8787" },
    method: "GET",
    url: "/api/public/therapists",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.length, 1);
  assert.equal(response.payload[0].slug, "dr-public-boundary");
  assert.equal(response.payload[0].email, "public@example.com");
  assert.deepEqual(collectSensitiveKeys(response.payload), []);
});

test("public content API returns 404 for hidden therapist slugs", async function () {
  const { client } = createMemoryClient({
    hidden: publicTherapist({
      _id: "therapist-hidden",
      slug: { current: "hidden-profile" },
      visibilityIntent: "hidden",
    }),
  });
  const handler = createPublicContentHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    headers: { host: "localhost:8787" },
    method: "GET",
    url: "/api/public/therapists/hidden-profile",
  });

  assert.equal(response.statusCode, 404);
});
