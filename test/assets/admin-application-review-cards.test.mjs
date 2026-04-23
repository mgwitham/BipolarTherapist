import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function read(file) {
  return readFileSync(path.join(repoRoot, file), "utf8");
}

test("admin signup cards use one review grammar with explicit status semantics", function () {
  const reviewJs = read("assets/admin-application-review.js");

  assert.match(reviewJs, /label: "Workflow state"/);
  assert.match(reviewJs, /label: "Work type"/);
  assert.match(reviewJs, /label: "Priority"/);
  assert.match(reviewJs, /Recommended action/);
  assert.match(reviewJs, /renderIssueColumn\(\{\s*label: "Blocking"/);
  assert.match(reviewJs, /label: "Recommended before publish"/);
  assert.match(reviewJs, /label: "Advisory"/);
});

test("admin signup cards keep a consistent action hierarchy and explicit details control", function () {
  const reviewJs = read("assets/admin-application-review.js");
  const actionsJs = read("assets/admin-application-actions.js");

  assert.match(reviewJs, /data-review-details-open/);
  assert.match(reviewJs, /View details/);
  assert.match(reviewJs, /btn-danger-quiet/);
  assert.match(actionsJs, /data-review-details-open/);
  assert.match(actionsJs, /details\.open = true/);
});

test("admin signup card styles support the new standardized anatomy", function () {
  const html = read("admin.html");

  assert.match(html, /\.application-identity-row/);
  assert.match(html, /\.application-status-row/);
  assert.match(html, /\.application-recommendation-block/);
  assert.match(html, /\.application-action-row/);
  assert.match(html, /\.application-readiness-block/);
  assert.match(html, /\.application-issues-grid/);
  assert.match(html, /\.btn-danger-quiet/);
  assert.match(html, /\.review-details\[open\] \.review-details-summary/);
});
