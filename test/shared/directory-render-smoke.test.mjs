import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDirectoryTestFilters,
  buildDirectoryTestTherapist,
  renderDirectoryTestCard,
  renderDirectoryTestShortlist,
} from "./directory-test-helpers.mjs";

test("directory card render smoke keeps core CTA and shortlist hooks intact", function () {
  const therapist = buildDirectoryTestTherapist();
  const html = renderDirectoryTestCard({
    therapist,
    filters: buildDirectoryTestFilters(),
    shortlist: [{ slug: therapist.slug, priority: "Best fit", note: "Strong insurance fit" }],
  });

  assert.match(html, /data-shortlist-slug="jamie-rivera"/);
  assert.match(html, /data-primary-cta="jamie-rivera"/);
  assert.match(html, /data-review-fit="jamie-rivera"/);
  assert.match(html, /Book intro/);
  assert.match(html, /Decision readiness/);
});

test("directory shortlist render smoke keeps compare and queue controls visible", function () {
  const therapist = buildDirectoryTestTherapist();
  const html = renderDirectoryTestShortlist({
    shortlist: [{ slug: therapist.slug, priority: "Best fit", note: "" }],
    therapists: [therapist],
    filters: buildDirectoryTestFilters({
      insurance: "",
      telehealth: false,
      accepting: false,
    }),
    buildCompareUrl: function () {
      return "match.html?shortlist=jamie-rivera";
    },
    buildOutreachQueueUrl: function () {
      return "match.html?shortlist=jamie-rivera&entry=outreach_queue";
    },
    outreachProgress: {
      hasProgress: true,
      summary: "You already started outreach here.",
    },
  });

  assert.match(html, /Compare details/);
  assert.match(html, /Resume outreach queue/);
  assert.match(html, /data-queue-lead-slug="jamie-rivera"/);
  assert.match(html, /Jamie Rivera looks strongest to contact first/);
});
