import { fetchDirectoryPageContent } from "./cms.js";
import {
  readFunnelEvents,
  summarizeDirectoryProfileOpenQuality,
  summarizeAdaptiveSignals,
  trackFunnelEvent,
} from "./funnel-analytics.js";
import {
  FILTER_BOOLEAN_KEYS,
  FILTER_VALUE_KEYS,
  countActiveFilters,
  readFilterStateFromControls,
  syncFilterControlsFromState,
} from "./directory-filters.js";
import {
  applyDirectoryFiltersAction,
  buildDirectoryRenderState,
  changeDirectorySortAction,
  resetDirectoryFiltersAction,
} from "./directory-controller.js";
import {
  buildCardFitSummary,
  buildDirectoryStrategySegments,
  compareTherapistsWithFilters,
  getDirectoryStrategyAudience,
  getEditorialLaneCandidates,
  getFreshnessRank,
  getMatchScore,
  matchesDirectoryFilters,
  getResponsivenessRank,
} from "./directory-logic.js";
import {
  renderDirectoryDecisionPreviewMarkup,
  renderCardMarkup,
  renderEmptyStateMarkup,
  renderPaginationMarkup,
  renderShortlistBarMarkup,
} from "./directory-render.js";
import {
  buildCardViewModel,
  buildDirectoryDecisionPreviewModel,
  buildShortlistBarViewModel,
} from "./directory-view-model.js";

