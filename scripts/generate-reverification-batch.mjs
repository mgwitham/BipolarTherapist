import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const OUTPUT_CSV = path.join(ROOT, "data", "import", "generated-reverification-batch.csv");
const OUTPUT_MD = path.join(ROOT, "data", "import", "generated-reverification-batch.md");
const EXPIRING_SOON_DAYS = 14;

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((accumulator, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return accumulator;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        return accumulator;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      accumulator[key] = value;
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
      process.env.SANITY_STUDIO_PROJECT_ID ||
      rootEnv.VITE_SANITY_PROJECT_ID ||
      studioEnv.SANITY_STUDIO_PROJECT_ID,
    dataset:
      process.env.SANITY_DATASET ||
      process.env.VITE_SANITY_DATASET ||
      process.env.SANITY_STUDIO_DATASET ||
      rootEnv.VITE_SANITY_DATASET ||
      studioEnv.SANITY_STUDIO_DATASET,
    apiVersion: process.env.SANITY_API_VERSION || rootEnv.VITE_SANITY_API_VERSION || API_VERSION,
    token:
      process.env.SANITY_API_TOKEN || rootEnv.SANITY_API_TOKEN || studioEnv.SANITY_API_TOKEN || "",
  };
}

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (!/[",\n]/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toISOString().slice(0, 10);
}

function toTimestamp(value) {
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function getDaysUntil(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) {
    return null;
  }
  return Math.round((timestamp - Date.now()) / 86400000);
}

function formatFieldLabel(field) {
  return String(field || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getNeedsReconfirmationFields(fieldReviewStates) {
  return Object.entries(fieldReviewStates || {})
    .filter((entry) => entry[1] === "needs_reconfirmation")
    .map((entry) => entry[0]);
}

function buildRefreshReason(item) {
  const reasons = [];
  const reconfirmationFields = getNeedsReconfirmationFields(item.fieldReviewStates);
  if (reconfirmationFields.length) {
    reasons.push(`Re-confirm ${reconfirmationFields.map(formatFieldLabel).slice(0, 3).join(", ")}`);
  }
  if (item.verificationLane === "needs_verification") {
    reasons.push("No trusted review timestamp yet");
  } else if (item.verificationLane === "refresh_now") {
    reasons.push("Source review is aging");
  } else if (item.verificationLane === "refresh_soon") {
    reasons.push("Freshness window is nearing expiry");
  }
  if (item.dataCompletenessScore != null && Number(item.dataCompletenessScore) < 75) {
    reasons.push(`Completeness ${item.dataCompletenessScore}/100`);
  }
  return reasons.join(" · ");
}

function buildNextMove(item) {
  const reconfirmationFields = getNeedsReconfirmationFields(item.fieldReviewStates);
  if (reconfirmationFields.length) {
    return `Request confirmation for ${reconfirmationFields.map(formatFieldLabel).slice(0, 2).join(", ")}`;
  }
  if (item.verificationLane === "needs_verification") {
    return "Verify source trail and contact path";
  }
  if (item.verificationLane === "refresh_now") {
    return "Refresh source review now";
  }
  if (item.verificationLane === "refresh_soon") {
    return "Schedule refresh";
  }
  return "Review profile";
}

function getImpactProxy(item) {
  const completeness = Number(item.dataCompletenessScore || 0);
  const priority = Number(item.verificationPriority || 0);
  if (completeness >= 90 || priority >= 85) {
    return "high";
  }
  if (completeness >= 75 || priority >= 60) {
    return "medium";
  }
  return "standard";
}

function getPriorityMeta(item) {
  const dueDays = getDaysUntil(item.nextReviewDueAt);
  const reconfirmationFields = getNeedsReconfirmationFields(item.fieldReviewStates);
  const impactProxy = getImpactProxy(item);
  const expiringSoon = dueDays !== null && dueDays >= 0 && dueDays <= EXPIRING_SOON_DAYS;
  const highImpactStale =
    impactProxy === "high" &&
    (item.verificationLane === "refresh_now" ||
      item.verificationLane === "refresh_soon" ||
      reconfirmationFields.length > 0);
  let priorityScore = 0;
  priorityScore += Number(item.verificationPriority || 0);
  priorityScore += expiringSoon ? 30 : 0;
  priorityScore += highImpactStale ? 24 : 0;
  priorityScore += Math.min(12, reconfirmationFields.length * 3);
  priorityScore += impactProxy === "high" ? 10 : impactProxy === "medium" ? 4 : 0;
  if (dueDays !== null) {
    priorityScore += Math.max(0, 12 - Math.max(0, dueDays));
  }

  return {
    dueDays,
    impactProxy,
    expiringSoon,
    highImpactStale,
    reconfirmationFields,
    priorityScore,
  };
}

async function fetchTherapists(client) {
  return client.fetch(`*[_type == "therapist" && listingActive != false] | order(coalesce(verificationPriority, 0) desc, coalesce(nextReviewDueAt, _updatedAt) asc){
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
    sourceUrl,
    sourceReviewedAt,
    therapistReportedConfirmedAt,
    fieldReviewStates,
    verificationPriority,
    verificationLane,
    nextReviewDueAt,
    lastOperationalReviewAt,
    dataCompletenessScore,
    "slug": slug.current
  }`);
}

function buildRows(therapists) {
  return (therapists || [])
    .filter((item) => item.verificationLane && item.verificationLane !== "fresh")
    .map((item) => {
      const priorityMeta = getPriorityMeta(item);
      const opsCue = [
        priorityMeta.expiringSoon
          ? `expiring soon${priorityMeta.dueDays != null ? ` (${priorityMeta.dueDays}d)` : ""}`
          : "",
        priorityMeta.highImpactStale ? "high-impact stale" : "",
      ]
        .filter(Boolean)
        .join(" · ");

      return {
        provider_id: item.providerId || "",
        therapist_id: item._id,
        name: item.name || "",
        credentials: item.credentials || "",
        location: [item.city, item.state, item.zip].filter(Boolean).join(", "),
        verification_lane: item.verificationLane || "",
        verification_priority: item.verificationPriority ?? "",
        priority_score: priorityMeta.priorityScore,
        impact_proxy: priorityMeta.impactProxy,
        expiring_soon: priorityMeta.expiringSoon ? "yes" : "no",
        high_impact_stale: priorityMeta.highImpactStale ? "yes" : "no",
        due_in_days: priorityMeta.dueDays ?? "",
        next_review_due_at: formatDate(item.nextReviewDueAt),
        last_operational_review_at: formatDate(item.lastOperationalReviewAt),
        source_reviewed_at: formatDate(item.sourceReviewedAt),
        therapist_reported_confirmed_at: formatDate(item.therapistReportedConfirmedAt),
        data_completeness_score: item.dataCompletenessScore ?? "",
        reason: buildRefreshReason(item),
        ops_cue: opsCue,
        next_move: buildNextMove(item),
        profile_link: item.slug ? `therapist.html?slug=${item.slug}` : "",
        source_link: item.sourceUrl || item.website || "",
      };
    })
    .sort((a, b) => {
      const priorityDiff = (Number(b.priority_score) || 0) - (Number(a.priority_score) || 0);
      if (priorityDiff) {
        return priorityDiff;
      }
      return toTimestamp(a.next_review_due_at) - toTimestamp(b.next_review_due_at);
    });
}

function writeCsv(rows) {
  const headers = [
    "provider_id",
    "therapist_id",
    "name",
    "credentials",
    "location",
    "verification_lane",
    "verification_priority",
    "priority_score",
    "impact_proxy",
    "expiring_soon",
    "high_impact_stale",
    "due_in_days",
    "next_review_due_at",
    "last_operational_review_at",
    "source_reviewed_at",
    "therapist_reported_confirmed_at",
    "data_completeness_score",
    "reason",
    "ops_cue",
    "next_move",
    "profile_link",
    "source_link",
  ];
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header] || "")).join(","));
  });
  fs.writeFileSync(OUTPUT_CSV, `${lines.join("\n")}\n`, "utf8");
}

