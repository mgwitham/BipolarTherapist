import test from "node:test";
import assert from "node:assert/strict";

import {
  summarizeFunnelEvents,
  summarizePatientJourney,
  summarizeExperimentPerformance,
  summarizeExperimentDecisions,
  summarizeAdaptiveSignals,
  summarizeProfileContactSignals,
  summarizeTherapistContactRoutePerformance,
  summarizeContactRouteOutcomePerformance,
  summarizeDirectoryProfileOpenQuality,
} from "../../assets/funnel-analytics.js";

// Regression net for the admin analytics aggregations (engineering-audit
// finding C). These functions are pure event-array -> summary transforms
// with 18 importers and previously zero direct coverage; bad aggregation
// silently corrupts the dashboards used for product decisions.

function ev(type, payload) {
  return { type, payload: payload || {} };
}

function repeat(n, make) {
  return Array.from({ length: n }, (_, i) => make(i));
}

// ── summarizeFunnelEvents ──────────────────────────────────────────────

test("summarizeFunnelEvents: counts searches, matches, outreach, and contact intents", () => {
  const events = [
    ev("home_search_submitted"),
    ev("home_search_submitted"),
    ev("directory_filters_applied"),
    ev("match_submitted"),
    ev("match_submitted"),
    ev("match_entry_outreach_started"),
    ev("match_result_profile_opened"),
    ev("match_result_profile_opened"),
    ev("directory_shortlist_saved"),
    null, // junk entries are ignored
    {},
  ];
  const s = summarizeFunnelEvents(events);
  assert.equal(s.total, 11); // total counts raw entries
  assert.equal(s.searches, 3);
  assert.equal(s.matches, 2);
  assert.equal(s.shortlist_saves, 1);
  assert.equal(s.outreach_starts, 1);
  // contact intents = outreach starts + draft copies + profile opens
  assert.equal(s.contact_intents, 3);
  // top_types sorted by count desc, then type asc
  assert.equal(s.top_types[0].count, 2);
  assert.ok(s.top_types.length <= 6);
});

test("summarizeFunnelEvents: empty and non-array input degrade to zeros", () => {
  for (const input of [[], null, undefined, "junk"]) {
    const s = summarizeFunnelEvents(input);
    assert.equal(s.total, 0);
    assert.equal(s.contact_intents, 0);
    assert.deepEqual(s.top_types, []);
  }
});

// ── summarizePatientJourney ────────────────────────────────────────────

test("summarizePatientJourney: builds stages and finds the biggest dropoff by rate", () => {
  const events = [
    ...repeat(10, () => ev("home_match_started")),
    ...repeat(4, () => ev("match_submitted")),
    // No shortlist actions at all: match -> shortlist drop rate is 4/4 = 1.0,
    // which beats homepage -> match (6/10 = 0.6).
  ];
  const s = summarizePatientJourney(events);
  assert.equal(s.stages[0].count, 10);
  assert.equal(s.stages[1].count, 4);
  assert.equal(s.biggest_dropoff.from, "match_submit");
  assert.equal(s.biggest_dropoff.drop_count, 4);
  assert.equal(s.biggest_dropoff.drop_rate, 1);
});

// ── summarizeExperimentPerformance / Decisions ─────────────────────────

function experimentEvents(variant, { exposures, matches, outreach }) {
  return [
    ...repeat(exposures, () => ev("experiment_exposed", { experiment_name: "hero_copy", variant })),
    ...repeat(matches, () => ev("match_submitted", { experiments: { hero_copy: variant } })),
    ...repeat(outreach, () =>
      ev("match_entry_outreach_started", { experiments: { hero_copy: variant } }),
    ),
  ];
}

test("summarizeExperimentPerformance: buckets exposures + conversions per variant with rates", () => {
  const events = [
    ...experimentEvents("A", { exposures: 10, matches: 8, outreach: 8 }),
    ...experimentEvents("B", { exposures: 10, matches: 2, outreach: 0 }),
  ];
  const rows = summarizeExperimentPerformance(events);
  assert.equal(rows.length, 2);
  const a = rows.find((r) => r.variant === "A");
  const b = rows.find((r) => r.variant === "B");
  assert.equal(a.exposures, 10);
  assert.equal(a.matches, 8);
  assert.equal(a.match_rate, 0.8);
  assert.equal(a.outreach_rate, 1); // 8 outreach / 8 matches
  assert.equal(b.match_rate, 0.2);
  // composite = match_rate * 0.35 + outreach_rate * 0.65
  assert.ok(Math.abs(a.composite_score - (0.8 * 0.35 + 1 * 0.65)) < 1e-9);
  // A sorts above B within the experiment
  assert.equal(rows[0].variant, "A");
});

