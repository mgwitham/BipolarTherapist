import { countActiveFilters, readFilterStateFromControls } from "./directory-filters.js";

export function buildDirectoryRenderState(options) {
  var results = options.results || [];
  var currentPage = options.currentPage || 1;
  var pageSize = options.pageSize || 12;
  var filters = options.filters || {};
  var directoryPage = options.directoryPage || null;
  var activePreviewSlug = options.activePreviewSlug || "";
  var featuredTherapist = results[0] || null;
  var backupTherapists = results.slice(1, 3);
  var browseResults = results.slice(featuredTherapist ? 3 : 0);
  var start = (currentPage - 1) * pageSize;
  var pageItems = browseResults.slice(start, start + pageSize);
  var resultsSuffix = (directoryPage && directoryPage.resultsSuffix) || "specialists found";

  return {
    results: results,
    featuredTherapist: featuredTherapist,
    backupTherapists: backupTherapists,
    browseResults: browseResults,
    pageItems: pageItems,
    resultsSuffix: resultsSuffix,
    singularSuffix: resultsSuffix === "specialists found" ? "specialist found" : resultsSuffix,
    activeFilterCount: countActiveFilters(filters),
    activePreviewSlug:
      results.some(function (item) {
        return item.slug === activePreviewSlug;
      }) && activePreviewSlug
        ? activePreviewSlug
        : featuredTherapist
          ? featuredTherapist.slug
          : "",
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
