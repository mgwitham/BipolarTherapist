import { fetchDirectoryPageContent } from "./cms.js";
import { getTherapistMatchReadiness, getTherapistMerchandisingQuality } from "./matching-model.js";
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
  var directoryPage = content.directoryPage || null;
  var siteSettings = content.siteSettings || null;
  var currentPage = 1;
  var pageSize = 12;
  var defaultFilters = {
    q: "",
    state: "",
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
              : "balancing trust, fit, and decision-readiness";

    root.textContent =
      "For " +
      audience +
      ", the directory is currently " +
      emphasis +
      ". That emphasis is guided by " +
      basis +
      " in similar browsing patterns.";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

    ["telehealth", "in_person", "accepting", "medication_management", "responsive_contact"].forEach(
      function (key) {
        if (params.get(key) === "true") {
          filters[key] = true;
          document.getElementById(key).checked = true;
        }
      },
    );

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
    if (filters.verification && therapist.verification_status === filters.verification) {
      score += 14;
    }

    score += Math.round(quality.score * 0.45);
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

    return (
      getMatchScore(b) - getMatchScore(a) ||
      getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score ||
      a.name.localeCompare(b.name)
    );
  }

  function getFilteredWithFilters(filterState) {
    return therapists
      .filter(function (therapist) {
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
        return true;
      })
      .sort(function (a, b) {
        return compareTherapistsWithFilters(filterState, a, b);
      });
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
    var trustTags = [
      getTherapistMerchandisingQuality(therapist).score >= 90
        ? getTherapistMerchandisingQuality(therapist).label
        : "",
      therapist.verification_status === "editorially_verified" ? "Verified" : "",
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
      : '<span class="accepting not-acc">Waitlist only</span>';
    var fitSummary = buildCardFitSummary(therapist);
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
      '<div class="t-fit-summary">' +
      escapeHtml(fitSummary) +
      "</div>" +
      '<div class="tags">' +
      tags +
      trustTags +
      mode +
      "</div>" +
      contactDetail +
      '<div class="card-actions">' +
      '<button class="card-action-btn' +
      (shortlisted ? " active" : "") +
      '" data-shortlist-slug="' +
      escapeHtml(therapist.slug) +
      '" type="button">' +
      (shortlisted ? "Saved for compare" : "Save for compare") +
      "</button>" +
      primaryAction +
      '<a href="therapist.html?slug=' +
      encodeURIComponent(therapist.slug) +
      '" class="card-action-link" data-review-fit="' +
      escapeHtml(therapist.slug) +
      '">Review fit</a>' +
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
      '" class="shortlist-bar-link">Compare in match flow</a><button type="button" class="shortlist-bar-clear" id="clearDirectoryShortlist">Clear</button></div>';

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
      renderDirectoryAdaptiveExplainer();
      renderPagination(0);
      renderShortlistBar();
      updateUrl();
      return;
    }

    renderDirectoryTradeoffPreview(results);
    renderEditorialLanes(results);
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
    ["telehealth", "in_person", "accepting", "medication_management", "responsive_contact"].forEach(
      function (key) {
        filters[key] = document.getElementById(key).checked;
      },
    );
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
