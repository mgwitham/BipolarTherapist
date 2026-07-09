import test from "node:test";
import assert from "node:assert/strict";

import { getPreferredContactRoute } from "../../assets/directory-logic.js";
import { withReferralAttribution } from "../../shared/contact-href.mjs";

// Outbound booking/website hrefs carry hub referral attribution (campaign
// "directory" from getPreferredContactRoute) so a real click-through shows up
// as bipolartherapyhub.com in the therapist's analytics.
const ref = (url) => withReferralAttribution(url, { campaign: "directory" });

test("getPreferredContactRoute returns null when nothing is usable", () => {
  assert.equal(getPreferredContactRoute({}), null);
  // Invalid phone + placeholder email + nothing else -> still null.
  assert.equal(getPreferredContactRoute({ phone: "+", email: "contact@example.com" }), null);
});

test("getPreferredContactRoute falls back booking > website > phone > email", () => {
  const all = {
    booking_url: "https://book.example.com",
    website: "https://example.com",
    phone: "415-555-2671",
    email: "jane@example.com",
  };
  assert.equal(getPreferredContactRoute(all).href, ref("https://book.example.com/"));
  assert.equal(
    getPreferredContactRoute({ ...all, booking_url: "" }).href,
    ref("https://example.com/"),
  );
  assert.equal(
    getPreferredContactRoute({ phone: all.phone, email: all.email }).href,
    "tel:4155552671",
  );
  assert.equal(getPreferredContactRoute({ email: all.email }).href, "mailto:jane@example.com");
});

test("getPreferredContactRoute honors a reachable preferred_contact_method", () => {
  const route = getPreferredContactRoute({
    preferred_contact_method: "phone",
    booking_url: "https://book.example.com",
    phone: "415-555-2671",
  });
  assert.equal(route.href, "tel:4155552671");
  assert.equal(route.external, false);
});

test("getPreferredContactRoute skips a preferred route that's health-flagged and explains the fallback", () => {
  const route = getPreferredContactRoute({
    preferred_contact_method: "booking",
    booking_url: "https://book.example.com",
    source_health_status: "broken",
    source_url: "https://book.example.com",
    phone: "415-555-2671",
  });
  assert.equal(route.href, "tel:4155552671", "fell back to phone");
  assert.match(route.detail, /booking link looks unavailable/);
});

test("getPreferredContactRoute ignores the placeholder email and an invalid phone", () => {
  const route = getPreferredContactRoute({
    phone: "+", // invalid -> no phone route
    email: "contact@example.com", // placeholder -> excluded
    website: "https://example.com",
  });
  assert.equal(route.href, ref("https://example.com/"));
});

test("getPreferredContactRoute applies a custom label", () => {
  const route = getPreferredContactRoute({
    preferred_contact_label: "Reach Dr. Lee",
    phone: "415-555-2671",
  });
  assert.equal(route.label, "Reach Dr. Lee");
});
