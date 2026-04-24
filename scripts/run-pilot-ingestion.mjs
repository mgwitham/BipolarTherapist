#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * One-command pilot ingestion runner.
 *
 *   npm run cms:ingest -- --city "San Francisco"
 *   npm run cms:ingest -- --city sf
 *
 * Flow:
 *   1. Resolve city (full name / alias / slug) → canonical entry + ZIP set
 *   2. Generate discovery prompt (existing generate-discovery-prompt.mjs)
 *   3. Run prompt against Anthropic API with web_search enabled
 *   4. Save raw output to /tmp/ingestion-<slug>-<iso>.md
 *   5. Extract fenced ```csv``` block → normalize to seed-CSV schema
 *   6. Archive any pre-existing seed CSV, then write the new one
 *   7. Validate (header shape, quality-heuristic warnings)
 *   8. Invoke existing cms:get-more-therapists pipeline
 *   9. Query Sanity for therapistCandidate docs created since start
 *  10. Archive the seed CSV off-repo and print summary
 *
 * Exported helpers (pure) are covered by tests in
 * test/scripts/ingestion-runner.test.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const CONFIG_PATH = path.join(REPO_ROOT, "config", "discovery-zips.json");
const SEED_CSV_PATH = path.join(REPO_ROOT, "data", "import", "therapist-source-seeds.csv");
const TMP_DIR = "/tmp";
const API_VERSION = "2026-04-02";
const ANTHROPIC_MODEL = "claude-opus-4-7";
const WEB_SEARCH_TOOL = "web_search_20250305";
const SEED_HEADERS = [
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

// ---------- pure helpers (exported for testing) ----------

export function loadCityConfig(configPath = CONFIG_PATH) {
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Missing discovery-zips config at ${configPath}. Create config/discovery-zips.json.`,
    );
  }
  const raw = fs.readFileSync(configPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `config/discovery-zips.json is not valid JSON: ${error && error.message ? error.message : error}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || !parsed.cities) {
    throw new Error(`config/discovery-zips.json must have a top-level "cities" object.`);
  }
  return parsed.cities;
}

export function resolveCity(rawInput, cities) {
  if (!rawInput || typeof rawInput !== "string") {
    throw new Error(`--city is required. Example: npm run cms:ingest -- --city "San Francisco"`);
  }
  const needle = rawInput.trim().toLowerCase();
  if (!needle) {
    throw new Error(`--city is required.`);
  }
  for (const [slug, entry] of Object.entries(cities)) {
    const aliases = new Set(
      [slug, entry.name, ...(entry.aliases || [])]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase()),
    );
    if (aliases.has(needle)) {
      if (!Array.isArray(entry.zips) || !entry.zips.length) {
        throw new Error(
          `City "${entry.name}" is configured without ZIPs. Add ZIPs in config/discovery-zips.json.`,
        );
      }
      return { slug, name: entry.name, zips: entry.zips.slice() };
    }
  }
  const known = Object.keys(cities).sort().join(", ");
  throw new Error(
    `City "${rawInput}" not configured. Add it to config/discovery-zips.json before ingesting. Known: ${known}`,
  );
}

export function slugifyCityName(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function timestampForFiles(now = new Date()) {
  // e.g. 2026-04-24T17-32-45Z — filesystem-safe ISO.
  return now
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/-\d{3}Z$/, "Z");
}

/**
 * Extract the first ```csv … ``` fenced block from an LLM response.
 * Returns null if not found.
 */
