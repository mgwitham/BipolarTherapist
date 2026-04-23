export function buildCoverageInsights(therapists, helpers) {
  const byCity = new Map();
  const sourceDomains = new Map();

  (therapists || []).forEach(function (item) {
    const cityKey = [item.city, item.state].filter(Boolean).join(", ") || "Unknown";
    const entry = byCity.get(cityKey) || {
      city: item.city || "Unknown",
      state: item.state || "",
      total: 0,
      therapy: 0,
      psychiatry: 0,
      telehealth: 0,
      accepting: 0,
      trustRisk: 0,
    };
    entry.total += 1;
    entry[helpers.inferCoverageRole(item)] += 1;
    if (item.accepts_telehealth) {
      entry.telehealth += 1;
    }
    if (item.accepting_new_patients) {
      entry.accepting += 1;
    }
    if (helpers.getTherapistFieldTrustAttentionCount(item) > 0) {
      entry.trustRisk += 1;
    }
    byCity.set(cityKey, entry);

    const sourceUrl = item.source_url || item.sourceUrl || "";
    if (sourceUrl) {
      try {
        const domain = new URL(sourceUrl).hostname.replace(/^www\./, "");
        const sourceEntry = sourceDomains.get(domain) || { domain: domain, count: 0 };
        sourceEntry.count += 1;
        sourceDomains.set(domain, sourceEntry);
      } catch (_error) {
        // Ignore malformed source URLs in the coverage rollup.
      }
    }
  });

  const cityRows = Array.from(byCity.values()).sort(function (a, b) {
    const aNeedsPsychiatry = a.psychiatry === 0 ? 2 : 0;
    const bNeedsPsychiatry = b.psychiatry === 0 ? 2 : 0;
    const aNeedsTelehealth = a.telehealth === 0 ? 1 : 0;
    const bNeedsTelehealth = b.telehealth === 0 ? 1 : 0;
    const aScore = aNeedsPsychiatry + aNeedsTelehealth + (a.accepting === 0 ? 1 : 0);
    const bScore = bNeedsPsychiatry + bNeedsTelehealth + (b.accepting === 0 ? 1 : 0);
    return bScore - aScore || a.total - b.total || a.city.localeCompare(b.city);
  });

  const thinnestCities = cityRows
    .filter(function (row) {
      return row.total <= 3 || row.psychiatry === 0 || row.telehealth === 0 || row.accepting === 0;
    })
    .slice(0, 6);

  const sourceConcentration = Array.from(sourceDomains.values())
    .sort(function (a, b) {
      return b.count - a.count || a.domain.localeCompare(b.domain);
    })
    .slice(0, 5);

  const roleTotals = cityRows.reduce(
    function (acc, row) {
      acc.therapy += row.therapy;
      acc.psychiatry += row.psychiatry;
      acc.telehealth += row.telehealth;
      acc.trustRisk += row.trustRisk;
      return acc;
    },
    { therapy: 0, psychiatry: 0, telehealth: 0, trustRisk: 0 },
  );

  return {
    thinnestCities: thinnestCities,
    sourceConcentration: sourceConcentration,
    roleTotals: roleTotals,
    cityCount: cityRows.length,
  };
}

function buildSourcePerformanceInsights(candidates) {
  const bySourceType = new Map();

  (candidates || []).forEach(function (item) {
    const key = item.source_type || "unknown";
    const entry = bySourceType.get(key) || {
      key: key,
      total: 0,
      ready: 0,
      published: 0,
      needsConfirmation: 0,
      duplicates: 0,
    };

    entry.total += 1;
    if (item.review_status === "ready_to_publish" || item.publish_recommendation === "ready") {
      entry.ready += 1;
    }
    if (item.review_status === "published") {
      entry.published += 1;
    }
    if (
      item.review_status === "needs_confirmation" ||
      item.publish_recommendation === "needs_confirmation"
    ) {
      entry.needsConfirmation += 1;
    }
    if (
      item.dedupe_status === "possible_duplicate" ||
      item.dedupe_status === "definite_duplicate" ||
      item.dedupe_status === "rejected_duplicate"
    ) {
      entry.duplicates += 1;
    }

    bySourceType.set(key, entry);
  });

  return Array.from(bySourceType.values())
    .map(function (item) {
      const total = item.total || 1;
      return {
        ...item,
        publishableRate: Math.round(((item.ready + item.published) / total) * 100),
        duplicateRate: Math.round((item.duplicates / total) * 100),
        confirmationRate: Math.round((item.needsConfirmation / total) * 100),
      };
    })
    .sort(function (a, b) {
      return (
        b.publishableRate - a.publishableRate ||
        a.duplicateRate - b.duplicateRate ||
        b.total - a.total
      );
    });
}

