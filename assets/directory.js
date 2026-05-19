import "./sentry-init.js";
import "./site-analytics.js";
import { fetchDirectoryPageContent } from "./cms.js";
import { escapeHtml } from "./escape-html.js";
import { rememberTherapistContactRoute, trackFunnelEvent } from "./funnel-analytics.js";
import {
  FILTER_BOOLEAN_KEYS,
  FILTER_VALUE_KEYS,
  FILTER_MULTI_VALUE_KEYS,
  countActiveFilters,
  syncFilterControlsFromState,
  toFilterArray,
} from "./directory-filters.js";
import {
  applyDirectoryFiltersAction,
  buildDirectoryRenderState,
  changeDirectorySortAction,
  resetDirectoryFiltersAction,
} from "./directory-controller.js";
import { compareTherapistsWithFilters, matchesDirectoryFilters } from "./directory-logic.js";
import {
  readList as readSavedList,
  isSaved as isSavedSlug,
  addToList as addToSavedList,
  removeFromList as removeFromSavedList,
  updateNote as updateSavedListNote,
  subscribe as subscribeToSavedList,
} from "./saved-list.js";
import {
  renderCardMarkup,
  renderBottomSheetMarkup,
  renderEmptyStateMarkup,
} from "./directory-render.js";
import { buildCardViewModel, buildDirectoryDetailsViewModel } from "./directory-view-model.js";
import { initValuePillPopover } from "./therapist-pills.js";
import { lookupZipPlace, getZipMarketStatus, preloadZipcodes } from "./zip-lookup.js";
import { isDatasetEmpty, renderDatasetEmptyStateMarkup } from "./empty-dataset-state.js";

