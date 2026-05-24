import { escapeHtml } from "./escape-html.js";
import {
  FEEDBACK_REASON_OPTIONS,
  analyzeOutreachJourneys,
  analyzePivotTiming,
  buildLearningSegments,
  buildLearningSignals,
  buildShortcutLearningMap,
} from "./match-ranking.js";

function buildRouteLearningMap(outcomes) {
  var entries = Array.isArray(outcomes) ? outcomes : [];
  var learning = {};

  function ensureBucket(segment, routeType) {
    var key = "route::" + segment;
    if (!learning[key]) {
      learning[key] = {};
    }
    if (!learning[key][routeType]) {
      learning[key][routeType] = {
        success: 0,
        attempts: 0,
      };
    }
    return learning[key][routeType];
  }

  entries.forEach(function (item) {
    if (!item || !item.route_type) {
      return;
    }

    var segments = buildLearningSegments(
      item.context && item.context.profile ? item.context.profile : null,
    );

    segments.forEach(function (segment) {
      var bucket = ensureBucket(segment, item.route_type);
      bucket.attempts += 1;
      if (item.outcome === "booked_consult" || item.outcome === "good_fit_call") {
        bucket.success += 1;
      }
    });
  });

  return learning;
}

export function buildFeedbackInsightsMarkup(feedback, outreachOutcomes, services) {
  var therapists = (services && services.therapists) || [];
  var learningSignals = buildLearningSignals(feedback, outreachOutcomes);

  if (!feedback.length && !outreachOutcomes.length) {
    return '<div class="feedback-insights-header"><h3>Your feedback so far</h3><p>A quick summary of what you have flagged on this device.</p></div><div class="insight-empty">No feedback captured yet.</div>';
  }

  var shortlistFeedback = feedback.filter(function (item) {
    return item.type === "shortlist_feedback";
  });
  var therapistFeedback = feedback.filter(function (item) {
    return item.type === "therapist_feedback";
  });
  var shortcutInteractions = feedback.filter(function (item) {
    return item.type === "shortcut_interaction";
  });
  var heardBackOutcomes = outreachOutcomes.filter(function (item) {
    return item.outcome === "heard_back";
  });
  var bookedConsultOutcomes = outreachOutcomes.filter(function (item) {
    return item.outcome === "booked_consult";
  });
  var goodFitCallOutcomes = outreachOutcomes.filter(function (item) {
    return item.outcome === "good_fit_call";
  });
  var insuranceMismatchOutcomes = outreachOutcomes.filter(function (item) {
    return item.outcome === "insurance_mismatch";
  });
  var waitlistOutcomes = outreachOutcomes.filter(function (item) {
    return item.outcome === "waitlist";
  });
  var noResponseOutcomes = outreachOutcomes.filter(function (item) {
    return item.outcome === "no_response";
  });
  var journeySummary = analyzeOutreachJourneys(outreachOutcomes);
  var timingSummary = analyzePivotTiming(outreachOutcomes);
  var negativeReasons = feedback
    .filter(function (item) {
      return item.value === "negative";
    })
    .flatMap(function (item) {
      return Array.isArray(item.reasons) ? item.reasons : [];
    });
  var reasonCounts = FEEDBACK_REASON_OPTIONS.map(function (reason) {
    return {
      reason: reason,
      count: negativeReasons.filter(function (value) {
        return value === reason;
      }).length,
    };
  }).filter(function (item) {
    return item.count > 0;
  });

  var therapistSummaryMap = therapistFeedback.reduce(function (accumulator, item) {
    var key = item.therapist_slug;
    if (!accumulator[key]) {
      accumulator[key] = {
        slug: key,
        positive: 0,
        negative: 0,
      };
    }
    if (item.value === "positive") {
      accumulator[key].positive += 1;
    }
    if (item.value === "negative") {
      accumulator[key].negative += 1;
    }
    return accumulator;
  }, {});

  var therapistSummaries = Object.values(therapistSummaryMap)
    .map(function (item) {
      var therapist = therapists.find(function (entry) {
        return entry.slug === item.slug;
      });
      return {
        name: therapist ? therapist.name : item.slug,
        positive: item.positive,
        negative: item.negative,
        net: item.positive - item.negative,
      };
    })
    .sort(function (a, b) {
      return b.net - a.net || b.positive - a.positive || a.name.localeCompare(b.name);
    });

  var helpfulShortlists = shortlistFeedback.filter(function (item) {
    return item.value === "positive";
  }).length;
  var helpfulRate = shortlistFeedback.length
    ? Math.round((helpfulShortlists / shortlistFeedback.length) * 100)
    : 0;
  var shortcutSummaries = Object.values(
    shortcutInteractions.reduce(function (accumulator, item) {
      var key = String(item.shortcut_type || "unknown");
      if (!accumulator[key]) {
        accumulator[key] = {
          type: key,
          draft: 0,
          compare: 0,
        };
      }
      if (item.action === "copy_draft") {
        accumulator[key].draft += 1;
      }
      if (item.action === "focus_compare") {
        accumulator[key].compare += 1;
      }
      return accumulator;
    }, {}),
  ).sort(function (a, b) {
    return b.draft + b.compare - (a.draft + a.compare) || a.type.localeCompare(b.type);
  });
  var shortcutLearningMap = buildShortcutLearningMap(feedback, outreachOutcomes);
  var shortcutOutcomeSummaries = Object.values(
    outreachOutcomes.reduce(function (accumulator, item) {
      var key = String(item && item.shortcut_type ? item.shortcut_type : "");
      if (!key) {
        return accumulator;
      }
      if (!accumulator[key]) {
        accumulator[key] = {
          type: key,
          strong: 0,
          weak: 0,
        };
      }
      if (item.outcome === "booked_consult" || item.outcome === "good_fit_call") {
        accumulator[key].strong += 1;
      }
      if (
        item.outcome === "insurance_mismatch" ||
        item.outcome === "waitlist" ||
        item.outcome === "no_response"
      ) {
        accumulator[key].weak += 1;
      }
      return accumulator;
    }, {}),
  ).sort(function (a, b) {
    return b.strong - a.strong || a.weak - b.weak || a.type.localeCompare(b.type);
  });
  var segmentShortcutSummaries = Object.keys(shortcutLearningMap)
    .filter(function (key) {
      return key !== "shortcut::all";
    })
    .map(function (key) {
      var segment = key.replace("shortcut::", "");
      var bestShortcut = Object.entries(shortcutLearningMap[key]).sort(function (a, b) {
        var scoreA =
          a[1].draft * 3 + a[1].compare * 2 + (a[1].strong || 0) * 8 - (a[1].weak || 0) * 5;
        var scoreB =
          b[1].draft * 3 + b[1].compare * 2 + (b[1].strong || 0) * 8 - (b[1].weak || 0) * 5;
        return scoreB - scoreA || a[0].localeCompare(b[0]);
      })[0];
      if (!bestShortcut) {
        return null;
      }
      return {
        segment: segment,
        shortcut: bestShortcut[0],
        count: bestShortcut[1].draft + bestShortcut[1].compare,
        strong: bestShortcut[1].strong || 0,
        weak: bestShortcut[1].weak || 0,
      };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return (
        b.strong - a.strong ||
        a.weak - b.weak ||
        b.count - a.count ||
        a.segment.localeCompare(b.segment)
      );
    });
  var segmentSummaries = Object.keys(learningSignals.segments || {})
    .filter(function (segment) {
      return segment !== "all";
    })
    .map(function (segment) {
      var segmentData = learningSignals.segments[segment] || {};
      return {
        label: segment.split(":")[1].replace(/-/g, " "),
        strength:
          Object.keys(segmentData.reason_weights || {}).length +
          Object.keys(segmentData.therapist_adjustments || {}).length +
          Object.keys(segmentData.outreach_adjustments || {}).length,
      };
    })
    .filter(function (item) {
      return item.strength > 0;
    })
    .sort(function (a, b) {
      return b.strength - a.strength || a.label.localeCompare(b.label);
    });
  var outreachSegmentSummaries = Object.keys(learningSignals.segments || {})
    .filter(function (segment) {
      if (segment === "all") {
        return false;
      }
      var segmentData = learningSignals.segments[segment] || {};
      return Object.keys(segmentData.outreach_adjustments || {}).length > 0;
    })
    .map(function (segment) {
      var segmentData = learningSignals.segments[segment] || {};
      return {
        label: segment.split(":")[1].replace(/-/g, " "),
        count: Object.keys(segmentData.outreach_adjustments || {}).length,
      };
    })
    .sort(function (a, b) {
      return b.count - a.count || a.label.localeCompare(b.label);
    });
  var routeLearningMap = buildRouteLearningMap(outreachOutcomes);
  var routeSummaries = Object.keys(routeLearningMap)
    .slice(0, 4)
    .map(function (key) {
      var segment = key.replace("route::", "");
      var bestRoute = Object.entries(routeLearningMap[key]).sort(function (a, b) {
        return (
          b[1].success - a[1].success || b[1].attempts - a[1].attempts || a[0].localeCompare(b[0])
        );
      })[0];
      if (!bestRoute || !bestRoute[1].success) {
        return null;
      }
      return {
        segment: segment,
        route: bestRoute[0],
        success: bestRoute[1].success,
      };
    })
    .filter(Boolean);

  return (
    '<div class="feedback-insights-header"><h3>Your feedback so far</h3><p>A quick summary of what you have flagged on this device.</p></div>' +
    '<div class="insight-stats">' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    feedback.length +
    '</div><div class="insight-stat-label">Total signals</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    helpfulRate +
    '%</div><div class="insight-stat-label">Helpful list rate</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    therapistFeedback.length +
    '</div><div class="insight-stat-label">Therapist-level votes</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    heardBackOutcomes.length +
    '</div><div class="insight-stat-label">Heard-back outcomes</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    bookedConsultOutcomes.length +
    '</div><div class="insight-stat-label">Booked consults</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    goodFitCallOutcomes.length +
    '</div><div class="insight-stat-label">Good fit calls</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    insuranceMismatchOutcomes.length +
    '</div><div class="insight-stat-label">Insurance mismatches</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    waitlistOutcomes.length +
    '</div><div class="insight-stat-label">Waitlist hits</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    noResponseOutcomes.length +
    '</div><div class="insight-stat-label">No-response outcomes</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    shortcutInteractions.length +
    '</div><div class="insight-stat-label">Shortcut actions</div></div>' +
    "</div>" +
    (shortcutSummaries.length
      ? '<div class="insight-list">' +
        shortcutSummaries
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.type.replace(/_/g, " ")) +
              '</div><div class="insight-item-meta">Draft clicks: ' +
              item.draft +
              " · Compare focus: " +
              item.compare +
              '</div></div><div class="insight-balance">' +
              (item.draft + item.compare) +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (shortcutOutcomeSummaries.length
      ? '<div class="insight-list">' +
        shortcutOutcomeSummaries
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.type.replace(/_/g, " ")) +
              '</div><div class="insight-item-meta">Strong outcomes: ' +
              item.strong +
              " · Friction outcomes: " +
              item.weak +
              '</div></div><div class="insight-balance">' +
              (item.strong - item.weak > 0 ? "+" : "") +
              (item.strong - item.weak) +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (segmentShortcutSummaries.length
      ? '<div class="insight-list">' +
        segmentShortcutSummaries
          .slice(0, 4)
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.segment.split(":")[1].replace(/-/g, " ")) +
              '</div><div class="insight-item-meta">Most-used shortcut: ' +
              escapeHtml(item.shortcut.replace(/_/g, " ")) +
              " · Strong outcomes: " +
              item.strong +
              " · Friction: " +
              item.weak +
              '</div></div><div class="insight-balance">' +
              item.count +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (segmentSummaries.length
      ? '<div class="insight-list">' +
        segmentSummaries
          .slice(0, 4)
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.label) +
              '</div><div class="insight-item-meta">Segment-aware learning coverage</div></div><div class="insight-balance">' +
              item.strength +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (Object.keys(learningSignals.reason_weights || {}).length
      ? '<div class="insight-list">' +
        Object.entries(learningSignals.reason_weights)
          .sort(function (a, b) {
            return b[1] - a[1];
          })
          .slice(0, 4)
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item[0]) +
              '</div><div class="insight-item-meta">Current learning weight</div></div><div class="insight-balance">+' +
              item[1] +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (Object.keys(learningSignals.outreach_adjustments || {}).length
      ? '<div class="insight-list">' +
        Object.entries(learningSignals.outreach_adjustments)
          .sort(function (a, b) {
            return b[1] - a[1];
          })
          .slice(0, 4)
          .map(function (item) {
            var therapist = therapists.find(function (entry) {
              return entry.slug === item[0];
            });
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(therapist ? therapist.name : item[0]) +
              '</div><div class="insight-item-meta">Reply-driven trust adjustment</div></div><div class="insight-balance">' +
              (item[1] > 0 ? "+" : "") +
              item[1] +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (outreachSegmentSummaries.length
      ? '<div class="insight-list">' +
        outreachSegmentSummaries
          .slice(0, 4)
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.label) +
              '</div><div class="insight-item-meta">Segment-specific outreach learning</div></div><div class="insight-balance">' +
              item.count +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (routeSummaries.length
      ? '<div class="insight-list">' +
        routeSummaries
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.segment.split(":")[1].replace(/-/g, " ")) +
              '</div><div class="insight-item-meta">Best-performing route type: ' +
              escapeHtml(item.route) +
              '</div></div><div class="insight-balance">' +
              item.success +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (journeySummary.fallback_after_no_response ||
    journeySummary.fallback_after_waitlist ||
    journeySummary.fallback_after_insurance_mismatch ||
    journeySummary.second_choice_success
      ? '<div class="insight-list">' +
        [
          {
            name: "Fallback after no response",
            meta: "Journeys where the first outreach stalled and a later option was tried",
            value: journeySummary.fallback_after_no_response,
          },
          {
            name: "Fallback after waitlist",
            meta: "Journeys where the first outreach hit a waitlist and a later option was tried",
            value: journeySummary.fallback_after_waitlist,
          },
          {
            name: "Fallback after insurance mismatch",
            meta: "Journeys where cost or coverage pushed the user to a backup option",
            value: journeySummary.fallback_after_insurance_mismatch,
          },
          {
            name: "Second-choice success",
            meta: "Journeys where a backup option produced a strong outcome",
            value: journeySummary.second_choice_success,
          },
        ]
          .filter(function (item) {
            return item.value > 0;
          })
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.name) +
              '</div><div class="insight-item-meta">' +
              escapeHtml(item.meta) +
              '</div></div><div class="insight-balance">' +
              item.value +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (timingSummary.on_time_pivots || timingSummary.early_pivots || timingSummary.late_pivots
      ? '<div class="insight-list">' +
        [
          {
            name: "On-time pivots",
            meta: "Fallbacks that happened close to the suggested pivot window",
            value: timingSummary.on_time_pivots,
          },
          {
            name: "Early pivots",
            meta: "Fallbacks that happened before the suggested pivot time",
            value: timingSummary.early_pivots,
          },
          {
            name: "Late pivots",
            meta: "Fallbacks that happened after the suggested pivot time",
            value: timingSummary.late_pivots,
          },
        ]
          .filter(function (item) {
            return item.value > 0;
          })
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.name) +
              '</div><div class="insight-item-meta">' +
              escapeHtml(item.meta) +
              '</div></div><div class="insight-balance">' +
              item.value +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (reasonCounts.length
      ? '<div class="insight-list">' +
        reasonCounts
          .slice(0, 4)
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.reason) +
              '</div><div class="insight-item-meta">Negative feedback mentions</div></div><div class="insight-balance">' +
              item.count +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (therapistSummaries.length
      ? '<div class="insight-list">' +
        therapistSummaries
          .slice(0, 5)
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.name) +
              '</div><div class="insight-item-meta">Positive: ' +
              item.positive +
              " • Negative: " +
              item.negative +
              '</div></div><div class="insight-balance">Net ' +
              (item.net > 0 ? "+" : "") +
              item.net +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : '<div class="insight-empty">No therapist-level feedback captured yet.</div>')
  );
}