export function extractCsvBlock(text) {
  if (typeof text !== "string" || !text) return null;
  const match = text.match(/```csv\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  return match[1].trim();
}

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let insideQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];
    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }
    if (character === "," && !insideQuotes) {
      fields.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  fields.push(current);
  return fields;
}

export function parseDiscoveryCsv(csvText) {
  const lines = String(csvText || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.length > 0);
  if (!lines.length) {
    return { headers: [], rows: [] };
  }
  const headers = parseCsvLine(lines[0]).map((value) => value.trim());
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce((accumulator, header, index) => {
      accumulator[header] = (values[index] == null ? "" : String(values[index])).trim();
      return accumulator;
    }, {});
  });
  return { headers, rows };
}

function csvEscape(value) {
  const raw = String(value == null ? "" : value);
  if (!/[",\n]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

function inferSourceType(sourceUrl) {
  const url = String(sourceUrl || "").toLowerCase();
  if (!url) return "practice_website";
  if (
    /psychologytoday\.com|therapyden|zocdoc|headway|rula|grow[-.]?therapy|goodtherapy|alma/.test(
      url,
    )
  ) {
    return "aggregator_profile";
  }
  return "practice_website";
}

/**
 * Normalize a discovery-prompt CSV row (richer schema) to a seed CSV row
 * (the schema that scripts/discover-therapist-candidates.mjs expects).
 * Extra fields get folded into `notes` so provenance is not lost.
 */
export function normalizeRowToSeedSchema(row) {
  const extraNoteParts = [];
  const foldedFields = [
    "availabilityPosture",
    "waitlistWeeks",
    "prescribingMode",
    "crisisPosture",
    "sourcingConfidence",
    "bipolarEvidenceQuote",
  ];
  foldedFields.forEach((field) => {
    if (row[field]) extraNoteParts.push(`${field}: ${row[field]}`);
  });
  const baseNotes = row.clinicalNotes || row.notes || "";
  const notes = [baseNotes, ...extraNoteParts].filter(Boolean).join(" | ");

  return {
    sourceUrl: row.sourceUrl || "",
    sourceType: inferSourceType(row.sourceUrl),
    name: row.name || "",
    credentials: row.credentials || "",
    title: "",
    practiceName: row.practiceName || "",
    city: row.city || "",
    state: row.state || "CA",
    zip: row.zip || "",
    country: "US",
    licenseState: row.licenseState || "CA",
    licenseNumber: row.licenseNumber || "",
    email: row.email || "",
    phone: row.phone || "",
    website: row.website || "",
    bookingUrl: row.bookingUrl || "",
    supportingSourceUrls: "",
    clientPopulations: row.clientPopulations || "",
    insuranceAccepted: row.insuranceAccepted || "",
    telehealthStates: row.telehealthStates || "",
    estimatedWaitTime: "",
    sessionFeeMin: row.sessionFeeMin || "",
    sessionFeeMax: row.sessionFeeMax || "",
    slidingScale: "false",
    notes,
  };
}

export function rowsToSeedCsv(rows) {
  const lines = [SEED_HEADERS.join(",")];
  rows.forEach((row) => {
    lines.push(SEED_HEADERS.map((header) => csvEscape(row[header] || "")).join(","));
  });
  return `${lines.join("\n")}\n`;
}

/**
 * Heuristic quality scan. Returns an array of warning objects.
 * Does NOT filter rows — the downstream discover/verify steps make the
 * final call. This just surfaces "eyeball these" signals.
 */
export function qualityScan(rows) {
  const warnings = [];
  const placeholderPhonePatterns = [
    /^[^\d]*0{3}[^\d]*0{3}[^\d]*0{4}[^\d]*$/,
    /555[-.\s]?01\d{2}/,
    /^(\d)\1{9}$/,
  ];
  const aggregatorHosts = [
    "psychologytoday.com",
    "therapyden.com",
    "zocdoc.com",
    "headway.co",
    "rula.com",
    "growtherapy.com",
    "goodtherapy.org",
    "helloalma.com",
  ];
  rows.forEach((row, index) => {
    const rowLabel = `row ${index + 1} (${row.name || "<unnamed>"})`;
    const phoneDigits = String(row.phone || "").replace(/\D/g, "");
    if (
      phoneDigits &&
      placeholderPhonePatterns.some((pattern) => pattern.test(row.phone || phoneDigits))
    ) {
      warnings.push({
        row: index + 1,
        field: "phone",
        message: `${rowLabel}: phone "${row.phone}" looks like a placeholder`,
      });
    }
    if (phoneDigits && phoneDigits.length !== 10 && phoneDigits.length !== 11) {
      warnings.push({
        row: index + 1,
        field: "phone",
        message: `${rowLabel}: phone "${row.phone}" has unusual digit count (${phoneDigits.length})`,
      });
    }
    if (
      String(row.city || "")
        .trim()
        .toLowerCase() === "california"
    ) {
      warnings.push({
        row: index + 1,
        field: "city",
        message: `${rowLabel}: city is "California" — should be the office city or blank`,
      });
    }
    const sourceUrlLower = String(row.sourceUrl || "").toLowerCase();
    const host = (sourceUrlLower.match(/^https?:\/\/(?:www\.)?([^/]+)/) || [])[1] || "";
    if (host && aggregatorHosts.includes(host)) {
      // Per-clinician aggregator profiles almost always carry a numeric
      // identifier (PT: /therapists/<slug>/<id>) or an obvious profile
      // prefix. Treat anything without one of those markers as a listing.
      const hasNumericProfileId = /\/\d{4,}(?:\/|$|\?)/.test(sourceUrlLower);
      const hasProfilePrefix = /\/(profile|pros|providers|members)\/[^/]+/.test(sourceUrlLower);
      const looksLikeListing = !hasNumericProfileId && !hasProfilePrefix;
      if (looksLikeListing) {
        warnings.push({
          row: index + 1,
          field: "sourceUrl",
          message: `${rowLabel}: sourceUrl "${row.sourceUrl}" looks like an aggregator listing page, not a per-clinician profile`,
        });
      }
    }
    if (!row.licenseNumber) {
      const notes = String(row.notes || "").toLowerCase();
      if (!notes.includes("needs license lookup")) {
        warnings.push({
          row: index + 1,
          field: "licenseNumber",
          message: `${rowLabel}: missing licenseNumber and no "Needs license lookup" tag in notes`,
        });
      }
    }
  });
  return warnings;
}

export function buildSystemPrompt() {
  return [
    "You are a senior sourcing analyst running a therapist-discovery task.",
    "Follow the user prompt exactly — including fenced-block output contract.",
    "Use web search aggressively before emitting any candidate.",
    "Return the trace, csv, rejections, and search_log blocks as specified.",
  ].join(" ");
}

// ---------- I/O side-effects ----------

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
  const rootEnv = readEnvFile(path.join(REPO_ROOT, ".env"));
  const studioEnv = readEnvFile(path.join(REPO_ROOT, "studio", ".env"));
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

function getAnthropicKey() {
  const rootEnv = readEnvFile(path.join(REPO_ROOT, ".env"));
  return process.env.ANTHROPIC_API_KEY || rootEnv.ANTHROPIC_API_KEY || "";
}

function parseArgs(argv) {
  const options = { city: "", dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if ((arg === "--city" || arg === "-c") && next) {
      options.city = String(next).trim();
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: npm run cms:ingest -- --city "<name-or-alias>" [--dry-run]

Examples:
  npm run cms:ingest -- --city "San Francisco"
  npm run cms:ingest -- --city sf
  npm run cms:ingest -- --city sf --dry-run    # skip the Sanity import step

Cities live in config/discovery-zips.json. Add a new one by appending an
entry there with { name, aliases, zips } — no code changes needed.
`);
}

