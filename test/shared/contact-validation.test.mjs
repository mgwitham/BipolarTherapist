import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeUrl,
  validateBookingUrl,
  validateEmail,
  validatePhone,
  validatePublicContactPresence,
  validateWebsite,
} from "../../shared/contact-validation.mjs";

test("validatePhone: accepts a realistic US number", () => {
  assert.equal(validatePhone("(415) 867-2345").valid, true);
  assert.equal(validatePhone("415-867-2345").valid, true);
  assert.equal(validatePhone("+1 415 867 2345").valid, true);
});

test("validatePhone: empty value is allowed (presence is a separate check)", () => {
  assert.equal(validatePhone("").valid, true);
  assert.equal(validatePhone(null).valid, true);
  assert.equal(validatePhone(undefined).valid, true);
});

test("validatePhone: rejects short numbers", () => {
  assert.equal(validatePhone("123-456").valid, false);
  assert.equal(validatePhone("867-2345").valid, false);
});

test("validatePhone: rejects area codes 000, 555, 999", () => {
  assert.equal(validatePhone("(000) 867-2345").valid, false);
  assert.equal(validatePhone("(555) 867-2345").valid, false);
  assert.equal(validatePhone("(999) 867-2345").valid, false);
});

test("validatePhone: rejects all-same digits", () => {
  assert.equal(validatePhone("(555) 555-5555").valid, false);
  assert.equal(validatePhone("(111) 111-1111").valid, false);
  assert.equal(validatePhone("2222222222").valid, false);
});

test("validatePhone: rejects sequential digits forward and backward", () => {
  assert.equal(validatePhone("123-456-7890").valid, false);
  assert.equal(validatePhone("1234567890").valid, false);
  assert.equal(validatePhone("0987654321").valid, false);
});

test("validatePhone: rejects all-zero subscriber number", () => {
  assert.equal(validatePhone("(415) 867-0000").valid, false);
  assert.equal(validatePhone("(415) 555-0000").valid, false);
});

test("validatePhone: rejects reserved 555-01XX fictional range", () => {
  assert.equal(validatePhone("(415) 555-0100").valid, false);
  assert.equal(validatePhone("(415) 555-0150").valid, false);
  assert.equal(validatePhone("(415) 555-0199").valid, false);
});

test("validatePhone: accepts outside the reserved 555 band when exchange is not 555", () => {
  assert.equal(validatePhone("(415) 867-0150").valid, true);
});

test("validateEmail: accepts a real-looking address", () => {
  assert.equal(validateEmail("jamie@bipolartherapyhub.com").valid, true);
});

test("validateEmail: accepts generic prefixes at real domains", () => {
  assert.equal(validateEmail("info@practice.com").valid, true);
  assert.equal(validateEmail("contact@practice.org").valid, true);
  assert.equal(validateEmail("office@practice.net").valid, true);
  assert.equal(validateEmail("hello@practice.com").valid, true);
  assert.equal(validateEmail("support@practice.com").valid, true);
  assert.equal(validateEmail("admin@practice.com").valid, true);
});

test("validateEmail: empty value is allowed", () => {
  assert.equal(validateEmail("").valid, true);
  assert.equal(validateEmail(null).valid, true);
});

test("validateEmail: rejects malformed addresses", () => {
  assert.equal(validateEmail("not-an-email").valid, false);
  assert.equal(validateEmail("missing@tld").valid, false);
  assert.equal(validateEmail("double@@at.com").valid, false);
  assert.equal(validateEmail("has space@domain.com").valid, false);
  assert.equal(validateEmail("@nolocal.com").valid, false);
  assert.equal(validateEmail("nolocaltrailing@").valid, false);
});

test("validateEmail: rejects placeholder local parts", () => {
  assert.equal(validateEmail("test@practice.com").valid, false);
  assert.equal(validateEmail("example@practice.com").valid, false);
  assert.equal(validateEmail("placeholder@practice.com").valid, false);
  assert.equal(validateEmail("YourName@practice.com").valid, false);
  assert.equal(validateEmail("email@practice.com").valid, false);
});

test("validateEmail: rejects placeholder domains", () => {
  assert.equal(validateEmail("jamie@example.com").valid, false);
  assert.equal(validateEmail("jamie@example.org").valid, false);
  assert.equal(validateEmail("jamie@test.com").valid, false);
  assert.equal(validateEmail("jamie@yoursite.com").valid, false);
  assert.equal(validateEmail("jamie@localhost").valid, false);
});

