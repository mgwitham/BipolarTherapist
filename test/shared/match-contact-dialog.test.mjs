import test from "node:test";
import assert from "node:assert/strict";

import {
  formatPhoneDisplay,
  getContactRoutes,
  getDomainFromUrl,
  renderContactDialogBody,
} from "../../assets/match-contact-dialog.js";

test("getDomainFromUrl strips protocol + www, and is safe on junk", function () {
  assert.equal(getDomainFromUrl("https://www.example.com/book"), "example.com");
  assert.equal(getDomainFromUrl("https://sub.example.com"), "sub.example.com");
  assert.equal(getDomainFromUrl("not a url"), "");
});

test("formatPhoneDisplay normalizes 10- and 11-digit US numbers", function () {
  assert.equal(formatPhoneDisplay("4155551234"), "(415) 555-1234");
  assert.equal(formatPhoneDisplay("14155551234"), "(415) 555-1234");
  assert.equal(formatPhoneDisplay("+1 (415) 555-1234"), "(415) 555-1234");
  // Non-standard length falls back to trimmed original.
  assert.equal(formatPhoneDisplay("555-1234"), "555-1234");
});

test("getContactRoutes builds routes in phone/email/booking/website order", function () {
  const routes = getContactRoutes({
    therapist: {
      phone: "4155551234",
      email: "dr@example.com",
      booking_url: "calendly.com/dr",
      website: "https://drsite.com",
    },
  });
  assert.deepEqual(
    routes.map((r) => r.type),
    ["phone", "email", "booking", "website"],
  );
  assert.equal(routes[0].href, "tel:4155551234");
  assert.equal(routes[1].href, "mailto:dr@example.com");
  assert.equal(routes[2].href, "https://calendly.com/dr"); // bare domain gets https://
  assert.equal(routes[3].display, "drsite.com");
});

test("getContactRoutes skips the placeholder email and missing channels", function () {
  const routes = getContactRoutes({
    therapist: { email: "contact@example.com", phone: "" },
  });
  assert.equal(routes.length, 0);
});

test("renderContactDialogBody returns the shared modal HTML for a therapist", function () {
  const html = renderContactDialogBody(
    { therapist: { name: "Dr. A", email: "dr@example.com" } },
    { isMobile: false },
  );
  assert.equal(typeof html, "string");
  assert.ok(html.length > 0);
});
