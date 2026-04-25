import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const DEFAULT_LABEL = "Bipolar disorder";
const OUTPUT_MD = path.join(ROOT, "data", "import", "generated-bipolar-specialty-fill.md");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return acc;
      const sep = trimmed.indexOf("=");
      if (sep === -1) return acc;
      acc[trimmed.slice(0, sep).trim()] = trimmed.slice(sep + 1).trim();
      return acc;
    }, {});
}

function getConfig() {
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

function parseArgs(argv) {
  const options = { dryRun: false, label: DEFAULT_LABEL };
  argv.forEach((arg) => {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--label=")) options.label = arg.split("=")[1] || DEFAULT_LABEL;
    else if (arg === "--help" || arg === "-h") options.help = true;
  });
  return options;
}

function printHelp() {
  console.log(`Ensure every therapist lists a bipolar specialty.

Walks all therapist documents, checks whether any entry in specialties contains
"bipolar" (case-insensitive), and adds "${DEFAULT_LABEL}" to those that don't.
Existing specialties (including "Bipolar I" / "Bipolar II" / etc.) are never
removed or duplicated.

Usage:
  node scripts/ensure-bipolar-specialty.mjs [--dry-run] [--label="Bipolar disorder"]

Flags:
  --dry-run   Preview which therapists would be updated without writing.
  --label     Override the specialty label to add (default "${DEFAULT_LABEL}").
`);
}

function hasBipolarSpecialty(specialties) {
  if (!Array.isArray(specialties)) return false;
  return specialties.some((value) => /bipolar/i.test(String(value || "")));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    console.error(
      "Missing Sanity project id or dataset. Set VITE_SANITY_PROJECT_ID / VITE_SANITY_DATASET.",
    );
    process.exit(1);
  }
  if (!options.dryRun && !config.token) {
    console.error("SANITY_API_TOKEN required for writes. Use --dry-run to preview.");
    process.exit(1);
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token,
    useCdn: false,
  });

  const therapists = await client.fetch(
    `*[_type == "therapist"]{ _id, name, "slug": slug.current, specialties }`,
  );

  const skipped = [];
  const updated = [];
  const now = new Date().toISOString();

  for (const doc of therapists) {
    if (hasBipolarSpecialty(doc.specialties)) {
      skipped.push(doc);
      continue;
    }
    const nextSpecialties = Array.isArray(doc.specialties) ? doc.specialties.slice() : [];
    nextSpecialties.push(options.label);
    if (!options.dryRun) {
      await client
        .patch(doc._id)
        .set({ specialties: nextSpecialties })
        .commit({ visibility: "async" });
    }
    updated.push({ id: doc._id, name: doc.name, slug: doc.slug });
  }

  fs.mkdirSync(path.dirname(OUTPUT_MD), { recursive: true });
  const lines = [
    "# Bipolar specialty fill",
    "",
    `Generated: ${now}`,
    `Mode: ${options.dryRun ? "Dry run" : "Write mode"}`,
    `Label added: ${options.label}`,
    "",
    "## Summary",
    "",
    `- Therapists inspected: ${therapists.length}`,
    `- Already listed a bipolar specialty: ${skipped.length}`,
    `- Updated to add "${options.label}": ${updated.length}`,
    "",
    "## Updated",
    "",
  ];
  updated.slice(0, 200).forEach((row) => {
    lines.push(`- ${row.name || row.id}${row.slug ? ` (${row.slug})` : ""}`);
  });
  fs.writeFileSync(OUTPUT_MD, lines.join("\n"), "utf8");

  console.log(
    `Bipolar-specialty pass complete. inspected=${therapists.length} skipped=${skipped.length} updated=${updated.length} ${options.dryRun ? "(dry run)" : ""}`,
  );
  console.log(`Report: ${path.relative(ROOT, OUTPUT_MD)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
