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
  });

  assert.equal(model.compareUrl, "match.html?shortlist=jamie-rivera");
  assert.equal(model.selected.length, 1);
  assert.equal(model.summary[0], "Jamie Rivera · Best fit");
  assert.ok(model.compareCards[0].meta.includes("Within 2 weeks"));
  assert.equal(model.compareCards[0].note, "Best fit");
});
