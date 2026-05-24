import test from "node:test";
import assert from "node:assert/strict";

import {
  buildActiveFilterChipsHtml,
  buildMatchOutreachDisclosure,
  buildMatchReasonLine,
  buildPrimaryMatchCardsMarkup,
  buildResultsHeaderHtml,
  countActiveRefinements,
  getPersonalizedCtaLabel,
  renderLeadResultCard,
  renderSupportingResultCard,
} from "../../assets/match-card-render.js";

const CARD_SERVICES = {
  getPreferredOutreach: () => ({ href: "https://ex.com/book", external: true }),
  buildTherapistProfileHref: (t) => "/therapists/" + (t.slug || ""),
  renderSaveButton: (slug) => '<button data-save-slug="' + slug + '"></button>',
  buildCardInfoRow: () => '<div class="bth-card-info"></div>',
  buildIntakeMirrorSentence: () => "",
};

function entryWith(overrides) {
  return { therapist: Object.assign({ slug: "t", name: "T" }, overrides) };
}

test("countActiveRefinements counts only meaningful, non-default selections", function () {
  assert.equal(countActiveRefinements(null), 0);
  assert.equal(countActiveRefinements({}), 0);
  assert.equal(countActiveRefinements({ urgency: "ASAP" }), 0);
  assert.equal(
    countActiveRefinements({
      insurance: "Aetna",
      care_format: "Telehealth",
      budget_max: 200,
      urgency: "Within 2 weeks",
      bipolar_focus: ["Bipolar I"],
      preferred_modalities: ["CBT"],
      population_fit: ["Adults"],
      language_preferences: ["Spanish"],
    }),
    8,
  );
});

test("buildActiveFilterChipsHtml skips default/either choices and emits clear buttons", function () {
  assert.equal(buildActiveFilterChipsHtml(null), "");
  assert.equal(buildActiveFilterChipsHtml({ care_format: "Either" }), "");
  assert.equal(buildActiveFilterChipsHtml({ priority_mode: "Best overall fit" }), "");

  const html = buildActiveFilterChipsHtml({
    care_format: "Telehealth",
    insurance: "Aetna",
    priority_mode: "Lowest cost",
  });
  assert.match(html, /data-clear-filter="care_format"/);
  assert.match(html, /Aetna insurance/);
  assert.match(html, /Affordable/);
});

