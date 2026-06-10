import {
  summarizeAdaptiveSignals,
  summarizeContactRouteOutcomePerformance,
  summarizeDirectoryProfileOpenQuality,
  summarizeExperimentDecisions,
  summarizeExperimentPerformance,
  summarizeFunnelEvents,
  summarizePatientJourney,
  summarizeProfileContactExperimentDecision,
  summarizeProfileContactOutcomeValidation,
  summarizeProfileContactSignals,
  summarizeProfileQueueProgress,
  setPromotedExperimentVariant,
} from "./funnel-analytics.js";
import { escapeHtml } from "./escape-html.js";

function formatAdaptiveLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, function (char) {
      return char.toUpperCase();
    });
}

function buildStrategyHealthSummary(summary) {
  const strong = summary.booked_consult + summary.good_fit_call + summary.heard_back;
  const friction = summary.no_response + summary.waitlist + summary.insurance_mismatch;

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
  const buckets = {
    outreach: { matches: 0, saves: 0, help: 0, outreach_starts: 0, strong: 0, friction: 0 },
    save: { matches: 0, saves: 0, help: 0, outreach_starts: 0, strong: 0, friction: 0 },
    help: { matches: 0, saves: 0, help: 0, outreach_starts: 0, strong: 0, friction: 0 },
  };

  (Array.isArray(events) ? events : []).forEach(function (item) {
    const strategy =
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
    const strategy =
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
  const segments = [
    { label: "Urgent users", keys: ["urgency:asap", "urgency:within-2-weeks"] },
    { label: "Insurance-led users", keys: ["insurance:user"] },
    { label: "Psychiatry / medication users", keys: ["intent:psychiatry", "medication:yes"] },
  ];

  return segments
    .map(function (segment) {
      const adaptive = summarizeAdaptiveSignals(events, outcomes, segment.keys);
      const signalCount =
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

export function renderFunnelInsightsPanel(options) {
  const root = document.getElementById("funnelInsights");
  if (!root) {
    return;
  }

  if (options.authRequired) {
    root.innerHTML = "";
    return;
  }

  const events = options.funnelEvents;
  const summary = summarizeFunnelEvents(events);
  const patientJourney = summarizePatientJourney(events);
  const profileContactSignals = summarizeProfileContactSignals(events);
  const profileQueueProgress = summarizeProfileQueueProgress(events);
  const directoryProfileOpenQuality = summarizeDirectoryProfileOpenQuality(events);
  const outcomes = options.outreachOutcomes;
  const profileContactOutcomeValidation = summarizeProfileContactOutcomeValidation(
    events,
    outcomes,
  );
  const routeOutcomePerformance = summarizeContactRouteOutcomePerformance(outcomes);
  const profileContactExperimentDecision = summarizeProfileContactExperimentDecision(
    events,
    outcomes,
  );
  const experimentPerformance = summarizeExperimentPerformance(events);
  const experimentDecisions = summarizeExperimentDecisions(events);
  const adaptive = summarizeAdaptiveSignals(events, outcomes);
  const strategyHealth = buildStrategyHealthSummary(options.analyzeOutreachOutcomes(outcomes));
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
      { label: "Contact intents", count: summary.contact_intents || 0 },
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
    '<div class="queue-insights"><div class="queue-insights-title">Patient journey checkpoints</div><div class="queue-insights-grid">' +
    patientJourney.stages
      .map(function (item) {
        return (
          '<div class="queue-insight-card"><div class="queue-insight-value">' +
          escapeHtml(item.count) +
          '</div><div class="queue-insight-label">' +
          escapeHtml(item.label) +
          '</div><div class="queue-insight-note">' +
          escapeHtml(item.note) +
          "</div></div>"
        );
      })
      .join("") +
    '</div><div class="mini-status" style="margin-top:0.75rem"><strong>' +
    escapeHtml(
      patientJourney.biggest_dropoff ? "Biggest patient drop-off" : "Patient journey note",
    ) +
    ":</strong> " +
    escapeHtml(
      patientJourney.biggest_dropoff
        ? patientJourney.biggest_dropoff.from_label +
            " -> " +
            patientJourney.biggest_dropoff.to_label +
            " is currently the steepest falloff."
        : "We need more patient journey data before a clear drop-off is visible.",
    ) +
    "</div></div>" +
    (directoryProfileOpenQuality.rows.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Directory-to-profile quality</div><div class="queue-insights-grid">' +
        directoryProfileOpenQuality.rows
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              escapeHtml(item.source) +
              '</div><div class="queue-insight-label">' +
              escapeHtml(
                item.opens +
                  " opens · " +
                  item.high_readiness +
                  " high-readiness · " +
                  item.fresh_profiles +
                  " fresh",
              ) +
              '</div><div class="queue-insight-note">' +
              escapeHtml(
                "High-readiness " +
                  Math.round(item.high_readiness_rate * 100) +
                  "% · Accepting " +
                  Math.round(item.accepting_rate * 100) +
                  "% · Bipolar detail " +
                  Math.round(item.bipolar_rate * 100) +
                  "%",
              ) +
              "</div></div>"
            );
          })
          .join("") +
        '</div><div class="mini-status" style="margin-top:0.75rem"><strong>Interpretation:</strong> ' +
        escapeHtml(directoryProfileOpenQuality.interpretation) +
        "</div></div>"
      : "") +
    '<div class="queue-insights"><div class="queue-insights-title">Recovery and friction signals</div><div class="queue-insights-grid">' +
    [
      {
        label: "Recovery clicks",
        count: patientJourney.recovery_moves,
      },
      {
        label: "Refinement opens",
        count: patientJourney.refinement_opens,
      },
      {
        label: "Direct outreach actions",
        count: patientJourney.direct_outreach_actions,
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
    "</div></div>" +
    (profileContactSignals.total_route_clicks ||
    profileContactSignals.section_views ||
    profileContactSignals.script_engagements ||
    profileContactSignals.question_engagements
      ? '<div class="queue-insights"><div class="queue-insights-title">Profile contact conversion signals</div><div class="queue-insights-grid">' +
        [
          {
            label: "Contact section views",
            count: profileContactSignals.section_views,
          },
          {
            label: "Route clicks",
            count: profileContactSignals.total_route_clicks,
          },
          {
            label: "Script engagements",
            count: profileContactSignals.script_engagements,
          },
          {
            label: "Question-list engagements",
            count: profileContactSignals.question_engagements,
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
        "</div>" +
        '<div class="mini-status" style="margin-top:0.75rem"><strong>Interpretation:</strong> ' +
        escapeHtml(profileContactSignals.interpretation) +
        "</div>" +
        (profileContactSignals.top_route
          ? '<div class="mini-status" style="margin-top:0.45rem"><strong>Current leading route:</strong> ' +
            escapeHtml(
              profileContactSignals.top_route.route +
                " with " +
                profileContactSignals.top_route.count +
                " click" +
                (profileContactSignals.top_route.count === 1 ? "" : "s"),
            ) +
            "</div>"
          : "") +
        (profileContactSignals.route_rows.length
          ? '<div class="mini-status" style="margin-top:0.75rem"><strong>Most-used contact routes:</strong> ' +
            escapeHtml(
              profileContactSignals.route_rows
                .slice(0, 4)
                .map(function (item) {
                  return item.route + " " + item.count;
                })
                .join(" · "),
            ) +
            "</div>"
          : "") +
        (profileContactSignals.weak_guidance_profiles.length
          ? '<div class="mini-status" style="margin-top:0.45rem"><strong>Watchlist:</strong> ' +
            escapeHtml(
              profileContactSignals.weak_guidance_profiles
                .slice(0, 3)
                .map(function (item) {
                  return item.slug + " (" + item.clicks + " clicks)";
                })
                .join(" · "),
            ) +
            "</div>"
          : "") +
        (profileContactSignals.top_profiles.length
          ? '<div class="queue-insights-grid" style="margin-top:0.75rem">' +
            profileContactSignals.top_profiles
              .map(function (item) {
                return (
                  '<div class="queue-insight-card"><div class="queue-insight-value">' +
                  escapeHtml(item.slug) +
                  '</div><div class="queue-insight-label">' +
                  escapeHtml(
                    item.clicks +
                      " route click" +
                      (item.clicks === 1 ? "" : "s") +
                      " · " +
                      item.primary +
                      " primary · " +
                      item.secondary +
                      " secondary",
                  ) +
                  "</div></div>"
                );
              })
              .join("") +
            "</div>"
          : "") +
        (profileContactSignals.variant_rows.length
          ? '<div class="queue-insights-grid" style="margin-top:0.75rem">' +
            profileContactSignals.variant_rows
              .map(function (item) {
                return (
                  '<div class="queue-insight-card"><div class="queue-insight-value">' +
                  escapeHtml(item.variant) +
                  '</div><div class="queue-insight-label">' +
                  escapeHtml(
                    item.exposures +
                      " exposures · " +
                      item.route_clicks +
                      " route clicks · " +
                      item.guidance_engagements +
                      " guidance engagements",
                  ) +
                  '</div><div class="queue-insight-note">' +
                  escapeHtml(
                    "Route click rate " +
                      Math.round(item.route_click_rate * 100) +
                      "% · Guidance rate " +
                      Math.round(item.guidance_rate * 100) +
                      "% of clicks",
                  ) +
                  "</div></div>"
                );
              })
              .join("") +
            "</div>"
          : "") +
        (profileQueueProgress.updates
          ? '<div class="queue-insights-grid" style="margin-top:0.75rem">' +
            [
              {
                label: "Profile updates saved",
                count: profileQueueProgress.updates,
              },
              {
                label: "Therapists updated",
                count: profileQueueProgress.therapist_count,
              },
              {
                label: "Reached out",
                count: profileQueueProgress.reached_out,
              },
              {
                label: "Reply progress",
                count: profileQueueProgress.heard_back + profileQueueProgress.good_fit_call,
              },
              {
                label: "Friction saved",
                count:
                  profileQueueProgress.no_response +
                  profileQueueProgress.waitlist +
                  profileQueueProgress.insurance_mismatch,
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
            '</div><div class="mini-status" style="margin-top:0.45rem"><strong>Profile queue readout:</strong> ' +
            escapeHtml(profileQueueProgress.interpretation) +
            "</div>"
          : "") +
        (profileContactOutcomeValidation.length
          ? '<div class="queue-insights-grid" style="margin-top:0.75rem">' +
            profileContactOutcomeValidation
              .map(function (item) {
                return (
                  '<div class="queue-insight-card"><div class="queue-insight-value">' +
                  escapeHtml(item.variant) +
                  '</div><div class="queue-insight-label">' +
                  escapeHtml(
                    item.therapist_count +
                      " therapists touched · " +
                      item.strong_outcomes +
                      " strong outcomes · " +
                      item.friction_outcomes +
                      " friction outcomes",
                  ) +
                  '</div><div class="queue-insight-note">' +
                  escapeHtml("Downstream validation score " + item.downstream_score) +
                  "</div></div>"
                );
              })
              .join("") +
            "</div>"
          : "") +
        (routeOutcomePerformance.rows.length
          ? '<div class="queue-insights-grid" style="margin-top:0.75rem">' +
            routeOutcomePerformance.rows
              .slice(0, 4)
              .map(function (item) {
                return (
                  '<div class="queue-insight-card"><div class="queue-insight-value">' +
                  escapeHtml(item.route) +
                  '</div><div class="queue-insight-label">' +
                  escapeHtml(
                    item.total +
                      " route-linked outcomes · " +
                      item.strong +
                      " strong · " +
                      item.friction +
                      " friction",
                  ) +
                  '</div><div class="queue-insight-note">' +
                  escapeHtml(
                    "Strong rate " + Math.round(item.strong_rate * 100) + "% · Net " + item.net,
                  ) +
                  "</div></div>"
                );
              })
              .join("") +
            '</div><div class="mini-status" style="margin-top:0.45rem"><strong>Route outcome readout:</strong> ' +
            escapeHtml(routeOutcomePerformance.interpretation) +
            "</div>"
          : "") +
        (profileContactExperimentDecision && profileContactExperimentDecision.winner
          ? '<div class="queue-insight-card" style="margin-top:0.75rem"><div class="queue-insight-value">' +
            escapeHtml(profileContactExperimentDecision.experiment_name) +
            '</div><div class="queue-insight-label">' +
            escapeHtml(
              profileContactExperimentDecision.winner.variant +
                " · " +
                profileContactExperimentDecision.recommendation,
            ) +
            '</div><div class="queue-insight-note">' +
            escapeHtml(
              profileContactExperimentDecision.note +
                " Confidence gap: " +
                Math.round(profileContactExperimentDecision.confidence_gap * 100) / 100,
            ) +
            '</div><div class="queue-insight-action">' +
            (profileContactExperimentDecision.recommendation === "Promising winner"
              ? '<button type="button" class="btn-secondary btn-inline" data-promote-experiment="' +
                escapeHtml(profileContactExperimentDecision.experiment_name) +
                '" data-promote-variant="' +
                escapeHtml(profileContactExperimentDecision.winner.variant) +
                '">Promote ' +
                escapeHtml(profileContactExperimentDecision.winner.variant) +
                "</button>"
              : "") +
            (profileContactExperimentDecision.promoted_variant
              ? ' <button type="button" class="btn-secondary btn-inline" data-clear-experiment-promotion="' +
                escapeHtml(profileContactExperimentDecision.experiment_name) +
                '">Clear promoted default</button><div class="queue-insight-note">Promoted now: ' +
                escapeHtml(profileContactExperimentDecision.promoted_variant) +
                "</div>"
              : "") +
            "</div></div>"
          : "") +
        "</div>"
      : "") +
    (experimentPerformance.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Experiment variants in the wild</div><div class="queue-insights-grid">' +
        experimentPerformance
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              escapeHtml(item.experiment_name + " · " + item.variant) +
              '</div><div class="queue-insight-label">' +
              escapeHtml(
                item.exposures +
                  " exposures · " +
                  item.matches +
                  " matches · " +
                  item.shortlist_actions +
                  " shortlist actions · " +
                  item.outreach_starts +
                  " outreach starts",
              ) +
              '</div><div class="queue-insight-note">' +
              escapeHtml(
                "Match rate " +
                  Math.round(item.match_rate * 100) +
                  "% · Outreach rate " +
                  Math.round(item.outreach_rate * 100) +
                  "% from matches",
              ) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    (experimentDecisions.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Experiment recommendations</div><div class="queue-insights-grid">' +
        experimentDecisions
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              escapeHtml(item.experiment_name) +
              '</div><div class="queue-insight-label">' +
              escapeHtml(
                item.winner
                  ? item.winner.variant + " · " + item.recommendation
                  : "No clear recommendation yet",
              ) +
              '</div><div class="queue-insight-note">' +
              escapeHtml(
                item.winner
                  ? "Current leader: " +
                      item.winner.variant +
                      ". Composite gap: " +
                      Math.round(item.confidence_gap * 100) / 100
                  : "We need more traffic before recommending a variant.",
              ) +
              '</div><div class="queue-insight-action">' +
              (item.winner
                ? '<button type="button" class="btn-secondary btn-inline" data-promote-experiment="' +
                  escapeHtml(item.experiment_name) +
                  '" data-promote-variant="' +
                  escapeHtml(item.winner.variant) +
                  '">Promote ' +
                  escapeHtml(item.winner.variant) +
                  "</button>"
                : "") +
              (item.promoted_variant
                ? ' <button type="button" class="btn-secondary btn-inline" data-clear-experiment-promotion="' +
                  escapeHtml(item.experiment_name) +
                  '">Clear promoted default</button><div class="queue-insight-note">Promoted now: ' +
                  escapeHtml(item.promoted_variant) +
                  "</div>"
                : "") +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
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

  root.querySelectorAll("[data-promote-experiment]").forEach(function (button) {
    button.addEventListener("click", function () {
      const experimentName = button.getAttribute("data-promote-experiment") || "";
      const variant = button.getAttribute("data-promote-variant") || "";
      if (!experimentName || !variant) {
        return;
      }
      setPromotedExperimentVariant(experimentName, variant);
      options.rerenderSelf();
    });
  });

  root.querySelectorAll("[data-clear-experiment-promotion]").forEach(function (button) {
    button.addEventListener("click", function () {
      const experimentName = button.getAttribute("data-clear-experiment-promotion") || "";
      if (!experimentName) {
        return;
      }
      setPromotedExperimentVariant(experimentName, "");
      options.rerenderSelf();
    });
  });
}
