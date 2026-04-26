import test from "node:test";
import assert from "node:assert/strict";

import { renderTrustEvidenceStrip, _internals } from "../../assets/trust-evidence-strip.js";

const VERIFIED_THERAPIST = {
  name: "Jane Doe",
  credentials: "LMFT",
  license_number: "12345",
  verification_status: "editorially_verified",
  specialties: ["Bipolar disorder", "Depression"],
  bipolar_years_experience: 8,
  source_url: "https://www.psychologytoday.com/us/therapists/jane-doe",
  source_reviewed_at: "2026-03-15T12:00:00.000Z",
};

test("returns empty string for null/empty therapist", () => {
  assert.equal(renderTrustEvidenceStrip(null), "");
  assert.equal(renderTrustEvidenceStrip(undefined), "");
  assert.equal(renderTrustEvidenceStrip({}), "");
});

test("renders all 3 chips when full evidence is present", () => {
  const html = renderTrustEvidenceStrip(VERIFIED_THERAPIST);
  assert.match(html, /trust-strip/);
  assert.match(html, /License verified/);
  assert.match(html, /CA LMFT #12345/);
  assert.match(html, /Bipolar specialty/);
  assert.match(html, /psychologytoday\.com/);
  assert.match(html, /Last reviewed/);
  assert.match(html, /Mar 2026/);
});

test("evidence chip is a clickable link with rel=noopener", () => {
  const html = renderTrustEvidenceStrip(VERIFIED_THERAPIST);
  assert.match(html, /<a class="trust-chip trust-chip-evidence trust-chip-link"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("license chip is omitted when verification_status is not editorially_verified", () => {
  const t = { ...VERIFIED_THERAPIST, verification_status: "claimed" };
  const html = renderTrustEvidenceStrip(t);
  assert.doesNotMatch(html, /License verified/);
  assert.match(html, /Bipolar specialty/);
});

test("license chip is omitted when license_number is missing", () => {
  const t = { ...VERIFIED_THERAPIST, license_number: "" };
  const html = renderTrustEvidenceStrip(t);
  assert.doesNotMatch(html, /License verified/);
});

test("evidence chip falls back to non-link wording when source_url is missing", () => {
  const t = { ...VERIFIED_THERAPIST, source_url: "" };
  const html = renderTrustEvidenceStrip(t);
  assert.match(html, /Bipolar specialty/);
  assert.match(html, /Confirmed in profile review/);
  assert.doesNotMatch(html, /<a class="trust-chip/);
});

test("evidence chip is omitted when no bipolar signal exists", () => {
  const t = {
    ...VERIFIED_THERAPIST,
    specialties: ["Anxiety"],
    bipolar_years_experience: 0,
    care_approach: "general therapy",
  };
  const html = renderTrustEvidenceStrip(t);
  assert.doesNotMatch(html, /Bipolar specialty/);
});

test("freshness chip uses therapist_reported_confirmed_at as fallback", () => {
  const t = {
    ...VERIFIED_THERAPIST,
    source_reviewed_at: "",
    therapist_reported_confirmed_at: "2026-04-15T12:00:00.000Z",
  };
  const html = renderTrustEvidenceStrip(t);
  assert.match(html, /Last reviewed/);
  assert.match(html, /Apr 2026/);
});

test("returns empty string when no chips have data", () => {
  const t = {
    name: "Unknown",
    verification_status: "",
    specialties: [],
    bipolar_years_experience: 0,
  };
  assert.equal(renderTrustEvidenceStrip(t), "");
});

test("escapes HTML in license number and source URL host", () => {
  const t = {
    ...VERIFIED_THERAPIST,
    license_number: "<evil>",
    source_url: "https://example.com/<x>",
  };
  const html = renderTrustEvidenceStrip(t);
  assert.doesNotMatch(html, /<evil>/);
  assert.match(html, /&lt;evil&gt;/);
});

test("variant + className options apply to wrapper", () => {
  const html = renderTrustEvidenceStrip(VERIFIED_THERAPIST, {
    variant: "hero",
    className: "mx-hero-trust",
  });
  assert.match(html, /class="trust-strip trust-strip-hero mx-hero-trust"/);
});

test("internals expose hasBipolarSpecialtySignal", () => {
  assert.equal(_internals.hasBipolarSpecialtySignal({ specialties: ["Bipolar I"] }), true);
  assert.equal(_internals.hasBipolarSpecialtySignal({ bipolar_years_experience: 3 }), true);
  assert.equal(
    _internals.hasBipolarSpecialtySignal({ care_approach: "I treat bipolar disorder" }),
    true,
  );
  assert.equal(_internals.hasBipolarSpecialtySignal({ specialties: ["Anxiety"] }), false);
  assert.equal(_internals.hasBipolarSpecialtySignal({}), false);
});

test("sourceHostname strips www. and handles invalid URLs", () => {
  assert.equal(_internals.sourceHostname("https://www.example.com/path"), "example.com");
  assert.equal(_internals.sourceHostname("https://sub.example.com"), "sub.example.com");
  assert.equal(_internals.sourceHostname("not a url"), "");
  assert.equal(_internals.sourceHostname(""), "");
});
