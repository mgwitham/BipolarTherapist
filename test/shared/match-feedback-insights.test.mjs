import test from "node:test";
import assert from "node:assert/strict";

import { buildFeedbackInsightsMarkup } from "../../assets/match-feedback-insights.js";

test("buildFeedbackInsightsMarkup renders the empty state when nothing is captured", function () {
  const html = buildFeedbackInsightsMarkup([], [], {});
  assert.match(html, /Your feedback so far/);
  assert.match(html, /No feedback captured yet/);
  assert.doesNotMatch(html, /insight-stats/);
});

test("buildFeedbackInsightsMarkup summarizes signals and resolves therapist names", function () {
  const feedback = [
    { type: "shortlist_feedback", value: "positive" },
    { type: "therapist_feedback", therapist_slug: "dr-a", value: "positive" },
    { type: "therapist_feedback", therapist_slug: "dr-a", value: "negative" },
  ];
  const outreachOutcomes = [{ therapist_slug: "dr-a", outcome: "booked_consult" }];
  const services = { therapists: [{ slug: "dr-a", name: "Dr. Alpha" }] };

  const html = buildFeedbackInsightsMarkup(feedback, outreachOutcomes, services);

  assert.match(html, /insight-stats/);
  assert.match(html, /Total signals/);
  // 3 feedback entries -> "Total signals" stat value of 3.
  assert.match(html, /insight-stat-value">3</);
  assert.match(html, /Booked consults/);
  // therapist slug resolved to display name via injected therapists.
  assert.match(html, /Dr\. Alpha/);
});

test("buildFeedbackInsightsMarkup escapes therapist names from data", function () {
  const html = buildFeedbackInsightsMarkup(
    [{ type: "therapist_feedback", therapist_slug: "x", value: "positive" }],
    [],
    { therapists: [{ slug: "x", name: "<img src=x onerror=1>" }] },
  );
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});
