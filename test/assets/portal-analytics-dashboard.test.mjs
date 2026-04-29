import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const portalJs = readFileSync(
  fileURLToPath(new URL("../../assets/portal.js", import.meta.url)),
  "utf8",
);
const previewHtml = readFileSync(
  fileURLToPath(new URL("../../paid-analytics-preview.html", import.meta.url)),
  "utf8",
);

test("paid analytics dashboard: leads with weekly decision framing", () => {
  // TD-E renamed the planZone copy to match the redesign spec.
  // The card is now eyebrowed "This week" with a "Patient activity"
  // heading and a calmer empty-state body.
  assert.match(portalJs, /This week/);
  assert.match(portalJs, /Patient activity/);
  assert.match(portalJs, /weekly profile views, match appearances, and contact events/);
});

test("paid analytics dashboard: renders summary, top insight, changes, and recommendations", () => {
  assert.match(portalJs, /Most important takeaway/);
  assert.match(portalJs, /Profile strength/);
  assert.match(portalJs, /Top actions this week/);
  assert.match(portalJs, /Performance summary/);
  assert.match(portalJs, /What changed this week/);
  assert.match(portalJs, /ranked by likely impact/);
  assert.match(portalJs, /What to watch next week/);
});

test("paid analytics dashboard: source and contact path modules expose evidence", () => {
  assert.match(portalJs, /How patients found you/);
  assert.match(portalJs, /How patients tried to reach you/);
  assert.match(portalJs, /ranked by volume/);
  assert.match(portalJs, /accounts for/);
});

test("paid analytics dashboard: supports confidence, low-data, and readiness states", () => {
  assert.match(portalJs, /Low-signal week/);
  assert.match(portalJs, /Directional signal/);
  assert.match(portalJs, /Listing readiness/);
  assert.match(portalJs, /Signals present/);
  assert.match(portalJs, /Highest-impact profile update/);
  assert.match(portalJs, /Use this quiet week to fill the biggest readiness gaps first/);
});

test("paid analytics dashboard: includes direct profile-update actions and instrumentation", () => {
  assert.match(portalJs, /data-portal-editor-jump="1"/);
  assert.match(portalJs, /Open profile editor/);
  assert.match(portalJs, /data-analytics-action="open_profile_editor"/);
  assert.match(portalJs, /portal_analytics_viewed/);
  assert.match(portalJs, /portal_analytics_action_clicked/);
  assert.match(
    portalJs,
    /Add booking link|Update availability|Add fee details|Strengthen specialty language/,
  );
  assert.match(portalJs, /aria-label="Profile strength"/);
  assert.match(portalJs, /aria-label="What to watch next week"/);
});

test("paid analytics dashboard: does not render outgoing email content inside dashboard", () => {
  assert.doesNotMatch(portalJs, /Monday digest preview/);
  assert.doesNotMatch(portalJs, /secondary summary sent by email/);
  assert.doesNotMatch(portalJs, /Your digest mirrors the dashboard/);
});

test("paid analytics preview: separates preview framing from live dashboard copy", () => {
  assert.match(previewHtml, /Local paid feature preview/);
  assert.match(previewHtml, /sample data/);
  assert.match(previewHtml, /Profile strength/);
  assert.match(previewHtml, /Top actions this week/);
  assert.doesNotMatch(previewHtml, /feel worth paying for/i);
});

test("paid analytics preview: keeps mobile handling and compact secondary copy", () => {
  assert.match(previewHtml, /@media \(max-width: 880px\)/);
  assert.match(previewHtml, /Preview mode uses sample data/);
});
