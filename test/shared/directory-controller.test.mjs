import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDirectoryFiltersAction,
  buildDirectoryRenderState,
  changeDirectorySortAction,
  resetDirectoryFiltersAction,
} from "../../assets/directory-controller.js";

test("buildDirectoryRenderState derives page items and preview slug", function () {
  const state = buildDirectoryRenderState({
    results: [{ slug: "a" }, { slug: "b" }, { slug: "c" }],
    currentPage: 1,
    pageSize: 2,
    filters: {
      q: "",
      state: "CA",
      city: "",
      specialty: "",
      modality: "",
      population: "",
      verification: "",
      bipolar_experience: "",
      insurance: "",
      telehealth: true,
      in_person: false,
      accepting: false,
      medication_management: false,
      responsive_contact: false,
      recently_confirmed: false,
      sortBy: "best_match",
    },
    directoryPage: {
      resultsSuffix: "matches found",
    },
    activePreviewSlug: "missing",
  });

  assert.equal(state.pageItems.length, 2);
  assert.equal(state.pageItems[0].slug, "a");
  assert.equal(state.activePreviewSlug, "a");
  assert.equal(state.resultsSuffix, "matches found");
  assert.equal(state.singularSuffix, "matches found");
  assert.equal(state.activeFilterCount, 2);
});

test("applyDirectoryFiltersAction reads controls and resets paging", function () {
  const controls = {
    q: { value: " bipolar " },
    state: { value: "CA" },
    city: { value: "" },
    specialty: { value: "" },
    modality: { value: "" },
    population: { value: "" },
    verification: { value: "" },
    bipolar_experience: { value: "" },
    insurance: { value: "" },
    sortBy: { value: "best_match" },
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
  assert.equal(state.filters.q, "bipolar");
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
