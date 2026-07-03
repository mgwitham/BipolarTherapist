import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { applyDirectoryFiltersAction } from "../../assets/directory-controller.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const directoryHtml = readFileSync(join(root, "directory.html"), "utf8");

// Regression for the drawer chip pickers (specialty / modality / population).
//
// These multi-select filters are chip-managed: the click handler writes the
// selected values straight into the in-memory filters[] array and there is NO
// backing <select> in the DOM. `specialty` worked precisely because it had no
// control, but `modality` and `population` each carried an orphan hidden
// <select> that the chips never synced. On every live re-read
// (applyDirectoryFiltersAction -> readFilterStateFromControls), getElement
// found that empty <select>, saw an empty value, and wiped the user's chip
// selection ~120ms after each click — silently breaking both filters. The fix
// removes the orphan <select>s so all three behave identically.
test("chip-managed multi-filters have no orphan <select> that would clobber the chip selection", function () {
  for (const key of ["specialty", "modality", "population"]) {
    assert.ok(
      !new RegExp(`<select[^>]*\\bid="${key}"`).test(directoryHtml),
      `directory.html must not contain <select id="${key}"> — the chip picker is the source of truth for this filter`,
    );
  }
});

test("applyDirectoryFiltersAction preserves chip-managed multi-filters when they have no control element", function () {
  // Simulates the live re-read after a chip click: specialty/modality/population
  // have no DOM control, so getElement returns undefined for them and their
  // selections must survive untouched.
  const controls = { state: { value: "CA" }, telehealth: { checked: true } };
  const state = applyDirectoryFiltersAction({
    filters: { modality: ["dbt"], population: ["lgbtq"], specialty: ["bipolar_ii"] },
    getElement: (id) => controls[id],
  });
  assert.deepEqual(state.filters.modality, ["dbt"], "modality chip selection must be preserved");
  assert.deepEqual(
    state.filters.population,
    ["lgbtq"],
    "population chip selection must be preserved",
  );
  assert.deepEqual(
    state.filters.specialty,
    ["bipolar_ii"],
    "specialty chip selection must be preserved",
  );
});
