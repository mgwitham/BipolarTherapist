var FUNNEL_EVENTS_KEY = "bth_funnel_events_v1";
var EXPERIMENT_ASSIGNMENTS_KEY = "bth_experiment_assignments_v1";
var EXPERIMENT_EXPOSURES_KEY = "bth_experiment_exposures_v1";
var EXPERIMENT_PROMOTIONS_KEY = "bth_experiment_promotions_v1";

export function readFunnelEvents() {
  try {
    return JSON.parse(window.localStorage.getItem(FUNNEL_EVENTS_KEY) || "[]");
  } catch (_error) {
    return [];
  }
}

export function trackFunnelEvent(type, payload) {
  if (!type) {
    return;
  }

  var events = readFunnelEvents();
  events.unshift({
    type: String(type),
    created_at: new Date().toISOString(),
    payload: payload || {},
  });

  try {
    window.localStorage.setItem(FUNNEL_EVENTS_KEY, JSON.stringify(events.slice(0, 250)));
  } catch (_error) {
    return;
  }
}

function readExperimentAssignments() {
  try {
    return JSON.parse(window.localStorage.getItem(EXPERIMENT_ASSIGNMENTS_KEY) || "{}");
  } catch (_error) {
    return {};
  }
}

function writeExperimentAssignments(value) {
  try {
    window.localStorage.setItem(EXPERIMENT_ASSIGNMENTS_KEY, JSON.stringify(value || {}));
  } catch (_error) {
    return;
  }
}

function readExperimentExposures() {
  try {
    return JSON.parse(window.localStorage.getItem(EXPERIMENT_EXPOSURES_KEY) || "{}");
  } catch (_error) {
    return {};
  }
}

function writeExperimentExposures(value) {
  try {
    window.localStorage.setItem(EXPERIMENT_EXPOSURES_KEY, JSON.stringify(value || {}));
  } catch (_error) {
    return;
  }
}

function readExperimentPromotions() {
  try {
    return JSON.parse(window.localStorage.getItem(EXPERIMENT_PROMOTIONS_KEY) || "{}");
  } catch (_error) {
    return {};
  }
}

function writeExperimentPromotions(value) {
  try {
    window.localStorage.setItem(EXPERIMENT_PROMOTIONS_KEY, JSON.stringify(value || {}));
  } catch (_error) {
    return;
  }
}

export function getPromotedExperimentVariant(name) {
  var promotions = readExperimentPromotions();
  return promotions[String(name || "").trim()] || "";
}

export function setPromotedExperimentVariant(name, variant) {
  var experimentName = String(name || "").trim();
  var experimentVariant = String(variant || "").trim();
  if (!experimentName) {
    return;
  }
  var promotions = readExperimentPromotions();
  if (!experimentVariant) {
    delete promotions[experimentName];
  } else {
    promotions[experimentName] = experimentVariant;
  }
  writeExperimentPromotions(promotions);
}

export function getExperimentVariant(name, variants) {
  var experimentName = String(name || "").trim();
  var options = Array.isArray(variants) ? variants.filter(Boolean) : [];
  if (!experimentName || !options.length) {
    return "";
  }

  var promoted = getPromotedExperimentVariant(experimentName);
  if (promoted && options.includes(promoted)) {
    return promoted;
  }

  var assignments = readExperimentAssignments();
  if (assignments[experimentName] && options.includes(assignments[experimentName])) {
    return assignments[experimentName];
  }

  var selected = options[Math.floor(Math.random() * options.length)] || options[0];
  assignments[experimentName] = selected;
  writeExperimentAssignments(assignments);
  return selected;
}

export function trackExperimentExposure(name, variant, payload) {
  var experimentName = String(name || "").trim();
  var experimentVariant = String(variant || "").trim();
  if (!experimentName || !experimentVariant) {
    return;
  }

  var exposures = readExperimentExposures();
  var key = experimentName + "::" + experimentVariant;
  if (exposures[key]) {
    return;
  }

  exposures[key] = new Date().toISOString();
  writeExperimentExposures(exposures);
  trackFunnelEvent("experiment_exposed", {
    experiment_name: experimentName,
    variant: experimentVariant,
    context: payload || {},
  });
}

