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
