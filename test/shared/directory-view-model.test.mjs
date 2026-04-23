import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCardViewModel,
  buildDirectoryDetailsViewModel,
  buildDirectoryRecommendationModel,
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
    isShortlisted: function (slug) {
      return slug === "jamie-rivera";
    },
  });

  assert.equal(model.shortlisted, true);
  assert.equal(model.contactRoute.label, "Book intro");
  assert.equal(model.contactLabel, "Contact therapist");
  assert.equal(model.shortlistEntry.note, "Strong insurance fit");
  assert.equal(model.acceptance, "Accepting new patients");
  assert.ok(model.feeSummary.includes("160"));
  assert.ok(model.fitReasons.length >= 1);
  assert.ok(model.trustSignals.length >= 1);
  assert.equal(typeof model.valuePillHtml, "string");
});

test("recommendation and details models expose guidance-first copy", function () {
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
    accepts_in_person: true,
    accepting_new_patients: true,
    medication_management: false,
    bipolar_years_experience: 8,
    estimated_wait_time: "Within 2 weeks",
    session_fee_min: 160,
    verification_status: "editorially_verified",
    field_review_states: {
      estimated_wait_time: "editorially_verified",
      insurance_accepted: "editorially_verified",
      bipolar_years_experience: "editorially_verified",
    },
    therapist_reported_fields: ["estimated_wait_time"],
    therapist_reported_confirmed_at: new Date().toISOString(),
    preferred_contact_method: "booking",
    preferred_contact_label: "Book intro",
    booking_url: "https://example.com/book",
  };

  const recommendationModel = buildDirectoryRecommendationModel({
    featuredTherapist: therapist,
    backupTherapists: [therapist],
    filters: {
      insurance: "Aetna",
      telehealth: true,
      in_person: false,
      accepting: true,
      medication_management: false,
    },
    shortlist: [],
    isShortlisted: function () {
      return false;
    },
  });

  const detailsModel = buildDirectoryDetailsViewModel({
    therapist,
    filters: {
      insurance: "Aetna",
      telehealth: true,
      in_person: false,
      accepting: true,
      medication_management: false,
    },
    shortlist: [],
    isShortlisted: function () {
      return false;
    },
  });

  assert.equal(recommendationModel.featured.contactLabel, "Contact therapist");
  assert.ok(recommendationModel.featured.fitReasons.length >= 1);
  assert.equal(recommendationModel.backups.length, 1);
  assert.ok(detailsModel.detailSections.length >= 4);
  assert.match(detailsModel.reassurance, /do not need to get this perfect/i);
});
