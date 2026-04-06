var FUNNEL_EVENTS_KEY = "bth_funnel_events_v1";

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
