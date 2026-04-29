import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDirectoryFiltersAction,
  buildDirectoryRenderState,
  changeDirectorySortAction,
  resetDirectoryFiltersAction,
} from "../../assets/directory-controller.js";

test("buildDirectoryRenderState puts all results in pageItems up to visibleCount", function () {
  const results = [{ slug: "a" }, { slug: "b" }, { slug: "c" }, { slug: "d" }, { slug: "e" }];
  const state = buildDirectoryRenderState({
    results,
    visibleCount: 3,
    filters: {
      state: "CA",
      telehealth: true,
      in_person: false,
      accepting: false,
      medication_management: false,
      responsive_contact: false,
      recently_confirmed: false,
      therapist: true,
      psychiatrist: false,
      sortBy: "stable_random",
    },
    directoryPage: { resultsSuffix: "matches found" },
  });

  assert.equal(state.featuredTherapist, null);
  assert.equal(state.backupTherapists.length, 0);
  assert.deepEqual(
    state.browseResults.map((item) => item.slug),
    ["a", "b", "c", "d", "e"],
  );
  assert.equal(state.pageItems.length, 3);
  assert.equal(state.pageItems[0].slug, "a");
  assert.equal(state.hasMore, true);
  assert.equal(state.activePreviewSlug, "");
  assert.equal(state.resultsSuffix, "matches found");
  assert.equal(state.activeFilterCount, 3);
});

test("applyDirectoryFiltersAction reads controls and resets paging", function () {
  const controls = {
    state: { value: "CA" },
    zip: { value: " 90210 " },
    specialty: { value: "" },
    modality: { value: "" },
    population: { value: "" },
    verification: { value: "" },
    bipolar_experience: { value: "" },
    insurance: { value: "" },
    sortBy: { value: "best_match" },
    therapist: { checked: true },
    psychiatrist: { checked: false },
    telehealth: { checked: true },
    in_person: { checked: false },
    accepting: { checked: false },
    medication_management: { checked: false },
    responsive_contact: { checked: true },
    recently_confirmed: { checked: false },
  };

  const state = applyDirectoryFiltersAction({
    filters: {},
    getElement: function (id) {
      return controls[id];
    },
  });

  assert.equal(state.currentPage, 1);
  assert.equal(state.filters.state, "CA");
  assert.equal(state.filters.zip, "90210");
  assert.equal(state.filters.therapist, true);
  assert.equal(state.filters.telehealth, true);
  assert.equal(state.filters.responsive_contact, true);
});

test("resetDirectoryFiltersAction and changeDirectorySortAction return predictable state updates", function () {
  const defaultFilters = {
    q: "",
    state: "CA",
    sortBy: "best_match",
  };

  const resetState = resetDirectoryFiltersAction(defaultFilters);
  assert.deepEqual(resetState, {
    filters: defaultFilters,
    currentPage: 1,
  });

  const sortState = changeDirectorySortAction({
    filters: { ...defaultFilters, q: "jamie" },
    sortBy: "freshest_details",
  });
  assert.equal(sortState.currentPage, 1);
  assert.equal(sortState.filters.q, "jamie");
  assert.equal(sortState.filters.sortBy, "freshest_details");
});
