// Reads an LLM-produced JSON file of email findings, validates each one
// against the actual Sanity records, and writes the high-confidence ones
// to the therapist documents.
//
// Dry-run by default:
//   npm run cms:apply:email-discovery
// Commit:
//   npm run cms:apply:email-discovery:write
//
// Threshold defaults to 70 (matches the scraper). Override with
// --threshold=N. Override the input path with --input=path/to/file.json.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const DEFAULT_INPUT = path.join(ROOT, "data", "import", "email-discovery-response.json");
const OUTPUT_CSV = path.join(ROOT, "data", "import", "generated-email-discovery-applied.csv");

// Reuse the same blocklists the scraper uses so we never accept anything
// the scraper would have rejected.
const EMAIL_BLOCKLIST = new Set([
  "info@example.com",
  "noreply@example.com",
  "support@example.com",
  "user@domain.com",
  "hi@mystore.com",
  "name@email.com",
  "you@example.com",
  "email@example.com",
  "example@example.com",
  "test@example.com",
  "admin@example.com",
  "yourname@email.com",
]);

const EMAIL_DOMAIN_BLOCKLIST = new Set([
  "sentry-next.wixpress.com",
  "sentry.wixpress.com",
  "sentry.io",
  "growtherapy.com",
  "headway.co",
  "rula.com",
  "talkiatry.com",
  "brightside.com",
  "betterhelp.com",
  "talkspace.com",
  "mdofficemail.com",
  "psychologytoday.com",
]);

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

function isWellFormed(email) {
  return typeof email === "string" && EMAIL_RE.test(email);
}

function isBlocked(email) {
  const lower = email.toLowerCase();
  if (EMAIL_BLOCKLIST.has(lower)) return true;
  const domain = lower.split("@")[1] || "";
  return EMAIL_DOMAIN_BLOCKLIST.has(domain);
}

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
    token:
      process.env.SANITY_API_TOKEN || rootEnv.SANITY_API_TOKEN || studioEnv.SANITY_API_TOKEN,
  };
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// LLMs sometimes wrap JSON in markdown fences or add a "Here's the JSON:"
// preamble. Strip the noise and pull out the array.
function extractJsonArray(raw) {
  const text = String(raw).trim();
  // Try direct parse first.
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch (_e) {
    // fall through to fence stripping
  }
  // Strip ```json ... ``` fences.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1]);
      if (Array.isArray(parsed)) return parsed;
    } catch (_e) {
      // fall through
    }
  }
  // Last resort: find the outermost [...] block.
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch (_e) {
      // give up
    }
  }
  throw new Error("Could not parse a JSON array from the response file.");
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const inputArg = args.find((a) => a.startsWith("--input="));
  const inputPath = inputArg ? path.resolve(ROOT, inputArg.split("=")[1]) : DEFAULT_INPUT;
  const thresholdArg = args.find((a) => a.startsWith("--threshold="));
  const threshold = thresholdArg ? parseInt(thresholdArg.split("=")[1], 10) : 70;

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${path.relative(ROOT, inputPath)}`);
    console.error("");
    console.error("Generate the prompt with: npm run cms:discovery:emails");
    console.error("Then save the LLM response to data/import/email-discovery-response.json");
    process.exit(1);
  }

  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    console.error("Missing Sanity project config.");
    process.exit(1);
  }
  if (write && !config.token) {
    console.error("--write requires SANITY_API_TOKEN.");
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf8");
  let findings;
  try {
    findings = extractJsonArray(raw);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(`Read ${findings.length} finding(s) from ${path.relative(ROOT, inputPath)}.`);

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: API_VERSION,
    token: config.token,
    useCdn: false,
  });

  // Fetch all therapists missing email so we can validate ids and avoid
  // overwriting any record that gained an email since the prompt was
  // generated.
  const therapists = await client.fetch(`
    *[_type == "therapist" && (!defined(email) || email == "")] {
      _id, name, "slug": slug.current, email
    }
  `);
  const byId = new Map(therapists.map((t) => [t._id, t]));

  const rows = [];
  for (const f of findings) {
    const id = String(f?.id || "").trim();
    const email = String(f?.email || "").trim().toLowerCase();
    const sourceUrl = String(f?.sourceUrl || "").trim();
    const confidence = Number(f?.confidence);
    const notes = String(f?.notes || "").trim();

    let action = "skip";
    let reason = "";

    const target = byId.get(id);
    if (!target) {
      reason = "id_not_in_missing_email_set";
    } else if (!isWellFormed(email)) {
      reason = "malformed_email";
    } else if (isBlocked(email)) {
      reason = "blocked_email";
    } else if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
      reason = "invalid_confidence";
    } else if (!sourceUrl) {
      reason = "missing_source_url";
    } else if (confidence < threshold) {
      action = "review";
      reason = `below_threshold:${confidence}<${threshold}`;
    } else {
      action = "write";
    }

    rows.push({
      id,
      name: target?.name || "",
      email,
      sourceUrl,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      action,
      reason,
      notes,
    });
  }

  // Summary.
  const writes = rows.filter((r) => r.action === "write");
  const reviews = rows.filter((r) => r.action === "review");
  const skips = rows.filter((r) => r.action === "skip");
  console.log("");
  console.log("Validation summary:");
  console.log(`  Will write (confidence >= ${threshold}): ${writes.length}`);
  console.log(`  Manual review (< ${threshold}):          ${reviews.length}`);
  console.log(`  Skipped (invalid):                       ${skips.length}`);

  if (skips.length > 0) {
    console.log("");
    console.log("Skipped reasons:");
    const counts = new Map();
    for (const r of skips) counts.set(r.reason, (counts.get(r.reason) || 0) + 1);
    for (const [reason, n] of counts) console.log(`  ${reason}: ${n}`);
  }

  // Write CSV preview.
  fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });
  const header = ["id", "name", "email", "sourceUrl", "confidence", "action", "reason", "notes"];
  const csv = [header.join(",")]
    .concat(rows.map((r) => header.map((h) => csvEscape(r[h])).join(",")))
    .join("\n");
  fs.writeFileSync(OUTPUT_CSV, csv + "\n");
  console.log("");
  console.log(`Wrote preview CSV → ${path.relative(ROOT, OUTPUT_CSV)}`);

  if (!write) {
    console.log("");
    console.log("Dry-run only. Re-run with --write to commit the 'write' rows to Sanity.");
    return;
  }

  // Commit.
  console.log("");
  console.log(`Patching ${writes.length} therapist(s)…`);
  let patched = 0;
  for (const r of writes) {
    try {
      await client.patch(r.id).set({ email: r.email }).commit({ visibility: "async" });
      patched++;
      console.log(`  ✓ ${r.name} → ${r.email} @${r.confidence}`);
    } catch (err) {
      console.log(`  ✗ ${r.name}: ${err?.message || err}`);
    }
  }
  console.log("");
  console.log(`Done. Patched ${patched}/${writes.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