function getSourcePerformanceRecommendation(item) {
  if (item.publishableRate >= 60 && item.duplicateRate <= 20) {
    return "Lean in. This source type is producing strong publishable yield.";
  }
  if (item.duplicateRate >= 40) {
    return "Use carefully. This source type is creating a lot of duplicate review work.";
  }
  if (item.confirmationRate >= 50) {
    return "Useful, but expect confirmation-heavy ops work before publish.";
  }
  return "Mixed quality. Keep using it, but favor cleaner source classes first.";
}

function buildBestSourcingBets(coverageInsights, sourceInsights) {
  const sourceRank = new Map(
    (sourceInsights || []).map(function (item) {
      return [item.key, item];
    }),
  );

  function chooseSourceType(role, gaps) {
    const options =
      role === "psychiatrist"
        ? ["practice_website", "manual_research", "directory_profile"]
        : ["practice_website", "directory_profile", "manual_research"];

    return options
      .map(function (key) {
        const source = sourceRank.get(key) || {
          key: key,
          publishableRate: 0,
          duplicateRate: 0,
          confirmationRate: 0,
        };
        const gapBonus =
          (gaps.includes("psychiatry") && key === "practice_website" ? 15 : 0) +
          (gaps.includes("telehealth") && key !== "directory_profile" ? 10 : 0);
        const score =
          source.publishableRate -
          source.duplicateRate -
          Math.round(source.confirmationRate / 2) +
          gapBonus;
        return {
          source: source,
          score: score,
        };
      })
      .sort(function (a, b) {
        return b.score - a.score;
      })[0];
  }

  return (coverageInsights.thinnestCities || [])
    .slice(0, 4)
    .map(function (city) {
      const gaps = []
        .concat(city.psychiatry === 0 ? ["psychiatry"] : [])
        .concat(city.telehealth === 0 ? ["telehealth"] : [])
        .concat(city.accepting === 0 ? ["accepting"] : []);
      const role = city.psychiatry === 0 ? "psychiatrist" : "therapist";
      const sourceChoice = chooseSourceType(role, gaps);
      return {
        city: [city.city, city.state].filter(Boolean).join(", "),
        role: role,
        gaps: gaps,
        recommendedSourceType: sourceChoice.source.key,
        expectedPublishableRate: sourceChoice.source.publishableRate,
        expectedDuplicateRate: sourceChoice.source.duplicateRate,
        recommendation:
          "Start with " +
          String(sourceChoice.source.key).replace(/_/g, " ") +
          " in " +
          [city.city, city.state].filter(Boolean).join(", ") +
          ".",
      };
    })
    .sort(function (a, b) {
      return (
        b.expectedPublishableRate - a.expectedPublishableRate ||
        a.expectedDuplicateRate - b.expectedDuplicateRate
      );
    });
}

export function renderCoverageIntelligencePanel(options) {
  const root = options.root;
  if (!root) {
    return;
  }

  if (options.authRequired) {
    root.innerHTML = "";
    return;
  }

  const therapists = Array.isArray(options.therapists) ? options.therapists : [];
  if (!therapists.length) {
    root.innerHTML =
      '<div class="empty">No live therapist graph available yet. Publish listings to generate sourcing intelligence.</div>';
    return;
  }

  const insights = buildCoverageInsights(therapists, {
    inferCoverageRole: options.inferCoverageRole,
    getTherapistFieldTrustAttentionCount: options.getTherapistFieldTrustAttentionCount,
  });

  root.innerHTML =
    '<div class="queue-insights"><div class="queue-insights-title">Where to source next</div><div class="subtle" style="margin-bottom:0.7rem">Prioritize cities that are light on psychiatry, telehealth coverage, or accepting clinicians.</div><div class="queue-insights-grid">' +
    insights.thinnestCities
      .map(function (row) {
        const gaps = [];
        if (row.psychiatry === 0) gaps.push("No psychiatry");
        if (row.telehealth === 0) gaps.push("No telehealth");
        if (row.accepting === 0) gaps.push("No accepting listings");
        if (row.trustRisk > 0) gaps.push(String(row.trustRisk) + " trust-risk listings");
        return (
          '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
          options.escapeHtml([row.city, row.state].filter(Boolean).join(", ")) +
          '</strong></div><div class="queue-insight-note">' +
          options.escapeHtml(
            row.total +
              " listings · " +
              row.therapy +
              " therapy · " +
              row.psychiatry +
              " psychiatry",
          ) +
          '</div><div class="queue-insight-note">' +
          options.escapeHtml(gaps.join(" · ") || "Balanced coverage") +
          "</div></div>"
        );
      })
      .join("") +
    "</div></div>" +
    '<div class="queue-insights"><div class="queue-insights-title">Graph balance</div><div class="queue-insights-grid">' +
    [
      {
        label: "Cities represented",
        count: insights.cityCount,
      },
      {
        label: "Therapy listings",
        count: insights.roleTotals.therapy,
      },
      {
        label: "Psychiatry listings",
        count: insights.roleTotals.psychiatry,
      },
      {
        label: "Listings with trust risk",
        count: insights.roleTotals.trustRisk,
      },
    ]
      .map(function (item) {
        return (
          '<div class="queue-insight-card"><div class="queue-insight-value">' +
          options.escapeHtml(item.count) +
          '</div><div class="queue-insight-label">' +
          options.escapeHtml(item.label) +
          "</div></div>"
        );
      })
      .join("") +
    "</div></div>" +
    '<div class="queue-insights"><div class="queue-insights-title">Source concentration</div><div class="subtle" style="margin-bottom:0.7rem">Watch for over-reliance on a small number of domains. That is a sourcing risk and a freshness risk.</div><div class="queue-insights-grid">' +
    insights.sourceConcentration
      .map(function (source) {
        return (
          '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
          options.escapeHtml(source.domain) +
          '</strong></div><div class="queue-insight-note">' +
          options.escapeHtml(
            String(source.count) + " live listing" + (source.count === 1 ? "" : "s"),
          ) +
          "</div></div>"
        );
      })
      .join("") +
    "</div></div>";
}

