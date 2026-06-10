export const FILTER_VALUE_KEYS = [
  "state",
  "zip",
  "specialty",
  "modality",
  "population",
  "bipolar_experience",
  "insurance",
  "gender",
  "session_fee_min",
  "session_fee_max",
  "sortBy",
];

// Multi-select keys hold an array of strings rather than a single value.
// URL serialization uses comma separation so single-value bookmarks
// (?insurance=aetna) keep working. Other keys remain scalar strings.
export const FILTER_MULTI_VALUE_KEYS = ["specialty", "modality", "population", "insurance"];

// Numeric keys are stored as digit strings (empty string = unset).
// Filter logic in directory-logic.js coerces to Number for comparison.
export const FILTER_NUMERIC_VALUE_KEYS = ["session_fee_min", "session_fee_max"];

export const FILTER_BOOLEAN_KEYS = [
  "therapist",
  "psychiatrist",
  "telehealth",
  "in_person",
  "accepting",
  "sliding_scale",
  "medication_management",
  "responsive_contact",
  // recently_confirmed retired 2026-05-18: only 2/150 therapists carry
  // a recent confirmation timestamp, so the filter narrowed to ~2
  // results and trapped users. The filter logic remains in
  // directory-logic.js as a no-op when filterState.recently_confirmed
  // is falsy. Re-add this entry to restore the filter once more
  // confirmation timestamps are recorded.
];

export const ACTIVE_FILTER_KEYS = FILTER_VALUE_KEYS.filter(function (key) {
  return key !== "sortBy";
}).concat(FILTER_BOOLEAN_KEYS);

function isMultiKey(key) {
  return FILTER_MULTI_VALUE_KEYS.indexOf(key) !== -1;
}

// Normalize a stored filter value into a string array. Accepts
// arrays as-is, single comma-separated strings, plain strings, or
// empty/nullish (returns []).
export function toFilterArray(value) {
  if (Array.isArray(value)) {
    return value
      .map(function (v) {
        return String(v || "").trim();
      })
      .filter(Boolean);
  }
  if (value === null || value === undefined) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map(function (v) {
      return v.trim();
    })
    .filter(Boolean);
}

function isFilterValueActive(key, value) {
  if (isMultiKey(key)) {
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  }
  return Boolean(value);
}

export function countActiveFilters(filterState) {
  return ACTIVE_FILTER_KEYS.filter(function (key) {
    return isFilterValueActive(key, filterState[key]);
  }).length;
}

export function syncFilterControlsFromState(filterState, getElement) {
  FILTER_VALUE_KEYS.forEach(function (key) {
    const input = getElement(key);
    if (!input) return;
    if (isMultiKey(key)) {
      // The legacy modal still uses single-value inputs. Surface the
      // first selected value so single-input UIs (insurance autocomplete,
      // specialty / modality / population selects) keep displaying
      // something coherent. Step 6 swaps these for multi-select chip
      // pickers that read the array directly.
      const arr = toFilterArray(filterState[key]);
      input.value = arr.length ? arr[0] : "";
    } else {
      input.value = filterState[key];
    }
  });

  FILTER_BOOLEAN_KEYS.forEach(function (key) {
    const input = getElement(key);
    if (input) {
      input.checked = Boolean(filterState[key]);
    }
  });
}

export function readFilterStateFromControls(baseFilterState, getElement) {
  const nextFilterState = Object.assign({}, baseFilterState);

  FILTER_VALUE_KEYS.forEach(function (key) {
    const input = getElement(key);
    if (!input) {
      return;
    }
    if (isMultiKey(key)) {
      // The legacy modal writes single values; wrap them so downstream
      // consumers always see an array. If the same key has been seeded
      // from a multi-value URL, preserve the existing array unless the
      // input has overwritten it with a different value.
      const inputValue = input.value.trim();
      const existing = toFilterArray(baseFilterState[key]);
      if (!inputValue) {
        nextFilterState[key] = [];
      } else if (existing.length && existing[0] === inputValue) {
        nextFilterState[key] = existing;
      } else {
        nextFilterState[key] = [inputValue];
      }
    } else {
      nextFilterState[key] = input.value.trim();
    }
  });

  FILTER_BOOLEAN_KEYS.forEach(function (key) {
    const input = getElement(key);
    if (!input) {
      return;
    }
    nextFilterState[key] = input.checked;
  });

  return nextFilterState;
}