function runNodeScript(label, scriptPath, args, { captureStdout = false } = {}) {
  console.log(`\n[${label}] node ${path.relative(REPO_ROOT, scriptPath)} ${args.join(" ")}`);
  const result = spawnSync("node", [scriptPath, ...args], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: captureStdout ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status || 1}.`);
  }
  return result;
}

function generateDiscoveryPrompt({ cityName, zips, outPath }) {
  const script = path.join(REPO_ROOT, "scripts", "generate-discovery-prompt.mjs");
  runNodeScript("generate-discovery-prompt", script, [
    "--city",
    cityName,
    "--zips",
    zips.join(","),
    "--out",
    outPath,
  ]);
  const body = fs.readFileSync(outPath, "utf8");
  const dividerIndex = body.indexOf("\n---\n");
  const prompt = dividerIndex >= 0 ? body.slice(dividerIndex + 5).trim() : body;
  if (!prompt) {
    throw new Error(`Generated discovery prompt is empty: ${outPath}`);
  }
  return prompt;
}

async function callAnthropicWithWebSearch({ prompt, apiKey, model = ANTHROPIC_MODEL }) {
  // Lazy import so tests and --dry-run don't require the SDK present.
  let Anthropic;
  try {
    ({ default: Anthropic } = await import("@anthropic-ai/sdk"));
  } catch (error) {
    throw new Error(
      `Missing @anthropic-ai/sdk. Run \`npm install\` to pick up the new dependency. (${error.message})`,
    );
  }
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    system: buildSystemPrompt(),
    tools: [{ type: WEB_SEARCH_TOOL, name: "web_search", max_uses: 25 }],
    messages: [{ role: "user", content: prompt }],
  });
  const textBlocks = (response.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text);
  return textBlocks.join("\n\n");
}

function archiveIfExists(srcPath, archiveDir, archiveName) {
  if (!fs.existsSync(srcPath)) return null;
  const destPath = path.join(archiveDir, archiveName);
  fs.copyFileSync(srcPath, destPath);
  fs.unlinkSync(srcPath);
  return destPath;
}

async function queryRecentCandidates({ sinceIso }) {
  const config = getSanityConfig();
  if (!config.projectId || !config.dataset) {
    console.warn("Skipping Sanity verification (missing project/dataset config).");
    return [];
  }
  const { createClient } = await import("@sanity/client");
  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token || undefined,
    useCdn: !config.token,
  });
  const query = `*[_type == "therapistCandidate" && _createdAt > $since] | order(_createdAt desc){
    name, "slug": slug.current, _createdAt
  }`;
  return client.fetch(query, { since: sinceIso });
}

