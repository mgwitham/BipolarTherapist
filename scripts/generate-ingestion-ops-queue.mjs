import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const OUTPUT_CSV = path.join(ROOT, "data", "import", "generated-ingestion-ops-queue.csv");
const OUTPUT_MD = path.join(ROOT, "data", "import", "generated-ingestion-ops-queue.md");

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

function buildCandidateAction(candidate) {
  if (candidate.reviewLane === "resolve_duplicates") {
    return candidate.matchedTherapistSlug
      ? `Merge into therapist ${candidate.matchedTherapistSlug}`
      : candidate.matchedApplicationId
        ? `Merge into application ${candidate.matchedApplicationId}`
        : "Resolve duplicate";
  }
  if (candidate.reviewLane === "needs_confirmation") {
    return "Run one more trust confirmation pass";
  }
  if (candidate.reviewLane === "publish_now") {
    return "Publish therapist";
  }
  if (candidate.reviewLane === "archived") {
    return "No action";
  }
  return "Editorial review";
}

function buildTherapistAction(therapist) {
  if (therapist.verificationLane === "needs_verification") {
    return "Verify source and contact path";
  }
  if (therapist.verificationLane === "needs_reconfirmation") {
    return "Re-confirm operational fields";
  }
  if (therapist.verificationLane === "refresh_now") {
    return "Refresh source review now";
  }
  if (therapist.verificationLane === "refresh_soon") {
    return "Schedule refresh soon";
  }
  return "No action";
}

async function fetchData(client) {
  return client.fetch(`{
    "candidates": *[_type == "therapistCandidate" && reviewStatus != "published"] | order(coalesce(reviewPriority, 0) desc, coalesce(nextReviewDueAt, _updatedAt) asc){
      _id,
      candidateId,
      providerId,
      name,
      credentials,
      city,
      state,
      zip,
      sourceType,
      sourceUrl,
      reviewStatus,
      reviewLane,
      reviewPriority,
      nextReviewDueAt,
      readinessScore,
      publishRecommendation,
      dedupeStatus,
      matchedTherapistSlug,
      matchedApplicationId
    },
    "therapists": *[_type == "therapist" && listingActive != false] | order(coalesce(verificationPriority, 0) desc, coalesce(nextReviewDueAt, _updatedAt) asc){
      _id,
      providerId,
      name,
      credentials,
      city,
      state,
      zip,
      verificationLane,
      verificationPriority,
      nextReviewDueAt,
      dataCompletenessScore,
      sourceReviewedAt,
      therapistReportedConfirmedAt,
      "slug": slug.current
    }
  }`);
}

function buildRows(data) {
  const candidateRows = (data.candidates || []).map((candidate) => ({
    entity_type: "candidate",
    entity_id: candidate._id,
    provider_id: candidate.providerId || "",
    name: candidate.name || "",
    credentials: candidate.credentials || "",
    location: [candidate.city, candidate.state, candidate.zip].filter(Boolean).join(", "),
    ops_lane: candidate.reviewLane || "editorial_review",
    priority: candidate.reviewPriority ?? "",
    next_due: formatDate(candidate.nextReviewDueAt),
    action: buildCandidateAction(candidate),
    status: candidate.reviewStatus || "",
    recommendation: candidate.publishRecommendation || "",
    trust_signal: candidate.dedupeStatus || "",
    source: [candidate.sourceType, candidate.sourceUrl].filter(Boolean).join(" · "),
    profile_link: candidate.matchedTherapistSlug
      ? `therapist.html?slug=${candidate.matchedTherapistSlug}`
      : "",
  }));

  const therapistRows = (data.therapists || [])
    .filter((therapist) => therapist.verificationLane && therapist.verificationLane !== "fresh")
    .map((therapist) => ({
      entity_type: "therapist",
      entity_id: therapist._id,
      provider_id: therapist.providerId || "",
      name: therapist.name || "",
      credentials: therapist.credentials || "",
      location: [therapist.city, therapist.state, therapist.zip].filter(Boolean).join(", "),
      ops_lane: therapist.verificationLane || "fresh",
      priority: therapist.verificationPriority ?? "",
      next_due: formatDate(therapist.nextReviewDueAt),
      action: buildTherapistAction(therapist),
      status: "live",
      recommendation: "",
      trust_signal: therapist.dataCompletenessScore == null
        ? ""
        : `Completeness ${therapist.dataCompletenessScore}/100`,
      source: [formatDate(therapist.sourceReviewedAt), formatDate(therapist.therapistReportedConfirmedAt)]
        .filter(Boolean)
        .join(" · "),
      profile_link: therapist.slug ? `therapist.html?slug=${therapist.slug}` : "",
    }));

  return candidateRows
    .concat(therapistRows)
    .sort((a, b) => {
      const priorityDiff = (Number(b.priority) || 0) - (Number(a.priority) || 0);
      if (priorityDiff) {
        return priorityDiff;
      }
      return toTimestamp(a.next_due) - toTimestamp(b.next_due);
    });
}

function writeCsv(rows) {
  const headers = [
    "entity_type",
    "entity_id",
    "provider_id",
    "name",
    "credentials",
    "location",
    "ops_lane",
    "priority",
    "next_due",
    "action",
    "status",
    "recommendation",
    "trust_signal",
    "source",
    "profile_link",
  ];
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header] || "")).join(","));
  });
  fs.writeFileSync(OUTPUT_CSV, `${lines.join("\n")}\n`, "utf8");
}

function writeMarkdown(rows) {
  const candidates = rows.filter((row) => row.entity_type === "candidate");
  const therapists = rows.filter((row) => row.entity_type === "therapist");
  const lines = [
    "# Ingestion Operations Queue",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `- Total work items: ${rows.length}`,
    `- Candidate items: ${candidates.length}`,
    `- Live therapist refresh items: ${therapists.length}`,
    "",
    "## Highest-priority work",
    "",
  ];

  rows.slice(0, 20).forEach((row, index) => {
    lines.push(`### ${index + 1}. ${row.name || "Unnamed item"}`);
    lines.push(`- Type: ${row.entity_type}`);
    lines.push(`- Lane: ${row.ops_lane}`);
    lines.push(`- Priority: ${row.priority || "n/a"}`);
    lines.push(`- Next due: ${row.next_due || "now"}`);
    lines.push(`- Action: ${row.action || "n/a"}`);
    if (row.location) {
      lines.push(`- Location: ${row.location}`);
    }
    if (row.trust_signal) {
      lines.push(`- Trust signal: ${row.trust_signal}`);
    }
    if (row.source) {
      lines.push(`- Source: ${row.source}`);
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

  const data = await fetchData(client);
  const rows = buildRows(data);
  writeCsv(rows);
  writeMarkdown(rows);

  console.log(
    `Generated ${rows.length} ops queue item(s) to ${path.relative(ROOT, OUTPUT_CSV)} and ${path.relative(ROOT, OUTPUT_MD)}.`,
  );
}

run().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
