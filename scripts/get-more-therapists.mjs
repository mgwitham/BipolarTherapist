import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const DEFAULT_INPUT_PATH = path.join(ROOT, "data", "import", "therapist-source-seeds.csv");
const DISCOVERED_CSV_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-discovered-therapist-candidates.csv",
);
const REVIEW_QUEUE_MD_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-candidate-review-queue.md",
);

function resolveInputPath(raw) {
  if (!raw) {
    return DEFAULT_INPUT_PATH;
  }
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT, raw);
}

function parseArgs(argv) {
  const options = {
    inputPath: DEFAULT_INPUT_PATH,
    skipImport: false,
    skipQueue: false,
  };

  argv.forEach((arg) => {
    if (arg === "--discover-only") {
      options.skipImport = true;
      options.skipQueue = true;
      return;
    }
    if (arg === "--skip-import") {
      options.skipImport = true;
      return;
    }
    if (arg === "--skip-queue") {
      options.skipQueue = true;
      return;
    }
    if (!arg.startsWith("--")) {
      options.inputPath = resolveInputPath(arg);
    }
  });

  return options;
}

function runStep(label, command, args) {
  console.log(`\n[${label}] ${command} ${args.join(" ")}`.trim());
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status || 1}.`);
  }
}

function printSummary(options) {
  console.log("\nTherapist sourcing workflow complete.");
  console.log(`- Source seed CSV: ${path.relative(ROOT, options.inputPath)}`);
  console.log(`- Discovered candidates CSV: ${path.relative(ROOT, DISCOVERED_CSV_PATH)}`);
  if (!options.skipQueue) {
    console.log(`- Review queue summary: ${path.relative(ROOT, REVIEW_QUEUE_MD_PATH)}`);
  }
  console.log("");
  console.log("Recommended next move:");
  if (options.skipImport) {
    console.log(
      "- Review the generated candidate CSV, then run `npm run cms:import:candidates -- data/import/generated-discovered-therapist-candidates.csv`.",
    );
  } else if (options.skipQueue) {
    console.log(
      "- Review imported candidates in Studio or run `npm run cms:generate:candidate-review-queue`.",
    );
  } else {
    console.log(
      "- Open the admin Candidate Review Queue and work through publish / duplicate / confirmation decisions.",
    );
  }
}

function run() {
  const options = parseArgs(process.argv.slice(2));

  runStep("Discover candidates", "node", [
    "scripts/discover-therapist-candidates.mjs",
    options.inputPath,
  ]);

  runStep("Resolve and verify licenses via NPI", "node", [
    "scripts/verify-candidate-licenses.mjs",
    DISCOVERED_CSV_PATH,
    "--out",
    DISCOVERED_CSV_PATH,
  ]);

  if (!options.skipImport) {
    runStep("Import candidates", "node", [
      "scripts/import-therapist-candidates.mjs",
      DISCOVERED_CSV_PATH,
    ]);
  }

  if (!options.skipQueue) {
    runStep("Generate review queue", "node", ["scripts/generate-candidate-review-queue.mjs"]);
  }

  // Advisory coverage report. Looks for the most recent
  // /tmp/ingestion-*-agent-output.md and prints how the run's
  // search_log measured against the 5-bucket Query Diversity Mandate.
  // Best-effort — never fails the pipeline.
  try {
    runStep("Report search coverage", "node", ["scripts/report-search-coverage.mjs"]);
  } catch (error) {
    console.warn(`(coverage report skipped: ${error && error.message ? error.message : error})`);
  }

  printSummary(options);
}

try {
  run();
} catch (error) {
  console.error(error && error.message ? error.message : "Therapist sourcing workflow failed.");
  process.exit(1);
}