async function runIngestion(rawCityInput, { dryRun = false } = {}) {
  const cities = loadCityConfig();
  const resolved = resolveCity(rawCityInput, cities);
  const citySlug = slugifyCityName(resolved.name);
  const runStamp = timestampForFiles();
  const runStartIso = new Date().toISOString();

  console.log(`Resolved city: ${resolved.name} (${resolved.zips.length} ZIPs)`);

  const promptOutPath = path.join(TMP_DIR, `ingestion-${citySlug}-${runStamp}-prompt.md`);
  const prompt = generateDiscoveryPrompt({
    cityName: resolved.name,
    zips: resolved.zips,
    outPath: promptOutPath,
  });

  const apiKey = getAnthropicKey();
  if (!apiKey) {
    throw new Error(
      `Missing ANTHROPIC_API_KEY. Add it to .env or export it before running cms:ingest.`,
    );
  }

  console.log(`\nCalling Anthropic (${ANTHROPIC_MODEL}) with web_search enabled…`);
  const rawOutput = await callAnthropicWithWebSearch({ prompt, apiKey });
  const outputPath = path.join(TMP_DIR, `ingestion-${citySlug}-${runStamp}.md`);
  fs.writeFileSync(outputPath, rawOutput, "utf8");
  console.log(`Agent output saved: ${outputPath}`);

  const csvText = extractCsvBlock(rawOutput);
  if (!csvText) {
    throw new Error(
      `Could not find a \`\`\`csv\`\`\` fenced block in agent output. See ${outputPath}.`,
    );
  }
  const { headers, rows } = parseDiscoveryCsv(csvText);
  const missingHeaders = ["sourceUrl", "name", "licenseNumber"].filter(
    (header) => !headers.includes(header),
  );
  if (missingHeaders.length) {
    throw new Error(
      `Discovery CSV missing required headers: ${missingHeaders.join(", ")}. See ${outputPath}.`,
    );
  }
  console.log(`Agent accepted ${rows.length} candidate(s).`);

  const warnings = qualityScan(rows);
  if (warnings.length) {
    console.log(`\nQuality-scan warnings (${warnings.length}) — not filtered, just flagged:`);
    warnings.forEach((warning) => console.log(`  - ${warning.message}`));
  } else {
    console.log("Quality scan: no obvious issues.");
  }

  const seedRows = rows.map(normalizeRowToSeedSchema);
  const seedCsv = rowsToSeedCsv(seedRows);

  const archivedSeed = archiveIfExists(
    SEED_CSV_PATH,
    TMP_DIR,
    `ingestion-${citySlug}-${runStamp}-preexisting-seed.csv`,
  );
  if (archivedSeed) {
    console.log(`Archived pre-existing seed CSV → ${archivedSeed}`);
  }
  fs.mkdirSync(path.dirname(SEED_CSV_PATH), { recursive: true });
  fs.writeFileSync(SEED_CSV_PATH, seedCsv, "utf8");
  console.log(`Wrote ${seedRows.length} seed row(s) → ${path.relative(REPO_ROOT, SEED_CSV_PATH)}`);

  let ingestedCount = 0;
  let newRecords = [];
  if (dryRun) {
    console.log("\n--dry-run: skipping cms:get-more-therapists + Sanity verification.");
  } else {
    runNodeScript(
      "cms:get-more-therapists",
      path.join(REPO_ROOT, "scripts", "get-more-therapists.mjs"),
      [SEED_CSV_PATH],
    );
    newRecords = await queryRecentCandidates({ sinceIso: runStartIso });
    ingestedCount = newRecords.length;
  }

  const archivedCsvPath = path.join(TMP_DIR, `ingestion-${citySlug}-${runStamp}-archived.csv`);
  if (fs.existsSync(SEED_CSV_PATH)) {
    fs.copyFileSync(SEED_CSV_PATH, archivedCsvPath);
    fs.unlinkSync(SEED_CSV_PATH);
  }

  const summaryLines = [
    "",
    "===",
    `Ingestion complete: ${resolved.name}`,
    `Agent accepted: ${rows.length} candidates`,
    `Successfully ingested: ${ingestedCount}`,
    `Rejected by validators: ${rows.length - ingestedCount}`,
    `Quality warnings: ${warnings.length}`,
    `New review-queue records:`,
    ...(newRecords.length
      ? newRecords.map((record) => `  - ${record.name} (${record.slug})`)
      : ["  (none found — check Sanity directly if you expected some)"]),
    `Audit log: ${outputPath}`,
    `Archived seed CSV: ${archivedCsvPath}`,
    "===",
    `Next step: review at https://www.bipolartherapyhub.com/admin.html (Candidate Review Queue tab)`,
    "",
  ];
  console.log(summaryLines.join("\n"));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  try {
    await runIngestion(options.city, { dryRun: options.dryRun });
  } catch (error) {
    console.error(`\nIngestion failed: ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  }
}

const invokedDirectly = fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main();
}
