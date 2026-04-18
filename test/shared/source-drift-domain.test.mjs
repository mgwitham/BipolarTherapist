import test from "node:test";
import assert from "node:assert/strict";

import {
  computeContentDrift,
  extractFactsFromHtml,
  nameAppearsInText,
  normalizePhoneDigits,
  stripHtml,
} from "../../shared/source-drift-domain.mjs";

test("stripHtml removes scripts, styles, and tags", () => {
  const html = `
    <html><head><style>.x{color:red}</style></head>
    <body><script>alert(1)</script>Hello <b>World</b></body></html>
  `;
  assert.equal(stripHtml(html), "Hello World");
});

test("normalizePhoneDigits strips formatting", () => {
  assert.equal(normalizePhoneDigits("(310) 555-0147"), "3105550147");
  assert.equal(normalizePhoneDigits("+1 310.555.0147"), "13105550147");
  assert.equal(normalizePhoneDigits(""), "");
  assert.equal(normalizePhoneDigits(null), "");
});

test("nameAppearsInText matches full name", () => {
  assert.equal(nameAppearsInText("Aubri Gomez", "About Aubri Gomez, LCSW"), true);
});

test("nameAppearsInText falls back to surname with word boundary", () => {
  assert.equal(nameAppearsInText("Aubri Gomez", "Dr. Gomez specializes in..."), true);
  // Surname embedded inside another word must not match.
  assert.equal(nameAppearsInText("Aubri Smith", "smithsonian institute"), false);
});

test("nameAppearsInText returns false when name absent", () => {
  assert.equal(nameAppearsInText("Aubri Gomez", "This page is about Jane Doe"), false);
});

test("extractFactsFromHtml pulls phones from tel hrefs and text", () => {
  const html = `
    <a href="tel:+1-310-555-0147">Call</a>
    <p>Or try 415.555.9000 after hours.</p>
  `;
  const facts = extractFactsFromHtml(html);
  assert.equal(facts.phones.has("3105550147"), true);
  assert.equal(facts.phones.has("4155559000"), true);
});

test("extractFactsFromHtml flags waitlist language", () => {
  const facts = extractFactsFromHtml("<p>I am currently not accepting new clients.</p>");
  assert.equal(facts.notAcceptingClients, true);
});

test("extractFactsFromHtml flags retirement language", () => {
  const facts = extractFactsFromHtml("<p>Dr. Smith has retired from private practice.</p>");
  assert.equal(facts.retiredLanguage, true);
});

test("computeContentDrift returns no drift when everything matches", () => {
  const therapist = {
    name: "Aubri Gomez",
    phone: "310-555-0147",
    email: "aubri@example.com",
    insuranceAccepted: ["Aetna", "Blue Shield of California"],
  };
  const html = `
    <p>Aubri Gomez, LCSW — accepting new patients.</p>
    <a href="tel:3105550147">Call</a>
    <a href="mailto:aubri@example.com">Email</a>
    <p>Insurance: Aetna, Blue Shield of California, Self-Pay.</p>
  `;
  const result = computeContentDrift(therapist, extractFactsFromHtml(html));
  assert.equal(result.drifted, false);
  assert.deepEqual(result.reasons, []);
});

test("computeContentDrift flags missing name", () => {
  const therapist = { name: "Aubri Gomez" };
  const html = "<p>This page is about someone else entirely.</p>";
  const result = computeContentDrift(therapist, extractFactsFromHtml(html));
  assert.equal(result.drifted, true);
  assert.ok(result.reasons.some((reason) => reason.includes("Aubri Gomez")));
});

test("computeContentDrift flags waitlist language", () => {
  const therapist = { name: "Aubri Gomez", phone: "310-555-0147" };
  const html = `
    <p>Aubri Gomez is currently on a waitlist.</p>
    <a href="tel:3105550147">Call</a>
  `;
  const result = computeContentDrift(therapist, extractFactsFromHtml(html));
  assert.equal(result.drifted, true);
  assert.ok(result.reasons.some((reason) => /waitlist/i.test(reason)));
});

test("computeContentDrift flags phone change when page lists different phone", () => {
  const therapist = { name: "Aubri Gomez", phone: "310-555-0147" };
  const html = `
    <p>Aubri Gomez, LCSW</p>
    <a href="tel:4155550000">Call</a>
  `;
  const result = computeContentDrift(therapist, extractFactsFromHtml(html));
  assert.equal(result.drifted, true);
  assert.ok(result.reasons.some((reason) => /phone/i.test(reason)));
});

test("computeContentDrift does NOT flag phone when page has no phones at all", () => {
  const therapist = { name: "Aubri Gomez", phone: "310-555-0147" };
  const html = "<p>Aubri Gomez, LCSW — contact via portal only.</p>";
  const result = computeContentDrift(therapist, extractFactsFromHtml(html));
  assert.equal(result.drifted, false);
});

test("computeContentDrift flags a dropped insurance carrier", () => {
  const therapist = {
    name: "Aubri Gomez",
    insuranceAccepted: ["Aetna", "Cigna"],
  };
  // Page mentions Aetna but Cigna has been removed.
  const html = `
    <p>Aubri Gomez, LCSW</p>
    <p>Insurance: Aetna and Self-Pay.</p>
  `;
  const result = computeContentDrift(therapist, extractFactsFromHtml(html));
  assert.equal(result.drifted, true);
  assert.ok(result.reasons.some((reason) => /Cigna/.test(reason)));
});

test("computeContentDrift does NOT flag insurance when page lists none", () => {
  const therapist = {
    name: "Aubri Gomez",
    insuranceAccepted: ["Aetna", "Cigna"],
  };
  // No carrier mentioned at all — can't judge.
  const html = "<p>Aubri Gomez, LCSW. Fees available on request.</p>";
  const result = computeContentDrift(therapist, extractFactsFromHtml(html));
  assert.equal(result.drifted, false);
});

test("computeContentDrift ignores Self-Pay as a carrier", () => {
  const therapist = {
    name: "Aubri Gomez",
    insuranceAccepted: ["Aetna", "Self-Pay"],
  };
  // Page drops Self-Pay mention but keeps Aetna — should not flag.
  const html = `
    <p>Aubri Gomez, LCSW. Insurance: Aetna only.</p>
  `;
  const result = computeContentDrift(therapist, extractFactsFromHtml(html));
  assert.equal(result.drifted, false);
});
