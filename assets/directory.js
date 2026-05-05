import { fetchDirectoryPageContent } from "./cms.js";
import { rememberTherapistContactRoute, trackFunnelEvent } from "./funnel-analytics.js";
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
  renderDirectoryDetailsMarkup,
  renderBottomSheetMarkup,
  renderEmptyStateMarkup,
  renderLoadMoreMarkup,
} from "./directory-render.js";
import { buildCardViewModel, buildDirectoryDetailsViewModel } from "./directory-view-model.js";
import { initValuePillPopover } from "./therapist-pills.js";
import { lookupZipPlace, preloadZipcodes } from "./zip-lookup.js";
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
  var visibleCount = 24;
  var activeDetailsSlug = "";
  var lastDetailsTrigger = null;
  var stableOrderMap = null;
  var sortZip = "";
  var DIRECTORY_IP_LOCATION_CACHE_KEY = "bth_directory_ip_location_v1";
  var DIRECTORY_IP_LOCATION_TTL_MS = 12 * 60 * 60 * 1000;
  var defaultFilters = {
    state: "CA",
    zip: "",
    explicit_zip: "",
    ranking_zip: "",
    ranking_label: "",
    ranking_source: "",
    specialty: "",
    modality: "",
    population: "",
    bipolar_experience: "",
    insurance: "",
    gender: "",
    therapist: false,
    psychiatrist: false,
    telehealth: false,
    in_person: false,
    accepting: false,
    medication_management: false,
    responsive_contact: false,
    recently_confirmed: false,
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

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

  function writeCachedIpLocation(value) {
    try {
      window.localStorage.setItem(
        DIRECTORY_IP_LOCATION_CACHE_KEY,
        JSON.stringify({
          cached_at: Date.now(),
          zip: value.zip,
          label: value.label,
        }),
      );
    } catch (_error) {
      return;
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

    if (typeof window === "undefined" || typeof window.fetch !== "function") {
      return null;
    }

    try {
      var controller =
        typeof window.AbortController === "function" ? new window.AbortController() : null;
      var timeoutId = controller
        ? window.setTimeout(function () {
            controller.abort();
          }, 2500)
        : 0;
      var response = await window.fetch("https://ipapi.co/json/", {
        signal: controller ? controller.signal : undefined,
      });
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      if (!response.ok) {
        return null;
      }

      var payload = await response.json();
      var ipZip = normalizeZip(payload && payload.postal);
      var regionCode = String((payload && payload.region_code) || "")
        .trim()
        .toUpperCase();
      var countryCode = String((payload && payload.country_code) || "")
        .trim()
        .toUpperCase();
      if (!ipZip || regionCode !== "CA" || countryCode !== "US") {
        return null;
      }

      var label = getRankingLocationLabel(
        ipZip,
        [payload.city, regionCode].filter(Boolean).join(", "),
      );
      var result = {
        zip: ipZip,
        label: label,
      };
      writeCachedIpLocation(result);
      return result;
    } catch (_error) {
      return null;
    }
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
    if (filters.gender) {
      chips.push({
        key: "gender",
        label: filters.gender === "male" ? "Male therapist" : "Female therapist",
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
    visibleCount = 24;
    syncFilterControlsFromState(filters, getElement);
    syncInsuranceDisplay();
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
      var sortByInput = getElement("sortBy");
      if (sortByInput) {
        sortByInput.value = filters.sortBy;
      }
    }

    syncFilterControlsFromState(filters, getElement);
    syncInsuranceDisplay();
    syncRankingLocationFromUserZip();
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
    var query = params.toString();
    var basePath = window.location.pathname.replace(/\/$/, "") || "/directory";
    var next = query ? basePath + "?" + query : basePath;
    window.history.replaceState({}, "", next);
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
      grid.innerHTML = renderEmptyStateMarkup(directoryPage);
      return;
    }

    grid.innerHTML = pageItems.map(renderCard).join("");
  }

  function renderBrowseEmptyState() {
    var grid = getElement("resultsGrid");
    if (!grid) {
      return;
    }

    grid.innerHTML =
      '<section class="directory-browse-empty"><div class="directory-browse-empty-kicker">More options</div><h3>You already have the strongest options at the top.</h3><p>Start with one of those therapists first. You can still change filters or come back for more results later.</p></section>';
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

    // Set aria-label directly on the dialog — aria-labelledby can't be used because
    // the heading element is inside .dir-panel-head which is display:none on mobile.
    var displayName = therapist.name.split(",")[0].trim();
    var credSuffix = therapist.credentials ? ", " + therapist.credentials : "";
    dialog.setAttribute("aria-label", displayName + credSuffix + " — Provider details");

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

    var activeCard = grid.querySelector('[data-card-slug="' + pendingMotionSlug + '"]');
    if (activeCard) {
      activeCard.classList.remove("motion-pulse");
      void activeCard.offsetWidth;
      activeCard.classList.add("motion-pulse");
    }
    pendingMotionSlug = "";
  }

  function renderLoadMore(hasMore) {
    var wrap = getElement("dirLoadMoreWrap");
    if (!wrap) {
      return;
    }
    wrap.innerHTML = hasMore ? renderLoadMoreMarkup() : "";
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
          " bipolar-informed therapists and psychiatrists in California. Filter by location, insurance, and format.",
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
      visibleCount: visibleCount,
      filters: getFilters(),
      directoryPage: directoryPage,
    });

    if (!renderState.results.length) {
      renderResultsGrid([]);
    } else {
      renderResultsGrid(renderState.pageItems);
    }
    renderLoadMore(renderState.hasMore);
    pulsePendingCard();
    observeCards(getElement("resultsGrid"));
  }

  function render() {
    var currentFilters = getFilters();
    var renderState = buildDirectoryRenderState({
      results: getFilteredWithFilters(currentFilters),
      visibleCount: visibleCount,
      filters: currentFilters,
      directoryPage: directoryPage,
    });
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
      renderLoadMore(false);
      updateUrl();
      return;
    }

    renderResultsGrid(pageItems);
    pulsePendingCard();
    renderLoadMore(renderState.hasMore);
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
    var btns = body.querySelectorAll('[data-shortlist-slug="' + slug + '"]');
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
    visibleCount = 24;
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
    visibleCount = 24;
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

  function resetFilters() {
    var nextState = resetDirectoryFiltersAction(defaultFilters);
    filters = nextState.filters;
    visibleCount = 24;
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

    // Card body click — open side panel (only when not clicking interactive elements)
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
    var btn = event.target.closest("#dirLoadMoreBtn");
    if (!btn) {
      return;
    }
    visibleCount += 24;
    trackFunnelEvent("directory_load_more_clicked", {
      visible_count: visibleCount,
      sort_by: filters.sortBy,
    });
    renderCurrentPageOnly(getFiltered());
  }

  var sortZipTimer = 0;

  function applySortZipFromInput() {
    var raw = String((getElement("sortZip") && getElement("sortZip").value) || "").trim();
    var normalized = /^\d{5}$/.test(raw) ? raw : "";
    sortZip = normalized;
    saveSortZip(normalized);
    var nearZipOption = getElement("sortNearZipOption");
    var sortByEl = getElement("sortBy");
    if (normalized) {
      if (nearZipOption) {
        nearZipOption.hidden = false;
      }
      filters = Object.assign({}, filters, { sortBy: "near_zip" });
      if (sortByEl) {
        sortByEl.value = "near_zip";
      }
      trackFunnelEvent("directory_zip_entered", { zip: normalized });
    } else {
      if (nearZipOption) {
        nearZipOption.hidden = true;
      }
      filters = Object.assign({}, filters, { sortBy: "stable_random" });
      if (sortByEl) {
        sortByEl.value = "stable_random";
      }
    }
    visibleCount = 24;
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
        // do not preventDefault — let the tel: link open
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
      visibleCount = 24;
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
