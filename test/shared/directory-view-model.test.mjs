import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCardViewModel,
  buildShortlistBarViewModel,
} from "../../assets/directory-view-model.js";

test("buildCardViewModel prepares a renderer-friendly card model", function () {
  const therapist = {
    slug: "jamie-rivera",
    name: "Jamie Rivera",
    city: "Los Angeles",
    state: "CA",
    credentials: "LMFT",
    title: "Therapist",
    specialties: ["Bipolar II", "Anxiety"],
    insurance_accepted: ["Aetna"],
    accepts_telehealth: true,
    accepts_in_person: false,
    accepting_new_patients: true,
    medication_management: false,
    bipolar_years_experience: 8,
    estimated_wait_time: "Within 2 weeks",
    session_fee_min: 160,
    bio_preview: "Collaborative bipolar-focused therapy.",
    verification_status: "editorially_verified",
    field_review_states: {
      estimated_wait_time: "editorially_verified",
      insurance_accepted: "editorially_verified",
      telehealth_states: "unknown",
      bipolar_years_experience: "editorially_verified",
    },
    therapist_reported_fields: ["estimated_wait_time"],
    therapist_reported_confirmed_at: new Date().toISOString(),
    preferred_contact_method: "booking",
    preferred_contact_label: "Book intro",
    booking_url: "https://example.com/book",
  };

  const model = buildCardViewModel({
    therapist,
    filters: {
      specialty: "Bipolar II",
      modality: "",
      population: "",
      insurance: "Aetna",
      telehealth: true,
      in_person: false,
      accepting: true,
      medication_management: false,
      responsive_contact: false,
    },
    shortlist: [{ slug: "jamie-rivera", priority: "Best fit", note: "Strong insurance fit" }],
    shortlistPriorityOptions: ["Best fit", "Best availability", "Best value"],
    isShortlisted: function (slug) {
      return slug === "jamie-rivera";
    },
  });

  assert.equal(model.shortlisted, true);
  assert.equal(model.contactRoute.label, "Book intro");
  assert.equal(model.footerLabel, "Book intro");
  assert.equal(model.shortlistEntry.note, "Strong insurance fit");
  assert.equal(model.freshnessBadge.label, "Recently re-confirmed");
  assert.ok(model.fitSummary.includes("focuses on bipolar ii"));
  assert.ok(model.trustTags.includes("Verified"));
  assert.ok(model.trustTags.includes("Highly decision-ready"));
  assert.ok(model.quickStats.some((item) => item.label === "Fees" && item.value === "$160"));
});

test("buildShortlistBarViewModel prepares shortlist comparison content", function () {
  const therapists = [
    {
      slug: "jamie-rivera",
      name: "Jamie Rivera",
      bipolar_years_experience: 8,
      estimated_wait_time: "Within 2 weeks",
      session_fee_min: 160,
      field_review_states: {},
      specialties: ["Bipolar II"],
      insurance_accepted: ["Aetna"],
    },
    {
      slug: "alex-chen",
      name: "Alex Chen",
      bipolar_years_experience: 10,
      accepting_new_patients: true,
      estimated_wait_time: "Within 1 week",
      session_fee_min: 150,
      verification_status: "editorially_verified",
      accepts_telehealth: true,
      field_review_states: {},
      specialties: ["Bipolar II"],
      insurance_accepted: ["Aetna"],
      preferred_contact_method: "email",
      email: "alex@example.com",
    },
    {
      slug: "morgan-lee",
      name: "Morgan Lee",
      bipolar_years_experience: 7,
      accepting_new_patients: true,
      estimated_wait_time: "Within 5 days",
      session_fee_min: 180,
      verification_status: "editorially_verified",
      accepts_telehealth: true,
      field_review_states: {},
      specialties: ["Bipolar II"],
      insurance_accepted: ["Aetna"],
      preferred_contact_method: "email",
      email: "morgan@example.com",
    },
  ];

  const model = buildShortlistBarViewModel({
    shortlist: [{ slug: "jamie-rivera", priority: "Best fit", note: "" }],
    therapists,
    filters: {
      specialty: "Bipolar II",
      modality: "",
      population: "",
      insurance: "",
      telehealth: false,
      in_person: false,
      accepting: false,
      medication_management: false,
      responsive_contact: false,
    },
    buildCompareUrl: function () {
      return "match.html?shortlist=jamie-rivera";
    },
    outreachOutcomes: [
      {
        therapist_slug: "morgan-lee",
        outcome: "heard_back",
        recorded_at: "2026-04-10T12:00:00.000Z",
      },
    ],
  });

  assert.equal(model.compareUrl, "match.html?shortlist=jamie-rivera");
  assert.equal(model.selected.length, 1);
  assert.equal(model.summary[0], "Jamie Rivera · Best fit");
  assert.ok(model.compareCards[0].meta.includes("Within 2 weeks"));
  assert.equal(model.compareCards[0].note, "You marked this as best fit.");
  assert.equal(model.compareCards[0].noteTitle, "Saved role");
  assert.ok(model.compareCards[0].changedCopy.includes("Nothing live has changed yet"));
  assert.equal(model.compareCards[0].pruneCta, "Still looks useful");
  assert.equal(model.compareCards[0].replacement.name, "Morgan Lee");
  assert.equal(model.compareCards[0].replacement.roleLabel, "Best replacement for fit");
  assert.ok(model.compareCards[0].replacement.reason.includes("Heard back"));
  assert.ok(model.compareCards[0].replacement.edgeCopy.includes("Jamie Rivera"));
  assert.equal(model.compareCards[0].replacement.confidence.label, "Strong swap now");
  assert.equal(model.reshapingSuggestions.length, 2);
  assert.equal(model.reshapingSuggestions[0].title, "Best lead replacement");
  assert.equal(model.reshapingSuggestions[1].title, "Best backup replacement");
  assert.equal(model.reshapingSuggestions[0].name, "Morgan Lee");
  assert.ok(model.reshapingSuggestions[0].edgeCopy.includes("Jamie Rivera"));
  assert.equal(model.reshapingSuggestions[0].confidence.tone, "strong");
  assert.equal(model.reshapingSuggestions[1].name, "Alex Chen");
  assert.equal(model.reshapingSummary.title, "What changed in this shortlist");
  assert.ok(model.reshapingSummary.bullets[0].includes("Morgan Lee"));
  assert.ok(model.reshapingSummary.bullets[0].includes("Heard back"));
  assert.equal(model.reshapingPlan.changed, true);
  assert.equal(model.reshapingPlan.entries[0].slug, "morgan-lee");
  assert.equal(model.reshapingReview.title, "Review the reshape before applying it");
  assert.equal(model.reshapingReview.rows[0].beforeName, "Jamie Rivera");
  assert.equal(model.reshapingReview.rows[0].afterName, "Morgan Lee");
  assert.equal(model.reshapingReview.rows[0].changed, true);
});
