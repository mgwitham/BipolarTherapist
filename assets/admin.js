import {
  getApplications,
  getStats,
  getTherapists,
  requestApplicationChanges,
  publishApplication,
  rejectApplication,
  resetDemoData,
} from "./store.js";
import { fetchPublicTherapists } from "./cms.js";
import {
  approveTherapistApplication,
  checkReviewApiHealth,
  getAdminSessionToken,
  fetchTherapistApplications,
  rejectTherapistApplication as rejectTherapistApplicationRemote,
  setAdminSessionToken,
  signInAdmin,
  signOutAdmin,
  updateTherapistApplication,
} from "./review-api.js";
import { getTherapistMatchReadiness, getTherapistReviewCoaching } from "./matching-model.js";
import {
  readFunnelEvents,
  summarizeAdaptiveSignals,
  summarizeFunnelEvents,
} from "./funnel-analytics.js";

let dataMode = "local";
let remoteApplications = [];
let publishedTherapists = [];
let authRequired = false;
const CONCIERGE_REQUESTS_KEY = "bth_concierge_requests_v1";
const OUTREACH_OUTCOMES_KEY = "bth_outreach_outcomes_v1";
const REQUEST_STATUS_OPTIONS = ["new", "triaging", "in_progress", "waiting_on_user", "resolved"];
const THERAPIST_FOLLOW_UP_OPTIONS = [
  "unreviewed",
  "good_candidate",
  "suggest_contact",
  "needs_review",
  "not_a_fit",
];
let applicationFilters = {
  q: "",
  status: "",
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  return new Date(value).toLocaleString();
}

function readConciergeRequests() {
  try {
    return normalizeConciergeRequests(
      JSON.parse(window.localStorage.getItem(CONCIERGE_REQUESTS_KEY) || "[]"),
    );
  } catch (_error) {
    return [];
  }
}

function writeConciergeRequests(value) {
  try {
    window.localStorage.setItem(CONCIERGE_REQUESTS_KEY, JSON.stringify(value));
  } catch (_error) {
    return;
  }
}

function readOutreachOutcomes() {
  try {
    return JSON.parse(window.localStorage.getItem(OUTREACH_OUTCOMES_KEY) || "[]");
  } catch (_error) {
    return [];
  }
}

function normalizeConciergeRequests(value) {
  return (Array.isArray(value) ? value : []).map(function (request) {
    var shortlist = Array.isArray(request && request.shortlist) ? request.shortlist : [];
    return {
      created_at: request && request.created_at ? request.created_at : new Date().toISOString(),
      share_link: request && request.share_link ? request.share_link : "",
      request_summary: request && request.request_summary ? request.request_summary : "",
      requester_name: request && request.requester_name ? request.requester_name : "",
      follow_up_preference:
        request && request.follow_up_preference ? request.follow_up_preference : "",
      help_topic: request && request.help_topic ? request.help_topic : "",
      request_note: request && request.request_note ? request.request_note : "",
      request_status:
        request && REQUEST_STATUS_OPTIONS.includes(request.request_status)
          ? request.request_status
          : "new",
      shortlist: shortlist.map(function (item) {
        return {
          slug: item && item.slug ? item.slug : "",
          name: item && item.name ? item.name : "Unknown therapist",
          priority: item && item.priority ? item.priority : "",
          note: item && item.note ? item.note : "",
          outreach: item && item.outreach ? item.outreach : "",
          follow_up_status:
            item && THERAPIST_FOLLOW_UP_OPTIONS.includes(item.follow_up_status)
              ? item.follow_up_status
              : "unreviewed",
        };
      }),
    };
  });
}

function updateConciergeRequestStatus(index, status) {
  var requests = readConciergeRequests();
  if (!requests[index]) {
    return;
  }
  requests[index].request_status = status;
  writeConciergeRequests(requests);
}

function updateConciergeShortlistStatus(requestIndex, shortlistIndex, status) {
  var requests = readConciergeRequests();
  if (!requests[requestIndex] || !requests[requestIndex].shortlist[shortlistIndex]) {
    return;
  }
  requests[requestIndex].shortlist[shortlistIndex].follow_up_status = status;
  writeConciergeRequests(requests);
}

function formatStatusLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, function (char) {
      return char.toUpperCase();
    });
}

function buildImprovementRequest(item, coaching) {
  var suggestions = Array.isArray(coaching) ? coaching.filter(Boolean) : [];
  var greeting = item && item.name ? "Hi " + item.name + "," : "Hi,";
  var intro =
    "Thanks for submitting your profile to BipolarTherapyHub. Your application is promising, and a few clarifications would make it much stronger for trust, matching, and outreach conversion.";
  var bullets = suggestions.length
    ? suggestions
        .map(function (suggestion) {
          return "- " + suggestion;
        })
        .join("\n")
    : "- Add a bit more clarity around trust, fit, and first-contact expectations.";
  var close =
    "Once these details are tightened, the profile should be much easier for users to evaluate and act on.\n\nThank you,\nBipolarTherapyHub Review";

  return [greeting, "", intro, "", bullets, "", close].join("\n");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_error) {
    return false;
  }
}

function appendImprovementRequestToNotes(root, id, requestText) {
  var field = root.querySelector('[data-notes-id="' + id + '"]');
  if (!field) {
    return false;
  }

  var current = field.value.trim();
  field.value = current ? current + "\n\n" + requestText : requestText;
  return true;
}

function setCoachActionStatus(root, id, message) {
  var status = root.querySelector('[data-coach-status-id="' + id + '"]');
  if (status) {
    status.textContent = message;
  }
}

function buildRevisionHistoryHtml(item) {
  var history = Array.isArray(item.revision_history) ? item.revision_history : [];
  if (!history.length) {
    return "";
  }

  return (
    '<div class="notes-box"><label><strong>Revision history</strong></label><div class="review-history-list">' +
    history
      .slice()
      .reverse()
      .map(function (entry) {
        return (
          '<div class="review-history-item"><strong>' +
          escapeHtml(formatStatusLabel(entry.type || "update")) +
          "</strong> · " +
          escapeHtml(formatDate(entry.at)) +
          (entry.message
            ? '<div class="mini-status">' + escapeHtml(entry.message) + "</div>"
            : "") +
          "</div>"
        );
      })
      .join("") +
    "</div></div>"
  );
}