test("summarizeExperimentDecisions: clear gap => Promising winner", () => {
  const events = [
    ...experimentEvents("A", { exposures: 10, matches: 8, outreach: 8 }),
    ...experimentEvents("B", { exposures: 10, matches: 2, outreach: 0 }),
  ];
  const [decision] = summarizeExperimentDecisions(events);
  assert.equal(decision.winner.variant, "A");
  assert.equal(decision.recommendation, "Promising winner");
  assert.ok(decision.confidence_gap >= 0.08);
});

test("summarizeExperimentDecisions: identical variants => Too early to call", () => {
  const events = [
    ...experimentEvents("A", { exposures: 6, matches: 3, outreach: 1 }),
    ...experimentEvents("B", { exposures: 6, matches: 3, outreach: 1 }),
  ];
  const [decision] = summarizeExperimentDecisions(events);
  assert.equal(decision.confidence_gap, 0);
  assert.equal(decision.recommendation, "Too early to call");
});

test("summarizeExperimentDecisions: tiny sample => Needs more traffic", () => {
  const events = [
    ...experimentEvents("A", { exposures: 2, matches: 2, outreach: 2 }),
    ...experimentEvents("B", { exposures: 2, matches: 0, outreach: 0 }),
  ];
  const [decision] = summarizeExperimentDecisions(events);
  assert.equal(decision.recommendation, "Needs more traffic");
});

// ── summarizeAdaptiveSignals ───────────────────────────────────────────

test("summarizeAdaptiveSignals: volume-based preference when there are no outcomes", () => {
  const events = [
    ev("match_shortlist_saved"),
    ev("match_shortlist_saved"),
    ev("match_share_link_copied"),
  ];
  const s = summarizeAdaptiveSignals(events, [], []);
  assert.equal(s.action_counts.save, 3);
  assert.equal(s.preferred_match_action, "save");
  assert.equal(s.match_action_basis, "behavior");
});

test("summarizeAdaptiveSignals: strong outcomes override behavior volume", () => {
  // Volume favors outreach (2 events), but 3 strong outcomes credit "help".
  const events = [ev("match_result_profile_opened"), ev("match_entry_outreach_started")];
  const outcomes = repeat(3, () => ({
    outcome: "booked_consult",
    context: { strategy: { match_action: "help" } },
  }));
  const s = summarizeAdaptiveSignals(events, outcomes, []);
  // help score = 3 strong * 3 = 9 > outreach score = 2 volume
  assert.equal(s.preferred_match_action, "help");
  assert.equal(s.match_action_basis, "outcomes");
  assert.equal(s.strategy_performance.help.strong, 3);
});

test("summarizeAdaptiveSignals: segment filter drops non-matching events", () => {
  const events = [
    ev("match_shortlist_saved", { strategy: { segments: ["telehealth_seeker"] } }),
    ev("match_shortlist_saved", { strategy: { segments: ["other_segment"] } }),
    ev("match_shortlist_saved"), // no segments at all
  ];
  const s = summarizeAdaptiveSignals(events, [], ["telehealth_seeker"]);
  assert.equal(s.action_counts.save, 1);
  assert.deepEqual(s.segment_filter, ["telehealth_seeker"]);
});

test("summarizeAdaptiveSignals: no signal at all defaults to help + best_match", () => {
  const s = summarizeAdaptiveSignals([], [], []);
  assert.equal(s.preferred_match_action, "help");
  assert.equal(s.preferred_directory_sort, "best_match");
});

// ── summarizeProfileContactSignals ─────────────────────────────────────

