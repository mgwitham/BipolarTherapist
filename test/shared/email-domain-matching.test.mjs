import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AGGREGATOR_DOMAINS,
  FREE_EMAIL_DOMAINS,
  emailDomainMatchesWebsite,
  extractRegistrableDomain,
  normalizeNameForMatch,
} from "../../shared/email-domain-matching.mjs";

test("normalizeNameForMatch strips honorifics, credentials, punctuation", () => {
  assert.equal(normalizeNameForMatch("Dr. Jane Doe"), "jane doe");
  assert.equal(normalizeNameForMatch("Jane Doe, LMFT"), "jane doe");
  assert.equal(normalizeNameForMatch("Ms. Ana-María O'Brien"), "ana-mar a o'brien");
  // Honorific stripping anchors to the string start; leading whitespace defeats it.
  assert.equal(normalizeNameForMatch("  MS.  Ana-María  O'Brien  "), "ms ana-mar a o'brien");
  assert.equal(normalizeNameForMatch(""), "");
  assert.equal(normalizeNameForMatch(null), "");
});

test("extractRegistrableDomain reduces URLs and hostnames", () => {
  assert.equal(extractRegistrableDomain("https://www.example.com/path?q=1#frag"), "example.com");
  assert.equal(extractRegistrableDomain("sub.practice.org"), "practice.org");
  assert.equal(extractRegistrableDomain("WWW.FOO.CO.UK"), "foo.co.uk");
  assert.equal(extractRegistrableDomain("host:8080"), "");
  assert.equal(extractRegistrableDomain("localhost"), "");
  assert.equal(extractRegistrableDomain(""), "");
  assert.equal(extractRegistrableDomain(null), "");
});

test("emailDomainMatchesWebsite: true only for matching practice domains", () => {
  assert.equal(emailDomainMatchesWebsite("jane@janedoe.com", "https://www.janedoe.com"), true);
  assert.equal(
    emailDomainMatchesWebsite("jane@janedoe.com", "https://booking.janedoe.com/schedule"),
    true,
  );
  assert.equal(emailDomainMatchesWebsite("jane@janedoe.com", "https://otherdoc.com"), false);
});

test("emailDomainMatchesWebsite: free-email domains never match", () => {
  assert.equal(emailDomainMatchesWebsite("jane@gmail.com", "https://gmail.com"), false);
  for (const domain of FREE_EMAIL_DOMAINS) {
    assert.equal(
      emailDomainMatchesWebsite(`x@${domain}`, `https://${domain}`),
      false,
      `${domain} should never count as ownership`,
    );
  }
});

test("emailDomainMatchesWebsite: aggregator domains never match", () => {
  for (const domain of AGGREGATOR_DOMAINS) {
    assert.equal(
      emailDomainMatchesWebsite(`x@${domain}`, `https://${domain}`),
      false,
      `${domain} should never count as ownership`,
    );
  }
  // aggregator on the website side alone also blocks
  assert.equal(
    emailDomainMatchesWebsite("jane@psychologytoday.com", "https://www.psychologytoday.com/jane"),
    false,
  );
});

test("emailDomainMatchesWebsite: missing or malformed inputs → false", () => {
  assert.equal(emailDomainMatchesWebsite("", "https://janedoe.com"), false);
  assert.equal(emailDomainMatchesWebsite("jane@janedoe.com", ""), false);
  assert.equal(emailDomainMatchesWebsite("not-an-email", "https://janedoe.com"), false);
  assert.equal(emailDomainMatchesWebsite(null, null), false);
});
