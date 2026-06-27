import test from "node:test";
import assert from "node:assert/strict";

import { HEADLINE_KEY_EVENTS, countEventsWithin } from "../../assets/admin-funnel.js";

// The home page fires `home_find_care_clicked` when a visitor clicks a
// "Find care" CTA (assets/home.js). The admin funnel dashboard surfaces it
// in the "At a glance" headline counts via HEADLINE_KEY_EVENTS. These tests
// pin both the wiring (the key is in the headline list) and the counting
// path that backs the metric.

test("home_find_care_clicked is a headline metric in the admin funnel dashboard", function () {
  assert.ok(
    HEADLINE_KEY_EVENTS.includes("home_find_care_clicked"),
    "expected the find-care click to appear in the At-a-glance headline counts",
  );
});

test("countEventsWithin counts home_find_care_clicked only within the window and for the right type", function () {
  const now = Date.now();
  const events = [
    { type: "home_find_care_clicked", occurredAt: new Date(now - 1000).toISOString() },
    { type: "home_find_care_clicked", occurredAt: new Date(now - 60 * 60 * 1000).toISOString() },
    // Outside a 24h window — must not count there.
    {
      type: "home_find_care_clicked",
      occurredAt: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(),
    },
    // Different type — must never count.
    { type: "signup_page_viewed", occurredAt: new Date(now - 1000).toISOString() },
  ];

  assert.equal(countEventsWithin(events, 24 * 60 * 60 * 1000, "home_find_care_clicked"), 2);
  assert.equal(countEventsWithin(events, 30 * 24 * 60 * 60 * 1000, "home_find_care_clicked"), 3);
});