export function summarizeFunnelEvents(events) {
  var entries = Array.isArray(events) ? events : [];
  var byType = entries.reduce(function (accumulator, item) {
    if (!item || !item.type) {
      return accumulator;
    }
    accumulator[item.type] = (accumulator[item.type] || 0) + 1;
    return accumulator;
  }, {});

  var outreachStartTypes = [
    "match_recommended_outreach_started",
    "match_fallback_outreach_started",
    "match_entry_outreach_started",
  ];
  var contactIntentTypes = outreachStartTypes.concat([
    "match_recommended_draft_copied",
    "match_fallback_draft_copied",
    "match_entry_draft_copied",
    "match_outreach_plan_copied",
    "match_pivot_reminder_copied",
    "match_result_profile_opened",
  ]);

  function sumTypes(types) {
    return (types || []).reduce(function (total, type) {
      return total + (byType[type] || 0);
    }, 0);
  }

  return {
    total: entries.length,
    searches: (byType.home_search_submitted || 0) + (byType.directory_filters_applied || 0),
    matches: byType.match_submitted || 0,
    shortlist_saves: (byType.directory_shortlist_saved || 0) + (byType.match_shortlist_saved || 0),
    help_requests: (byType.match_help_requested || 0) + (byType.match_concierge_requested || 0),
    outreach_starts: sumTypes(outreachStartTypes),
    contact_intents: sumTypes(contactIntentTypes),
    top_types: Object.keys(byType)
      .map(function (key) {
        return { type: key, count: byType[key] };
      })
      .sort(function (a, b) {
        return b.count - a.count || a.type.localeCompare(b.type);
      })
      .slice(0, 6),
  };
}

export function summarizePatientJourney(events) {
  var entries = Array.isArray(events) ? events : [];
  var byType = entries.reduce(function (accumulator, item) {
    if (!item || !item.type) {
      return accumulator;
    }
    accumulator[item.type] = (accumulator[item.type] || 0) + 1;
    return accumulator;
  }, {});

  function count(type) {
    return byType[type] || 0;
  }

  var stages = [
    {
      key: "homepage_start",
      label: "Homepage starts",
      count: count("home_match_started"),
      note: "Users who began the guided match from the homepage hero.",
    },
    {
      key: "match_submit",
      label: "Matches completed",
      count: count("match_submitted"),
      note: "Users who made it through intake and generated a shortlist.",
    },
    {
      key: "shortlist_action",
      label: "Shortlist actions",
      count:
        count("match_primary_cta_clicked") +
        count("match_result_profile_opened") +
        count("match_entry_draft_copied") +
        count("match_recommended_draft_copied"),
      note: "Users who engaged with the shortlist rather than stopping at results.",
    },
    {
      key: "first_outreach",
      label: "First outreach moves",
      count:
        count("match_recommended_outreach_started") +
        count("match_entry_outreach_started") +
        count("match_primary_cta_clicked"),
      note: "Users who took an initial contact-oriented step on a provider.",
    },
    {
      key: "fallback_or_recovery",
      label: "Recovery moves",
      count: count("match_fallback_outreach_started") + count("match_recovery_clicked"),
      note: "Users who recovered through fallback outreach or no-results rerouting.",
    },
  ];

  var dropoffs = [];
  for (var index = 0; index < stages.length - 1; index += 1) {
    var current = stages[index];
    var next = stages[index + 1];
    var drop = Math.max(0, current.count - next.count);
    var rate = current.count ? drop / current.count : 0;
    dropoffs.push({
      from: current.key,
      to: next.key,
      from_label: current.label,
      to_label: next.label,
      drop_count: drop,
      drop_rate: rate,
    });
  }

  var biggestDropoff =
    dropoffs.sort(function (a, b) {
      return b.drop_rate - a.drop_rate || b.drop_count - a.drop_count;
    })[0] || null;

  var outcomeActions =
    count("match_recommended_outreach_started") +
    count("match_fallback_outreach_started") +
    count("match_entry_outreach_started") +
    count("match_recommended_draft_copied") +
    count("match_fallback_draft_copied") +
    count("match_entry_draft_copied");

  return {
    stages: stages,
    biggest_dropoff: biggestDropoff,
    recovery_moves: count("match_recovery_clicked"),
    refinement_opens: count("match_refinements_opened"),
    direct_outreach_actions: outcomeActions,
  };
}