function analyzeConciergePatterns(requests) {
  var entries = Array.isArray(requests) ? requests : [];
  var totals = {
    insurance: 0,
    availability: 0,
    medication: 0,
    contact_first: 0,
    fit_uncertainty: 0,
  };

  entries.forEach(function (request) {
    var haystack = [
      request.help_topic || "",
      request.request_note || "",
      request.request_summary || "",
    ]
      .join(" ")
      .toLowerCase();

    if (
      haystack.includes("insurance") ||
      haystack.includes("cost") ||
      haystack.includes("coverage")
    ) {
      totals.insurance += 1;
    }
    if (
      haystack.includes("availability") ||
      haystack.includes("wait") ||
      haystack.includes("timing") ||
      haystack.includes("schedule")
    ) {
      totals.availability += 1;
    }
    if (
      haystack.includes("medication") ||
      haystack.includes("psychiatry") ||
      haystack.includes("med support")
    ) {
      totals.medication += 1;
    }
    if (
      haystack.includes("who should i contact first") ||
      haystack.includes("contact first") ||
      haystack.includes("one person first")
    ) {
      totals.contact_first += 1;
    }
    if (
      haystack.includes("best fit") ||
      haystack.includes("fit") ||
      haystack.includes("not sure") ||
      haystack.includes("uncertain")
    ) {
      totals.fit_uncertainty += 1;
    }
  });

  return Object.keys(totals)
    .map(function (key) {
      return {
        key: key,
        label:
          key === "insurance"
            ? "Insurance or cost confusion"
            : key === "availability"
              ? "Availability or timing friction"
              : key === "medication"
                ? "Medication or psychiatry uncertainty"
                : key === "contact_first"
                  ? "Unsure who to contact first"
                  : "General fit uncertainty",
        count: totals[key],
      };
    })
    .filter(function (item) {
      return item.count > 0;
    })
    .sort(function (a, b) {
      return b.count - a.count || a.label.localeCompare(b.label);
    });
}

function analyzeOutreachOutcomes(outcomes) {
  var entries = Array.isArray(outcomes) ? outcomes : [];
  return {
    reached_out: entries.filter(function (item) {
      return item.outcome === "reached_out";
    }).length,
    heard_back: entries.filter(function (item) {
      return item.outcome === "heard_back";
    }).length,
    booked_consult: entries.filter(function (item) {
      return item.outcome === "booked_consult";
    }).length,
    good_fit_call: entries.filter(function (item) {
      return item.outcome === "good_fit_call";
    }).length,
    insurance_mismatch: entries.filter(function (item) {
      return item.outcome === "insurance_mismatch";
    }).length,
    waitlist: entries.filter(function (item) {
      return item.outcome === "waitlist";
    }).length,
    no_response: entries.filter(function (item) {
      return item.outcome === "no_response";
    }).length,
  };
}

function analyzeOutreachJourneys(outcomes) {
  const entries = Array.isArray(outcomes) ? outcomes : [];
  const byJourney = entries.reduce(function (accumulator, item) {
    if (!item || !item.journey_id) {
      return accumulator;
    }
    if (!accumulator[item.journey_id]) {
      accumulator[item.journey_id] = [];
    }
    accumulator[item.journey_id].push(item);
    return accumulator;
  }, {});

  const totals = {
    fallback_after_no_response: 0,
    fallback_after_waitlist: 0,
    fallback_after_insurance_mismatch: 0,
    second_choice_success: 0,
  };

  Object.keys(byJourney).forEach(function (journeyId) {
    const journey = byJourney[journeyId].slice().sort(function (a, b) {
      return new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime();
    });
    const byRank = {};

    journey.forEach(function (item) {
      if (!byRank[item.rank_position]) {
        byRank[item.rank_position] = [];
      }
      byRank[item.rank_position].push(item.outcome);
    });

    const first = byRank[1] || [];
    const second = byRank[2] || [];

    if (first.includes("no_response") && second.length) {
      totals.fallback_after_no_response += 1;
    }
    if (first.includes("waitlist") && second.length) {
      totals.fallback_after_waitlist += 1;
    }
    if (first.includes("insurance_mismatch") && second.length) {
      totals.fallback_after_insurance_mismatch += 1;
    }
    if (
      second.some(function (outcome) {
        return outcome === "booked_consult" || outcome === "good_fit_call";
      })
    ) {
      totals.second_choice_success += 1;
    }
  });

  return totals;
}

function analyzePivotTiming(outcomes) {
  const entries = Array.isArray(outcomes) ? outcomes : [];
  const byJourney = entries.reduce(function (accumulator, item) {
    if (!item || !item.journey_id) {
      return accumulator;
    }
    if (!accumulator[item.journey_id]) {
      accumulator[item.journey_id] = [];
    }
    accumulator[item.journey_id].push(item);
    return accumulator;
  }, {});

  const totals = {
    on_time_pivots: 0,
    early_pivots: 0,
    late_pivots: 0,
  };

  Object.keys(byJourney).forEach(function (journeyId) {
    const journey = byJourney[journeyId].slice().sort(function (a, b) {
      return new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime();
    });
    const firstNegative = journey.find(function (item) {
      return (
        item.rank_position === 1 &&
        ["no_response", "waitlist", "insurance_mismatch"].includes(item.outcome)
      );
    });
    const fallbackAttempt = journey.find(function (item) {
      return item.rank_position > 1;
    });

    if (!firstNegative || !fallbackAttempt || !firstNegative.pivot_at) {
      return;
    }

    const pivotAt = new Date(firstNegative.pivot_at).getTime();
    const fallbackAt = new Date(fallbackAttempt.recorded_at).getTime();
    const delta = fallbackAt - pivotAt;
    const tolerance = 12 * 60 * 60 * 1000;

    if (Math.abs(delta) <= tolerance) {
      totals.on_time_pivots += 1;
    } else if (delta < -tolerance) {
      totals.early_pivots += 1;
    } else {
      totals.late_pivots += 1;
    }
  });

  return totals;
}

function formatAdaptiveLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, function (char) {
      return char.toUpperCase();
    });
}

