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
  "sourceUrl",
  "source_url",
  "supportingSourceUrls",
  "supporting_source_urls",
  "fieldTrustMeta",
  "field_trust_meta",
  "claimStatus",
  "claim_status",
  "dedupeOverrides",
  "dedupe_overrides",
  "lifecycle",
  "listingActive",
  "listing_active",
  "status",
  "visibilityIntent",
  "visibility_intent",
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
    claimStatus: "claimed",
    dedupeOverrides: ["internal-dedupe-override"],
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
  assert.equal("license_number" in response.payload[0], false);
  assert.equal("photo_source_type" in response.payload[0], false);
  assert.equal("photo_reviewed_at" in response.payload[0], false);
  assert.equal("photo_usage_permission_confirmed" in response.payload[0], false);
  assert.equal("practice_name" in response.payload[0], false);
  assert.equal("license_state" in response.payload[0], false);
  assert.equal("source_host" in response.payload[0], false);
  assert.equal("supporting_source_count" in response.payload[0], false);
  assert.equal("field_trust_meta" in response.payload[0], false);
  assert.deepEqual(collectSensitiveKeys(response.payload), []);
});

test("public content API returns derived source metadata instead of raw source URLs", async function () {
  const { client } = createMemoryClient({
    public: publicTherapist({
      sourceUrl: "https://www.psychologytoday.com/us/psychiatrists/public-boundary",
      supportingSourceUrls: [
        "https://example.com/provider/public-boundary",
        "https://www.healthgrades.com/provider/public-boundary",
      ],
    }),
  });
  const handler = createPublicContentHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    headers: { host: "localhost:8787" },
    method: "GET",
    url: "/api/public/therapists/dr-public-boundary",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.source_host, "psychologytoday.com");
  assert.equal(response.payload.supporting_source_count, 2);
  assert.equal("source_url" in response.payload, false);
  assert.equal("supporting_source_urls" in response.payload, false);
});

test("public content API redacts email and phone when another public contact route is preferred", async function () {
  const { client } = createMemoryClient({
    public: publicTherapist({
      preferredContactMethod: "booking",
      bookingUrl: "https://practice.example/book",
      website: "https://practice.example",
    }),
  });
  const handler = createPublicContentHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    headers: { host: "localhost:8787" },
    method: "GET",
    url: "/api/public/therapists/dr-public-boundary",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.preferred_contact_method, "booking");
  assert.equal(response.payload.booking_url, "https://practice.example/book");
  assert.equal(response.payload.website, "https://practice.example");
  assert.equal(response.payload.email, "");
  assert.equal(response.payload.phone, "");
});

test("public content API only exposes the explicitly preferred direct contact field", async function () {
  const { client } = createMemoryClient({
    email: publicTherapist({
      _id: "therapist-email",
      slug: { current: "email-profile" },
      preferredContactMethod: "email",
    }),
    phone: publicTherapist({
      _id: "therapist-phone",
      slug: { current: "phone-profile" },
      preferredContactMethod: "phone",
    }),
  });
  const handler = createPublicContentHandler(createTestApiConfig(), client);

  const emailResponse = await runHandlerRequest(handler, {
    headers: { host: "localhost:8787" },
    method: "GET",
    url: "/api/public/therapists/email-profile",
  });
  const phoneResponse = await runHandlerRequest(handler, {
    headers: { host: "localhost:8787" },
    method: "GET",
    url: "/api/public/therapists/phone-profile",
  });

  assert.equal(emailResponse.statusCode, 200);
  assert.equal(emailResponse.payload.email, "public@example.com");
  assert.equal(emailResponse.payload.phone, "");
  assert.equal(phoneResponse.statusCode, 200);
  assert.equal(phoneResponse.payload.email, "");
  assert.equal(phoneResponse.payload.phone, "555-202-4040");
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
