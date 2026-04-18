// Auto-source-review: fetches each therapist's sourceUrl, diffs the
// content against what we have stored, and auto-stamps sourceReviewedAt
// for listings where nothing material has changed. Listings with drift
// stay in the human review queue with a diagnostic event logged.
//
// Why this exists: at scale a reviewer cannot re-open and re-confirm
// every listing by hand. Most re-reviews end with "nothing changed,
// mark reviewed." This script does the mechanical part of that check
// so humans only see cards where something actually drifted.
//
// Conservative by design — see shared/source-drift-domain.mjs. A stamp
// of sourceReviewedAt is a trust claim that ages into the system, so
// we only apply it when we have positive evidence nothing relevant
// changed. Anything ambiguous is left for a human.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

import {
  buildFieldTrustMeta,
  computeTherapistVerificationMeta,
} from "../shared/therapist-trust-domain.mjs";
import { buildTherapistOpsEvent } from "../shared/therapist-publishing-domain.mjs";
import { computeContentDrift, extractFactsFromHtml } from "../shared/source-drift-domain.mjs";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const OUTPUT_CSV = path.join(ROOT, "data", "import", "generated-auto-source-review.csv");
const OUTPUT_MD = path.join(ROOT, "data", "import", "generated-auto-source-review.md");
const DEFAULT_LIMIT = 50;
const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

// Hosts that cannot be auto-fetched and diffed: either edge bot
// protection (LifeStance) or JavaScript-rendered SPAs that return an
// empty shell to a static fetcher (DCA). For these we skip the fetch
// entirely and surface the therapist for manual reconfirmation rather
// than logging a misleading "unreachable" each run.
const SKIP_AUTO_REVIEW_HOSTS = new Set([
  "lifestance.com",
  "search.dca.ca.gov",
  "iservices.dca.ca.gov",
]);

function shouldSkipHost(sourceUrl) {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    for (const skip of SKIP_AUTO_REVIEW_HOSTS) {
      if (host === skip || host.endsWith(`.${skip}`)) return skip;
    }
  } catch {
    return null;
  }
  return null;
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
      accumulator[trimmed.slice(0, separatorIndex).trim()] = trimmed
        .slice(separatorIndex + 1)
        .trim();
      return accumulator;
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