(async function () {
  initValuePillPopover();
  var content = await fetchDirectoryPageContent();
  var therapists = content.therapists || [];
  var directoryPage = content.directoryPage || null;
  var siteSettings = content.siteSettings || null;

  if (isDatasetEmpty(therapists)) {
    var emptyHideIds = [
      "directoryRecommendationZone",
      "directoryJourneySummary",
      "directorySparseNudge",
      "dirLoadMoreWrap",
      "resultsCount",
      "filterCount",
      "activeFilterChips",
    ];
    emptyHideIds.forEach(function (id) {
      var node = document.getElementById(id);
      if (node) {
        node.setAttribute("hidden", "");
      }
    });
    var emptyHideSelectors = [".dir-vb-bar-wrap", ".dir-results-bar"];
    emptyHideSelectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (node) {
        node.setAttribute("hidden", "");
        node.style.display = "none";
      });
    });
    var emptyGrid = document.getElementById("resultsGrid");
    if (emptyGrid) {
      emptyGrid.className = "dataset-empty-state-grid";
      emptyGrid.innerHTML = renderDatasetEmptyStateMarkup();
    }
    return;
  }
  // Step 8: numbered pagination. Page size is 12 (constant in
  // directory-controller.js).
  var currentPage = 1;
  var activeDetailsSlug = "";
  var lastDetailsTrigger = null;
  var stableOrderMap = null;
  var sortZip = "";
  var DIRECTORY_IP_LOCATION_CACHE_KEY = "bth_directory_ip_location_v1";
  var DIRECTORY_IP_LOCATION_TTL_MS = 12 * 60 * 60 * 1000;
  var MULTI_SET = new Set(FILTER_MULTI_VALUE_KEYS);
  var defaultFilters = {
    state: "CA",
    zip: "",
    explicit_zip: "",
    ranking_zip: "",
    ranking_label: "",
    ranking_source: "",
    specialty: [],
    modality: [],
    population: [],
    bipolar_experience: "",
    insurance: [],
    gender: "",
    session_fee_min: "",
    session_fee_max: "",
    sliding_scale: false,
    therapist: false,
    psychiatrist: false,
    telehealth: false,
    in_person: false,
    accepting: false,
    medication_management: false,
    responsive_contact: false,
    sortBy: "stable_random",
    stableOrderMap: null,
    sortZip: "",
  };
  var filters = { ...defaultFilters };
  var shortlist = readSavedList();
  subscribeToSavedList(function (next) {
    shortlist = next;
  });
  var pendingMotionSlug = "";
  var liveFilterTimer = 0;
  var resizeTimer = 0;
  var filteredResultsCacheKey = "";
  var filteredResultsCache = [];
  var optionIndexes = buildOptionIndexes();
  var VALID_SORT_OPTIONS = new Set([
    "stable_random",
    "near_zip",
    "most_experienced",
    "soonest_availability",
    "lowest_fee",
  ]);

  function getElement(id) {
    return document.getElementById(id);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(String(value || ""));
    }
    return String(value || "").replace(/["\\]/g, "\\$&");
  }

  function dataSelector(attribute, value) {
    return "[" + attribute + '="' + cssEscape(value) + '"]';
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildStableOrderMap(items) {
    var SEED_KEY = "bth_stable_sort_seed_v1";
    var raw = null;
    try {
      raw = window.sessionStorage.getItem(SEED_KEY);
    } catch (_err) {}
    var seed = raw && !isNaN(Number(raw)) ? Number(raw) : Math.floor(Math.random() * 0xffffffff);
    if (!raw) {
      try {
        window.sessionStorage.setItem(SEED_KEY, String(seed));
      } catch (_err) {}
    }
    var rng = mulberry32(seed);
    var indices = items.map(function (_, i) {
      return i;
    });
    indices.sort(function () {
      return rng() - 0.5;
    });
    var map = new Map();
    indices.forEach(function (origIdx, sortedIdx) {
      if (items[origIdx]) {
        map.set(items[origIdx].slug, sortedIdx);
      }
    });
    return map;
  }

  function initSortZip() {
    var SORT_ZIP_KEY = "bth_sort_zip_v1";
    var urlZip = "";
    try {
      var paramZip = new URLSearchParams(window.location.search).get("sortZip");
      if (paramZip && /^\d{5}$/.test(paramZip.trim())) {
        urlZip = paramZip.trim();
      }
    } catch (_err) {}
    if (urlZip) {
      sortZip = urlZip;
      try {
        window.sessionStorage.setItem(SORT_ZIP_KEY, urlZip);
      } catch (_err) {}
    } else {
      try {
        var stored = window.sessionStorage.getItem(SORT_ZIP_KEY);
        if (stored && /^\d{5}$/.test(stored)) {
          sortZip = stored;
        }
      } catch (_err) {}
    }
    var sortZipInput = getElement("sortZip");
    if (sortZipInput) {
      sortZipInput.value = sortZip;
    }
    if (sortZip) {
      filters.sortBy = "near_zip";
      filters.sortZip = sortZip;
      var nearZipOption = getElement("sortNearZipOption");
      if (nearZipOption) {
        nearZipOption.hidden = false;
      }
      var sortByEl = getElement("sortBy");
      if (sortByEl) {
        sortByEl.value = "near_zip";
      }
    }
  }

  function saveSortZip(zip) {
    var SORT_ZIP_KEY = "bth_sort_zip_v1";
    try {
      if (zip) {
        window.sessionStorage.setItem(SORT_ZIP_KEY, zip);
      } else {
        window.sessionStorage.removeItem(SORT_ZIP_KEY);
      }
    } catch (_err) {}
  }

  function normalizeZip(value) {
    var normalized = String(value || "").trim();
    return /^\d{5}$/.test(normalized) ? normalized : "";
  }

  function getRankingLocationLabel(zip, fallbackLabel) {
    var place = lookupZipPlace(zip);
    if (place && place.label) {
      return place.label;
    }
    return String(fallbackLabel || "").trim();
  }

  function applyRankingLocationContext(options) {
    var zip = normalizeZip(options && options.zip);
    var label = getRankingLocationLabel(zip, options && options.label);
    var source = String((options && options.source) || "").trim();

    filters = Object.assign({}, filters, {
      explicit_zip: source === "explicit_zip" ? zip : normalizeZip(filters.explicit_zip),
      ranking_zip: zip,
      ranking_label: label,
      ranking_source: source,
    });
  }

  function clearRankingLocationContext() {
    filters = Object.assign({}, filters, {
      explicit_zip: normalizeZip(filters.zip),
      ranking_zip: "",
      ranking_label: "",
      ranking_source: "",
    });
  }

  function syncRankingLocationFromUserZip() {
    var explicitZip = normalizeZip(filters.zip);
    if (explicitZip) {
      applyRankingLocationContext({
        zip: explicitZip,
        source: "explicit_zip",
      });
      if (filters.sortBy === "stable_random") {
        sortZip = explicitZip;
        saveSortZip(explicitZip);
        filters = Object.assign({}, filters, {
          sortBy: "near_zip",
          sortZip: explicitZip,
        });
        var nearZipOption = getElement("sortNearZipOption");
        var sortByEl = getElement("sortBy");
        var sortZipInput = getElement("sortZip");
        if (nearZipOption) nearZipOption.hidden = false;
        if (sortByEl) sortByEl.value = "near_zip";
        if (sortZipInput && !sortZipInput.value.trim()) sortZipInput.value = explicitZip;
      }
      return true;
    }

    filters = Object.assign({}, filters, {
      explicit_zip: "",
    });

    if (filters.ranking_source === "explicit_zip") {
      clearRankingLocationContext();
    }
    return false;
  }

  function readCachedIpLocation() {
    try {
      var raw = window.localStorage.getItem(DIRECTORY_IP_LOCATION_CACHE_KEY);
      if (!raw) {
        return null;
      }
      var parsed = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed.cached_at !== "number" ||
        Date.now() - parsed.cached_at >= DIRECTORY_IP_LOCATION_TTL_MS
      ) {
        window.localStorage.removeItem(DIRECTORY_IP_LOCATION_CACHE_KEY);
        return null;
      }
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  async function fetchIpRankingLocation() {
    var cached = readCachedIpLocation();
    if (cached && normalizeZip(cached.zip)) {
      return {
        zip: normalizeZip(cached.zip),
        label: getRankingLocationLabel(cached.zip, cached.label),
      };
    }

    return null;
  }

  async function ensureIpRankingLocation() {
    if (normalizeZip(filters.zip) || filters.ranking_source === "explicit_zip") {
      return false;
    }

    var inferredLocation = await fetchIpRankingLocation();
    if (!inferredLocation || !normalizeZip(inferredLocation.zip)) {
      return false;
    }

    applyRankingLocationContext({
      zip: inferredLocation.zip,
      label: inferredLocation.label,
      source: "ip",
    });
    return true;
  }

  function buildFilterCacheKey(filterState) {
    return FILTER_VALUE_KEYS.concat(FILTER_BOOLEAN_KEYS, [
      "explicit_zip",
      "ranking_zip",
      "ranking_label",
      "ranking_source",
      "sortZip",
    ])
      .map(function (key) {
        return key + ":" + String(filterState[key] || "");
      })
      .join("|");
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

  function isShortlisted(slug) {
    return isSavedSlug(slug);
  }

  function toggleShortlist(slug) {
    if (isSavedSlug(slug)) {
      var removed = removeFromSavedList(slug, { surface: "directory" });
      shortlist = removed.list;
      trackFunnelEvent("directory_shortlist_removed", { therapist_slug: slug });
      return false;
    }
    var added = addToSavedList(slug, { surface: "directory" });
    shortlist = added.list;
    if (added.changed) {
      trackFunnelEvent("directory_shortlist_saved", {
        therapist_slug: slug,
        shortlist_size_before: shortlist.length - 1,
      });
    }
    return added.changed;
  }

  function updateShortlistNote(slug, note) {
    shortlist = updateSavedListNote(slug, note);
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

    if (stateSelect && directoryPage.stateAllLabel) {
      stateSelect.querySelector("option").textContent = directoryPage.stateAllLabel;
    }
    if (specialtySelect && directoryPage.specialtyAllLabel) {
      specialtySelect.querySelector("option").textContent = directoryPage.specialtyAllLabel;
    }
  }

  function applySiteSettings() {
    if (!siteSettings) {
      return;
    }

    var navBrowseLink = getElement("navBrowseLink");
    var navCtaLink = getElement("navCtaLink");
    var footerTagline = getElement("footerTagline");

    if (
      navBrowseLink &&
      siteSettings.browseLabel &&
      !(navBrowseLink.dataset && navBrowseLink.dataset.matchNavManaged)
    ) {
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
    toFilterArray(filters.specialty).forEach(function (v) {
      chips.push({ key: "specialty", label: v });
    });
    toFilterArray(filters.modality).forEach(function (v) {
      chips.push({ key: "modality", label: v });
    });
    toFilterArray(filters.population).forEach(function (v) {
      chips.push({ key: "population", label: v });
    });
    if (filters.bipolar_experience) {
      chips.push({
        key: "bipolar_experience",
        label: filters.bipolar_experience + "+ yrs bipolar care",
      });
    }
    toFilterArray(filters.insurance).forEach(function (v) {
      chips.push({ key: "insurance", label: v });
    });
    if (filters.session_fee_min || filters.session_fee_max) {
      var min = Number(filters.session_fee_min || 0);
      var max = Number(filters.session_fee_max || 0);
      var feeLabel;
      if (min > 0 && max > 0) feeLabel = "$" + min + "–$" + max + "/session";
      else if (min > 0) feeLabel = "$" + min + "+ /session";
      else feeLabel = "Up to $" + max + "/session";
      chips.push({ key: "session_fee", label: feeLabel });
    }
    if (filters.sliding_scale) {
      chips.push({ key: "sliding_scale", label: "Sliding scale" });
    }
    if (filters.gender) {
      chips.push({
        key: "gender",
        label:
          filters.gender === "male"
            ? "Male therapist"
            : filters.gender === "female"
              ? "Female therapist"
              : "Non-binary therapist",
      });
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
    // recently_confirmed chip retired 2026-05-18; only 2/150 therapists
    // had a recent confirmation timestamp so it trapped users.
    return chips;
  }

  function removeActiveFilter(filterKey) {
    if (!filterKey) return;
    // Compound chip for the fee range, clears both bounds at once.
    if (filterKey === "session_fee") {
      filters = Object.assign({}, filters, { session_fee_min: "", session_fee_max: "" });
      currentPage = 1;
      syncFilterControlsFromState(filters, getElement);
      syncInsuranceDisplay();
      syncDrawerChipPickers();
      render();
      return;
    }
    if (!(filterKey in filters)) {
      return;
    }
    var nextValue;
    if (MULTI_SET.has(filterKey)) {
      // Multi-select keys clear to an empty array (removes ALL selected
      // values for that key). Removing one specific selected value at a
      // time is wired in step 6 with the dedicated dropdown chip.
      nextValue = [];
    } else if (typeof defaultFilters[filterKey] === "boolean") {
      nextValue = false;
    } else {
      nextValue = "";
    }
    filters = Object.assign({}, filters, { [filterKey]: nextValue });
    currentPage = 1;
    syncFilterControlsFromState(filters, getElement);
    syncInsuranceDisplay();
    syncDrawerChipPickers();
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

  function uniqueCounts(field, _nested) {
    var counts =
      field === "treatment_modalities"
        ? optionIndexes.modality
        : field === "client_populations"
          ? optionIndexes.population
          : field === "insurance_accepted"
            ? optionIndexes.insurance
            : field === "specialties"
              ? optionIndexes.specialty
              : field === "state"
                ? optionIndexes.state
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
    if (!select) return;
    items.forEach(function (item) {
      var option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.value + (item.count ? " (" + item.count + ")" : "");
      select.appendChild(option);
    });
  }

  function syncInsuranceDisplay() {
    var hidden = getElement("insurance");
    var display = getElement("insuranceDisplay");
    var clearBtn = getElement("insuranceClearBtn");
    if (!display) return;
    var val = hidden ? hidden.value : "";
    display.value = val;
    display.classList.toggle("has-value", Boolean(val));
    if (clearBtn) clearBtn.hidden = !val;
  }

  function initInsuranceTypeahead(items) {
    var display = getElement("insuranceDisplay");
    var hidden = getElement("insurance");
    var list = getElement("insuranceSuggestions");
    var clearBtn = getElement("insuranceClearBtn");
    if (!display || !hidden || !list) return;

    var activeIndex = -1;

    function filtered(query) {
      var q = (query || "").toLowerCase().trim();
      if (!q) return items;
      return items.filter(function (item) {
        return item.value.toLowerCase().indexOf(q) !== -1;
      });
    }

    function renderList(results) {
      if (!results.length) {
        list.innerHTML = '<div class="ins-ta-empty">No matching plans</div>';
      } else {
        list.innerHTML = results
          .map(function (item, i) {
            return (
              '<div class="ins-ta-option" role="option" data-value="' +
              escapeHtml(item.value) +
              '" data-idx="' +
              i +
              '">' +
              "<span>" +
              escapeHtml(item.value) +
              "</span>" +
              (item.count ? '<span class="ins-ta-option-count">' + item.count + "</span>" : "") +
              "</div>"
            );
          })
          .join("");
      }
      activeIndex = -1;
    }

    function openList() {
      renderList(filtered(display.value));
      list.hidden = false;
      display.setAttribute("aria-expanded", "true");
    }

    function closeList() {
      list.hidden = true;
      display.setAttribute("aria-expanded", "false");
      activeIndex = -1;
    }

    function commit(value) {
      hidden.value = value;
      display.value = value;
      display.classList.toggle("has-value", Boolean(value));
      if (clearBtn) clearBtn.hidden = !value;
      closeList();
      applyFiltersLive();
    }

    function updateActive() {
      var options = list.querySelectorAll(".ins-ta-option");
      options.forEach(function (o, i) {
        o.classList.toggle("is-active", i === activeIndex);
      });
      if (activeIndex >= 0 && options[activeIndex]) {
        options[activeIndex].scrollIntoView({ block: "nearest" });
      }
    }

    display.addEventListener("focus", openList);

    display.addEventListener("input", function () {
      renderList(filtered(display.value));
      list.hidden = false;
      display.setAttribute("aria-expanded", "true");
      // If user typed, clear the confirmed selection until they pick again
      if (display.value !== hidden.value) {
        hidden.value = "";
        display.classList.remove("has-value");
        if (clearBtn) clearBtn.hidden = true;
        applyFiltersLive();
      }
    });

    display.addEventListener("keydown", function (e) {
      var options = list.querySelectorAll(".ins-ta-option");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, options.length - 1);
        updateActive();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        updateActive();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex >= 0 && options[activeIndex]) {
          commit(options[activeIndex].getAttribute("data-value"));
        }
      } else if (e.key === "Escape") {
        closeList();
        display.blur();
      }
    });

    display.addEventListener("blur", function () {
      window.setTimeout(function () {
        closeList();
        // Revert display to last confirmed value if user typed but didn't pick
        display.value = hidden.value;
        display.classList.toggle("has-value", Boolean(hidden.value));
        if (clearBtn) clearBtn.hidden = !hidden.value;
      }, 160);
    });

    list.addEventListener("mousedown", function (e) {
      var option = e.target.closest(".ins-ta-option");
      if (option) {
        e.preventDefault();
        commit(option.getAttribute("data-value"));
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener("mousedown", function (e) {
        e.preventDefault();
        commit("");
        display.focus();
      });
    }
  }

  function initializeFilters() {
    populateSelect("state", getConfiguredItems("curatedStates", false));
    populateSelect("specialty", getConfiguredItems("curatedSpecialties", true));
    initInsuranceTypeahead(getConfiguredItems("curatedInsurance", true));
    populateSelect("modality", uniqueCounts("treatment_modalities", true));
    populateSelect("population", uniqueCounts("client_populations", true));

    var params = new URLSearchParams(window.location.search);
    FILTER_VALUE_KEYS.forEach(function (key) {
      var raw = params.get(key);
      if (!raw) return;
      if (MULTI_SET.has(key)) {
        // Multi-select keys parse comma-separated values. A single
        // value (?insurance=aetna) becomes a 1-element array, keeping
        // legacy bookmarks working.
        filters[key] = toFilterArray(raw);
        var multiInput = getElement(key);
        if (multiInput) {
          multiInput.value = filters[key].length ? filters[key][0] : "";
        }
        return;
      }
      filters[key] = key === "sortBy" && !VALID_SORT_OPTIONS.has(raw) ? defaultFilters.sortBy : raw;
      var input = getElement(key);
      if (input) {
        input.value = filters[key];
      }
    });

    FILTER_BOOLEAN_KEYS.forEach(function (key) {
      if (params.get(key) === "true") {
        filters[key] = true;
        getElement(key).checked = true;
      }
    });

    if (!params.get("sortBy")) {
      var sortByInput = getElement("sortBy");
      if (sortByInput) {
        sortByInput.value = filters.sortBy;
      }
    }

    // Step 8: hydrate currentPage from `?page=N`. Clamped to >= 1; the
    // upper bound is enforced by buildDirectoryRenderState when the
    // filter result count is known.
    var pageParam = Number(params.get("page") || 0);
    if (Number.isFinite(pageParam) && pageParam > 1) {
      currentPage = pageParam;
    }

    syncFilterControlsFromState(filters, getElement);
    syncInsuranceDisplay();
    syncRankingLocationFromUserZip();
    // Chip pickers are mounted once at init; subsequent state changes
    // (URL params, removeActiveFilter, etc.) call syncDrawerChipPickers
    // to re-paint the pressed/unpressed state.
    setupDrawerChipPickers();
  }

  function updateUrl() {
    var params = new URLSearchParams();
    var skipKeys = new Set([
      "stableOrderMap",
      "sortZip",
      "ranking_zip",
      "ranking_label",
      "ranking_source",
      "explicit_zip",
    ]);
    Object.keys(filters).forEach(function (key) {
      if (skipKeys.has(key)) {
        return;
      }
      if (MULTI_SET.has(key)) {
        var arr = toFilterArray(filters[key]);
        if (arr.length) {
          // Comma-separated multi-value serialization keeps legacy
          // single-value bookmarks readable.
          params.set(key, arr.join(","));
        }
        return;
      }
      if (!filters[key]) {
        return;
      }
      if (key === "sortBy" && filters[key] === defaultFilters.sortBy) {
        return;
      }
      params.set(key, String(filters[key]));
    });
    if (sortZip) {
      params.set("sortZip", sortZip);
    }
    // Step 8: page number persists in the URL. Page 1 is omitted to keep
    // the canonical /directory URL clean.
    if (currentPage > 1) {
      params.set("page", String(currentPage));
    }
    var query = params.toString();
    var basePath = window.location.pathname.replace(/\/$/, "") || "/directory";
    var next = query ? basePath + "?" + query : basePath;
    window.history.replaceState({}, "", next);
    // Noindex when filters beyond defaults are applied, keeps the canonical
    // /directory (and the always-default state=CA) indexable while avoiding
    // duplicate-content sprawl on filtered URLs Google might encounter.
    var meaningfulFilters = Object.keys(filters).some(function (key) {
      if (skipKeys.has(key)) return false;
      if (MULTI_SET.has(key)) {
        return toFilterArray(filters[key]).length > 0;
      }
      if (!filters[key]) return false;
      return filters[key] !== defaultFilters[key];
    });
    var robotsMeta = document.getElementById("dirRobots");
    if (robotsMeta) {
      robotsMeta.setAttribute("content", meaningfulFilters ? "noindex,follow" : "index,follow");
    }
  }
  function getFilteredWithFilters(filterState) {
    var cacheKey = buildFilterCacheKey(filterState);
    if (cacheKey === filteredResultsCacheKey) {
      return filteredResultsCache;
    }

    filteredResultsCache = therapists
      .filter(function (therapist) {
        return matchesDirectoryFilters(filterState, therapist);
      })
      .sort(function (a, b) {
        return compareTherapistsWithFilters(filterState, a, b);
      });
    filteredResultsCacheKey = cacheKey;
    return filteredResultsCache;
  }

  function getFilters() {
    return Object.assign({}, filters, {
      stableOrderMap: stableOrderMap,
      sortZip: sortZip,
    });
  }

  function getFiltered() {
    return getFilteredWithFilters(getFilters());
  }

  function getTherapistBySlug(slug) {
    return therapists.find(function (therapist) {
      return therapist.slug === slug;
    });
  }

  function renderCard(therapist) {
    return renderCardMarkup({
      model: buildCardViewModel({
        therapist: therapist,
        filters: filters,
        shortlist: shortlist,
        isShortlisted: isShortlisted,
      }),
    });
  }

  function renderResultsGrid(pageItems) {
    var grid = getElement("resultsGrid");
    if (!grid) {
      return;
    }

    if (!pageItems.length) {
      // Step 9: empty state + "You might also consider" loosened-search
      // section. Build a loosened result set by dropping each active
      // filter one at a time and picking the variant that returns the
      // most therapists. Show up to 2 cards.
      var emptyHtml = renderEmptyStateMarkup(directoryPage);
      var loosenedHtml = renderLoosenedResultsSection();
      grid.innerHTML = emptyHtml + loosenedHtml;
      // Bind the in-empty-state clear button to the same reset action
      // used by the active-filter strip's clear-all link.
      var emptyClearBtn = document.getElementById("dirEmptyClearAll");
      if (emptyClearBtn) {
        emptyClearBtn.addEventListener("click", resetFilters);
      }
      return;
    }

    // Step 7: inject a match nudge after the 12th card (between rows 6
    // and 7 in the 2-col grid). Quiet, secondary-background card
    // spanning both columns, no icon, no illustration per spec.
    var cardHtmlList = pageItems.map(renderCard);
    if (cardHtmlList.length > 12) {
      cardHtmlList.splice(12, 0, renderMatchNudgeMarkup());
    }
    grid.innerHTML = cardHtmlList.join("");
  }

  // Step 9: "You might also consider", when the current filter set
  // returns nothing, try dropping each active filter one at a time and
  // pick the relaxation that yields the most results. Return up to 2
  // cards. If even the broadest single-drop returns nothing, render
  // nothing (the empty-state copy carries the message alone).
  function renderLoosenedResultsSection() {
    var ACTIVE_VALUE_KEYS = [
      "specialty",
      "modality",
      "population",
      "insurance",
      "bipolar_experience",
      "gender",
      "session_fee_min",
      "session_fee_max",
    ];
    var ACTIVE_BOOLEAN_KEYS = [
      "therapist",
      "psychiatrist",
      "telehealth",
      "in_person",
      "accepting",
      "medication_management",
      "sliding_scale",
    ];
    var allActive = ACTIVE_VALUE_KEYS.concat(ACTIVE_BOOLEAN_KEYS).filter(function (key) {
      var val = filters[key];
      if (Array.isArray(val)) return val.length > 0;
      if (typeof val === "boolean") return val;
      return Boolean(val);
    });
    if (!allActive.length) return ""; // No filters to drop.

    var best = { dropped: null, results: [] };
    allActive.forEach(function (key) {
      var probe = Object.assign({}, filters);
      if (Array.isArray(filters[key])) probe[key] = [];
      else if (typeof filters[key] === "boolean") probe[key] = false;
      else probe[key] = "";
      var hits = therapists.filter(function (t) {
        return matchesDirectoryFilters(probe, t);
      });
      if (hits.length > best.results.length) {
        best = { dropped: key, results: hits };
      }
    });

    if (!best.results.length) return "";

    var sampleCards = best.results.slice(0, 2).map(function (t) {
      var model = buildCardViewModel({
        therapist: t,
        filters: filters,
        shortlist: shortlist,
      });
      return renderCardMarkup({ model: model });
    });

    var droppedLabels = {
      specialty: "Bipolar subtype",
      modality: "Treatment approach",
      population: "Population",
      insurance: "Insurance",
      bipolar_experience: "Experience level",
      gender: "Gender",
      session_fee_min: "Session fee",
      session_fee_max: "Session fee",
      therapist: "Therapist",
      psychiatrist: "Psychiatrist",
      telehealth: "Telehealth",
      in_person: "In-person",
      accepting: "Accepting new patients",
      medication_management: "Medication management",
      sliding_scale: "Sliding scale",
    };
    var droppedLabel = droppedLabels[best.dropped] || best.dropped;

    return (
      '<section class="dir-loosened">' +
      '<div class="dir-loosened-head">' +
      '<h4 class="dir-loosened-title">You might also consider</h4>' +
      '<p class="dir-loosened-sub">These don\'t match all of your filters, we relaxed the <strong>' +
      escapeHtml(droppedLabel) +
      "</strong> filter to surface options.</p>" +
      "</div>" +
      '<div class="dir-loosened-grid">' +
      sampleCards.join("") +
      "</div>" +
      "</section>"
    );
  }

  function renderMatchNudgeMarkup() {
    return (
      '<aside class="dir-match-nudge" data-event="directory_match_nudge_click">' +
      '<p class="dir-match-nudge-copy">' +
      "Not sure who to choose? Answer a few questions and we'll narrow it down." +
      "</p>" +
      '<a class="dir-match-nudge-cta" href="/#startMatch" data-cta-tier="nudge">' +
      "Get matched →" +
      "</a>" +
      "</aside>"
    );
  }

  function renderDetailsModal(slug) {
    var body = getElement("directoryDetailsBody");
    var dialog = getElement("directoryDetailsModal");
    if (!body || !dialog) {
      return;
    }

    if (!slug) {
      body.innerHTML = "";
      dialog.setAttribute("aria-hidden", "true");
      dialog.setAttribute("aria-label", "Provider details");
      return;
    }

    var therapist = getTherapistBySlug(slug);
    if (!therapist) {
      body.innerHTML = "";
      dialog.setAttribute("aria-hidden", "true");
      return;
    }

    body.innerHTML = renderBottomSheetMarkup({
      model: buildDirectoryDetailsViewModel({
        therapist: therapist,
        filters: filters,
        shortlist: shortlist,
        isShortlisted: isShortlisted,
      }),
    });
    dialog.setAttribute("aria-hidden", "false");

    // Set aria-label directly on the dialog, aria-labelledby can't be used because
    // the heading element is inside .dir-panel-head which is display:none on mobile.
    var displayName = therapist.name.split(",")[0].trim();
    var credSuffix = therapist.credentials ? ", " + therapist.credentials : "";
    dialog.setAttribute("aria-label", displayName + credSuffix + ", Provider details");

    // Hide bio toggle + fade when the bio already fits without scrolling.
    // Must run after innerHTML is set so layout is measurable.
    window.requestAnimationFrame(function () {
      var bioText = body.querySelector(".bsh-bio-text");
      var bioFade = body.querySelector(".bsh-bio-fade");
      var bioToggle = body.querySelector(".bsh-bio-toggle");
      if (bioText && bioToggle) {
        if (bioText.scrollHeight <= bioText.clientHeight + 2) {
          bioText.classList.add("is-expanded");
          if (bioFade) bioFade.classList.add("is-hidden");
          bioToggle.hidden = true;
        }
      }
    });
  }

  function openDetailsModal(slug, trigger) {
    var dialog = getElement("directoryDetailsModal");
    var scrim = getElement("directoryDetailsScrim");
    if (!dialog || !scrim || !slug) {
      return;
    }

    activeDetailsSlug = slug;
    lastDetailsTrigger = trigger || document.activeElement || null;
    renderDetailsModal(slug);
    dialog.hidden = false;
    scrim.hidden = false;

    window.requestAnimationFrame(function () {
      dialog.setAttribute("data-open", "true");
      scrim.setAttribute("data-open", "true");
      // Mobile: #directoryDetailsClose is rendered inside the body.
      // Desktop: #directoryDetailsCloseDesktop is in the static panel head.
      var closeButton =
        getElement("directoryDetailsClose") || getElement("directoryDetailsCloseDesktop");
      if (closeButton) {
        closeButton.focus();
      }
    });

    document.body.style.overflow = "hidden";
    trackFunnelEvent("directory_view_details_clicked", {
      therapist_slug: slug,
      sort_by: filters.sortBy,
    });
  }

  function closeDetailsModal() {
    var dialog = getElement("directoryDetailsModal");
    var scrim = getElement("directoryDetailsScrim");
    if (!dialog || !scrim) {
      return;
    }

    if (!activeDetailsSlug && dialog.hidden) {
      return;
    }

    trackFunnelEvent("directory_return_from_details_to_results", {
      therapist_slug: activeDetailsSlug,
      sort_by: filters.sortBy,
    });
    activeDetailsSlug = "";
    renderDetailsModal("");
    dialog.removeAttribute("data-open");
    scrim.removeAttribute("data-open");
    window.setTimeout(function () {
      dialog.hidden = true;
      scrim.hidden = true;
    }, 220);
    document.body.style.overflow = "";

    if (lastDetailsTrigger && typeof lastDetailsTrigger.focus === "function") {
      lastDetailsTrigger.focus();
    }
  }

  function pulsePendingCard() {
    var grid = getElement("resultsGrid");
    if (!grid || !pendingMotionSlug) {
      return;
    }

    var activeCard = grid.querySelector(dataSelector("data-card-slug", pendingMotionSlug));
    if (activeCard) {
      activeCard.classList.remove("motion-pulse");
      void activeCard.offsetWidth;
      activeCard.classList.add("motion-pulse");
    }
    pendingMotionSlug = "";
  }

  // Step 8: numbered pagination replaces the load-more pattern.
  // Renders Previous / page numbers (max 5 visible, ellipsis for
  // overflow) / Next. The page numbers, Previous, and Next all use
  // data-page attributes that the click handler reads. URL is
  // updated via updateUrl() so reload + back/forward work.
  function renderPagination(renderState) {
    var wrap = getElement("dirLoadMoreWrap");
    if (!wrap) {
      return;
    }
    var totalPages = renderState.totalPages || 1;
    var page = renderState.currentPage || 1;
    if (totalPages <= 1) {
      wrap.innerHTML = "";
      return;
    }

    function pageButton(n, isCurrent) {
      return (
        '<button type="button" class="dir-pagination-num' +
        (isCurrent ? " is-current" : "") +
        '" data-page="' +
        n +
        '" aria-current="' +
        (isCurrent ? "page" : "false") +
        '" aria-label="Page ' +
        n +
        '">' +
        n +
        "</button>"
      );
    }

    // Build the visible page-number window. Always show first + last;
    // the spec says max 5 visible with ellipsis for the gap.
    var nums = [];
    var window = 1; // how many neighbors on each side of `page`
    var start = Math.max(2, page - window);
    var end = Math.min(totalPages - 1, page + window);
    nums.push(pageButton(1, page === 1));
    if (start > 2) nums.push('<span class="dir-pagination-gap">…</span>');
    for (var n = start; n <= end; n += 1) nums.push(pageButton(n, n === page));
    if (end < totalPages - 1) nums.push('<span class="dir-pagination-gap">…</span>');
    if (totalPages > 1) nums.push(pageButton(totalPages, page === totalPages));

    var prevDisabled = page <= 1;
    var nextDisabled = page >= totalPages;
    wrap.innerHTML =
      '<nav class="dir-pagination" aria-label="Results pagination">' +
      '<button type="button" class="dir-pagination-step" data-page="' +
      (page - 1) +
      '" ' +
      (prevDisabled ? "disabled" : "") +
      ' aria-label="Previous page">← Previous</button>' +
      '<div class="dir-pagination-nums">' +
      nums.join("") +
      "</div>" +
      '<button type="button" class="dir-pagination-step" data-page="' +
      (page + 1) +
      '" ' +
      (nextDisabled ? "disabled" : "") +
      ' aria-label="Next page">Next →</button>' +
      "</nav>";
  }

  function updateJsonLd(results) {
    var el = getElement("dirJsonLd");
    if (!el) {
      return;
    }
    var items = results.slice(0, 20).map(function (t, i) {
      return {
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Person",
          name: t.name,
          url: window.location.origin + "/therapists/" + encodeURIComponent(t.slug) + "/",
        },
      };
    });
    el.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Bipolar Therapists in California",
      itemListElement: items,
    });
  }

  function updateMeta(resultCount) {
    var titleEl = getElement("dirPageTitle");
    var descEl = getElement("dirPageDescription");
    var label = resultCount + " Bipolar Therapists in California";
    if (titleEl) {
      titleEl.textContent = label + " | BipolarTherapyHub";
    }
    document.title = label + " | BipolarTherapyHub";
    if (descEl) {
      descEl.setAttribute(
        "content",
        "Browse " +
          resultCount +
          " bipolar informed therapists and psychiatrists in California. Filter by location, insurance, and format.",
      );
    }
  }

  var impressionObserver = null;
  var seenImpressions = new Set();

  function initImpressionObserver() {
    if (typeof window.IntersectionObserver !== "function") {
      return;
    }
    if (impressionObserver) {
      impressionObserver.disconnect();
    }
    impressionObserver = new window.IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) {
            return;
          }
          var slug = entry.target.getAttribute("data-card-slug");
          if (!slug || seenImpressions.has(slug)) {
            return;
          }
          seenImpressions.add(slug);
          trackFunnelEvent("directory_card_impression", { therapist_slug: slug });
          impressionObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.3 },
    );
  }

  function observeCards(grid) {
    if (!impressionObserver || !grid) {
      return;
    }
    grid.querySelectorAll("[data-card-slug]").forEach(function (card) {
      var slug = card.getAttribute("data-card-slug");
      if (slug && !seenImpressions.has(slug)) {
        impressionObserver.observe(card);
      }
    });
  }

  function renderCurrentPageOnly(results) {
    var renderState = buildDirectoryRenderState({
      results: results,
      currentPage: currentPage,
      filters: getFilters(),
      directoryPage: directoryPage,
    });

    if (!renderState.results.length) {
      renderResultsGrid([]);
    } else {
      renderResultsGrid(renderState.pageItems);
    }
    renderPagination(renderState);
    pulsePendingCard();
    observeCards(getElement("resultsGrid"));
  }

  function render() {
    var currentFilters = getFilters();
    var renderState = buildDirectoryRenderState({
      results: getFilteredWithFilters(currentFilters),
      currentPage: currentPage,
      filters: currentFilters,
      directoryPage: directoryPage,
    });
    currentPage = renderState.currentPage;
    var results = renderState.results;
    var pageItems = renderState.pageItems;
    var count = getElement("resultsCount");
    var filterCount = getElement("filterCount");
    var resultsSuffix = renderState.resultsSuffix;
    var singularSuffix = renderState.singularSuffix;
    var activeFilterCount = renderState.activeFilterCount;

    if (count) {
      count.innerHTML =
        "<strong>" +
        results.length +
        "</strong> " +
        (results.length === 1 ? singularSuffix : resultsSuffix);
    }
    if (filterCount) {
      filterCount.textContent = activeFilterCount ? "(" + activeFilterCount + ")" : "";
    }
    renderActiveFilterSummary(results.length);
    renderJourneySummary(results.length, activeFilterCount);
    updateSparseMatchNudge(results.length, activeFilterCount);
    updateMeta(results.length);
    updateJsonLd(results);

    if (!results.length) {
      renderResultsGrid([]);
      renderPagination({ totalPages: 1, currentPage: 1 });
      updateUrl();
      return;
    }

    renderResultsGrid(pageItems);
    pulsePendingCard();
    renderPagination(renderState);
    observeCards(getElement("resultsGrid"));
    updateUrl();
  }

  function refreshShortlistViews() {
    renderCurrentPageOnly(getFiltered());
  }

  // Patch only the bookmark button(s) inside the open panel without re-rendering
  // the whole body (which would collapse expanded bio / insurance state).
  function patchPanelBookmark(slug, isSaved) {
    var body = getElement("directoryDetailsBody");
    if (!body || !slug) return;
    var btns = body.querySelectorAll(dataSelector("data-shortlist-slug", slug));
    btns.forEach(function (btn) {
      btn.setAttribute("aria-pressed", isSaved ? "true" : "false");
      btn.setAttribute("aria-label", isSaved ? "Remove from saved list" : "Save to list");
      btn.classList.toggle("is-saved", isSaved);
      var svg = btn.querySelector("svg");
      if (svg) svg.setAttribute("fill", isSaved ? "currentColor" : "none");
    });
  }

  function applyFilters() {
    var nextState = applyDirectoryFiltersAction({
      filters: filters,
      getElement: getElement,
    });
    filters = nextState.filters;
    currentPage = 1;
    syncRankingLocationFromUserZip();
    trackFunnelEvent("directory_filters_applied", {
      active_filter_count: countActiveFilters(filters),
      sort_by: filters.sortBy,
    });
    trackFunnelEvent("directory_filter_changed", {
      active_filter_count: countActiveFilters(filters),
    });
    render();
    ensureIpRankingLocation().then(function (didUpdate) {
      if (didUpdate) {
        render();
      }
    });
  }

  function applyFiltersLive() {
    var nextState = applyDirectoryFiltersAction({
      filters: filters,
      getElement: getElement,
    });
    filters = nextState.filters;
    currentPage = 1;
    syncRankingLocationFromUserZip();
    render();
    ensureIpRankingLocation().then(function (didUpdate) {
      if (didUpdate) {
        render();
      }
    });
  }

  function scheduleLiveFilters() {
    window.clearTimeout(liveFilterTimer);
    liveFilterTimer = window.setTimeout(function () {
      applyFiltersLive();
    }, 120);
  }

  // ─── Drawer chip pickers (Step 6) ────────────────────────────────────
  // Replace the legacy single-value <select> dropdowns inside the
  // filters modal with multi-select chip groups. Wires directly to
  // filters[key] (the step-4 array shape) and re-renders results.
  var DRAWER_CHIP_OPTIONS = {
    specialty: {
      multi: true,
      title: "Bipolar subtype",
      caption: "Match any of",
      options: [
        { value: "Bipolar I", label: "Bipolar I" },
        { value: "Bipolar II", label: "Bipolar II" },
        { value: "Cyclothymia", label: "Cyclothymia" },
      ],
    },
    modality: {
      multi: true,
      title: "Treatment approach",
      caption: "Match any of",
      // Chip `value` must match the exact strings stored on therapist
      // documents in Sanity, since the filter does arrayAnyMatch with
      // strict string equality. UI label can read more naturally.
      options: [
        { value: "IPSRT", label: "IPSRT" },
        { value: "Family Therapy", label: "Family-Focused Therapy" },
        { value: "DBT", label: "DBT" },
        { value: "CBT", label: "CBT" },
        { value: "Mindfulness", label: "Mindfulness-based" },
      ],
    },
    population: {
      multi: true,
      title: "Population",
      caption: "Match any of",
      // Same constraint as modality. Sanity values are title-cased
      // ("Young Adults", "Older Adults") and lack the parenthetical
      // age ranges; we keep the friendlier labels in the UI.
      options: [
        { value: "Adults", label: "Adults" },
        { value: "Adolescents", label: "Adolescents (13-17)" },
        { value: "Young Adults", label: "Young adults (18-25)" },
        { value: "Older Adults", label: "Older adults (65+)" },
        { value: "LGBTQ+", label: "LGBTQ+" },
      ],
    },
    bipolar_experience: {
      multi: false,
      title: "Experience level",
      caption: "Minimum years treating bipolar",
      options: [
        { value: "", label: "Any" },
        { value: "3", label: "3+ years" },
        { value: "5", label: "5+ years" },
        { value: "10", label: "10+ years" },
      ],
    },
  };

  function isChipPressed(filterKey, value) {
    if (DRAWER_CHIP_OPTIONS[filterKey].multi) {
      var arr = Array.isArray(filters[filterKey]) ? filters[filterKey] : [];
      return arr.indexOf(value) !== -1;
    }
    return String(filters[filterKey] || "") === String(value);
  }

  function toggleChipValue(filterKey, value) {
    var cfg = DRAWER_CHIP_OPTIONS[filterKey];
    if (cfg.multi) {
      var arr = Array.isArray(filters[filterKey]) ? filters[filterKey].slice() : [];
      var idx = arr.indexOf(value);
      if (idx === -1) arr.push(value);
      else arr.splice(idx, 1);
      filters[filterKey] = arr;
    } else {
      // Single-select: clicking the already-pressed value clears it (so
      // "Any" works whether or not the user explicitly clicks it).
      var current = String(filters[filterKey] || "");
      if (current === String(value) && value !== "") {
        filters[filterKey] = "";
      } else {
        filters[filterKey] = String(value);
      }
    }
  }

  function setupDrawerChipPicker(filterKey) {
    var container = document.querySelector('[data-drawer-chip-picker="' + filterKey + '"]');
    if (!container) return;
    var cfg = DRAWER_CHIP_OPTIONS[filterKey];
    container.innerHTML = cfg.options
      .map(function (opt) {
        return (
          '<button type="button" class="dir-drawer-chip" data-chip-value="' +
          escapeHtml(opt.value) +
          '" aria-pressed="' +
          (isChipPressed(filterKey, opt.value) ? "true" : "false") +
          '">' +
          escapeHtml(opt.label) +
          "</button>"
        );
      })
      .join("");
    // Click handler is bound once per container via a one-time guard
    // attribute. Subsequent setupDrawerChipPickers() calls (e.g. after a
    // URL-driven state restore) only re-paint the chip pressed state.
    if (container.getAttribute("data-chip-bound") === "true") return;
    container.setAttribute("data-chip-bound", "true");
    container.addEventListener("click", function (event) {
      var button = event.target.closest("[data-chip-value]");
      if (!button) return;
      var value = button.getAttribute("data-chip-value");
      toggleChipValue(filterKey, value);
      // Refresh pressed state on every chip in this group (single-select
      // needs siblings cleared; multi-select only the clicked one flips).
      Array.from(container.querySelectorAll("[data-chip-value]")).forEach(function (chip) {
        chip.setAttribute(
          "aria-pressed",
          isChipPressed(filterKey, chip.getAttribute("data-chip-value")) ? "true" : "false",
        );
      });
      currentPage = 1;
      render();
      scheduleLiveFilters();
    });
  }

  function setupDrawerChipPickers() {
    Object.keys(DRAWER_CHIP_OPTIONS).forEach(function (key) {
      setupDrawerChipPicker(key);
    });
  }

  function syncDrawerChipPickers() {
    Object.keys(DRAWER_CHIP_OPTIONS).forEach(function (filterKey) {
      var container = document.querySelector('[data-drawer-chip-picker="' + filterKey + '"]');
      if (!container) return;
      Array.from(container.querySelectorAll("[data-chip-value]")).forEach(function (chip) {
        chip.setAttribute(
          "aria-pressed",
          isChipPressed(filterKey, chip.getAttribute("data-chip-value")) ? "true" : "false",
        );
      });
    });
  }

  function resetFilters() {
    var nextState = resetDirectoryFiltersAction(defaultFilters);
    filters = nextState.filters;
    currentPage = 1;
    syncFilterControlsFromState(filters, getElement);
    syncInsuranceDisplay();
    syncRankingLocationFromUserZip();
    render();
    ensureIpRankingLocation().then(function (didUpdate) {
      if (didUpdate) {
        render();
      }
    });
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
      var saved = toggleShortlist(shortlistSlug);
      trackFunnelEvent("directory_save_toggled", {
        therapist_slug: shortlistSlug,
        saved: saved,
      });
      refreshShortlistViews();
      patchPanelBookmark(shortlistSlug, saved);
      return;
    }

    var primaryLink = event.target.closest("[data-primary-cta]");
    if (primaryLink) {
      var primarySlug = primaryLink.getAttribute("data-primary-cta");
      var therapist = getTherapistBySlug(primarySlug);
      var ctaTier = primaryLink.getAttribute("data-cta-tier") || "browse";
      if (therapist) {
        rememberTherapistContactRoute(
          primarySlug,
          primaryLink.getAttribute("href"),
          "directory_" + ctaTier,
        );
      }
      trackFunnelEvent("directory_card_contact_action", {
        therapist_slug: primarySlug,
        sort_by: filters.sortBy,
      });
      trackFunnelEvent("directory_" + ctaTier + "_contact_cta_clicked", {
        therapist_slug: primarySlug,
        sort_by: filters.sortBy,
      });
      return;
    }

    var secondaryLink = event.target.closest("[data-secondary-cta]");
    if (secondaryLink) {
      var secondarySlug = secondaryLink.getAttribute("data-secondary-cta");
      trackFunnelEvent("directory_bottom_sheet_secondary_cta_clicked", {
        therapist_slug: secondarySlug,
        sort_by: filters.sortBy,
      });
      return;
    }

    // Card body click, open side panel (only when not clicking interactive elements)
    if (!event.target.closest("a, button")) {
      var cardEl = event.target.closest("[data-card-click]");
      if (cardEl) {
        var cardSlug = cardEl.getAttribute("data-card-click");
        openDetailsModal(cardSlug, cardEl);
        trackFunnelEvent("directory_card_profile_viewed", {
          therapist_slug: cardSlug,
          source: "card_body_click",
        });
        return;
      }
    }
  }

  function handleResultsGridChange(event) {
    var noteInput = event.target.closest("[data-shortlist-note]");
    if (!noteInput) {
      return;
    }

    updateShortlistNote(noteInput.getAttribute("data-shortlist-note"), noteInput.value);
  }

  function handleLoadMoreClick(event) {
    // Step 8: this used to handle the load-more button. Now it handles
    // numbered pagination clicks (Previous / Next / page-number buttons).
    var pageBtn = event.target.closest("[data-page]");
    if (!pageBtn || pageBtn.hasAttribute("disabled")) {
      return;
    }
    var nextPage = Number(pageBtn.getAttribute("data-page"));
    if (!Number.isFinite(nextPage) || nextPage < 1) return;
    currentPage = nextPage;
    trackFunnelEvent("directory_pagination_clicked", {
      page: currentPage,
      sort_by: filters.sortBy,
    });
    render();
    // Send the user to the top of the page so the next page starts at
    // the directory header, not partway down the previous results.
    if (typeof window.scrollTo === "function") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  var sortZipTimer = 0;

  function setSortZipNotice(message) {
    var input = getElement("sortZip");
    var notice = getElement("sortZipNotice");
    if (input) {
      input.classList.toggle("is-invalid", Boolean(message));
      input.setAttribute("aria-invalid", message ? "true" : "false");
    }
    if (notice) {
      notice.textContent = message || "";
      notice.hidden = !message;
    }
  }

  function applySortZipFromInput() {
    var raw = String((getElement("sortZip") && getElement("sortZip").value) || "").trim();
    var hasFiveDigits = /^\d{5}$/.test(raw);
    var marketStatus = hasFiveDigits ? getZipMarketStatus(raw) : null;
    var isInCalifornia = marketStatus && marketStatus.status === "live";
    var normalized = isInCalifornia ? raw : "";
    sortZip = normalized;
    saveSortZip(normalized);
    var nearZipOption = getElement("sortNearZipOption");
    var sortByEl = getElement("sortBy");
    if (normalized) {
      setSortZipNotice("");
      if (nearZipOption) {
        nearZipOption.hidden = false;
      }
      filters = Object.assign({}, filters, { sortBy: "near_zip" });
      if (sortByEl) {
        sortByEl.value = "near_zip";
      }
      trackFunnelEvent("directory_zip_entered", { zip: normalized });
    } else {
      if (hasFiveDigits && marketStatus && marketStatus.status === "out_of_state") {
        var stateName = (marketStatus.place && marketStatus.place.stateName) || "your state";
        setSortZipNotice("We’re California-only right now, not yet live in " + stateName + ".");
        trackFunnelEvent("directory_zip_rejected", {
          zip: raw,
          reason: "out_of_state",
          state: marketStatus.place && marketStatus.place.state,
        });
      } else if (hasFiveDigits) {
        setSortZipNotice("That ZIP doesn’t look right. Try a California ZIP.");
        trackFunnelEvent("directory_zip_rejected", { zip: raw, reason: "unknown" });
      } else {
        setSortZipNotice("");
      }
      if (nearZipOption) {
        nearZipOption.hidden = true;
      }
      filters = Object.assign({}, filters, { sortBy: "stable_random" });
      if (sortByEl) {
        sortByEl.value = "stable_random";
      }
    }
    currentPage = 1;
    filteredResultsCacheKey = "";
    render();
  }

  function handleSortZipInput() {
    window.clearTimeout(sortZipTimer);
    sortZipTimer = window.setTimeout(applySortZipFromInput, 400);
  }

  function flushSortZipInput() {
    window.clearTimeout(sortZipTimer);
    sortZipTimer = 0;
    applySortZipFromInput();
  }

  function handleFocusBarClick(event) {
    var removeButton = event.target.closest("[data-remove-filter]");
    if (!removeButton) {
      return;
    }

    removeActiveFilter(removeButton.getAttribute("data-remove-filter"));
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

  var loadMoreWrap = getElement("dirLoadMoreWrap");
  if (loadMoreWrap) {
    loadMoreWrap.addEventListener("click", handleLoadMoreClick);
  }

  var sortZipInput = getElement("sortZip");
  if (sortZipInput) {
    sortZipInput.addEventListener("input", handleSortZipInput);
  }

  var detailsBody = getElement("directoryDetailsBody");
  if (detailsBody) {
    detailsBody.addEventListener("click", handleResultsGridClick);
    detailsBody.addEventListener("change", handleResultsGridChange);

    // Bottom sheet delegated interactions
    detailsBody.addEventListener("click", function (event) {
      // Close button rendered inside the sheet
      if (event.target.closest("#directoryDetailsClose")) {
        closeDetailsModal();
        return;
      }

      // Bio read-more / show-less toggle
      var bioToggle = event.target.closest("[data-bio-toggle]");
      if (bioToggle) {
        var bioSlug = bioToggle.getAttribute("data-bio-toggle");
        var bioText = detailsBody.querySelector("#bsh-bio-" + bioSlug);
        var bioFade = detailsBody.querySelector("#bsh-bio-fade-" + bioSlug);
        if (bioText) {
          var expanded = bioText.classList.contains("is-expanded");
          if (expanded) {
            bioText.classList.remove("is-expanded");
            if (bioFade) bioFade.classList.remove("is-hidden");
            bioToggle.textContent = "Read more ↓";
          } else {
            bioText.classList.add("is-expanded");
            if (bioFade) bioFade.classList.add("is-hidden");
            bioToggle.textContent = "Show less ↑";
          }
        }
        return;
      }

      // Insurance: expand ("+N more" chip or "See all plans" button)
      // Both 4-19 and 20+ tiers use [data-ins-collapsed] for the collapsed wrapper.
      var insExpand = event.target.closest("[data-ins-expand]");
      if (insExpand) {
        var insWrap = detailsBody.querySelector(
          '[data-ins-wrap="' + insExpand.getAttribute("data-ins-expand") + '"]',
        );
        if (insWrap) {
          var collapsedRow = insWrap.querySelector("[data-ins-collapsed]");
          var expandedPanel = insWrap.querySelector(".bsh-ins-expanded");
          if (collapsedRow) collapsedRow.hidden = true;
          if (expandedPanel) {
            expandedPanel.hidden = false;
            var searchInput = expandedPanel.querySelector(".bsh-ins-search");
            if (searchInput) searchInput.focus();
          }
        }
        return;
      }

      // Insurance: collapse ("Show less" button)
      var insCollapse = event.target.closest("[data-ins-collapse]");
      if (insCollapse) {
        var insWrap2 = detailsBody.querySelector(
          '[data-ins-wrap="' + insCollapse.getAttribute("data-ins-collapse") + '"]',
        );
        if (insWrap2) {
          var collapsedRow2 = insWrap2.querySelector("[data-ins-collapsed]");
          var expandedPanel2 = insWrap2.querySelector(".bsh-ins-expanded");
          if (collapsedRow2) collapsedRow2.hidden = false;
          if (expandedPanel2) expandedPanel2.hidden = true;
        }
        return;
      }

      // Outreach: copy the drafted first message to clipboard
      var copyBtn = event.target.closest("[data-outreach-copy-message]");
      if (copyBtn) {
        var outreachWrap = copyBtn.closest("[data-bsh-outreach]");
        var copySlug = outreachWrap ? outreachWrap.getAttribute("data-bsh-outreach") : "";
        var messageBody = copyBtn
          .closest(".outreach-script-shell")
          ?.querySelector("[data-outreach-message-body]");
        var text = messageBody ? messageBody.textContent || "" : "";
        if (!text) return;
        var label = copyBtn.querySelector("span");
        var originalLabel = label ? label.textContent : "";
        var markCopied = function (success) {
          if (label) label.textContent = success ? "Copied" : "Copy failed";
          copyBtn.classList.toggle("is-copied", Boolean(success));
          window.setTimeout(function () {
            if (label) label.textContent = originalLabel || "Copy first message";
            copyBtn.classList.remove("is-copied");
          }, 1800);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            function () {
              markCopied(true);
              trackFunnelEvent("outreach_message_copied", {
                surface: "drawer",
                therapist_slug: copySlug,
              });
            },
            function () {
              markCopied(false);
            },
          );
        } else {
          markCopied(false);
        }
        return;
      }

      // Outreach: tel: link click in the phone script
      var callLink = event.target.closest(".outreach-script-call");
      if (callLink && event.target.closest("[data-bsh-outreach]")) {
        var callSlug = event.target
          .closest("[data-bsh-outreach]")
          .getAttribute("data-bsh-outreach");
        trackFunnelEvent("outreach_call_clicked", {
          surface: "drawer",
          therapist_slug: callSlug,
        });
        // do not preventDefault, let the tel: link open
      }

      // Outreach: close button collapses the disclosure
      if (event.target.closest("[data-outreach-close]")) {
        var closeDetails = event.target.closest("details");
        if (closeDetails) closeDetails.open = false;
      }
    });

    // Outreach: track when the disclosure is opened
    detailsBody.addEventListener("toggle", function (event) {
      var details = event.target;
      if (!details || !details.matches || !details.matches("[data-bsh-outreach]")) return;
      if (!details.open) return;
      var slug = details.getAttribute("data-bsh-outreach") || "";
      trackFunnelEvent("outreach_panel_opened", {
        surface: "drawer",
        therapist_slug: slug,
      });
    });

    // See full profile (collapsed card secondary link)
    document.addEventListener("click", function (event) {
      var seeProfileLink = event.target.closest("[data-card-profile-link]");
      if (!seeProfileLink) return;
      trackFunnelEvent("directory_see_profile_clicked", {
        therapist_slug: seeProfileLink.getAttribute("data-card-profile-link") || "",
        source: "card_secondary",
      });
    });

    // Insurance live search filter
    detailsBody.addEventListener("input", function (event) {
      var searchInput = event.target.closest("[data-ins-search]");
      if (!searchInput) return;
      var insSlug = searchInput.getAttribute("data-ins-search");
      var planList = detailsBody.querySelector('[data-ins-plan-list="' + insSlug + '"]');
      if (!planList) return;
      var query = searchInput.value.toLowerCase().trim();
      var pills = planList.querySelectorAll(".bsh-ins-pill");
      pills.forEach(function (pill) {
        var name = pill.getAttribute("data-plan-name") || "";
        pill.hidden = Boolean(query && !name.includes(query));
      });
    });
  }

  // Drag-to-dismiss on mobile: swipe the drag pill down to close
  var dragPill = document.querySelector(".dir-panel-drag-pill-wrap");
  var dragDialog = getElement("directoryDetailsModal");
  if (dragPill && dragDialog) {
    var dragStartY = 0;
    dragPill.addEventListener(
      "touchstart",
      function (event) {
        dragStartY = event.touches[0].clientY;
      },
      { passive: true },
    );
    dragPill.addEventListener(
      "touchend",
      function (event) {
        var delta = event.changedTouches[0].clientY - dragStartY;
        if (delta > 60) closeDetailsModal();
      },
      { passive: true },
    );
  }

  // Desktop close button lives in the static panel head (always in DOM)
  var detailsCloseDesktop = getElement("directoryDetailsCloseDesktop");
  if (detailsCloseDesktop) {
    detailsCloseDesktop.addEventListener("click", closeDetailsModal);
  }

  var detailsScrim = getElement("directoryDetailsScrim");
  if (detailsScrim) {
    detailsScrim.addEventListener("click", closeDetailsModal);
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
      // Also fire on change so programmatic edits (paste-then-blur,
      // assistive tech, autofill) commit. scheduleLiveFilters debounces,
      // so user-typing won't double-trigger.
      input.addEventListener("change", scheduleLiveFilters);
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

  var sortByEl = getElement("sortBy");
  if (sortByEl) {
    sortByEl.addEventListener("change", function () {
      var nextState = changeDirectorySortAction({
        filters: filters,
        sortBy: sortByEl.value,
      });
      filters = nextState.filters;
      currentPage = 1;
      syncRankingLocationFromUserZip();
      trackFunnelEvent("directory_sort_changed", { sort_by: filters.sortBy });
      filteredResultsCacheKey = "";
      render();
    });
  }

  window.addEventListener("resize", scheduleViewportSync);

  var filtersOpenButton = getElement("dirVbModalOpen");
  if (filtersOpenButton) {
    filtersOpenButton.addEventListener("click", function () {
      trackFunnelEvent("directory_filters_opened", {
        active_filter_count: countActiveFilters(filters),
      });
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && activeDetailsSlug) {
      closeDetailsModal();
      return;
    }

    if (event.key === "Tab" && activeDetailsSlug) {
      var dialog = getElement("directoryDetailsModal");
      if (!dialog || dialog.hidden) return;
      var focusable = Array.from(
        dialog.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(function (el) {
        return !el.hidden && el.offsetParent !== null;
      });
      if (focusable.length < 2) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (
      event.key === "Enter" &&
      (event.target.tagName === "INPUT" || event.target.tagName === "SELECT")
    ) {
      if (event.target.id === "sortZip") {
        flushSortZipInput();
        return;
      }
      applyFilters();
    }
  });

  applySiteSettings();
  applyDirectoryCopy();
  await preloadZipcodes();
  stableOrderMap = buildStableOrderMap(therapists);
  initializeFilters();
  initSortZip();
  initImpressionObserver();
  syncSidebarForViewport();
  trackFunnelEvent("directory_viewed", {
    therapist_count: therapists.length,
  });
  render();
  ensureIpRankingLocation().then(function (didUpdate) {
    if (didUpdate) {
      render();
    }
  });
})();