function buildStrategyHealthSummary(outcomes) {
  var summary = analyzeOutreachOutcomes(outcomes);
  var strong = summary.booked_consult + summary.good_fit_call + summary.heard_back;
  var friction = summary.no_response + summary.waitlist + summary.insurance_mismatch;

  if (!strong && !friction) {
    return {
      label: "Too little outcome data yet",
      note: "As outreach outcomes accumulate, this will show whether the current strategy lean is producing stronger follow-through.",
    };
  }

  if (strong >= friction + 2) {
    return {
      label: "Current strategy lean looks healthy",
      note: "Strong downstream outcomes are outpacing friction outcomes in the local dataset.",
    };
  }

  if (friction >= strong + 2) {
    return {
      label: "Current strategy lean needs tuning",
      note: "Friction outcomes are outpacing strong outcomes, so the product may be nudging the wrong next move too often.",
    };
  }

  return {
    label: "Current strategy lean is mixed",
    note: "The local data shows both traction and friction, so this is a good moment to keep watching before over-correcting.",
  };
}

function analyzeStrategyPerformance(events, outcomes) {
  var buckets = {
    outreach: { matches: 0, saves: 0, help: 0, outreach_starts: 0, strong: 0, friction: 0 },
    save: { matches: 0, saves: 0, help: 0, outreach_starts: 0, strong: 0, friction: 0 },
    help: { matches: 0, saves: 0, help: 0, outreach_starts: 0, strong: 0, friction: 0 },
  };

  (Array.isArray(events) ? events : []).forEach(function (item) {
    var strategy =
      item &&
      item.payload &&
      item.payload.strategy &&
      item.payload.strategy.match_action &&
      buckets[item.payload.strategy.match_action]
        ? item.payload.strategy.match_action
        : "";
    if (!strategy) {
      return;
    }
    if (item.type === "match_submitted") {
      buckets[strategy].matches += 1;
    } else if (item.type === "match_shortlist_saved" || item.type === "match_share_link_copied") {
      buckets[strategy].saves += 1;
    } else if (item.type === "match_help_requested") {
      buckets[strategy].help += 1;
    } else if (item.type === "match_recommended_outreach_started") {
      buckets[strategy].outreach_starts += 1;
    }
  });

  (Array.isArray(outcomes) ? outcomes : []).forEach(function (item) {
    var strategy =
      item &&
      item.context &&
      item.context.strategy &&
      item.context.strategy.match_action &&
      buckets[item.context.strategy.match_action]
        ? item.context.strategy.match_action
        : "";
    if (!strategy) {
      return;
    }

    if (["heard_back", "booked_consult", "good_fit_call"].includes(item.outcome)) {
      buckets[strategy].strong += 1;
    } else if (["no_response", "waitlist", "insurance_mismatch"].includes(item.outcome)) {
      buckets[strategy].friction += 1;
    }
  });

  return Object.keys(buckets)
    .map(function (key) {
      return {
        key: key,
        label: formatAdaptiveLabel(key),
        metrics: buckets[key],
      };
    })
    .filter(function (item) {
      return (
        item.metrics.matches ||
        item.metrics.saves ||
        item.metrics.help ||
        item.metrics.outreach_starts ||
        item.metrics.strong ||
        item.metrics.friction
      );
    })
    .sort(function (a, b) {
      return (
        b.metrics.strong - a.metrics.strong ||
        b.metrics.outreach_starts - a.metrics.outreach_starts ||
        b.metrics.matches - a.metrics.matches ||
        a.label.localeCompare(b.label)
      );
    });
}

function buildSegmentStrategySnapshots(events, outcomes) {
  var segments = [
    { label: "Urgent users", keys: ["urgency:asap", "urgency:within-2-weeks"] },
    { label: "Insurance-led users", keys: ["insurance:user"] },
    { label: "Psychiatry / medication users", keys: ["intent:psychiatry", "medication:yes"] },
  ];

  return segments
    .map(function (segment) {
      var adaptive = summarizeAdaptiveSignals(events, outcomes, segment.keys);
      var signalCount =
        adaptive.action_counts.outreach + adaptive.action_counts.help + adaptive.action_counts.save;
      return {
        label: segment.label,
        preferred_match_action: adaptive.preferred_match_action,
        basis: adaptive.match_action_basis,
        signal_count: signalCount,
      };
    })
    .filter(function (item) {
      return item.signal_count > 0;
    });
}

function renderStats() {
  if (authRequired) {
    document.getElementById("adminStats").innerHTML = "";
    return;
  }

  const stats =
    dataMode === "sanity"
      ? {
          total_therapists: publishedTherapists.length,
          states_covered: new Set(
            publishedTherapists.map(function (item) {
              return item.state;
            }),
          ).size,
          accepting_count: publishedTherapists.filter(function (item) {
            return item.accepting_new_patients;
          }).length,
        }
      : getStats();
  const therapists = dataMode === "sanity" ? publishedTherapists : getTherapists();
  const applications = dataMode === "sanity" ? remoteApplications : getApplications();
  const conciergeRequests = readConciergeRequests();
  const outreachOutcomes = readOutreachOutcomes();
  const funnelSummary = summarizeFunnelEvents(readFunnelEvents());
  const matchReadyCount = therapists.filter(function (item) {
    return getTherapistMatchReadiness(item).score >= 85;
  }).length;
  const openConciergeCount = conciergeRequests.filter(function (item) {
    return item.request_status !== "resolved";
  }).length;
  const heardBackCount = outreachOutcomes.filter(function (item) {
    return item.outcome === "heard_back";
  }).length;
  const bookedConsultCount = outreachOutcomes.filter(function (item) {
    return item.outcome === "booked_consult";
  }).length;

  document.getElementById("adminStats").innerHTML =
    '<div class="stat-card"><div class="stat-value">' +
    therapists.length +
    '</div><div class="stat-label">Published listings</div></div>' +
    '<div class="stat-card"><div class="stat-value">' +
    applications.filter(function (item) {
      return item.status === "pending";
    }).length +
    '</div><div class="stat-label">Pending applications</div></div>' +
    '<div class="stat-card"><div class="stat-value">' +
    stats.states_covered +
    '</div><div class="stat-label">States covered</div></div>' +
    '<div class="stat-card"><div class="stat-value">' +
    stats.accepting_count +
    '</div><div class="stat-label">Accepting patients</div></div>' +
    '<div class="stat-card"><div class="stat-value">' +
    matchReadyCount +
    '</div><div class="stat-label">Match-ready profiles</div></div>' +
    '<div class="stat-card"><div class="stat-value">' +
    conciergeRequests.length +
    '</div><div class="stat-label">Concierge requests</div></div>' +
    '<div class="stat-card"><div class="stat-value">' +
    openConciergeCount +
    '</div><div class="stat-label">Open concierge items</div></div>' +
    '<div class="stat-card"><div class="stat-value">' +
    heardBackCount +
    '</div><div class="stat-label">Heard-back outcomes</div></div>' +
    '<div class="stat-card"><div class="stat-value">' +
    bookedConsultCount +
    '</div><div class="stat-label">Booked consults</div></div>' +
    '<div class="stat-card"><div class="stat-value">' +
    funnelSummary.searches +
    '</div><div class="stat-label">Searches tracked</div></div>' +
    '<div class="stat-card"><div class="stat-value">' +
    funnelSummary.matches +
    '</div><div class="stat-label">Matches run</div></div>' +
    '<div class="stat-card"><div class="stat-value">' +
    funnelSummary.shortlist_saves +
    '</div><div class="stat-label">Shortlist saves</div></div>' +
    '<div class="stat-card"><div class="stat-value">' +
    funnelSummary.help_requests +
    '</div><div class="stat-label">Help requests</div></div>';
}

