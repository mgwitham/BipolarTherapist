import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFounderFunnelDigest,
  renderFounderFunnelEmail,
  _internals,
} from "../../shared/founder-funnel-digest-domain.mjs";

const NOW = "2026-04-25T12:00:00.000Z";
const NOW_MS = new Date(NOW).getTime();

function eventAt(type, daysAgo) {
  return {
    type,
    occurredAt: new Date(NOW_MS - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    payload: "",
  };
}

test("buildFounderFunnelDigest returns null when no patient or supply activity in either window", () => {
  const result = buildFounderFunnelDigest({ events: [], nowIso: NOW });
  assert.equal(result, null);
});

test("buildFounderFunnelDigest still emits when only supply-side activity exists", () => {
  const events = [eventAt("signup_page_viewed", 1), eventAt("signup_new_listing_submitted", 0.5)];
  const result = buildFounderFunnelDigest({ events, nowIso: NOW });
  assert.ok(result);
  assert.equal(result.patient.started, 0);
  assert.equal(result.signup.started, 1);
});

test("buildFounderFunnelDigest computes patient funnel rows + conversions", () => {
  const events = [
    eventAt("home_match_started", 1),
    eventAt("home_match_started", 1),
    eventAt("home_match_started", 1),
    eventAt("home_match_started", 1),
    eventAt("match_intake_landed", 1),
    eventAt("match_intake_landed", 1),
    eventAt("match_intake_landed", 1),
    eventAt("match_submitted", 1),
    eventAt("match_submitted", 1),
    eventAt("match_results_viewed", 1),
    eventAt("match_result_profile_opened", 1),
    eventAt("match_contact_modal_opened", 1),
  ];
  const result = buildFounderFunnelDigest({ events, nowIso: NOW });
  assert.ok(result);
  assert.equal(result.patient.started, 4);
  assert.equal(result.patient.reachedContact, 1);
  const rows = result.patient.rows;
  assert.equal(rows[0].count, 4);
  assert.equal(rows[0].conversion, 100);
  assert.equal(rows[1].count, 3);
  assert.equal(rows[1].dropoff, 25);
  assert.equal(rows[2].count, 2);
  assert.equal(rows[5].count, 1);
});

test("buildFounderFunnelDigest identifies the biggest drop-off rung", () => {
  const events = [
    eventAt("home_match_started", 1),
    eventAt("home_match_started", 1),
    eventAt("home_match_started", 1),
    eventAt("home_match_started", 1),
    eventAt("match_intake_landed", 1),
    eventAt("match_intake_landed", 1),
    eventAt("match_intake_landed", 1),
    eventAt("match_intake_landed", 1),
    eventAt("match_submitted", 1),
    eventAt("match_results_viewed", 1),
    eventAt("match_result_profile_opened", 1),
    eventAt("match_contact_modal_opened", 1),
  ];
  const result = buildFounderFunnelDigest({ events, nowIso: NOW });
  assert.ok(result.patient.bottleneck);
  assert.equal(result.patient.bottleneck.fromLabel, "Landed on results page");
  assert.equal(result.patient.bottleneck.toLabel, "Completed intake");
  assert.equal(result.patient.bottleneck.dropoff, 75);
});

test("buildFounderFunnelDigest computes direction vs prior week", () => {
  const events = [
    eventAt("home_match_started", 1),
    eventAt("home_match_started", 2),
    eventAt("home_match_started", 8),
    eventAt("home_match_started", 9),
    eventAt("home_match_started", 10),
  ];
  const result = buildFounderFunnelDigest({ events, nowIso: NOW });
  assert.equal(result.patient.started, 2);
  assert.equal(result.patient.priorStarted, 3);
  assert.equal(result.patient.direction, "down");
});

test("buildFounderFunnelDigest treats prior-zero current-positive as 'new'", () => {
  const events = [eventAt("home_match_started", 1)];
  const result = buildFounderFunnelDigest({ events, nowIso: NOW });
  assert.equal(result.patient.direction, "new");
});

test("buildFounderFunnelDigest excludes events outside the windows", () => {
  const events = [eventAt("home_match_started", 30), eventAt("home_match_started", 60)];
  const result = buildFounderFunnelDigest({ events, nowIso: NOW });
  assert.equal(result, null);
});

test("renderFounderFunnelEmail produces subject and body anchored on numbers", () => {
  const events = [
    eventAt("home_match_started", 1),
    eventAt("home_match_started", 1),
    eventAt("match_intake_landed", 1),
    eventAt("match_submitted", 1),
    eventAt("match_results_viewed", 1),
    eventAt("match_result_profile_opened", 1),
    eventAt("match_contact_modal_opened", 1),
  ];
  const digest = buildFounderFunnelDigest({ events, nowIso: NOW });
  const { subject, text } = renderFounderFunnelEmail({
    digest,
    adminUrl: "https://www.bipolartherapyhub.com/admin.html",
  });
  assert.match(subject, /BipolarTherapyHub funnel:/);
  assert.match(subject, /2 patient session/);
  assert.match(text, /Patient match funnel:/);
  assert.match(text, /Started from home: 2/);
  assert.match(text, /Opened contact modal: 1/);
  assert.match(text, /https:\/\/www\.bipolartherapyhub\.com\/admin\.html/);
});

test("renderFounderFunnelEmail singularizes 1-session copy", () => {
  const events = [eventAt("home_match_started", 1), eventAt("match_contact_modal_opened", 1)];
  const digest = buildFounderFunnelDigest({ events, nowIso: NOW });
  const { subject } = renderFounderFunnelEmail({ digest });
  assert.match(subject, /1 patient session(?!s)/);
});

function issueReportEvent(payload, daysAgo) {
  return {
    type: "listing_issue_reported",
    occurredAt: new Date(NOW_MS - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    payload: JSON.stringify(payload),
  };
}

test("buildFounderFunnelDigest includes issue reports from current window", () => {
  const events = [
    issueReportEvent(
      {
        slug: "jane-doe",
        therapist_name: "Jane Doe",
        reason: "closed_or_moved",
        comment: "Office closed last month.",
      },
      2,
    ),
    issueReportEvent(
      {
        slug: "john-smith",
        therapist_name: "John Smith",
        reason: "not_bipolar_specialist",
        comment: "",
      },
      4,
    ),
  ];
  const result = buildFounderFunnelDigest({ events, nowIso: NOW });
  assert.ok(result);
  assert.equal(result.issueReports.length, 2);
  assert.equal(result.issueReports[0].therapistName, "Jane Doe");
  assert.equal(result.issueReports[0].reason, "closed_or_moved");
});

test("buildFounderFunnelDigest emits a digest even with only issue reports", () => {
  const events = [issueReportEvent({ slug: "x", therapist_name: "X", reason: "wrong_contact" }, 1)];
  const result = buildFounderFunnelDigest({ events, nowIso: NOW });
  assert.ok(result);
  assert.equal(result.issueReports.length, 1);
});

test("renderFounderFunnelEmail includes the issue reports section", () => {
  const events = [
    eventAt("home_match_started", 1),
    issueReportEvent(
      {
        slug: "jane-doe",
        therapist_name: "Jane Doe",
        reason: "closed_or_moved",
        comment: "Office closed",
      },
      2,
    ),
  ];
  const digest = buildFounderFunnelDigest({ events, nowIso: NOW });
  const { text } = renderFounderFunnelEmail({ digest });
  assert.match(text, /Listing issues reported \(1\):/);
  assert.match(text, /Jane Doe \[closed or moved\]/);
  assert.match(text, /Office closed/);
});

test("buildFounderFunnelDigest excludes issue reports older than the window", () => {
  const events = [
    eventAt("home_match_started", 1),
    issueReportEvent({ slug: "old-report", reason: "other" }, 30),
  ];
  const result = buildFounderFunnelDigest({ events, nowIso: NOW });
  assert.equal(result.issueReports.length, 0);
});

test("internals expose step keys for cross-referencing", () => {
  assert.ok(_internals.PATIENT_STEPS.length === 6);
  assert.equal(_internals.PATIENT_STEPS[0].key, "home_match_started");
  assert.equal(_internals.PATIENT_STEPS[5].key, "match_contact_modal_opened");
});
