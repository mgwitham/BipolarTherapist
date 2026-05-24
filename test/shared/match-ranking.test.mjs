import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeConciergePatterns,
  analyzeOutreachJourneys,
  analyzePivotTiming,
  analyzePivotTimingByUrgency,
  applySecondPassRefinement,
  buildFallbackLearningMap,
  buildLearningSegments,
  buildLearningSignals,
  buildShortcutLearningMap,
  buildStarterProfile,
  getMatchAvailabilityBonus,
  getMatchContactClarityBonus,
  getPreferredOutreach,
  getPreferredRouteType,
  getRouteLearningForProfile,
  getSecondPassScore,
  getShortcutPreference,
  pickRecommendedFirstContact,
} from "../../assets/match-ranking.js";
import { buildUserMatchProfile } from "../../assets/matching-model.js";

test("buildStarterProfile returns the expected lightweight California starter shape", function () {
  const profile = buildStarterProfile({
    buildUserMatchProfile,
  });

  assert.equal(profile.care_state, "CA");
  assert.equal(profile.care_intent, "Therapy");
  assert.equal(profile.care_format, "Telehealth");
  assert.equal(profile.needs_medication_management, "Open to either");
  assert.equal(profile.urgency, "ASAP");
});

test("buildLearningSegments captures the high-signal request dimensions", function () {
  const segments = buildLearningSegments({
    care_format: "Telehealth",
    care_intent: "Psychiatry",
    needs_medication_management: "Yes",
    insurance: "Aetna",
    urgency: "Within 2 weeks",
  });

  assert.deepEqual(segments, [
    "all",
    "format:telehealth",
    "intent:psychiatry",
    "medication:yes",
    "insurance:user",
    "urgency:within-2-weeks",
  ]);
});

test("getPreferredOutreach favors the configured booking route", function () {
  const outreach = getPreferredOutreach(
    {
      therapist: {
        preferred_contact_method: "booking",
        preferred_contact_label: "Book intro",
        booking_url: "https://example.com/book",
      },
    },
    {
      getTherapistContactEmailLink: function () {
        return "";
      },
    },
  );

  assert.deepEqual(outreach, {
    label: "Book intro",
    href: "https://example.com/book",
    external: true,
  });
});

test("getPreferredRouteType falls back to email when no explicit method is set", function () {
  const routeType = getPreferredRouteType({
    therapist: {
      email: "therapist@example.com",
    },
  });

  assert.equal(routeType, "email");
});

test("getRouteLearningForProfile summarizes route wins for the active user segment", function () {
  const profile = {
    care_format: "Telehealth",
    care_intent: "Therapy",
  };
  const entry = {
    therapist: {
      preferred_contact_method: "booking",
      booking_url: "https://example.com/book",
    },
  };
  const outcomes = [
    {
      route_type: "booking",
      outcome: "booked_consult",
      context: { profile },
    },
    {
      route_type: "booking",
      outcome: "good_fit_call",
      context: { profile },
    },
    {
      route_type: "booking",
      outcome: "no_response",
      context: { profile },
    },
  ];

  const learning = getRouteLearningForProfile(profile, entry, outcomes, {
    getPreferredRouteType,
    buildLearningSegments,
  });

  assert.equal(learning.routeType, "booking");
  assert.equal(learning.success, 6);
  assert.equal(learning.attempts, 9);
  assert.equal(learning.score, 21);
});

test("buildFallbackLearningMap groups backup success by trigger and segment", function () {
  const profile = {
    care_format: "Telehealth",
    care_intent: "Therapy",
  };
  const learning = buildFallbackLearningMap(
    [
      {
        journey_id: "journey-1",
        rank_position: 1,
        outcome: "no_response",
        context: { profile },
        recorded_at: "2026-04-09T09:00:00.000Z",
      },
      {
        journey_id: "journey-1",
        rank_position: 2,
        therapist_slug: "backup-therapist",
        outcome: "booked_consult",
        recorded_at: "2026-04-09T11:00:00.000Z",
      },
    ],
    {
      buildLearningSegments,
    },
  );

  assert.deepEqual(learning["no_response::all"]["backup-therapist"], {
    success: 1,
    attempts: 1,
  });
  assert.deepEqual(learning["no_response::format:telehealth"]["backup-therapist"], {
    success: 1,
    attempts: 1,
  });
});

