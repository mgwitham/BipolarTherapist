import fs from "node:fs";
import path from "node:path";

export const MAX_HISTORY = 30;

export function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

export function toRelative(root, filePath) {
  return path.relative(root, filePath) || ".";
}

export function readCsvRowCount(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return 0;
  }
  const raw = fs.readFileSync(absolutePath, "utf8").trim();
  if (!raw) {
    return 0;
  }
  const lines = raw.split(/\r?\n/);
  return Math.max(0, lines.length - 1);
}

export function buildMetrics(root) {
  return {
    sourceHealthChecks: readCsvRowCount(root, "data/import/generated-source-health-checks.csv"),
    operationalDriftChecks: readCsvRowCount(
      root,
      "data/import/generated-operational-drift-checks.csv",
    ),
    sourceDomains: readCsvRowCount(root, "data/import/generated-source-domain-health-report.csv"),
    sourcingRecommendations: readCsvRowCount(
      root,
      "data/import/generated-sourcing-recommendations.csv",
    ),
    opsQueueItems: readCsvRowCount(root, "data/import/generated-ingestion-ops-queue.csv"),
    reverificationItems: readCsvRowCount(root, "data/import/generated-reverification-batch.csv"),
    candidateReviewItems: readCsvRowCount(
      root,
      "data/import/generated-candidate-review-queue.csv",
    ),
  };
}

export function buildAlerts(metrics) {
  const alerts = [];
  if (metrics.opsQueueItems >= 25) {
    alerts.push({
      level: "warn",
      label: "Ops queue pressure",
      message: `${metrics.opsQueueItems} ingestion ops items are waiting. Work the inbox before sourcing more.`,
    });
  }
  if (metrics.reverificationItems >= 20) {
    alerts.push({
      level: "warn",
      label: "Freshness burden",
      message: `${metrics.reverificationItems} live therapists need reverification. Freshness risk is accumulating.`,
    });
  }
  if (metrics.candidateReviewItems >= 10) {
    alerts.push({
      level: "warn",
      label: "Candidate review backlog",
      message: `${metrics.candidateReviewItems} candidates are still waiting for review decisions.`,
    });
  }
  if (metrics.sourceHealthChecks === 0) {
    alerts.push({
      level: "warn",
      label: "Source checks empty",
      message: "No therapist source checks ran. Verify Sanity connectivity and live listing availability.",
    });
  }
  if (metrics.sourcingRecommendations === 0) {
    alerts.push({
      level: "info",
      label: "No sourcing recommendations",
      message: "No new sourcing moves were generated. Coverage may be healthy or source inputs may be thin.",
    });
  }
  return alerts;
}