test("validateEmail: rejects when local equals the domain label", () => {
  assert.equal(validateEmail("email@email.com").valid, false);
  assert.equal(validateEmail("test@test.com").valid, false);
});

test("normalizeUrl: empty string returns empty string", () => {
  assert.equal(normalizeUrl(""), "");
  assert.equal(normalizeUrl(null), "");
  assert.equal(normalizeUrl(undefined), "");
});

test("normalizeUrl: bare domain gets https:// prepended", () => {
  assert.equal(normalizeUrl("bipolartherapyhub.com"), "https://bipolartherapyhub.com");
});

test("normalizeUrl: www. prefix gets https:// prepended", () => {
  assert.equal(normalizeUrl("www.bipolartherapyhub.com"), "https://www.bipolartherapyhub.com");
});

test("normalizeUrl: existing http:// preserved", () => {
  assert.equal(normalizeUrl("http://practice.com"), "http://practice.com");
});

test("normalizeUrl: existing https:// preserved", () => {
  assert.equal(normalizeUrl("https://practice.com"), "https://practice.com");
});

test("normalizeUrl: uppercase protocol preserved", () => {
  assert.equal(normalizeUrl("HTTPS://practice.com"), "HTTPS://practice.com");
  assert.equal(normalizeUrl("HTTP://practice.com"), "HTTP://practice.com");
});

test("normalizeUrl: whitespace trimmed", () => {
  assert.equal(normalizeUrl("  practice.com  "), "https://practice.com");
});

test("validateWebsite: accepts bare domain (normalized internally)", () => {
  assert.equal(validateWebsite("bipolartherapyhub.com").valid, true);
  assert.equal(validateWebsite("www.bipolartherapyhub.com").valid, true);
  assert.equal(validateWebsite("  bipolartherapyhub.com  ").valid, true);
});

test("validateWebsite: accepts real https/http URLs", () => {
  assert.equal(validateWebsite("https://practice.com").valid, true);
  assert.equal(validateWebsite("http://practice.com").valid, true);
});

test("validateWebsite: empty is allowed", () => {
  assert.equal(validateWebsite("").valid, true);
});

test("validateWebsite: rejects garbage text with invalid-website message", () => {
  const result = validateWebsite("ljkasdjf");
  assert.equal(result.valid, false);
  assert.match(result.error, /doesn't look like a website/i);
});

test("validateWebsite: rejects placeholder hosts with website-specific message", () => {
  const result = validateWebsite("example.com");
  assert.equal(result.valid, false);
  assert.match(result.error, /placeholder/i);
  assert.match(result.error, /website/i);
  assert.equal(validateWebsite("yoursite.com").valid, false);
  assert.equal(validateWebsite("placeholder.com").valid, false);
  assert.equal(validateWebsite("http://localhost:8080").valid, false);
  assert.equal(validateWebsite("https://www.example.com").valid, false);
});

test("validateBookingUrl: accepts bare domains and full URLs", () => {
  assert.equal(validateBookingUrl("calendly.com/jamie").valid, true);
  assert.equal(validateBookingUrl("https://calendly.com/jamie").valid, true);
  assert.equal(validateBookingUrl("http://booking.example-clinic.co").valid, true);
});

test("validateBookingUrl: empty is allowed", () => {
  assert.equal(validateBookingUrl("").valid, true);
});

test("validateBookingUrl: rejects placeholder hosts with booking-specific message", () => {
  const result = validateBookingUrl("example.com");
  assert.equal(result.valid, false);
  assert.match(result.error, /placeholder/i);
  assert.match(result.error, /booking/i);
});

test("validateBookingUrl: rejects garbage text", () => {
  assert.equal(validateBookingUrl("ljkasdjf").valid, false);
});

test("validatePublicContactPresence: valid when any field populated", () => {
  assert.equal(
    validatePublicContactPresence({
      email: "jamie@practice.com",
      phone: "",
      website: "",
      bookingUrl: "",
    }).valid,
    true,
  );
  assert.equal(validatePublicContactPresence({ phone: "415-867-2345" }).valid, true);
  assert.equal(
    validatePublicContactPresence({
      email: "",
      phone: "",
      website: "https://practice.com",
      bookingUrl: "",
    }).valid,
    true,
  );
});

test("validatePublicContactPresence: invalid when all blank", () => {
  const result = validatePublicContactPresence({
    email: "",
    phone: "  ",
    website: "",
    bookingUrl: null,
  });
  assert.equal(result.valid, false);
  assert.match(result.error, /at least one way/i);
});
