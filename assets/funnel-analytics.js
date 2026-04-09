var FUNNEL_EVENTS_KEY = "bth_funnel_events_v1";
var EXPERIMENT_ASSIGNMENTS_KEY = "bth_experiment_assignments_v1";
var EXPERIMENT_EXPOSURES_KEY = "bth_experiment_exposures_v1";
var EXPERIMENT_PROMOTIONS_KEY = "bth_experiment_promotions_v1";
var THERAPIST_CONTACT_ROUTE_MEMORY_KEY = "bth_therapist_contact_route_memory_v1";

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

function readTherapistContactRouteMemory() {
  try {
    return JSON.parse(window.localStorage.getItem(THERAPIST_CONTACT_ROUTE_MEMORY_KEY) || "{}");
  } catch (_error) {
    return {};
  }
}

function writeTherapistContactRouteMemory(value) {
  try {
    window.localStorage.setItem(THERAPIST_CONTACT_ROUTE_MEMORY_KEY, JSON.stringify(value || {}));
  } catch (_error) {
    return;
  }
}

export function rememberTherapistContactRoute(therapistSlug, route, source) {
  var slug = String(therapistSlug || "").trim();
  var routeValue = String(route || "").trim();
  if (!slug || !routeValue) {
    return;
  }
  var memory = readTherapistContactRouteMemory();
  memory[slug] = {
    therapist_slug: slug,
    route: routeValue,
    source: String(source || "profile"),
    recorded_at: new Date().toISOString(),
  };
  writeTherapistContactRouteMemory(memory);
}