function renderFunnelInsights() {
  const root = document.getElementById("funnelInsights");
  if (!root) {
    return;
  }

  if (authRequired) {
    root.innerHTML = "";
    return;
  }

  const events = readFunnelEvents();
  const summary = summarizeFunnelEvents(events);
  const outcomes = readOutreachOutcomes();
  const adaptive = summarizeAdaptiveSignals(events, outcomes);
  const strategyHealth = buildStrategyHealthSummary(outcomes);
  const strategyPerformance = analyzeStrategyPerformance(events, outcomes);
  const segmentSnapshots = buildSegmentStrategySnapshots(events, outcomes);
  if (!summary.total) {
    root.innerHTML =
      '<div class="empty">No funnel analytics captured yet. Once users browse, save, match, and reach out, the local event rollup will appear here.</div>';
    return;
  }

  root.innerHTML =
    '<div class="queue-insights"><div class="queue-insights-title">Funnel signals we are seeing</div><div class="queue-insights-grid">' +
    [
      { label: "Searches tracked", count: summary.searches },
      { label: "Matches run", count: summary.matches },
      { label: "Shortlist saves", count: summary.shortlist_saves },
      { label: "Help requests", count: summary.help_requests },
      { label: "Outreach starts", count: summary.outreach_starts },
    ]
      .map(function (item) {
        return (
          '<div class="queue-insight-card"><div class="queue-insight-value">' +
          escapeHtml(item.count) +
          '</div><div class="queue-insight-label">' +
          escapeHtml(item.label) +
          "</div></div>"
        );
      })
      .join("") +
    "</div></div>" +
    '<div class="queue-insights"><div class="queue-insights-title">Current adaptive strategy</div><div class="queue-insights-grid">' +
    [
      {
        label: "Match flow leaning toward",
        count:
          formatAdaptiveLabel(adaptive.preferred_match_action) +
          " (" +
          formatAdaptiveLabel(adaptive.match_action_basis) +
          "-led)",
      },
      {
        label: "Homepage teaser default",
        count: formatAdaptiveLabel(adaptive.preferred_home_mode),
      },
      {
        label: "Directory default sort",
        count: formatAdaptiveLabel(adaptive.preferred_directory_sort),
      },
      {
        label: "Outreach-first signals",
        count: adaptive.action_counts.outreach,
      },
      {
        label: "Help-first signals",
        count: adaptive.action_counts.help,
      },
      {
        label: "Save-first signals",
        count: adaptive.action_counts.save,
      },
    ]
      .map(function (item) {
        return (
          '<div class="queue-insight-card"><div class="queue-insight-value">' +
          escapeHtml(item.count) +
          '</div><div class="queue-insight-label">' +
          escapeHtml(item.label) +
          "</div></div>"
        );
      })
      .join("") +
    '</div><div class="mini-status" style="margin-top:0.75rem"><strong>' +
    escapeHtml(strategyHealth.label) +
    ":</strong> " +
    escapeHtml(strategyHealth.note) +
    "</div></div>" +
    (segmentSnapshots.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Segment-aware strategy snapshots</div><div class="queue-insights-grid">' +
        segmentSnapshots
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              escapeHtml(item.label) +
              '</div><div class="queue-insight-label">' +
              escapeHtml(
                formatAdaptiveLabel(item.preferred_match_action) +
                  " (" +
                  formatAdaptiveLabel(item.basis) +
                  "-led)",
              ) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    (strategyPerformance.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Strategy performance by active match lean</div><div class="queue-insights-grid">' +
        strategyPerformance
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              escapeHtml(item.label) +
              '</div><div class="queue-insight-label">' +
              escapeHtml(
                item.metrics.matches +
                  " matches · " +
                  item.metrics.outreach_starts +
                  " outreach starts · " +
                  item.metrics.strong +
                  " strong outcomes · " +
                  item.metrics.friction +
                  " friction outcomes",
              ) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    (summary.top_types.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Most common tracked actions</div><div class="queue-insights-grid">' +
        summary.top_types
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              escapeHtml(item.count) +
              '</div><div class="queue-insight-label">' +
              escapeHtml(String(item.type).replace(/_/g, " ")) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "");
}

function renderListings() {
  if (authRequired) {
    document.getElementById("publishedListings").innerHTML = "";
    return;
  }

  const therapists = dataMode === "sanity" ? publishedTherapists : getTherapists();
  const root = document.getElementById("publishedListings");
  root.innerHTML = therapists
    .map(function (item) {
      const readiness = getTherapistMatchReadiness(item);
      return (
        '<div class="mini-card"><div><strong>' +
        item.name +
        '</strong><div class="subtle">' +
        item.city +
        ", " +
        item.state +
        " · " +
        item.credentials +
        '</div><div class="subtle">' +
        escapeHtml(readiness.label) +
        " · " +
        escapeHtml(readiness.score) +
        '/100</div></div><a href="therapist.html?slug=' +
        item.slug +
        '">Open profile</a></div>'
      );
    })
    .join("");
}

function renderApplications() {
  const applications = dataMode === "sanity" ? remoteApplications : getApplications();
  const root = document.getElementById("applicationsList");
  const filteredApplications = applications.filter(function (item) {
    const haystack = [item.name, item.city, item.state, item.credentials, item.title, item.email]
      .concat(item.specialties || [])
      .join(" ")
      .toLowerCase();

    if (applicationFilters.q && !haystack.includes(applicationFilters.q.toLowerCase())) {
      return false;
    }

    if (applicationFilters.status && item.status !== applicationFilters.status) {
      return false;
    }

    return true;
  });

  if (authRequired) {
    root.innerHTML = "";
    return;
  }

  if (!applications.length) {
    root.innerHTML =
      '<div class="empty">No applications yet. Submit one through the signup page to test the workflow.</div>';
    return;
  }

  if (!filteredApplications.length) {
    root.innerHTML =
      '<div class="empty">No applications match the current review filters. Try a different search or status.</div>';
    return;
  }

  root.innerHTML = filteredApplications
    .map(function (item) {
      const readiness = getTherapistMatchReadiness(item);
      const coaching = getTherapistReviewCoaching(item);
      const improvementRequest = buildImprovementRequest(item, coaching);
      const revisionLink = new URL(
        "signup.html?revise=" + encodeURIComponent(item.id),
        window.location.href,
      ).toString();
      const fitTags = []
        .concat(item.treatment_modalities || [])
        .concat(item.client_populations || [])
        .slice(0, 8)
        .map(function (tag) {
          return '<span class="tag">' + escapeHtml(tag) + "</span>";
        })
        .join("");

      const actions =
        item.status === "pending"
          ? '<button class="btn-secondary" data-action="reviewing" data-id="' +
            item.id +
            '">Mark Reviewing</button><button class="btn-secondary" data-action="requested_changes" data-id="' +
            item.id +
            '" data-request="' +
            escapeHtml(improvementRequest) +
            '" data-link="' +
            escapeHtml(revisionLink) +
            '">Request Changes</button><button class="btn-primary" data-action="publish" data-id="' +
            item.id +
            '">Publish</button><button class="btn-secondary" data-action="reject" data-id="' +
            item.id +
            '">Reject</button>'
          : item.status === "reviewing"
            ? '<button class="btn-primary" data-action="publish" data-id="' +
              item.id +
              '">Publish</button><button class="btn-secondary" data-action="requested_changes" data-id="' +
              item.id +
              '" data-request="' +
              escapeHtml(improvementRequest) +
              '" data-link="' +
              escapeHtml(revisionLink) +
              '">Request Changes</button><button class="btn-secondary" data-action="pending" data-id="' +
              item.id +
              '">Move to Pending</button><button class="btn-secondary" data-action="reject" data-id="' +
              item.id +
              '">Reject</button>'
            : item.status === "requested_changes"
              ? '<span class="status requested_changes">requested changes</span><button class="btn-secondary" data-action="copy-revision-link" data-id="' +
                item.id +
                '" data-link="' +
                escapeHtml(revisionLink) +
                '">Copy revision link</button><button class="btn-secondary" data-action="pending" data-id="' +
                item.id +
                '">Move to Pending</button>'
              : item.status === "approved"
                ? '<span class="status approved">approved</span>'
                : '<span class="status ' + item.status + '">' + item.status + "</span>";

      return (
        '<article class="application-card">' +
        '<div class="application-head"><div><h3>' +
        escapeHtml(item.name) +
        '</h3><p class="subtle">' +
        escapeHtml(item.credentials) +
        (item.title ? " · " + escapeHtml(item.title) : "") +
        " · " +
        escapeHtml(item.city) +
        ", " +
        escapeHtml(item.state) +
        '</p></div><div class="subtle">' +
        formatDate(item.created_at) +
        "</div></div>" +
        '<div class="tag-row"><span class="tag">' +
        escapeHtml(item.verification_status || "under_review").replace(/_/g, " ") +
        "</span>" +
        (item.bipolar_years_experience
          ? '<span class="tag">' +
            escapeHtml(item.bipolar_years_experience) +
            " yrs bipolar care</span>"
          : "") +
        (item.medication_management ? '<span class="tag">Medication management</span>' : "") +
        '<span class="tag">' +
        escapeHtml(readiness.label) +
        " · " +
        escapeHtml(readiness.score) +
        "/100</span>" +
        "</div>" +
        (item.care_approach
          ? '<p class="application-bio"><strong>How they help bipolar clients:</strong> ' +
            escapeHtml(item.care_approach) +
            "</p>"
          : "") +
        '<p class="application-bio">' +
        escapeHtml(item.bio) +
        "</p>" +
        '<div class="tag-row">' +
        (item.specialties || [])
          .map(function (specialty) {
            return '<span class="tag">' + escapeHtml(specialty) + "</span>";
          })
          .join("") +
        "</div>" +
        (fitTags ? '<div class="tag-row">' + fitTags + "</div>" : "") +
        '<div class="meta-grid">' +
        "<div><strong>Email:</strong> " +
        escapeHtml(item.email) +
        "</div>" +
        "<div><strong>Phone:</strong> " +
        escapeHtml(item.phone || "Not provided") +
        "</div>" +
        "<div><strong>License:</strong> " +
        escapeHtml(
          [item.license_state, item.license_number].filter(Boolean).join(" · ") || "Not provided",
        ) +
        "</div>" +
        "<div><strong>Wait time:</strong> " +
        escapeHtml(item.estimated_wait_time || "Not provided") +
        "</div>" +
        "<div><strong>Insurance:</strong> " +
        escapeHtml((item.insurance_accepted || []).join(", ") || "Not provided") +
        "</div>" +
        "<div><strong>Format:</strong> " +
        [item.accepts_telehealth ? "Telehealth" : "", item.accepts_in_person ? "In-Person" : ""]
          .filter(Boolean)
          .join(" / ") +
        "</div>" +
        "<div><strong>Preferred contact:</strong> " +
        escapeHtml(
          item.preferred_contact_method
            ? item.preferred_contact_method === "booking"
              ? "Booking link"
              : item.preferred_contact_method
            : "Not provided",
        ) +
        "</div>" +
        "<div><strong>CTA label:</strong> " +
        escapeHtml(item.preferred_contact_label || "Not provided") +
        "</div>" +
        "<div><strong>Booking URL:</strong> " +
        (item.booking_url
          ? '<a href="' +
            escapeHtml(item.booking_url) +
            '" target="_blank" rel="noopener">Open link</a>'
          : "Not provided") +
        "</div>" +
        "<div><strong>Contact guidance:</strong> " +
        escapeHtml(item.contact_guidance || "Not provided") +
        "</div>" +
        "<div><strong>After outreach:</strong> " +
        escapeHtml(item.first_step_expectation || "Not provided") +
        "</div>" +
        "<div><strong>Languages:</strong> " +
        escapeHtml((item.languages || []).join(", ") || "English") +
        "</div>" +
        "<div><strong>Telehealth states:</strong> " +
        escapeHtml((item.telehealth_states || []).join(", ") || "Not provided") +
        "</div>" +
        "<div><strong>Match readiness:</strong> " +
        escapeHtml(readiness.label) +
        " (" +
        escapeHtml(readiness.score) +
        "/100)</div>" +
        "<div><strong>Profile completeness:</strong> " +
        escapeHtml(readiness.completeness_score) +
        "/100</div>" +
        "</div>" +
        (readiness.strengths.length
          ? '<div class="notes-box"><label><strong>Already strong for matching</strong></label><div class="tag-row">' +
            readiness.strengths
              .map(function (strength) {
                return '<span class="tag">' + escapeHtml(strength) + "</span>";
              })
              .join("") +
            "</div></div>"
          : "") +
        (readiness.missing_items.length
          ? '<div class="notes-box"><label><strong>Best next fixes for match quality</strong></label><div class="tag-row">' +
            readiness.missing_items
              .map(function (itemText) {
                return '<span class="tag">' + escapeHtml(itemText) + "</span>";
              })
              .join("") +
            "</div></div>"
          : "") +
        (coaching.length
          ? '<div class="notes-box review-coach-box"><label><strong>Reviewer coaching prompts</strong></label><div class="review-coach-list">' +
            coaching
              .map(function (itemText) {
                return '<div class="review-coach-item">' + escapeHtml(itemText) + "</div>";
              })
              .join("") +
            '</div><div class="review-coach-actions"><button class="btn-secondary" data-action="copy-improvement-request" data-id="' +
            item.id +
            '" data-request="' +
            escapeHtml(improvementRequest) +
            '">Copy improvement request</button><button class="btn-secondary" data-action="append-improvement-request" data-id="' +
            item.id +
            '" data-request="' +
            escapeHtml(improvementRequest) +
            '">Add request to notes</button><span class="review-coach-status" data-coach-status-id="' +
            item.id +
            '">Ready to reuse</span></div>' +
            "</div></div>"
          : "") +
        buildRevisionHistoryHtml(item) +
        '<div class="action-row">' +
        actions +
        "</div>" +
        '<div class="notes-box"><label><strong>Internal notes</strong></label><textarea data-notes-id="' +
        item.id +
        '" placeholder="Add review notes, follow-up items, or context for later...">' +
        (item.notes || "") +
        '</textarea><div class="notes-actions"><button class="btn-secondary" data-action="save-notes" data-id="' +
        item.id +
        '">Save Notes</button><span class="mini-status">' +
        (item.notes ? "Notes saved" : "No notes yet") +
        "</span></div></div>" +
        "</article>"
      );
    })
    .join("");

  root.querySelectorAll("[data-action]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const id = button.getAttribute("data-id");
      const action = button.getAttribute("data-action");
      button.disabled = true;
      try {
        if (dataMode === "sanity") {
          if (action === "copy-revision-link") {
            const copied = await copyText(button.getAttribute("data-link") || "");
            setCoachActionStatus(
              root,
              id,
              copied ? "Revision link copied" : "Copy failed on this browser",
            );
            return;
          }
          if (action === "copy-improvement-request") {
            const requestText = button.getAttribute("data-request") || "";
            const copied = await copyText(requestText);
            setCoachActionStatus(
              root,
              id,
              copied ? "Improvement request copied" : "Copy failed on this browser",
            );
            return;
          }
          if (action === "append-improvement-request") {
            const requestText = button.getAttribute("data-request") || "";
            const appended = appendImprovementRequestToNotes(root, id, requestText);
            setCoachActionStatus(
              root,
              id,
              appended ? "Added to notes. Save notes when ready." : "Could not find notes field",
            );
            return;
          }
          if (action === "publish") await approveTherapistApplication(id);
          if (action === "reject") await rejectTherapistApplicationRemote(id);
          if (action === "reviewing") {
            await updateTherapistApplication(id, { status: "reviewing" });
          }
          if (action === "requested_changes") {
            await updateTherapistApplication(id, {
              status: "requested_changes",
              review_request_message: button.getAttribute("data-request") || "",
              revision_history_entry: {
                type: "requested_changes",
                message: button.getAttribute("data-request") || "",
              },
            });
          }
          if (action === "pending") {
            await updateTherapistApplication(id, { status: "pending" });
          }
          if (action === "save-notes") {
            const field = root.querySelector('[data-notes-id="' + id + '"]');
            await updateTherapistApplication(id, {
              notes: field ? field.value : "",
            });
          }
          await loadData();
        } else {
          if (action === "copy-revision-link") {
            const copied = await copyText(button.getAttribute("data-link") || "");
            setCoachActionStatus(
              root,
              id,
              copied ? "Revision link copied" : "Copy failed on this browser",
            );
            return;
          }
          if (action === "copy-improvement-request") {
            const requestText = button.getAttribute("data-request") || "";
            const copied = await copyText(requestText);
            setCoachActionStatus(
              root,
              id,
              copied ? "Improvement request copied" : "Copy failed on this browser",
            );
            return;
          }
          if (action === "append-improvement-request") {
            const requestText = button.getAttribute("data-request") || "";
            const appended = appendImprovementRequestToNotes(root, id, requestText);
            setCoachActionStatus(
              root,
              id,
              appended ? "Added to notes. Save notes when ready." : "Could not find notes field",
            );
            return;
          }
          if (action === "requested_changes") {
            requestApplicationChanges(id, button.getAttribute("data-request") || "");
          }
          if (action === "publish") publishApplication(id);
          if (action === "reject") rejectApplication(id);
          renderAll();
        }
      } finally {
        button.disabled = false;
      }
    });
  });
}

