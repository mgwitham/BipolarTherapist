import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDirectoryIntegritySummary,
  hasDirectoryIntegrityWork,
} from "../../shared/directory-integrity-domain.mjs";

const NOW = "2026-05-24T12:00:00.000Z";

function daysAgo(days) {
  return new Date(new Date(NOW).getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function therapist(overrides) {
  return {
    _id: "therapist-1",
    _updatedAt: daysAgo(10),
    name: "Dr. Good",
    slug: { current: "dr-good" },
    lifecycle: "approved",
    visibilityIntent: "listed",
    listingActive: true,
    status: "active",
    licenseNumber: "PSY123",
    website: "https://example.com",
    sourceReviewedAt: daysAgo(20),
    ...overrides,
  };
}

test("buildDirectoryIntegritySummary counts live and intended-live profiles", () => {
  const summary = buildDirectoryIntegritySummary({
    nowIso: NOW,
    therapists: [
      therapist({ _id: "live-1" }),
      therapist({ _id: "paused", lifecycle: "paused" }),
      therapist({ _id: "missing-license", licenseNumber: "" }),
    ],
  });

  assert.equal(summary.totalProfiles, 3);
  assert.equal(summary.intendedLive, 2);
  assert.equal(summary.liveProfiles, 1);
  assert.equal(summary.needsAttention, 1);
  assert.equal(summary.missingLicense, 1);
  assert.equal(hasDirectoryIntegrityWork(summary), true);
});

test("buildDirectoryIntegritySummary surfaces missing contact route and stale reviews", () => {
  const summary = buildDirectoryIntegritySummary({
    nowIso: NOW,
    staleDays: 90,
    therapists: [
      therapist({
        _id: "stale-contact",
        name: "Dr. Stale",
        slug: { current: "dr-stale" },
        bookingUrl: "",
        website: "",
        email: "",
        phone: "",
        sourceReviewedAt: daysAgo(200),
      }),
    ],
  });

  assert.equal(summary.missingContactRoute, 1);
  assert.equal(summary.staleReview, 1);
  assert.equal(summary.topIssues.length, 1);
  assert.equal(summary.topIssues[0].name, "Dr. Stale");
  assert.deepEqual(summary.topIssues[0].issues, ["no contact route", "stale review"]);
});

test("buildDirectoryIntegritySummary ranks non-live trust failures first", () => {
  const summary = buildDirectoryIntegritySummary({
    nowIso: NOW,
    therapists: [
      therapist({
        _id: "stale-only",
        name: "Dr. Stale Only",
        slug: { current: "dr-stale-only" },
        sourceReviewedAt: daysAgo(220),
      }),
      therapist({
        _id: "missing-license",
        name: "Dr. Missing License",
        slug: { current: "dr-missing-license" },
        licenseNumber: "",
      }),
    ],
  });

  assert.equal(summary.topIssues[0].name, "Dr. Missing License");
  assert.match(summary.topIssues[0].issues.join(", "), /not Live/);
  assert.match(summary.topIssues[0].issues.join(", "), /missing license/);
});

test("hasDirectoryIntegrityWork is false when intended-live profiles are healthy", () => {
  const summary = buildDirectoryIntegritySummary({
    nowIso: NOW,
    therapists: [therapist()],
  });

  assert.equal(summary.needsAttention, 0);
  assert.equal(summary.missingContactRoute, 0);
  assert.equal(summary.staleReview, 0);
  assert.equal(hasDirectoryIntegrityWork(summary), false);
});