function writeMarkdown(rows) {
  const lines = [
    "# Reverification Batch",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `- Profiles in batch: ${rows.length}`,
    "",
    "## Priority work",
    "",
  ];

  rows.slice(0, 20).forEach((row, index) => {
    lines.push(`### ${index + 1}. ${row.name || "Unnamed therapist"}`);
    lines.push(`- Lane: ${row.verification_lane}`);
    lines.push(`- Priority: ${row.verification_priority || "n/a"}`);
    lines.push(`- Priority score: ${row.priority_score || "0"}`);
    if (row.ops_cue) {
      lines.push(`- Ops cue: ${row.ops_cue}`);
    }
    if (row.impact_proxy) {
      lines.push(`- Impact proxy: ${row.impact_proxy}`);
    }
    lines.push(`- Due: ${row.next_review_due_at || "now"}`);
    lines.push(`- Reason: ${row.reason || "Review profile freshness"}`);
    lines.push(`- Next move: ${row.next_move || "Review profile"}`);
    if (row.location) {
      lines.push(`- Location: ${row.location}`);
    }
    lines.push("");
  });

  fs.writeFileSync(OUTPUT_MD, `${lines.join("\n")}\n`, "utf8");
}

async function run() {
  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    throw new Error("Missing Sanity project config. Check .env and studio/.env.");
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token || undefined,
    useCdn: false,
  });

  const therapists = await fetchTherapists(client);
  const rows = buildRows(therapists);
  writeCsv(rows);
  writeMarkdown(rows);

  console.log(
    `Generated ${rows.length} reverification item(s) to ${path.relative(ROOT, OUTPUT_CSV)} and ${path.relative(ROOT, OUTPUT_MD)}.`,
  );
}

run().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
