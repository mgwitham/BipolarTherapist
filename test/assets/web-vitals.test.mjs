import { test } from "node:test";
import assert from "node:assert/strict";

import { createClsSessionAggregator, summarizeWebVitals } from "../../assets/web-vitals.js";

const shift = (startTime, value, hadRecentInput = false) => ({
  startTime,
  value,
  hadRecentInput,
});

test("CLS: shifts within one session window accumulate", () => {
  const agg = createClsSessionAggregator();
  agg.add(shift(1000, 0.05));
  agg.add(shift(1500, 0.03));
  agg.add(shift(2200, 0.02));
  assert.equal(Math.round(agg.value() * 100) / 100, 0.1);
});

test("CLS: a gap over 1s starts a new window; worst window wins", () => {
  const agg = createClsSessionAggregator();
  agg.add(shift(1000, 0.2));
  agg.add(shift(3000, 0.05)); // 2s gap → new window
  agg.add(shift(3500, 0.06));
  assert.equal(agg.value(), 0.2); // first window still the worst
});

test("CLS: a window is capped at 5s even with continuous shifts", () => {
  const agg = createClsSessionAggregator();
  for (let t = 0; t <= 6000; t += 500) agg.add(shift(t, 0.01));
  // Window spans must stay UNDER 5s: t=0…4500 accumulate (10 shifts);
  // the shift at exactly t=5000 starts a new window (matches Chrome).
  assert.equal(Math.round(agg.value() * 100) / 100, 0.1);
});

test("CLS: shifts with recent input are ignored", () => {
  const agg = createClsSessionAggregator();
  agg.add(shift(1000, 0.5, true));
  assert.equal(agg.value(), 0);
});

test("summarize: rounds ms metrics, keeps cls precision, drops unobserved", () => {
  const payload = summarizeWebVitals({
    ttfb: 75.6,
    fcp: 812.2,
    lcp: 1499.9,
    inp: null, // no interaction happened
    cls: 0.04567,
    pathname: "/results",
    connection: "4g",
  });
  assert.deepEqual(payload, {
    ttfb_ms: 76,
    fcp_ms: 812,
    lcp_ms: 1500,
    cls: 0.046,
    pathname: "/results",
    connection: "4g",
  });
});

test("summarize: empty input → empty payload (nothing fabricated)", () => {
  assert.deepEqual(summarizeWebVitals({}), {});
  assert.deepEqual(summarizeWebVitals(null), {});
});

test("summarize: negative/garbage values are dropped", () => {
  assert.deepEqual(summarizeWebVitals({ lcp: -5, fcp: NaN, cls: -0.1, connection: 4 }), {});
});
