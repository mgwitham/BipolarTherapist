import { fetchDirectoryPageContent } from "./cms.js";
import {
  readFunnelEvents,
  rememberTherapistContactRoute,
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
import { compareTherapistsWithFilters, matchesDirectoryFilters } from "./directory-logic.js";

var DIRECTORY_LIST_LIMIT = 50;
import {
  renderDirectoryRecommendationsMarkup,
  renderCardMarkup,
  renderDirectoryDetailsMarkup,
  renderEmptyStateMarkup,
  renderPaginationMarkup,
} from "./directory-render.js";
import {
  buildCardViewModel,
  buildDirectoryDetailsViewModel,
  buildDirectoryRecommendationModel,
} from "./directory-view-model.js";
import { initValuePillPopover } from "./therapist-pills.js";
import { lookupZipPlace, preloadZipcodes } from "./zip-lookup.js";

(async function () {
  initValuePillPopover();
  var DIRECTORY_SHORTLIST_KEY = "bth_directory_shortlist_v1";
  var content = await fetchDirectoryPageContent();
  var therapists = content.therapists || [];
  var directoryPage = content.directoryPage || null;
  var siteSettings = content.siteSettings || null;
  var currentPage = 1;
  var pageSize = 12;
  var activePreviewSlug = "";
  var activeDetailsSlug = "";
  var lastDetailsTrigger = null;
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
    therapist: true,
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
      var regionCode = String((payload && payload.region_code) || "").trim().toUpperCase();
      var countryCode = String((payload && payload.country_code) || "").trim().toUpperCase();
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

  function buildRecommendationPresentation() {
    var rankingSource = String(filters.ranking_source || "");
    var rankingLabel = String(filters.ranking_label || "");

    if (rankingSource === "explicit_zip" && rankingLabel) {
      return {
        kicker: "Strong starting options near " + rankingLabel,
        context: "Based on the zip you entered.",
      };
    }

    if (rankingSource === "ip" && rankingLabel) {
      return {
        kicker: "Strong starting options near " + rankingLabel,
        context: "Based on your general area. You can change this anytime.",
      };
    }

    return {
      kicker: "Strong starting options",
      context:
        "Starting with therapists only. Use location or filters to narrow this list if you want something closer.",
    };
  }

  function buildFilterCacheKey(filterState) {
    return FILTER_VALUE_KEYS.concat(FILTER_BOOLEAN_KEYS, [
      "explicit_zip",
      "ranking_zip",
      "ranking_label",
      "ranking_source",
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

  function uniqueCounts(field, _nested) {
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

    syncFilterControlsFromState(filters, getElement);
    syncRankingLocationFromUserZip();
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

  function getFiltered() {
    return getFilteredWithFilters(filters);
  }

  function getTherapistBySlug(slug) {
    return therapists.find(function (therapist) {
      return therapist.slug === slug;
    });
  }

  function renderDirectoryRecommendations(renderState) {
    var root = getElement("directoryRecommendationZone");
    if (!root) {
      return;
    }

    root.innerHTML = renderDirectoryRecommendationsMarkup({
      model: buildDirectoryRecommendationModel({
        featuredTherapist: renderState.featuredTherapist,
        backupTherapists: renderState.backupTherapists,
        filters: filters,
        shortlist: shortlist,
        isShortlisted: isShortlisted,
        presentation: buildRecommendationPresentation(),
      }),
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
      return;
    }

    var therapist = getTherapistBySlug(slug);
    if (!therapist) {
      body.innerHTML = "";
      dialog.setAttribute("aria-hidden", "true");
      return;
    }

    body.innerHTML = renderDirectoryDetailsMarkup({
      model: buildDirectoryDetailsViewModel({
        therapist: therapist,
        filters: filters,
        shortlist: shortlist,
        isShortlisted: isShortlisted,
      }),
    });
    dialog.setAttribute("aria-hidden", "false");
  }

  function openDetailsModal(slug, trigger) {
    var dialog = getElement("directoryDetailsModal");
    var scrim = getElement("directoryDetailsScrim");
    var closeButton = getElement("directoryDetailsClose");
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

    if (!renderState.results.length) {
      renderResultsGrid([]);
    } else if (!renderState.pageItems.length) {
      renderBrowseEmptyState();
    } else {
      renderResultsGrid(renderState.pageItems);
    }
    renderPagination(renderState.browseResults.length);
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

    if (!results.length) {
      renderDirectoryRecommendations(renderState);
      renderResultsGrid([]);
      renderPagination(0);
      updateUrl();
      return;
    }

    activePreviewSlug = renderState.activePreviewSlug;
    renderDirectoryRecommendations(renderState);
    if (!pageItems.length) {
      renderBrowseEmptyState();
    } else {
      renderResultsGrid(pageItems);
    }
    pulsePendingCard();
    renderPagination(renderState.browseResults.length);
    updateUrl();
  }

  function refreshShortlistViews() {
    var results = getFiltered();
    var renderState = buildDirectoryRenderState({
      results: results,
      currentPage: currentPage,
      pageSize: pageSize,
      filters: filters,
      directoryPage: directoryPage,
      activePreviewSlug: activePreviewSlug,
    });
    renderDirectoryRecommendations(renderState);
    renderCurrentPageOnly(results);
    renderDetailsModal(activeDetailsSlug);
  }

  function applyFilters() {
    var nextState = applyDirectoryFiltersAction({
      filters: filters,
      getElement: getElement,
    });
    filters = nextState.filters;
    currentPage = nextState.currentPage;
    syncRankingLocationFromUserZip();
    trackFunnelEvent("directory_filters_applied", {
      active_filter_count: countActiveFilters(filters),
      sort_by: filters.sortBy,
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
    currentPage = nextState.currentPage;
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
    currentPage = nextState.currentPage;
    syncFilterControlsFromState(filters, getElement);
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
      toggleShortlist(shortlistSlug);
      refreshShortlistViews();
      return;
    }

    var detailsButton = event.target.closest("[data-view-details]");
    if (detailsButton) {
      openDetailsModal(detailsButton.getAttribute("data-view-details"), detailsButton);
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
      trackFunnelEvent("directory_" + ctaTier + "_contact_cta_clicked", {
        therapist_slug: primarySlug,
        sort_by: filters.sortBy,
      });
      return;
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
    trackFunnelEvent("directory_paginated_results", {
      page: currentPage,
      sort_by: filters.sortBy,
    });
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

  function handleRecommendationClick(event) {
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

    var backupShortlistButton = event.target.closest(".directory-backup-card [data-shortlist-slug]");
    if (backupShortlistButton) {
      var backupSlug = backupShortlistButton.getAttribute("data-shortlist-slug");
      if (!backupSlug) {
        return;
      }
      pendingMotionSlug = backupSlug;
      toggleShortlist(backupSlug);
      refreshShortlistViews();
      return;
    }

    var detailsButton = event.target.closest("[data-view-details]");
    if (detailsButton) {
      openDetailsModal(detailsButton.getAttribute("data-view-details"), detailsButton);
      return;
    }

    var primaryLink = event.target.closest("[data-primary-cta]");
    if (primaryLink) {
      var slug = primaryLink.getAttribute("data-primary-cta");
      var tier = primaryLink.getAttribute("data-cta-tier") || "featured";
      rememberTherapistContactRoute(slug, primaryLink.getAttribute("href"), "directory_" + tier);
      trackFunnelEvent("directory_" + tier + "_contact_cta_clicked", {
        therapist_slug: slug,
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

  var recommendationZone = getElement("directoryRecommendationZone");
  if (recommendationZone) {
    recommendationZone.addEventListener("click", handleRecommendationClick);
  }

  var detailsBody = getElement("directoryDetailsBody");
  if (detailsBody) {
    detailsBody.addEventListener("click", handleResultsGridClick);
    detailsBody.addEventListener("change", handleResultsGridChange);
  }

  var detailsClose = getElement("directoryDetailsClose");
  if (detailsClose) {
    detailsClose.addEventListener("click", closeDetailsModal);
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

  getElement("sortBy").addEventListener("change", function () {
    var nextState = changeDirectorySortAction({
      filters: filters,
      sortBy: getElement("sortBy").value,
    });
    filters = nextState.filters;
    currentPage = nextState.currentPage;
    syncRankingLocationFromUserZip();
    trackFunnelEvent("directory_sort_changed", {
      sort_by: filters.sortBy,
    });
    render();
  });

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
    if (
      event.key === "Enter" &&
      (event.target.tagName === "INPUT" || event.target.tagName === "SELECT")
    ) {
      applyFilters();
    }
  });

  applySiteSettings();
  applyDirectoryCopy();
  await preloadZipcodes();
  initializeFilters();
  syncSidebarForViewport();
  render();
  ensureIpRankingLocation().then(function (didUpdate) {
    if (didUpdate) {
      render();
    }
  });
})();
