import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDirectoryTestFilters,
  buildDirectoryTestTherapist,
  renderDirectoryTestCard,
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
  assert.match(html, /Saved to list/);
});
