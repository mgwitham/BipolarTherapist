// Featured-therapist rotation removed 2026-04-18: the product thesis is
// match-over-merchandise, so no profile is ranked or badged as "featured"
// in the directory. The fetchActiveFeaturedSlugs / rotateFeaturedFirst
// plumbing stays dormant elsewhere until a followup cleanup, but the
// call sites in this file are gone.
import { fetchDirectoryPageContent } from "./cms.js";
import {
  readFunnelEvents,
  trackFunnelEvent,
  summarizeAdaptiveSignals,
} from "./funnel-analytics.js";
import {
  FILTER_BOOLEAN_KEYS,
  FILTER_VALUE_KEYS,
  countActiveFilters,
  syncFilterControlsFromState,
} from "./directory-filters.js";
import {
  applyDirectoryFiltersAction,
  buildDirectoryRenderState,
  changeDirectorySortAction,
  resetDirectoryFiltersAction,
} from "./directory-controller.js";
import {
  compareTherapistsWithFilters,
  getMatchScore,
  matchesDirectoryFilters,
} from "./directory-logic.js";

var DIRECTORY_LIST_LIMIT = 50;
import {
  renderDirectoryDecisionPreviewMarkup,
  renderCardMarkup,
  renderEmptyStateMarkup,
  renderPaginationMarkup,
} from "./directory-render.js";
import { buildCardViewModel, buildDirectoryDecisionPreviewModel } from "./directory-view-model.js";
import { initValuePillPopover } from "./therapist-pills.js";