export function readRememberedTherapistContactRoute(therapistSlug) {
  var slug = String(therapistSlug || "").trim();
  if (!slug) {
    return null;
  }
  var memory = readTherapistContactRouteMemory();
  var entry = memory[slug];
  if (!entry || !entry.recorded_at) {
    return null;
  }
  var ageMs = Date.now() - new Date(entry.recorded_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs > 21 * 24 * 60 * 60 * 1000) {
    return null;
  }
  return entry;
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

export function summarizeProfileContactSignals(events) {
  var entries = Array.isArray(events) ? events : [];
  var routeCounts = {
    booking: 0,
    website: 0,
    phone: 0,
    email: 0,
    unknown: 0,
  };
  var profileCounts = {};
  var sectionViews = 0;
  var scriptEngagements = 0;
  var questionEngagements = 0;
  var variantBuckets = {};

  function ensureVariant(variant) {
    var key = String(variant || "unknown");
    if (!variantBuckets[key]) {
      variantBuckets[key] = {
        variant: key,
        exposures: 0,
        route_clicks: 0,
        script_engagements: 0,
        question_engagements: 0,
      };
    }
    return variantBuckets[key];
  }

  entries.forEach(function (item) {
    if (!item || !item.type) {
      return;
    }

    if (
      item.type === "experiment_exposed" &&
      item.payload &&
      item.payload.experiment_name === "therapist_contact_guidance"
    ) {
      ensureVariant(item.payload.variant).exposures += 1;
      return;
    }

    var variant =
      item.payload &&
      item.payload.experiments &&
      item.payload.experiments.therapist_contact_guidance
        ? item.payload.experiments.therapist_contact_guidance
        : "unknown";

    if (item.type === "profile_contact_section_viewed") {
      sectionViews += 1;
      return;
    }

    if (item.type === "profile_outreach_script_engaged") {
      scriptEngagements += 1;
      ensureVariant(variant).script_engagements += 1;
      return;
    }

    if (item.type === "profile_contact_questions_engaged") {
      questionEngagements += 1;
      ensureVariant(variant).question_engagements += 1;
      return;
    }

    if (item.type !== "profile_contact_route_clicked") {
      return;
    }

    var payload = item.payload || {};
    var route =
      payload.route && Object.prototype.hasOwnProperty.call(routeCounts, payload.route)
        ? payload.route
        : "unknown";
    var slug = payload.therapist_slug ? String(payload.therapist_slug) : "";
    routeCounts[route] += 1;
    ensureVariant(variant).route_clicks += 1;
    if (slug) {
      if (!profileCounts[slug]) {
        profileCounts[slug] = {
          slug: slug,
          clicks: 0,
          primary: 0,
          secondary: 0,
        };
      }
      profileCounts[slug].clicks += 1;
      if (payload.priority === "primary") {
        profileCounts[slug].primary += 1;
      } else if (payload.priority === "secondary") {
        profileCounts[slug].secondary += 1;
      }
    }
  });

  var routeRows = Object.keys(routeCounts)
    .map(function (route) {
      return {
        route: route,
        count: routeCounts[route],
      };
    })
    .filter(function (item) {
      return item.count > 0;
    })
    .sort(function (a, b) {
      return b.count - a.count || a.route.localeCompare(b.route);
    });

  var topProfiles = Object.keys(profileCounts)
    .map(function (slug) {
      return profileCounts[slug];
    })
    .sort(function (a, b) {
      return b.clicks - a.clicks || b.primary - a.primary || a.slug.localeCompare(b.slug);
    })
    .slice(0, 5);

  var totalRouteClicks = routeRows.reduce(function (sum, item) {
    return sum + item.count;
  }, 0);
  var guidanceEngagements = scriptEngagements + questionEngagements;
  var guidanceEngagementRate = totalRouteClicks ? guidanceEngagements / totalRouteClicks : 0;
  var topRoute = routeRows[0] || null;
  var weakGuidanceProfiles = topProfiles.filter(function (item) {
    return item.clicks >= 2 && item.primary >= item.secondary;
  });
  var variantRows = Object.keys(variantBuckets)
    .map(function (key) {
      var item = variantBuckets[key];
      item.guidance_engagements = item.script_engagements + item.question_engagements;
      item.route_click_rate = item.exposures ? item.route_clicks / item.exposures : 0;
      item.guidance_rate = item.route_clicks ? item.guidance_engagements / item.route_clicks : 0;
      return item;
    })
    .sort(function (a, b) {
      return (
        b.route_clicks - a.route_clicks ||
        b.guidance_engagements - a.guidance_engagements ||
        a.variant.localeCompare(b.variant)
      );
    });

  return {
    section_views: sectionViews,
    script_engagements: scriptEngagements,
    question_engagements: questionEngagements,
    route_rows: routeRows,
    top_profiles: topProfiles,
    total_route_clicks: totalRouteClicks,
    guidance_engagements: guidanceEngagements,
    guidance_engagement_rate: guidanceEngagementRate,
    top_route: topRoute,
    weak_guidance_profiles: weakGuidanceProfiles,
    variant_rows: variantRows,
    interpretation:
      !totalRouteClicks && !sectionViews
        ? "No profile contact behavior captured yet."
        : guidanceEngagementRate >= 0.6
          ? "Guidance engagement looks strong relative to contact intent."
          : guidanceEngagementRate >= 0.3
            ? "Some users are engaging with contact guidance before clicking out."
            : "Users are clicking contact routes faster than they are engaging with guidance.",
  };
}

export function summarizeTherapistContactRoutePerformance(events, therapistSlug) {
  var slug = String(therapistSlug || "").trim();
  if (!slug) {
    return {
      total_route_clicks: 0,
      route_rows: [],
      top_route: null,
      confidence: "none",
      note: "",
    };
  }

  var entries = Array.isArray(events) ? events : [];
  var routeCounts = {
    booking: 0,
    website: 0,
    phone: 0,
    email: 0,
    unknown: 0,
  };
  var priorityCounts = {
    primary: 0,
    secondary: 0,
    unknown: 0,
  };

  entries.forEach(function (item) {
    if (!item || item.type !== "profile_contact_route_clicked" || !item.payload) {
      return;
    }
    if (String(item.payload.therapist_slug || "") !== slug) {
      return;
    }
    var route =
      item.payload.route && Object.prototype.hasOwnProperty.call(routeCounts, item.payload.route)
        ? item.payload.route
        : "unknown";
    var priority =
      item.payload.priority &&
      Object.prototype.hasOwnProperty.call(priorityCounts, item.payload.priority)
        ? item.payload.priority
        : "unknown";
    routeCounts[route] += 1;
    priorityCounts[priority] += 1;
  });

  var routeRows = Object.keys(routeCounts)
    .map(function (route) {
      return {
        route: route,
        count: routeCounts[route],
      };
    })
    .filter(function (item) {
      return item.count > 0;
    })
    .sort(function (a, b) {
      return b.count - a.count || a.route.localeCompare(b.route);
    });

  var topRoute = routeRows[0] || null;
  var runnerUp = routeRows[1] || null;
  var totalRouteClicks = routeRows.reduce(function (sum, item) {
    return sum + item.count;
  }, 0);
  var topShare = totalRouteClicks && topRoute ? topRoute.count / totalRouteClicks : 0;
  var confidence =
    topRoute && topRoute.count >= 4 && topShare >= 0.55
      ? "strong"
      : topRoute && topRoute.count >= 2 && topShare >= 0.45
        ? "medium"
        : topRoute
          ? "light"
          : "none";
  var note = !topRoute
    ? ""
    : confidence === "strong"
      ? "Observed profile behavior clearly leans toward " +
        topRoute.route +
        " as the route users choose first."
      : confidence === "medium"
        ? "Observed profile behavior leans toward " + topRoute.route + " over other routes so far."
        : runnerUp
          ? "Observed route behavior is still mixed between " +
            topRoute.route +
            " and " +
            runnerUp.route +
            "."
          : "There is only light observed route behavior on this profile so far.";

  return {
    total_route_clicks: totalRouteClicks,
    route_rows: routeRows,
    top_route: topRoute,
    runner_up_route: runnerUp,
    top_route_share: topShare,
    primary_clicks: priorityCounts.primary,
    secondary_clicks: priorityCounts.secondary,
    confidence: confidence,
    note: note,
  };
}

export function summarizeContactRouteOutcomePerformance(outcomes) {
  var entries = Array.isArray(outcomes) ? outcomes : [];
  var buckets = {
    booking: { route: "booking", total: 0, strong: 0, friction: 0 },
    website: { route: "website", total: 0, strong: 0, friction: 0 },
    phone: { route: "phone", total: 0, strong: 0, friction: 0 },
    email: { route: "email", total: 0, strong: 0, friction: 0 },
    unknown: { route: "unknown", total: 0, strong: 0, friction: 0 },
  };

  entries.forEach(function (item) {
    if (!item || !item.outcome) {
      return;
    }
    var route =
      item.actual_route_type &&
      Object.prototype.hasOwnProperty.call(buckets, item.actual_route_type)
        ? item.actual_route_type
        : item.route_type && Object.prototype.hasOwnProperty.call(buckets, item.route_type)
          ? item.route_type
          : "unknown";
    var bucket = buckets[route];
    bucket.total += 1;
    if (["heard_back", "booked_consult", "good_fit_call"].includes(item.outcome)) {
      bucket.strong += 1;
    } else if (["no_response", "waitlist", "insurance_mismatch"].includes(item.outcome)) {
      bucket.friction += 1;
    }
  });

  var rows = Object.keys(buckets)
    .map(function (key) {
      var bucket = buckets[key];
      bucket.net = bucket.strong - bucket.friction;
      bucket.strong_rate = bucket.total ? bucket.strong / bucket.total : 0;
      return bucket;
    })
    .filter(function (item) {
      return item.total > 0;
    })
    .sort(function (a, b) {
      return (
        b.net - a.net ||
        b.strong_rate - a.strong_rate ||
        b.total - a.total ||
        a.route.localeCompare(b.route)
      );
    });

  return {
    rows: rows,
    leader: rows[0] || null,
    interpretation: !rows.length
      ? "No route-linked outreach outcomes yet."
      : rows[0].total < 2
        ? "Route-linked outcomes are starting to accumulate, but the sample is still light."
        : rows[0].net > 0
          ? "Some routes are starting to show stronger downstream follow-through than others."
          : "Route-linked outcomes are mixed so far.",
  };
}

export function summarizeDirectoryProfileOpenQuality(events) {
  var entries = Array.isArray(events) ? events : [];
  var buckets = {};

  function ensureBucket(source) {
    var key = String(source || "unknown");
    if (!buckets[key]) {
      buckets[key] = {
        source: key,
        opens: 0,
        high_readiness: 0,
        fresh_profiles: 0,
        accepting_profiles: 0,
        bipolar_profiles: 0,
      };
    }
    return buckets[key];
  }

  entries.forEach(function (item) {
    if (!item || item.type !== "directory_profile_open_quality") {
      return;
    }
    var payload = item.payload || {};
    var bucket = ensureBucket(payload.source);
    bucket.opens += 1;
    if (payload.readiness_score >= 85) {
      bucket.high_readiness += 1;
    }
    if (payload.freshness_status === "fresh") {
      bucket.fresh_profiles += 1;
    }
    if (payload.accepting_new_patients) {
      bucket.accepting_profiles += 1;
    }
    if (payload.has_bipolar_experience) {
      bucket.bipolar_profiles += 1;
    }
  });

  var rows = Object.keys(buckets)
    .map(function (key) {
      var bucket = buckets[key];
      bucket.high_readiness_rate = bucket.opens ? bucket.high_readiness / bucket.opens : 0;
      bucket.fresh_profile_rate = bucket.opens ? bucket.fresh_profiles / bucket.opens : 0;
      bucket.accepting_rate = bucket.opens ? bucket.accepting_profiles / bucket.opens : 0;
      bucket.bipolar_rate = bucket.opens ? bucket.bipolar_profiles / bucket.opens : 0;
      return bucket;
    })
    .sort(function (a, b) {
      return (
        b.high_readiness_rate - a.high_readiness_rate ||
        b.opens - a.opens ||
        a.source.localeCompare(b.source)
      );
    });

  var leader = rows[0] || null;
  return {
    rows: rows,
    leader: leader,
    interpretation: !rows.length
      ? "No directory-to-profile quality data yet."
      : leader.opens < 2
        ? "Profile-open quality data is starting to accumulate, but the sample is still light."
        : "We can now compare which directory entry paths are sending users into stronger profiles.",
  };
}

export function summarizeProfileContactOutcomeValidation(events, outcomes) {
  var entries = Array.isArray(events) ? events : [];
  var outcomeEntries = Array.isArray(outcomes) ? outcomes : [];
  var variantSlugMap = {};

  entries.forEach(function (item) {
    if (!item || item.type !== "profile_contact_route_clicked") {
      return;
    }
    var variant =
      item.payload &&
      item.payload.experiments &&
      item.payload.experiments.therapist_contact_guidance
        ? item.payload.experiments.therapist_contact_guidance
        : "unknown";
    var slug =
      item.payload && item.payload.therapist_slug ? String(item.payload.therapist_slug) : "";
    if (!slug) {
      return;
    }
    if (!variantSlugMap[variant]) {
      variantSlugMap[variant] = new Set();
    }
    variantSlugMap[variant].add(slug);
  });

  return Object.keys(variantSlugMap)
    .map(function (variant) {
      var slugSet = variantSlugMap[variant];
      var strong = 0;
      var friction = 0;
      outcomeEntries.forEach(function (item) {
        if (!item || !item.therapist_slug || !slugSet.has(String(item.therapist_slug))) {
          return;
        }
        if (["heard_back", "booked_consult", "good_fit_call"].includes(item.outcome)) {
          strong += 1;
        } else if (["no_response", "waitlist", "insurance_mismatch"].includes(item.outcome)) {
          friction += 1;
        }
      });
      return {
        variant: variant,
        therapist_count: slugSet.size,
        strong_outcomes: strong,
        friction_outcomes: friction,
        downstream_score: strong * 2 - friction,
      };
    })
    .sort(function (a, b) {
      return (
        b.downstream_score - a.downstream_score ||
        b.strong_outcomes - a.strong_outcomes ||
        a.variant.localeCompare(b.variant)
      );
    });
}

export function summarizeProfileQueueProgress(events) {
  var entries = Array.isArray(events) ? events : [];
  var totals = {
    updates: 0,
    reached_out: 0,
    heard_back: 0,
    good_fit_call: 0,
    no_response: 0,
    waitlist: 0,
    insurance_mismatch: 0,
  };
  var therapistCounts = {};

  entries.forEach(function (item) {
    if (!item || item.type !== "profile_queue_outcome_recorded" || !item.payload) {
      return;
    }
    var outcome = String(item.payload.outcome || "");
    totals.updates += 1;
    if (Object.prototype.hasOwnProperty.call(totals, outcome)) {
      totals[outcome] += 1;
    }
    if (item.payload.therapist_slug) {
      therapistCounts[String(item.payload.therapist_slug)] = true;
    }
  });

  var strongestSignals = totals.heard_back + totals.good_fit_call;
  var frictionSignals = totals.no_response + totals.waitlist + totals.insurance_mismatch;

  return {
    updates: totals.updates,
    therapist_count: Object.keys(therapistCounts).length,
    reached_out: totals.reached_out,
    heard_back: totals.heard_back,
    good_fit_call: totals.good_fit_call,
    no_response: totals.no_response,
    waitlist: totals.waitlist,
    insurance_mismatch: totals.insurance_mismatch,
    interpretation: !totals.updates
      ? "No therapist-profile outreach updates yet."
      : strongestSignals > frictionSignals
        ? "Profile-side outreach updates are already showing more reply progress than friction."
        : frictionSignals > strongestSignals
          ? "Profile-side outreach updates are capturing more friction than progress so far."
          : "Profile-side outreach updates are starting to accumulate, but the signal is still mixed.",
  };
}

export function summarizeProfileBackupSignals(events, therapistSlug) {
  var entries = Array.isArray(events) ? events : [];
  var slug = String(therapistSlug || "");
  var totals = {
    opens: 0,
    compares: 0,
  };

  entries.forEach(function (item) {
    if (!item || !item.payload || String(item.payload.therapist_slug || "") !== slug) {
      return;
    }
    if (item.type === "profile_backup_opened") {
      totals.opens += 1;
    } else if (item.type === "profile_backup_compared") {
      totals.compares += 1;
    }
  });

  var preferredAction =
    totals.compares >= Math.max(2, totals.opens + 1)
      ? "compare"
      : totals.opens >= Math.max(2, totals.compares + 1)
        ? "open_backup"
        : "balanced";

  return {
    opens: totals.opens,
    compares: totals.compares,
    preferred_action: preferredAction,
    interpretation:
      !totals.opens && !totals.compares
        ? ""
        : preferredAction === "compare"
          ? "People who hesitate here have been leaning toward side-by-side comparison."
          : preferredAction === "open_backup"
            ? "People who hesitate here have been leaning toward opening the backup profile directly."
            : "Backup behavior here is still mixed between direct compare and backup review.",
  };
}

export function summarizeProfileContactExperimentDecision(events, outcomes) {
  var summary = summarizeProfileContactSignals(events);
  var outcomeValidation = summarizeProfileContactOutcomeValidation(events, outcomes);
  var variants = Array.isArray(summary.variant_rows) ? summary.variant_rows.slice() : [];
  var promoted = getPromotedExperimentVariant("therapist_contact_guidance");

  if (!variants.length) {
    return {
      experiment_name: "therapist_contact_guidance",
      winner: null,
      promoted_variant: promoted,
      confidence_gap: 0,
      recommendation: "Needs more traffic",
      note: "No therapist profile contact experiment traffic yet.",
    };
  }

  variants.sort(function (a, b) {
    var aOutcome = outcomeValidation.find(function (item) {
      return item.variant === a.variant;
    });
    var bOutcome = outcomeValidation.find(function (item) {
      return item.variant === b.variant;
    });
    var aScore =
      a.route_click_rate * 0.5 +
      a.guidance_rate * 0.2 +
      (aOutcome ? Math.max(-1, Math.min(1, aOutcome.downstream_score / 6)) * 0.3 : 0);
    var bScore =
      b.route_click_rate * 0.5 +
      b.guidance_rate * 0.2 +
      (bOutcome ? Math.max(-1, Math.min(1, bOutcome.downstream_score / 6)) * 0.3 : 0);
    return bScore - aScore || b.route_clicks - a.route_clicks || a.variant.localeCompare(b.variant);
  });

  var winner = variants[0] || null;
  var runnerUp = variants[1] || null;
  var winnerOutcome = winner
    ? outcomeValidation.find(function (item) {
        return item.variant === winner.variant;
      })
    : null;
  var runnerUpOutcome = runnerUp
    ? outcomeValidation.find(function (item) {
        return item.variant === runnerUp.variant;
      })
    : null;
  var winnerScore = winner
    ? winner.route_click_rate * 0.5 +
      winner.guidance_rate * 0.2 +
      (winnerOutcome ? Math.max(-1, Math.min(1, winnerOutcome.downstream_score / 6)) * 0.3 : 0)
    : 0;
  var runnerUpScore = runnerUp
    ? runnerUp.route_click_rate * 0.5 +
      runnerUp.guidance_rate * 0.2 +
      (runnerUpOutcome ? Math.max(-1, Math.min(1, runnerUpOutcome.downstream_score / 6)) * 0.3 : 0)
    : 0;
  var confidenceGap =
    winner && runnerUp && winner.exposures >= 5 && runnerUp.exposures >= 5
      ? winnerScore - runnerUpScore
      : 0;
  var recommendation =
    winner && confidenceGap >= 0.08
      ? "Promising winner"
      : winner && winner.exposures >= 5
        ? "Too early to call"
        : "Needs more traffic";

  return {
    experiment_name: "therapist_contact_guidance",
    winner: winner,
    promoted_variant: promoted,
    confidence_gap: confidenceGap,
    recommendation: recommendation,
    outcome_validation: outcomeValidation,
    note: winner
      ? "Current leader: " +
        winner.variant +
        ". Route click rate " +
        Math.round(winner.route_click_rate * 100) +
        "% and guidance rate " +
        Math.round(winner.guidance_rate * 100) +
        "%" +
        (winnerOutcome
          ? ". Downstream score " +
            winnerOutcome.downstream_score +
            " (" +
            winnerOutcome.strong_outcomes +
            " strong, " +
            winnerOutcome.friction_outcomes +
            " friction)."
          : ".")
      : "No therapist profile contact experiment traffic yet.",
  };
}
