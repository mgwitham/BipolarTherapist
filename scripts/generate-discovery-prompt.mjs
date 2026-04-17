#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const TEMPLATE_PATH = path.join(ROOT, "docs", "discovery-prompt.template.txt");
const DEFAULT_OUT_PATH = path.join(ROOT, "data", "import", "generated-discovery-prompt.md");
const DEFAULT_COUNT = 10;

function parseArgs(argv) {
  const options = { city: "", zips: "", count: DEFAULT_COUNT, out: DEFAULT_OUT_PATH };
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
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/generate-discovery-prompt.mjs --city <name> --zips <csv> [--count N] [--out path]

Required:
  --city "Pasadena"            California city or metro name
  --zips "91101,91103,91105"   Comma-separated CA ZIP codes

Optional:
  --count 10                   How many candidate rows to request (1-100, default 10)
  --out path/to/file.md        Where to write the prompt (default: data/import/generated-discovery-prompt.md)

Example:
  npm run cms:discovery-prompt -- --city "Pasadena" --zips "91101,91103,91105" --count 10
`);
}

function loadTemplate() {
  return fs.readFileSync(TEMPLATE_PATH, "utf8");
}

function normalizeZips(raw) {
  const zips = String(raw || "")
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const unique = Array.from(new Set(zips));
  const invalid = unique.filter((zip) => !/^\d{5}$/.test(zip));
  return { zips: unique, invalid };
}

function renderPrompt(template, options) {
  return template
    .replaceAll("{CITY}", options.city)
    .replaceAll("{ZIPS}", options.zipsDisplay)
    .replaceAll("{N}", String(options.count));
}

function buildOutputFile(prompt, options) {
  const today = new Date().toISOString().slice(0, 10);
  return `# Discovery prompt: ${options.city}

Generated: ${today}
City: ${options.city}
ZIPs: ${options.zipsDisplay}
Target count: ${options.count}

Copy everything below the divider and paste it into an LLM with web
search enabled (Claude, ChatGPT, etc.). Save the CSV response to
data/import/therapist-source-seeds.csv, then run:

    npm run cms:get-more-therapists

---

${prompt}`;
}

function main() {
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

  const template = loadTemplate();
  const prompt = renderPrompt(template, {
    city: options.city,
    zipsDisplay: zips.join(", "),
    count: options.count,
  });
  const fileBody = buildOutputFile(prompt, {
    city: options.city,
    zipsDisplay: zips.join(", "),
    count: options.count,
  });

  const outDir = path.dirname(options.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(options.out, fileBody, "utf8");

  console.log(`Discovery prompt written to ${path.relative(ROOT, options.out)}`);
  console.log("Open it, copy everything below the --- divider, paste into an LLM with web search.");
}

main();