function csvEscape(value) {
  const raw = String(value == null ? "" : value);
  if (!/[",\n]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

function parseArgs(argv) {
  const options = {
    limit: DEFAULT_LIMIT,
    dryRun: false,
    verbose: false,
    therapistId: "",
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--verbose") options.verbose = true;
    else if (arg.startsWith("--limit=")) {
      const value = Number(arg.split("=")[1]);
      if (Number.isFinite(value) && value > 0) options.limit = Math.floor(value);
    } else if (arg.startsWith("--id=")) {
      options.therapistId = arg.slice(5).trim();
    }
  }
  return options;
}

async function fetchDueTherapists(client, { limit, therapistId }) {
  if (therapistId) {
    const doc = await client.fetch(`*[_id == $id][0]{ ${THERAPIST_PROJECTION} }`, {
      id: therapistId,
    });
    return doc ? [doc] : [];
  }
  // Listings that are live, have a source URL, and are at-or-past their
  // review due date. Ordered most-overdue first so a bounded run still
  // works through the highest-value items.
  return client.fetch(
    `*[_type == "therapist"
        && listingActive != false
        && sourceUrl != null && sourceUrl != ""
        && (nextReviewDueAt == null || nextReviewDueAt <= now())
      ] | order(coalesce(verificationPriority, 0) desc, nextReviewDueAt asc)
      [0...$limit]{ ${THERAPIST_PROJECTION} }`,
    { limit },
  );
}

const THERAPIST_PROJECTION = `
  _id,
  providerId,
  name,
  credentials,
  city,
  state,
  zip,
  email,
  phone,
  website,
  bookingUrl,
  sourceUrl,
  sourceReviewedAt,
  sourceHealthStatus,
  insuranceAccepted,
  telehealthStates,
  fieldReviewStates,
  therapistReportedFields,
  therapistReportedConfirmedAt,
  verificationLane,
  verificationPriority,
  nextReviewDueAt
`;

async function fetchSource(sourceUrl) {
  try {
    const response = await fetch(sourceUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, status: response.status, reason: `HTTP ${response.status}`, html: "" };
    }
    const contentType = response.headers.get("content-type") || "";
    if (!/html|xml|text/i.test(contentType)) {
      return {
        ok: false,
        status: response.status,
        reason: `unexpected content-type ${contentType}`,
        html: "",
      };
    }
    const html = await response.text();
    return { ok: true, status: response.status, reason: "", html };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown error");
    return { ok: false, status: null, reason: message, html: "" };
  }
}

async function applyNoDrift(client, therapist, dryRun) {
  const nowIso = new Date().toISOString();
  const nextTherapist = { ...therapist, sourceReviewedAt: nowIso };
  const verificationMeta = computeTherapistVerificationMeta(nextTherapist);
  const patchFields = {
    sourceReviewedAt: nowIso,
    lastOperationalReviewAt: verificationMeta.lastOperationalReviewAt,
    nextReviewDueAt: verificationMeta.nextReviewDueAt,
    verificationPriority: verificationMeta.verificationPriority,
    verificationLane: verificationMeta.verificationLane,
    dataCompletenessScore: verificationMeta.dataCompletenessScore,
    fieldTrustMeta: buildFieldTrustMeta(nextTherapist),
  };
  const changedFields = Object.keys(patchFields);
  const notes = "Auto-source-review: no drift detected against stored fields.";

  if (dryRun) return { action: "dry_run_no_drift", patchFields };

  const transaction = client.transaction();
  transaction.patch(therapist._id, (patch) => patch.set(patchFields));
  transaction.create(
    buildTherapistOpsEvent(therapist, {
      eventType: "therapist_review_auto_completed",
      decision: "auto_source_review",
      notes,
      changedFields,
    }),
  );
  await transaction.commit({ visibility: "sync" });
  return { action: "auto_reviewed", patchFields };
}

async function logDrift(client, therapist, reasons, dryRun) {
  // Drift path: we do NOT patch the therapist. We only log an event so
  // a human can see why the card stayed in the queue. Patching
  // fieldReviewStates is deliberately left to the existing
  // operational-drift-checks script, which has more context.
  const notes = `Auto-source-review: drift detected. ${reasons.join("; ")}`;
  if (dryRun) return { action: "dry_run_drift", reasons };
  await client.create(
    buildTherapistOpsEvent(therapist, {
      eventType: "therapist_review_auto_drift_detected",
      decision: "auto_source_review",
      notes,
      changedFields: [],
    }),
  );
  return { action: "drift_flagged", reasons };
}

async function logSkippedHost(client, therapist, host, dryRun) {
  const reason = `source host ${host} is not auto-fetchable; manual reconfirmation required`;
  const notes = `Auto-source-review: ${reason}.`;
  if (dryRun) return { action: "dry_run_skipped_host", reason };
  await client.create(
    buildTherapistOpsEvent(therapist, {
      eventType: "therapist_review_auto_skipped_host",
      decision: "auto_source_review",
      notes,
      changedFields: [],
    }),
  );
  return { action: "skipped_unsupported_host", reason };
}

async function logFetchFailure(client, therapist, reason, dryRun) {
  const notes = `Auto-source-review: source unreachable (${reason}).`;
  if (dryRun) return { action: "dry_run_unreachable", reason };
  await client.create(
    buildTherapistOpsEvent(therapist, {
      eventType: "therapist_review_auto_unreachable",
      decision: "auto_source_review",
      notes,
      changedFields: [],
    }),
  );
  return { action: "unreachable", reason };
}

function buildCsv(rows) {
  const headers = ["therapist_id", "name", "city", "source_url", "action", "reasons"];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

function buildMarkdown(rows, summary) {
  const lines = ["# Auto Source Review", ""];
  lines.push(
    `Processed ${summary.total} therapist(s): ${summary.autoReviewed} auto-reviewed, ${summary.drifted} flagged for human review, ${summary.unreachable} unreachable, ${summary.skipped} skipped (unsupported host).`,
    "",
  );
  if (!rows.length) return lines.join("\n");
  lines.push("## Results", "");
  for (const row of rows) {
    lines.push(`### ${row.name || row.therapist_id}`);
    lines.push(`- Location: ${row.city || "Unknown"}`);
    lines.push(`- Source: ${row.source_url}`);
    lines.push(`- Action: ${row.action}`);
    if (row.reasons) lines.push(`- Reasons: ${row.reasons}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv);
  const config = getConfig();
  if (!config.projectId || !config.dataset || !config.token) {
    throw new Error(
      "Missing Sanity config. Set SANITY_PROJECT_ID, SANITY_DATASET, and SANITY_API_TOKEN.",
    );
  }
  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token,
    useCdn: false,
  });

  const therapists = await fetchDueTherapists(client, {
    limit: options.limit,
    therapistId: options.therapistId,
  });
  const summary = {
    total: therapists.length,
    autoReviewed: 0,
    drifted: 0,
    unreachable: 0,
    skipped: 0,
  };
  const rows = [];

  if (options.verbose || options.dryRun) {
    console.log(
      `Auto-source-review${options.dryRun ? " (dry run)" : ""}: checking ${therapists.length} therapist(s).`,
    );
  }

  for (const [index, therapist] of therapists.entries()) {
    let action;
    let reasons = "";

    const skippedHost = shouldSkipHost(therapist.sourceUrl);
    if (skippedHost) {
      const info = await logSkippedHost(client, therapist, skippedHost, options.dryRun);
      action = info.action;
      reasons = info.reason;
      summary.skipped += 1;
      const row = {
        therapist_id: therapist._id,
        name: therapist.name || "",
        city: therapist.city || "",
        source_url: therapist.sourceUrl || "",
        action,
        reasons,
      };
      rows.push(row);
      if (options.verbose) {
        console.log(`  ${row.action}\t${therapist.name || therapist._id}\t${reasons}`);
      }
      continue;
    }

    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const fetchResult = await fetchSource(therapist.sourceUrl);

    if (!fetchResult.ok) {
      const info = await logFetchFailure(client, therapist, fetchResult.reason, options.dryRun);
      action = info.action;
      reasons = info.reason;
      summary.unreachable += 1;
    } else {
      const facts = extractFactsFromHtml(fetchResult.html);
      const drift = computeContentDrift(therapist, facts);
      if (drift.drifted) {
        const info = await logDrift(client, therapist, drift.reasons, options.dryRun);
        action = info.action;
        reasons = drift.reasons.join("; ");
        summary.drifted += 1;
      } else {
        const info = await applyNoDrift(client, therapist, options.dryRun);
        action = info.action;
        summary.autoReviewed += 1;
      }
    }

    const row = {
      therapist_id: therapist._id,
      name: therapist.name || "",
      city: therapist.city || "",
      source_url: therapist.sourceUrl || "",
      action,
      reasons,
    };
    rows.push(row);
    if (options.verbose) {
      console.log(`  ${row.action}\t${therapist.name || therapist._id}\t${reasons}`);
    }
  }

  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });
    fs.writeFileSync(OUTPUT_CSV, `${buildCsv(rows)}\n`, "utf8");
    fs.writeFileSync(OUTPUT_MD, `${buildMarkdown(rows, summary)}\n`, "utf8");
  }

  console.log(
    `Auto-source-review${options.dryRun ? " (dry run)" : ""}: ${summary.autoReviewed} auto-reviewed, ${summary.drifted} flagged, ${summary.unreachable} unreachable, ${summary.skipped} skipped (of ${summary.total} due).`,
  );
  if (!options.dryRun) {
    console.log(`Reports: ${path.relative(ROOT, OUTPUT_CSV)} · ${path.relative(ROOT, OUTPUT_MD)}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
