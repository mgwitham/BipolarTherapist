import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findAbandonedClaims,
  buildAbandonedClaimAlert,
} from "../../shared/abandoned-claim-domain.mjs";

const NOW = "2026-05-12T12:00:00.000Z";
const nowMs = new Date(NOW).getTime();
const isoAgo = (msAgo) => new Date(nowMs - msAgo).toISOString();
const HOUR = 60 * 60 * 1000;

test("findAbandonedClaims flags a claim request in the 4-5h window", () => {
  const therapists = [
    {
      _id: "t1",
      name: "Jane",
      email: "jane@example.com",
      slug: "jane",
      claimStatus: "claim_requested",
      claimLinkRequests: [isoAgo(4.5 * HOUR)],
    },
  ];
  const result = findAbandonedClaims({ therapists, nowIso: NOW });
  assert.equal(result.length, 1);
  assert.equal(result[0]._id, "t1");
  assert.equal(result[0].email, "jane@example.com");
});

test("findAbandonedClaims skips requests younger than 4h", () => {
  const therapists = [
    {
      _id: "t1",
      claimStatus: "claim_requested",
      claimLinkRequests: [isoAgo(3.9 * HOUR)],
    },
  ];
  assert.equal(findAbandonedClaims({ therapists, nowIso: NOW }).length, 0);
});

test("findAbandonedClaims skips requests older than 5h", () => {
  const therapists = [
    {
      _id: "t1",
      claimStatus: "claim_requested",
      claimLinkRequests: [isoAgo(5.1 * HOUR)],
    },
  ];
  assert.equal(findAbandonedClaims({ therapists, nowIso: NOW }).length, 0);
});

test("findAbandonedClaims uses the LATEST request, not the earliest", () => {
  const therapists = [
    {
      _id: "t1",
      claimStatus: "claim_requested",
      // Earliest is 8h ago (outside window) but the user retried 4.5h ago
      // (inside window). We should treat them as a current abandoner.
      claimLinkRequests: [isoAgo(8 * HOUR), isoAgo(4.5 * HOUR)],
    },
  ];
  assert.equal(findAbandonedClaims({ therapists, nowIso: NOW }).length, 1);
});

test("findAbandonedClaims ignores therapists who already claimed", () => {
  const therapists = [
    {
      _id: "t1",
      claimStatus: "claimed",
      claimLinkRequests: [isoAgo(4.5 * HOUR)],
    },
  ];
  assert.equal(findAbandonedClaims({ therapists, nowIso: NOW }).length, 0);
});

test("findAbandonedClaims handles slug as object or string", () => {
  const therapists = [
    {
      _id: "t1",
      claimStatus: "claim_requested",
      slug: { current: "jane" },
      claimLinkRequests: [isoAgo(4.5 * HOUR)],
    },
    {
      _id: "t2",
      claimStatus: "claim_requested",
      slug: "bob",
      claimLinkRequests: [isoAgo(4.5 * HOUR)],
    },
  ];
  const result = findAbandonedClaims({ therapists, nowIso: NOW });
  assert.equal(result.find((r) => r._id === "t1").slug, "jane");
  assert.equal(result.find((r) => r._id === "t2").slug, "bob");
});

test("buildAbandonedClaimAlert produces a subject and body lines", () => {
  const alert = buildAbandonedClaimAlert({
    name: "Jane",
    email: "jane@example.com",
    slug: "jane",
    requestedAt: "2026-05-12T08:00:00.000Z",
  });
  assert.match(alert.subject, /\[ABANDONED\] Jane/);
  assert.ok(alert.lines.some((l) => l.includes("jane@example.com")));
  assert.ok(alert.lines.some((l) => l.includes("personal follow-up")));
});
