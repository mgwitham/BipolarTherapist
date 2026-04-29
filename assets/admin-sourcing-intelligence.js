import discoveryPromptTemplate from "../docs/discovery-prompt.template.txt?raw";
import discoveryZipsConfig from "../config/discovery-zips.json";
import {
  buildExclusionBlock,
  buildZipsPhrase,
  findConfiguredCity as findConfiguredCityFromConfig,
  renderDiscoveryPrompt,
} from "../shared/discovery-prompt-domain.mjs";

const DEFAULT_DISCOVERY_COUNT = 10;

function buildCityIndex(therapists) {
  const index = new Map();
  (therapists || []).forEach(function (item) {
    const city = item.city || "";
    const state = item.state || "";
    if (!city) return;
    const key = [city, state].filter(Boolean).join(", ");
    const entry = index.get(key) || { city: city, state: state, zips: new Set(), entries: [] };
    if (item.zip) entry.zips.add(String(item.zip).slice(0, 5));
    entry.entries.push({
      name: item.name || "",
      credentials: item.credentials || "",
      licenseNumber: item.license_number || item.licenseNumber || "",
      sourceUrl: item.source_url || item.sourceUrl || item.website || "",
    });
    index.set(key, entry);
  });
  return index;
}

function extractCityName(cityLabel) {
  const comma = String(cityLabel || "").indexOf(",");
  return comma >= 0 ? cityLabel.slice(0, comma).trim() : String(cityLabel || "").trim();
}

export function findConfiguredCity(cityLabel) {
  return findConfiguredCityFromConfig(cityLabel, discoveryZipsConfig);
}

/**
 * Build an all-cities exclusion block from the therapist graph the admin
 * already has loaded. Matches the CLI's shape exactly (delegates to the
 * shared helper), so the prompt an admin paste-user ships is identical
 * to what `npm run cms:ingest` would ship.
 *
 * Known gap: admin only has live therapists in memory; the CLI also
 * includes pending candidates + applications. Downstream dedupe still
 * catches those, but the admin-copied prompt surfaces a strict subset.
 */
function buildExclusionBlockFromTherapists(therapists) {
  const entries = (therapists || []).map((item) => ({
    name: item.name || "",
    licenseNumber: item.license_number || item.licenseNumber || "",
    city: item.city || "",
    website: item.website || "",
    sourceUrl: item.source_url || item.sourceUrl || "",
  }));
  return buildExclusionBlock({ therapists: entries });
}

export function buildDiscoveryPromptForCity(cityLabel, options) {
  const count =
    options && Number(options.count) > 0
      ? Math.floor(Number(options.count))
      : DEFAULT_DISCOVERY_COUNT;
  const cityName = extractCityName(cityLabel) || cityLabel;
  const configured = findConfiguredCityFromConfig(cityLabel, discoveryZipsConfig);
  const zips = configured ? configured.zips : [];
  const exclusionBlock = buildExclusionBlockFromTherapists((options && options.therapists) || []);
  return renderDiscoveryPrompt(discoveryPromptTemplate, {
    city: cityName,
    zipsPhrase: buildZipsPhrase(zips),
    count,
    exclusionBlock,
  });
}

/**
 * Pull the configured CA metros as seed rows for the coverage picker.
 * Each entry becomes a synthetic zero-coverage row if the city isn't
 * present in the live therapist graph — the goal is to surface large
 * uncovered metros (Oakland, San Jose) ahead of small suburbs with 1-2
 * therapists.
 */
function getSeedCitiesFromConfig() {
  const cities = (discoveryZipsConfig && discoveryZipsConfig.cities) || {};
  return Object.values(cities).map(function (entry) {
    return {
      name: entry && entry.name ? entry.name : "",
      state: "CA",
      population: entry && entry.population ? Number(entry.population) : 0,
    };
  });
}

