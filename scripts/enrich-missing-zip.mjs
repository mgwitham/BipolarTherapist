import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const OUTPUT_CSV = path.join(ROOT, "data", "import", "generated-missing-zip-enrichment.csv");
const OUTPUT_MD = path.join(ROOT, "data", "import", "generated-missing-zip-enrichment.md");
const OUTREACH_CSV = path.join(ROOT, "data", "import", "generated-missing-zip-outreach.csv");

const TYPES = ["therapist", "therapistCandidate", "therapistApplication"];

const FIELD_PROJECTION = `{
  _id,
  _type,
  providerId,
  name,
  email,
  "slug": slug.current,
  city,
  state,
  zip,
  zipSource,
  licenseNumber,
  licenseState,
  licensureVerification,
  website,
  sourceUrl
}`;

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
    token: process.env.SANITY_API_TOKEN || rootEnv.SANITY_API_TOKEN || studioEnv.SANITY_API_TOKEN || "",
  };
}

function parseArgs(argv) {
  const options = {
    scope: TYPES.slice(),
    limit: 500,
    dryRun: false,
    id: "",
    outreachOnly: false,
  };
  argv.forEach((arg) => {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--outreach-only") options.outreachOnly = true;
    else if (arg.startsWith("--limit=")) {
      const n = Number(arg.split("=")[1]);
      if (Number.isFinite(n) && n > 0) options.limit = n;
    } else if (arg.startsWith("--scope=")) {
      const scope = arg
        .split("=")[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          if (s === "therapists") return "therapist";
          if (s === "candidates") return "therapistCandidate";
          if (s === "applications") return "therapistApplication";
          return s;
        });
      if (scope.length) options.scope = scope;
    } else if (arg.startsWith("--id=")) {
      options.id = arg.split("=")[1] || "";
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  });
  return options;
}

function printHelp() {
  console.log(`Missing-zip enrichment

Walks therapist/candidate/application docs with empty zip, fills from cached
licensureVerification.addressZip when available, and writes remaining records
to an outreach CSV for email follow-up.

Usage:
  node scripts/enrich-missing-zip.mjs [--scope=therapists,candidates,applications] [--limit=500] [--dry-run] [--id=doc-id] [--outreach-only]

Flags:
  --dry-run        Preview writes without mutating Sanity.
  --outreach-only  Skip the zip backfill pass; only emit the outreach CSV.
  --scope          Comma list of therapists, candidates, applications.
  --id             Restrict to a single document id.
  --limit          Max docs per type (default 500).
`);
}