test("pickRecommendedFirstContact prefers the strongest follow-through path", function () {
  const profile = {
    insurance: "Aetna",
    needs_medication_management: "No",
  };
  const entries = [
    {
      therapist: {
        slug: "first",
        name: "First Therapist",
        accepting_new_patients: true,
        estimated_wait_time: "Within 2 weeks",
        insurance_accepted: ["Aetna"],
        session_fee_min: 180,
      },
    },
    {
      therapist: {
        slug: "second",
        name: "Second Therapist",
        accepting_new_patients: false,
        estimated_wait_time: "Waitlist only",
        insurance_accepted: [],
      },
    },
  ];

  const picked = pickRecommendedFirstContact(profile, entries, {
    shortlistLimit: 3,
    readOutreachOutcomes: function () {
      return [];
    },
    getShortcutInfluence: function () {
      return {};
    },
    getContactReadiness: function (entry) {
      return entry.therapist.slug === "first"
        ? { tone: "high", guidance: "Booking link", route: "Book consultation" }
        : { tone: "light", guidance: "", route: "Review profile" };
    },
    getRouteLearningForProfile: function () {
      return { score: 0 };
    },
    getRoutePriority: function (readiness) {
      return readiness.tone === "high" ? 3 : 1;
    },
    hasInsuranceClarity: function (_profile, therapist) {
      return therapist.insurance_accepted.includes("Aetna");
    },
    hasCostClarity: function (therapist) {
      return Boolean(therapist.session_fee_min);
    },
    getResponsivenessScore: function (therapist) {
      return therapist.slug === "first" ? 2 : 0;
    },
  });

  assert.equal(picked.entry.therapist.slug, "first");
  assert.equal(picked.readiness.route, "Book consultation");
});

test("getMatchAvailabilityBonus rewards open, low-wait practices", function () {
  assert.equal(getMatchAvailabilityBonus(null), 0);
  assert.equal(
    getMatchAvailabilityBonus({
      accepting_new_patients: true,
      estimated_wait_time: "Within 2 weeks",
    }),
    12,
  );
  assert.equal(
    getMatchAvailabilityBonus({
      accepting_new_patients: true,
      estimated_wait_time: "Waitlist only",
    }),
    8,
  );
  assert.equal(getMatchAvailabilityBonus({ accepting_new_patients: false }), 0);
});

test("getMatchContactClarityBonus scales with readiness tone and guidance", function () {
  const deps = {
    getContactReadiness: function (entry) {
      return entry.readiness;
    },
  };
  assert.equal(getMatchContactClarityBonus({ readiness: null }, deps), 0);
  assert.equal(getMatchContactClarityBonus({ readiness: { tone: "high" } }, deps), 8);
  assert.equal(
    getMatchContactClarityBonus({ readiness: { tone: "medium", guidance: "Call first" } }, deps),
    7,
  );
  assert.equal(
    getMatchContactClarityBonus(
      { readiness: { tone: "light", guidance: "Note", firstStep: "Intro call" } },
      deps,
    ),
    6,
  );
});

test("getSecondPassScore returns the base score in balanced/default mode", function () {
  const entry = { evaluation: { score: 42, score_breakdown: { trust: 10 } }, therapist: {} };
  const deps = {
    getPublicResponsivenessSignal: function () {
      return null;
    },
    getContactReadiness: function () {
      return null;
    },
  };
  assert.equal(getSecondPassScore(entry, {}, "balanced", deps), 42);
  assert.equal(getSecondPassScore(entry, {}, undefined, deps), 42);
});

test("getSecondPassScore weights trust heavily in reviewed mode", function () {
  const entry = {
    evaluation: {
      score: 50,
      confidence_score: 10,
      completeness_score: 20,
      score_breakdown: { trust: 12, practical: 5 },
    },
    therapist: { verification_status: "editorially_verified" },
  };
  const deps = {
    getPublicResponsivenessSignal: function () {
      return null;
    },
    getContactReadiness: function () {
      return null;
    },
  };
  // 50*0.62 + 12*1.55 + 20*0.14 + 10*0.12 + 5*0.24 + 8 = 62.8
  assert.ok(Math.abs(getSecondPassScore(entry, {}, "reviewed", deps) - 62.8) < 1e-9);
});

test("applySecondPassRefinement leaves balanced order untouched and re-sorts other modes", function () {
  const deps = {
    getPublicResponsivenessSignal: function () {
      return null;
    },
    getContactReadiness: function () {
      return null;
    },
  };
  const entries = [
    {
      evaluation: { score: 10, score_breakdown: { access: 1 } },
      therapist: { name: "A", slug: "a" },
    },
    {
      evaluation: { score: 90, score_breakdown: { access: 9 } },
      therapist: { name: "B", slug: "b" },
    },
  ];

  const balanced = applySecondPassRefinement(entries, {}, "balanced", deps);
  assert.deepEqual(
    balanced.map((e) => e.therapist.slug),
    ["a", "b"],
  );
  assert.notEqual(balanced, entries);

  const speed = applySecondPassRefinement(entries, {}, "speed", deps);
  assert.deepEqual(
    speed.map((e) => e.therapist.slug),
    ["b", "a"],
  );
});

