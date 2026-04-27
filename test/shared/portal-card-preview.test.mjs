import test from "node:test";
import assert from "node:assert/strict";

import { renderPortalCardPreview } from "../../assets/portal-card-preview.js";

test("portal preview renders placeholders when no fields are set", function () {
  const html = renderPortalCardPreview({});
  assert.match(html, /bth-card-preview/, "marks the card as a preview");
  assert.match(html, /bth-pill-placeholder/, "shows two placeholder specialty pills");
  assert.match(html, /Your approach will appear here/, "shows the voice placeholder copy");
  assert.match(html, /Set how you see clients/, "shows the location placeholder");
  assert.match(html, /Send an email/, "defaults the CTA to Email");
});

test("portal preview renders real specialties when supplied", function () {
  const html = renderPortalCardPreview({
    name: "Dr. Test",
    specialties: ["Bipolar II", "Mood stabilization", "Med management"],
    accepts_telehealth: true,
    state: "California",
  });
  assert.match(html, /Bipolar II/);
  assert.match(html, /Mood stabilization/);
  assert.match(html, /Med management/);
  assert.doesNotMatch(html, /bth-pill-placeholder/);
});

test("portal preview surfaces care_approach as the voice slot when populated", function () {
  const html = renderPortalCardPreview({
    care_approach: "I help people with bipolar II find lasting routines.",
    claim_status: "claimed",
  });
  // Claimed clinicians get quotation marks per the cascade rule
  assert.match(html, /lasting routines/);
  assert.doesNotMatch(html, /Your approach will appear here/);
});

test("portal preview swaps CTA label by preferred contact method", function () {
  const phone = renderPortalCardPreview({ preferred_contact_method: "phone" });
  assert.match(phone, /Call now/);

  const booking = renderPortalCardPreview({ preferred_contact_method: "booking" });
  assert.match(booking, /Book a consult/);

  const email = renderPortalCardPreview({ preferred_contact_method: "email" });
  assert.match(email, /Send an email/);
});

test("portal preview shows insurance on cost line when present", function () {
  const html = renderPortalCardPreview({
    insurance_accepted: ["Aetna", "BCBS", "Cigna"],
    accepts_telehealth: true,
    state: "California",
  });
  assert.match(html, /Aetna, BCBS \+1 more|Aetna, BCBS \+1/, "first 2 insurers + overflow");
});

test("portal preview shows fee range when no insurance present", function () {
  const html = renderPortalCardPreview({
    session_fee_min: 150,
    session_fee_max: 220,
    accepts_in_person: true,
    city: "Los Angeles",
    state: "CA",
  });
  assert.match(html, /\$150–\$220\/session/);
});

test("portal preview swaps placeholder when practice mode is set", function () {
  const html = renderPortalCardPreview({
    accepts_in_person: true,
    accepts_telehealth: true,
    city: "Pasadena",
    state: "CA",
  });
  assert.doesNotMatch(html, /Set how you see clients/);
  assert.match(html, /Pasadena, CA/);
});
