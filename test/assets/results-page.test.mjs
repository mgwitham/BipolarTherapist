import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const resultsJs = readFileSync(
  fileURLToPath(new URL("../../assets/results.js", import.meta.url)),
  "utf8",
);
const resultsSaveJs = readFileSync(
  fileURLToPath(new URL("../../assets/results-save.js", import.meta.url)),
  "utf8",
);
const resultsAnalyticsJs = readFileSync(
  fileURLToPath(new URL("../../assets/results-analytics.js", import.meta.url)),
  "utf8",
);
const resultsHtml = readFileSync(
  fileURLToPath(new URL("../../results.html", import.meta.url)),
  "utf8",
);

test("results page: renders a distinct load-error state", () => {
  assert.match(resultsHtml, /data-results-error/);
  assert.match(resultsJs, /showState\("error"\)/);
  assert.match(resultsJs, /matchResultsUrl/);
  assert.match(resultsAnalyticsJs, /render_error:\s*Boolean/);
});

test("results page: skips malformed therapist entries before card rendering", () => {
  assert.match(resultsJs, /function hasRenderableTherapist/);
  assert.match(resultsJs, /\.filter\(hasRenderableTherapist\)/);
  assert.match(resultsJs, /String\(therapist\.slug \|\| ""\)\.trim\(\)/);
});

test("results page: analytics waits for async render count", () => {
  assert.doesNotMatch(resultsAnalyticsJs, /^trackFunnelEvent\("match_results_page_viewed"/m);
  assert.match(resultsAnalyticsJs, /document\.addEventListener\("results:rendered"/);
  assert.match(resultsAnalyticsJs, /card_count:\s*Number\(detail\.count\)/);
});

test("results page: live filter edits re-rank without a reload", () => {
  // Edit toggles the inline panel instead of navigating away.
  assert.match(resultsHtml, /data-results-filter-panel/);
  assert.doesNotMatch(resultsHtml, /href="\/#startMatch"\s+class="filter-edit-btn"/);
  // Pills are removable and re-render results in place.
  assert.match(resultsJs, /data-pill-remove/);
  assert.match(resultsJs, /history\.replaceState/);
  // Re-renders report as filter changes, not fresh page views.
  assert.match(resultsAnalyticsJs, /match_results_filters_changed/);
  assert.match(resultsAnalyticsJs, /match_results_filter_pill_removed/);
});

test("results save: updates current card label and tolerates missing CSS.escape", () => {
  assert.match(resultsSaveJs, /function escapeCssIdent/);
  assert.match(resultsSaveJs, /window\.CSS && typeof window\.CSS\.escape === "function"/);
  assert.match(resultsSaveJs, /\.card-save-label/);
});
