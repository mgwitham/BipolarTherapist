import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REFERRAL_CODE_MAX_LENGTH,
  REFERRAL_PARAM,
  appendReferralCode,
  parseReferralCode,
  referralCodeForContact,
  sanitizeReferralCode,
} from "../../shared/referral-attribution.mjs";

test("referralCodeForContact is readable, bounded, and stable", () => {
  const contact = {
    contactName: "Nigel Kennedy",
    orgName: "Dr. Nigel Kennedy, MD PhD",
    email: "appointments@nigelkennedymd.com",
  };
  const code = referralCodeForContact(contact);
  assert.match(code, /^nkennedy-[a-z0-9]{4}$/, `unexpected code: ${code}`);
  assert.ok(code.length <= REFERRAL_CODE_MAX_LENGTH);

  // Stable across calls: the intro and every follow-up must carry one code.
  assert.equal(referralCodeForContact(contact), code);
  // Keyed on identity (email), so a practice rename does not change it.
  assert.equal(referralCodeForContact({ ...contact, orgName: "Renamed Practice" }), code);
});

test("referralCodeForContact falls back to the org for shared inboxes", () => {
  const code = referralCodeForContact({
    orgName: "Bay Area Neuropsychiatry",
    email: "referrals@bayareaneuropsychiatry.com",
  });
  assert.match(code, /^bay-area-neuropsychiatry-[a-z0-9]{4}$/);
});

test("referralCodeForContact distinguishes two clinicians with the same name", () => {
  const a = referralCodeForContact({ contactName: "Jane Smith", email: "jane@one.com" });
  const b = referralCodeForContact({ contactName: "Jane Smith", email: "jane@two.com" });
  assert.match(a, /^jsmith-/);
  assert.match(b, /^jsmith-/);
  assert.notEqual(a, b, "same name + different identity must not collide");
});

test("referralCodeForContact returns '' when there is nothing to key on", () => {
  assert.equal(referralCodeForContact({}), "");
  assert.equal(referralCodeForContact(null), "");
});

test("sanitizeReferralCode rejects hostile input from a URL", () => {
  assert.equal(sanitizeReferralCode("nkennedy-3f2a"), "nkennedy-3f2a");
  assert.equal(sanitizeReferralCode("  NKennedy-3F2A  "), "nkennedy-3f2a");
  assert.equal(sanitizeReferralCode("<script>alert(1)</script>"), "script-alert-1-script");
  assert.equal(sanitizeReferralCode("../../etc/passwd"), "etc-passwd");
  assert.equal(sanitizeReferralCode(""), "");
  assert.equal(sanitizeReferralCode(null), "");
  assert.equal(sanitizeReferralCode("!!!"), "");
  assert.ok(sanitizeReferralCode("x".repeat(200)).length <= REFERRAL_CODE_MAX_LENGTH);
  assert.doesNotMatch(sanitizeReferralCode("abc" + "-".repeat(60)), /-$/);
});

test("appendReferralCode adds the param without clobbering an existing query or hash", () => {
  assert.equal(
    appendReferralCode("https://x.org/bipolar-therapists/los-angeles-ca/", "nkennedy-3f2a"),
    "https://x.org/bipolar-therapists/los-angeles-ca/?ref=nkennedy-3f2a",
  );
  assert.equal(
    appendReferralCode("https://x.org/d?a=1", "abc-1234"),
    "https://x.org/d?a=1&ref=abc-1234",
  );
  assert.equal(
    appendReferralCode("https://x.org/d#top", "abc-1234"),
    "https://x.org/d?ref=abc-1234#top",
  );
  // Never double-stamp.
  assert.equal(
    appendReferralCode("https://x.org/d?ref=first-0000", "second-1111"),
    "https://x.org/d?ref=first-0000",
  );
  // No-ops.
  assert.equal(appendReferralCode("https://x.org", ""), "https://x.org");
  assert.equal(appendReferralCode("", "abc-1234"), "");
  // Placeholder strings used in template previews must not throw.
  assert.equal(appendReferralCode("[directory]", "abc-1234"), "[directory]?ref=abc-1234");
});

test("parseReferralCode reads the code back off a landing URL", () => {
  assert.equal(parseReferralCode("?ref=nkennedy-3f2a"), "nkennedy-3f2a");
  assert.equal(
    parseReferralCode("https://x.org/bipolar-therapists/la-ca/?utm=1&ref=abc-1234"),
    "abc-1234",
  );
  assert.equal(parseReferralCode("?ref=abc-1234#section"), "abc-1234");
  assert.equal(parseReferralCode("?refx=nope"), "");
  assert.equal(parseReferralCode("?ref="), "");
  assert.equal(parseReferralCode(""), "");
  assert.equal(parseReferralCode(null), "");
  // Untrusted input is sanitized on the way out, not trusted verbatim.
  assert.equal(parseReferralCode("?ref=%3Cscript%3E"), "script");
  // Malformed percent-encoding must not throw.
  assert.equal(parseReferralCode("?ref=%E0%A4%A"), "e0-a4-a");
});

test("append then parse round-trips", () => {
  const code = referralCodeForContact({ contactName: "Blake Rawdin", email: "blake@x.com" });
  const url = appendReferralCode("https://www.bipolartherapyhub.com/", code);
  assert.equal(parseReferralCode(url), code);
  assert.ok(url.includes(`${REFERRAL_PARAM}=`));
});