function renderConciergeQueue() {
  const root = document.getElementById("conciergeQueue");
  if (!root) {
    return;
  }

  if (authRequired) {
    root.innerHTML = "";
    return;
  }

  const requests = readConciergeRequests();
  const outreachOutcomes = readOutreachOutcomes();
  if (!requests.length) {
    root.innerHTML =
      '<div class="empty">No concierge requests captured yet. Once users ask for help in the match flow, they will appear here on this device.</div>';
    return;
  }

  const patterns = analyzeConciergePatterns(requests);
  const outcomeSummary = analyzeOutreachOutcomes(outreachOutcomes);
  const journeySummary = analyzeOutreachJourneys(outreachOutcomes);
  const timingSummary = analyzePivotTiming(outreachOutcomes);
  const insightsHtml = patterns.length
    ? '<div class="queue-insights"><div class="queue-insights-title">Stuck patterns we are seeing</div><div class="queue-insights-grid">' +
      patterns
        .slice(0, 5)
        .map(function (pattern) {
          return (
            '<div class="queue-insight-card"><div class="queue-insight-value">' +
            escapeHtml(pattern.count) +
            '</div><div class="queue-insight-label">' +
            escapeHtml(pattern.label) +
            "</div></div>"
          );
        })
        .join("") +
      "</div></div>"
    : "";
  const outcomeHtml = outreachOutcomes.length
    ? '<div class="queue-insights"><div class="queue-insights-title">Recommended outreach outcomes</div><div class="queue-insights-grid">' +
      [
        { label: "Reached out", count: outcomeSummary.reached_out },
        { label: "Heard back", count: outcomeSummary.heard_back },
        { label: "Booked consult", count: outcomeSummary.booked_consult },
        { label: "Good fit call", count: outcomeSummary.good_fit_call },
        { label: "Insurance mismatch", count: outcomeSummary.insurance_mismatch },
        { label: "Hit a waitlist", count: outcomeSummary.waitlist },
        { label: "No response yet", count: outcomeSummary.no_response },
      ]
        .map(function (item) {
          return (
            '<div class="queue-insight-card"><div class="queue-insight-value">' +
            escapeHtml(item.count) +
            '</div><div class="queue-insight-label">' +
            escapeHtml(item.label) +
            "</div></div>"
          );
        })
        .join("") +
      "</div></div>"
    : "";
  const journeyHtml =
    journeySummary.fallback_after_no_response ||
    journeySummary.fallback_after_waitlist ||
    journeySummary.fallback_after_insurance_mismatch ||
    journeySummary.second_choice_success
      ? '<div class="queue-insights"><div class="queue-insights-title">Fallback journey patterns</div><div class="queue-insights-grid">' +
        [
          {
            label: "Fallback after no response",
            count: journeySummary.fallback_after_no_response,
          },
          {
            label: "Fallback after waitlist",
            count: journeySummary.fallback_after_waitlist,
          },
          {
            label: "Fallback after insurance mismatch",
            count: journeySummary.fallback_after_insurance_mismatch,
          },
          {
            label: "Second-choice success",
            count: journeySummary.second_choice_success,
          },
        ]
          .filter(function (item) {
            return item.count > 0;
          })
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              escapeHtml(item.count) +
              '</div><div class="queue-insight-label">' +
              escapeHtml(item.label) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "";
  const timingHtml =
    timingSummary.on_time_pivots || timingSummary.early_pivots || timingSummary.late_pivots
      ? '<div class="queue-insights"><div class="queue-insights-title">Pivot timing patterns</div><div class="queue-insights-grid">' +
        [
          { label: "On-time pivots", count: timingSummary.on_time_pivots },
          { label: "Early pivots", count: timingSummary.early_pivots },
          { label: "Late pivots", count: timingSummary.late_pivots },
        ]
          .filter(function (item) {
            return item.count > 0;
          })
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              escapeHtml(item.count) +
              '</div><div class="queue-insight-label">' +
              escapeHtml(item.label) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "";

  root.innerHTML =
    insightsHtml +
    outcomeHtml +
    journeyHtml +
    timingHtml +
    requests
      .slice(0, 12)
      .map(function (request, index) {
        const shortlist = Array.isArray(request.shortlist) ? request.shortlist : [];
        const note = String(request.request_note || "").trim();
        const summary = String(request.request_summary || "No request summary captured.");
        return (
          '<article class="queue-card"><div class="queue-head"><div><h3>' +
          escapeHtml(request.requester_name || "Unnamed concierge request") +
          '</h3><div class="subtle">' +
          formatDate(request.created_at) +
          (request.follow_up_preference ? " · " + escapeHtml(request.follow_up_preference) : "") +
          (request.help_topic ? " · " + escapeHtml(request.help_topic) : "") +
          '</div></div><div class="queue-head-actions"><span class="tag">' +
          escapeHtml(formatStatusLabel(request.request_status)) +
          '</span><span class="tag">Request ' +
          (index + 1) +
          '</span></div></div><div class="queue-actions" style="margin-top:0.8rem"><label class="queue-select-label" for="request-status-' +
          index +
          '">Request status</label><select class="queue-select" id="request-status-' +
          index +
          '" data-request-status="' +
          index +
          '">' +
          REQUEST_STATUS_OPTIONS.map(function (option) {
            return (
              '<option value="' +
              escapeHtml(option) +
              '"' +
              (request.request_status === option ? " selected" : "") +
              ">" +
              escapeHtml(formatStatusLabel(option)) +
              "</option>"
            );
          }).join("") +
          "</select></div>" +
          '<div class="queue-summary"><strong>Request summary:</strong> ' +
          escapeHtml(summary) +
          "</div>" +
          (note
            ? '<div class="queue-summary"><strong>What feels uncertain:</strong> ' +
              escapeHtml(note) +
              "</div>"
            : "") +
          (shortlist.length
            ? '<div class="queue-shortlist">' +
              shortlist
                .map(function (item, shortlistIndex) {
                  return (
                    '<div class="queue-shortlist-item"><strong>' +
                    escapeHtml(item.name || "Unknown therapist") +
                    "</strong>" +
                    (item.priority ? " · " + escapeHtml(item.priority) : "") +
                    (item.note
                      ? '<div class="subtle" style="margin-top:0.25rem">Note: ' +
                        escapeHtml(item.note) +
                        "</div>"
                      : "") +
                    '<div class="subtle" style="margin-top:0.25rem">Best route: ' +
                    escapeHtml(item.outreach || "Not listed") +
                    '</div><div class="queue-item-controls"><label class="queue-select-label" for="shortlist-status-' +
                    index +
                    "-" +
                    shortlistIndex +
                    '">Therapist follow-up</label><select class="queue-select" id="shortlist-status-' +
                    index +
                    "-" +
                    shortlistIndex +
                    '" data-shortlist-status="' +
                    index +
                    ":" +
                    shortlistIndex +
                    '">' +
                    THERAPIST_FOLLOW_UP_OPTIONS.map(function (option) {
                      return (
                        '<option value="' +
                        escapeHtml(option) +
                        '"' +
                        (item.follow_up_status === option ? " selected" : "") +
                        ">" +
                        escapeHtml(formatStatusLabel(option)) +
                        "</option>"
                      );
                    }).join("") +
                    "</select></div></div>"
                  );
                })
                .join("") +
              "</div>"
            : "") +
          '<div class="queue-actions"><button class="btn-secondary" data-concierge-copy="' +
          index +
          '">Copy brief</button>' +
          (request.share_link
            ? '<a class="btn-secondary btn-inline" href="' +
              escapeHtml(request.share_link) +
              '" target="_blank" rel="noopener">Open match context</a>'
            : "") +
          "</div></article>"
        );
      })
      .join("");

  root.querySelectorAll("[data-concierge-copy]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const request = requests[Number(button.getAttribute("data-concierge-copy"))];
      if (!request) {
        return;
      }

      const brief = [
        "BipolarTherapyHub concierge request",
        "",
        request.requester_name ? "Name: " + request.requester_name : "",
        request.follow_up_preference ? "Preferred follow-up: " + request.follow_up_preference : "",
        request.help_topic ? "Help topic: " + request.help_topic : "",
        "Request summary: " + (request.request_summary || "No request summary captured."),
        "",
        "Shortlist:",
        (request.shortlist || [])
          .map(function (item, itemIndex) {
            return (
              itemIndex +
              1 +
              ". " +
              (item.name || "Unknown therapist") +
              (item.priority ? " — " + item.priority : "") +
              (item.note ? " — Note: " + item.note : "") +
              (item.outreach ? " — Best route: " + item.outreach : "")
            );
          })
          .join("\n"),
        "",
        request.request_note ? "What feels uncertain:\n" + request.request_note : "",
        request.share_link ? "Share link:\n" + request.share_link : "",
      ]
        .filter(Boolean)
        .join("\n");

      try {
        await navigator.clipboard.writeText(brief);
        button.textContent = "Copied";
      } catch (_error) {
        button.textContent = "Copy failed";
      }
    });
  });

  root.querySelectorAll("[data-request-status]").forEach(function (select) {
    select.addEventListener("change", function () {
      updateConciergeRequestStatus(
        Number(select.getAttribute("data-request-status")),
        select.value,
      );
      renderAll();
    });
  });

  root.querySelectorAll("[data-shortlist-status]").forEach(function (select) {
    select.addEventListener("change", function () {
      var parts = String(select.getAttribute("data-shortlist-status") || "").split(":");
      updateConciergeShortlistStatus(Number(parts[0]), Number(parts[1]), select.value);
      renderAll();
    });
  });
}

