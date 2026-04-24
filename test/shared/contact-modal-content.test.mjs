import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContactDraftMessage,
  buildContactModalContent,
  buildSecondaryContacts,
  extractFirstName,
  formatPhoneDisplay,
  resolvePreferredContactMethod,
} from "../../shared/contact-modal-content.mjs";

// ── resolvePreferredContactMethod ──────────────────────────────

test("resolvePreferredContactMethod: honors explicit value when that field is populated", () => {
  assert.equal(
    resolvePreferredContactMethod({
      preferredContactMethod: "phone",
      phone: "415-867-2345",
      email: "jamie@practice.com",
      website: "https://practice.com",
      bookingUrl: "https://calendly.com/jamie",
    }),
    "phone",
  );
});

test("resolvePreferredContactMethod: default-picker order is booking > website > phone > email", () => {
  assert.equal(
    resolvePreferredContactMethod({
      phone: "415-867-2345",
      email: "jamie@practice.com",
      website: "https://practice.com",
      bookingUrl: "https://calendly.com/jamie",
    }),
    "booking",
  );
  assert.equal(
    resolvePreferredContactMethod({
      phone: "415-867-2345",
      email: "jamie@practice.com",
      website: "https://practice.com",
    }),
    "website",
  );
  assert.equal(
    resolvePreferredContactMethod({
      phone: "415-867-2345",
      email: "jamie@practice.com",
    }),
    "phone",
  );
  assert.equal(resolvePreferredContactMethod({ email: "jamie@practice.com" }), "email");
});

test("resolvePreferredContactMethod: falls back when explicit choice points at empty field", () => {
  // Therapist says they prefer booking, but bookingUrl is empty after
  // validation cleared it. Default-picker should take over.
  assert.equal(
    resolvePreferredContactMethod({
      preferredContactMethod: "booking",
      bookingUrl: "",
      website: "https://practice.com",
      phone: "",
      email: "",
    }),
    "website",
  );
});

test("resolvePreferredContactMethod: returns null when nothing is populated", () => {
  assert.equal(resolvePreferredContactMethod({}), null);
  assert.equal(
    resolvePreferredContactMethod({
      preferredContactMethod: "email",
      email: "",
    }),
    null,
  );
});

// ── extractFirstName / formatPhoneDisplay / buildContactDraftMessage ──

test("extractFirstName: strips honorifics and trailing credentials", () => {
  assert.equal(extractFirstName("Dr. Jamie Rivera, LMFT"), "Jamie");
  assert.equal(extractFirstName("Mx Alex Chen PhD"), "Alex");
  assert.equal(extractFirstName(""), "");
});

test("formatPhoneDisplay: formats 10-digit and 11-digit US numbers", () => {
  assert.equal(formatPhoneDisplay("4158672345"), "(415) 867-2345");
  assert.equal(formatPhoneDisplay("14158672345"), "(415) 867-2345");
  assert.equal(formatPhoneDisplay("+1 415 867 2345"), "(415) 867-2345");
});

test("buildContactDraftMessage: uses first name and fixed body text", () => {
  const msg = buildContactDraftMessage({ name: "Dr. Jamie Rivera, LMFT" });
  assert.match(msg, /^Hi Jamie,/);
  assert.match(msg, /BipolarTherapyHub/);
  assert.match(msg, /accepting new patients\?$/);
});

// ── buildSecondaryContacts ─────────────────────────────────────

const FULL_THERAPIST = {
  name: "Dr. Jamie Rivera",
  phone: "415-867-2345",
  email: "jamie@practice.com",
  website: "https://practice.com",
  bookingUrl: "https://calendly.com/jamie",
};

test("buildSecondaryContacts (booking layout): phone, email, website — no booking", () => {
  const secondaries = buildSecondaryContacts("booking", FULL_THERAPIST);
  assert.deepEqual(
    secondaries.map((s) => s.method),
    ["phone", "email", "website"],
  );
});

test("buildSecondaryContacts (website layout): phone, email only — excludes booking", () => {
  const secondaries = buildSecondaryContacts("website", FULL_THERAPIST);
  assert.deepEqual(
    secondaries.map((s) => s.method),
    ["phone", "email"],
  );
});

test("buildSecondaryContacts (phone layout): email, website, booking — no phone", () => {
  const secondaries = buildSecondaryContacts("phone", FULL_THERAPIST);
  assert.deepEqual(
    secondaries.map((s) => s.method),
    ["email", "website", "booking"],
  );
});

test("buildSecondaryContacts (email layout): phone, website, booking — no email", () => {
  const secondaries = buildSecondaryContacts("email", FULL_THERAPIST);
  assert.deepEqual(
    secondaries.map((s) => s.method),
    ["phone", "website", "booking"],
  );
});

