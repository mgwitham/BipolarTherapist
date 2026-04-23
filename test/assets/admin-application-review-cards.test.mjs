import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function read(file) {
  return readFileSync(path.join(repoRoot, file), "utf8");
}

test("admin signup cards use a compact decision-first grammar", function () {
  const reviewJs = read("assets/admin-application-review.js");

  assert.match(reviewJs, /function getApplicationStateMeta/);
  assert.match(reviewJs, /function getPrimaryApplicationActionLabel/);
  assert.match(reviewJs, /function buildCompactApplicationFacts/);
  assert.match(reviewJs, /application-card-shell/);
  assert.match(reviewJs, /application-card-summary/);
  assert.match(reviewJs, /application-card-actions/);
  assert.match(reviewJs, /application-compact-facts/);
  assert.doesNotMatch(reviewJs, /label: "Workflow state"/);
  assert.doesNotMatch(reviewJs, /renderIssueColumn\(\{\s*label: "Blocking"/);
});

test("admin signup cards keep explicit actions and closable details", function () {
  const reviewJs = read("assets/admin-application-review.js");
  const actionsJs = read("assets/admin-application-actions.js");

  assert.match(reviewJs, /Publish/);
  assert.match(reviewJs, /Approve claim/);
  assert.match(reviewJs, /Apply refresh/);
  assert.match(reviewJs, /Request changes/);
  assert.match(reviewJs, /Reject/);
  assert.match(reviewJs, /data-open-review-details/);
  assert.match(reviewJs, /data-close-review-details/);
  assert.match(reviewJs, /Close details/);
  assert.match(actionsJs, /data-open-review-details/);
  assert.match(actionsJs, /data-close-review-details/);
});

test("admin signup card styles support the compact anatomy", function () {
  const html = read("admin.html");

  assert.match(html, /\.application-card-shell/);
  assert.match(html, /\.application-card-topline/);
  assert.match(html, /\.application-priority-chip/);
  assert.match(html, /\.application-card-summary/);
  assert.match(html, /\.application-card-actions/);
  assert.match(html, /\.application-compact-facts/);
  assert.match(html, /\.application-fact-pill/);
  assert.match(html, /\.review-summary-strip/);
  assert.match(html, /\.review-summary-card/);
  assert.match(html, /\.review-details-toolbar/);
  assert.match(html, /\.review-details\[open\] \.review-details-summary/);
  assert.doesNotMatch(html, /\.application-identity-row/);
  assert.doesNotMatch(html, /\.application-issues-grid/);
});
