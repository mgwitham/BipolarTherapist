import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CLAIM_LINK_HISTORY_CAP,
  CLAIM_LINK_MAX_PER_WINDOW,
  evaluateClaimLinkRateLimit,
} from "../../shared/claim-link-rate-limit.mjs";

const NOW = new Date("2026-07-15T12:00:00Z").getTime();
const minutesAgo = (n) => new Date(NOW - n * 60000).toISOString();

test("empty or missing history → not exceeded, stamps this request", () => {
  for (const history of [[], null, undefined]) {
    const result = evaluateClaimLinkRateLimit(history, NOW);
    assert.equal(result.exceeded, false);
    assert.equal(result.recentCount, 0);
    assert.deepEqual(result.nextHistory, [new Date(NOW).toISOString()]);
  }
});

test("under the cap → allowed, history accumulates", () => {
  const result = evaluateClaimLinkRateLimit([minutesAgo(50), minutesAgo(10)], NOW);
  assert.equal(result.exceeded, false);
  assert.equal(result.recentCount, 2);
  assert.equal(result.nextHistory.length, 3);
});

test("at the cap → exceeded", () => {
  const history = [minutesAgo(45), minutesAgo(30), minutesAgo(5)];
  const result = evaluateClaimLinkRateLimit(history, NOW);
  assert.equal(result.exceeded, true);
  assert.equal(result.recentCount, CLAIM_LINK_MAX_PER_WINDOW);
});

test("entries older than one hour age out", () => {
  const history = [minutesAgo(90), minutesAgo(75), minutesAgo(61), minutesAgo(30)];
  const result = evaluateClaimLinkRateLimit(history, NOW);
  assert.equal(result.exceeded, false);
  assert.equal(result.recentCount, 1);
  // aged-out entries are dropped from the persisted history
  assert.deepEqual(result.nextHistory, [minutesAgo(30), new Date(NOW).toISOString()]);
});

test("boundary: exactly one hour old still counts as in-window", () => {
  const result = evaluateClaimLinkRateLimit([minutesAgo(60)], NOW);
  assert.equal(result.recentCount, 1);
});

test("garbage timestamps are ignored", () => {
  const result = evaluateClaimLinkRateLimit(["not-a-date", "", null, minutesAgo(5)], NOW);
  assert.equal(result.recentCount, 1);
  assert.equal(result.exceeded, false);
});

test("nextHistory is capped at the newest CLAIM_LINK_HISTORY_CAP entries", () => {
  const history = Array.from({ length: 20 }, (_, i) => minutesAgo(59 - i));
  const result = evaluateClaimLinkRateLimit(history, NOW);
  assert.equal(result.nextHistory.length, CLAIM_LINK_HISTORY_CAP);
  // newest entry is this request's stamp
  assert.equal(result.nextHistory.at(-1), new Date(NOW).toISOString());
});
