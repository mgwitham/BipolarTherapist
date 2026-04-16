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

function buildCoverageSourcingRecommendations(insights) {
  const concentratedDomains = (insights.sourceConcentration || [])
    .filter(function (item) {
      return item.count >= 2;
    })
    .map(function (item) {
      return item.domain;
    });

  return (insights.thinnestCities || []).slice(0, 4).map(function (row) {
    const missingPsychiatry = row.psychiatry === 0;
    const missingTelehealth = row.telehealth === 0;
    const missingAccepting = row.accepting === 0;
    const role = missingPsychiatry ? "psychiatrist" : "therapist";
    const cityLabel = [row.city, row.state].filter(Boolean).join(", ");
    const searchParts = ["bipolar", role, cityLabel];
    if (missingTelehealth) {
      searchParts.push("telehealth");
    }
    if (missingAccepting) {
      searchParts.push("accepting new patients");
    }

    const avoidNote = concentratedDomains.length
      ? "Lean away from overused domains like " + concentratedDomains.slice(0, 2).join(", ") + "."
      : "Add net-new source domains if possible.";

    return {
      city: cityLabel,
      role: role,
      gaps: []
        .concat(missingPsychiatry ? ["psychiatry"] : [])
        .concat(missingTelehealth ? ["telehealth"] : [])
        .concat(missingAccepting ? ["accepting"] : []),
      query: searchParts.join(" "),
      targetSources: missingPsychiatry
        ? "Practice sites, psychiatry clinics, medication-management groups"
        : "Private practice sites, therapy group practices, bipolar-focused clinician pages",
      avoidNote: avoidNote,
    };
  });
}

function buildCoverageSourcingPacket(recommendations) {
  const rows = Array.isArray(recommendations) ? recommendations : [];
  if (!rows.length) {
    return "";
  }

  return [
    "# Coverage Sourcing Packet",
    "",
    "Use these recommendations to guide the next therapist discovery wave.",
    "",
  ]
    .concat(
      rows.map(function (item, index) {
        return [
          index + 1 + ". " + item.city,
          "- Role to prioritize: " + item.role,
          "- Gaps: " + (item.gaps.length ? item.gaps.join(", ") : "general coverage"),
          "- Search query: " + item.query,
          "- Target sources: " + item.targetSources,
          "- Operator note: " + item.avoidNote,
          "",
        ].join("\n");
      }),
    )
    .join("\n");
}

function buildCoverageSourceSeedCsv(recommendations, helpers) {
  const rows = Array.isArray(recommendations) ? recommendations : [];
  if (!rows.length) {
    return "";
  }

  const headers = [
    "sourceUrl",
    "sourceType",
    "name",
    "credentials",
    "title",
    "practiceName",
    "city",
    "state",
    "zip",
    "country",
    "licenseState",
    "licenseNumber",
    "email",
    "phone",
    "website",
    "bookingUrl",
    "supportingSourceUrls",
    "clientPopulations",
    "insuranceAccepted",
    "telehealthStates",
    "estimatedWaitTime",
    "sessionFeeMin",
    "sessionFeeMax",
    "slidingScale",
    "notes",
  ];

  const lines = [headers.join(",")];
  rows.forEach(function (item) {
    const parts = String(item.city || "")
      .split(",")
      .map(function (part) {
        return part.trim();
      });
    const city = parts[0] || "";
    const state = parts[1] || "";
    const values = [
      "",
      "manual_research",
      "",
      "",
      item.role === "psychiatrist" ? "Psychiatrist" : "Therapist",
      "",
      city,
      state,
      "",
      "US",
      state,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      item.gaps.includes("telehealth") ? state : "",
      "",
      "",
      "",
      "false",
      [
        "Coverage-guided sourcing target",
        "Role: " + item.role,
        "Gaps: " + (item.gaps.length ? item.gaps.join("|") : "general_coverage"),
        "Query: " + item.query,
        "Target sources: " + item.targetSources,
      ].join(" · "),
    ];
    lines.push(values.map(helpers.csvEscape).join(","));
  });

  return lines.join("\n");
}