test("analyzeConciergePatterns tallies help-topic themes from free text", function () {
  const totals = analyzeConciergePatterns([
    { help_topic: "Insurance coverage question" },
    { request_note: "What's the wait / availability like?" },
    { request_summary: "Not sure who is the best fit" },
    { help_topic: "Need medication management / psychiatry" },
  ]);

  assert.equal(totals.insurance, 1);
  assert.equal(totals.availability, 1);
  assert.equal(totals.fit_uncertainty, 1);
  assert.equal(totals.medication, 1);
  assert.equal(analyzeConciergePatterns(null).insurance, 0);
});

test("buildLearningSignals folds feedback + outreach into clamped per-segment adjustments", function () {
  const profile = { care_format: "Telehealth" };
  const signals = buildLearningSignals(
    [
      { value: "negative", reasons: ["Insurance mismatch"], context: { profile } },
      {
        type: "therapist_feedback",
        therapist_slug: "alpha",
        value: "positive",
        context: { profile },
      },
    ],
    [{ therapist_slug: "alpha", outcome: "booked_consult", context: { profile } }],
  );

  assert.equal(signals.reason_weights["Insurance mismatch"], 4);
  assert.equal(signals.therapist_adjustments.alpha, 3);
  assert.equal(signals.outreach_adjustments.alpha, 7);
  assert.ok(signals.segments["format:telehealth"]);
});

test("buildShortcutLearningMap counts shortcut actions and outcomes per segment", function () {
  const profile = { care_intent: "Therapy" };
  const map = buildShortcutLearningMap(
    [
      {
        type: "shortcut_interaction",
        shortcut_type: "draft",
        action: "copy_draft",
        context: { profile },
      },
    ],
    [{ shortcut_type: "draft", outcome: "good_fit_call", context: { profile } }],
  );

  assert.equal(map["shortcut::all"].draft.draft, 1);
  assert.equal(map["shortcut::all"].draft.strong, 1);
});

test("getShortcutPreference scores stronger outcomes above raw interactions", function () {
  const map = {
    "shortcut::all": {
      draft: { draft: 2, compare: 1, strong: 1, weak: 0 },
    },
  };
  const pref = getShortcutPreference({}, "draft", map);
  // 2*3 + 1*2 + 1*8 - 0*5 = 16
  assert.equal(pref.score, 16);
  assert.equal(pref.strong, 1);
});

test("analyzeOutreachJourneys detects fallback-after-failure and second-choice wins", function () {
  const totals = analyzeOutreachJourneys([
    {
      journey_id: "j1",
      rank_position: 1,
      outcome: "no_response",
      recorded_at: "2026-04-01T09:00:00Z",
    },
    {
      journey_id: "j1",
      rank_position: 2,
      outcome: "booked_consult",
      recorded_at: "2026-04-01T10:00:00Z",
    },
  ]);

  assert.equal(totals.fallback_after_no_response, 1);
  assert.equal(totals.second_choice_success, 1);
});

test("analyzePivotTiming buckets fallback latency relative to pivot point", function () {
  const onTime = analyzePivotTiming([
    {
      journey_id: "j1",
      rank_position: 1,
      outcome: "no_response",
      pivot_at: "2026-04-01T09:00:00Z",
      recorded_at: "2026-04-01T08:00:00Z",
    },
    {
      journey_id: "j1",
      rank_position: 2,
      outcome: "reached_out",
      recorded_at: "2026-04-01T11:00:00Z",
    },
  ]);
  assert.equal(onTime.on_time_pivots, 1);
});

test("analyzePivotTimingByUrgency returns zeros for ASAP and filters by urgency otherwise", function () {
  const outcomes = [
    {
      journey_id: "j1",
      rank_position: 1,
      outcome: "no_response",
      pivot_at: "2026-04-01T09:00:00Z",
      recorded_at: "2026-04-01T08:00:00Z",
      context: { profile: { urgency: "Within 2 weeks" } },
    },
    {
      journey_id: "j1",
      rank_position: 2,
      outcome: "reached_out",
      recorded_at: "2026-04-01T11:00:00Z",
      context: { profile: { urgency: "Within 2 weeks" } },
    },
  ];

  assert.deepEqual(analyzePivotTimingByUrgency(outcomes, { urgency: "ASAP" }), {
    on_time_pivots: 0,
    early_pivots: 0,
    late_pivots: 0,
  });
  assert.equal(
    analyzePivotTimingByUrgency(outcomes, { urgency: "Within 2 weeks" }).on_time_pivots,
    1,
  );
});
