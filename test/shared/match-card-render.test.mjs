import test from "node:test";
import assert from "node:assert/strict";

import {
  buildActiveFilterChipsHtml,
  buildMatchOutreachDisclosure,
  buildResultsHeaderHtml,
  countActiveRefinements,
} from "../../assets/match-card-render.js";

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