function buildCoverageDiscoveryCommand() {
  return [
    "npm run cms:discover:candidates -- data/import/generated-coverage-source-seeds.csv",
    "npm run cms:import:candidates -- data/import/generated-discovered-therapist-candidates.csv",
    "npm run cms:generate:candidate-review-queue",
  ].join("\n");
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
  const sourcingRecommendations = buildCoverageSourcingRecommendations(insights);

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
    '<div class="queue-actions" style="margin-bottom:0.8rem">' +
    '<button class="btn-primary" data-coverage-export="packet">Copy sourcing packet</button>' +
    '<button class="btn-secondary" data-coverage-export="seed-csv">Copy source-seed CSV</button>' +
    '<button class="btn-secondary" data-coverage-export="download-packet">Download packet</button>' +
    '<button class="btn-secondary" data-coverage-export="download-seed-csv">Download seed CSV</button>' +
    '<button class="btn-secondary" data-coverage-export="command">Copy discovery command</button>' +
    '</div><div class="review-coach-status" id="coverageSourcingStatus"></div>' +
    '<div class="queue-insights"><div class="queue-insights-title">Recommended sourcing moves</div><div class="subtle" style="margin-bottom:0.7rem">Use these as the next founder-ops queries when you want to add therapists efficiently.</div><div class="queue-insights-grid">' +
    sourcingRecommendations
      .map(function (item) {
        return (
          '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
          options.escapeHtml(item.city) +
          '</strong></div><div class="queue-insight-note">' +
          options.escapeHtml(
            "Go get more " +
              item.role +
              " coverage" +
              (item.gaps.length ? " for " + item.gaps.join(", ") : ""),
          ) +
          '</div><div class="queue-insight-note"><strong>Query:</strong> ' +
          options.escapeHtml(item.query) +
          '</div><div class="queue-insight-note"><strong>Target sources:</strong> ' +
          options.escapeHtml(item.targetSources) +
          '</div><div class="queue-insight-note">' +
          options.escapeHtml(item.avoidNote) +
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

  root.querySelectorAll("[data-coverage-export]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const mode = button.getAttribute("data-coverage-export");
      const packetText = buildCoverageSourcingPacket(sourcingRecommendations);
      const seedCsvText = buildCoverageSourceSeedCsv(sourcingRecommendations, {
        csvEscape: options.csvEscape,
      });
      const commandText = buildCoverageDiscoveryCommand();
      const status = root.querySelector("#coverageSourcingStatus");
      let success = false;
      let message = "";

      if (mode === "seed-csv") {
        success = seedCsvText ? await options.copyText(seedCsvText) : false;
        message = success ? "Source-seed CSV copied." : "Could not copy source-seed CSV.";
      } else if (mode === "packet") {
        success = packetText ? await options.copyText(packetText) : false;
        message = success ? "Sourcing packet copied." : "Could not copy sourcing packet.";
      } else if (mode === "download-packet") {
        success = packetText
          ? options.downloadText(
              "coverage-sourcing-packet.md",
              packetText,
              "text/markdown;charset=utf-8",
            )
          : false;
        message = success ? "Sourcing packet downloaded." : "Could not download sourcing packet.";
      } else if (mode === "download-seed-csv") {
        success = seedCsvText
          ? options.downloadText(
              "generated-coverage-source-seeds.csv",
              seedCsvText,
              "text/csv;charset=utf-8",
            )
          : false;
        message = success ? "Source-seed CSV downloaded." : "Could not download source-seed CSV.";
      } else if (mode === "command") {
        success = commandText ? await options.copyText(commandText) : false;
        message = success
          ? "Discovery command sequence copied."
          : "Could not copy discovery command sequence.";
      }

      if (status) {
        status.textContent = message;
      }
    });
  });
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
