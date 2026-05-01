import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContactDraftMessage,
  buildContactModalContent,
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

// ── buildContactModalContent: layout selection ─────────────────

const FULL_THERAPIST = {
  name: "Dr. Jamie Rivera",
  phone: "415-867-2345",
  email: "jamie@practice.com",
  website: "https://practice.com",
  bookingUrl: "https://calendly.com/jamie",
};

test("buildContactModalContent: booking layout renders 'Book with [First]'", () => {
  const result = buildContactModalContent({
    ...FULL_THERAPIST,
    preferredContactMethod: "booking",
  });
  assert.equal(result.layout, "booking");
  assert.match(result.html, /Book with Jamie/);
  assert.match(result.html, /Open booking page/);
  assert.match(result.html, /data-contact-primary="booking"/);
  // Secondary contacts are no longer shown in the modal
  assert.equal(/Prefer to reach out first\?/.test(result.html), false);
  assert.equal(/mx-contact-others/.test(result.html), false);
});

test("buildContactModalContent: website layout renders 'Contact [First]'", () => {
  const result = buildContactModalContent({
    ...FULL_THERAPIST,
    preferredContactMethod: "website",
  });
  assert.equal(result.layout, "website");
  assert.match(result.html, /Contact Jamie/);
  assert.match(result.html, /Continue to Jamie's site/);
  // Secondary contacts are no longer shown in the modal
  assert.equal(/Prefer to reach out directly\?/.test(result.html), false);
  assert.equal(/mx-contact-others/.test(result.html), false);
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
  // Secondary contacts are no longer shown in the modal
  assert.equal(/Prefer not to call\?/.test(result.html), false);
  assert.equal(/mx-contact-others/.test(result.html), false);
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
  // Secondary contacts are no longer shown in the modal
  assert.equal(/Other ways to reach Jamie/.test(result.html), false);
  assert.equal(/mx-contact-others/.test(result.html), false);
});

test("buildContactModalContent: returns { layout: null, html: '' } when no contacts", () => {
  const result = buildContactModalContent({ name: "Nobody Home" });
  assert.equal(result.layout, null);
  assert.equal(result.html, "");
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
