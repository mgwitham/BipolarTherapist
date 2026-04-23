import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDirectoryTestFilters,
  buildDirectoryTestTherapist,
  renderDirectoryTestCard,
} from "./directory-test-helpers.mjs";
import {
  renderDirectoryDetailsMarkup,
  renderDirectoryRecommendationsMarkup,
} from "../../assets/directory-render.js";
import {
  buildDirectoryDetailsViewModel,
  buildDirectoryRecommendationModel,
} from "../../assets/directory-view-model.js";

test("directory card render smoke keeps core CTA hierarchy and shortlist hooks intact", function () {
  const therapist = buildDirectoryTestTherapist();
  const html = renderDirectoryTestCard({
    therapist,
    filters: buildDirectoryTestFilters(),
    shortlist: [{ slug: therapist.slug, priority: "Best fit", note: "Strong insurance fit" }],
  });

  assert.match(html, /data-shortlist-slug="jamie-rivera"/);
  assert.match(html, /data-primary-cta="jamie-rivera"/);
  assert.match(html, /data-view-details="jamie-rivera"/);
  assert.match(html, /Contact therapist/);
  assert.match(html, /View details/);
  assert.match(html, /Saved/);
});

test("recommendation render smoke highlights featured and backup hierarchy", function () {
  const featured = buildDirectoryTestTherapist();
  const backup = buildDirectoryTestTherapist({
    slug: "sam-lee",
    name: "Sam Lee",
    preferred_contact_method: "email",
    email: "sam@example.com",
  });

  const html = renderDirectoryRecommendationsMarkup({
    model: buildDirectoryRecommendationModel({
      featuredTherapist: featured,
      backupTherapists: [backup],
      filters: buildDirectoryTestFilters(),
      shortlist: [],
      isShortlisted: function () {
        return false;
      },
    }),
  });

  assert.match(html, /Strong starting options/);
  assert.match(html, /Backup options/);
  assert.match(html, /Why this may be a good fit/);
  assert.match(html, /data-cta-tier="featured"/);
  assert.match(html, /data-cta-tier="backup"/);
});

test("details render smoke keeps contact therapist visible", function () {
  const therapist = buildDirectoryTestTherapist();
  const html = renderDirectoryDetailsMarkup({
    model: buildDirectoryDetailsViewModel({
      therapist,
      filters: buildDirectoryTestFilters(),
      shortlist: [],
      isShortlisted: function () {
        return false;
      },
    }),
  });

  assert.match(html, /Provider details|View details/);
  assert.match(html, /Contact therapist/);
  assert.match(html, /Why this may be a good fit/);
  assert.match(html, /Availability/);
});