export function summarizeExperimentPerformance(events) {
  var entries = Array.isArray(events) ? events : [];
  var buckets = {};

  function ensureBucket(experimentName, variant) {
    var key = experimentName + "::" + variant;
    if (!buckets[key]) {
      buckets[key] = {
        experiment_name: experimentName,
        variant: variant,
        exposures: 0,
        homepage_starts: 0,
        matches: 0,
        shortlist_actions: 0,
        outreach_starts: 0,
      };
    }
    return buckets[key];
  }

  entries.forEach(function (item) {
    if (!item || !item.type) {
      return;
    }

    if (item.type === "experiment_exposed") {
      var experimentName =
        item.payload && item.payload.experiment_name ? item.payload.experiment_name : "";
      var variant = item.payload && item.payload.variant ? item.payload.variant : "";
      if (!experimentName || !variant) {
        return;
      }
      ensureBucket(experimentName, variant).exposures += 1;
      return;
    }

    var experiments =
      item.payload && item.payload.experiments && typeof item.payload.experiments === "object"
        ? item.payload.experiments
        : null;
    if (!experiments) {
      return;
    }

    Object.keys(experiments).forEach(function (experimentName) {
      var variant = experiments[experimentName];
      if (!variant) {
        return;
      }
      var bucket = ensureBucket(experimentName, variant);
      if (item.type === "home_match_started") {
        bucket.homepage_starts += 1;
      } else if (item.type === "match_submitted") {
        bucket.matches += 1;
      } else if (
        item.type === "match_primary_cta_clicked" ||
        item.type === "match_result_profile_opened" ||
        item.type === "match_recommended_draft_copied" ||
        item.type === "match_entry_draft_copied"
      ) {
        bucket.shortlist_actions += 1;
      } else if (
        item.type === "match_recommended_outreach_started" ||
        item.type === "match_fallback_outreach_started" ||
        item.type === "match_entry_outreach_started"
      ) {
        bucket.outreach_starts += 1;
      }
    });
  });

  return Object.keys(buckets)
    .map(function (key) {
      var bucket = buckets[key];
      bucket.match_rate = bucket.exposures ? bucket.matches / bucket.exposures : 0;
      bucket.shortlist_action_rate = bucket.matches ? bucket.shortlist_actions / bucket.matches : 0;
      bucket.outreach_rate = bucket.matches ? bucket.outreach_starts / bucket.matches : 0;
      bucket.composite_score = bucket.match_rate * 0.35 + bucket.outreach_rate * 0.65;
      return bucket;
    })
    .sort(function (a, b) {
      return (
        a.experiment_name.localeCompare(b.experiment_name) ||
        b.composite_score - a.composite_score ||
        b.outreach_starts - a.outreach_starts ||
        a.variant.localeCompare(b.variant)
      );
    });
}