(async function () {
  initValuePillPopover();
  var DIRECTORY_SHORTLIST_KEY = "bth_directory_shortlist_v1";
  var content = await fetchDirectoryPageContent();
  var therapists = content.therapists || [];
  var matchPrioritySlugs = Array.isArray(content.siteSettings?.matchPrioritySlugs)
    ? content.siteSettings.matchPrioritySlugs
        .map(function (value) {
          return String(value || "").trim();
        })
        .filter(Boolean)
    : [];
  var directoryPage = content.directoryPage || null;
  var siteSettings = content.siteSettings || null;
  var currentPage = 1;
  var pageSize = 12;
  var activePreviewSlug = "";
  var defaultFilters = {
    state: "CA",
    zip: "",
    specialty: "",
    modality: "",
    population: "",
    bipolar_experience: "",
    insurance: "",
    therapist: false,
    psychiatrist: false,
    telehealth: false,
    in_person: false,
    accepting: false,
    medication_management: false,
    responsive_contact: false,
    recently_confirmed: false,
    sortBy: "best_match",
  };
  var filters = { ...defaultFilters };
  var shortlist = readShortlist();
  var pendingMotionSlug = "";
  var liveFilterTimer = 0;
  var resizeTimer = 0;
  var filteredResultsCacheKey = "";
  var filteredResultsCache = [];
  var optionIndexes = buildOptionIndexes();
  var VALID_SORT_OPTIONS = new Set([
    "best_match",
    "most_experienced",
    "soonest_availability",
    "lowest_fee",
    "most_responsive",
  ]);

  function getElement(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildFilterCacheKey(filterState) {
    return FILTER_VALUE_KEYS.concat(FILTER_BOOLEAN_KEYS)
      .map(function (key) {
        return key + ":" + String(filterState[key] || "");
      })
      .join("|");
  }

  function applyDirectoryPriorityProminence(list, filterState) {
    var prioritySet = new Set(matchPrioritySlugs);
    var activeFilterCount = countActiveFilters(filterState || {});

    return (Array.isArray(list) ? list.slice() : []).sort(function (a, b) {
      var aPriority = prioritySet.has(a && a.slug ? a.slug : "");
      var bPriority = prioritySet.has(b && b.slug ? b.slug : "");
      var aBase = getMatchScore(filterState, a);
      var bBase = getMatchScore(filterState, b);
      var scoreDiff = Math.abs(bBase - aBase);
      var canUseBoost =
        activeFilterCount <= 1 &&
        (!filterState.sortBy || filterState.sortBy === "best_match") &&
        scoreDiff <= 12;

      if (canUseBoost && aPriority !== bPriority) {
        return Number(bPriority) - Number(aPriority);
      }

      return compareTherapistsWithFilters(filterState, a, b);
    });
  }

  function incrementCount(map, key) {
    if (!key) {
      return;
    }

    map.set(key, (map.get(key) || 0) + 1);
  }

  function buildOptionIndexes() {
    var indexes = {
      state: new Map(),
      specialty: new Map(),
      insurance: new Map(),
      modality: new Map(),
      population: new Map(),
    };

    therapists.forEach(function (therapist) {
      incrementCount(indexes.state, therapist.state);
      (therapist.specialties || []).forEach(function (value) {
        incrementCount(indexes.specialty, value);
      });
      (therapist.insurance_accepted || []).forEach(function (value) {
        incrementCount(indexes.insurance, value);
      });
      (therapist.treatment_modalities || []).forEach(function (value) {
        incrementCount(indexes.modality, value);
      });
      (therapist.client_populations || []).forEach(function (value) {
        incrementCount(indexes.population, value);
      });
    });

    return indexes;
  }

  function readShortlist() {
    try {
      return normalizeShortlist(
        JSON.parse(window.localStorage.getItem(DIRECTORY_SHORTLIST_KEY) || "[]"),
      );
    } catch (_error) {
      return [];
    }
  }

  function normalizeShortlist(value) {
    return (Array.isArray(value) ? value : [])
      .map(function (item) {
        if (typeof item === "string") {
          return {
            slug: item,
            priority: "",
            note: "",
          };
        }
        if (!item || !item.slug) {
          return null;
        }
        return {
          slug: String(item.slug),
          priority: String(item.priority || ""),
          note: String(item.note || ""),
        };
      })
      .filter(Boolean)
      .slice(0, DIRECTORY_LIST_LIMIT);
  }

  function writeShortlist(value) {
    shortlist = normalizeShortlist(value);
    try {
      window.localStorage.setItem(DIRECTORY_SHORTLIST_KEY, JSON.stringify(shortlist));
    } catch (_error) {
      return;
    }
    if (typeof window.refreshShortlistNav === "function") {
      window.refreshShortlistNav();
    }
  }

  function isShortlisted(slug) {
    return shortlist.some(function (item) {
      return item.slug === slug;
    });
  }

  function toggleShortlist(slug) {
    if (isShortlisted(slug)) {
      trackFunnelEvent("directory_shortlist_removed", {
        therapist_slug: slug,
      });
      writeShortlist(
        shortlist.filter(function (item) {
          return item.slug !== slug;
        }),
      );
      return false;
    }

    trackFunnelEvent("directory_shortlist_saved", {
      therapist_slug: slug,
      shortlist_size_before: shortlist.length,
    });
    writeShortlist(
      shortlist.concat({ slug: slug, priority: "", note: "" }).slice(0, DIRECTORY_LIST_LIMIT),
    );
    return true;
  }

  function updateShortlistNote(slug, note) {
    writeShortlist(
      shortlist.map(function (item) {
        if (item.slug !== slug) {
          return item;
        }

        return {
          slug: item.slug,
          priority: item.priority || "",
          note: String(note || "")
            .trim()
            .slice(0, 120),
        };
      }),
    );
  }

  function applyDirectoryCopy() {
    if (!directoryPage) {
      return;
    }

    var mappings = [
      ["directoryHeroTitle", "heroTitle"],
      ["directoryHeroDescription", "heroDescription"],
      ["locationPanelTitle", "locationPanelTitle"],
      ["stateLabelText", "stateLabel"],
      ["specialtyPanelTitle", "specialtyPanelTitle"],
      ["specialtyLabelText", "specialtyLabel"],
      ["insurancePanelTitle", "insurancePanelTitle"],
      ["insuranceLabelText", "insuranceLabel"],
      ["telehealthLabelText", "telehealthLabel"],
      ["inPersonLabelText", "inPersonLabel"],
      ["acceptingLabelText", "acceptingLabel"],
      ["applyFiltersButton", "applyButtonLabel"],
      ["resetFiltersButton", "resetButtonLabel"],
    ];

    mappings.forEach(function (entry) {
      var element = getElement(entry[0]);
      var value = directoryPage[entry[1]];
      if (element && value) {
        element.textContent = value;
      }
    });

    var zipInput = getElement("zip");
    var zipLabel = getElement("cityLabelText");
    if (zipLabel) {
      zipLabel.textContent = directoryPage.zipLabel || "Zip code";
    }
    if (zipInput) {
      zipInput.placeholder = directoryPage.zipPlaceholder || "e.g. 90024";
    }

    var stateSelect = getElement("state");
    var specialtySelect = getElement("specialty");
    var insuranceSelect = getElement("insurance");

    if (stateSelect && directoryPage.stateAllLabel) {
      stateSelect.querySelector("option").textContent = directoryPage.stateAllLabel;
    }
    if (specialtySelect && directoryPage.specialtyAllLabel) {
      specialtySelect.querySelector("option").textContent = directoryPage.specialtyAllLabel;
    }
    if (insuranceSelect && directoryPage.insuranceAllLabel) {
      insuranceSelect.querySelector("option").textContent = directoryPage.insuranceAllLabel;
    }
  }

  function applySiteSettings() {
    if (!siteSettings) {
      return;
    }

    var navBrowseLink = getElement("navBrowseLink");
    var navCtaLink = getElement("navCtaLink");
    var footerTagline = getElement("footerTagline");

    if (navBrowseLink && siteSettings.browseLabel) {
      navBrowseLink.textContent = siteSettings.browseLabel;
    }

    if (navCtaLink) {
      if (siteSettings.therapistCtaLabel) {
        navCtaLink.textContent = siteSettings.therapistCtaLabel;
      }
      if (siteSettings.therapistCtaUrl) {
        navCtaLink.href = siteSettings.therapistCtaUrl;
      }
    }

    if (footerTagline && siteSettings.footerTagline) {
      footerTagline.textContent = siteSettings.footerTagline;
    }
  }

  function summarizeActiveFilters() {
    var chips = [];
    if (filters.state) {
      chips.push({ key: "state", label: filters.state });
    }
    if (filters.zip) {
      chips.push({ key: "zip", label: filters.zip });
    }
    if (filters.specialty) {
      chips.push({ key: "specialty", label: filters.specialty });
    }
    if (filters.modality) {
      chips.push({ key: "modality", label: filters.modality });
    }
    if (filters.population) {
      chips.push({ key: "population", label: filters.population });
    }
    if (filters.bipolar_experience) {
      chips.push({
        key: "bipolar_experience",
        label: filters.bipolar_experience + "+ yrs bipolar care",
      });
    }
    if (filters.insurance) {
      chips.push({ key: "insurance", label: filters.insurance });
    }
    if (filters.therapist) {
      chips.push({ key: "therapist", label: "Therapist" });
    }
    if (filters.psychiatrist) {
      chips.push({ key: "psychiatrist", label: "Psychiatrist" });
    }
    if (filters.telehealth) {
      chips.push({ key: "telehealth", label: "Telehealth" });
    }
    if (filters.in_person) {
      chips.push({ key: "in_person", label: "In-person" });
    }
    if (filters.accepting) {
      chips.push({ key: "accepting", label: "Accepting patients" });
    }
    if (filters.medication_management) {
      chips.push({ key: "medication_management", label: "Medication management" });
    }
    if (filters.responsive_contact) {
      chips.push({ key: "responsive_contact", label: "Responsive contact" });
    }
    if (filters.recently_confirmed) {
      chips.push({ key: "recently_confirmed", label: "Recently confirmed" });
    }
    return chips;
  }

  function removeActiveFilter(filterKey) {
    if (!filterKey || !(filterKey in filters)) {
      return;
    }
    filters = Object.assign({}, filters, {
      [filterKey]: typeof defaultFilters[filterKey] === "boolean" ? false : "",
    });
    currentPage = 1;
    syncFilterControlsFromState(filters, getElement);
    render();
  }

  function renderActiveFilterSummary(resultsLength) {
    var summary = getElement("activeFilterSummary");
    var chipsRoot = getElement("activeFilterChips");
    var clearButton = getElement("focusClearFiltersButton");
    if (!summary || !chipsRoot) {
      return;
    }

    var active = summarizeActiveFilters();
    if (!active.length) {
      summary.textContent = "No filters yet. Add one or two to narrow the list.";
      chipsRoot.innerHTML = "";
      if (clearButton) {
        clearButton.hidden = true;
      }
      return;
    }

    summary.innerHTML =
      "<strong>" +
      escapeHtml(resultsLength) +
      "</strong> option" +
      (resultsLength === 1 ? "" : "s") +
      ' <span aria-hidden="true">•</span> <strong>' +
      escapeHtml(active.length) +
      "</strong> filter" +
      (active.length === 1 ? "" : "s") +
      " applied";
    chipsRoot.innerHTML = active
      .map(function (item) {
        return (
          '<button type="button" class="filter-chip filter-chip-removable" data-remove-filter="' +
          escapeHtml(item.key) +
          '" aria-label="Remove ' +
          escapeHtml(item.label) +
          ' filter" title="Click to remove this filter">' +
          '<span class="filter-chip-text">' +
          escapeHtml(item.label) +
          '</span><span class="filter-chip-dismiss" aria-hidden="true">×</span></button>'
        );
      })
      .join("");
    if (clearButton) {
      clearButton.hidden = false;
    }
  }

  function renderJourneySummary(resultsLength, activeFilterCount) {
    var summary = getElement("directoryJourneySummary");
    if (!summary) {
      return;
    }

    if (!activeFilterCount) {
      summary.textContent =
        "Start with location, specialty, insurance, or telehealth. Then compare the strongest options here.";
      return;
    }

    if (!resultsLength) {
      summary.textContent =
        "These filters are too narrow right now. Remove one or two filters, then review the refreshed results here.";
      return;
    }

    if (resultsLength <= 12) {
      summary.textContent =
        "This list is manageable now. Compare the cards below and save the therapists you may actually contact.";
      return;
    }

    summary.textContent =
      "You still have plenty of options. Add another filter or update the sort to bring the best fits forward.";
  }

  function updateSparseMatchNudge(resultsLength, activeFilterCount) {
    var nudge = getElement("directorySparseNudge");
    if (!nudge) {
      return;
    }
    var shouldShow = activeFilterCount >= 1 && resultsLength <= 3;
    if (shouldShow) {
      if (nudge.hidden) {
        trackFunnelEvent("directory_sparse_nudge_shown", {
          results_length: resultsLength,
          active_filter_count: activeFilterCount,
        });
      }
      nudge.hidden = false;
    } else {
      nudge.hidden = true;
    }
  }

  function uniqueCounts(field, nested) {
    var counts =
      field === "treatment_modalities"
        ? optionIndexes.modality
        : field === "client_populations"
          ? optionIndexes.population
          : new Map();

    return Array.from(counts.entries())
      .sort(function (a, b) {
        return String(a[0]).localeCompare(String(b[0]));
      })
      .map(function (entry) {
        return { value: entry[0], count: entry[1] };
      });
  }

  function getConfiguredItems(field, nested) {
    var sourceMap =
      field === "curatedStates"
        ? optionIndexes.state
        : field === "curatedSpecialties"
          ? optionIndexes.specialty
          : optionIndexes.insurance;
    var configured =
      directoryPage && Array.isArray(directoryPage[field]) ? directoryPage[field] : [];
    if (!configured.length) {
      return uniqueCounts(
        field === "curatedStates"
          ? "state"
          : field === "curatedSpecialties"
            ? "specialties"
            : "insurance_accepted",
        nested,
      );
    }

    return configured.filter(Boolean).map(function (value) {
      return {
        value: value,
        count: sourceMap.get(value) || 0,
      };
    });
  }

  function populateSelect(id, items) {
    var select = getElement(id);
    items.forEach(function (item) {
      var option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.value + (item.count ? " (" + item.count + ")" : "");
      select.appendChild(option);
    });
  }

  function initializeFilters() {
    populateSelect("state", getConfiguredItems("curatedStates", false));
    populateSelect("specialty", getConfiguredItems("curatedSpecialties", true));
    populateSelect("insurance", getConfiguredItems("curatedInsurance", true));
    populateSelect("modality", uniqueCounts("treatment_modalities", true));
    populateSelect("population", uniqueCounts("client_populations", true));

    var params = new URLSearchParams(window.location.search);
    FILTER_VALUE_KEYS.forEach(function (key) {
      if (params.get(key)) {
        filters[key] =
          key === "sortBy" && !VALID_SORT_OPTIONS.has(params.get(key))
            ? defaultFilters.sortBy
            : params.get(key);
        var input = getElement(key);
        if (input) {
          input.value = filters[key];
        }
      }
    });

    FILTER_BOOLEAN_KEYS.forEach(function (key) {
      if (params.get(key) === "true") {
        filters[key] = true;
        getElement(key).checked = true;
      }
    });

    if (!params.get("sortBy")) {
      var adaptiveSignals = summarizeAdaptiveSignals(readFunnelEvents());
      filters.sortBy = VALID_SORT_OPTIONS.has(adaptiveSignals.preferred_directory_sort)
        ? adaptiveSignals.preferred_directory_sort
        : defaultFilters.sortBy;
      getElement("sortBy").value = filters.sortBy;
    }
  }

  function updateUrl() {
    var params = new URLSearchParams();
    Object.keys(filters).forEach(function (key) {
      if (!filters[key]) {
        return;
      }
      if (key === "sortBy" && filters[key] === defaultFilters.sortBy) {
        return;
      }
      params.set(key, String(filters[key]));
    });
    var query = params.toString();
    var next = query ? "directory.html?" + query : "directory.html";
    window.history.replaceState({}, "", next);
  }
  function getFilteredWithFilters(filterState) {
    var cacheKey = buildFilterCacheKey(filterState);
    if (cacheKey === filteredResultsCacheKey) {
      return filteredResultsCache;
    }

    filteredResultsCache = applyDirectoryPriorityProminence(
      therapists.filter(function (therapist) {
        return matchesDirectoryFilters(filterState, therapist);
      }),
      filterState,
    );
    filteredResultsCacheKey = cacheKey;
    return filteredResultsCache;
  }

  function getFiltered() {
    return getFilteredWithFilters(filters);
  }

  function renderDirectoryTradeoffPreview(results) {
    var root = getElement("directoryTradeoffPreview");
    if (!root) {
      return;
    }

    var list = Array.isArray(results) ? results : [];
    var previewTherapist =
      list.find(function (item) {
        return item.slug === activePreviewSlug;
      }) ||
      list[0] ||
      null;
    var previewMarkup = previewTherapist
      ? renderDirectoryDecisionPreviewMarkup({
          model: buildDirectoryDecisionPreviewModel({
            therapist: previewTherapist,
            filters: filters,
            shortlist: shortlist,
            isShortlisted: isShortlisted,
          }),
        })
      : "";

    root.classList.toggle("is-empty", !previewMarkup);
    root.innerHTML = previewMarkup;
  }

  function renderCard(therapist) {
    return renderCardMarkup({
      model: buildCardViewModel({
        therapist: therapist,
        filters: filters,
        shortlist: shortlist,
        isShortlisted: isShortlisted,
        isFeatured: false,
      }),
    });
  }

  function renderResultsGrid(pageItems) {
    var grid = getElement("resultsGrid");
    if (!grid) {
      return;
    }

    if (!pageItems.length) {
      grid.innerHTML = renderEmptyStateMarkup(directoryPage);
      return;
    }

    grid.innerHTML = pageItems.map(renderCard).join("");
  }

  function pulsePendingCard() {
    var grid = getElement("resultsGrid");
    if (!grid || !pendingMotionSlug) {
      return;
    }

    var activeCard = grid.querySelector('[data-card-slug="' + pendingMotionSlug + '"]');
    if (activeCard) {
      activeCard.classList.remove("motion-pulse");
      void activeCard.offsetWidth;
      activeCard.classList.add("motion-pulse");
    }
    pendingMotionSlug = "";
  }

  function renderPagination(total) {
    var pages = Math.ceil(total / pageSize);
    var root = getElement("pagination");
    root.innerHTML = renderPaginationMarkup(currentPage, pages);
  }

  function renderCurrentPageOnly(results) {
    var renderState = buildDirectoryRenderState({
      results: results,
      currentPage: currentPage,
      pageSize: pageSize,
      filters: filters,
      directoryPage: directoryPage,
      activePreviewSlug: activePreviewSlug,
    });

    renderResultsGrid(renderState.pageItems);
    renderPagination(renderState.results.length);
    pulsePendingCard();
  }

  function render() {
    var renderState = buildDirectoryRenderState({
      results: getFiltered(),
      currentPage: currentPage,
      pageSize: pageSize,
      filters: filters,
      directoryPage: directoryPage,
      activePreviewSlug: activePreviewSlug,
    });
    var results = renderState.results;
    var pageItems = renderState.pageItems;
    var grid = getElement("resultsGrid");
    var count = getElement("resultsCount");
    var filterCount = getElement("filterCount");
    var resultsSuffix = renderState.resultsSuffix;
    var singularSuffix = renderState.singularSuffix;
    var activeFilterCount = renderState.activeFilterCount;

    count.innerHTML =
      "<strong>" +
      results.length +
      "</strong> " +
      (results.length === 1 ? singularSuffix : resultsSuffix);
    filterCount.textContent = activeFilterCount ? "(" + activeFilterCount + ")" : "";
    renderActiveFilterSummary(results.length);
    renderJourneySummary(results.length, activeFilterCount);
    updateSparseMatchNudge(results.length, activeFilterCount);

    if (!pageItems.length) {
      renderResultsGrid([]);
      renderDirectoryTradeoffPreview([]);
      renderPagination(0);
      updateUrl();
      return;
    }

    activePreviewSlug = renderState.activePreviewSlug;
    renderDirectoryTradeoffPreview(results);
    renderResultsGrid(pageItems);
    pulsePendingCard();
    renderPagination(results.length);
    updateUrl();
  }

  function refreshShortlistViews() {
    var results = getFiltered();
    renderDirectoryTradeoffPreview(results);
    renderCurrentPageOnly(results);
  }

  function applyFilters() {
    var nextState = applyDirectoryFiltersAction({
      filters: filters,
      getElement: getElement,
    });
    filters = nextState.filters;
    currentPage = nextState.currentPage;
    trackFunnelEvent("directory_filters_applied", {
      active_filter_count: countActiveFilters(filters),
      sort_by: filters.sortBy,
    });
    render();
  }

  function applyFiltersLive() {
    var nextState = applyDirectoryFiltersAction({
      filters: filters,
      getElement: getElement,
    });
    filters = nextState.filters;
    currentPage = nextState.currentPage;
    render();
  }

  function scheduleLiveFilters() {
    window.clearTimeout(liveFilterTimer);
    liveFilterTimer = window.setTimeout(function () {
      applyFiltersLive();
    }, 120);
  }

  function resetFilters() {
    var nextState = resetDirectoryFiltersAction(defaultFilters);
    filters = nextState.filters;
    currentPage = nextState.currentPage;
    syncFilterControlsFromState(filters, getElement);
    render();
  }

  function updateFilterToggleState() {
    var sidebar = getElement("sidebar");
    var toggle = getElement("mobileFilterToggle");
    if (!sidebar || !toggle) {
      return;
    }

    toggle.setAttribute("aria-expanded", String(!sidebar.classList.contains("hidden-mobile")));
  }

  function toggleFilters() {
    var sidebar = getElement("sidebar");
    if (!sidebar) {
      return;
    }

    sidebar.classList.toggle("hidden-mobile");
    updateFilterToggleState();
  }

  function syncSidebarForViewport() {
    var sidebar = getElement("sidebar");
    if (!sidebar) {
      return;
    }

    if (window.innerWidth <= 860) {
      sidebar.classList.add("hidden-mobile");
    } else {
      sidebar.classList.remove("hidden-mobile");
    }

    updateFilterToggleState();
  }

  function scheduleViewportSync() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(syncSidebarForViewport, 80);
  }

  function handleResultsGridClick(event) {
    var shortlistButton = event.target.closest("[data-shortlist-slug]");
    if (shortlistButton) {
      var shortlistSlug = shortlistButton.getAttribute("data-shortlist-slug");
      if (!shortlistSlug) {
        return;
      }
      pendingMotionSlug = shortlistSlug;
      toggleShortlist(shortlistSlug);
      refreshShortlistViews();
      return;
    }

    var primaryLink = event.target.closest("[data-primary-cta]");
    if (primaryLink) {
      trackFunnelEvent("directory_primary_cta_clicked", {
        therapist_slug: primaryLink.getAttribute("data-primary-cta"),
        sort_by: filters.sortBy,
      });
      return;
    }

    var reviewLink = event.target.closest("[data-review-fit]");
    if (reviewLink) {
      trackFunnelEvent("directory_profile_review_clicked", {
        therapist_slug: reviewLink.getAttribute("data-review-fit"),
        sort_by: filters.sortBy,
      });
    }
  }

  function handleResultsGridChange(event) {
    var noteInput = event.target.closest("[data-shortlist-note]");
    if (!noteInput) {
      return;
    }

    updateShortlistNote(noteInput.getAttribute("data-shortlist-note"), noteInput.value);
  }

  function handlePaginationClick(event) {
    var pageButton = event.target.closest("[data-page]");
    if (!pageButton) {
      return;
    }

    currentPage = Number(pageButton.getAttribute("data-page"));
    renderCurrentPageOnly(getFiltered());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleFocusBarClick(event) {
    var removeButton = event.target.closest("[data-remove-filter]");
    if (!removeButton) {
      return;
    }

    removeActiveFilter(removeButton.getAttribute("data-remove-filter"));
  }

  function handlePreviewClick(event) {
    var shortlistButton = event.target.closest("[data-preview-shortlist]");
    if (shortlistButton) {
      var previewSlug = shortlistButton.getAttribute("data-preview-shortlist");
      if (!previewSlug) {
        return;
      }
      pendingMotionSlug = previewSlug;
      toggleShortlist(previewSlug);
      refreshShortlistViews();
      return;
    }

    var openLink = event.target.closest("[data-preview-open-profile]");
    if (openLink) {
      trackFunnelEvent("directory_preview_profile_opened", {
        therapist_slug: openLink.getAttribute("data-preview-open-profile"),
        sort_by: filters.sortBy,
      });
    }
  }

  window.applyFilters = applyFilters;
  window.resetFilters = resetFilters;
  window.toggleFilters = toggleFilters;

  var applyFiltersButton = getElement("applyFiltersButton");
  if (applyFiltersButton) {
    applyFiltersButton.addEventListener("click", applyFilters);
  }

  var resetFiltersButton = getElement("resetFiltersButton");
  if (resetFiltersButton) {
    resetFiltersButton.addEventListener("click", resetFilters);
  }
  var focusClearFiltersButton = getElement("focusClearFiltersButton");
  if (focusClearFiltersButton) {
    focusClearFiltersButton.addEventListener("click", resetFilters);
  }

  var activeFilterChips = getElement("activeFilterChips");
  if (activeFilterChips) {
    activeFilterChips.addEventListener("click", handleFocusBarClick);
  }

  var resultsGrid = getElement("resultsGrid");
  if (resultsGrid) {
    resultsGrid.addEventListener("click", handleResultsGridClick);
    resultsGrid.addEventListener("change", handleResultsGridChange);
  }

  var pagination = getElement("pagination");
  if (pagination) {
    pagination.addEventListener("click", handlePaginationClick);
  }

  var tradeoffPreview = getElement("directoryTradeoffPreview");
  if (tradeoffPreview) {
    tradeoffPreview.addEventListener("click", handlePreviewClick);
  }

  FILTER_VALUE_KEYS.filter(function (key) {
    return key !== "sortBy";
  }).forEach(function (key) {
    var input = getElement(key);
    if (!input) {
      return;
    }

    if (input.tagName === "INPUT") {
      input.addEventListener("input", scheduleLiveFilters);
      return;
    }

    input.addEventListener("change", applyFiltersLive);
  });

  FILTER_BOOLEAN_KEYS.forEach(function (key) {
    var input = getElement(key);
    if (!input) {
      return;
    }

    input.addEventListener("change", applyFiltersLive);
  });

  var mobileFilterToggle = getElement("mobileFilterToggle");
  if (mobileFilterToggle) {
    mobileFilterToggle.addEventListener("click", toggleFilters);
  }

  var sparseNudge = getElement("directorySparseNudge");
  if (sparseNudge) {
    sparseNudge.addEventListener("click", function () {
      trackFunnelEvent("directory_sparse_nudge_click", {
        active_filter_count: countActiveFilters(filters),
      });
    });
  }

  getElement("sortBy").addEventListener("change", function () {
    var nextState = changeDirectorySortAction({
      filters: filters,
      sortBy: getElement("sortBy").value,
    });
    filters = nextState.filters;
    currentPage = nextState.currentPage;
    trackFunnelEvent("directory_sort_changed", {
      sort_by: filters.sortBy,
    });
    render();
  });

  window.addEventListener("resize", scheduleViewportSync);

  document.addEventListener("keydown", function (event) {
    if (
      event.key === "Enter" &&
      (event.target.tagName === "INPUT" || event.target.tagName === "SELECT")
    ) {
      applyFilters();
    }
  });

  applySiteSettings();
  applyDirectoryCopy();
  initializeFilters();
  syncSidebarForViewport();
  render();
})();
