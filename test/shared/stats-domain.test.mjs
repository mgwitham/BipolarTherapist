import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { proportionsAreSeparated, wilsonInterval } from "../../shared/stats-domain.mjs";

describe("wilsonInterval", () => {
  it("returns zero band for empty samples", () => {
    const result = wilsonInterval(0, 0);
    assert.deepEqual(result, { center: 0, lower: 0, upper: 0 });
  });

  it("returns sane bounds for a 50/50 small sample", () => {
    const result = wilsonInterval(2, 4);
    // Wilson should pull the center toward 0.5 and produce an interval
    // that comfortably contains the maximum-likelihood estimate.
    assert.ok(result.center > 0.2 && result.center < 0.8);
    assert.ok(result.lower >= 0 && result.lower < result.center);
    assert.ok(result.upper > result.center && result.upper <= 1);
  });

  it("tightens the interval as N grows for a fixed proportion", () => {
    const small = wilsonInterval(5, 10);
    const big = wilsonInterval(500, 1000);
    const smallWidth = small.upper - small.lower;
    const bigWidth = big.upper - big.lower;
    assert.ok(bigWidth < smallWidth);
    // Both should contain 0.5 since the underlying proportion is 50%.
    assert.ok(small.lower < 0.5 && small.upper > 0.5);
    assert.ok(big.lower < 0.5 && big.upper > 0.5);
  });

  it("clamps bounds to [0, 1]", () => {
    const allHit = wilsonInterval(20, 20);
    assert.ok(allHit.upper <= 1);
    assert.ok(allHit.lower >= 0);
    const noHit = wilsonInterval(0, 20);
    assert.ok(noHit.upper <= 1);
    assert.equal(noHit.lower, 0);
  });

  it("returns zero band on invalid inputs", () => {
    assert.deepEqual(wilsonInterval(-1, 10), { center: 0, lower: 0, upper: 0 });
    assert.deepEqual(wilsonInterval(15, 10), { center: 0, lower: 0, upper: 0 });
  });
});

describe("proportionsAreSeparated", () => {
  it("requires both arms to meet the minimum N", () => {
    // Even an extreme split (0 vs 9 of 9) is rejected when arms are too small.
    assert.equal(proportionsAreSeparated(0, 9, 9, 9), false);
  });

  it("returns false when CIs overlap", () => {
    // 5/10 vs 6/10 — close, overlapping CIs.
    assert.equal(proportionsAreSeparated(5, 10, 6, 10), false);
  });

  it("returns true when CIs are clearly separated", () => {
    // 95/100 vs 5/100 — non-overlapping by a country mile.
    assert.equal(proportionsAreSeparated(95, 100, 5, 100), true);
  });

  it("respects a custom minN floor", () => {
    // Below the floor, never report separation regardless of values.
    assert.equal(proportionsAreSeparated(50, 50, 0, 50, 200), false);
  });
});
