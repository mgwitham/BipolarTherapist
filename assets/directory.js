import { fetchDirectoryPageContent } from "./cms.js";
import {
  getDataFreshnessSummary,
  getEditoriallyVerifiedOperationalCount,
  getOperationalTrustSummary,
  getRecentAppliedSummary,
  getRecentConfirmationSummary,
  getTherapistMatchReadiness,
  getTherapistMerchandisingQuality,
} from "./matching-model.js";
import { getPublicResponsivenessSignal } from "./responsiveness-signal.js";
import {
  readFunnelEvents,
  summarizeAdaptiveSignals,
  trackFunnelEvent,
} from "./funnel-analytics.js";

(async function () {
  var DIRECTORY_SHORTLIST_KEY = "bth_directory_shortlist_v1";
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

  function buildDirectoryStrategySegments() {
    var segments = ["all"];
    if (filters.telehealth && !filters.in_person) {
      segments.push("format:telehealth");
    } else if (filters.in_person && !filters.telehealth) {
      segments.push("format:in_person");
    }
    if (filters.medication_management) {
      segments.push("intent:psychiatry");
      segments.push("medication:yes");
    }
    if (filters.insurance) {
      segments.push("insurance:user");
    }
    if (filters.accepting || filters.sortBy === "soonest_availability") {
      segments.push("urgency:within-2-weeks");
    }
    return segments;
  }

  function getDirectoryStrategyAudience() {
    var segments = buildDirectoryStrategySegments();
    if (
      segments.some(function (segment) {
        return segment.indexOf("urgency:") === 0;
      })
    ) {
      return "people browsing with timing in mind";
    }
    if (segments.includes("insurance:user")) {
      return "people browsing with cost or insurance in mind";
    }
    if (
      segments.some(function (segment) {
        return (
          segment.indexOf("intent:psychiatry") === 0 || segment.indexOf("medication:yes") === 0
        );
      })
    ) {
      return "people browsing for psychiatry or medication support";
    }
    if (
      segments.some(function (segment) {
        return segment.indexOf("format:") === 0;
      })
    ) {
      return "people browsing with a stronger care-format preference";
    }
    return "people browsing like this";
  }

  function renderDirectoryAdaptiveExplainer() {
    var root = document.getElementById("directoryAdaptiveExplainer");
    if (!root) {
      return;
    }

    var adaptiveSignals = summarizeAdaptiveSignals(
      readFunnelEvents(),
      [],
      buildDirectoryStrategySegments(),
    );
    var basis =
      adaptiveSignals.match_action_basis === "outcomes"
        ? "what has worked best"
        : "how people tend to move";
    var audience = getDirectoryStrategyAudience();
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
    var root = document.getElementById("directoryLaunchExplainer");
    if (!root) {
      return;
    }

    var activeFilterCount = Object.keys(filters).filter(function (key) {
      return key !== "sortBy" && Boolean(filters[key]);
    }).length;
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
    var activeFilterCount = Object.keys(filterState || {}).filter(function (key) {
      return key !== "sortBy" && Boolean(filterState[key]);
    }).length;

    return (Array.isArray(list) ? list.slice() : []).sort(function (a, b) {
      var aPriority = prioritySet.has(a && a.slug ? a.slug : "");
      var bPriority = prioritySet.has(b && b.slug ? b.slug : "");
      var aBase = getMatchScore(a);
      var bBase = getMatchScore(b);
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

  function getPreferredContactRoute(therapist) {
    var emailAvailable = therapist.email && therapist.email !== "contact@example.com";
    var customLabel = String(therapist.preferred_contact_label || "").trim();

    if (therapist.preferred_contact_method === "booking" && therapist.booking_url) {
      return {
        label: customLabel || "Book consultation",
        href: therapist.booking_url,
        external: true,
        detail: "Prefers booking link",
      };
    }

    if (therapist.preferred_contact_method === "website" && therapist.website) {
      return {
        label: customLabel || "Visit website",
        href: therapist.website,
        external: true,
        detail: "Prefers website intake",
      };
    }

    if (therapist.preferred_contact_method === "phone" && therapist.phone) {
      return {
        label: customLabel || "Call practice",
        href: "tel:" + therapist.phone,
        external: false,
        detail: "Prefers phone consults",
      };
    }

    if (therapist.preferred_contact_method === "email" && emailAvailable) {
      return {
        label: customLabel || "Email therapist",
        href: "mailto:" + therapist.email,
        external: false,
        detail: "Prefers direct email",
      };
    }

    if (therapist.booking_url) {
      return {
        label: customLabel || "Book consultation",
        href: therapist.booking_url,
        external: true,
        detail: "Booking link available",
      };
    }

    if (therapist.website) {
      return {
        label: customLabel || "Visit website",
        href: therapist.website,
        external: true,
        detail: "Website intake available",
      };
    }

    if (therapist.phone) {
      return {
        label: customLabel || "Call practice",
        href: "tel:" + therapist.phone,
        external: false,
        detail: "Phone contact available",
      };
    }

    if (emailAvailable) {
      return {
        label: customLabel || "Email therapist",
        href: "mailto:" + therapist.email,
        external: false,
        detail: "Direct email available",
      };
    }

    return null;
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
      var element = document.getElementById(entry[0]);
      var value = directoryPage[entry[1]];
      if (element && value) {
        element.textContent = value;
      }
    });

    var keywordInput = document.getElementById("q");
    var cityInput = document.getElementById("city");
    if (keywordInput && directoryPage.searchPlaceholder) {
      keywordInput.placeholder = directoryPage.searchPlaceholder;
    }
    if (cityInput && directoryPage.cityPlaceholder) {
      cityInput.placeholder = directoryPage.cityPlaceholder;
    }

    var stateSelect = document.getElementById("state");
    var specialtySelect = document.getElementById("specialty");
    var insuranceSelect = document.getElementById("insurance");

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

    var navBrowseLink = document.getElementById("navBrowseLink");
    var navCtaLink = document.getElementById("navCtaLink");
    var footerTagline = document.getElementById("footerTagline");

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
    var select = document.getElementById(id);
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
    [
      "q",
      "state",
      "city",
      "specialty",
      "modality",
      "population",
      "verification",
      "bipolar_experience",
      "insurance",
      "sortBy",
    ].forEach(function (key) {
      if (params.get(key)) {
        filters[key] = params.get(key);
        var input = document.getElementById(key);
        if (input) {
          input.value = filters[key];
        }
      }
    });

    [
      "telehealth",
      "in_person",
      "accepting",
      "medication_management",
      "responsive_contact",
      "recently_confirmed",
    ].forEach(function (key) {
      if (params.get(key) === "true") {
        filters[key] = true;
        document.getElementById(key).checked = true;
      }
    });

    if (!params.get("sortBy")) {
      var adaptiveSignals = summarizeAdaptiveSignals(readFunnelEvents());
      filters.sortBy = adaptiveSignals.preferred_directory_sort || defaultFilters.sortBy;
      document.getElementById("sortBy").value = filters.sortBy;
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

  function getWaitPriority(value) {
    var map = {
      "Immediate availability": 0,
      "Within 1 week": 1,
      "Within 2 weeks": 2,
      "2-4 weeks": 3,
      "1-2 months": 4,
      "Waitlist only": 5,
    };
    return Object.prototype.hasOwnProperty.call(map, value) ? map[value] : 99;
  }

  function getPublicReadinessCopy(therapist) {
    var readiness = getTherapistMatchReadiness(therapist);
    if (readiness.score >= 85) {
      return "High match confidence";
    }
    if (readiness.score >= 65) {
      return "Good match confidence";
    }
    return "Profile still being completed";
  }

  function buildLikelyFitCopy(therapist) {
    var cues = [];

    if (therapist.medication_management) {
      cues.push("people who may need psychiatry or medication support");
    } else if ((therapist.client_populations || []).length) {
      cues.push(
        "people looking for " +
          String(therapist.client_populations[0] || "").toLowerCase() +
          " support",
      );
    }

    if ((therapist.specialties || []).includes("Bipolar I")) {
      cues.push("bipolar I care");
    } else if ((therapist.specialties || []).includes("Bipolar II")) {
      cues.push("bipolar II care");
    } else if ((therapist.specialties || []).length) {
      cues.push(String(therapist.specialties[0] || "").toLowerCase() + " care");
    }

    if (therapist.accepts_telehealth) {
      cues.push("telehealth access");
    }

    if (!cues.length) {
      return "Likely best for people who want a more structured bipolar-focused next step.";
    }

    return "Likely best for " + cues.slice(0, 2).join(" and ") + ".";
  }

  function buildReviewedDetailsCopy(therapist) {
    if (therapist.verification_status === "editorially_verified") {
      return "Reviewed details include license, location, care format, and contact path.";
    }

    return "Core profile details are present, but some reviewed details may still need confirmation.";
  }

  function buildCardStandoutCopy(therapist) {
    var reasons = [];
    if (therapist.verification_status === "editorially_verified") {
      reasons.push("editorial review is already in place");
    }
    if (getEditoriallyVerifiedOperationalCount(therapist) >= 2) {
      reasons.push("multiple practical details are editor-verified");
    }
    if (Number(therapist.bipolar_years_experience || 0) >= 8) {
      reasons.push("bipolar-specific experience is unusually clear");
    }
    if (therapist.medication_management) {
      reasons.push("medication support is part of the offering");
    }
    if (therapist.accepting_new_patients && therapist.estimated_wait_time) {
      reasons.push("the profile gives unusually clear availability context");
    }

    if (!reasons.length) {
      return "Worth a closer look because the profile gives a relatively clear picture of fit and next-step logistics.";
    }

    return reasons.slice(0, 2).join(" and ") + ".";
  }

  function buildCardReachabilityCopy(therapist) {
    var route = getPreferredContactRoute(therapist);
    var routeCopy = route ? route.label : "Review the profile for the best next step";
    if (therapist.accepting_new_patients && therapist.estimated_wait_time) {
      return (
        "Reachability: a recent availability note suggests " +
        therapist.estimated_wait_time +
        ", and the clearest next move is to " +
        routeCopy +
        "."
      );
    }
    if (therapist.accepting_new_patients) {
      return (
        "Reachability: appears to be accepting new patients, with a clear next move to " +
        routeCopy +
        "."
      );
    }
    if (therapist.estimated_wait_time) {
      return (
        "Reachability: a recent availability note suggests " +
        therapist.estimated_wait_time +
        ", but live openings should still be confirmed directly. The clearest next move is to " +
        routeCopy +
        "."
      );
    }
    return "Reachability: the contact path is clear, but live timing still needs direct confirmation.";
  }

  function buildCardTrustSnapshot(therapist) {
    var reviewedCount = getEditoriallyVerifiedOperationalCount(therapist);
    var recentApplied = getRecentAppliedSummary(therapist);
    var recentConfirmation = getRecentConfirmationSummary(therapist);

    if (recentApplied) {
      return recentApplied.label + ". " + recentApplied.note;
    }
    if (recentConfirmation) {
      return recentConfirmation.label + ". " + recentConfirmation.note;
    }
    if (reviewedCount >= 2) {
      return (
        reviewedCount +
        " key operational detail" +
        (reviewedCount === 1 ? "" : "s") +
        " are editor-verified."
      );
    }
    return buildReviewedDetailsCopy(therapist);
  }

  function getFreshnessBadgeData(therapist) {
    var recentApplied = getRecentAppliedSummary(therapist);
    if (recentApplied) {
      return {
        label: recentApplied.short_label || recentApplied.label,
        note: recentApplied.note,
        tone: "fresh",
      };
    }

    var recentConfirmation = getRecentConfirmationSummary(therapist);
    if (recentConfirmation) {
      return {
        label: recentConfirmation.short_label || recentConfirmation.label,
        note: recentConfirmation.note,
        tone: recentConfirmation.tone === "fresh" ? "fresh" : "recent",
      };
    }

    var freshness = getDataFreshnessSummary(therapist);
    return freshness
      ? {
          label: freshness.label,
          note: freshness.note,
          tone: freshness.status === "fresh" ? "fresh" : "stale",
        }
      : null;
  }

  function getResponsivenessRank(therapist) {
    var signal = getPublicResponsivenessSignal(therapist);
    if (!signal) {
      return 0;
    }
    if (signal.tone === "positive") {
      return 2;
    }
    return 1;
  }

  function getFreshnessRank(therapist) {
    var recentApplied = getRecentAppliedSummary(therapist);
    if (recentApplied) {
      return 3;
    }

    var recentConfirmation = getRecentConfirmationSummary(therapist);
    if (recentConfirmation) {
      return recentConfirmation.tone === "fresh" ? 3 : 2;
    }

    var freshness = getDataFreshnessSummary(therapist);
    if (!freshness) {
      return 0;
    }
    if (freshness.status === "fresh") {
      return 2;
    }
    if (freshness.status === "recent") {
      return 1;
    }
    return 0;
  }

  function buildCardFitSummary(therapist) {
    var reasons = [];

    if (filters.specialty && (therapist.specialties || []).includes(filters.specialty)) {
      reasons.push("focuses on " + filters.specialty.toLowerCase());
    }
    if (filters.modality && (therapist.treatment_modalities || []).includes(filters.modality)) {
      reasons.push("offers " + filters.modality);
    }
    if (filters.population && (therapist.client_populations || []).includes(filters.population)) {
      reasons.push("works with " + filters.population.toLowerCase());
    }
    if (filters.insurance && (therapist.insurance_accepted || []).includes(filters.insurance)) {
      reasons.push("accepts " + filters.insurance);
    }
    if (filters.telehealth && therapist.accepts_telehealth) {
      reasons.push("offers telehealth");
    }
    if (filters.in_person && therapist.accepts_in_person) {
      reasons.push("offers in-person care");
    }
    if (filters.accepting && therapist.accepting_new_patients) {
      reasons.push("is accepting new patients");
    }
    if (filters.medication_management && therapist.medication_management) {
      reasons.push("includes medication management");
    }
    if (filters.responsive_contact && getResponsivenessRank(therapist) > 0) {
      reasons.push("has a stronger early contact responsiveness signal");
    }

    if (!reasons.length && therapist.verification_status === "editorially_verified") {
      reasons.push("has been editorially verified");
    }
    if (!reasons.length && Number(therapist.bipolar_years_experience || 0) >= 8) {
      reasons.push("has substantial bipolar-specific experience");
    }
    if (!reasons.length && therapist.estimated_wait_time) {
      reasons.push(
        "typically has " + therapist.estimated_wait_time.toLowerCase() + " availability",
      );
    }
    if (!reasons.length && therapist.medication_management) {
      reasons.push("offers therapy plus medication support");
    }
    if (!reasons.length && therapist.accepts_telehealth) {
      reasons.push("offers telehealth access");
    }
    if (!reasons.length && (therapist.care_approach || therapist.bio_preview || therapist.bio)) {
      reasons.push("has a clearly described care approach");
    }

    if (!reasons.length) {
      return "May be worth a closer look based on the current filters.";
    }

    return "May fit because this clinician " + reasons.slice(0, 2).join(" and ") + ".";
  }

  function getMatchScore(therapist) {
    var score = 0;
    var quality = getTherapistMerchandisingQuality(therapist);
    var responsivenessRank = getResponsivenessRank(therapist);
    var query = filters.q.trim().toLowerCase();
    if (query) {
      if ((therapist.name || "").toLowerCase().includes(query)) {
        score += 30;
      }
      if ((therapist.practice_name || "").toLowerCase().includes(query)) {
        score += 16;
      }
      if ((therapist.title || "").toLowerCase().includes(query)) {
        score += 10;
      }
      if ((therapist.bio_preview || therapist.bio || "").toLowerCase().includes(query)) {
        score += 14;
      }
      if ((therapist.care_approach || "").toLowerCase().includes(query)) {
        score += 18;
      }
      (therapist.specialties || []).forEach(function (value) {
        if (String(value).toLowerCase().includes(query)) {
          score += 14;
        }
      });
      (therapist.treatment_modalities || []).forEach(function (value) {
        if (String(value).toLowerCase().includes(query)) {
          score += 12;
        }
      });
      (therapist.client_populations || []).forEach(function (value) {
        if (String(value).toLowerCase().includes(query)) {
          score += 10;
        }
      });
    }

    if (filters.specialty && (therapist.specialties || []).includes(filters.specialty)) {
      score += 26;
    }
    if (filters.modality && (therapist.treatment_modalities || []).includes(filters.modality)) {
      score += 18;
    }
    if (filters.population && (therapist.client_populations || []).includes(filters.population)) {
      score += 18;
    }
    if (filters.insurance && (therapist.insurance_accepted || []).includes(filters.insurance)) {
      score += 12;
    }
    if (filters.state && therapist.state === filters.state) {
      score += 10;
    }
    if (filters.city && therapist.city.toLowerCase() === filters.city.toLowerCase()) {
      score += 14;
    }
    if (filters.accepting && therapist.accepting_new_patients) {
      score += 10;
    }
    if (filters.telehealth && therapist.accepts_telehealth) {
      score += 8;
    }
    if (filters.in_person && therapist.accepts_in_person) {
      score += 8;
    }
    if (filters.medication_management && therapist.medication_management) {
      score += 12;
    }
    if (filters.responsive_contact && responsivenessRank > 0) {
      score += responsivenessRank === 2 ? 16 : 8;
    }
    if (filters.recently_confirmed && getFreshnessRank(therapist) >= 2) {
      score += 18;
    }
    if (filters.verification && therapist.verification_status === filters.verification) {
      score += 14;
    }

    score += Math.round(quality.score * 0.45);
    score += getFreshnessRank(therapist) * 5;
    if (responsivenessRank === 2) {
      score += 4;
    } else if (responsivenessRank === 1) {
      score += 1;
    }

    return score;
  }

  function getEditorialLaneCandidates(results) {
    var list = Array.isArray(results) ? results.slice() : [];
    var psychiatry = list
      .filter(function (therapist) {
        return (
          therapist.medication_management ||
          /psychiatrist|psychiatric|pmhnp|np|md/i.test(
            String((therapist.title || "") + " " + (therapist.credentials || "")),
          )
        );
      })
      .sort(function (a, b) {
        return (
          getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score
        );
      })[0];

    var therapy = list
      .filter(function (therapist) {
        return !therapist.medication_management;
      })
      .sort(function (a, b) {
        return (
          getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score
        );
      })[0];

    var fastest = list
      .filter(function (therapist) {
        return therapist.accepting_new_patients;
      })
      .sort(function (a, b) {
        return (
          getWaitPriority(a.estimated_wait_time) - getWaitPriority(b.estimated_wait_time) ||
          getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score
        );
      })[0];

    return [
      {
        title: "Strongest psychiatry option",
        therapist: psychiatry,
        copy: "Best when medication support or psychiatry coordination may matter.",
      },
      {
        title: "Strongest therapy option",
        therapist: therapy,
        copy: "Best when you want a high-quality therapy-first profile with strong bipolar detail.",
      },
      {
        title: "Fastest next step",
        therapist: fastest,
        copy: "Best when speed, availability, and follow-through matter most right now.",
      },
    ].filter(function (lane) {
      return Boolean(lane.therapist);
    });
  }

  function renderEditorialLanes(results) {
    var root = document.getElementById("editorialLanes");
    if (!root) {
      return;
    }

    var hasActiveFilters = Object.keys(filters).some(function (key) {
      return key !== "sortBy" && Boolean(filters[key]);
    });

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
          escapeHtml(buildCardFitSummary(lane.therapist)) +
          " " +
          escapeHtml(laneCue) +
          '</div><a class="editorial-lane-link" href="therapist.html?slug=' +
          encodeURIComponent(lane.therapist.slug) +
          '">View profile →</a></div>'
        );
      })
      .join("");
  }

  function compareTherapistsWithFilters(filterState, a, b) {
    if (filterState.sortBy === "most_responsive") {
      return (
        getResponsivenessRank(b) - getResponsivenessRank(a) ||
        getMatchScore(b) - getMatchScore(a) ||
        a.name.localeCompare(b.name)
      );
    }

    if (filterState.sortBy === "most_experienced") {
      return (
        Number(b.bipolar_years_experience || 0) - Number(a.bipolar_years_experience || 0) ||
        getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score ||
        Number(b.years_experience || 0) - Number(a.years_experience || 0) ||
        a.name.localeCompare(b.name)
      );
    }

    if (filterState.sortBy === "soonest_availability") {
      return (
        getWaitPriority(a.estimated_wait_time) - getWaitPriority(b.estimated_wait_time) ||
        getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score ||
        (b.accepting_new_patients === true) - (a.accepting_new_patients === true) ||
        a.name.localeCompare(b.name)
      );
    }

    if (filterState.sortBy === "lowest_fee") {
      var aFee = Number(a.session_fee_min || a.session_fee_max || 999999);
      var bFee = Number(b.session_fee_min || b.session_fee_max || 999999);
      return (
        aFee - bFee ||
        getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score ||
        a.name.localeCompare(b.name)
      );
    }

    if (filterState.sortBy === "freshest_details") {
      return (
        getFreshnessRank(b) - getFreshnessRank(a) ||
        getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score ||
        getMatchScore(b) - getMatchScore(a) ||
        a.name.localeCompare(b.name)
      );
    }

    return (
      getMatchScore(b) - getMatchScore(a) ||
      getFreshnessRank(b) - getFreshnessRank(a) ||
      getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score ||
      a.name.localeCompare(b.name)
    );
  }

  function getFilteredWithFilters(filterState) {
    return applyDirectoryPriorityProminence(
      therapists.filter(function (therapist) {
        var haystack = [
          therapist.name,
          therapist.title,
          therapist.city,
          therapist.state,
          therapist.practice_name,
          therapist.bio_preview,
          therapist.care_approach,
        ]
          .concat(therapist.specialties || [])
          .concat(therapist.insurance_accepted || [])
          .concat(therapist.treatment_modalities || [])
          .concat(therapist.client_populations || [])
          .join(" ")
          .toLowerCase();

        if (filterState.q && !haystack.includes(filterState.q.toLowerCase())) return false;
        if (filterState.state && therapist.state !== filterState.state) return false;
        if (filterState.city && therapist.city.toLowerCase() !== filterState.city.toLowerCase())
          return false;
        if (filterState.specialty && !(therapist.specialties || []).includes(filterState.specialty))
          return false;
        if (
          filterState.modality &&
          !(therapist.treatment_modalities || []).includes(filterState.modality)
        )
          return false;
        if (
          filterState.population &&
          !(therapist.client_populations || []).includes(filterState.population)
        )
          return false;
        if (
          filterState.verification &&
          (therapist.verification_status || "") !== filterState.verification
        )
          return false;
        if (
          filterState.bipolar_experience &&
          Number(therapist.bipolar_years_experience || 0) < Number(filterState.bipolar_experience)
        )
          return false;
        if (
          filterState.insurance &&
          !(therapist.insurance_accepted || []).includes(filterState.insurance)
        )
          return false;
        if (filterState.telehealth && !therapist.accepts_telehealth) return false;
        if (filterState.in_person && !therapist.accepts_in_person) return false;
        if (filterState.accepting && !therapist.accepting_new_patients) return false;
        if (filterState.medication_management && !therapist.medication_management) return false;
        if (filterState.responsive_contact && getResponsivenessRank(therapist) === 0) return false;
        if (filterState.recently_confirmed && getFreshnessRank(therapist) < 2) return false;
        return true;
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
    var root = document.getElementById("directoryTradeoffPreview");
    if (!root) {
      return;
    }

    var scenarios = buildDirectoryTradeoffScenarios(results || []);
    root.classList.toggle("is-empty", !scenarios.length);
    root.innerHTML = scenarios.length
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
      : "";
  }

  function renderCard(therapist) {
    var initials = therapist.name
      .split(" ")
      .map(function (part) {
        return part.charAt(0);
      })
      .join("")
      .slice(0, 2);
    var avatar = therapist.photo_url
      ? '<img src="' +
        escapeHtml(therapist.photo_url) +
        '" alt="' +
        escapeHtml(therapist.name) +
        '" />'
      : escapeHtml(initials);
    var tags = (therapist.specialties || [])
      .slice(0, 3)
      .map(function (specialty) {
        return '<span class="tag">' + escapeHtml(specialty) + "</span>";
      })
      .join("");
    var freshnessBadge = getFreshnessBadgeData(therapist);
    var trustTags = [
      getTherapistMerchandisingQuality(therapist).score >= 90
        ? getTherapistMerchandisingQuality(therapist).label
        : "",
      therapist.verification_status === "editorially_verified" ? "Verified" : "",
      freshnessBadge ? freshnessBadge.label : "",
      getEditoriallyVerifiedOperationalCount(therapist)
        ? getEditoriallyVerifiedOperationalCount(therapist) +
          " key detail" +
          (getEditoriallyVerifiedOperationalCount(therapist) > 1 ? "s" : "") +
          " verified"
        : "",
      therapist.bipolar_years_experience
        ? therapist.bipolar_years_experience + " yrs bipolar care"
        : "",
      getPublicReadinessCopy(therapist),
      (function () {
        var signal = getPublicResponsivenessSignal(therapist);
        return signal ? signal.label : "";
      })(),
      therapist.medication_management ? "Medication management" : "",
    ]
      .filter(Boolean)
      .map(function (tag) {
        return '<span class="tag tele">' + escapeHtml(tag) + "</span>";
      })
      .join("");
    var mode = [
      therapist.accepts_telehealth ? '<span class="tag tele">Telehealth</span>' : "",
      therapist.accepts_in_person ? '<span class="tag inperson">In-Person</span>' : "",
    ].join("");
    var acceptance = therapist.accepting_new_patients
      ? '<span class="accepting">Accepting patients</span>'
      : '<span class="accepting not-acc">Check current openings</span>';
    var fitSummary = buildCardFitSummary(therapist);
    var likelyFitCopy = buildLikelyFitCopy(therapist);
    var shortlisted = isShortlisted(therapist.slug);
    var shortlistEntry = shortlist.find(function (item) {
      return item.slug === therapist.slug;
    });
    var contactRoute = getPreferredContactRoute(therapist);
    var primaryAction = contactRoute
      ? '<a href="' +
        escapeHtml(contactRoute.href) +
        '"' +
        (contactRoute.external ? ' target="_blank" rel="noopener"' : "") +
        ' class="card-action-primary" data-primary-cta="' +
        escapeHtml(therapist.slug) +
        '">' +
        escapeHtml(contactRoute.label) +
        "</a>"
      : '<a href="therapist.html?slug=' +
        encodeURIComponent(therapist.slug) +
        '" class="card-action-primary" data-primary-cta="' +
        escapeHtml(therapist.slug) +
        '">See best next step</a>';
    var contactDetail = contactRoute
      ? '<div class="card-contact-detail">' +
        escapeHtml(therapist.contact_guidance || contactRoute.detail) +
        "</div>"
      : "";
    var reviewedDetailsCopy = buildReviewedDetailsCopy(therapist);
    var operationalTrustCopy = getOperationalTrustSummary(therapist);
    var standoutCopy = buildCardStandoutCopy(therapist);
    var reachabilityCopy = buildCardReachabilityCopy(therapist);
    var trustSnapshot = buildCardTrustSnapshot(therapist);
    var quickStats = [
      {
        label: "Fit",
        value: therapist.bipolar_years_experience
          ? therapist.bipolar_years_experience + " yrs bipolar care"
          : "Check bipolar depth",
        tone: therapist.bipolar_years_experience ? "green" : "teal",
      },
      {
        label: "Timing",
        value:
          therapist.estimated_wait_time ||
          (therapist.accepting_new_patients ? "Accepting" : "Confirm"),
        tone: therapist.estimated_wait_time || therapist.accepting_new_patients ? "green" : "",
      },
      {
        label: "Fees",
        value:
          therapist.session_fee_min || therapist.session_fee_max
            ? "$" +
              escapeHtml(therapist.session_fee_min || therapist.session_fee_max) +
              (therapist.session_fee_max &&
              String(therapist.session_fee_max) !== String(therapist.session_fee_min || "")
                ? "-$" + escapeHtml(therapist.session_fee_max)
                : "")
            : therapist.sliding_scale
              ? "Sliding scale"
              : "Ask directly",
        tone:
          therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale
            ? "teal"
            : "",
      },
    ]
      .map(function (item) {
        return (
          '<div class="card-quick-stat"><div class="card-quick-stat-label">' +
          escapeHtml(item.label) +
          '</div><div class="card-quick-stat-value ' +
          escapeHtml(item.tone || "") +
          '">' +
          item.value +
          "</div></div>"
        );
      })
      .join("");
    var decisionRow = [
      therapist.accepts_telehealth ? "Telehealth" : "",
      therapist.accepts_in_person ? "In-person" : "",
      therapist.medication_management ? "Medication support" : "",
      therapist.insurance_accepted && therapist.insurance_accepted.length
        ? therapist.insurance_accepted.slice(0, 1)[0]
        : "",
    ]
      .filter(Boolean)
      .map(function (item) {
        return '<span class="card-decision-pill">' + escapeHtml(item) + "</span>";
      })
      .join("");
    var nextStepLine = therapist.first_step_expectation
      ? therapist.first_step_expectation
      : contactRoute
        ? contactRoute.detail
        : "Open the profile to confirm the best next step.";

    return (
      '<article class="t-card" data-card-slug="' +
      escapeHtml(therapist.slug) +
      '">' +
      '<div class="t-card-top">' +
      '<div class="t-avatar">' +
      avatar +
      "</div>" +
      '<div class="t-info">' +
      '<div class="t-name">' +
      escapeHtml(therapist.name) +
      "</div>" +
      '<div class="t-creds">' +
      escapeHtml(therapist.credentials) +
      (therapist.title ? " · " + escapeHtml(therapist.title) : "") +
      "</div>" +
      '<div class="t-loc">📍 ' +
      escapeHtml(therapist.city) +
      ", " +
      escapeHtml(therapist.state) +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="t-bio">' +
      escapeHtml(therapist.bio_preview || therapist.bio || "") +
      "</div>" +
      (freshnessBadge
        ? '<div class="card-freshness-banner tone-' +
          escapeHtml(freshnessBadge.tone) +
          '"><div class="card-freshness-label">Freshness</div><div class="card-freshness-value">' +
          escapeHtml(freshnessBadge.label) +
          '</div><div class="card-freshness-note">' +
          escapeHtml(freshnessBadge.note) +
          "</div></div>"
        : "") +
      '<div class="t-fit-summary">' +
      escapeHtml(fitSummary) +
      '</div><div class="card-fit-note">' +
      escapeHtml(likelyFitCopy) +
      "</div>" +
      '<div class="card-quick-stats">' +
      quickStats +
      "</div>" +
      (decisionRow ? '<div class="card-decision-row">' + decisionRow + "</div>" : "") +
      '<div class="card-signal-card">' +
      '<div class="card-signal-label">Why this stands out</div>' +
      '<div class="card-signal-copy">' +
      escapeHtml(standoutCopy) +
      "</div></div>" +
      '<div class="card-signal-card card-signal-card-soft">' +
      '<div class="card-signal-label">Reachability</div>' +
      '<div class="card-signal-copy">' +
      escapeHtml(reachabilityCopy) +
      "</div></div>" +
      '<div class="tags">' +
      tags +
      trustTags +
      mode +
      "</div>" +
      '<div class="card-contact-detail"><strong>Reviewed strength:</strong> ' +
      escapeHtml(trustSnapshot) +
      "</div>" +
      (operationalTrustCopy && operationalTrustCopy !== trustSnapshot
        ? '<div class="card-contact-detail">' + escapeHtml(operationalTrustCopy) + "</div>"
        : "") +
      (reviewedDetailsCopy && reviewedDetailsCopy !== trustSnapshot
        ? '<div class="card-contact-detail">' + escapeHtml(reviewedDetailsCopy) + "</div>"
        : "") +
      '<div class="card-next-step"><div class="card-next-step-label">Best next step</div><div class="card-next-step-copy">' +
      escapeHtml(nextStepLine) +
      "</div></div>" +
      contactDetail +
      '<div class="card-actions">' +
      '<button class="card-action-btn' +
      (shortlisted ? " active" : "") +
      '" data-shortlist-slug="' +
      escapeHtml(therapist.slug) +
      '" type="button">' +
      (shortlisted ? "Saved to shortlist" : "Save to shortlist") +
      "</button>" +
      primaryAction +
      '<a href="therapist.html?slug=' +
      encodeURIComponent(therapist.slug) +
      '" class="card-action-link" data-review-fit="' +
      escapeHtml(therapist.slug) +
      '">View profile</a>' +
      "</div>" +
      (shortlisted
        ? '<div class="card-priority-row"><label class="card-priority-label" for="priority-' +
          escapeHtml(therapist.slug) +
          '">Priority</label><select class="card-priority-select" id="priority-' +
          escapeHtml(therapist.slug) +
          '" data-shortlist-priority="' +
          escapeHtml(therapist.slug) +
          '"><option value="">No label yet</option>' +
          SHORTLIST_PRIORITY_OPTIONS.map(function (option) {
            return (
              '<option value="' +
              escapeHtml(option) +
              '"' +
              (shortlistEntry && shortlistEntry.priority === option ? " selected" : "") +
              ">" +
              escapeHtml(option) +
              "</option>"
            );
          }).join("") +
          '</select></div><div class="card-note-row"><label class="card-priority-label" for="note-' +
          escapeHtml(therapist.slug) +
          '">Note</label><input class="card-note-input" id="note-' +
          escapeHtml(therapist.slug) +
          '" data-shortlist-note="' +
          escapeHtml(therapist.slug) +
          '" type="text" maxlength="120" placeholder="Add a quick reminder..." value="' +
          escapeHtml(shortlistEntry && shortlistEntry.note ? shortlistEntry.note : "") +
          '" /></div>'
        : "") +
      '<div class="t-footer">' +
      acceptance +
      '<span class="view-link">' +
      escapeHtml(contactRoute ? contactRoute.label : "Shortlist-ready") +
      "</span>" +
      "</div>" +
      "</article>"
    );
  }

  function renderShortlistBar() {
    var root = document.getElementById("directoryShortlistBar");
    if (!root) {
      return;
    }

    if (!shortlist.length) {
      root.innerHTML =
        '<div class="shortlist-bar-copy"><strong>Your compare list is empty.</strong><span>Save up to 3 therapists to narrow your options before you reach out.</span></div><a href="match.html" class="shortlist-bar-link">Start guided match</a>';
      return;
    }

    var selected = shortlist
      .map(function (entry) {
        return therapists.find(function (item) {
          return item.slug === entry.slug;
        });
      })
      .filter(Boolean);
    var compareRows = selected
      .map(function (therapist) {
        var entry = shortlist.find(function (item) {
          return item.slug === therapist.slug;
        });
        return (
          '<div class="shortlist-compare-card"><div class="shortlist-compare-name">' +
          escapeHtml(therapist.name) +
          '</div><div class="shortlist-compare-meta">' +
          escapeHtml(
            [
              therapist.bipolar_years_experience
                ? therapist.bipolar_years_experience + " yrs bipolar care"
                : "Bipolar depth to confirm",
              therapist.estimated_wait_time ||
                (therapist.accepting_new_patients ? "Accepting" : "Timing to confirm"),
              therapist.session_fee_min || therapist.session_fee_max
                ? "$" +
                  String(therapist.session_fee_min || therapist.session_fee_max) +
                  (therapist.session_fee_max &&
                  String(therapist.session_fee_max) !== String(therapist.session_fee_min || "")
                    ? "-$" + String(therapist.session_fee_max)
                    : "")
                : therapist.sliding_scale
                  ? "Sliding scale"
                  : "Fee details pending",
              getFreshnessBadgeData(therapist)
                ? getFreshnessBadgeData(therapist).label
                : "Freshness to confirm",
            ].join(" • "),
          ) +
          '</div><div class="shortlist-compare-note">' +
          escapeHtml(
            entry && entry.note
              ? entry.note
              : entry && entry.priority
                ? entry.priority
                : buildCardFitSummary(therapist),
          ) +
          '</div><a href="therapist.html?slug=' +
          encodeURIComponent(therapist.slug) +
          '" class="shortlist-compare-link">Open profile</a></div>'
        );
      })
      .join("");

    root.innerHTML =
      '<div class="shortlist-bar-copy"><strong>' +
      selected.length +
      " saved for comparison</strong><span>" +
      shortlist
        .map(function (entry) {
          var therapist = therapists.find(function (item) {
            return item.slug === entry.slug;
          });
          if (!therapist) {
            return "";
          }
          return (
            escapeHtml(therapist.name) +
            (entry.priority ? " · " + escapeHtml(entry.priority) : "") +
            (entry.note ? " · " + escapeHtml(entry.note) : "")
          );
        })
        .filter(Boolean)
        .join(" • ") +
      '</span></div><div class="shortlist-bar-actions"><a href="' +
      escapeHtml(buildCompareUrl()) +
      '" class="shortlist-bar-link">Compare in match flow</a><button type="button" class="shortlist-bar-clear" id="clearDirectoryShortlist">Clear</button></div>' +
      (compareRows ? '<div class="shortlist-compare-grid">' + compareRows + "</div>" : "");

    var clearButton = document.getElementById("clearDirectoryShortlist");
    if (clearButton) {
      clearButton.addEventListener("click", function () {
        writeShortlist([]);
        render();
      });
    }
  }

  function renderPagination(total) {
    var pages = Math.ceil(total / pageSize);
    var root = document.getElementById("pagination");
    if (pages <= 1) {
      root.innerHTML = "";
      return;
    }

    var html = "";
    if (currentPage > 1) {
      html += '<button class="page-btn" data-page="' + (currentPage - 1) + '">← Prev</button>';
    }

    for (var i = 1; i <= pages; i += 1) {
      if (i === currentPage) {
        html += '<button class="page-btn active">' + i + "</button>";
      } else if (i <= 3 || i > pages - 2 || Math.abs(i - currentPage) <= 1) {
        html += '<button class="page-btn" data-page="' + i + '">' + i + "</button>";
      } else if ((i === 4 && currentPage > 4) || (i === pages - 2 && currentPage < pages - 3)) {
        html += '<span style="padding:.4rem .5rem;color:var(--muted)">…</span>';
      }
    }

    if (currentPage < pages) {
      html += '<button class="page-btn" data-page="' + (currentPage + 1) + '">Next →</button>';
    }

    root.innerHTML = html;
    root.querySelectorAll("[data-page]").forEach(function (button) {
      button.addEventListener("click", function () {
        currentPage = Number(button.getAttribute("data-page"));
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }

  function render() {
    var results = getFiltered();
    var start = (currentPage - 1) * pageSize;
    var pageItems = results.slice(start, start + pageSize);
    var grid = document.getElementById("resultsGrid");
    var count = document.getElementById("resultsCount");
    var filterCount = document.getElementById("filterCount");
    var resultsSuffix = (directoryPage && directoryPage.resultsSuffix) || "specialists found";
    var singularSuffix = resultsSuffix === "specialists found" ? "specialist found" : resultsSuffix;
    var activeFilterCount = Object.keys(filters).filter(function (key) {
      return key !== "sortBy" && Boolean(filters[key]);
    }).length;

    count.innerHTML =
      "<strong>" +
      results.length +
      "</strong> " +
      (results.length === 1 ? singularSuffix : resultsSuffix);
    filterCount.textContent = activeFilterCount ? "(" + activeFilterCount + ")" : "";

    if (!pageItems.length) {
      grid.innerHTML =
        '<div class="empty-state"><h3>' +
        escapeHtml((directoryPage && directoryPage.emptyStateTitle) || "No therapists found") +
        "</h3><p>" +
        escapeHtml(
          (directoryPage && directoryPage.emptyStateDescription) ||
            "Try adjusting your filters or search terms.",
        ) +
        "</p></div>";
      renderDirectoryTradeoffPreview([]);
      renderEditorialLanes([]);
      renderDirectoryLaunchExplainer([]);
      renderDirectoryAdaptiveExplainer();
      renderPagination(0);
      renderShortlistBar();
      updateUrl();
      return;
    }

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
      var shortlistBar = document.getElementById("directoryShortlistBar");
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

  window.applyFilters = function () {
    [
      "q",
      "state",
      "city",
      "specialty",
      "modality",
      "population",
      "verification",
      "bipolar_experience",
      "insurance",
      "sortBy",
    ].forEach(function (key) {
      filters[key] = document.getElementById(key).value.trim();
    });
    [
      "telehealth",
      "in_person",
      "accepting",
      "medication_management",
      "responsive_contact",
      "recently_confirmed",
    ].forEach(function (key) {
      filters[key] = document.getElementById(key).checked;
    });
    trackFunnelEvent("directory_filters_applied", {
      active_filter_count: Object.keys(filters).filter(function (key) {
        return key !== "sortBy" && Boolean(filters[key]);
      }).length,
      sort_by: filters.sortBy,
    });
    currentPage = 1;
    render();
  };

  window.resetFilters = function () {
    document.querySelectorAll("input, select").forEach(function (input) {
      if (input.type === "checkbox") {
        input.checked = false;
      } else {
        input.value = "";
      }
    });
    document.getElementById("sortBy").value = defaultFilters.sortBy;
    filters = { ...defaultFilters };
    currentPage = 1;
    render();
  };

  window.toggleFilters = function () {
    document.getElementById("sidebar").classList.toggle("hidden-mobile");
  };

  function syncSidebarForViewport() {
    var sidebar = document.getElementById("sidebar");
    if (!sidebar) {
      return;
    }

    if (window.innerWidth <= 860) {
      sidebar.classList.add("hidden-mobile");
    } else {
      sidebar.classList.remove("hidden-mobile");
    }
  }

  document.getElementById("sortBy").addEventListener("change", function () {
    filters.sortBy = document.getElementById("sortBy").value;
    trackFunnelEvent("directory_sort_changed", {
      sort_by: filters.sortBy,
    });
    currentPage = 1;
    render();
  });

  window.addEventListener("resize", syncSidebarForViewport);

  document.addEventListener("keydown", function (event) {
    if (
      event.key === "Enter" &&
      (event.target.tagName === "INPUT" || event.target.tagName === "SELECT")
    ) {
      window.applyFilters();
    }
  });

  applySiteSettings();
  applyDirectoryCopy();
  initializeFilters();
  syncSidebarForViewport();
  render();
})();