function csvEscape(value) {
  const raw = String(value == null ? "" : value);
  if (!/[",\n]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

function isMissingZip(doc) {
  const zip = String(doc.zip || "").trim();
  return !/^\d{5}(-\d{4})?$/.test(zip);
}

function normalizeZip(value) {
  const match = String(value || "").match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? match[1] : "";
}

function pickLicensureZip(doc) {
  const verification = doc.licensureVerification || {};
  const direct = normalizeZip(verification.addressZip);
  if (direct) return direct;
  const fallback =
    normalizeZip(verification.addressOfRecord) || normalizeZip(verification.rawSnapshot);
  return fallback || "";
}

function pickLicensureCity(doc) {
  const verification = doc.licensureVerification || {};
  const direct = String(verification.addressCity || "").trim();
  if (direct) return direct;
  const source = String(verification.addressOfRecord || verification.rawSnapshot || "");
  const match = source.match(/([A-Z][A-Z\s]+?)\s+[A-Z]{2}\s+\d{5}/);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

async function loadMissingZipDocs(client, options) {
  const docs = [];
  for (const type of options.scope) {
    if (!TYPES.includes(type)) continue;
    const filter = options.id
      ? `*[_type == "${type}" && _id == $id] ${FIELD_PROJECTION}`
      : `*[_type == "${type}" && (!defined(zip) || zip == "" || !(zip match "[0-9][0-9][0-9][0-9][0-9]*"))][0...${options.limit}] ${FIELD_PROJECTION}`;
    const results = await client.fetch(filter, options.id ? { id: options.id } : {});
    for (const doc of results) {
      if (isMissingZip(doc)) docs.push(doc);
    }
  }
  return docs;
}

function buildZipPatch(doc, zip, source) {
  const licensureCity = pickLicensureCity(doc);
  const patch = {
    zip,
    zipSource: source,
    zipUpdatedAt: new Date().toISOString(),
  };
  if (!doc.city && licensureCity) patch.city = licensureCity;
  if (!doc.licenseState && doc.licensureVerification?.jurisdiction) {
    patch.licenseState = doc.licensureVerification.jurisdiction;
  }
  return patch;
}

function buildOutreachTaskId(doc) {
  const safe = String(doc._id || "").replace(/[^A-Za-z0-9_-]/g, "-");
  return `zipOutreachTask-${safe}`;
}

async function upsertOutreachTask(client, doc, options) {
  const now = new Date().toISOString();
  const verification = doc.licensureVerification || {};
  const task = {
    _id: buildOutreachTaskId(doc),
    _type: "zipOutreachTask",
    subjectType: doc._type,
    subjectId: doc._id,
    providerId: doc.providerId || "",
    name: doc.name || "",
    email: doc.email || "",
    city: doc.city || verification.addressCity || "",
    licenseNumber: doc.licenseNumber || "",
    licenseState: doc.licenseState || verification.jurisdiction || "",
    profileUrl: doc.slug ? `https://www.bipolartherapyhub.com/therapist/${doc.slug}` : "",
  };

  if (options.dryRun) return task;

  await client
    .transaction()
    .createIfNotExists({ ...task, status: "queued", queuedAt: now, lastSeenMissingAt: now })
    .patch(task._id, (patch) =>
      patch.set({
        subjectType: task.subjectType,
        subjectId: task.subjectId,
        providerId: task.providerId,
        name: task.name,
        email: task.email,
        city: task.city,
        licenseNumber: task.licenseNumber,
        licenseState: task.licenseState,
        profileUrl: task.profileUrl,
        lastSeenMissingAt: now,
      }),
    )
    .commit({ visibility: "async" });

  return task;
}

async function resolveStaleOutreachTasks(client, enrichedDocIds, options) {
  if (!enrichedDocIds.length) return 0;
  const now = new Date().toISOString();
  const taskIds = enrichedDocIds.map((id) => buildOutreachTaskId({ _id: id }));
  const stale = await client.fetch(
    `*[_type == "zipOutreachTask" && _id in $ids && status != "resolved"]{ _id }`,
    { ids: taskIds },
  );
  if (!stale.length) return 0;
  if (options.dryRun) return stale.length;

  const tx = client.transaction();
  for (const row of stale) {
    tx.patch(row._id, (patch) =>
      patch.set({ status: "resolved", resolvedAt: now, notes: "zip filled from licensure record" }),
    );
  }
  await tx.commit({ visibility: "async" });
  return stale.length;
}

function buildOutreachRow(doc) {
  const verification = doc.licensureVerification || {};
  return {
    docType: doc._type,
    docId: doc._id,
    providerId: doc.providerId || "",
    name: doc.name || "",
    email: doc.email || "",
    city: doc.city || verification.addressCity || "",
    licenseNumber: doc.licenseNumber || "",
    licenseState: doc.licenseState || verification.jurisdiction || "",
    profileUrl: doc.slug
      ? `https://www.bipolartherapyhub.com/therapist/${doc.slug}`
      : "",
    website: doc.website || "",
    sourceUrl: doc.sourceUrl || "",
  };
}

function buildSummaryCsv(rows) {
  const headers = ["doc_type", "doc_id", "name", "status", "zip", "zip_source", "reason"];
  return [headers.join(",")]
    .concat(
      rows.map((row) =>
        [row.docType, row.docId, row.name, row.status, row.zip, row.zipSource, row.reason]
          .map(csvEscape)
          .join(","),
      ),
    )
    .join("\n");
}

function buildOutreachCsv(rows) {
  const headers = [
    "doc_type",
    "doc_id",
    "provider_id",
    "name",
    "email",
    "city",
    "license_state",
    "license_number",
    "profile_url",
    "website",
    "source_url",
  ];
  return [headers.join(",")]
    .concat(
      rows.map((row) =>
        [
          row.docType,
          row.docId,
          row.providerId,
          row.name,
          row.email,
          row.city,
          row.licenseState,
          row.licenseNumber,
          row.profileUrl,
          row.website,
          row.sourceUrl,
        ]
          .map(csvEscape)
          .join(","),
      ),
    )
    .join("\n");
}

function buildMarkdownReport(rows, outreachRows, options) {
  const enriched = rows.filter((r) => r.status === "enriched").length;
  const queued = outreachRows.length;
  const skipped = rows.filter((r) => r.status === "skipped").length;
  const lines = [
    "# Missing Zip Enrichment",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${options.dryRun ? "Dry run" : "Write mode"}`,
    `Scope: ${options.scope.join(", ")}`,
    "",
    "## Summary",
    "",
    `- Records inspected: ${rows.length}`,
    `- Enriched from cached licensure address: ${enriched}`,
    `- Queued for therapist outreach (no zip available): ${queued}`,
    `- Skipped: ${skipped}`,
    "",
    "## Next actions",
    "",
    "1. Run `node scripts/enrich-california-licensure.mjs --scope=therapists,candidates --force` to refresh DCA address records for the queued rows; many will resolve automatically once the licensure profile is fetched.",
    "2. Re-run this script to promote the newly-cached zips onto the documents.",
    "3. For rows that remain in the outreach CSV with a `email` value, send the profile-completion email; rows without an email need a manual web search or discard.",
    "",
    "## Enriched sample",
    "",
  ];
  rows
    .filter((r) => r.status === "enriched")
    .slice(0, 50)
    .forEach((row) => {
      lines.push(`- ${row.name || row.docId} (${row.docType}) → ${row.zip} from ${row.zipSource}`);
    });
  lines.push("", "## Outreach sample", "");
  outreachRows.slice(0, 50).forEach((row) => {
    const contact = row.email || "no-email-on-file";
    lines.push(`- ${row.name || row.docId} (${row.docType}) · ${contact} · license ${row.licenseNumber || "n/a"}`);
  });
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    console.error("Missing Sanity project id or dataset. Set VITE_SANITY_PROJECT_ID / VITE_SANITY_DATASET.");
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

  const docs = await loadMissingZipDocs(client, options);
  const reportRows = [];
  const outreachRows = [];
  const enrichedDocIds = [];

  for (const doc of docs) {
    if (options.outreachOnly) {
      outreachRows.push(buildOutreachRow(doc));
      await upsertOutreachTask(client, doc, options);
      reportRows.push({
        docType: doc._type,
        docId: doc._id,
        name: doc.name || "",
        status: "queued",
        zip: "",
        zipSource: "",
        reason: "outreach-only mode",
      });
      continue;
    }

    const cachedZip = pickLicensureZip(doc);
    if (cachedZip) {
      const patch = buildZipPatch(doc, cachedZip, "licensure_record");
      if (!options.dryRun) {
        await client.patch(doc._id).set(patch).commit({ visibility: "async" });
      }
      enrichedDocIds.push(doc._id);
      reportRows.push({
        docType: doc._type,
        docId: doc._id,
        name: doc.name || "",
        status: "enriched",
        zip: cachedZip,
        zipSource: "licensure_record",
        reason: options.dryRun ? "dry run — not written" : "",
      });
      continue;
    }

    outreachRows.push(buildOutreachRow(doc));
    await upsertOutreachTask(client, doc, options);
    reportRows.push({
      docType: doc._type,
      docId: doc._id,
      name: doc.name || "",
      status: "queued",
      zip: "",
      zipSource: "",
      reason: "no cached licensure address; run enrich-california-licensure or email therapist",
    });
  }

  const resolvedCount = await resolveStaleOutreachTasks(client, enrichedDocIds, options);

  fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });
  fs.writeFileSync(OUTPUT_CSV, buildSummaryCsv(reportRows), "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdownReport(reportRows, outreachRows, options), "utf8");
  fs.writeFileSync(OUTREACH_CSV, buildOutreachCsv(outreachRows), "utf8");

  const enriched = reportRows.filter((r) => r.status === "enriched").length;
  console.log(
    `Missing-zip pass complete. inspected=${reportRows.length} enriched=${enriched} queued_outreach=${outreachRows.length} resolved_tasks=${resolvedCount} ${options.dryRun ? "(dry run)" : ""}`,
  );
  console.log(`Summary: ${path.relative(ROOT, OUTPUT_MD)}`);
  console.log(`Outreach CSV: ${path.relative(ROOT, OUTREACH_CSV)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
