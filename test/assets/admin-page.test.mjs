import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function read(file) {
  return readFileSync(path.join(repoRoot, file), "utf8");
}

test("admin page: top-level modes are review and reports", function () {
  const html = read("admin.html");
  const tabsJs = read("assets/admin-view-tabs.js");

  assert.match(html, /data-admin-tab="review"/);
  assert.match(html, /data-admin-tab="reports"/);
  assert.doesNotMatch(html, /data-admin-tab="today"/);
  assert.doesNotMatch(html, /data-admin-tab="listings"/);
  assert.doesNotMatch(html, /data-admin-tab="recovery"/);
  assert.match(tabsJs, /const DEFAULT_VIEW = "review"/);
  assert.match(tabsJs, /const VALID_VIEWS = \["review", "reports", "portal"\]/);
});

test("admin page: review is the default visible admin workflow", function () {
  const html = read("admin.html");

  assert.match(html, /id="supplyReviewRegion" data-view-group="review"/);
  assert.match(html, /<h2 class="admin-live-title">Review<\/h2>/);
  assert.match(html, /Review therapist signups first/);
  assert.match(html, /id="applicationsPanel"/);
  assert.match(html, /Sorted by publish confidence first, then newest submissions/);
  assert.match(html, /id="candidateQueuePanel" style="display: none" hidden/);
});

test("admin page: unrelated workflows are hidden from the default experience", function () {
  const html = read("admin.html");

  assert.match(html, /id="workQueuesRegion"[\s\S]*data-view-group="hidden"[\s\S]*hidden/);
  assert.match(html, /id="liveListingsRegion"[\s\S]*data-view-group="hidden"[\s\S]*hidden/);
  assert.match(html, /id="reviewRegion"[\s\S]*data-view-group="hidden"[\s\S]*hidden/);
  assert.match(html, /id="requestsRegion"[\s\S]*data-view-group="hidden"[\s\S]*hidden/);
  assert.match(html, /id="recoveryRegion"[\s\S]*data-view-group="hidden"[\s\S]*hidden/);
});

test("admin page: review filters are intentionally minimal", function () {
  const html = read("admin.html");
  const adminJs = read("assets/admin.js");

  assert.match(html, /id="applicationStatusFilter"/);
  assert.match(html, />All<\/option>/);
  assert.match(html, />Publish-ready<\/option>/);
  assert.match(html, />Needs fixes<\/option>/);
  assert.match(html, />On hold<\/option>/);
  assert.match(html, />Rejected<\/option>/);
  assert.doesNotMatch(html, /id="applicationFocusFilter"/);
  assert.doesNotMatch(html, /id="applicationReviewGoal"/);
  assert.match(adminJs, /admin_review_filter_changed/);
});

test("admin page: reports stay separate from review execution", function () {
  const html = read("admin.html");
  const adminJs = read("assets/admin.js");

  assert.match(html, /id="reportsModeShell" data-view-group="reports"/);
  assert.match(html, /Analyze patterns without competing with active queue work/);
  assert.match(html, /id="intelligenceRegion" data-view-group="reports"/);
  assert.match(adminJs, /admin_report_view_opened/);
  assert.match(adminJs, /admin_review_view_opened/);
});

test("admin page: login copy is narrowed to review and reports", function () {
  const html = read("admin.html");
  const adminJs = read("assets/admin.js");

  assert.match(html, /Secure admin access/);
  assert.match(html, /Sign in to the operator workspace/);
  assert.match(html, /Review therapist signups and check pipeline reports/);
  assert.match(adminJs, /admin_login_attempt/);
  assert.match(adminJs, /admin_review_view_loaded/);
});

test("application review cards expose summary strip, details toggle, and decision actions", function () {
  const applicationReviewJs = read("assets/admin-application-review.js");
  const applicationActionsJs = read("assets/admin-application-actions.js");

  assert.match(applicationReviewJs, /review-summary-strip/);
  assert.match(applicationReviewJs, /Total to review/);
  assert.match(applicationReviewJs, /Publish-ready/);
  assert.match(applicationReviewJs, /Needs fixes/);
  assert.match(applicationReviewJs, /data-open-review-details/);
  assert.match(applicationReviewJs, /data-close-review-details/);
  assert.match(applicationReviewJs, /Request changes/);
  assert.match(applicationReviewJs, /Reject/);
  assert.match(applicationActionsJs, /data-open-review-details/);
  assert.match(applicationActionsJs, /data-close-review-details/);
});

test("admin page: shared delayed-hover tooltips still exist for active admin actions", function () {
  const html = read("admin.html");
  const tooltipJs = read("assets/admin-tooltips.js");

  assert.match(html, /assets\/admin-tooltips\.js/);
  assert.match(html, /\.admin-hover-tooltip/);
  assert.match(tooltipJs, /const HOVER_DELAY_MS = 450/);
});

test("confirmation and outreach supporting modules remain available but not primary", function () {
  const html = read("admin.html");
  const importBlockerJs = read("assets/admin-import-blocker-sprint.js");

  assert.match(importBlockerJs, /Email therapist/);
  assert.match(html, /id="liveListingsRegion"[\s\S]*hidden/);
});
