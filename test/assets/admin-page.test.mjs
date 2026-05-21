import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function read(file) {
  return readFileSync(path.join(repoRoot, file), "utf8");
}

test("admin page: top-level modes include home, review, reports, portal", function () {
  const html = read("admin.html");
  const tabsJs = read("assets/admin-view-tabs.js");

  assert.match(html, /data-admin-tab="home"/);
  assert.match(html, /data-admin-tab="review"/);
  assert.match(html, /data-admin-tab="reports"/);
  assert.doesNotMatch(html, /data-admin-tab="today"/);
  assert.doesNotMatch(html, /data-admin-tab="listings"/);
  assert.doesNotMatch(html, /data-admin-tab="recovery"/);
  assert.match(tabsJs, /const DEFAULT_VIEW = "home"/);
  assert.match(tabsJs, /const VALID_VIEWS = \["home", "review", "reports", "portal"\]/);
});

test("admin page: home is the default visible admin workflow", function () {
  const html = read("admin.html");

  assert.match(html, /id="homeRegion" data-view-group="home"/);
  assert.match(html, /<h2 class="admin-live-title">Home<\/h2>/);
  assert.match(html, /id="supplyReviewRegion" data-view-group="review"/);
  assert.match(html, /<h2 class="admin-live-title">Review<\/h2>/);
  assert.match(html, /Review therapist signups first/);
  assert.match(html, /id="applicationsPanel"/);
  assert.match(html, /Sorted by publish confidence first, then newest submissions/);
  assert.match(html, /id="candidateQueuePanel" style="display: none" hidden/);
});

test("admin page: dead ops workflows are removed and portal requests are actionable", function () {
  const html = read("admin.html");

  // Dead hidden subsystems were deleted from the DOM: the work-queues
  // landing, the live-listings sidebar (published listings + licensure
  // lanes), and the in-admin confirmation/outreach + ops-inbox surface.
  assert.doesNotMatch(html, /id="workQueuesRegion"/);
  assert.doesNotMatch(html, /id="liveListingsRegion"/);
  assert.doesNotMatch(html, /id="confirmationRegion"/);
  assert.doesNotMatch(html, /id="requestsRegion"/);
  assert.doesNotMatch(html, /id="opsInboxPanel"/);

  // The "On hold" review queue stays parked but hidden.
  assert.match(html, /id="reviewRegion"[\s\S]*data-view-group="hidden"[\s\S]*hidden/);

  // Account recovery + portal requests are surfaced under the Portal tab so
  // incoming therapist requests are actionable rather than stranded.
  assert.match(html, /id="recoveryRegion"[\s\S]*data-view-group="portal"/);
  assert.match(html, /id="portalRequestsRegion"[\s\S]*data-view-group="portal"/);
  assert.match(html, /id="portalRequestsQueue"/);
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

test("dead confirmation/outreach/ops/listings modules are removed from the bundle", function () {
  const html = read("admin.html");
  const adminJs = read("assets/admin.js");

  // These subsystems were removed entirely (superseded by the standalone
  // Outreach CRM, the Home tab, and the Reports activity log). The files
  // must be gone and admin.js must no longer reference them.
  const deadModules = [
    "admin-ops-inbox.js",
    "admin-confirmation-workspace.js",
    "admin-confirmation-queue.js",
    "admin-confirmation-sprint.js",
    "admin-import-blocker-sprint.js",
    "admin-concierge-queue.js",
    "admin-listings-workspace.js",
    "admin-licensure-queue.js",
    "admin-licensure-sprint.js",
    "admin-licensure-deferred-queue.js",
  ];
  for (const moduleFile of deadModules) {
    assert.equal(
      existsSync(path.join(repoRoot, "assets", moduleFile)),
      false,
      `${moduleFile} should be deleted`,
    );
    assert.equal(
      adminJs.includes(moduleFile),
      false,
      `admin.js should not reference ${moduleFile}`,
    );
  }

  // The in-admin confirmation/outreach surface is gone from the page.
  assert.doesNotMatch(html, /id="confirmationRegion"/);
  assert.doesNotMatch(html, /id="liveListingsRegion"/);

  // Licensure ACTIVITY (read-only Reports panel) survives.
  assert.match(html, /id="licensureActivity"/);
});