export function renderSourcePerformancePanel(options) {
  const root = options.root;
  if (!root) {
    return;
  }

  if (options.authRequired) {
    root.innerHTML = "";
    return;
  }

  const candidates = Array.isArray(options.candidates) ? options.candidates : [];
  if (!candidates.length) {
    root.innerHTML =
      '<div class="empty">No sourced candidates yet. Once discovery runs, source performance will appear here.</div>';
    return;
  }

  const insights = buildSourcePerformanceInsights(candidates);
  const coverageInsights = buildCoverageInsights(
    Array.isArray(options.therapists) ? options.therapists : [],
    {
      inferCoverageRole: options.inferCoverageRole,
      getTherapistFieldTrustAttentionCount: options.getTherapistFieldTrustAttentionCount,
    },
  );
  const bestBets = buildBestSourcingBets(coverageInsights, insights);

  root.innerHTML =
    '<div class="queue-insights"><div class="queue-insights-title">Best sourcing bets</div><div class="subtle" style="margin-bottom:0.7rem">These combine coverage gaps with actual source yield so you can work the highest-leverage acquisition moves first.</div><div class="queue-insights-grid">' +
    bestBets
      .map(function (item) {
        return (
          '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
          options.escapeHtml(item.city) +
          '</strong></div><div class="queue-insight-note">' +
          options.escapeHtml(
            "Go get more " +
              item.role +
              (item.gaps.length ? " for " + item.gaps.join(", ") : " coverage"),
          ) +
          '</div><div class="queue-insight-note"><strong>Best source type:</strong> ' +
          options.escapeHtml(String(item.recommendedSourceType).replace(/_/g, " ")) +
          '</div><div class="queue-insight-note">' +
          options.escapeHtml(
            item.expectedPublishableRate +
              "% publishable expected · " +
              item.expectedDuplicateRate +
              "% duplicate risk",
          ) +
          '</div><div class="queue-insight-note">' +
          options.escapeHtml(item.recommendation) +
          "</div></div>"
        );
      })
      .join("") +
    "</div></div>" +
    '<div class="queue-insights"><div class="queue-insights-title">Source-type yield</div><div class="subtle" style="margin-bottom:0.7rem">Use this to decide which source classes deserve more discovery energy.</div><div class="queue-insights-grid">' +
    insights
      .map(function (item) {
        return (
          '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
          options.escapeHtml(String(item.key).replace(/_/g, " ")) +
          '</strong></div><div class="queue-insight-note">' +
          options.escapeHtml(
            item.total +
              " candidates · " +
              item.publishableRate +
              "% publishable · " +
              item.duplicateRate +
              "% duplicate risk",
          ) +
          '</div><div class="queue-insight-note">' +
          options.escapeHtml(item.confirmationRate + "% confirmation-heavy") +
          '</div><div class="queue-insight-note">' +
          options.escapeHtml(getSourcePerformanceRecommendation(item)) +
          "</div></div>"
        );
      })
      .join("") +
    "</div></div>";
}