test("buildSecondaryContacts: skips fields the therapist hasn't populated", () => {
  const phoneOnly = buildSecondaryContacts("booking", {
    phone: "415-867-2345",
    email: "",
    website: "",
  });
  assert.deepEqual(
    phoneOnly.map((s) => s.method),
    ["phone"],
  );
});

test("buildSecondaryContacts: phone entries use tel: href and formatted display", () => {
  const secondaries = buildSecondaryContacts("booking", FULL_THERAPIST);
  const phone = secondaries.find((s) => s.method === "phone");
  assert.equal(phone.href, "tel:4158672345");
  assert.equal(phone.display, "(415) 867-2345");
});

test("buildSecondaryContacts: website + booking are marked external (target=_blank)", () => {
  const secondaries = buildSecondaryContacts("phone", FULL_THERAPIST);
  assert.equal(secondaries.find((s) => s.method === "website").external, true);
  assert.equal(secondaries.find((s) => s.method === "booking").external, true);
  assert.equal(secondaries.find((s) => s.method === "email").external, false);
});

// ── buildContactModalContent: layout selection ─────────────────

test("buildContactModalContent: booking layout renders 'Book with [First]'", () => {
  const result = buildContactModalContent({
    ...FULL_THERAPIST,
    preferredContactMethod: "booking",
  });
  assert.equal(result.layout, "booking");
  assert.match(result.html, /Book with Jamie/);
  assert.match(result.html, /Open booking page/);
  assert.match(result.html, /data-contact-primary="booking"/);
  // Secondary label
  assert.match(result.html, /Prefer to reach out first\?/);
});

test("buildContactModalContent: website layout renders 'Visit [First]'s website'", () => {
  const result = buildContactModalContent({
    ...FULL_THERAPIST,
    preferredContactMethod: "website",
  });
  assert.equal(result.layout, "website");
  assert.match(result.html, /Visit Jamie&#39;s website/);
  assert.match(result.html, /Open practice site/);
  assert.match(result.html, /Prefer to reach out directly\?/);
  // Booking must NOT be in the secondary list for website layout
  assert.equal(/data-contact-other-route="booking"/.test(result.html), false);
});

test("buildContactModalContent: phone layout uses tel: link on mobile", () => {
  const result = buildContactModalContent(
    { ...FULL_THERAPIST, preferredContactMethod: "phone" },
    { isMobile: true },
  );
  assert.equal(result.layout, "phone");
  assert.match(result.html, /Call Jamie/);
  assert.match(result.html, /href="tel:4158672345"/);
  assert.match(result.html, /Mention you found them through BipolarTherapyHub/);
  assert.match(result.html, /Prefer not to call\?/);
  // Phone icon included
  assert.match(result.html, /mx-contact-phone-icon/);
});

test("buildContactModalContent: phone layout uses copy button on desktop", () => {
  const result = buildContactModalContent(
    { ...FULL_THERAPIST, preferredContactMethod: "phone" },
    { isMobile: false },
  );
  assert.match(result.html, /data-contact-copy="phone"/);
  // And no tel: anchor for the primary CTA on desktop
  assert.equal(/mx-contact-phone-cta[^"]*" href="tel:/.test(result.html), false);
});

test("buildContactModalContent: email layout renders textarea + open/copy buttons", () => {
  const result = buildContactModalContent({
    ...FULL_THERAPIST,
    preferredContactMethod: "email",
  });
  assert.equal(result.layout, "email");
  assert.match(result.html, /Email Jamie/);
  assert.match(result.html, /starter message you can send/);
  assert.match(result.html, /id="contactDraftMessage"/);
  assert.match(result.html, /data-contact-send-email="jamie@practice\.com"/);
  assert.match(result.html, /data-contact-copy-message/);
  assert.match(result.html, /Open in email app/);
  assert.match(result.html, /Copy message/);
  // Other-ways label uses interpolated first name
  assert.match(result.html, /Other ways to reach Jamie/);
});

test("buildContactModalContent: returns { layout: null, html: '' } when no contacts", () => {
  const result = buildContactModalContent({ name: "Nobody Home" });
  assert.equal(result.layout, null);
  assert.equal(result.html, "");
});

test("buildContactModalContent: secondary contacts section omitted if no other methods", () => {
  const result = buildContactModalContent({
    name: "Solo Booker",
    bookingUrl: "https://calendly.com/solo",
    preferredContactMethod: "booking",
  });
  assert.equal(result.layout, "booking");
  assert.equal(/mx-contact-others/.test(result.html), false);
});

test("buildContactModalContent: escapes user-supplied therapist name", () => {
  const result = buildContactModalContent({
    name: 'Evil<script>alert("xss")</script> Rivera',
    bookingUrl: "https://calendly.com/evil",
    preferredContactMethod: "booking",
  });
  assert.equal(/Book with Evil</.test(result.html), false);
  assert.match(result.html, /Book with Evil&lt;script&gt;/);
});
