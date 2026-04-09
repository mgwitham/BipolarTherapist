export function createListingsWorkspace(options) {
  var getRuntimeState = options.getRuntimeState;
  var getTherapists = options.getTherapists;
  var copyText = options.copyText;
  var escapeHtml = options.escapeHtml;
  var formatDate = options.formatDate;
  var getConfirmationGraceWindowNote = options.getConfirmationGraceWindowNote;
  var getDataFreshnessSummary = options.getDataFreshnessSummary;
  var getEditoriallyVerifiedOperationalCount = options.getEditoriallyVerifiedOperationalCount;
  var getRecentConfirmationSummary = options.getRecentConfirmationSummary;
  var getTherapistConfirmationAgenda = options.getTherapistConfirmationAgenda;
  var getTherapistMatchReadiness = options.getTherapistMatchReadiness;
  var getTherapistMerchandisingQuality = options.getTherapistMerchandisingQuality;
  var getRouteHealthWarnings =
    options.getRouteHealthWarnings ||
    function () {
      return [];
    };
  var getRouteHealthActionItems =
    options.getRouteHealthActionItems ||
    function () {
      return [];
    };
  var queueRouteHealthFollowUp = options.queueRouteHealthFollowUp;
  var readFunnelEvents = options.readFunnelEvents;
  var spotlightSection = options.spotlightSection;
  var launchProfileControlsKey = options.launchProfileControlsKey;
  var launchStateOptions = Array.isArray(options.launchStateOptions)
    ? options.launchStateOptions.slice()
    : [];
  var homepageFeaturedFallbackSlugs = Array.isArray(options.homepageFeaturedFallbackSlugs)
    ? options.homepageFeaturedFallbackSlugs.slice()
    : [];

  var rankingRiskFilter = "";
  var launchProfileFilters = {
    state: "",
    lane: "",
  };
  var launchControlFlashMessage = "";
  var launchControlFlashHistory = {};
  var LAUNCH_CONTROL_FLASH_TTL_MS = 10 * 60 * 1000;

  function getRankingRiskMatches(therapist) {
    var freshness = getDataFreshnessSummary(therapist);
    var confirmationAgenda = getTherapistConfirmationAgenda(therapist);
    var recentConfirmation = getRecentConfirmationSummary(therapist);
    var verifiedOperationalCount = getEditoriallyVerifiedOperationalCount(therapist);

    return {
      aging_data: freshness.status === "aging",
      refresh_soon: freshness.status === "watch",
      confirmation_needed: confirmationAgenda.needs_confirmation,
      no_recent_confirmation: !recentConfirmation,
      weak_editorial_depth: verifiedOperationalCount < 2,
    };
  }

  function getRankingRiskMeta(key) {
    var meta = {
      confirmation_needed: {
        note: "These profiles still have high-value unknowns that are costing trust and visibility.",
        action: "Open confirmation queue",
        target: "confirmationQueue",
      },
      no_recent_confirmation: {
        note: "These profiles have not been re-confirmed by the specialist recently, so they miss the freshness lift.",
        action: "Open confirmation queue",
        target: "confirmationQueue",
      },
      weak_editorial_depth: {
        note: "These profiles need stronger editor-verified operational coverage to earn more ranking trust.",
        action: "Review published listings first",
        target: "publishedListings",
      },
      aging_data: {
        note: "These profiles are already losing some ranking strength because their operational data is aging.",
        action: "Open refresh queue",
        target: "refreshQueue",
      },
      refresh_soon: {
        note: "These profiles are not in trouble yet, but they are the next best refresh candidates.",
        action: "Open refresh queue",
        target: "refreshQueue",
      },
    };

    return (
      meta[key] || {
        note: "Review the affected profiles and decide the strongest next trust update.",
        action: "Review published listings",
        target: "publishedListings",
      }
    );
  }

  function readLaunchProfileControlsState() {
    try {
      return JSON.parse(window.localStorage.getItem(launchProfileControlsKey) || "{}");
    } catch (_error) {
      return {};
    }
  }

  function writeLaunchProfileControlsState(value) {
    try {
      window.localStorage.setItem(launchProfileControlsKey, JSON.stringify(value));
    } catch (_error) {
      return;
    }
  }

  function getLaunchStateLabel(value) {
    if (value === "featured") {
      return "Featured";
    }
    if (value === "launch_ready") {
      return "Ready to feature";
    }
    return "Live only";
  }

  function getLaunchStateWeight(value) {
    if (value === "featured") {
      return 0;
    }
    if (value === "launch_ready") {
      return 1;
    }
    return 2;
  }

  function getDefaultLaunchProfileControl(item) {
    var readiness = getTherapistMatchReadiness(item);
    var quality = getTherapistMerchandisingQuality(item);
    var homepageFeatured = homepageFeaturedFallbackSlugs.includes(item && item.slug);
    var matchPriority =
      readiness.score >= 85 &&
      quality.score >= 80 &&
      Boolean(
        item &&
        (item.accepting_new_patients || item.contact_guidance || item.first_step_expectation),
      );

    return {
      launch_state: homepageFeatured ? "featured" : matchPriority ? "launch_ready" : "standard",
      homepage_featured: homepageFeatured,
      match_priority: matchPriority,
      updated_at: "",
    };
  }

  function getLaunchProfileControlEntry(item) {
    var defaults = getDefaultLaunchProfileControl(item || {});
    var all = readLaunchProfileControlsState();
    var stored = item && item.slug ? all[item.slug] || {} : {};
    var launchState = launchStateOptions.includes(stored.launch_state)
      ? stored.launch_state
      : defaults.launch_state;

    return {
      launch_state: launchState,
      homepage_featured:
        typeof stored.homepage_featured === "boolean"
          ? stored.homepage_featured
          : defaults.homepage_featured,
      match_priority:
        typeof stored.match_priority === "boolean"
          ? stored.match_priority
          : defaults.match_priority,
      updated_at: stored.updated_at || defaults.updated_at || "",
    };
  }

  function updateLaunchProfileControlEntry(slug, updates) {
    if (!slug) {
      return;
    }
    var all = readLaunchProfileControlsState();
    var current = all[slug] || {};
    all[slug] = {
      ...current,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    writeLaunchProfileControlsState(all);
  }

  function setLaunchControlFlashMessage(message) {
    launchControlFlashMessage = String(message || "").trim();
  }

  function setLaunchControlFlashHistory(slug, message) {
    if (!slug) {
      return;
    }
    var trimmed = String(message || "").trim();
    if (!trimmed) {
      delete launchControlFlashHistory[slug];
      return;
    }
    launchControlFlashHistory[slug] = {
      message: trimmed,
      createdAt: Date.now(),
    };
  }

  function getRecentLaunchControlFlashes(limit) {
    var maxItems = Number(limit) > 0 ? Number(limit) : 3;
    var now = Date.now();
    return Object.entries(launchControlFlashHistory)
      .map(function (entry) {
        return {
          slug: entry[0],
          message: entry[1] && entry[1].message ? entry[1].message : "",
          createdAt: entry[1] && entry[1].createdAt ? entry[1].createdAt : 0,
        };
      })
      .filter(function (entry) {
        return (
          entry.message && entry.createdAt && now - entry.createdAt <= LAUNCH_CONTROL_FLASH_TTL_MS
        );
      })
      .sort(function (a, b) {
        return b.createdAt - a.createdAt;
      })
      .slice(0, maxItems);
  }

  function getLaunchControlRows(therapists) {
    return (Array.isArray(therapists) ? therapists : [])
      .map(function (item) {
        return {
          item: item,
          control: getLaunchProfileControlEntry(item),
          readiness: getTherapistMatchReadiness(item),
          quality: getTherapistMerchandisingQuality(item),
          freshness: getDataFreshnessSummary(item),
        };
      })
      .sort(function (a, b) {
        return (
          getLaunchStateWeight(a.control.launch_state) -
            getLaunchStateWeight(b.control.launch_state) ||
          Number(b.control.homepage_featured) - Number(a.control.homepage_featured) ||
          Number(b.control.match_priority) - Number(a.control.match_priority) ||
          b.quality.score - a.quality.score ||
          b.readiness.score - a.readiness.score ||
          a.item.name.localeCompare(b.item.name)
        );
      });
  }

  function getLaunchControlCounts(rows) {
    return (rows || []).reduce(
      function (counts, row) {
        counts.total += 1;
        if (row.control.launch_state === "launch_ready") {
          counts.launch_ready += 1;
        }
        if (row.control.launch_state === "featured") {
          counts.featured += 1;
        }
        if (row.control.homepage_featured) {
          counts.homepage_featured += 1;
        }
        if (row.control.match_priority) {
          counts.match_priority += 1;
        }
        return counts;
      },
      {
        total: 0,
        launch_ready: 0,
        featured: 0,
        homepage_featured: 0,
        match_priority: 0,
      },
    );
  }

  function getLaunchControlSummaryNote(counts) {
    if (!counts.total) {
      return "No live profiles available for launch control yet.";
    }
    if (counts.featured || counts.homepage_featured || counts.match_priority) {
      return (
        counts.featured +
        " featured, " +
        counts.homepage_featured +
        " homepage-featured, and " +
        counts.match_priority +
        " match-priority profile" +
        (counts.match_priority === 1 ? "" : "s") +
        " are currently staged."
      );
    }
    return "No explicit visibility overrides are staged yet. Start by marking the strongest live profiles as ready to feature or featured.";
  }

  function getLaunchLaneRows(rows, lane) {
    return (rows || []).filter(function (row) {
      if (lane === "homepage") {
        return row.control.homepage_featured;
      }
      if (lane === "match") {
        return row.control.match_priority;
      }
      return false;
    });
  }

  function getLaunchLaneHealthSummary(rows, lane) {
    var laneRows = getLaunchLaneRows(rows, lane);
    var label = lane === "homepage" ? "Homepage featured lane" : "Match-priority lane";
    if (!laneRows.length) {
      return label + ": no profiles staged yet.";
    }

    var featuredCount = laneRows.filter(function (row) {
      return row.control.launch_state === "featured";
    }).length;
    var launchReadyCount = laneRows.filter(function (row) {
      return row.control.launch_state === "launch_ready";
    }).length;
    var agingCount = laneRows.filter(function (row) {
      return row.freshness.status === "aging";
    }).length;
    var weakCount = laneRows.filter(function (row) {
      return row.readiness.score < 75 || row.quality.score < 75;
    }).length;

    if (laneRows.length < 3) {
      return (
        label + ": thin supply. Add a few more strong profiles before leaning on this lane heavily."
      );
    }
    if (agingCount >= 2) {
      return label + ": usable, but freshness is slipping across the current set.";
    }
    if (weakCount >= Math.ceil(laneRows.length / 2)) {
      return label + ": staged, but too many profiles still look weaker than ideal.";
    }
    if (featuredCount >= Math.ceil(laneRows.length / 2)) {
      return (
        label +
        ": strong. " +
        featuredCount +
        " featured and " +
        launchReadyCount +
        " ready-to-feature profile" +
        (launchReadyCount === 1 ? "" : "s") +
        " are carrying this lane."
      );
    }
    return (
      label +
      ": healthy enough to use, with " +
      featuredCount +
      " featured and " +
      launchReadyCount +
      " ready-to-feature profile" +
      (launchReadyCount === 1 ? "" : "s") +
      "."
    );
  }

  function getLaunchControlBottleneck(rows) {
    var homepageRows = getLaunchLaneRows(rows, "homepage");
    var matchRows = getLaunchLaneRows(rows, "match");
    var staleHomepage = homepageRows.filter(function (row) {
      return row.freshness.status === "aging";
    }).length;
    var weakMatch = matchRows.filter(function (row) {
      return row.readiness.score < 75 || row.quality.score < 75;
    }).length;

    if (!homepageRows.length) {
      return "Next bottleneck: no homepage featured set is staged yet.";
    }
    if (!matchRows.length) {
      return "Next bottleneck: no match-priority set is staged yet.";
    }
    if (homepageRows.length < 4) {
      return "Next bottleneck: homepage featured supply is still too thin for a confident rotation.";
    }
    if (staleHomepage >= 2) {
      return "Next bottleneck: homepage featured supply needs freshness work before stronger promotion.";
    }
    if (weakMatch >= Math.ceil(Math.max(matchRows.length, 1) / 2)) {
      return "Next bottleneck: match-priority profiles need stronger trust or merchandising quality.";
    }
    return "Next bottleneck: keep the featured lanes fresh while promoting the strongest ready-to-feature profiles up into featured state.";
  }

  function summarizeLaunchProfileSignals(rows, events) {
    var signalMap = {};
    (rows || []).forEach(function (row) {
      signalMap[row.item.slug] = {
        shortlist_saves: 0,
        contact_intents: 0,
        profile_opens: 0,
      };
    });

    (Array.isArray(events) ? events : []).forEach(function (event) {
      var payload = event && event.payload ? event.payload : {};
      var slug = payload.therapist_slug || payload.top_slug || "";
      if (!slug || !signalMap[slug]) {
        return;
      }

      if (event.type === "directory_shortlist_saved" || event.type === "match_shortlist_saved") {
        signalMap[slug].shortlist_saves += 1;
        return;
      }

      if (
        event.type === "match_recommended_outreach_started" ||
        event.type === "match_fallback_outreach_started" ||
        event.type === "match_entry_outreach_started" ||
        event.type === "match_recommended_draft_copied" ||
        event.type === "match_fallback_draft_copied" ||
        event.type === "match_entry_draft_copied" ||
        event.type === "directory_primary_cta_clicked"
      ) {
        signalMap[slug].contact_intents += 1;
        return;
      }

      if (
        event.type === "match_result_profile_opened" ||
        event.type === "directory_profile_review_clicked"
      ) {
        signalMap[slug].profile_opens += 1;
      }
    });

    return signalMap;
  }

  function getLaunchLaneSignalSummary(rows, lane, signalMap) {
    var laneRows = getLaunchLaneRows(rows, lane);
    var label = lane === "homepage" ? "Homepage featured" : "Match-priority";
    if (!laneRows.length) {
      return label + ": no staged profiles yet, so no behavior signal exists.";
    }

    var totals = laneRows.reduce(
      function (accumulator, row) {
        var signals = signalMap[row.item.slug] || {
          shortlist_saves: 0,
          contact_intents: 0,
          profile_opens: 0,
        };
        accumulator.shortlist_saves += signals.shortlist_saves;
        accumulator.contact_intents += signals.contact_intents;
        accumulator.profile_opens += signals.profile_opens;
        return accumulator;
      },
      { shortlist_saves: 0, contact_intents: 0, profile_opens: 0 },
    );

    return (
      label +
      ": " +
      totals.shortlist_saves +
      " shortlist save" +
      (totals.shortlist_saves === 1 ? "" : "s") +
      ", " +
      totals.contact_intents +
      " contact intent" +
      (totals.contact_intents === 1 ? "" : "s") +
      ", and " +
      totals.profile_opens +
      " profile open" +
      (totals.profile_opens === 1 ? "" : "s") +
      " tracked so far."
    );
  }

  function getLaunchSignalStrength(signals) {
    var summary = signals || {};
    return (
      Number(summary.contact_intents || 0) * 3 +
      Number(summary.shortlist_saves || 0) * 2 +
      Number(summary.profile_opens || 0)
    );
  }

  function getUnderperformingFeaturedRows(rows, signalMap) {
    return (rows || [])
      .filter(function (row) {
        if (!(row.control.homepage_featured || row.control.match_priority)) {
          return false;
        }
        var signals = signalMap[row.item.slug] || {};
        var signalStrength = getLaunchSignalStrength(signals);
        var weakProfile = row.readiness.score < 75 || row.quality.score < 75;
        var aging = row.freshness.status === "aging";
        return weakProfile || aging || signalStrength === 0;
      })
      .sort(function (a, b) {
        var aSignals = getLaunchSignalStrength(signalMap[a.item.slug] || {});
        var bSignals = getLaunchSignalStrength(signalMap[b.item.slug] || {});
        return (
          aSignals - bSignals ||
          Number(a.freshness.status === "aging") - Number(b.freshness.status === "aging") ||
          a.readiness.score - b.readiness.score ||
          a.quality.score - b.quality.score
        );
      })
      .slice(0, 3);
  }

  function getPromotionCandidateRows(rows, signalMap) {
    return (rows || [])
      .filter(function (row) {
        if (row.control.homepage_featured || row.control.match_priority) {
          return false;
        }
        if (row.readiness.score < 80 || row.quality.score < 80) {
          return false;
        }
        if (row.freshness.status === "aging") {
          return false;
        }
        var signals = signalMap[row.item.slug] || {};
        return getLaunchSignalStrength(signals) > 0 || row.control.launch_state !== "standard";
      })
      .sort(function (a, b) {
        var aSignals = getLaunchSignalStrength(signalMap[a.item.slug] || {});
        var bSignals = getLaunchSignalStrength(signalMap[b.item.slug] || {});
        return (
          bSignals - aSignals ||
          getLaunchStateWeight(a.control.launch_state) -
            getLaunchStateWeight(b.control.launch_state) ||
          b.quality.score - a.quality.score ||
          b.readiness.score - a.readiness.score
        );
      })
      .slice(0, 3);
  }

  function getLaunchRecommendationSummary(underperformingRows, promotionRows) {
    if (underperformingRows.length && promotionRows.length) {
      return "Suggested swap window: some promoted profiles are underperforming while stronger unstaged candidates are emerging.";
    }
    if (underperformingRows.length) {
      return "Suggested cleanup: a few promoted profiles may need refresh, demotion, or replacement.";
    }
    if (promotionRows.length) {
      return "Suggested promotion: a few unstaged profiles look strong enough to move into the launch lanes.";
    }
    return "No obvious launch-lane swaps stand out yet.";
  }

  function buildLaunchProfilePacket(rows) {
    var stagedRows = (rows || []).filter(function (row) {
      return (
        row.control.launch_state !== "standard" ||
        row.control.homepage_featured ||
        row.control.match_priority
      );
    });

    if (!stagedRows.length) {
      return [
        "# Launch / Featured Profile Control",
        "",
        "No launch-state or featured-profile overrides are staged yet.",
      ].join("\n");
    }

    var lines = [
      "# Launch / Featured Profile Control",
      "",
      "Profiles currently staged for ready-to-feature or featured visibility work.",
      "",
    ];

    stagedRows.forEach(function (row, index) {
      var lanes = [];
      if (row.control.homepage_featured) {
        lanes.push("Homepage featured");
      }
      if (row.control.match_priority) {
        lanes.push("Match priority");
      }

      lines.push("## " + (index + 1) + ". " + row.item.name);
      lines.push("");
      lines.push("- Slug: " + row.item.slug);
      lines.push("- Launch state: " + getLaunchStateLabel(row.control.launch_state));
      lines.push("- Lanes: " + (lanes.length ? lanes.join(", ") : "No explicit featured lanes"));
      lines.push("- Merchandising score: " + row.quality.score);
      lines.push("- Match readiness: " + row.readiness.score + "/100");
      lines.push("- Freshness: " + row.freshness.label);
      lines.push("");
    });

    return lines.join("\n");
  }

  function buildHomepageFeaturedSlugSnippet(rows) {
    var featuredSlugs = (rows || [])
      .filter(function (row) {
        return row.control.homepage_featured;
      })
      .map(function (row) {
        return row.item.slug;
      });

    return JSON.stringify(
      {
        homepageFeaturedSlugs: featuredSlugs,
      },
      null,
      2,
    );
  }

  function buildMatchPrioritySlugSnippet(rows) {
    var prioritySlugs = (rows || [])
      .filter(function (row) {
        return row.control.match_priority;
      })
      .map(function (row) {
        return row.item.slug;
      });

    return JSON.stringify(
      {
        matchPrioritySlugs: prioritySlugs,
      },
      null,
      2,
    );
  }

  function renderListings() {
    var runtimeState = getRuntimeState();
    if (runtimeState.authRequired) {
      document.getElementById("publishedListings").innerHTML = "";
      var refreshRoot = document.getElementById("refreshQueue");
      if (refreshRoot) {
        refreshRoot.innerHTML = "";
      }
      return;
    }

    var therapists =
      runtimeState.dataMode === "sanity" ? runtimeState.publishedTherapists : getTherapists();
    var root = document.getElementById("publishedListings");
    var launchRows = getLaunchControlRows(therapists);
    var launchCounts = getLaunchControlCounts(launchRows);
    var launchSignalMap = summarizeLaunchProfileSignals(launchRows, readFunnelEvents());
    var underperformingFeaturedRows = getUnderperformingFeaturedRows(launchRows, launchSignalMap);
    var promotionCandidateRows = getPromotionCandidateRows(launchRows, launchSignalMap);
    var rankingRiskTotals = {
      aging_data: 0,
      refresh_soon: 0,
      confirmation_needed: 0,
      no_recent_confirmation: 0,
      weak_editorial_depth: 0,
    };

    therapists.forEach(function (item) {
      var matches = getRankingRiskMatches(item);

      if (matches.aging_data) {
        rankingRiskTotals.aging_data += 1;
      } else if (matches.refresh_soon) {
        rankingRiskTotals.refresh_soon += 1;
      }
      if (matches.confirmation_needed) {
        rankingRiskTotals.confirmation_needed += 1;
      }
      if (matches.no_recent_confirmation) {
        rankingRiskTotals.no_recent_confirmation += 1;
      }
      if (matches.weak_editorial_depth) {
        rankingRiskTotals.weak_editorial_depth += 1;
      }
    });

    var topRankingRisks = [
      {
        key: "confirmation_needed",
        label: "Profiles still need therapist confirmation",
        count: rankingRiskTotals.confirmation_needed,
      },
      {
        key: "no_recent_confirmation",
        label: "Profiles do not have recent specialist re-confirmation",
        count: rankingRiskTotals.no_recent_confirmation,
      },
      {
        key: "weak_editorial_depth",
        label: "Profiles have shallow editorial verification depth",
        count: rankingRiskTotals.weak_editorial_depth,
      },
      {
        key: "aging_data",
        label: "Profiles are already being held back by aging data",
        count: rankingRiskTotals.aging_data,
      },
      {
        key: "refresh_soon",
        label: "Profiles will need refresh soon",
        count: rankingRiskTotals.refresh_soon,
      },
    ]
      .filter(function (item) {
        return item.count > 0;
      })
      .sort(function (a, b) {
        return b.count - a.count || a.label.localeCompare(b.label);
      })
      .slice(0, 4);

    var visibleRows = launchRows.filter(function (row) {
      if (rankingRiskFilter && !getRankingRiskMatches(row.item)[rankingRiskFilter]) {
        return false;
      }
      if (launchProfileFilters.state && row.control.launch_state !== launchProfileFilters.state) {
        return false;
      }
      if (launchProfileFilters.lane === "homepage" && !row.control.homepage_featured) {
        return false;
      }
      if (launchProfileFilters.lane === "match" && !row.control.match_priority) {
        return false;
      }
      if (launchProfileFilters.lane === "featured" && row.control.launch_state !== "featured") {
        return false;
      }
      return true;
    });
    var topVisibleRow = visibleRows.length ? visibleRows[0] : null;
    var recentLaunchFlashes = getRecentLaunchControlFlashes(3);

    root.innerHTML =
      '<div class="queue-insights"><div class="queue-insights-title">Visibility control</div><div class="subtle" style="margin-bottom:0.7rem">Use visibility state and featured-lane flags to decide which live profiles are safe to promote on homepage and inside the match flow.</div><div class="queue-insights-grid">' +
      [
        {
          label: "All live profiles",
          count: launchCounts.total,
          note: "Full published set",
          state: "",
          lane: "",
        },
        {
          label: "Ready to feature",
          count: launchCounts.launch_ready,
          note: "Strong enough to promote next",
          state: "launch_ready",
          lane: "",
        },
        {
          label: "Featured",
          count: launchCounts.featured,
          note: "Top-of-funnel profiles",
          state: "featured",
          lane: "featured",
        },
        {
          label: "Homepage featured",
          count: launchCounts.homepage_featured,
          note: "Current homepage set",
          state: "",
          lane: "homepage",
        },
        {
          label: "Match priority",
          count: launchCounts.match_priority,
          note: "Preferred for match prominence",
          state: "",
          lane: "match",
        },
      ]
        .map(function (card) {
          var isActive =
            launchProfileFilters.state === (card.state || "") &&
            launchProfileFilters.lane === (card.lane || "");
          return (
            '<button type="button" class="queue-insight-card launch-filter-card' +
            (isActive ? " is-active" : "") +
            '" data-launch-filter-state="' +
            escapeHtml(card.state || "") +
            '" data-launch-filter-lane="' +
            escapeHtml(card.lane || "") +
            '"><div class="queue-insight-value">' +
            escapeHtml(card.count) +
            '</div><div class="queue-insight-label">' +
            escapeHtml(card.label) +
            '</div><div class="queue-insight-note">' +
            escapeHtml(card.note) +
            "</div></button>"
          );
        })
        .join("") +
      '</div><div class="queue-summary subtle">' +
      escapeHtml(getLaunchControlSummaryNote(launchCounts)) +
      '</div><div class="queue-summary subtle">' +
      escapeHtml(getLaunchLaneHealthSummary(launchRows, "homepage")) +
      '</div><div class="queue-summary subtle">' +
      escapeHtml(getLaunchLaneSignalSummary(launchRows, "homepage", launchSignalMap)) +
      '</div><div class="queue-summary subtle">' +
      escapeHtml(getLaunchLaneHealthSummary(launchRows, "match")) +
      '</div><div class="queue-summary subtle">' +
      escapeHtml(getLaunchLaneSignalSummary(launchRows, "match", launchSignalMap)) +
      '</div><div class="queue-summary subtle">' +
      escapeHtml(getLaunchControlBottleneck(launchRows)) +
      '</div><div class="queue-summary subtle">' +
      escapeHtml(
        getLaunchRecommendationSummary(underperformingFeaturedRows, promotionCandidateRows),
      ) +
      '</div><div class="queue-actions"><button class="btn-secondary" data-launch-export="packet">Copy launch packet</button><button class="btn-secondary" data-launch-export="homepage">Copy homepage featured slugs</button><button class="btn-secondary" data-launch-export="match">Copy match-priority slugs</button>' +
      (launchProfileFilters.state || launchProfileFilters.lane || rankingRiskFilter
        ? '<button class="btn-secondary" data-clear-launch-filters>Clear listing filters</button>'
        : "") +
      '</div><div class="review-coach-status" id="launchControlStatus">' +
      escapeHtml(launchControlFlashMessage) +
      "</div></div>" +
      (recentLaunchFlashes.length
        ? '<div class="queue-insights"><div class="queue-insights-title">Done Recently</div><div class="queue-insights-grid">' +
          recentLaunchFlashes
            .map(function (entry) {
              var row = launchRows.find(function (candidate) {
                return candidate.item && candidate.item.slug === entry.slug;
              });
              return (
                '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
                escapeHtml(row && row.item ? row.item.name : entry.slug) +
                '</strong></div><div class="queue-insight-note">' +
                escapeHtml(entry.message) +
                "</div></div>"
              );
            })
            .join("") +
          "</div></div>"
        : "") +
      (underperformingFeaturedRows.length || promotionCandidateRows.length
        ? '<div class="queue-insights"><div class="queue-insights-title">Suggested launch moves</div><div class="queue-insights-grid">' +
          underperformingFeaturedRows
            .map(function (row) {
              var signals = launchSignalMap[row.item.slug] || {};
              return (
                '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
                escapeHtml(row.item.name) +
                '</strong></div><div class="queue-insight-note">Underperforming featured profile. Signals: ' +
                escapeHtml(
                  (signals.contact_intents || 0) +
                    " contact · " +
                    (signals.shortlist_saves || 0) +
                    " save · " +
                    (signals.profile_opens || 0) +
                    " open",
                ) +
                '. Consider refresh or demotion.</div><div class="queue-insight-action"><button class="btn-secondary" data-launch-focus="' +
                escapeHtml(row.item.slug) +
                '">Focus profile</button></div></div>'
              );
            })
            .join("") +
          promotionCandidateRows
            .map(function (row) {
              var signals = launchSignalMap[row.item.slug] || {};
              return (
                '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
                escapeHtml(row.item.name) +
                '</strong></div><div class="queue-insight-note">Promotion candidate. Signals: ' +
                escapeHtml(
                  (signals.contact_intents || 0) +
                    " contact · " +
                    (signals.shortlist_saves || 0) +
                    " save · " +
                    (signals.profile_opens || 0) +
                    " open",
                ) +
                '. Strong enough to test in a featured lane.</div><div class="queue-insight-action"><button class="btn-secondary" data-launch-promote="' +
                escapeHtml(row.item.slug) +
                '">Mark ready to feature</button></div></div>'
              );
            })
            .join("") +
          "</div></div>"
        : "") +
      (topRankingRisks.length
        ? '<div class="queue-insights"><div class="queue-insights-title">Top ranking risks across live profiles</div>' +
          (rankingRiskFilter || launchProfileFilters.state || launchProfileFilters.lane
            ? '<div class="mini-status" style="margin-bottom:0.75rem"><strong>Showing profiles for:</strong> ' +
              escapeHtml(
                [
                  rankingRiskFilter
                    ? (
                        topRankingRisks.find(function (item) {
                          return item.key === rankingRiskFilter;
                        }) || {
                          label: rankingRiskFilter.replace(/_/g, " "),
                        }
                      ).label
                    : "",
                  launchProfileFilters.state
                    ? "Launch state: " + getLaunchStateLabel(launchProfileFilters.state)
                    : "",
                  launchProfileFilters.lane === "homepage"
                    ? "Lane: Homepage featured"
                    : launchProfileFilters.lane === "match"
                      ? "Lane: Match priority"
                      : launchProfileFilters.lane === "featured"
                        ? "Lane: Featured"
                        : "",
                ]
                  .filter(Boolean)
                  .join(" · "),
              ) +
              ' <button class="btn-secondary" type="button" data-clear-ranking-risk-filter style="margin-left:0.65rem">Clear</button></div>'
            : "") +
          '<div class="queue-insights-grid">' +
          topRankingRisks
            .map(function (item) {
              var meta = getRankingRiskMeta(item.key);
              return (
                '<button type="button" class="queue-insight-card" data-ranking-risk-filter="' +
                escapeHtml(item.key) +
                '"><div class="queue-insight-value">' +
                escapeHtml(item.count) +
                '</div><div class="queue-insight-label">' +
                escapeHtml(item.label) +
                '</div><div class="queue-insight-note">' +
                escapeHtml(meta.note) +
                '</div><div class="queue-insight-action" data-ranking-risk-next="' +
                escapeHtml(item.key) +
                '" data-target="' +
                escapeHtml(meta.target) +
                '">' +
                escapeHtml(meta.action) +
                "</div></button>"
              );
            })
            .join("") +
          "</div></div>"
        : "") +
      (visibleRows.length
        ? '<div class="mini-status" style="margin-bottom:0.75rem">Showing ' +
          escapeHtml(visibleRows.length) +
          " of " +
          escapeHtml(launchRows.length) +
          " live profile" +
          (launchRows.length === 1 ? "" : "s") +
          ".</div>"
        : "") +
      visibleRows
        .map(function (row) {
          var item = row.item;
          var control = row.control;
          var readiness = row.readiness;
          var quality = row.quality;
          var freshness = row.freshness;
          var signals = launchSignalMap[item.slug] || {
            shortlist_saves: 0,
            contact_intents: 0,
            profile_opens: 0,
          };
          var recentConfirmation = getRecentConfirmationSummary(item);
          var graceWindowNote = getConfirmationGraceWindowNote(item);
          var sourceReviewed = item.source_reviewed_at ? formatDate(item.source_reviewed_at) : "";
          var routeHealthWarnings = getRouteHealthWarnings(item);
          var routeHealthActions = getRouteHealthActionItems(item);
          var primarySource = item.source_url || item.website || "";
          var primarySourceHost = "";
          try {
            primarySourceHost = primarySource
              ? new URL(primarySource).hostname.replace(/^www\./, "")
              : "";
          } catch (_error) {
            primarySourceHost = "";
          }
          var rankingImpact = graceWindowNote
            ? "Temporarily protected by a freshness grace window after recently applied updates."
            : freshness.status === "aging"
              ? "Being held back a bit by aging operational data."
              : freshness.status === "watch"
                ? "Losing a small amount of ranking strength until key details are refreshed."
                : recentConfirmation
                  ? "Earning a modest lift from recent specialist re-confirmation."
                  : "Ranking is currently driven more by profile quality than freshness.";
          var isStartHere =
            topVisibleRow && topVisibleRow.item && topVisibleRow.item.slug === item.slug;
          return (
            '<div class="mini-card launch-mini-card' +
            (isStartHere ? " is-start-here" : "") +
            '"' +
            (isStartHere ? ' id="publishedListingsStartHere"' : "") +
            '><div class="launch-card-main">' +
            (isStartHere
              ? '<div class="start-here-chip">Start here</div><div class="start-here-copy">Review this listing first. It is the top visible promotion or maintenance decision in the current listing view.</div><div class="start-here-action">Do this now: choose the simplest clear state for this profile, then decide whether it belongs in homepage, match-priority, or standard live rotation.</div>'
              : "") +
            "<strong>" +
            escapeHtml(item.name) +
            '</strong><div class="subtle">' +
            escapeHtml(item.city + ", " + item.state + " · " + item.credentials) +
            '</div><div class="tag-row"><span class="tag">' +
            escapeHtml(getLaunchStateLabel(control.launch_state)) +
            "</span>" +
            (control.homepage_featured ? '<span class="tag">Homepage featured</span>' : "") +
            (control.match_priority ? '<span class="tag">Match priority</span>' : "") +
            '</div><div class="subtle">' +
            escapeHtml(quality.label) +
            " · merchandising " +
            escapeHtml(quality.score) +
            '</div><div class="subtle">' +
            escapeHtml(readiness.label) +
            " · " +
            escapeHtml(readiness.score) +
            "/100</div>" +
            (routeHealthWarnings.length
              ? '<div class="tag-row">' +
                routeHealthWarnings
                  .map(function (warning) {
                    return '<span class="tag">' + escapeHtml(warning) + "</span>";
                  })
                  .join("") +
                "</div>"
              : "") +
            (routeHealthActions.length
              ? '<div class="queue-actions secondary-actions" style="margin-top:0.55rem">' +
                routeHealthActions
                  .map(function (action) {
                    return (
                      '<button class="btn-secondary btn-inline" type="button" data-route-health-action="' +
                      escapeHtml(item.id) +
                      '" data-route-health-mode="' +
                      escapeHtml(action.key) +
                      '">' +
                      escapeHtml(action.label) +
                      "</button>"
                    );
                  })
                  .join("") +
                "</div>"
              : "") +
            '<div class="subtle">' +
            escapeHtml(freshness.label) +
            "</div>" +
            '<div class="subtle">' +
            escapeHtml(rankingImpact) +
            "</div>" +
            (graceWindowNote
              ? '<div class="subtle">' + escapeHtml(graceWindowNote) + "</div>"
              : "") +
            (sourceReviewed
              ? '<div class="subtle">Source reviewed: ' +
                escapeHtml(sourceReviewed) +
                (primarySourceHost ? " · " + escapeHtml(primarySourceHost) : "") +
                "</div>"
              : "") +
            '<div class="subtle">Signals: ' +
            escapeHtml(
              signals.shortlist_saves +
                " shortlist saves · " +
                signals.contact_intents +
                " contact intents · " +
                signals.profile_opens +
                " profile opens",
            ) +
            "</div>" +
            (isStartHere
              ? '<div class="recommended-action-bar"><div class="recommended-action-label">Recommended action</div><div class="recommended-action-row"><button class="btn-primary btn-inline" data-launch-quick-action="' +
                escapeHtml(item.slug) +
                '" data-launch-quick-mode="promote_launch_ready">Mark ready to feature</button></div></div><div class="queue-actions secondary-actions">'
              : '<div class="queue-actions" style="margin-top:0.75rem">') +
            '<button class="btn-secondary btn-inline" data-launch-quick-action="' +
            escapeHtml(item.slug) +
            '" data-launch-quick-mode="feature_homepage">Feature on homepage</button>' +
            (isStartHere
              ? ""
              : '<button class="btn-secondary btn-inline" data-launch-quick-action="' +
                escapeHtml(item.slug) +
                '" data-launch-quick-mode="promote_launch_ready">Mark ready to feature</button>') +
            '<button class="btn-secondary btn-inline" data-launch-quick-action="' +
            escapeHtml(item.slug) +
            '" data-launch-quick-mode="set_standard">Keep standard</button>' +
            "</div>" +
            '</div><div class="launch-card-controls"><label class="queue-select-label" for="launch-state-' +
            escapeHtml(item.slug) +
            '">Launch state</label><select class="queue-select" id="launch-state-' +
            escapeHtml(item.slug) +
            '" data-launch-state="' +
            escapeHtml(item.slug) +
            '">' +
            launchStateOptions
              .map(function (option) {
                return (
                  '<option value="' +
                  escapeHtml(option) +
                  '"' +
                  (control.launch_state === option ? " selected" : "") +
                  ">" +
                  escapeHtml(getLaunchStateLabel(option)) +
                  "</option>"
                );
              })
              .join("") +
            '</select><label class="launch-checkbox"><input type="checkbox" data-launch-homepage="' +
            escapeHtml(item.slug) +
            '"' +
            (control.homepage_featured ? " checked" : "") +
            '> Homepage featured</label><label class="launch-checkbox"><input type="checkbox" data-launch-match="' +
            escapeHtml(item.slug) +
            '"' +
            (control.match_priority ? " checked" : "") +
            '> Match priority</label><a class="btn-secondary btn-inline" href="therapist.html?slug=' +
            encodeURIComponent(item.slug) +
            '">Open profile</a></div></div>'
          );
        })
        .join("") +
      (!visibleRows.length
        ? '<div class="empty">No live profiles match the current launch or risk filters.</div>'
        : "");

    root
      .querySelectorAll("[data-launch-filter-state], [data-launch-filter-lane]")
      .forEach(function (button) {
        button.addEventListener("click", function () {
          var nextState = button.getAttribute("data-launch-filter-state") || "";
          var nextLane = button.getAttribute("data-launch-filter-lane") || "";
          var isActive =
            launchProfileFilters.state === nextState && launchProfileFilters.lane === nextLane;
          launchProfileFilters.state = isActive ? "" : nextState;
          launchProfileFilters.lane = isActive ? "" : nextLane;
          renderListings();
        });
      });

    root.querySelectorAll("[data-launch-export]").forEach(function (button) {
      button.addEventListener("click", async function () {
        var mode = button.getAttribute("data-launch-export");
        var text =
          mode === "homepage"
            ? buildHomepageFeaturedSlugSnippet(launchRows)
            : mode === "match"
              ? buildMatchPrioritySlugSnippet(launchRows)
              : buildLaunchProfilePacket(launchRows);
        var success = await copyText(text);
        var status = root.querySelector("#launchControlStatus");
        if (status) {
          status.textContent = success
            ? mode === "homepage"
              ? "Homepage featured slug snippet copied."
              : mode === "match"
                ? "Match-priority slugs copied."
                : "Launch profile packet copied."
            : mode === "homepage"
              ? "Could not copy homepage featured slug snippet."
              : mode === "match"
                ? "Could not copy match-priority slugs."
                : "Could not copy launch profile packet.";
        }
      });
    });

    root.querySelectorAll("[data-launch-state]").forEach(function (select) {
      select.addEventListener("change", function () {
        updateLaunchProfileControlEntry(select.getAttribute("data-launch-state"), {
          launch_state: select.value,
        });
        setLaunchControlFlashMessage("Updated launch state for the selected profile.");
        renderListings();
      });
    });

    root.querySelectorAll("[data-launch-homepage]").forEach(function (input) {
      input.addEventListener("change", function () {
        updateLaunchProfileControlEntry(input.getAttribute("data-launch-homepage"), {
          homepage_featured: input.checked,
        });
        setLaunchControlFlashMessage(
          input.checked
            ? "Added profile to homepage featured lane."
            : "Removed profile from homepage featured lane.",
        );
        renderListings();
      });
    });

    root.querySelectorAll("[data-launch-match]").forEach(function (input) {
      input.addEventListener("change", function () {
        updateLaunchProfileControlEntry(input.getAttribute("data-launch-match"), {
          match_priority: input.checked,
        });
        setLaunchControlFlashMessage(
          input.checked
            ? "Added profile to match-priority lane."
            : "Removed profile from match-priority lane.",
        );
        renderListings();
      });
    });

    root.querySelectorAll("[data-launch-quick-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        var slug = button.getAttribute("data-launch-quick-action") || "";
        var mode = button.getAttribute("data-launch-quick-mode") || "";
        if (!slug || !mode) {
          return;
        }
        if (mode === "feature_homepage") {
          updateLaunchProfileControlEntry(slug, {
            launch_state: "featured",
            homepage_featured: true,
            match_priority: true,
          });
          setLaunchControlFlashMessage(
            "Completed: profile promoted into featured homepage rotation.",
          );
          setLaunchControlFlashHistory(
            slug,
            "Completed: profile promoted into featured homepage rotation.",
          );
        } else if (mode === "promote_launch_ready") {
          updateLaunchProfileControlEntry(slug, {
            launch_state: "launch_ready",
            homepage_featured: false,
            match_priority: true,
          });
          setLaunchControlFlashMessage("Completed: profile marked ready to feature.");
          setLaunchControlFlashHistory(slug, "Completed: profile marked ready to feature.");
        } else if (mode === "set_standard") {
          updateLaunchProfileControlEntry(slug, {
            launch_state: "standard",
            homepage_featured: false,
            match_priority: false,
          });
          setLaunchControlFlashMessage("Completed: profile moved back to standard live rotation.");
          setLaunchControlFlashHistory(
            slug,
            "Completed: profile moved back to standard live rotation.",
          );
        }
        renderListings();
      });
    });

    root.querySelectorAll("[data-launch-focus]").forEach(function (button) {
      button.addEventListener("click", function () {
        var slug = button.getAttribute("data-launch-focus") || "";
        if (!slug) {
          return;
        }
        launchProfileFilters.state = "";
        launchProfileFilters.lane = "";
        rankingRiskFilter = "";
        renderListings();
        var target = root.querySelector('[data-launch-state="' + slug + '"]');
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          spotlightSection(target.closest(".mini-card"));
        }
      });
    });

    root.querySelectorAll("[data-route-health-action]").forEach(function (button) {
      button.addEventListener("click", async function () {
        var therapistId = button.getAttribute("data-route-health-action") || "";
        var actionKey = button.getAttribute("data-route-health-mode") || "";
        if (!therapistId || !actionKey || !queueRouteHealthFollowUp) {
          return;
        }
        var prior = button.textContent;
        button.disabled = true;
        button.textContent = "Queuing...";
        try {
          var message = await queueRouteHealthFollowUp(therapistId, actionKey);
          if (message) {
            setLaunchControlFlashMessage(message);
            renderListings();
          }
        } catch (_error) {
          button.disabled = false;
          button.textContent = prior;
        }
      });
    });

    root.querySelectorAll("[data-launch-promote]").forEach(function (button) {
      button.addEventListener("click", function () {
        var slug = button.getAttribute("data-launch-promote") || "";
        if (!slug) {
          return;
        }
        updateLaunchProfileControlEntry(slug, {
          launch_state: "launch_ready",
        });
        setLaunchControlFlashMessage("Completed: profile marked ready to feature.");
        setLaunchControlFlashHistory(slug, "Completed: profile marked ready to feature.");
        renderListings();
      });
    });

    root.querySelectorAll("[data-ranking-risk-filter]").forEach(function (button) {
      button.addEventListener("click", function () {
        rankingRiskFilter = button.getAttribute("data-ranking-risk-filter") || "";
        renderListings();
      });
    });

    root.querySelectorAll("[data-ranking-risk-next]").forEach(function (element) {
      element.addEventListener("click", function (event) {
        event.stopPropagation();
        var key = element.getAttribute("data-ranking-risk-next") || "";
        var targetId = element.getAttribute("data-target") || "";
        rankingRiskFilter = key;
        renderListings();
        var target = document.getElementById(targetId);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });

    var clearButton = root.querySelector("[data-clear-ranking-risk-filter]");
    if (clearButton) {
      clearButton.addEventListener("click", function () {
        rankingRiskFilter = "";
        launchProfileFilters.state = "";
        launchProfileFilters.lane = "";
        setLaunchControlFlashMessage("");
        renderListings();
      });
    }

    var clearLaunchFiltersButton = root.querySelector("[data-clear-launch-filters]");
    if (clearLaunchFiltersButton) {
      clearLaunchFiltersButton.addEventListener("click", function () {
        rankingRiskFilter = "";
        launchProfileFilters.state = "";
        launchProfileFilters.lane = "";
        setLaunchControlFlashMessage("");
        renderListings();
      });
    }
  }

  return {
    renderListings: renderListings,
  };
}
