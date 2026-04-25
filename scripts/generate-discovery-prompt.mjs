#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

import {
  buildExclusionBlock,
  buildPriorQueriesBlock,
  buildZipsPhrase,
  extractSearchQueriesFromAgentOutput,
  normalizeZips,
  renderDiscoveryPrompt,
} from "../shared/discovery-prompt-domain.mjs";

const ROOT = process.cwd();
const TEMPLATE_PATH = path.join(ROOT, "docs", "discovery-prompt.template.txt");
const DEFAULT_OUT_PATH = path.join(ROOT, "data", "import", "generated-discovery-prompt.md");
const DEFAULT_COUNT = 10;
const API_VERSION = "2026-04-02";

function parseArgs(argv) {
  const options = {
    city: "",
    zips: "",
    count: DEFAULT_COUNT,
    out: DEFAULT_OUT_PATH,
    skipExclusions: false,
    skipPriorQueries: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--city" && next) {
      options.city = String(next).trim();
      index += 1;
    } else if (arg === "--zips" && next) {
      options.zips = String(next).trim();
      index += 1;
    } else if (arg === "--count" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 100) {
        options.count = Math.floor(parsed);
      }
      index += 1;
    } else if (arg === "--out" && next) {
      options.out = path.isAbsolute(next) ? next : path.resolve(ROOT, next);
      index += 1;
    } else if (arg === "--no-exclusions") {
      options.skipExclusions = true;
    } else if (arg === "--no-prior-queries") {
      options.skipPriorQueries = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/generate-discovery-prompt.mjs --city <name> --zips <csv> [--count N] [--out path] [--no-exclusions] [--no-prior-queries]

Required:
  --city "Pasadena"            California city or metro name
  --zips "91101,91103,91105"   Comma-separated CA ZIP codes

Optional:
  --count 10                   How many candidate rows to request (1-100, default 10)
  --out path/to/file.md        Where to write the prompt (default: data/import/generated-discovery-prompt.md)
  --no-exclusions              Skip the Sanity query for already-known clinicians
  --no-prior-queries           Skip the auto-load of prior queries from /tmp agent-output files

Example:
  npm run cms:discovery-prompt -- --city "Pasadena" --zips "91101,91103,91105" --count 10
`);
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((accumulator, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return accumulator;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) return accumulator;
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      accumulator[key] = value;
      return accumulator;
    }, {});
}

function getSanityConfig() {
  const rootEnv = readEnvFile(path.join(ROOT, ".env"));
  const studioEnv = readEnvFile(path.join(ROOT, "studio", ".env"));
  return {
    projectId:
      process.env.SANITY_PROJECT_ID ||
      process.env.VITE_SANITY_PROJECT_ID ||
      rootEnv.VITE_SANITY_PROJECT_ID ||
      studioEnv.SANITY_STUDIO_PROJECT_ID,
    dataset:
      process.env.SANITY_DATASET ||
      process.env.VITE_SANITY_DATASET ||
      rootEnv.VITE_SANITY_DATASET ||
      studioEnv.SANITY_STUDIO_DATASET,
    apiVersion: process.env.SANITY_API_VERSION || rootEnv.VITE_SANITY_API_VERSION || API_VERSION,
    token:
      process.env.SANITY_API_TOKEN || rootEnv.SANITY_API_TOKEN || studioEnv.SANITY_API_TOKEN || "",
  };
}

async function fetchExistingClinicians() {
  const config = getSanityConfig();
  if (!config.projectId || !config.dataset) {
    return { ok: false, reason: "missing Sanity project config" };
  }
  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token || undefined,
    useCdn: !config.token,
  });
  const query = `{
    "therapists": *[_type == "therapist"]{ name, city, licenseNumber, website, "source": sourceUrl },
    "candidates": *[_type == "therapistCandidate"]{ name, city, licenseNumber, website, "source": sourceUrl },
    "applications": *[_type == "therapistApplication"]{ name, city, licenseNumber, website }
  }`;
  const result = await client.fetch(query);
  return { ok: true, ...result };
}

function citySlug(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Auto-load queries from any prior agent-output files for this city
 * sitting in /tmp (the canonical save location for paste-flow runs).
 * Returns a deduped list; empty if no prior runs exist or /tmp is not
 * accessible. Failure is silent so a missing /tmp doesn't block prompt
 * generation.
 */
function loadPriorQueriesFromTmp(slug) {
  const tmpDir = "/tmp";
  if (!slug || !fs.existsSync(tmpDir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(tmpDir);
  } catch (_error) {
    return [];
  }
  const pattern = new RegExp(`^ingestion-${slug}-.*-agent-output\\.md$`);
  const matches = entries.filter((name) => pattern.test(name));
  const queries = [];
  for (const file of matches) {
    try {
      const text = fs.readFileSync(path.join(tmpDir, file), "utf8");
      queries.push(...extractSearchQueriesFromAgentOutput(text));
    } catch (_error) {
      // best-effort; ignore unreadable files
    }
  }
  return queries;
}

function buildOutputFile(prompt, options) {
  const today = new Date().toISOString().slice(0, 10);
  return `# Discovery prompt: ${options.city}

Generated: ${today}
City: ${options.city}
ZIPs: ${options.zipsDisplay}
Target count: ${options.count}
Known-clinician exclusions: ${options.exclusionCount}
Prior queries to avoid: ${options.priorQueryCount || 0}

Copy everything below the divider and paste it into an LLM with web
search enabled (Claude, ChatGPT, etc.). Save the CSV response to
data/import/therapist-source-seeds.csv, then run:

    npm run cms:get-more-therapists

---

${prompt}`;
}

function loadTemplate() {
  return fs.readFileSync(TEMPLATE_PATH, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.city) {
    console.error("Error: --city is required.\n");
    printHelp();
    process.exit(1);
  }
  const { zips, invalid } = normalizeZips(options.zips);
  if (!zips.length) {
    console.error("Error: --zips is required and must contain at least one 5-digit ZIP code.\n");
    printHelp();
    process.exit(1);
  }
  if (invalid.length) {
    console.error(`Error: these ZIPs are not 5 digits: ${invalid.join(", ")}`);
    process.exit(1);
  }

  let exclusionBlock = "";
  let exclusionCount = 0;
  if (!options.skipExclusions) {
    try {
      const clinicians = await fetchExistingClinicians();
      if (clinicians.ok) {
        exclusionBlock = buildExclusionBlock(clinicians);
        const rowCount = (exclusionBlock.match(/^- /gm) || []).length;
        exclusionCount = rowCount;
        if (rowCount > 0) {
          console.log(`Loaded ${rowCount} existing clinicians as exclusions.`);
        } else {
          console.log("No existing clinicians found to exclude.");
        }
      } else {
        console.warn(`Skipping exclusions: ${clinicians.reason}. Use --no-exclusions to silence.`);
      }
    } catch (error) {
      console.warn(`Skipping exclusions (Sanity fetch failed): ${error.message}`);
    }
  }

  const slug = citySlug(options.city);
  const priorQueries = options.skipPriorQueries ? [] : loadPriorQueriesFromTmp(slug);
  const priorQueriesBlock = options.skipPriorQueries ? "" : buildPriorQueriesBlock(priorQueries);
  if (!options.skipPriorQueries) {
    if (priorQueries.length) {
      console.log(
        `Loaded ${priorQueries.length} prior search queries from /tmp agent-output files for "${options.city}".`,
      );
    } else {
      console.log(`No prior runs found for "${options.city}" — first-run query rotation.`);
    }
  }

  const template = loadTemplate();
  const prompt = renderDiscoveryPrompt(template, {
    city: options.city,
    zipsPhrase: buildZipsPhrase(zips),
    count: options.count,
    exclusionBlock,
    priorQueriesBlock,
  });
  const fileBody = buildOutputFile(prompt, {
    city: options.city,
    zipsDisplay: zips.length ? zips.join(", ") : "(none specified)",
    count: options.count,
    exclusionCount,
    priorQueryCount: priorQueries.length,
  });

  const outDir = path.dirname(options.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(options.out, fileBody, "utf8");

  console.log(`Discovery prompt written to ${path.relative(ROOT, options.out)}`);
  console.log("Open it, copy everything below the --- divider, paste into an LLM with web search.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