export function summarizeExperimentDecisions(events) {
  var performance = summarizeExperimentPerformance(events);
  var grouped = {};

  performance.forEach(function (item) {
    if (!grouped[item.experiment_name]) {
      grouped[item.experiment_name] = [];
    }
    grouped[item.experiment_name].push(item);
  });

  return Object.keys(grouped)
    .map(function (experimentName) {
      var variants = grouped[experimentName].slice().sort(function (a, b) {
        return (
          b.composite_score - a.composite_score ||
          b.outreach_rate - a.outreach_rate ||
          b.match_rate - a.match_rate ||
          a.variant.localeCompare(b.variant)
        );
      });
      var winner = variants[0] || null;
      var runnerUp = variants[1] || null;
      var promoted = getPromotedExperimentVariant(experimentName);
      var confidence =
        winner && runnerUp && winner.exposures >= 5 && runnerUp.exposures >= 5
          ? winner.composite_score - runnerUp.composite_score
          : 0;

      return {
        experiment_name: experimentName,
        variants: variants,
        winner: winner,
        promoted_variant: promoted,
        confidence_gap: confidence,
        recommendation:
          winner && confidence >= 0.08
            ? "Promising winner"
            : winner && winner.exposures >= 5
              ? "Too early to call"
              : "Needs more traffic",
      };
    })
    .sort(function (a, b) {
      return a.experiment_name.localeCompare(b.experiment_name);
    });
}

