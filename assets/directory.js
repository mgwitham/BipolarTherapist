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
  getMatchScore,
  matchesDirectoryFilters,
} from "./directory-logic.js";

var DIRECTORY_LIST_LIMIT = 6;
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
  var SHORTLIST_RESHAPE_HISTORY_KEY = "bth_shortlist_reshape_history_v1";
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
    zip: "",
    specialty: "",
    modality: "",
    population: "",
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
  var liveFilterTimer = 0;
  var lastReshapeSnapshot = null;
  var lastReshapeHistory = readReshapeHistory();
  var VALID_SORT_OPTIONS = new Set([
    "best_match",
    "most_experienced",
    "soonest_availability",
    "lowest_fee",
    "most_responsive",
  ]);
  var FILTER_PRESETS = {
    trusted_fast: {
      recently_confirmed: true,
      accepting: true,
      sortBy: "best_match",
    },
    responsive: {
      responsive_contact: true,
      accepting: true,
      sortBy: "most_responsive",
    },
    value: {
      insurance: "",
      telehealth: true,
      sortBy: "lowest_fee",
    },
  };

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

  function readReshapeHistory() {
    try {
      return JSON.parse(window.localStorage.getItem(SHORTLIST_RESHAPE_HISTORY_KEY) || "null");
    } catch (_error) {
      return null;
    }
  }

  function writeReshapeHistory(value) {
    lastReshapeHistory = value || null;
    try {
      if (!value) {
        window.localStorage.removeItem(SHORTLIST_RESHAPE_HISTORY_KEY);
        return;
      }
      window.localStorage.setItem(SHORTLIST_RESHAPE_HISTORY_KEY, JSON.stringify(value));
    } catch (_error) {
      return;
    }
  }

  function formatOutcomeLabel(outcome) {
    var labels = {
      reached_out: "Reached out",
      heard_back: "Heard back",
      booked_consult: "Booked consult",
      good_fit_call: "Good fit call",
      insurance_mismatch: "Insurance mismatch",
      waitlist: "Waitlist",
      no_response: "No response yet",
    };
    return labels[String(outcome || "")] || "";
  }

  function getLatestOutcomeBySlug(slugs) {
    var target = new Set((Array.isArray(slugs) ? slugs : []).filter(Boolean));
    if (!target.size) {
      return {};
    }
    return readOutreachOutcomes()
      .slice()
      .sort(function (a, b) {
        return new Date(b.recorded_at || 0).getTime() - new Date(a.recorded_at || 0).getTime();
      })
      .reduce(function (map, item) {
        if (!item || !item.therapist_slug || !target.has(item.therapist_slug)) {
          return map;
        }
        if (!map[item.therapist_slug]) {
          map[item.therapist_slug] = item;
        }
        return map;
      }, {});
  }

  function buildReshapeHistoryPayload(beforeEntries, afterEntries) {
    var beforeLead = beforeEntries[0] ? getTherapistName(beforeEntries[0].slug) : "open lead slot";
    var afterLead = afterEntries[0] ? getTherapistName(afterEntries[0].slug) : "open lead slot";
    var beforeBackup = beforeEntries[1] ? getTherapistName(beforeEntries[1].slug) : "no backup";
    var afterBackup = afterEntries[1] ? getTherapistName(afterEntries[1].slug) : "no backup";
    var changedCount = afterEntries.filter(function (item, index) {
      var before = beforeEntries[index];
      return !before || before.slug !== item.slug;
    }).length;
    var changedIn = afterEntries
      .filter(function (item, index) {
        var before = beforeEntries[index];
        return item && (!before || before.slug !== item.slug);
      })
      .map(function (item) {
        return item.slug;
      });
    var changedOut = beforeEntries
      .filter(function (item, index) {
        var after = afterEntries[index];
        return item && (!after || after.slug !== item.slug);
      })
      .map(function (item) {
        return item.slug;
      });
    var latestBySlug = getLatestOutcomeBySlug(changedIn.concat(changedOut));
    var promotedSlug = changedIn[0] || "";
    var demotedSlug = changedOut[0] || "";
    var promotedOutcome = promotedSlug ? latestBySlug[promotedSlug] : null;
    var demotedOutcome = demotedSlug ? latestBySlug[demotedSlug] : null;
    var promotedLabel = promotedOutcome ? formatOutcomeLabel(promotedOutcome.outcome) : "";
    var demotedLabel = demotedOutcome ? formatOutcomeLabel(demotedOutcome.outcome) : "";
    var driver = "";

    if (promotedLabel) {
      driver =
        "Driver: " +
        promotedLabel +
        " on " +
        getTherapistName(promotedSlug) +
        " made that route easier to prioritize.";
    } else if (demotedLabel) {
      driver =
        "Driver: " +
        demotedLabel +
        " on " +
        getTherapistName(demotedSlug) +
        " weakened the older saved order.";
    }

    return {
      title: "Last shortlist reshape",
      summary:
        "You moved the queue from " +
        beforeLead +
        " leading with " +
        beforeBackup +
        " as backup to " +
        afterLead +
        " leading with " +
        afterBackup +
        " as backup.",
      meta:
        (driver ? driver + " " : "") +
        changedCount +
        " slot" +
        (changedCount === 1 ? "" : "s") +
        " changed in the most recent reshaping pass.",
    };
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

  function getShortlistPriorityRank(value) {
    var normalized = String(value || "").toLowerCase();
    if (normalized === "best fit") {
      return 3;
    }
    if (normalized === "best availability") {
      return 2;
    }
    if (normalized === "best value") {
      return 1;
    }
    return 0;
  }

  function buildDirectoryReturnSnapshot() {
    var slugs = shortlist.map(function (item) {
      return item.slug;
    });
    var latestBySlug = {};

    readOutreachOutcomes()
      .slice()
      .sort(function (a, b) {
        return new Date(b.recorded_at || 0).getTime() - new Date(a.recorded_at || 0).getTime();
      })
      .forEach(function (item) {
        if (!item || !item.therapist_slug || !slugs.includes(item.therapist_slug)) {
          return;
        }
        if (!latestBySlug[item.therapist_slug]) {
          latestBySlug[item.therapist_slug] = item;
        }
      });

    var ranked = shortlist
      .map(function (item, index) {
        return {
          slug: item.slug,
          rank: getShortlistPriorityRank(item.priority),
          index: index,
          latestOutcome: latestBySlug[item.slug] || null,
        };
      })
      .sort(function (a, b) {
        return b.rank - a.rank || a.index - b.index;
      });

    return {
      lead:
        ranked.find(function (item) {
          return (
            !item.latestOutcome ||
            ["insurance_mismatch", "waitlist", "no_response"].indexOf(
              String(item.latestOutcome.outcome || ""),
            ) === -1
          );
        }) ||
        ranked[0] ||
        null,
      live:
        ranked.find(function (item) {
          return (
            item.latestOutcome &&
            ["heard_back", "booked_consult", "good_fit_call"].indexOf(
              String(item.latestOutcome.outcome || ""),
            ) !== -1
          );
        }) || null,
      stalled:
        ranked.find(function (item) {
          return (
            item.latestOutcome &&
            ["insurance_mismatch", "waitlist", "no_response"].indexOf(
              String(item.latestOutcome.outcome || ""),
            ) !== -1
          );
        }) || null,
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
    lastReshapeSnapshot = null;
    writeReshapeHistory(null);
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

  function removeShortlistEntry(slug) {
    lastReshapeSnapshot = null;
    writeReshapeHistory(null);
    writeShortlist(
      shortlist.filter(function (item) {
        return item.slug !== slug;
      }),
    );
  }

  function replaceShortlistEntry(slugToRemove, replacementSlug) {
    lastReshapeSnapshot = null;
    writeReshapeHistory(null);
    var removedEntry = shortlist.find(function (item) {
      return item.slug === slugToRemove;
    });
    var next = shortlist
      .filter(function (item) {
        return item.slug !== slugToRemove && item.slug !== replacementSlug;
      })
      .concat({
        slug: replacementSlug,
        priority: removedEntry ? String(removedEntry.priority || "") : "",
        note: "",
      })
      .slice(0, DIRECTORY_LIST_LIMIT);

    writeShortlist(next);
  }

  function fillShortlistSlot(replacementSlug) {
    lastReshapeSnapshot = null;
    writeReshapeHistory(null);
    if (
      !replacementSlug ||
      isShortlisted(replacementSlug) ||
      shortlist.length >= DIRECTORY_LIST_LIMIT
    ) {
      return;
    }
    writeShortlist(
      shortlist
        .concat({ slug: replacementSlug, priority: "", note: "" })
        .slice(0, DIRECTORY_LIST_LIMIT),
    );
  }

  function applyReshapingPlan(entries) {
    if (!Array.isArray(entries) || !entries.length) {
      return;
    }
    var beforeEntries = normalizeShortlist(shortlist);
    var nextEntries = entries
      .filter(function (item) {
        return item && item.slug;
      })
      .map(function (item) {
        return {
          slug: String(item.slug),
          priority: String(item.priority || ""),
          note: String(item.note || ""),
        };
      })
      .slice(0, DIRECTORY_LIST_LIMIT);
    lastReshapeSnapshot = beforeEntries;
    writeShortlist(nextEntries);
    writeReshapeHistory(buildReshapeHistoryPayload(beforeEntries, nextEntries));
  }

  function undoReshapingPlan() {
    if (!lastReshapeSnapshot || !lastReshapeSnapshot.length) {
      return;
    }
    writeShortlist(normalizeShortlist(lastReshapeSnapshot));
    lastReshapeSnapshot = null;
    writeReshapeHistory(null);
  }

  function updateShortlistPriority(slug, priority) {
    lastReshapeSnapshot = null;
    writeReshapeHistory(null);
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
    lastReshapeSnapshot = null;
    writeReshapeHistory(null);
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
    var zipInput = getElement("zip");
    var zipLabel = getElement("cityLabelText");
    if (keywordInput && directoryPage.searchPlaceholder) {
      keywordInput.placeholder = directoryPage.searchPlaceholder;
    }
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
    if (filters.q) {
      chips.push('Keyword: "' + filters.q + '"');
    }
    if (filters.state) {
      chips.push(filters.state);
    }
    if (filters.zip) {
      chips.push(filters.zip);
    }
    if (filters.specialty) {
      chips.push(filters.specialty);
    }
    if (filters.modality) {
      chips.push(filters.modality);
    }
    if (filters.population) {
      chips.push(filters.population);
    }
    if (filters.bipolar_experience) {
      chips.push(filters.bipolar_experience + "+ yrs bipolar care");
    }
    if (filters.insurance) {
      chips.push(filters.insurance);
    }
    if (filters.telehealth) {
      chips.push("Telehealth");
    }
    if (filters.in_person) {
      chips.push("In-person");
    }
    if (filters.accepting) {
      chips.push("Accepting patients");
    }
    if (filters.medication_management) {
      chips.push("Medication management");
    }
    if (filters.responsive_contact) {
      chips.push("Responsive contact");
    }
    if (filters.recently_confirmed) {
      chips.push("Recently confirmed");
    }
    return chips;
  }

  function renderActiveFilterSummary(resultsLength) {
    var summary = getElement("activeFilterSummary");
    var chipsRoot = getElement("activeFilterChips");
    if (!summary || !chipsRoot) {
      return;
    }

    var active = summarizeActiveFilters();
    if (!active.length) {
      summary.textContent = "No filters yet. Add one or two to narrow the list.";
      chipsRoot.innerHTML = "";
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
      .slice(0, 4)
      .map(function (item) {
        return '<span class="filter-chip">' + escapeHtml(item) + "</span>";
      })
      .join("");
    if (active.length > 4) {
      chipsRoot.innerHTML +=
        '<span class="filter-chip filter-chip-more">+' +
        escapeHtml(active.length - 4) +
        " more</span>";
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
      "You still have a broad set of options. Add one more filter or change the sort to make comparison easier.";
  }

  function applyFilterPreset(name) {
    var preset = FILTER_PRESETS[name];
    if (!preset) {
      return;
    }

    filters = Object.assign({}, filters, preset);
    currentPage = 1;
    syncFilterControlsFromState(filters, getElement);
    trackFunnelEvent("directory_filter_preset_applied", {
      preset_name: name,
      active_filter_count: countActiveFilters(filters),
      sort_by: filters.sortBy,
    });
    render();
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
        "If you sort for availability instead",
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
        Object.assign({}, filters, { recently_confirmed: true }),
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

    return scenarios.slice(0, 2);
  }

  function renderDirectoryTradeoffPreview(results) {
    var root = getElement("directoryTradeoffPreview");
    if (!root) {
      return;
    }

    var list = Array.isArray(results) ? results : [];
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

    root.classList.toggle("is-empty", !previewMarkup);
    root.innerHTML = previewMarkup;
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
        label: "Best preview to open",
        note: "Preview opens are leading right now, so this card stays focused on the strongest profile to open next.",
      };
    }
    if (leader.source === "card_primary") {
      return {
        label: "Best action to open",
        note: "Direct action clicks are leading right now, so this card stays tightly focused on the clearest next move.",
      };
    }
    if (leader.source === "card_profile") {
      return {
        label: "Best profile to review",
        note: "Profile review opens are leading right now, so this card is optimized for deeper review before outreach.",
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
        outreachOutcomes: readOutreachOutcomes(),
      }),
      undoState:
        lastReshapeSnapshot && lastReshapeSnapshot.length
          ? {
              canUndo: true,
              label: "Undo last reshape",
            }
          : null,
      historyState: lastReshapeHistory,
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

    root.querySelectorAll("[data-shortlist-remove]").forEach(function (button) {
      button.addEventListener("click", function () {
        var slug = button.getAttribute("data-shortlist-remove");
        if (!slug) {
          return;
        }
        trackFunnelEvent("directory_shortlist_removed_from_compare", {
          therapist_slug: slug,
          shortlist_size_before: shortlist.length,
        });
        removeShortlistEntry(slug);
        render();
      });
    });

    root.querySelectorAll("[data-shortlist-replace]").forEach(function (button) {
      button.addEventListener("click", function () {
        var removedSlug = button.getAttribute("data-shortlist-replace");
        var replacementSlug = button.getAttribute("data-shortlist-replacement-slug");
        if (!removedSlug || !replacementSlug) {
          return;
        }
        trackFunnelEvent("directory_shortlist_replaced_from_compare", {
          removed_slug: removedSlug,
          replacement_slug: replacementSlug,
          shortlist_size_before: shortlist.length,
        });
        pendingMotionSlug = replacementSlug;
        replaceShortlistEntry(removedSlug, replacementSlug);
        render();
      });
    });

    root.querySelectorAll("[data-shortlist-fill]").forEach(function (button) {
      button.addEventListener("click", function () {
        var replacementSlug = button.getAttribute("data-shortlist-fill");
        if (!replacementSlug) {
          return;
        }
        trackFunnelEvent("directory_shortlist_slot_filled", {
          replacement_slug: replacementSlug,
          shortlist_size_before: shortlist.length,
        });
        pendingMotionSlug = replacementSlug;
        fillShortlistSlot(replacementSlug);
        render();
      });
    });

    root.querySelectorAll("[data-shortlist-apply-reshaping]").forEach(function (button) {
      button.addEventListener("click", function () {
        var payload = button.getAttribute("data-shortlist-apply-reshaping");
        if (!payload) {
          return;
        }
        try {
          var entries = JSON.parse(decodeURIComponent(payload));
          trackFunnelEvent("directory_shortlist_reshaping_applied", {
            shortlist_size_before: shortlist.length,
            shortlist_size_after: Array.isArray(entries) ? entries.length : shortlist.length,
          });
          pendingMotionSlug = Array.isArray(entries) && entries[0] ? entries[0].slug : "";
          applyReshapingPlan(entries);
          render();
        } catch (_error) {
          return;
        }
      });
    });

    var undoButton = getElement("undoDirectoryReshape");
    if (undoButton) {
      undoButton.addEventListener("click", function () {
        trackFunnelEvent("directory_shortlist_reshaping_undone", {
          shortlist_size_before: shortlist.length,
        });
        undoReshapingPlan();
        render();
      });
    }
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
    renderActiveFilterSummary(results.length);
    renderJourneySummary(results.length, activeFilterCount);

    if (!pageItems.length) {
      grid.innerHTML = renderEmptyStateMarkup(directoryPage);
      renderDirectoryTradeoffPreview([]);
      renderEditorialLanes([]);
      renderPagination(0);
      renderShortlistBar();
      updateUrl();
      return;
    }

    activePreviewSlug = renderState.activePreviewSlug;
    renderDirectoryTradeoffPreview(results);
    renderEditorialLanes(results);
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

  document.querySelectorAll("[data-filter-preset]").forEach(function (button) {
    button.addEventListener("click", function () {
      applyFilterPreset(button.getAttribute("data-filter-preset"));
    });
  });

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
