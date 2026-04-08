import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_JSON = path.join(ROOT, "data", "import", "generated-ingestion-automation-status.json");
const OUTPUT_MD = path.join(ROOT, "data", "import", "generated-ingestion-automation-status.md");
const HISTORY_JSON = path.join(ROOT, "data", "import", "generated-ingestion-automation-history.json");
const MAX_HISTORY = 30;

const steps = [
  {
    label: "Source health checks",
    script: "cms:run:source-health-checks",
    outputs: [
      "data/import/generated-source-health-checks.csv",
      "data/import/generated-source-health-checks.md",
    ],
  },
  {
    label: "Operational drift checks",
    script: "cms:run:operational-drift-checks",
    outputs: [
      "data/import/generated-operational-drift-checks.csv",
      "data/import/generated-operational-drift-checks.md",
    ],
  },
  {
    label: "Source domain health report",
    script: "cms:generate:source-domain-health-report",
    outputs: [
      "data/import/generated-source-domain-health-report.csv",
      "data/import/generated-source-domain-health-report.md",
    ],
  },
  {
    label: "Sourcing recommendations",
    script: "cms:generate:sourcing-recommendations",
    outputs: [
      "data/import/generated-sourcing-recommendations.csv",
      "data/import/generated-sourcing-recommendations.md",
      "data/import/generated-coverage-source-seeds.csv",
    ],
  },
  {
    label: "Ingestion ops queue",
    script: "cms:generate:ingestion-ops-queue",
    outputs: [
      "data/import/generated-ingestion-ops-queue.csv",
      "data/import/generated-ingestion-ops-queue.md",
    ],
  },
  {
    label: "Reverification batch",
    script: "cms:generate:reverification-batch",
    outputs: [
      "data/import/generated-reverification-batch.csv",
      "data/import/generated-reverification-batch.md",
    ],
  },
  {
    label: "Candidate review queue",
    script: "cms:generate:candidate-review-queue",
    outputs: [
      "data/import/generated-candidate-review-queue.csv",
      "data/import/generated-candidate-review-queue.md",
    ],
  },
];

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function toRelative(filePath) {
  return path.relative(ROOT, filePath) || ".";
}

function readCsvRowCount(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
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

function buildMetrics() {
  return {
    sourceHealthChecks: readCsvRowCount("data/import/generated-source-health-checks.csv"),
    operationalDriftChecks: readCsvRowCount("data/import/generated-operational-drift-checks.csv"),
    sourceDomains: readCsvRowCount("data/import/generated-source-domain-health-report.csv"),
    sourcingRecommendations: readCsvRowCount("data/import/generated-sourcing-recommendations.csv"),
    opsQueueItems: readCsvRowCount("data/import/generated-ingestion-ops-queue.csv"),
    reverificationItems: readCsvRowCount("data/import/generated-reverification-batch.csv"),
    candidateReviewItems: readCsvRowCount("data/import/generated-candidate-review-queue.csv"),
  };
}

function buildAlerts(metrics) {
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

function readHistory() {
  if (!fs.existsSync(HISTORY_JSON)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_JSON, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function writeHistory(entry) {
  const history = readHistory();
  history.push(entry);
  const nextHistory = history.slice(-MAX_HISTORY);
  fs.writeFileSync(HISTORY_JSON, JSON.stringify(nextHistory, null, 2) + "\n", "utf8");
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

function buildTrendSignals(history, metrics) {
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

function buildTrendAlerts(trends) {
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

function runStep(step) {
  const startedAt = new Date();
  const startMs = Date.now();
  const result = spawnSync("npm", ["run", step.script], {
    cwd: ROOT,
    env: process.env,
    shell: false,
    encoding: "utf8",
  });
  const endedAt = new Date();
  const durationMs = Date.now() - startMs;

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  return {
    label: step.label,
    script: step.script,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs,
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    outputs: step.outputs.map(function (outputPath) {
      const absolutePath = path.join(ROOT, outputPath);
      return {
        path: outputPath,
        exists: fs.existsSync(absolutePath),
      };
    }),
  };
}

function buildMarkdown(summary) {
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

function main() {
  const startedAt = new Date();
  const results = [];

  for (const step of steps) {
    console.log(`\n== ${step.label} ==`);
    const result = runStep(step);
    results.push(result);
    if (!result.ok) {
      break;
    }
  }

  const finishedAt = new Date();
  const history = readHistory();
  const metrics = buildMetrics();
  const trends = buildTrendSignals(history, metrics);
  const alerts = buildAlerts(metrics).concat(buildTrendAlerts(trends));
  const summary = {
    status: results.every(function (step) {
      return step.ok;
    })
      ? alerts.some(function (alert) {
          return alert.level === "warn";
        })
        ? "attention"
        : "ok"
      : "failed",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    totalSteps: steps.length,
    successfulSteps: results.filter(function (step) {
      return step.ok;
    }).length,
    metrics,
    trends,
    alerts,
    steps: results,
    failedStep:
      results.find(function (step) {
        return !step.ok;
      }) || null,
  };

  ensureDir(OUTPUT_JSON);
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(summary, null, 2) + "\n", "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(summary) + "\n", "utf8");
  writeHistory({
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    status: summary.status,
    successfulSteps: summary.successfulSteps,
    totalSteps: summary.totalSteps,
    metrics: summary.metrics,
    trends: summary.trends,
    alerts: summary.alerts,
  });

  console.log(`\nWrote automation status to ${toRelative(OUTPUT_JSON)}.`);
  console.log(`Wrote automation summary to ${toRelative(OUTPUT_MD)}.`);
  console.log(`Wrote automation history to ${toRelative(HISTORY_JSON)}.`);

  if (summary.failedStep) {
    process.exit(summary.failedStep.exitCode || 1);
  }

  console.log("\nCompleted the daily ingestion automation run.");
}

main();
