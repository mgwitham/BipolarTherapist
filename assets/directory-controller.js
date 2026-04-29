import { countActiveFilters, readFilterStateFromControls } from "./directory-filters.js";

export function buildDirectoryRenderState(options) {
  var results = options.results || [];
  var visibleCount = options.visibleCount || 24;
  var filters = options.filters || {};
  var directoryPage = options.directoryPage || null;
  var pageItems = results.slice(0, visibleCount);
  var resultsSuffix = (directoryPage && directoryPage.resultsSuffix) || "specialists found";

  return {
    results: results,
    featuredTherapist: null,
    backupTherapists: [],
    browseResults: results,
    pageItems: pageItems,
    hasMore: results.length > visibleCount,
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