export function buildCoverageInsights(therapists, helpers, seedCities) {
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
      population: 0,
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

  // Seed major metros that aren't yet in the therapist graph so a large
  // uncovered city (e.g. Oakland at 440k population, 0 listings) beats a
  // tiny suburb with 1-2 therapists. Seeds only inject when the city is
  // absent — they never overwrite real coverage data.
  (seedCities || []).forEach(function (seed) {
    if (!seed || !seed.name) return;
    const state = seed.state || "CA";
    const cityKey = [seed.name, state].filter(Boolean).join(", ");
    if (byCity.has(cityKey)) {
      const existing = byCity.get(cityKey);
      if (!existing.population && seed.population) existing.population = seed.population;
      return;
    }
    byCity.set(cityKey, {
      city: seed.name,
      state,
      total: 0,
      therapy: 0,
      psychiatry: 0,
      telehealth: 0,
      accepting: 0,
      trustRisk: 0,
      population: Number(seed.population) || 0,
    });
  });

  const cityRows = Array.from(byCity.values()).sort(function (a, b) {
    const aNeedsPsychiatry = a.psychiatry === 0 ? 2 : 0;
    const bNeedsPsychiatry = b.psychiatry === 0 ? 2 : 0;
    const aNeedsTelehealth = a.telehealth === 0 ? 1 : 0;
    const bNeedsTelehealth = b.telehealth === 0 ? 1 : 0;
    const aScore = aNeedsPsychiatry + aNeedsTelehealth + (a.accepting === 0 ? 1 : 0);
    const bScore = bNeedsPsychiatry + bNeedsTelehealth + (b.accepting === 0 ? 1 : 0);
    return (
      bScore - aScore ||
      a.total - b.total ||
      (b.population || 0) - (a.population || 0) ||
      a.city.localeCompare(b.city)
    );
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

function renderCityActions(cityLabel, escapeHtml) {
  const configured = findConfiguredCityFromConfig(cityLabel, discoveryZipsConfig);
  if (configured) {
    const claudeCodeCommand = `Run therapist discovery for ${configured.name} (use WebSearch — no paid API) and ingest results into the candidate review queue.`;
    return (
      '<button type="button" class="btn-primary btn-inline" data-claude-code-command="' +
      escapeHtml(claudeCodeCommand) +
      '" data-discovery-city="' +
      escapeHtml(cityLabel) +
      '" style="margin-top:0.6rem">Copy Claude Code command</button>' +
      '<button type="button" class="btn-secondary btn-inline" data-discovery-prompt="' +
      escapeHtml(cityLabel) +
      '" style="margin-top:0.6rem;margin-left:0.4rem">Copy discovery prompt</button>'
    );
  }
  return (
    '<button type="button" class="btn-secondary btn-inline" data-discovery-prompt="' +
    escapeHtml(cityLabel) +
    '" style="margin-top:0.6rem">Copy discovery prompt</button>' +
    '<div class="subtle" style="margin-top:0.4rem;font-size:0.85em">Add this city to <code>config/discovery-zips.json</code> to enable the Claude Code shortcut.</div>'
  );
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

  const insights = buildCoverageInsights(
    therapists,
    {
      inferCoverageRole: options.inferCoverageRole,
      getTherapistFieldTrustAttentionCount: options.getTherapistFieldTrustAttentionCount,
    },
    getSeedCitiesFromConfig(),
  );
  root.innerHTML =
    '<div class="queue-insights"><div class="queue-insights-title">Where to source next</div><div class="subtle" style="margin-bottom:0.7rem">Prioritizes (1) large CA metros with zero coverage, (2) cities light on psychiatry / telehealth / accepting listings. Copy Claude Code command to paste into this chat and have the agent run discovery here; Copy discovery prompt to paste into Claude.ai or ChatGPT externally.</div><div class="queue-insights-grid">' +
    insights.thinnestCities
      .map(function (row) {
        const cityLabel = [row.city, row.state].filter(Boolean).join(", ");
        const gaps = [];
        if (row.total === 0) gaps.push("No coverage yet");
        if (row.total > 0 && row.psychiatry === 0) gaps.push("No psychiatry");
        if (row.total > 0 && row.telehealth === 0) gaps.push("No telehealth");
        if (row.total > 0 && row.accepting === 0) gaps.push("No accepting listings");
        if (row.trustRisk > 0) gaps.push(String(row.trustRisk) + " trust-risk listings");
        const statsLine =
          row.total === 0 && row.population
            ? "Pop. " + Math.round(row.population / 1000) + "k · uncovered metro"
            : row.total +
              " listings · " +
              row.therapy +
              " therapy · " +
              row.psychiatry +
              " psychiatry";
        return (
          '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
          options.escapeHtml(cityLabel) +
          '</strong></div><div class="queue-insight-note">' +
          options.escapeHtml(statsLine) +
          '</div><div class="queue-insight-note">' +
          options.escapeHtml(gaps.join(" · ") || "Balanced coverage") +
          "</div>" +
          renderCityActions(cityLabel, options.escapeHtml) +
          "</div>"
        );
      })
      .join("") +
    '</div><div class="review-coach-status" id="coverageDiscoveryStatus" style="margin-top:0.6rem"></div></div>' +
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

  function setStatus(message) {
    const status = root.querySelector("#coverageDiscoveryStatus");
    if (status) status.textContent = message;
  }

  root.querySelectorAll("[data-claude-code-command]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const command = button.getAttribute("data-claude-code-command") || "";
      const cityLabel = button.getAttribute("data-discovery-city") || "";
      if (!command) return;
      const success = await options.copyText(command);
      setStatus(
        success
          ? "Command copied for " + cityLabel + ". Paste into your Claude Code chat."
          : "Could not copy command for " + cityLabel + ".",
      );
    });
  });

  root.querySelectorAll("[data-discovery-prompt]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const cityLabel = button.getAttribute("data-discovery-prompt") || "";
      if (!cityLabel) return;
      const prompt = buildDiscoveryPromptForCity(cityLabel, {
        therapists,
        count: DEFAULT_DISCOVERY_COUNT,
      });
      const success = await options.copyText(prompt);
      setStatus(
        success
          ? "Discovery prompt copied for " + cityLabel + ". Paste into ChatGPT."
          : "Could not copy prompt for " + cityLabel + ".",
      );
    });
  });
}
