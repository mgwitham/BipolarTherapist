import {
  applyDirectoryFiltersAction,
  buildDirectoryRenderState,
  changeDirectorySortAction,
} from "../../assets/directory-controller.js";
import {
  compareTherapistsWithFilters,
  matchesDirectoryFilters,
} from "../../assets/directory-logic.js";
import { buildCardViewModel } from "../../assets/directory-view-model.js";
import { renderCardMarkup } from "../../assets/directory-render.js";

export function buildDirectoryTestTherapist(overrides) {
  return {
    slug: "jamie-rivera",
    name: "Jamie Rivera",
    city: "Los Angeles",
    state: "CA",
    credentials: "LMFT",
    title: "Therapist",
    specialties: ["Bipolar II", "Anxiety"],
    treatment_modalities: ["CBT"],
    client_populations: ["Adults"],
    insurance_accepted: ["Aetna"],
    accepts_telehealth: true,
    accepts_in_person: false,
    accepting_new_patients: true,
    medication_management: false,
    bipolar_years_experience: 8,
    estimated_wait_time: "Within 2 weeks",
    session_fee_min: 160,
    bio_preview: "Collaborative bipolar-focused therapy.",
    verification_status: "editorially_verified",
    field_review_states: {
      estimated_wait_time: "editorially_verified",
      insurance_accepted: "editorially_verified",
      telehealth_states: "unknown",
      bipolar_years_experience: "editorially_verified",
    },
    therapist_reported_fields: ["estimated_wait_time"],
    therapist_reported_confirmed_at: new Date().toISOString(),
    preferred_contact_method: "booking",
    preferred_contact_label: "Book intro",
    booking_url: "https://example.com/book",
    ...overrides,
  };
}

export function buildDirectoryTestFilters(overrides) {
  return {
    specialty: "Bipolar II",
    modality: "",
    population: "",
    insurance: "Aetna",
    telehealth: true,
    in_person: false,
    accepting: true,
    medication_management: false,
    responsive_contact: false,
    ...overrides,
  };
}

export function buildDirectoryTestControls(overrides) {
  return {
    state: { value: "CA" },
    zip: { value: "" },
    specialty: { value: "Bipolar II" },
    modality: { value: "" },
    population: { value: "" },
    verification: { value: "" },
    bipolar_experience: { value: "" },
    insurance: { value: "Aetna" },
    sortBy: { value: "best_match" },
    therapist: { checked: true },
    psychiatrist: { checked: false },
    telehealth: { checked: true },
    in_person: { checked: false },
    accepting: { checked: true },
    medication_management: { checked: false },
    responsive_contact: { checked: false },
    recently_confirmed: { checked: false },
    ...overrides,
  };
}

export function renderDirectoryTestCard(options) {
  var therapist = options.therapist;
  var filters = options.filters || buildDirectoryTestFilters();
  var shortlist = options.shortlist || [];
  return renderCardMarkup({
    model: buildCardViewModel({
      therapist: therapist,
      filters: filters,
      shortlist: shortlist,
      isShortlisted: function (slug) {
        return shortlist.some(function (item) {
          return item.slug === slug;
        });
      },
    }),
  });
}

export function runDirectoryTestFlow(options) {
  var therapists = options.therapists;
  var controls = options.controls || buildDirectoryTestControls();
  var applied = applyDirectoryFiltersAction({
    filters: {},
    getElement: function (id) {
      return controls[id];
    },
  });

  var filtered = therapists.filter(function (therapist) {
    return matchesDirectoryFilters(applied.filters, therapist);
  });

  var sorted = filtered.slice().sort(function (a, b) {
    return compareTherapistsWithFilters(applied.filters, a, b);
  });

  var sortChanged = changeDirectorySortAction({
    filters: applied.filters,
    sortBy: controls.sortBy.value,
  });

  var renderState = buildDirectoryRenderState({
    results: sorted,
    visibleCount: 24,
    filters: sortChanged.filters,
    directoryPage: { resultsSuffix: "specialists found" },
  });

  var html = renderState.pageItems[0]
    ? renderCardMarkup({
        model: buildCardViewModel({
          therapist: renderState.pageItems[0],
          filters: sortChanged.filters,
          shortlist: [],
          isShortlisted: function () {
            return false;
          },
        }),
      })
    : "";

  return {
    applied: applied,
    sortChanged: sortChanged,
    renderState: renderState,
    html: html,
  };
}
