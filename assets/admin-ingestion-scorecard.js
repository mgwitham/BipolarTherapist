export function renderIngestionScorecardPanel(options) {
  var root = options.root;
  if (!root) {
    return;
  }

  if (options.authRequired) {
    root.innerHTML = "";
    return;
  }

  var therapists = Array.isArray(options.therapists) ? options.therapists : [];
  var candidates = Array.isArray(options.candidates) ? options.candidates : [];
  var applications = Array.isArray(options.applications) ? options.applications : [];
  var licensureRefreshQueue = Array.isArray(options.licensureRefreshQueue)
    ? options.licensureRefreshQueue
    : [];
  var licensureActivityFeed = Array.isArray(options.licensureActivityFeed)
    ? options.licensureActivityFeed
    : [];
  var coverageInsights = options.buildCoverageInsights(therapists);
  var ingestionAutomationHistory = Array.isArray(options.ingestionAutomationHistory)
    ? options.ingestionAutomationHistory
    : [];

  var publishableCandidates = candidates.filter(function (item) {
    return item.review_lane === "publish_now";
  }).length;
  var duplicateCandidates = candidates.filter(function (item) {
    return item.dedupe_status === "possible_duplicate";
  }).length;
  var confirmationCandidates = candidates.filter(function (item) {
    return item.review_lane === "needs_confirmation";
  }).length;
  var staleTherapists = therapists.filter(function (item) {
    var freshness = options.getDataFreshnessSummary(item);
    return freshness && freshness.tone !== "fresh";
  }).length;
  var trustRiskTherapists = therapists.filter(function (item) {
    return options.getTherapistFieldTrustSummary(item).watchFields.length > 0;
  }).length;
  var thinCities = (coverageInsights.thinnestCities || []).filter(function (city) {
    return Number(city.total || 0) < 3;
  }).length;
  var updateApplications = applications.filter(function (item) {
    return ["claim_existing", "update_existing", "confirmation_update"].includes(
      String(item.intake_type || ""),
    );
  }).length;
  var licensureVerifiedTherapists = therapists.filter(function (item) {
    var verification = item.licensure_verification || item.licensureVerification || null;
    return Boolean(
      verification &&
      (verification.profileUrl ||
        verification.profile_url ||
        verification.verifiedAt ||
        verification.verified_at),
    );
  }).length;
  var licensureCoverageRate = therapists.length
    ? Math.round((licensureVerifiedTherapists / therapists.length) * 100)
    : 0;
  var licensureRefreshCount = licensureRefreshQueue.length;
  var licensureActivityCount = licensureActivityFeed.length;
  var lowLicensureCoverage = licensureCoverageRate < 60;
  var latestAutomationRun = ingestionAutomationHistory.length
    ? ingestionAutomationHistory[ingestionAutomationHistory.length - 1]
    : null;
  var licensureDeferredCount =
    latestAutomationRun && latestAutomationRun.metrics
      ? Number(latestAutomationRun.metrics.licensureDeferredItems) || 0
      : 0;
  var priorAutomationRun =
    ingestionAutomationHistory.length > 1
      ? ingestionAutomationHistory[ingestionAutomationHistory.length - 2]
      : null;

  var duplicateRate = candidates.length
    ? Math.round((duplicateCandidates / candidates.length) * 100)
    : 0;
  var confirmationRate = candidates.length
    ? Math.round((confirmationCandidates / candidates.length) * 100)
    : 0;
  var freshnessRiskRate = therapists.length
    ? Math.round((staleTherapists / therapists.length) * 100)
    : 0;

  var scorecards = [
    {
      label: "Publishable now",
      value: publishableCandidates,
      note: "Candidates already sitting in the publish lane.",
    },
    {
      label: "Duplicate drag",
      value: duplicateRate + "%",
      note:
        duplicateCandidates +
        " candidate" +
        (duplicateCandidates === 1 ? "" : "s") +
        " need identity resolution.",
    },
    {
      label: "Confirmation burden",
      value: confirmationRate + "%",
      note:
        confirmationCandidates +
        " candidate" +
        (confirmationCandidates === 1 ? "" : "s") +
        " still need a trust pass.",
    },
    {
      label: "Live freshness risk",
      value: freshnessRiskRate + "%",
      note:
        staleTherapists +
        " listed therapist" +
        (staleTherapists === 1 ? "" : "s") +
        " are outside the fresh zone.",
    },
    {
      label: "Trust-watch listings",
      value: trustRiskTherapists,
      note: "Live profiles with field-level trust signals that need attention.",
    },
    {
      label: "Thin-city gaps",
      value: thinCities,
      note: "Cities with fewer than 3 live listings in the graph.",
    },
    {
      label: "Live update flow",
      value: updateApplications,
      note: "Applications that can sync directly into existing live therapists.",
    },
    {
      label: "Licensure coverage",
      value: licensureCoverageRate + "%",
      note:
        licensureVerifiedTherapists +
        " live therapist" +
        (licensureVerifiedTherapists === 1 ? "" : "s") +
        " have cached primary-source licensure data.",
    },
    {
      label: "Licensure refresh",
      value: licensureRefreshCount,
      note: "Licensure records currently queued for refresh or first-pass enrichment.",
    },
    {
      label: "Licensure deferred",
      value: licensureDeferredCount,
      note: "Licensure records intentionally snoozed until a future refresh date.",
    },
    {
      label: "Recent licensure activity",
      value: licensureActivityCount,
      note: "Recent primary-source refreshes, failures, and deferral actions captured in the feed.",
    },
  ];

  var nextMove =
    publishableCandidates > 0
      ? "Publish-ready candidates are the fastest quality gain right now."
      : duplicateCandidates > 0
        ? "Resolve duplicate drag next so sourcing throughput stays clean."
        : lowLicensureCoverage
          ? "Primary-source licensure coverage is still thin. Run a first-pass enrichment sprint before broader sourcing."
          : staleTherapists > 0
            ? "Freshness is the next bottleneck. Work the refresh lane."
            : licensureRefreshCount > 0
              ? "Licensure refresh is the next trust upgrade. Work the primary-source queue."
              : thinCities > 0
                ? "Coverage gaps are now the main opportunity. Run the next sourcing wave."
                : "The graph looks healthy. Focus on strategic sourcing and trust upgrades.";

  function getTrendValue(current, previous) {
    if (previous == null || current == null) {
      return "No history yet";
    }
    if (current === previous) {
      return "Flat";
    }
    var delta = current - previous;
    return (delta > 0 ? "+" : "") + delta;
  }

  function formatTrendSignal(trend) {
    if (!trend || trend.direction === "unknown" || trend.delta == null) {
      return "No history yet";
    }
    if (trend.direction === "flat") {
      return "Flat";
    }
    return (trend.direction === "up" ? "Up " : "Down ") + Math.abs(trend.delta);
  }

  var trendCards = latestAutomationRun
    ? [
        {
          label: "Ops queue trend",
          value: getTrendValue(
            latestAutomationRun.metrics && latestAutomationRun.metrics.opsQueueItems,
            priorAutomationRun &&
              priorAutomationRun.metrics &&
              priorAutomationRun.metrics.opsQueueItems,
          ),
          note:
            "Current: " +
            ((latestAutomationRun.metrics && latestAutomationRun.metrics.opsQueueItems) || 0) +
            " items",
        },
        {
          label: "Reverification trend",
          value: getTrendValue(
            latestAutomationRun.metrics && latestAutomationRun.metrics.reverificationItems,
            priorAutomationRun &&
              priorAutomationRun.metrics &&
              priorAutomationRun.metrics.reverificationItems,
          ),
          note:
            "Current: " +
            ((latestAutomationRun.metrics && latestAutomationRun.metrics.reverificationItems) ||
              0) +
            " items",
        },
        {
          label: "Licensure refresh trend",
          value: getTrendValue(
            latestAutomationRun.metrics && latestAutomationRun.metrics.licensureRefreshItems,
            priorAutomationRun &&
              priorAutomationRun.metrics &&
              priorAutomationRun.metrics.licensureRefreshItems,
          ),
          note:
            "Current: " +
            ((latestAutomationRun.metrics && latestAutomationRun.metrics.licensureRefreshItems) ||
              0) +
            " items",
        },
        {
          label: "Candidate review trend",
          value: getTrendValue(
            latestAutomationRun.metrics && latestAutomationRun.metrics.candidateReviewItems,
            priorAutomationRun &&
              priorAutomationRun.metrics &&
              priorAutomationRun.metrics.candidateReviewItems,
          ),
          note:
            "Current: " +
            ((latestAutomationRun.metrics && latestAutomationRun.metrics.candidateReviewItems) ||
              0) +
            " items",
        },
      ]
    : [];
  var automationAlerts =
    latestAutomationRun && Array.isArray(latestAutomationRun.alerts)
      ? latestAutomationRun.alerts
      : [];
  var automationAgeHours = latestAutomationRun
    ? Math.round(
        (Date.now() - new Date(latestAutomationRun.finishedAt).getTime()) / (1000 * 60 * 60),
      )
    : null;
  var staleAutomationRun = automationAgeHours != null && automationAgeHours > 36;
  var automationHealthAlerts = automationAlerts.slice();
  if (staleAutomationRun) {
    automationHealthAlerts.unshift({
      level: "warn",
      label: "Automation stale",
      message:
        "The daily ingestion automation has not completed in the last 36 hours. Refresh the automation run before trusting this scorecard.",
    });
  }
  var automationStatusLabel = latestAutomationRun
    ? staleAutomationRun
      ? "Stale run"
      : latestAutomationRun.status === "attention"
        ? "Needs attention"
        : latestAutomationRun.status === "ok"
          ? "Healthy"
          : "Failed"
    : "Not run yet";
  var automationTrends =
    latestAutomationRun && latestAutomationRun.trends ? latestAutomationRun.trends : null;
  var automationLicensureSprint =
    latestAutomationRun && latestAutomationRun.licensureSprint
      ? latestAutomationRun.licensureSprint
      : null;

  root.innerHTML =
    '<div class="queue-insights"><div class="queue-insights-title">System health</div><div class="subtle" style="margin-bottom:0.7rem">Use this to understand whether the bottleneck is publish throughput, duplicate cleanup, confirmation, freshness, licensure trust, or graph coverage.</div><div class="queue-insights-grid">' +
    scorecards
      .map(function (item) {
        return (
          '<div class="queue-insight-card"><div class="queue-insight-value">' +
          options.escapeHtml(item.value) +
          '</div><div class="queue-insight-label">' +
          options.escapeHtml(item.label) +
          '</div><div class="queue-insight-note">' +
          options.escapeHtml(item.note) +
          "</div></div>"
        );
      })
      .join("") +
    "</div></div>" +
    (latestAutomationRun
      ? '<div class="queue-insights"><div class="queue-insights-title">Automation health</div><div class="subtle" style="margin-bottom:0.7rem">Latest daily automation verdict and the highest-priority issues it surfaced.</div><div class="queue-summary-grid"><div class="queue-kpi"><div class="queue-kpi-label">Latest run</div><div class="queue-kpi-value">' +
        options.escapeHtml(automationStatusLabel) +
        '</div></div><div class="queue-kpi"><div class="queue-kpi-label">Completed</div><div class="queue-kpi-value">' +
        options.escapeHtml(options.formatDate(latestAutomationRun.finishedAt)) +
        '</div></div><div class="queue-kpi"><div class="queue-kpi-label">Run age</div><div class="queue-kpi-value">' +
        options.escapeHtml(automationAgeHours == null ? "Unknown" : automationAgeHours + "h") +
        '</div></div><div class="queue-kpi"><div class="queue-kpi-label">Alerts</div><div class="queue-kpi-value">' +
        options.escapeHtml(String(automationHealthAlerts.length)) +
        "</div></div></div>" +
        (automationTrends
          ? '<div class="queue-filters" style="margin-top:0.7rem">' +
            [
              {
                label: "Ops queue " + formatTrendSignal(automationTrends.opsQueueItems),
                level:
                  automationTrends.opsQueueItems &&
                  automationTrends.opsQueueItems.direction === "up"
                    ? "status rejected"
                    : "status approved",
              },
              {
                label: "Reverification " + formatTrendSignal(automationTrends.reverificationItems),
                level:
                  automationTrends.reverificationItems &&
                  automationTrends.reverificationItems.direction === "up"
                    ? "status rejected"
                    : "status approved",
              },
              {
                label:
                  "Licensure refresh " + formatTrendSignal(automationTrends.licensureRefreshItems),
                level:
                  automationTrends.licensureRefreshItems &&
                  automationTrends.licensureRefreshItems.direction === "up"
                    ? "status rejected"
                    : "status approved",
              },
              {
                label: "Licensure deferred " + licensureDeferredCount,
                level: licensureDeferredCount > 0 ? "status reviewing" : "status approved",
              },
              {
                label:
                  "Candidate review " + formatTrendSignal(automationTrends.candidateReviewItems),
                level:
                  automationTrends.candidateReviewItems &&
                  automationTrends.candidateReviewItems.direction === "up"
                    ? "status rejected"
                    : "status approved",
              },
            ]
              .map(function (item) {
                return (
                  '<span class="' + item.level + '">' + options.escapeHtml(item.label) + "</span>"
                );
              })
              .join("") +
            "</div>"
          : "") +
        (automationHealthAlerts.length
          ? '<div class="queue-filters" style="margin-top:0.7rem">' +
            automationHealthAlerts
              .slice(0, 4)
              .map(function (alert) {
                return (
                  '<span class="' +
                  (alert.level === "warn" ? "status rejected" : "status reviewing") +
                  '">' +
                  options.escapeHtml(alert.label) +
                  "</span>"
                );
              })
              .join("") +
            '</div><div class="subtle" style="margin-top:0.7rem">' +
            options.escapeHtml(automationHealthAlerts[0].message) +
            "</div>"
          : '<div class="mini-status">No active automation alerts from the latest run.</div>') +
        "</div>"
      : "") +
    (trendCards.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Trend watch</div><div class="subtle" style="margin-bottom:0.7rem">Based on the latest automation runs, this shows whether pressure is improving or building.</div><div class="queue-insights-grid">' +
        trendCards
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              options.escapeHtml(item.value) +
              '</div><div class="queue-insight-label">' +
              options.escapeHtml(item.label) +
              '</div><div class="queue-insight-note">' +
              options.escapeHtml(item.note) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    (automationLicensureSprint && automationLicensureSprint.count
      ? '<div class="queue-insights"><div class="queue-insights-title">Current licensure sprint</div><div class="mini-status"><strong>Automation-picked lane:</strong> ' +
        options.escapeHtml(formatLicensureSprintLane(automationLicensureSprint.lane)) +
        " (" +
        options.escapeHtml(String(automationLicensureSprint.count)) +
        " items)</div></div>"
      : "") +
    (lowLicensureCoverage
      ? '<div class="queue-insights"><div class="queue-insights-title">Licensure trust gap</div><div class="mini-status"><strong>Coverage is thin:</strong> ' +
        options.escapeHtml(
          licensureCoverageRate +
            "% of live therapists currently have cached primary-source licensure data. Prioritize a first-pass enrichment sprint before treating sourcing as the main lever.",
        ) +
        "</div></div>"
      : "") +
    '<div class="queue-insights"><div class="queue-insights-title">What to do next</div><div class="mini-status"><strong>Primary bottleneck:</strong> ' +
    options.escapeHtml(nextMove) +
    "</div></div>";
}

function formatLicensureSprintLane(lane) {
  if (lane === "first_pass") {
    return "First-pass enrichment";
  }
  if (lane === "failed_refresh") {
    return "Failed refresh recovery";
  }
  if (lane === "expiration_watch") {
    return "Expiration watch";
  }
  return "Clear";
}