function renderAll() {
  renderStats();
  renderFunnelInsights();
  renderListings();
  renderConciergeQueue();
  renderApplications();
}

function setAuthUiState() {
  const gate = document.getElementById("adminAuthGate");
  const app = document.getElementById("adminApp");
  const resetButton = document.getElementById("resetDemo");
  const signOutButton = document.getElementById("signOutAdmin");
  const authError = document.getElementById("authError");

  if (authRequired) {
    gate.style.display = "block";
    app.style.display = "none";
    resetButton.style.display = "none";
    signOutButton.style.display = "none";
    if (authError) {
      authError.style.display = "block";
    }
    return;
  }

  gate.style.display = "none";
  app.style.display = "block";
  resetButton.style.display = dataMode === "local" ? "inline-flex" : "none";
  signOutButton.style.display = dataMode === "sanity" ? "inline-flex" : "none";
  if (authError) {
    authError.style.display = "none";
  }
}

async function loadData() {
  let reviewApiAvailable = false;

  try {
    await checkReviewApiHealth();
    reviewApiAvailable = true;
  } catch (_error) {
    reviewApiAvailable = false;
  }

  if (reviewApiAvailable && !getAdminSessionToken()) {
    dataMode = "sanity";
    remoteApplications = [];
    publishedTherapists = [];
    authRequired = true;
    setAuthUiState();
    renderAll();
    return;
  }

  try {
    const [applications, therapists] = await Promise.all([
      fetchTherapistApplications(),
      fetchPublicTherapists(),
    ]);
    remoteApplications = applications;
    publishedTherapists = therapists;
    dataMode = "sanity";
    authRequired = false;
  } catch (_error) {
    if (reviewApiAvailable || getAdminSessionToken()) {
      dataMode = "sanity";
      remoteApplications = [];
      publishedTherapists = [];
      authRequired = true;
    } else {
      dataMode = "local";
      remoteApplications = [];
      publishedTherapists = [];
      authRequired = false;
    }
  }

  setAuthUiState();
  renderAll();
}

