import test from "node:test";
import assert from "node:assert/strict";

import { phoneHref, emailHref, publicHttpUrl } from "../../shared/contact-href.mjs";

test("phoneHref builds tel: only for numbers with >= 7 digits", () => {
  assert.equal(phoneHref("(415) 555-2671"), "tel:4155552671");
  assert.equal(phoneHref("415.555.2671"), "tel:4155552671");
  assert.equal(phoneHref("+1 (415) 555-2671"), "tel:+14155552671");
  assert.equal(phoneHref(" 4155552671 "), "tel:4155552671"); // surrounding whitespace
});

test("phoneHref returns '' for junk / too-short input (no dead tel: links)", () => {
  assert.equal(phoneHref(""), "");
  assert.equal(phoneHref(null), "");
  assert.equal(phoneHref(undefined), "");
  assert.equal(phoneHref("+"), ""); // the classic bug: "tel:+"
  assert.equal(phoneHref("abc"), ""); // the classic bug: "tel:"
  assert.equal(phoneHref("123"), ""); // 3 digits
  assert.equal(phoneHref("call us"), "");
});

test("phoneHref keeps exactly-7-digit numbers and drops 6-digit ones", () => {
  assert.equal(phoneHref("5551234"), "tel:5551234"); // 7 digits
  assert.equal(phoneHref("555123"), ""); // 6 digits
});

test("emailHref builds mailto: for valid addresses and lowercases them", () => {
  assert.equal(emailHref("Jane@Example.com"), "mailto:jane@example.com");
  assert.equal(emailHref("  jane.doe@clinic.co  "), "mailto:jane.doe@clinic.co");
  assert.equal(emailHref("a+tag@sub.domain.org"), "mailto:a+tag@sub.domain.org");
});

test("emailHref returns '' for malformed addresses (no dead mailto: links)", () => {
  assert.equal(emailHref(""), "");
  assert.equal(emailHref(null), "");
  assert.equal(emailHref("garbage"), "");
  assert.equal(emailHref("no-at-sign.com"), "");
  assert.equal(emailHref("jane@nodot"), "");
  assert.equal(emailHref("jane @example.com"), ""); // whitespace
  assert.equal(emailHref("two@@example.com"), "");
});

test("publicHttpUrl normalizes bare and http(s) URLs", () => {
  assert.equal(publicHttpUrl("example.com"), "https://example.com/");
  assert.equal(publicHttpUrl("https://example.com/book"), "https://example.com/book");
  assert.equal(publicHttpUrl("http://example.com"), "http://example.com/");
  assert.equal(publicHttpUrl("  example.com/path  "), "https://example.com/path");
});

test("publicHttpUrl rejects unsafe schemes and non-dotted hosts", () => {
  assert.equal(publicHttpUrl(""), "");
  assert.equal(publicHttpUrl(null), "");
  assert.equal(publicHttpUrl("javascript:alert(1)"), ""); // host "javascript" has no dot
  assert.equal(publicHttpUrl("file:///etc/passwd"), "");
  assert.equal(publicHttpUrl("localhost"), ""); // no dot in hostname
  assert.equal(publicHttpUrl("just a phrase"), ""); // whitespace in host
});