test("summarizeProfileContactSignals: routes, top profiles, and guidance rate", () => {
  const events = [
    ev("profile_contact_section_viewed"),
    ev("profile_contact_section_viewed"),
    ev("profile_outreach_script_engaged"),
    ev("profile_contact_questions_engaged"),
    ev("profile_contact_route_clicked", {
      route: "booking",
      therapist_slug: "slug-a",
      priority: "primary",
    }),
    ev("profile_contact_route_clicked", {
      route: "booking",
      therapist_slug: "slug-a",
      priority: "primary",
    }),
    ev("profile_contact_route_clicked", { route: "booking", therapist_slug: "slug-b" }),
    ev("profile_contact_route_clicked", { route: "phone", therapist_slug: "slug-b" }),
  ];
  const s = summarizeProfileContactSignals(events);
  assert.equal(s.section_views, 2);
  assert.equal(s.total_route_clicks, 4);
  assert.equal(s.top_route.route, "booking");
  assert.equal(s.top_route.count, 3);
  assert.equal(s.guidance_engagements, 2);
  assert.equal(s.guidance_engagement_rate, 0.5);
  assert.equal(s.top_profiles[0].slug, "slug-a");
  assert.equal(s.top_profiles[0].clicks, 2);
  assert.match(s.interpretation, /Some users are engaging/);
});

test("summarizeProfileContactSignals: empty input reports no behavior", () => {
  const s = summarizeProfileContactSignals([]);
  assert.equal(s.total_route_clicks, 0);
  assert.match(s.interpretation, /No profile contact behavior/);
});

// ── summarizeTherapistContactRoutePerformance ──────────────────────────

function routeClick(slug, route) {
  return ev("profile_contact_route_clicked", { therapist_slug: slug, route });
}

test("route performance: filters to the requested slug and grades confidence", () => {
  const events = [
    ...repeat(4, () => routeClick("mine", "booking")),
    routeClick("mine", "phone"),
    ...repeat(10, () => routeClick("other", "email")), // other slug must be ignored
  ];
  const s = summarizeTherapistContactRoutePerformance(events, "mine");
  assert.equal(s.total_route_clicks, 5);
  assert.equal(s.top_route.route, "booking");
  // 4 clicks at 80% share clears the strong bar (>=4 and >=55%)
  assert.equal(s.confidence, "strong");
});

test("route performance: light single click, none for empty slug or no data", () => {
  assert.equal(
    summarizeTherapistContactRoutePerformance([routeClick("mine", "email")], "mine").confidence,
    "light",
  );
  assert.equal(summarizeTherapistContactRoutePerformance([], "mine").confidence, "none");
  assert.equal(
    summarizeTherapistContactRoutePerformance([routeClick("x", "email")], "").confidence,
    "none",
  );
});

// ── summarizeContactRouteOutcomePerformance ────────────────────────────

test("route outcomes: strong/friction nets pick the leader", () => {
  const outcomes = [
    { outcome: "booked_consult", route_type: "booking" },
    { outcome: "heard_back", route_type: "booking" },
    { outcome: "no_response", route_type: "email" },
    { outcome: "no_response", route_type: "email" },
  ];
  const s = summarizeContactRouteOutcomePerformance(outcomes);
  assert.equal(s.leader.route, "booking");
  assert.equal(s.leader.net, 2);
  const email = s.rows.find((r) => r.route === "email");
  assert.equal(email.net, -2);
  assert.match(s.interpretation, /stronger downstream follow-through/);
});

test("route outcomes: actual_route_type wins over route_type; empty input handled", () => {
  const s = summarizeContactRouteOutcomePerformance([
    { outcome: "heard_back", route_type: "email", actual_route_type: "phone" },
  ]);
  assert.equal(s.rows[0].route, "phone");
  assert.match(summarizeContactRouteOutcomePerformance([]).interpretation, /No route-linked/);
});

// ── summarizeDirectoryProfileOpenQuality ───────────────────────────────

test("directory open quality: buckets by source and counts quality flags", () => {
  const events = [
    ev("directory_profile_open_quality", {
      source: "directory",
      readiness_score: 90,
      freshness_status: "fresh",
      accepting_new_patients: true,
      has_bipolar_experience: true,
    }),
    ev("directory_profile_open_quality", { source: "directory", readiness_score: 50 }),
    ev("some_other_event"),
  ];
  const s = summarizeDirectoryProfileOpenQuality(events);
  const row = s.rows.find((r) => r.source === "directory");
  assert.ok(row, "expected a directory bucket row");
  assert.equal(row.opens, 2);
  assert.equal(row.high_readiness, 1);
  assert.equal(row.fresh_profiles, 1);
  assert.equal(row.accepting_profiles, 1);
  assert.equal(row.bipolar_profiles, 1);
});
