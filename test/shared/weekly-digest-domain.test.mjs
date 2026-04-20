import assert from "node:assert/strict";
import test from "node:test";

import { buildWeeklyDigest, renderWeeklyDigestEmail } from "../../shared/weekly-digest-domain.mjs";

test("buildWeeklyDigest returns null when both weeks have zero activity", () => {
  const digest = buildWeeklyDigest({
    current: { profileViewsTotal: 0, ctaClicksTotal: 0 },
    previous: { profileViewsTotal: 0, ctaClicksTotal: 0 },
  });
  assert.equal(digest, null);
});

test("buildWeeklyDigest computes trend + top source when there is activity", () => {
  const digest = buildWeeklyDigest({
    current: {
      periodKey: "2026-W16",
      periodStart: "2026-04-13T00:00:00.000Z",
      profileViewsTotal: 27,
      profileViewsMatch: 18,
      profileViewsDirectory: 7,
      profileViewsDirect: 2,
      ctaClicksTotal: 4,
      lastEventAt: "2026-04-19T12:00:00.000Z",
    },
    previous: { profileViewsTotal: 15, ctaClicksTotal: 3 },
  });
  assert.ok(digest);
  assert.equal(digest.views, 27);
  assert.equal(digest.clicks, 4);
  assert.equal(digest.viewsTrend.direction, "up");
  assert.equal(digest.viewsTrend.pct, 80); // (27-15)/15 = 80%
  assert.equal(digest.clicksTrend.direction, "up");
  assert.equal(digest.topSource.key, "match");
  assert.equal(digest.topSource.count, 18);
});

test("buildWeeklyDigest marks 'new' when prior week is zero but current has activity", () => {
  const digest = buildWeeklyDigest({
    current: { profileViewsTotal: 5, ctaClicksTotal: 1, profileViewsDirectory: 5 },
    previous: { profileViewsTotal: 0, ctaClicksTotal: 0 },
  });
  assert.ok(digest);
  assert.equal(digest.viewsTrend.direction, "new");
  assert.equal(digest.viewsTrend.pct, null);
});

test("buildWeeklyDigest handles activity this week but no prior-week rollup at all", () => {
  const digest = buildWeeklyDigest({
    current: { profileViewsTotal: 3, ctaClicksTotal: 0, profileViewsDirect: 3 },
    previous: null,
  });
  assert.ok(digest);
  assert.equal(digest.views, 3);
  assert.equal(digest.priorViews, 0);
  assert.equal(digest.viewsTrend.direction, "new");
});

test("renderWeeklyDigestEmail produces subject + body anchored on numbers", () => {
  const digest = buildWeeklyDigest({
    current: {
      profileViewsTotal: 12,
      profileViewsMatch: 8,
      profileViewsDirectory: 4,
      ctaClicksTotal: 2,
    },
    previous: { profileViewsTotal: 10, ctaClicksTotal: 2 },
  });
  const email = renderWeeklyDigestEmail({
    therapistName: "Dr. Tromba",
    digest,
    portalUrl: "https://www.bipolartherapyhub.com/portal?slug=foo",
  });
  assert.match(email.subject, /12 views/);
  assert.match(email.subject, /2 contact clicks/);
  assert.match(email.text, /Hi Dr. Tromba/);
  assert.match(email.text, /12 profile views/);
  assert.match(email.text, /up 20% vs last week/);
  assert.match(email.text, /Top source: match flow \(8 views\)/);
  assert.match(email.text, /\/portal\?slug=foo/);
});

test("renderWeeklyDigestEmail singularizes 1-view / 1-click copy", () => {
  const digest = buildWeeklyDigest({
    current: { profileViewsTotal: 1, ctaClicksTotal: 1, profileViewsMatch: 1 },
    previous: { profileViewsTotal: 0, ctaClicksTotal: 0 },
  });
  const email = renderWeeklyDigestEmail({ therapistName: "Jamie", digest, portalUrl: "" });
  assert.match(email.subject, / 1 view, /);
  assert.match(email.subject, / 1 contact click/);
  assert.match(email.text, /1 profile view /);
  assert.match(email.text, /1 contact click /);
});