export function readHistory(historyPath) {
  if (!fs.existsSync(historyPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(historyPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

export function writeHistory(historyPath, entry) {
  const history = readHistory(historyPath);
  history.push(entry);
  const nextHistory = history.slice(-MAX_HISTORY);
  fs.writeFileSync(historyPath, JSON.stringify(nextHistory, null, 2) + "\n", "utf8");
}

function getMetricDelta(history, key, currentValue) {
  if (!history.length) {
    return null;
  }
  const previous = history[history.length - 1];
  const previousValue =
    previous && previous.metrics && typeof previous.metrics[key] === "number"
      ? previous.metrics[key]
      : null;
  if (previousValue == null || typeof currentValue !== "number") {
    return null;
  }
  return currentValue - previousValue;
}

export function buildTrendSignals(history, metrics) {
  const keys = ["opsQueueItems", "reverificationItems", "candidateReviewItems"];
  return keys.reduce(function (accumulator, key) {
    const delta = getMetricDelta(history, key, metrics[key]);
    accumulator[key] = {
      delta,
      direction:
        delta == null ? "unknown" : delta === 0 ? "flat" : delta > 0 ? "up" : "down",
    };
    return accumulator;
  }, {});
}

export function buildTrendAlerts(trends) {
  const alerts = [];
  if (trends.opsQueueItems && trends.opsQueueItems.delta >= 3) {
    alerts.push({
      level: "warn",
      label: "Ops queue trending up",
      message: `Ops queue grew by ${trends.opsQueueItems.delta} items since the previous automation run.`,
    });
  }
  if (trends.reverificationItems && trends.reverificationItems.delta >= 3) {
    alerts.push({
      level: "warn",
      label: "Freshness pressure trending up",
      message: `Reverification demand grew by ${trends.reverificationItems.delta} items since the previous automation run.`,
    });
  }
  if (trends.candidateReviewItems && trends.candidateReviewItems.delta >= 2) {
    alerts.push({
      level: "warn",
      label: "Candidate backlog trending up",
      message: `Candidate review backlog grew by ${trends.candidateReviewItems.delta} items since the previous automation run.`,
    });
  }
  return alerts;
}

export function buildMarkdown(summary) {
  const lines = [
    "# Ingestion Automation Run",
    "",
    `- Status: ${summary.status}`,
    `- Started: ${summary.startedAt}`,
    `- Finished: ${summary.finishedAt}`,
    `- Duration: ${formatDuration(summary.durationMs)}`,
    `- Successful steps: ${summary.successfulSteps}/${summary.totalSteps}`,
    "",
    "## Pipeline Snapshot",
    "",
    `- Source checks: ${summary.metrics.sourceHealthChecks}`,
    `- Drift checks: ${summary.metrics.operationalDriftChecks}`,
    `- Source domains tracked: ${summary.metrics.sourceDomains}`,
    `- Sourcing recommendations: ${summary.metrics.sourcingRecommendations}`,
    `- Ops queue items: ${summary.metrics.opsQueueItems}`,
    `- Reverification items: ${summary.metrics.reverificationItems}`,
    `- Candidate review items: ${summary.metrics.candidateReviewItems}`,
    "",
    "## Trend Watch",
    "",
    `- Ops queue: ${summary.trends.opsQueueItems.direction}${summary.trends.opsQueueItems.delta == null ? "" : ` (${summary.trends.opsQueueItems.delta > 0 ? "+" : ""}${summary.trends.opsQueueItems.delta})`}`,
    `- Reverification: ${summary.trends.reverificationItems.direction}${summary.trends.reverificationItems.delta == null ? "" : ` (${summary.trends.reverificationItems.delta > 0 ? "+" : ""}${summary.trends.reverificationItems.delta})`}`,
    `- Candidate review: ${summary.trends.candidateReviewItems.direction}${summary.trends.candidateReviewItems.delta == null ? "" : ` (${summary.trends.candidateReviewItems.delta > 0 ? "+" : ""}${summary.trends.candidateReviewItems.delta})`}`,
    "",
    "## Alerts",
    "",
  ];

  if (summary.alerts.length) {
    summary.alerts.forEach(function (alert) {
      lines.push(`- [${alert.level.toUpperCase()}] ${alert.label}: ${alert.message}`);
    });
  } else {
    lines.push("- No active automation alerts.");
  }

  lines.push("");
  lines.push("## Steps");
  lines.push("");

  summary.steps.forEach(function (step) {
    lines.push(`### ${step.label}`);
    lines.push("");
    lines.push(`- Script: \`${step.script}\``);
    lines.push(`- Status: ${step.ok ? "ok" : "failed"}`);
    lines.push(`- Duration: ${formatDuration(step.durationMs)}`);
    lines.push(`- Started: ${step.startedAt}`);
    lines.push(`- Finished: ${step.endedAt}`);
    if (step.outputs.length) {
      lines.push("- Outputs:");
      step.outputs.forEach(function (output) {
        lines.push(`  - ${output.exists ? "Generated" : "Missing"}: \`${output.path}\``);
      });
    }
    lines.push("");
  });

  if (summary.failedStep) {
    lines.push("## Failure");
    lines.push("");
    lines.push(`- Failed step: ${summary.failedStep.label}`);
    lines.push(`- Exit code: ${summary.failedStep.exitCode}`);
    lines.push("");
  } else {
    lines.push("## Next move");
    lines.push("");
    lines.push("- Open the admin operations inbox and work the highest-priority publish, duplicate, confirmation, and refresh items.");
    if (summary.alerts.length) {
      lines.push(`- Start with the top alert: ${summary.alerts[0].label}.`);
    } else {
      lines.push(
        "- Use the updated sourcing recommendations and generated seed CSV to start the next acquisition wave if coverage is the current bottleneck.",
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
