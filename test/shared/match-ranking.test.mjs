import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFallbackLearningMap,
  buildLearningSegments,
  buildStarterProfile,
  getPreferredOutreach,
  getPreferredRouteType,
  getRouteLearningForProfile,
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
