import { countActiveFilters, readFilterStateFromControls } from "./directory-filters.js";

// Step 8: numbered pagination. Page size is fixed at 12 (2 cols x 6 rows
// per the redesign spec). `currentPage` is 1-indexed. The legacy
// `visibleCount` option still works for callers that haven't migrated,
// when present, it overrides paging and acts as a hard slice cap
// (existing load-more code paths and tests rely on this).
export const DIRECTORY_PAGE_SIZE = 12;

export function buildDirectoryRenderState(options) {
  const results = options.results || [];
  const filters = options.filters || {};
  const directoryPage = options.directoryPage || null;

  let pageItems;
  let totalPages = 1;
  let currentPage = 1;
  if (options.visibleCount && !options.currentPage) {
    // Legacy load-more callers, keep working until they migrate to
    // numbered pagination.
    pageItems = results.slice(0, options.visibleCount);
  } else {
    totalPages = Math.max(1, Math.ceil(results.length / DIRECTORY_PAGE_SIZE));
    currentPage = Math.max(1, Math.min(totalPages, Number(options.currentPage || 1)));
    const start = (currentPage - 1) * DIRECTORY_PAGE_SIZE;
    pageItems = results.slice(start, start + DIRECTORY_PAGE_SIZE);
  }
  const resultsSuffix = (directoryPage && directoryPage.resultsSuffix) || "specialists found";

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
