import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDirectoryTestControls,
  buildDirectoryTestTherapist,
  runDirectoryTestFlow,
} from "./directory-test-helpers.mjs";

test("directory flow harness applies controls, sorts results, and renders the top card", function () {
  const therapists = [
    buildDirectoryTestTherapist(),
    buildDirectoryTestTherapist({
      slug: "sam-lee",
      name: "Sam Lee",
      specialties: ["Anxiety"],
      insurance_accepted: [],
      bipolar_years_experience: 2,
      estimated_wait_time: "Waitlist only",
      session_fee_min: 220,
      verification_status: "",
      field_review_states: {},
      therapist_reported_fields: [],
      therapist_reported_confirmed_at: "",
      preferred_contact_method: "website",
      preferred_contact_label: "Visit site",
      booking_url: "",
      website: "https://example.com/site",
    }),
    buildDirectoryTestTherapist({
      slug: "avery-chen",
      name: "Avery Chen",
      session_fee_min: 190,
      accepts_in_person: true,
    }),
    buildDirectoryTestTherapist({
      slug: "riley-ng",
      name: "Riley Ng",
      session_fee_min: 175,
      accepts_in_person: true,
    }),
    buildDirectoryTestTherapist({
      slug: "morgan-patel",
      name: "Morgan Patel",
      session_fee_min: 150,
      accepts_in_person: true,
    }),
  ];

  const flow = runDirectoryTestFlow({ therapists });

  assert.equal(flow.renderState.featuredTherapist.slug, "avery-chen");
  assert.equal(flow.renderState.backupTherapists.length, 2);
  assert.equal(flow.renderState.pageItems[0].slug, "riley-ng");
  assert.equal(flow.renderState.activePreviewSlug, "avery-chen");
  assert.equal(flow.renderState.activeFilterCount, 6);
  assert.match(flow.html, /Riley Ng/);
  assert.match(flow.html, /Contact therapist/);
  assert.match(flow.html, /Save/);
});

test("directory flow harness exposes empty results when filters overconstrain the list", function () {
  const therapists = [
    buildDirectoryTestTherapist({
      specialties: ["Anxiety"],
      insurance_accepted: [],
    }),
  ];

  const flow = runDirectoryTestFlow({
    therapists,
    controls: buildDirectoryTestControls({
      specialty: { value: "Bipolar I" },
      insurance: { value: "United" },
    }),
  });

  assert.equal(flow.renderState.results.length, 0);
  assert.equal(flow.renderState.pageItems.length, 0);
  assert.equal(flow.renderState.activePreviewSlug, "");
});

test("directory flow harness responds to sort changes in controller state", function () {
  const therapists = [
    buildDirectoryTestTherapist({
      slug: "later-fit",
      name: "Later Fit",
      estimated_wait_time: "Waitlist only",
      bipolar_years_experience: 10,
      session_fee_min: 140,
    }),
    buildDirectoryTestTherapist({
      slug: "fast-option",
      name: "Fast Option",
      specialties: ["Bipolar II"],
      estimated_wait_time: "Immediate availability",
      bipolar_years_experience: 4,
      session_fee_min: 180,
    }),
  ];

  const flow = runDirectoryTestFlow({
    therapists,
    controls: buildDirectoryTestControls({
      sortBy: { value: "soonest_availability" },
      insurance: { value: "" },
    }),
  });

  assert.equal(flow.sortChanged.filters.sortBy, "soonest_availability");
  assert.equal(flow.renderState.featuredTherapist.slug, "fast-option");
});