test("buildActiveFilterChipsHtml escapes user-supplied insurance text", function () {
  const html = buildActiveFilterChipsHtml({ insurance: "<b>x</b>" });
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt; insurance/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

test("buildResultsHeaderHtml pluralizes count and injects the mirror sentence", function () {
  const deps = { buildIntakeMirrorSentence: () => "Telehealth therapy across California." };
  const single = buildResultsHeaderHtml({}, 1, deps);
  assert.match(single, /1 bipolar informed match for you/);
  assert.match(single, /Telehealth therapy across California\./);

  const many = buildResultsHeaderHtml({ insurance: "Aetna" }, 5, deps);
  assert.match(many, /5 bipolar informed matches for you/);
  assert.match(many, /mx-refine-btn-count">1</); // one active refinement badge
});

test("buildResultsHeaderHtml works without an injected mirror sentence", function () {
  const html = buildResultsHeaderHtml({}, 3, {});
  assert.match(html, /3 bipolar informed matches for you/);
  assert.doesNotMatch(html, /mx-results-sub/);
});

test("buildMatchOutreachDisclosure returns empty when there is no therapist", function () {
  assert.equal(buildMatchOutreachDisclosure(null), "");
  assert.equal(buildMatchOutreachDisclosure({}), "");
});

test("buildMatchReasonLine prefers years of experience, then a bipolar specialty", function () {
  assert.equal(buildMatchReasonLine({ bipolar_years_experience: 1 }), "1 yr bipolar experience");
  assert.equal(buildMatchReasonLine({ bipolar_years_experience: 7 }), "7 yrs bipolar experience");
  assert.equal(
    buildMatchReasonLine({ specialties: ["Rapid cycling"] }),
    "Rapid cycling specialist",
  );
  // Generic terms are too broad to surface as a reason label.
  assert.equal(buildMatchReasonLine({ specialties: ["Bipolar Disorder"] }), "");
  assert.equal(buildMatchReasonLine({}), "");
});

test("getPersonalizedCtaLabel maps each route type to a verb-led label", function () {
  assert.equal(getPersonalizedCtaLabel("website"), "Visit their website");
  assert.equal(getPersonalizedCtaLabel("booking"), "Book a session");
  assert.equal(getPersonalizedCtaLabel("email"), "Email therapist");
  assert.equal(getPersonalizedCtaLabel("phone"), "Call therapist");
  assert.equal(getPersonalizedCtaLabel("unknown"), "");
});

test("renderLeadResultCard builds the lead article with injected services", function () {
  const entry = {
    therapist: { slug: "dr-a", name: "Dr. A", credentials: "LMFT", booking_url: "x" },
  };
  const html = renderLeadResultCard(entry, {
    showBestBadge: true,
    ...CARD_SERVICES,
  });
  assert.match(html, /bth-card bth-card-lead/);
  assert.match(html, /mx-top-match-label/); // best badge shown
  assert.match(html, /Dr\. A/);
  assert.match(html, /data-match-primary-cta="dr-a"/);
  assert.match(html, /href="\/therapists\/dr-a"/);
  assert.match(html, /data-save-slug="dr-a"/);
});

test("renderLeadResultCard omits the best badge when not requested", function () {
  const html = renderLeadResultCard({ therapist: { slug: "b", name: "B" } }, { ...CARD_SERVICES });
  assert.doesNotMatch(html, /mx-top-match-label/);
});

test("renderSupportingResultCard builds a standard card (no lead modifier)", function () {
  const html = renderSupportingResultCard(
    { therapist: { slug: "dr-c", name: "Dr. C" } },
    CARD_SERVICES,
  );
  assert.match(html, /<article class="bth-card">/);
  assert.doesNotMatch(html, /bth-card-lead/);
  assert.match(html, /data-match-primary-cta="dr-c"/);
});

test("buildPrimaryMatchCardsMarkup returns empty shape when nothing is contactable", function () {
  const services = { ...CARD_SERVICES, getPreferredOutreach: () => null };
  const result = buildPrimaryMatchCardsMarkup([entryWith({ slug: "a" })], {}, services);
  assert.deepEqual(result, { html: "", allEntries: [], leadEntry: null });
});

test("buildPrimaryMatchCardsMarkup assembles panel, lead, runners, and show-more", function () {
  const entries = [];
  for (let i = 0; i < 7; i++) entries.push(entryWith({ slug: "t" + i, name: "T" + i }));

  const result = buildPrimaryMatchCardsMarkup(entries, {}, CARD_SERVICES);

  assert.match(result.html, /results-panel/);
  assert.match(result.html, /bth-card-lead/);
  assert.match(result.html, /mx-runners/);
  assert.match(result.html, /Show 2 more matches/); // 7 entries: 1 lead + 4 runners + 2 more
  assert.match(result.html, /mx-compare-trigger/);
  assert.equal(result.allEntries.length, 7);
  assert.equal(result.leadEntry.therapist.slug, "t0");
});

test("buildPrimaryMatchCardsMarkup caps results at 8 and drops non-accepting on ASAP", function () {
  const entries = [];
  for (let i = 0; i < 10; i++) {
    entries.push(entryWith({ slug: "t" + i, accepting_new_patients: i !== 0 }));
  }
  // No urgency: cap at 8, lead is t0 even though it isn't accepting.
  const relaxed = buildPrimaryMatchCardsMarkup(entries, {}, CARD_SERVICES);
  assert.equal(relaxed.allEntries.length, 8);
  assert.equal(relaxed.leadEntry.therapist.slug, "t0");

  // ASAP: t0 (not accepting) is filtered out, so t1 leads.
  const asap = buildPrimaryMatchCardsMarkup(entries, { urgency: "ASAP" }, CARD_SERVICES);
  assert.equal(asap.leadEntry.therapist.slug, "t1");
});
