import test from "node:test";
import assert from "node:assert/strict";

import {
  annotateMatchOutcomeForDisplay,
  annotateMatchRequestForDisplay,
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

test("buildMatchRequestDocument caps _id under Sanity's 128-char limit for long request_ids", function () {
  // Mirrors the exact prod request_id that triggered a 500 from /api/review/match/requests:
  // the care_state plus every top shortlist slug concatenated produces an id far over 128 chars.
  const longRequestId =
    "1776380164868-ca-dr-keith-valone-pasadena-ca-dr-daniel-kaushansky-los-angeles-ca-aubri-gomez-los-angeles-ca-heidi-jackson-santa-monica-ca-kandice-timmons-beverly-hills-ca-kara-park-pasadena-ca";

  const document = buildMatchRequestDocument({
    request_id: longRequestId,
    care_state: "CA",
    care_intent: "Therapy",
  });

  assert.ok(document._id.length <= 128, `_id exceeded 128 chars: ${document._id}`);
  assert.ok(document._id.startsWith("match-request-"));
  // Deterministic: the same request_id must produce the same _id so createOrReplace stays idempotent.
  const again = buildMatchRequestDocument({
    request_id: longRequestId,
    care_state: "CA",
    care_intent: "Therapy",
  });
  assert.equal(document._id, again._id);
});

test("buildMatchRequestDocument preserves short request_ids as-is", function () {
  const document = buildMatchRequestDocument({
    request_id: "journey-124",
    care_intent: "Therapy",
  });
  assert.equal(document._id, "match-request-journey-124");
});

test("buildMatchOutcomeDocument caps _id under Sanity's 128-char limit for long outcome_ids", function () {
  const longOutcomeId =
    "outcome-1776380164868-ca-dr-keith-valone-pasadena-ca-dr-daniel-kaushansky-los-angeles-ca-aubri-gomez-los-angeles-ca-heidi-jackson-santa-monica-ca-kandice-timmons-beverly-hills-ca";

  const document = buildMatchOutcomeDocument({
    outcome_id: longOutcomeId,
    request_id: "journey-125",
    therapist_slug: "aubri-gomez-los-angeles-ca",
    recorded_at: "2026-04-16T22:56:04.000Z",
    outcome: "booked_consult",
  });

  assert.ok(document._id.length <= 128, `_id exceeded 128 chars: ${document._id}`);
  assert.ok(document._id.startsWith("match-outcome-"));
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

test("annotateMatchRequestForDisplay adds human-readable labels for normalized fields", function () {
  const annotated = annotateMatchRequestForDisplay({
    careFormat: "telehealth",
    careIntent: "therapy",
    needsMedicationManagement: "open",
    priorityMode: "best_overall_fit",
    urgency: "within_2_weeks",
    bipolarFocus: ["bipolar_ii"],
    preferredModalities: ["cbt"],
    populationFit: ["lgbtq"],
    languagePreferences: ["english", "tagalog"],
  });

  assert.equal(annotated.labels.careFormat, "Telehealth");
  assert.equal(annotated.labels.priorityMode, "Best overall fit");
  assert.equal(annotated.labels.urgency, "Within 2 weeks");
  assert.deepEqual(annotated.labels.bipolarFocus, ["Bipolar II"]);
  assert.deepEqual(annotated.labels.populationFit, ["LGBTQ+"]);
  assert.deepEqual(annotated.labels.languagePreferences, ["English", "Tagalog"]);
});

test("annotateMatchOutcomeForDisplay adds human-readable labels for normalized outcome fields", function () {
  const annotated = annotateMatchOutcomeForDisplay({
    outcome: "booked_consult",
    routeType: "profile",
    shortcutType: "shortlist",
  });

  assert.equal(annotated.labels.outcome, "Booked consult");
  assert.equal(annotated.labels.routeType, "Profile");
  assert.equal(annotated.labels.shortcutType, "shortlist");
});
