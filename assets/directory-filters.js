export var FILTER_VALUE_KEYS = [
  "q",
  "state",
  "zip",
  "specialty",
  "modality",
  "population",
  "bipolar_experience",
  "insurance",
  "sortBy",
];

export var FILTER_BOOLEAN_KEYS = [
  "telehealth",
  "in_person",
  "accepting",
  "medication_management",
  "responsive_contact",
  "recently_confirmed",
];

export var ACTIVE_FILTER_KEYS = FILTER_VALUE_KEYS.filter(function (key) {
  return key !== "sortBy";
}).concat(FILTER_BOOLEAN_KEYS);

export function countActiveFilters(filterState) {
  return ACTIVE_FILTER_KEYS.filter(function (key) {
    return Boolean(filterState[key]);
  }).length;
}

export function syncFilterControlsFromState(filterState, getElement) {
  FILTER_VALUE_KEYS.forEach(function (key) {
    var input = getElement(key);
    if (input) {
      input.value = filterState[key];
    }
  });

  FILTER_BOOLEAN_KEYS.forEach(function (key) {
    var input = getElement(key);
    if (input) {
      input.checked = Boolean(filterState[key]);
    }
  });
}

export function readFilterStateFromControls(baseFilterState, getElement) {
  var nextFilterState = Object.assign({}, baseFilterState);

  FILTER_VALUE_KEYS.forEach(function (key) {
    var input = getElement(key);
    if (!input) {
      return;
    }
    nextFilterState[key] = input.value.trim();
  });

  FILTER_BOOLEAN_KEYS.forEach(function (key) {
    var input = getElement(key);
    if (!input) {
      return;
    }
    nextFilterState[key] = input.checked;
  });

  return nextFilterState;
}