(async function () {
  var DIRECTORY_SHORTLIST_KEY = "bth_directory_shortlist_v1";
  var OUTREACH_OUTCOMES_KEY = "bth_outreach_outcomes_v1";
  var SHORTLIST_PRIORITY_OPTIONS = ["Best fit", "Best availability", "Best value"];
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
    q: "",
    state: "CA",
    city: "",
    specialty: "",
    modality: "",
    population: "",
    verification: "",
    bipolar_experience: "",
    insurance: "",
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

  function getElement(id) {
    return document.getElementById(id);
  }

  function renderDirectoryAdaptiveExplainer() {
    var root = getElement("directoryAdaptiveExplainer");
    if (!root) {
      return;
    }

    var adaptiveSignals = summarizeAdaptiveSignals(
      readFunnelEvents(),
      [],
      buildDirectoryStrategySegments(filters),
    );
    var basis =
      adaptiveSignals.match_action_basis === "outcomes"
        ? "what has worked best"
        : "how people tend to move";
    var audience = getDirectoryStrategyAudience(filters);
    var emphasis =
      filters.sortBy === "soonest_availability"
        ? "leaning a little harder on speed and easier follow-through"
        : filters.sortBy === "most_responsive"
          ? "leaning a little harder on contact responsiveness"
          : filters.sortBy === "most_experienced"
            ? "leaning a little harder on bipolar-specific depth"
            : filters.sortBy === "lowest_fee"
              ? "leaning a little harder on fee visibility"
              : "balancing reviewed details, fit, and decision-readiness";

    root.textContent =
      "For " +
      audience +
      ", the directory is currently " +
      emphasis +
      ". That emphasis is guided by " +
      basis +
      " in similar browsing patterns, with a California-first launch focus.";
  }

  function renderDirectoryLaunchExplainer(results) {
    var root = getElement("directoryLaunchExplainer");
    if (!root) {
      return;
    }

    var activeFilterCount = countActiveFilters(filters);
    var prioritySet = new Set(matchPrioritySlugs);
    var visiblePriorityCount = (results || []).filter(function (therapist) {
      return prioritySet.has(therapist.slug);
    }).length;

    if (activeFilterCount > 1 || filters.sortBy !== "best_match") {
      root.textContent =
        "Once you add stronger filters or change the sort, the directory leans much harder on your choices than on any launch-level curation.";
      return;
    }

    if (!visiblePriorityCount) {
      root.textContent =
        "The strongest profiles here still rise on reviewed details, fit, and next-step clarity, even when no launch-priority profile is in view.";
      return;
    }

    root.textContent =
      visiblePriorityCount +
      " profile" +
      (visiblePriorityCount === 1 ? " is" : "s are") +
      " currently getting a light visibility boost because the profile looks especially strong on reviewed details, decision-readiness, and contact clarity. That boost only matters when options are already close.";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

  function readShortlist() {
    try {
      return normalizeShortlist(
        JSON.parse(window.localStorage.getItem(DIRECTORY_SHORTLIST_KEY) || "[]"),
      );
    } catch (_error) {
      return [];
    }
  }

  function readOutreachOutcomes() {
    try {
      return JSON.parse(window.localStorage.getItem(OUTREACH_OUTCOMES_KEY) || "[]");
    } catch (_error) {
      return [];
    }
  }

  function getShortlistOutreachProgress() {
    var slugs = shortlist.map(function (item) {
      return item.slug;
    });
    if (!slugs.length) {
      return {
        hasProgress: false,
        summary: "",
        nextSlug: "",
      };
    }

    var latestBySlug = {};
    readOutreachOutcomes().forEach(function (item) {
      if (!item || !item.therapist_slug || !slugs.includes(item.therapist_slug)) {
        return;
      }
      if (!latestBySlug[item.therapist_slug]) {
        latestBySlug[item.therapist_slug] = item;
      }
    });

    var touchedCount = Object.keys(latestBySlug).length;
    var nextSlug = slugs.find(function (slug) {
      var outcome = latestBySlug[slug];
      return (
        !outcome ||
        ["no_response", "waitlist", "insurance_mismatch"].indexOf(String(outcome.outcome || "")) !==
          -1
      );
    });
    var completedCount = slugs.filter(function (slug) {
      var outcome = latestBySlug[slug];
      return (
        outcome &&
        ["heard_back", "booked_consult", "good_fit_call"].indexOf(String(outcome.outcome || "")) !==
          -1
      );
    }).length;

    return {
      hasProgress: touchedCount > 0,
      nextSlug: nextSlug || "",
      summary:
        touchedCount > 0
          ? completedCount
            ? completedCount +
              " showing real follow-through so far. Resume the queue with " +
              (nextSlug ? getTherapistName(nextSlug) : "your next strongest option") +
              "."
            : "You already started outreach here. Resume with " +
              (nextSlug ? getTherapistName(nextSlug) : "your next strongest option") +
              "."
          : "",
    };
  }

  function getTherapistName(slug) {
    var therapist = therapists.find(function (item) {
      return item.slug === slug;
    });
    return therapist ? therapist.name : "your next therapist";
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
      .slice(0, 3);
  }

  function writeShortlist(value) {
    shortlist = value;
    try {
      window.localStorage.setItem(DIRECTORY_SHORTLIST_KEY, JSON.stringify(value));
    } catch (_error) {
      return;
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
    writeShortlist(shortlist.concat({ slug: slug, priority: "", note: "" }).slice(0, 3));
    return true;
  }

  function updateShortlistPriority(slug, priority) {
    writeShortlist(
      shortlist.map(function (item) {
        if (item.slug !== slug) {
          return item;
        }

        return {
          slug: item.slug,
          priority: priority,
          note: item.note || "",
        };
      }),
    );
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

  function buildCompareUrl() {
    if (!shortlist.length) {
      return "match.html";
    }

    return (
      "match.html?shortlist=" +
      encodeURIComponent(
        shortlist
          .map(function (item) {
            return item.slug;
          })
          .join(","),
      )
    );
  }

  function buildOutreachQueueUrl() {
    if (!shortlist.length) {
      return "match.html";
    }

    return buildCompareUrl() + "&entry=directory_shortlist_queue";
  }

  function applyDirectoryCopy() {
    if (!directoryPage) {
      return;
    }

    var mappings = [
      ["directoryHeroTitle", "heroTitle"],
      ["directoryHeroDescription", "heroDescription"],
      ["searchPanelTitle", "searchPanelTitle"],
      ["searchLabelText", "searchLabel"],
      ["locationPanelTitle", "locationPanelTitle"],
      ["stateLabelText", "stateLabel"],
      ["cityLabelText", "cityLabel"],
      ["specialtyPanelTitle", "specialtyPanelTitle"],
      ["specialtyLabelText", "specialtyLabel"],
      ["insurancePanelTitle", "insurancePanelTitle"],
      ["insuranceLabelText", "insuranceLabel"],
      ["optionsPanelTitle", "optionsPanelTitle"],
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

    var keywordInput = getElement("q");
    var cityInput = getElement("city");
    if (keywordInput && directoryPage.searchPlaceholder) {
      keywordInput.placeholder = directoryPage.searchPlaceholder;
    }
    if (cityInput && directoryPage.cityPlaceholder) {
      cityInput.placeholder = directoryPage.cityPlaceholder;
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

  function uniqueCounts(field, nested) {
    var counts = new Map();
    therapists.forEach(function (therapist) {
      var values = nested ? therapist[field] || [] : [therapist[field]];
      values.forEach(function (value) {
        if (!value) {
          return;
        }
        counts.set(value, (counts.get(value) || 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .sort(function (a, b) {
        return String(a[0]).localeCompare(String(b[0]));
      })
      .map(function (entry) {
        return { value: entry[0], count: entry[1] };
      });
  }

  function getConfiguredItems(field, nested) {
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
      var count = therapists.filter(function (therapist) {
        if (field === "curatedStates") {
          return therapist.state === value;
        }
        if (field === "curatedSpecialties") {
          return (therapist.specialties || []).includes(value);
        }
        return (therapist.insurance_accepted || []).includes(value);
      }).length;

      return {
        value: value,
        count: count,
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
        filters[key] = params.get(key);
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
      filters.sortBy = adaptiveSignals.preferred_directory_sort || defaultFilters.sortBy;
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
  function renderEditorialLanes(results) {
    var root = getElement("editorialLanes");
    if (!root) {
      return;
    }

    var hasActiveFilters = countActiveFilters(filters) > 0;

    if (hasActiveFilters || !results.length) {
      root.innerHTML = "";
      return;
    }

    root.innerHTML = getEditorialLaneCandidates(results)
      .slice(0, 3)
      .map(function (lane) {
        var laneCue =
          lane.title === "Fastest next step"
            ? "This lane is especially useful when availability and a lower-friction next move matter most."
            : lane.title === "Strongest psychiatry option"
              ? "This lane is especially useful when medication support or psychiatry coordination may matter."
              : "This lane is especially useful when you want a therapy-first option with stronger bipolar detail.";
        return (
          '<div class="editorial-lane"><div class="editorial-lane-title">' +
          escapeHtml(lane.title) +
          '</div><div class="editorial-lane-name">' +
          escapeHtml(lane.therapist.name) +
          '</div><div class="editorial-lane-copy">' +
          escapeHtml(lane.copy) +
          " " +
          escapeHtml(buildCardFitSummary(filters, lane.therapist)) +
          " " +
          escapeHtml(laneCue) +
          '</div><a class="editorial-lane-link" href="therapist.html?slug=' +
          encodeURIComponent(lane.therapist.slug) +
          '">View profile →</a></div>'
        );
      })
      .join("");
  }

  function getFilteredWithFilters(filterState) {
    return applyDirectoryPriorityProminence(
      therapists.filter(function (therapist) {
        return matchesDirectoryFilters(filterState, therapist);
      }),
      filterState,
    );
  }

  function getFiltered() {
    return getFilteredWithFilters(filters);
  }

  function buildDirectoryTradeoffScenarios(results) {
    var scenarios = [];
    var baseTop = results[0] || null;

    function add(label, nextFilters, builder) {
      var nextResults = getFilteredWithFilters(nextFilters);
      if (!nextResults.length) {
        return;
      }
      scenarios.push({
        label: label,
        body: builder(nextResults[0], nextResults),
      });
    }

    if (filters.sortBy !== "soonest_availability") {
      add(
        "If you sort for speed instead",
        Object.assign({}, filters, { sortBy: "soonest_availability" }),
        function (topTherapist) {
          return topTherapist.name === (baseTop && baseTop.name)
            ? "The top result would stay fairly stable, which suggests your current leaders already look relatively strong on availability."
            : topTherapist.name +
                " would likely rise because the directory would lean harder on wait time, accepting-new-patient status, and lower-friction next steps.";
        },
      );
    }

    if (!filters.medication_management) {
      add(
        "If you require medication support",
        Object.assign({}, filters, { medication_management: true }),
        function (topTherapist, nextResults) {
          return (
            nextResults.length +
            " profiles would remain, led by " +
            topTherapist.name +
            ", because the field would narrow to therapists who offer medication management."
          );
        },
      );
    }

    if (!filters.responsive_contact) {
      add(
        "If you prioritize responsive contact",
        Object.assign({}, filters, { responsive_contact: true }),
        function (topTherapist, nextResults) {
          return (
            nextResults.length +
            " profiles would remain, and " +
            topTherapist.name +
            " would likely rise because the directory would filter for therapists with early reply signals."
          );
        },
      );
    }

    if (!filters.recently_confirmed) {
      add(
        "If you require recently confirmed details",
        Object.assign({}, filters, { recently_confirmed: true, sortBy: "freshest_details" }),
        function (topTherapist, nextResults) {
          return (
            nextResults.length +
            " profiles would remain, and " +
            topTherapist.name +
            " would likely rise because the directory would narrow toward fresher confirmation signals."
          );
        },
      );
    }

    if (!filters.verification) {
      add(
        "If you narrow to editorially verified profiles",
        Object.assign({}, filters, { verification: "editorially_verified" }),
        function (topTherapist, nextResults) {
          return (
            nextResults.length +
            " verified profiles would remain, with " +
            topTherapist.name +
            " likely leading the field on trust and completeness."
          );
        },
      );
    }

    return scenarios.slice(0, 2);
  }

  function renderDirectoryTradeoffPreview(results) {
    var root = getElement("directoryTradeoffPreview");
    if (!root) {
      return;
    }

    var list = Array.isArray(results) ? results : [];
    var scenarios = buildDirectoryTradeoffScenarios(list);
    var handoffQuality = summarizeDirectoryProfileOpenQuality(readFunnelEvents());
    var handoffPreference = getDirectoryHandoffPreference(handoffQuality);
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
            handoffPreference: handoffPreference,
          }),
        })
      : "";

    root.classList.toggle("is-empty", !previewMarkup && !scenarios.length);
    root.innerHTML =
      previewMarkup +
      (scenarios.length
        ? '<div class="results-explainer-title">How a change would likely reshape the top results</div><div class="directory-tradeoff-grid">' +
          scenarios
            .map(function (item) {
              return (
                '<div class="directory-tradeoff-card"><strong>' +
                escapeHtml(item.label) +
                "</strong><span>" +
                escapeHtml(item.body) +
                "</span></div>"
              );
            })
            .join("") +
          "</div>"
        : "");
  }

  function getDirectoryHandoffPreference(qualitySummary) {
    var rows = qualitySummary && Array.isArray(qualitySummary.rows) ? qualitySummary.rows : [];
    var leader = rows[0] || null;
    if (!leader || leader.opens < 2) {
      return {
        label: "Open this profile first",
        note: "This preview is designed to help you open the strongest profile with more confidence, not more browsing.",
      };
    }
    if (leader.source === "preview") {
      return {
        label: "Best preview-led handoff",
        note: "Preview opens are currently sending users into the strongest profiles most often, so this preview is taking the lead.",
      };
    }
    if (leader.source === "card_primary") {
      return {
        label: "Best action-led handoff",
        note: "Direct action clicks are currently landing users in stronger profiles most often, so this preview is staying tightly action-focused.",
      };
    }
    if (leader.source === "card_profile") {
      return {
        label: "Best profile-led handoff",
        note: "Profile review opens are currently landing users in stronger profiles most often, so this preview is optimized to support deeper review.",
      };
    }
    return {
      label: "Open this profile first",
      note: qualitySummary && qualitySummary.interpretation ? qualitySummary.interpretation : "",
    };
  }

  function renderCard(therapist) {
    return renderCardMarkup({
      model: buildCardViewModel({
        therapist: therapist,
        filters: filters,
        shortlist: shortlist,
        shortlistPriorityOptions: SHORTLIST_PRIORITY_OPTIONS,
        isShortlisted: isShortlisted,
      }),
    });
  }

  function renderShortlistBar() {
    var root = getElement("directoryShortlistBar");
    if (!root) {
      return;
    }
    var markup = renderShortlistBarMarkup({
      model: buildShortlistBarViewModel({
        shortlist: shortlist,
        therapists: therapists,
        filters: filters,
        buildCompareUrl: buildCompareUrl,
        buildOutreachQueueUrl: buildOutreachQueueUrl,
        outreachProgress: getShortlistOutreachProgress(),
      }),
    });

    root.innerHTML = markup.html;

    var clearButton = getElement("clearDirectoryShortlist");
    if (clearButton) {
      clearButton.addEventListener("click", function () {
        writeShortlist([]);
        render();
      });
    }

    root.querySelectorAll("[data-start-outreach-queue]").forEach(function (link) {
      link.addEventListener("click", function () {
        trackFunnelEvent("directory_outreach_queue_started", {
          shortlist_size: shortlist.length,
          therapist_slugs: shortlist.map(function (item) {
            return item.slug;
          }),
          lead_slug: link.getAttribute("data-queue-lead-slug") || "",
        });
      });
    });
  }

  function renderPagination(total) {
    var pages = Math.ceil(total / pageSize);
    var root = getElement("pagination");
    root.innerHTML = renderPaginationMarkup(currentPage, pages);
    if (pages <= 1) {
      return;
    }
    root.querySelectorAll("[data-page]").forEach(function (button) {
      button.addEventListener("click", function () {
        currentPage = Number(button.getAttribute("data-page"));
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
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

    if (!pageItems.length) {
      grid.innerHTML = renderEmptyStateMarkup(directoryPage);
      renderDirectoryTradeoffPreview([]);
      renderEditorialLanes([]);
      renderDirectoryLaunchExplainer([]);
      renderDirectoryAdaptiveExplainer();
      renderPagination(0);
      renderShortlistBar();
      updateUrl();
      return;
    }

    activePreviewSlug = renderState.activePreviewSlug;
    renderDirectoryTradeoffPreview(results);
    renderEditorialLanes(results);
    renderDirectoryLaunchExplainer(results);
    renderDirectoryAdaptiveExplainer();
    grid.innerHTML = pageItems.map(renderCard).join("");
    if (pendingMotionSlug) {
      var activeCard = grid.querySelector('[data-card-slug="' + pendingMotionSlug + '"]');
      if (activeCard) {
        activeCard.classList.remove("motion-pulse");
        void activeCard.offsetWidth;
        activeCard.classList.add("motion-pulse");
      }
      var shortlistBar = getElement("directoryShortlistBar");
      if (shortlistBar) {
        shortlistBar.classList.remove("motion-enter");
        void shortlistBar.offsetWidth;
        shortlistBar.classList.add("motion-enter");
      }
      pendingMotionSlug = "";
    }
    grid.querySelectorAll("[data-shortlist-slug]").forEach(function (button) {
      button.addEventListener("click", function () {
        var slug = button.getAttribute("data-shortlist-slug");
        pendingMotionSlug = slug;
        toggleShortlist(slug);
        render();
      });
    });
    grid.querySelectorAll("[data-card-slug]").forEach(function (card) {
      function activatePreview() {
        var slug = card.getAttribute("data-card-slug") || "";
        if (!slug || slug === activePreviewSlug) {
          return;
        }
        activePreviewSlug = slug;
        renderDirectoryTradeoffPreview(results);
      }
      card.addEventListener("mouseenter", activatePreview);
      card.addEventListener("focusin", activatePreview);
    });
    grid.querySelectorAll("[data-primary-cta]").forEach(function (link) {
      link.addEventListener("click", function () {
        trackFunnelEvent("directory_primary_cta_clicked", {
          therapist_slug: link.getAttribute("data-primary-cta"),
          sort_by: filters.sortBy,
        });
      });
    });
    grid.querySelectorAll("[data-review-fit]").forEach(function (link) {
      link.addEventListener("click", function () {
        trackFunnelEvent("directory_profile_review_clicked", {
          therapist_slug: link.getAttribute("data-review-fit"),
          sort_by: filters.sortBy,
        });
      });
    });
    var previewShortlistButton = rootQuery("[data-preview-shortlist]");
    if (previewShortlistButton) {
      previewShortlistButton.addEventListener("click", function () {
        var slug = previewShortlistButton.getAttribute("data-preview-shortlist");
        if (!slug) {
          return;
        }
        pendingMotionSlug = slug;
        toggleShortlist(slug);
        render();
      });
    }
    var previewOpenLink = rootQuery("[data-preview-open-profile]");
    if (previewOpenLink) {
      previewOpenLink.addEventListener("click", function () {
        trackFunnelEvent("directory_preview_profile_opened", {
          therapist_slug: previewOpenLink.getAttribute("data-preview-open-profile"),
          sort_by: filters.sortBy,
        });
      });
    }
    grid.querySelectorAll("[data-shortlist-priority]").forEach(function (select) {
      select.addEventListener("change", function () {
        updateShortlistPriority(select.getAttribute("data-shortlist-priority"), select.value);
        renderShortlistBar();
        if (typeof window.refreshShortlistNav === "function") {
          window.refreshShortlistNav();
        }
      });
    });
    grid.querySelectorAll("[data-shortlist-note]").forEach(function (input) {
      input.addEventListener("change", function () {
        updateShortlistNote(input.getAttribute("data-shortlist-note"), input.value);
        renderShortlistBar();
        if (typeof window.refreshShortlistNav === "function") {
          window.refreshShortlistNav();
        }
      });
    });
    renderPagination(results.length);
    renderShortlistBar();
    updateUrl();
  }

  function rootQuery(selector) {
    return document.querySelector(selector);
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

  var mobileFilterToggle = getElement("mobileFilterToggle");
  if (mobileFilterToggle) {
    mobileFilterToggle.addEventListener("click", toggleFilters);
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

  window.addEventListener("resize", syncSidebarForViewport);

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