document.getElementById("resetDemo").addEventListener("click", function () {
  resetDemoData();
  renderAll();
});

document.getElementById("adminAuthForm").addEventListener("submit", async function (event) {
  event.preventDefault();
  const field = document.getElementById("adminKey");
  const usernameField = document.getElementById("adminUsername");
  const error = document.getElementById("authError");
  const value = field.value.trim();
  const username = usernameField.value.trim();

  if (!value) {
    error.textContent = "Enter your admin password.";
    error.style.display = "block";
    return;
  }

  try {
    const result = await signInAdmin({
      username: username,
      password: value,
    });
    setAdminSessionToken(result.sessionToken);
    authRequired = false;
    error.style.display = "none";
    await loadData();

    if (authRequired) {
      error.textContent = "Those admin credentials were not accepted.";
      error.style.display = "block";
    } else {
      field.value = "";
    }
  } catch (_error) {
    authRequired = true;
    error.textContent = "Those admin credentials were not accepted.";
    error.style.display = "block";
  }
});

document.getElementById("signOutAdmin").addEventListener("click", async function () {
  await signOutAdmin();
  authRequired = false;
  dataMode = "local";
  remoteApplications = [];
  publishedTherapists = [];
  setAuthUiState();
  renderAll();
});

document.getElementById("applicationSearch").addEventListener("input", function (event) {
  applicationFilters.q = event.target.value.trim();
  renderApplications();
});

document.getElementById("applicationStatusFilter").addEventListener("change", function (event) {
  applicationFilters.status = event.target.value;
  renderApplications();
});

if (getAdminSessionToken()) {
  authRequired = false;
}

loadData();
