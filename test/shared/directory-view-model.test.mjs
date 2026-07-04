import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCardViewModel,
  buildDirectoryDetailsViewModel,
  buildDirectoryRecommendationModel,
} from "../../assets/directory-view-model.js";
import { getPreferredContactRoute } from "../../assets/directory-logic.js";
import { preloadZipcodes } from "../../assets/zip-lookup.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Seed the CA zipcodes dataset so the distance pill can resolve real ZIPs.
// assets/zip-lookup.js fetches this at runtime; in node we read the JSON and
// monkey-patch fetch, mirroring the other asset tests.
const zipUrl = new URL("../../assets/ca-zipcodes.json", import.meta.url);
const zipData = JSON.parse(readFileSync(fileURLToPath(zipUrl), "utf8"));
globalThis.fetch = async () => ({ ok: true, json: async () => zipData });
await preloadZipcodes();

test("buildCardViewModel: distance shows only for an in-person-only search", function () {
  const therapist = {
    slug: "nearby-inperson",
    name: "Nearby Therapist",
    city: "Beverly Hills",
    state: "CA",
    zip: "90211",
    accepts_in_person: true,
    accepts_telehealth: true,
    specialties: ["Bipolar I"],
  };
  const label = (filters) => buildCardViewModel({ therapist, filters }).distanceLabel;

  // in-person only, ZIP entered -> real distance (90210 -> 90211 is ~2mi)
  assert.match(label({ in_person: true, telehealth: false, zip: "90210" }), /mi away$/);

  // telehealth on, or "any" (neither), or no ZIP -> hidden
  assert.equal(label({ in_person: true, telehealth: true, zip: "90210" }), "");
  assert.equal(label({ in_person: false, telehealth: true, zip: "90210" }), "");
  assert.equal(label({ in_person: false, telehealth: false, zip: "90210" }), "");
  assert.equal(label({ in_person: true, telehealth: false }), "");

  // in-person, but the therapist doesn't see patients in person -> hidden
  assert.equal(
    buildCardViewModel({
      therapist: { ...therapist, accepts_in_person: false },
      filters: { in_person: true, telehealth: false, zip: "90210" },
    }).distanceLabel,
    "",
  );
});

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
  assert.ok(model.contactLabel.length > 0);
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
  // detailSections now contains only specialties / populations / medication — fee, insurance,
  // availability, and care format moved to quickAnswerPills
  assert.ok(detailsModel.detailSections.length >= 1);
  assert.ok(Array.isArray(detailsModel.quickAnswerPills));
  assert.ok(detailsModel.quickAnswerPills.length >= 2);
  assert.ok(
    detailsModel.quickAnswerPills.some(function (p) {
      return /\$/.test(p);
    }),
    "fee pill present",
  );
  assert.ok(
    detailsModel.quickAnswerPills.some(function (p) {
      return /Aetna|insurance/i.test(p);
    }),
    "insurance pill present",
  );
  assert.match(detailsModel.reassurance, /do not need to get this perfect/i);
});

test("directory contact routes reject unsafe public URLs and normalize contact hrefs", function () {
  const unsafeWebsite = getPreferredContactRoute({
    preferred_contact_method: "website",
    website: "javascript:alert(1)",
    booking_url: "",
    phone: " (555) 123-4567 ",
    email: "bad email",
  });
  assert.equal(unsafeWebsite.href, "tel:5551234567");

  const bareBooking = getPreferredContactRoute({
    preferred_contact_method: "booking",
    booking_url: "calendly.com/jamie",
    website: "",
    phone: "",
    email: "",
  });
  assert.equal(bareBooking.href, "https://calendly.com/jamie");
  assert.equal(bareBooking.external, true);

  const emailRoute = getPreferredContactRoute({
    preferred_contact_method: "email",
    email: "Jamie@Practice.Example",
  });
  assert.equal(emailRoute.href, "mailto:jamie@practice.example");
  assert.equal(emailRoute.external, false);
});

test("buildCardViewModel tolerates empty-state fallback calls without shortlist helpers", function () {
  const model = buildCardViewModel({
    therapist: {
      slug: "fallback-card",
      name: "Fallback Card",
      state: "CA",
      city: "Oakland",
      specialties: ["Bipolar I"],
      insurance_accepted: [],
      accepts_telehealth: true,
      accepting_new_patients: true,
      email: "fallback@example.com",
    },
    filters: {},
  });

  assert.equal(model.shortlisted, false);
  assert.equal(model.shortlistEntry, undefined);
  assert.equal(model.contactRoute.href, "mailto:fallback@example.com");
});

test("buildDirectoryDetailsViewModel: distance pill is empty for a ZIP outside the dataset (no '~Infinity mi')", function () {
  // getZipDistanceMiles returns Infinity (not null) when a ZIP isn't in the CA
  // dataset. The guard must drop the pill in that case rather than render
  // "~Infinity mi from ...".
  const outOfDataset = buildDirectoryDetailsViewModel({
    therapist: { slug: "t", name: "T", zip: "10001" }, // valid 5-digit, not in CA dataset
    filters: { sortZip: "94901" },
    shortlist: [],
    isShortlisted: function () {
      return false;
    },
  });
  assert.equal(outOfDataset.distancePill, "");

  // Control: two in-dataset ZIPs still produce a finite pill.
  const inDataset = buildDirectoryDetailsViewModel({
    therapist: { slug: "t", name: "T", zip: "94941" },
    filters: { sortZip: "94901" },
    shortlist: [],
    isShortlisted: function () {
      return false;
    },
  });
  assert.match(inDataset.distancePill, /^~\d+ mi from 94901$/);
});
