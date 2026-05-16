import { countActiveFilters, readFilterStateFromControls } from "./directory-filters.js";

// Step 8: numbered pagination. Page size is fixed at 12 (2 cols x 6 rows
// per the redesign spec). `currentPage` is 1-indexed. The legacy
// `visibleCount` option still works for callers that haven't migrated,
// when present, it overrides paging and acts as a hard slice cap
// (existing load-more code paths and tests rely on this).
export var DIRECTORY_PAGE_SIZE = 12;

export function buildDirectoryRenderState(options) {
  var results = options.results || [];
  var filters = options.filters || {};
  var directoryPage = options.directoryPage || null;

  var pageItems;
  var totalPages = 1;
  var currentPage = 1;
  if (options.visibleCount && !options.currentPage) {
    // Legacy load-more callers, keep working until they migrate to
    // numbered pagination.
    pageItems = results.slice(0, options.visibleCount);
  } else {
    totalPages = Math.max(1, Math.ceil(results.length / DIRECTORY_PAGE_SIZE));
    currentPage = Math.max(1, Math.min(totalPages, Number(options.currentPage || 1)));
    var start = (currentPage - 1) * DIRECTORY_PAGE_SIZE;
    pageItems = results.slice(start, start + DIRECTORY_PAGE_SIZE);
  }
  var resultsSuffix = (directoryPage && directoryPage.resultsSuffix) || "specialists found";

  return {
    results: results,
    featuredTherapist: null,
    backupTherapists: [],
    browseResults: results,
    pageItems: pageItems,
    currentPage: currentPage,
    totalPages: totalPages,
    pageSize: DIRECTORY_PAGE_SIZE,
    hasMore: options.visibleCount
      ? results.length > options.visibleCount
      : currentPage < totalPages,
    resultsSuffix: resultsSuffix,
    singularSuffix: resultsSuffix === "specialists found" ? "specialist found" : resultsSuffix,
    activeFilterCount: countActiveFilters(filters),
    activePreviewSlug: "",
  };
}

export function applyDirectoryFiltersAction(options) {
  return {
    filters: readFilterStateFromControls(options.filters, options.getElement),
    currentPage: 1,
  };
}

export function resetDirectoryFiltersAction(defaultFilters) {
  return {
    filters: { ...defaultFilters },
    currentPage: 1,
  };
}

export function changeDirectorySortAction(options) {
  return {
    filters: Object.assign({}, options.filters, {
      sortBy: options.sortBy,
    }),
    currentPage: 1,
  };
}