export function summarizeAdaptiveSignals(events, outcomes, activeSegments) {
  var entries = Array.isArray(events) ? events : [];
  var outcomeEntries = Array.isArray(outcomes) ? outcomes : [];
  var segmentFilter = Array.isArray(activeSegments) ? activeSegments.filter(Boolean) : [];

  function matchesSegments(itemSegments) {
    if (!segmentFilter.length) {
      return true;
    }
    var normalized = Array.isArray(itemSegments) ? itemSegments : [];
    return segmentFilter.some(function (segment) {
      return normalized.includes(segment);
    });
  }

  var filteredEntries = entries.filter(function (item) {
    var itemSegments =
      item && item.payload && item.payload.strategy && Array.isArray(item.payload.strategy.segments)
        ? item.payload.strategy.segments
        : [];
    return matchesSegments(itemSegments);
  });

  var filteredOutcomeEntries = outcomeEntries.filter(function (item) {
    var itemSegments =
      item && item.context && item.context.strategy && Array.isArray(item.context.strategy.segments)
        ? item.context.strategy.segments
        : [];
    return matchesSegments(itemSegments);
  });
  var sortCounts = {
    best_match: 0,
    soonest_availability: 0,
    most_experienced: 0,
    most_responsive: 0,
    lowest_fee: 0,
  };

  filteredEntries.forEach(function (item) {
    var sortBy = item && item.payload ? item.payload.sort_by : "";
    if (sortBy && Object.prototype.hasOwnProperty.call(sortCounts, sortBy)) {
      sortCounts[sortBy] += 1;
    }
  });

  var actionCounts = {
    outreach: 0,
    help: 0,
    save: 0,
  };

  filteredEntries.forEach(function (item) {
    if (!item || !item.type) {
      return;
    }

    if (
      item.type === "match_recommended_outreach_started" ||
      item.type === "match_recommended_draft_copied" ||
      item.type === "match_fallback_outreach_started" ||
      item.type === "match_fallback_draft_copied" ||
      item.type === "match_entry_outreach_started" ||
      item.type === "match_entry_draft_copied" ||
      item.type === "match_outreach_plan_copied" ||
      item.type === "match_pivot_reminder_copied" ||
      item.type === "match_result_profile_opened"
    ) {
      actionCounts.outreach += 1;
      return;
    }

    if (item.type === "match_help_requested" || item.type === "match_concierge_requested") {
      actionCounts.help += 1;
      return;
    }

    if (item.type === "match_shortlist_saved" || item.type === "match_share_link_copied") {
      actionCounts.save += 1;
    }
  });

  var preferredDirectorySort = Object.keys(sortCounts).sort(function (a, b) {
    return sortCounts[b] - sortCounts[a] || a.localeCompare(b);
  })[0];
  var preferredMatchActionByVolume = Object.keys(actionCounts).sort(function (a, b) {
    return actionCounts[b] - actionCounts[a] || a.localeCompare(b);
  })[0];

  var strategyPerformance = {
    outreach: { strong: 0, friction: 0 },
    help: { strong: 0, friction: 0 },
    save: { strong: 0, friction: 0 },
  };

  filteredOutcomeEntries.forEach(function (item) {
    var strategy =
      item &&
      item.context &&
      item.context.strategy &&
      item.context.strategy.match_action &&
      Object.prototype.hasOwnProperty.call(strategyPerformance, item.context.strategy.match_action)
        ? item.context.strategy.match_action
        : "";
    if (!strategy) {
      return;
    }

    if (["heard_back", "booked_consult", "good_fit_call"].includes(item.outcome)) {
      strategyPerformance[strategy].strong += 1;
    } else if (["no_response", "waitlist", "insurance_mismatch"].includes(item.outcome)) {
      strategyPerformance[strategy].friction += 1;
    }
  });

  var strategyScores = Object.keys(strategyPerformance).reduce(function (accumulator, key) {
    accumulator[key] =
      strategyPerformance[key].strong * 3 +
      actionCounts[key] -
      strategyPerformance[key].friction * 2;
    return accumulator;
  }, {});

  var preferredMatchActionByOutcome = Object.keys(strategyScores).sort(function (a, b) {
    return strategyScores[b] - strategyScores[a] || a.localeCompare(b);
  })[0];

  var preferredHomeMode =
    preferredDirectorySort === "soonest_availability"
      ? "speed"
      : preferredDirectorySort === "most_experienced"
        ? "specialization"
        : preferredDirectorySort === "most_responsive"
          ? "contact"
          : "trust";

  var totalOutcomeSignals = filteredOutcomeEntries.filter(function (item) {
    return (
      item &&
      item.context &&
      item.context.strategy &&
      item.context.strategy.match_action &&
      (["heard_back", "booked_consult", "good_fit_call"].includes(item.outcome) ||
        ["no_response", "waitlist", "insurance_mismatch"].includes(item.outcome))
    );
  }).length;

  var useOutcomeDrivenPreference =
    totalOutcomeSignals >= 3 &&
    strategyScores[preferredMatchActionByOutcome] > strategyScores[preferredMatchActionByVolume];

  var matchActionPreference = useOutcomeDrivenPreference
    ? preferredMatchActionByOutcome
    : actionCounts[preferredMatchActionByVolume] > 0
      ? preferredMatchActionByVolume
      : "help";

  var matchActionCopy =
    matchActionPreference === "outreach"
      ? {
          title: "People like you often move fastest by starting one clear outreach.",
          body: "This shortlist will lean a little more toward the best next contact step and a message you can send now.",
          status:
            "This shortlist is ready for action. Start with the recommended outreach if you want the clearest next move.",
          request_help_label: "Still want help narrowing this?",
          save_label: "Save for later",
        }
      : matchActionPreference === "save"
        ? {
            title: "People like you often save first, then come back with more confidence.",
            body: "This shortlist will lean a little more toward comparison, saving, and carrying the options forward.",
            status:
              "If you are not ready to reach out yet, save this shortlist or copy the share link and come back.",
            request_help_label: "Need help narrowing this?",
            save_label: "Save this shortlist",
          }
        : {
            title: "People like you often want help narrowing before reaching out.",
            body: "This shortlist will lean a little more toward guided decision support and a calm next-step recommendation.",
            status:
              "If the shortlist feels close but not obvious, use the help flow to narrow who to contact first.",
            request_help_label: "Help me narrow this",
            save_label: "Save this shortlist",
          };

  return {
    segment_filter: segmentFilter,
    sort_counts: sortCounts,
    action_counts: actionCounts,
    strategy_performance: strategyPerformance,
    strategy_scores: strategyScores,
    preferred_directory_sort:
      sortCounts[preferredDirectorySort] > 0 ? preferredDirectorySort : "best_match",
    preferred_home_mode: preferredHomeMode,
    preferred_match_action: matchActionPreference,
    match_action_basis: useOutcomeDrivenPreference ? "outcomes" : "behavior",
    match_action_copy: matchActionCopy,
  };
}
