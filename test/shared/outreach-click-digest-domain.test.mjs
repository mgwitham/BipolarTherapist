import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildOutreachClickDigest,
  renderOutreachClickDigestEmail,
} from "../../shared/outreach-click-digest-domain.mjs";

const NOW = "2026-05-12T15:00:00.000Z";
const nowMs = new Date(NOW).getTime();
const isoAgo = (hoursAgo) => new Date(nowMs - hoursAgo * 60 * 60 * 1000).toISOString();

function viewEvent(slug, hoursAgo) {
  return {
    type: "outreach_profile_viewed",
    occurredAt: isoAgo(hoursAgo),
    payload: { therapist_slug: slug },
  };
}

test("buildOutreachClickDigest returns null when no events in window", () => {
  assert.equal(
    buildOutreachClickDigest({ events: [], claimedBySlug: new Set(), nowIso: NOW }),
    null,
  );
});

test("buildOutreachClickDigest dedups multiple views per slug", () => {
  const events = [viewEvent("jane", 2), viewEvent("jane", 5), viewEvent("jane", 10)];
  const result = buildOutreachClickDigest({ events, claimedBySlug: new Set(), nowIso: NOW });
  assert.equal(result.totalUniqueClickers, 1);
  assert.equal(result.clickedNoClaim.length, 1);
});

test("buildOutreachClickDigest excludes views older than 24h", () => {
  const events = [viewEvent("jane", 30), viewEvent("bob", 6)];
  const result = buildOutreachClickDigest({ events, claimedBySlug: new Set(), nowIso: NOW });
  assert.equal(result.totalUniqueClickers, 1);
  assert.equal(result.clickedNoClaim[0].slug, "bob");
});

test("buildOutreachClickDigest splits claimed vs not-claimed", () => {
  const events = [viewEvent("jane", 2), viewEvent("bob", 4), viewEvent("alice", 8)];
  const result = buildOutreachClickDigest({
    events,
    claimedBySlug: new Set(["bob"]),
    nowIso: NOW,
  });
  assert.equal(result.totalUniqueClickers, 3);
  assert.equal(result.clickedAndClaimed, 1);
  assert.equal(result.clickedNoClaim.length, 2);
  const slugs = result.clickedNoClaim.map((r) => r.slug).sort();
  assert.deepEqual(slugs, ["alice", "jane"]);
});

test("buildOutreachClickDigest parses payload from JSON string", () => {
  const events = [
    {
      type: "outreach_profile_viewed",
      occurredAt: isoAgo(2),
      payload: JSON.stringify({ therapist_slug: "jane" }),
    },
  ];
  const result = buildOutreachClickDigest({ events, claimedBySlug: new Set(), nowIso: NOW });
  assert.equal(result.totalUniqueClickers, 1);
});

test("buildOutreachClickDigest ignores other event types", () => {
  const events = [
    { type: "signup_page_viewed", occurredAt: isoAgo(2), payload: { therapist_slug: "x" } },
    viewEvent("jane", 2),
  ];
  const result = buildOutreachClickDigest({ events, claimedBySlug: new Set(), nowIso: NOW });
  assert.equal(result.totalUniqueClickers, 1);
});

test("renderOutreachClickDigestEmail produces subject + lines", () => {
  const digest = buildOutreachClickDigest({
    events: [viewEvent("jane", 2), viewEvent("bob", 4)],
    claimedBySlug: new Set(["bob"]),
    nowIso: NOW,
  });
  const email = renderOutreachClickDigestEmail(digest);
  assert.match(email.subject, /\[OUTREACH\] 1 clicked, no claim/);
  assert.ok(email.lines.some((l) => l.includes("jane")));
  assert.ok(!email.lines.some((l) => l.includes("bob") && /claimed but/.test(l)));
});

test("renderOutreachClickDigestEmail handles every-clicker-claimed case", () => {
  const digest = buildOutreachClickDigest({
    events: [viewEvent("jane", 2)],
    claimedBySlug: new Set(["jane"]),
    nowIso: NOW,
  });
  const email = renderOutreachClickDigestEmail(digest);
  assert.match(email.subject, /\[OUTREACH\] 0 clicked, no claim/);
  assert.ok(email.lines.some((l) => l.includes("Every clicker also claimed")));
});
