import assert from "node:assert/strict";
import test from "node:test";

import {
  renderCompletenessMomentumEmail,
  renderFeaturedUpgradeEmail,
  renderMissedMatchEmail,
  renderMonthlyPerformanceEmail,
  renderUnclaimedTeaserEmail,
} from "../../shared/therapist-engagement-emails.mjs";

const UNSUB = "https://www.bipolartherapyhub.com/api/review/email/unsubscribe?token=test-token";

test("monthly performance email: subject leads with CTA clicks when present", () => {
  const email = renderMonthlyPerformanceEmail({
    therapistName: "Dr. Jamie Rivera",
    therapistSlug: "jamie-rivera",
    periodKey: "2026-04",
    profileViewsTotal: 47,
    ctaClicksTotal: 3,
    impressions: 312,
    rankLabel: "#5 of 9 in your area",
    areaTopContacts: 9,
    siteUrl: "https://www.bipolartherapyhub.com",
    unsubscribeUrl: UNSUB,
  });

  assert.equal(email.kind, "monthly_performance");
  assert.match(email.subject, /3 patients clicked to contact you/);
  assert.match(email.subject, /April 2026/);
  assert.match(email.html, /Dr\. Jamie Rivera/);
  assert.match(email.html, /47/);
  assert.match(email.html, /312/);
  assert.match(email.html, /#5 of 9 in your area/);
  assert.match(email.html, /Top-ranked bipolar specialists/);
  assert.match(email.html, /portal\?slug=jamie-rivera/);
  assert.match(email.html, /upgrade=featured/);
  assert.match(email.text, /Profile views: 47/);
});

test("monthly performance email: falls back to views subject when no CTA clicks", () => {
  const email = renderMonthlyPerformanceEmail({
    therapistName: "Alex Chen",
    therapistSlug: "alex-chen",
    periodKey: "2026-04",
    profileViewsTotal: 12,
    ctaClicksTotal: 0,
    unsubscribeUrl: UNSUB,
  });
  assert.match(email.subject, /12 patients viewed your profile/);
});

test("unclaimed teaser email: leads with view count when >0", () => {
  const email = renderUnclaimedTeaserEmail({
    therapistName: "Dr. Smith",
    therapistSlug: "dr-smith",
    profileViewsTotal: 12,
    missingFields: ["bio", "insurance accepted", "booking link"],
    unsubscribeUrl: UNSUB,
  });
  assert.match(email.subject, /12 patients viewed your listing/);
  assert.match(email.html, /bio, insurance accepted, booking link/);
  assert.match(email.html, /signup\.html\?slug=dr-smith/);
  assert.match(email.html, /Claim your profile free/);
});

test("missed match email: subject names patient city, body names fix field", () => {
  const email = renderMissedMatchEmail({
    therapistName: "Dr. Rivera",
    therapistSlug: "jamie-rivera",
    patientCity: "Pasadena",
    missedReason: "The patient filtered for Anthem, which your profile does not list",
    fixField: "insurance_accepted",
    competitorRank: 3,
    unsubscribeUrl: UNSUB,
  });
  assert.match(email.subject, /Pasadena/);
  assert.match(email.html, /Anthem/);
  assert.match(email.html, /ranked.*#3/);
  assert.match(email.html, /focus=insurance_accepted/);
});

test("completeness momentum email: subject includes percent", () => {
  const email = renderCompletenessMomentumEmail({
    therapistName: "Dr. Rivera",
    therapistSlug: "jamie-rivera",
    completenessPercent: 62,
    missingFields: ["bio", "care approach", "insurance accepted", "booking link"],
    unsubscribeUrl: UNSUB,
  });
  assert.match(email.subject, /62% complete/);
  assert.match(email.html, /width: 62%/);
  // Only top 3 missing fields shown
  assert.match(email.html, /<li>bio<\/li>/);
  assert.match(email.html, /<li>care approach<\/li>/);
  assert.match(email.html, /<li>insurance accepted<\/li>/);
  assert.doesNotMatch(email.html, /<li>booking link<\/li>/);
});

test("completeness momentum email: percent clamped to 0-100", () => {
  const email = renderCompletenessMomentumEmail({
    completenessPercent: 999,
    unsubscribeUrl: UNSUB,
  });
  assert.match(email.subject, /100% complete/);
});

test("featured upgrade email: leads with free contact count and benchmark", () => {
  const email = renderFeaturedUpgradeEmail({
    therapistName: "Dr. Rivera",
    therapistSlug: "jamie-rivera",
    ctaClicksTotal: 3,
    areaFeaturedContacts: 11,
    estimatedLtvDollars: 4800,
    unsubscribeUrl: UNSUB,
  });
  assert.match(email.subject, /3 free contacts/);
  assert.match(email.subject, /Featured therapists got 11/);
  assert.match(email.html, /\$4,800/);
  assert.match(email.html, /upgrade=featured/);
  assert.match(email.html, /14-day Featured trial/);
});

test("all emails escape HTML in user-provided fields", () => {
  const payload = {
    therapistName: '<script>alert("x")</script>',
    therapistSlug: "safe-slug",
    patientCity: '"><img/>',
    missedReason: "<b>bold?</b>",
    missingFields: ["<b>bold</b>"],
    unsubscribeUrl: UNSUB,
  };
  const emails = [
    renderMonthlyPerformanceEmail(payload),
    renderUnclaimedTeaserEmail(payload),
    renderMissedMatchEmail(payload),
    renderCompletenessMomentumEmail(payload),
    renderFeaturedUpgradeEmail(payload),
  ];
  emails.forEach((email) => {
    assert.doesNotMatch(email.html, /<script>/);
    assert.doesNotMatch(email.html, /<b>bold<\/b>/);
  });
});

test("engagement email render: throws if unsubscribeUrl is missing", () => {
  // CAN-SPAM requires a working unsubscribe in every commercial email.
  // The renderer fails loudly so the {{UNSUB_URL}} placeholder can
  // never silently ship to therapists.
  assert.throws(
    () => renderMonthlyPerformanceEmail({ therapistName: "X" }),
    /missing unsubscribeUrl/,
  );
  assert.throws(() => renderUnclaimedTeaserEmail({ therapistName: "X" }), /missing unsubscribeUrl/);
  assert.throws(() => renderMissedMatchEmail({ therapistName: "X" }), /missing unsubscribeUrl/);
  assert.throws(
    () => renderCompletenessMomentumEmail({ therapistName: "X" }),
    /missing unsubscribeUrl/,
  );
  assert.throws(() => renderFeaturedUpgradeEmail({ therapistName: "X" }), /missing unsubscribeUrl/);
});

test("engagement email render: unsubscribe URL appears in HTML and plain-text bodies", () => {
  const email = renderMonthlyPerformanceEmail({
    therapistName: "Dr. Rivera",
    therapistSlug: "rivera",
    periodKey: "2026-04",
    unsubscribeUrl: UNSUB,
  });
  assert.ok(email.html.includes(UNSUB), "unsubscribe URL must appear in HTML body");
  assert.ok(email.text.includes(UNSUB), "unsubscribe URL must appear in plain-text body");
  assert.doesNotMatch(email.html, /\{\{UNSUB_URL\}\}/, "no leftover placeholder in HTML");
  assert.doesNotMatch(email.text, /\{\{UNSUB_URL\}\}/, "no leftover placeholder in plain-text");
});
