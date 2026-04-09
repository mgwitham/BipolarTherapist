import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMatchOutcomeDocument,
  buildMatchRequestDocument,
  normalizePortableMatchOutcome,
  normalizePortableMatchRequest,
} from "../../shared/match-persistence-domain.mjs";

test("normalizePortableMatchRequest shapes current match profile data into a persistence-friendly record", function () {
  const record = normalizePortableMatchRequest({
    journey_id: "journey-123",
    care_state: "CA",
    care_format: "Telehealth",
    care_intent: "Therapy",
    needs_medication_management: "Open to either",
    insurance: "Aetna",
    budget_max: 180,
    bipolar_focus: ["Bipolar II", "Rapid Cycling"],
    preferred_modalities: ["CBT"],
    population_fit: ["Adults"],
    language_preferences: ["English", "Spanish"],
    cultural_preferences: "Latina therapist preferred",
    request_summary: "State: CA • Insurance: Aetna",
  });

  assert.equal(record.request_id, "journey-123");
  assert.equal(record.care_state, "CA");
  assert.equal(record.care_format, "telehealth");
  assert.equal(record.care_intent, "therapy");
  assert.equal(record.needs_medication_management, "open");
  assert.equal(record.priority_mode, "");
  assert.equal(record.urgency, "");
  assert.deepEqual(record.bipolar_focus, ["bipolar_ii", "rapid_cycling"]);
  assert.deepEqual(record.preferred_modalities, ["cbt"]);
  assert.deepEqual(record.population_fit, ["adults"]);
  assert.deepEqual(record.language_preferences, ["english", "spanish"]);
  assert.equal(record.insurance_preference, "Aetna");
  assert.equal(record.budget_max, 180);
  assert.equal(record.source_surface, "match_flow");
});

test("normalizePortableMatchOutcome shapes local outcome entries into a future server-side contract", function () {
  const record = normalizePortableMatchOutcome({
    journey_id: "journey-123",
    therapist_slug: "dr-jamie-rivera-los-angeles-ca",
    therapist_name: "Dr. Jamie Rivera",
    rank_position: 2,
    result_count: 8,
    top_slug: "dr-sam-lee-los-angeles-ca",
    route_type: "booking",
    shortcut_type: "shortlist",
    pivot_at: "2026-04-09T12:00:00.000Z",
    recommended_wait_window: "48 hours",
    outcome: "booked_consult",
    request_summary: "State: CA • Insurance: Aetna",
    recorded_at: "2026-04-09T12:30:00.000Z",
    context: {
      summary: "State: CA • Insurance: Aetna",
      strategy: {
        match_action: "help",
        directory_sort: "best_match",
      },
    },
  });

  assert.equal(record.request_id, "journey-123");
  assert.equal(record.therapist_slug, "dr-jamie-rivera-los-angeles-ca");
  assert.equal(record.rank_position, 2);
  assert.equal(record.outcome, "booked_consult");
  assert.equal(record.context_summary, "State: CA • Insurance: Aetna");
  assert.match(record.strategy_snapshot, /best_match/);
});

test("buildMatchRequestDocument stores normalized enum values expected by the schema", function () {
  const document = buildMatchRequestDocument({
    request_id: "journey-124",
    care_format: "In-Person",
    care_intent: "Psychiatry",
    needs_medication_management: "Open to either",
    priority_mode: "Highest specialization",
    urgency: "Within 2 weeks",
    bipolar_focus: ["Mixed Episodes", "Medication Management"],
    preferred_modalities: ["EMDR", "Family Systems"],
    population_fit: ["College students", "LGBTQ+"],
    language_preferences: ["English", "Tagalog"],
  });

  assert.equal(document.careFormat, "in_person");
  assert.equal(document.careIntent, "psychiatry");
  assert.equal(document.needsMedicationManagement, "open");
  assert.equal(document.priorityMode, "highest_specialization");
  assert.equal(document.urgency, "within_2_weeks");
  assert.deepEqual(document.bipolarFocus, ["mixed_episodes", "medication_management"]);
  assert.deepEqual(document.preferredModalities, ["emdr", "family_systems"]);
  assert.deepEqual(document.populationFit, ["college_students", "lgbtq"]);
  assert.deepEqual(document.languagePreferences, ["english", "tagalog"]);
});

test("buildMatchOutcomeDocument preserves high-signal outcome context fields", function () {
  const document = buildMatchOutcomeDocument({
    request_id: "journey-125",
    provider_id: "provider-ca-88804",
    therapist_slug: "aubri-gomez-los-angeles-ca",
    therapist_name: "Aubri Gomez, LCSW",
    shortcut_type: "shortlist",
    pivot_at: "2026-04-09T12:00:00.000Z",
    recommended_wait_window: "48 hours",
    outcome: "booked_consult",
    context: {
      summary: "State: CA • Insurance: Aetna",
      strategy: { directory_sort: "best_match" },
    },
  });

  assert.equal(document.therapistName, "Aubri Gomez, LCSW");
  assert.equal(document.shortcutType, "shortlist");
  assert.equal(document.pivotAt, "2026-04-09T12:00:00.000Z");
  assert.equal(document.recommendedWaitWindow, "48 hours");
  assert.equal(document.contextSummary, "State: CA • Insurance: Aetna");
});
