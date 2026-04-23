import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function read(file) {
  return readFileSync(path.join(repoRoot, file), "utf8");
}

test("admin page: top-level modes separate today, work queues, reports, and recovery", function () {
  const html = read("admin.html");

  assert.match(html, /data-admin-tab="today"/);
  assert.match(html, /Work queues/);
  assert.match(html, /data-admin-tab="reports"/);
  assert.match(html, /data-admin-tab="recovery"/);
  assert.doesNotMatch(html, /data-admin-tab="funnel"/);
});

test("admin page: queue work is separated from the today surface", function () {
  const html = read("admin.html");

  assert.match(html, /id="todayRegion" data-view-group="today"/);
  assert.match(html, /id="supplyReviewRegion" data-view-group="listings"/);
  assert.match(html, /id="workQueuesRegion" data-view-group="listings"/);
  assert.match(html, /Pick one queue and stay in that operating mode/);
});

test("admin page: reports absorb funnel analysis instead of using a separate mode", function () {
  const html = read("admin.html");
  const funnelJs = read("assets/admin-funnel.js");
  const tabsJs = read("assets/admin-view-tabs.js");

  assert.match(html, /id="funnelRegion"[\s\S]*data-view-group="reports"/);
  assert.match(funnelJs, /data-admin-view"\) === "reports"/);
  assert.match(tabsJs, /const VALID_VIEWS = \["today", "listings", "reports", "recovery"\]/);
});

test("admin page: login and editing copy emphasize clear secure states", function () {
  const html = read("admin.html");
  const editJs = read("assets/admin-candidate-edit.js");
  const adminJs = read("assets/admin.js");

  assert.match(html, /Secure admin access/);
  assert.match(html, /Sign in to the operator workspace/);
  assert.match(html, /Only approved operators can access live actions and reports/);
  assert.match(html, /id="editDrawerDirty"/);
  assert.match(html, /id="editDrawerVisibility"/);
  assert.match(editJs, /Unsaved changes/);
  assert.match(editJs, /changed elsewhere/);
  assert.match(adminJs, /admin_login_attempt/);
  assert.match(adminJs, /admin_today_view_loaded/);
});

test("admin page: secondary filters are progressively revealed", function () {
  const html = read("admin.html");

  assert.match(html, /id="candidateFilterDetails"/);
  assert.match(html, /Show duplicate and merge states/);
  assert.match(html, /id="applicationFilterDetails"/);
  assert.match(html, /Fine-tune signups, claim flow, and review goals/);
});

test("confirmation queue cards stay action-first instead of repeating ask scaffolding", function () {
  const confirmationQueueJs = read("assets/admin-confirmation-queue.js");

  assert.match(confirmationQueueJs, /<strong>Waiting on:<\/strong>/);
  assert.match(confirmationQueueJs, /<strong>Next step:<\/strong>/);
  assert.match(confirmationQueueJs, /Copy live update brief/);
  assert.doesNotMatch(confirmationQueueJs, /<strong>Primary ask:<\/strong>/);
  assert.doesNotMatch(confirmationQueueJs, /<strong>Add-on asks:<\/strong>/);
  assert.doesNotMatch(confirmationQueueJs, /<strong>Ordered ask flow:<\/strong>/);
  assert.doesNotMatch(confirmationQueueJs, /Copy operator checklist/);
});

test("missing-details sprint stays email-first and avoids summary overload", function () {
  const importBlockerJs = read("assets/admin-import-blocker-sprint.js");

  assert.match(importBlockerJs, /Email top missing-details request/);
  assert.match(importBlockerJs, /Email therapist to update profile/);
  assert.match(importBlockerJs, /<strong>Waiting on:<\/strong>/);
  assert.match(importBlockerJs, /<strong>Next step:<\/strong>/);
  assert.doesNotMatch(importBlockerJs, /Copy shared ask/);
  assert.doesNotMatch(importBlockerJs, /Copy unified outreach wave/);
  assert.doesNotMatch(importBlockerJs, /<strong>Strict gate impact:<\/strong>/);
  assert.doesNotMatch(importBlockerJs, /<strong>Source-first:<\/strong>/);
  assert.doesNotMatch(importBlockerJs, /<strong>Therapist-confirmation:<\/strong>/);
});

test("confirmation sprint cards stay action-first and email-forward", function () {
  const confirmationSprintJs = read("assets/admin-confirmation-sprint.js");

  assert.match(confirmationSprintJs, /Email therapist to confirm profile/);
  assert.match(confirmationSprintJs, /<strong>Waiting on:<\/strong>/);
  assert.match(confirmationSprintJs, /<strong>Next step:<\/strong>/);
  assert.doesNotMatch(confirmationSprintJs, /<strong>Primary ask:<\/strong>/);
  assert.doesNotMatch(confirmationSprintJs, /<strong>Add-on asks:<\/strong>/);
  assert.doesNotMatch(confirmationSprintJs, /<strong>Ordered ask flow:<\/strong>/);
  assert.doesNotMatch(confirmationSprintJs, /\[ \] Review current profile and source trail/);
  assert.doesNotMatch(confirmationSprintJs, /Copy therapist request/);
});

test("california priority wave cards stay action-first and email-forward", function () {
  const confirmationWorkspaceJs = read("assets/admin-confirmation-workspace.js");

  assert.match(confirmationWorkspaceJs, /Email therapist to confirm profile/);
  assert.match(confirmationWorkspaceJs, /<strong>Waiting on:<\/strong>/);
  assert.match(confirmationWorkspaceJs, /<strong>Next step:<\/strong>/);
  assert.doesNotMatch(confirmationWorkspaceJs, /<strong>Primary ask:<\/strong>/);
  assert.doesNotMatch(confirmationWorkspaceJs, /<strong>Add-on asks:<\/strong>/);
  assert.doesNotMatch(confirmationWorkspaceJs, /<strong>First action:<\/strong>/);
  assert.doesNotMatch(confirmationWorkspaceJs, /<strong>Follow-up rule:<\/strong>/);
  assert.doesNotMatch(confirmationWorkspaceJs, /Copy request/);
});

test("admin page: shared delayed-hover tooltips explain high-frequency admin actions", function () {
  const html = read("admin.html");
  const tooltipJs = read("assets/admin-tooltips.js");

  assert.match(html, /assets\/admin-tooltips\.js/);
  assert.match(html, /\.admin-hover-tooltip/);
  assert.match(tooltipJs, /const HOVER_DELAY_MS = 450/);
  assert.match(tooltipJs, /selector: "#candidateQueueFocusToggle"/);
  assert.match(tooltipJs, /selector: '\[data-candidate-next="publish"\]'/);
  assert.match(tooltipJs, /selector: '\[data-action="requested_changes"\]'/);
  assert.match(tooltipJs, /selector: "\[data-confirmation-copy\]"/);
  assert.match(tooltipJs, /Jump into the recommended next workflow step/);
});
