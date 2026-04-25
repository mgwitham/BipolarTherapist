#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Print a coverage report for a discovery run's search_log against the
 * 5-bucket Query Diversity Mandate (see docs/discovery-prompt.template.txt).
 *
 *   npm run cms:report:search-coverage                         # most recent /tmp/*-agent-output.md
 *   npm run cms:report:search-coverage -- --city san-francisco # most recent for a specific city
 *   npm run cms:report:search-coverage -- --from /tmp/foo.md   # explicit file
 *
 * Best-effort: if no agent-output file exists (paste-flow runs that
 * didn't save the full LLM response), prints "(no agent-output found)"
 * and exits 0. Never blocks the import pipeline — coverage is advisory.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  SEARCH_BUCKET_FLOORS,
  SEARCH_BUCKET_LABELS,
  bucketizeSearchLog,
  evaluateSearchCoverage,
} from "../shared/discovery-prompt-domain.mjs";

const TMP_DIR = "/tmp";

function parseArgs(argv) {
  const flags = { city: "", from: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--city" && next) {
      flags.city = String(next).trim().toLowerCase();
      index += 1;
    } else if (arg === "--from" && next) {
      flags.from = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      flags.help = true;
    }
  }
  return flags;
}

function printHelp() {
  console.log(`Usage: node scripts/report-search-coverage.mjs [--city <slug>] [--from <path>]

Prints a 5-bucket coverage report for a discovery run's search_log.

Options:
  --city <slug>   Most recent /tmp/ingestion-<slug>-*-agent-output.md
                  (slug example: san-francisco, oakland, los-angeles)
  --from <path>   Read coverage from this exact file
  (no flags)      Most recent /tmp/ingestion-*-agent-output.md

Coverage is advisory — this script never blocks pipeline runs. Use it
to spot lazy or unbalanced searches and queue follow-up runs against
under-covered buckets.
`);
}

function findMostRecentAgentOutput(citySlug) {
  if (!fs.existsSync(TMP_DIR)) return null;
  let entries;
  try {
    entries = fs.readdirSync(TMP_DIR);
  } catch (_error) {
    return null;
  }
  const pattern = citySlug
    ? new RegExp(`^ingestion-${citySlug}-.*-agent-output\\.md$`)
    : /^ingestion-.*-agent-output\.md$/;
  const matches = entries
    .filter((name) => pattern.test(name))
    .map((name) => {
      const fullPath = path.join(TMP_DIR, name);
      try {
        return { fullPath, mtime: fs.statSync(fullPath).mtimeMs };
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  return matches[0] ? matches[0].fullPath : null;
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function renderReport(filePath, counts, evaluation) {
  const lines = [];
  lines.push(`Search coverage (from ${filePath}):`);
  for (const bucket of ["A", "B", "C", "D", "E"]) {
    const floor = SEARCH_BUCKET_FLOORS[bucket];
    const actual = counts[bucket] || 0;
    const ok = actual >= floor;
    const label = SEARCH_BUCKET_LABELS[bucket];
    lines.push(
      `  [${bucket}] ${pad(label, 22)} ${pad(actual + " queries", 14)}${ok ? "✓" : "✗ (floor: " + floor + ")"}`,
    );
  }
  lines.push(
    `  Total: ${counts.total} queries (≥${8} minimum: ${evaluation.meetsTotal ? "✓" : "✗"})`,
  );
  if (counts.unbucketed) {
    lines.push(
      `  Unbucketed: ${counts.unbucketed} (lines without [A]-[E] prefix — agent didn't tag them)`,
    );
  }
  lines.push(`  Coverage: ${evaluation.bucketsMet}/5 buckets met`);
  if (evaluation.missingBuckets.length) {
    const recommendations = evaluation.missingBuckets.map(
      (entry) => `≥${entry.floor - entry.actual} more [${entry.bucket}] ${entry.label}`,
    );
    lines.push(`  Action: schedule a follow-up run with ${recommendations.join(", ")}.`);
  } else {
    lines.push("  Action: none — all buckets covered.");
  }
  return lines.join("\n");
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }

  let filePath;
  if (flags.from) {
    filePath = path.isAbsolute(flags.from) ? flags.from : path.resolve(process.cwd(), flags.from);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: --from path does not exist: ${filePath}`);
      process.exit(1);
    }
  } else {
    filePath = findMostRecentAgentOutput(flags.city);
    if (!filePath) {
      const where = flags.city ? `for city "${flags.city}"` : "in /tmp";
      console.log(`(No agent-output file found ${where}; coverage report skipped.)`);
      console.log("If you ran a paste-flow discovery, save the full LLM response to");
      console.log("  /tmp/ingestion-<city-slug>-<timestamp>-agent-output.md");
      console.log("and re-run this script to see coverage.");
      return;
    }
  }

  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    console.error(`Error reading ${filePath}: ${error.message || error}`);
    process.exit(1);
  }
  const counts = bucketizeSearchLog(text);
  const evaluation = evaluateSearchCoverage(counts);
  console.log(renderReport(filePath, counts, evaluation));
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main();
}
