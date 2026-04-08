import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_JSON = path.join(ROOT, "data", "import", "generated-ingestion-automation-status.json");
const OUTPUT_MD = path.join(ROOT, "data", "import", "generated-ingestion-automation-status.md");

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
    "## Steps",
    "",
  ];

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
    lines.push(
      "- Open the admin operations inbox and work the highest-priority publish, duplicate, confirmation, and refresh items.",
    );
    lines.push(
      "- Use the updated sourcing recommendations and generated seed CSV to start the next acquisition wave if coverage is the current bottleneck.",
    );
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
  const summary = {
    status: results.every(function (step) {
      return step.ok;
    })
      ? "ok"
      : "failed",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    totalSteps: steps.length,
    successfulSteps: results.filter(function (step) {
      return step.ok;
    }).length,
    steps: results,
    failedStep:
      results.find(function (step) {
        return !step.ok;
      }) || null,
  };

  ensureDir(OUTPUT_JSON);
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(summary, null, 2) + "\n", "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(summary) + "\n", "utf8");

  console.log(`\nWrote automation status to ${toRelative(OUTPUT_JSON)}.`);
  console.log(`Wrote automation summary to ${toRelative(OUTPUT_MD)}.`);

  if (summary.failedStep) {
    process.exit(summary.failedStep.exitCode || 1);
  }

  console.log("\nCompleted the daily ingestion automation run.");
}

main();
