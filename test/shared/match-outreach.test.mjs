import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFallbackRecommendation,
  buildFirstContactRecommendation,
} from "../../assets/match-outreach.js";

test("buildFirstContactRecommendation turns route and trust signals into a clear rationale", function () {
  const profile = {
    urgency: "Within 2 weeks",
    insurance: "Aetna",
    needs_medication_management: "Yes",
  };
  const entries = [
    {
      therapist: {
        slug: "lead-therapist",
        name: "Lead Therapist",
        accepting_new_patients: true,
        estimated_wait_time: "Within 1 week",
        insurance_accepted: ["Aetna"],
        medication_management: true,
      },
      evaluation: {
        active_segments: ["insurance:user"],
      },
    },
  ];

  const recommendation = buildFirstContactRecommendation(profile, entries, {
    pickRecommendedFirstContact: function () {
      return {
        entry: entries[0],
        readiness: {
          tone: "high",
          route: "Book consultation",
          firstStep: "Use the booking link first.",
        },
        routeLearning: {
          success: 2,
          routeType: "booking",
        },
        shortcutSignal: {
          rank: 1,
          title: "Fastest path",
          preference: { strong: 2, weak: 0 },
        },
      };
    },
    hasInsuranceClarity: function () {
      return true;
    },
    hasCostClarity: function () {
      return false;
    },
    getResponsivenessScore: function () {
      return 2;
    },
    getSegmentLearningCopy: function () {
      return "Reinforced by similar insured searches.";
    },
    getSegmentAwareRecommendationCue: function () {
      return "Confirm coverage early.";
    },
  });

  assert.equal(recommendation.therapist.slug, "lead-therapist");
  assert.equal(recommendation.route, "Book consultation");
  assert.equal(recommendation.firstStep, "Use the booking link first.");
  assert.match(recommendation.rationale, /friction-light/);
  assert.match(recommendation.rationale, /accepting new patients|explicitly list your insurance/);
  assert.equal(recommendation.segmentCue, "Confirm coverage early.");
});

test("buildFallbackRecommendation promotes the strongest backup after a negative first outcome", function () {
  const profile = {
    care_format: "Telehealth",
  };
  const entries = [
    {
      therapist: {
        slug: "lead",
        name: "Lead Therapist",
      },
    },
    {
      therapist: {
        slug: "backup-a",
        name: "Backup A",
      },
      evaluation: { score: 88 },
    },
    {
      therapist: {
        slug: "backup-b",
        name: "Backup B",
      },
      evaluation: { score: 85 },
    },
  ];

  const fallback = buildFallbackRecommendation(profile, entries, {
    buildFirstContactRecommendation: function () {
      return {
        therapist: entries[0].therapist,
      };
    },
    getLatestOutreachOutcome: function () {
      return {
        outcome: "no_response",
      };
    },
    readOutreachOutcomes: function () {
      return [];
    },
    buildFallbackLearningMap: function () {
      return {
        "no_response::all": {
          "backup-a": { success: 2, attempts: 2 },
          "backup-b": { success: 0, attempts: 1 },
        },
      };
    },
    buildLearningSegments: function () {
      return ["all"];
    },
    getRouteLearningForProfile: function (_profile, entry) {
      return entry.therapist.slug === "backup-a"
        ? { score: 3, success: 1, routeType: "email" }
        : { score: 1, success: 0, routeType: "profile" };
    },
    getPreferredOutreach: function (entry) {
      return {
        label: entry.therapist.slug === "backup-a" ? "Email therapist" : "View profile",
      };
    },
    formatOutcomeLabel: function (value) {
      return value;
    },
  });

  assert.equal(fallback.therapist.slug, "backup-a");
  assert.equal(fallback.route, "Email therapist");
  assert.equal(fallback.learningWins, 2);
  assert.match(fallback.rationale, /not gotten a reply yet/);
  assert.match(fallback.rationale, /2 strong outcomes/);
  assert.match(fallback.nextMove, /backup option now/);
});
