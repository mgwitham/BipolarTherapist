import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const OUTPUT_CSV = path.join(ROOT, "data", "import", "generated-licensure-refresh-queue.csv");
const OUTPUT_MD = path.join(ROOT, "data", "import", "generated-licensure-refresh-queue.md");
const OUTPUT_JSON = path.join(ROOT, "data", "import", "generated-licensure-refresh-queue.json");

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
  const raw = String(value ?? "");
  if (!/[",\n]/.test(raw)) {
    return raw;
  }
  return `"${raw.replace(/"/g, '""')}"`;
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

function daysUntil(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function buildReason(item) {
  const reasons = [];
  if (item.queue_reason === "missing_cache") {
    reasons.push("No licensure cache record yet");
  }
  if (item.refresh_status === "failed") {
    reasons.push("Previous refresh failed");
  }
  if (item.next_refresh_due_at && toTimestamp(item.next_refresh_due_at) <= Date.now()) {
    reasons.push("Refresh due now");
  }
  const expiryDays = daysUntil(item.expiration_date);
  if (expiryDays != null && expiryDays <= 45) {
    reasons.push(`License expires in ${expiryDays} day${expiryDays === 1 ? "" : "s"}`);
  }
  if (item.last_refresh_error) {
    reasons.push(item.last_refresh_error);
  }
  return reasons.join(" · ");
}

function buildNextMove(item) {
  if (item.queue_reason === "missing_cache") {
    return "Run first licensure enrichment";
  }
  if (item.refresh_status === "failed") {
    return "Retry official lookup with pacing";
  }
  const expiryDays = daysUntil(item.expiration_date);
  if (expiryDays != null && expiryDays <= 45) {
    return "Re-check expiration and status";
  }
  return "Run weekly licensure refresh";
}

async function fetchData(client) {
  return client.fetch(`{
    "therapists": *[_type == "therapist" && listingActive != false && licenseState == "CA" && defined(licenseNumber)]{
      _id,
      providerId,
      name,
      credentials,
      city,
      state,
      zip,
      licenseState,
      licenseNumber,
      "slug": slug.current,
      licensureVerification
    },
    "licensureRecords": *[_type == "licensureRecord" && jurisdiction == "CA"]{
      _id,
      providerId,
      jurisdiction,
      licenseState,
      licenseNumber,
      sourceDocumentId,
      sourceDocumentType,
      refreshStatus,
      lastRefreshAttemptAt,
      lastRefreshSuccessAt,
      lastRefreshFailureAt,
      nextRefreshDueAt,
      refreshFailureCount,
      lastRefreshError,
      staleAfterAt,
      licensureVerification
    }
  }`);
}

function buildRows(data) {
  const recordsByProvider = new Map();
  (data.licensureRecords || []).forEach((record) => {
    if (record.providerId) {
      recordsByProvider.set(record.providerId, record);
    }
  });

  const rows = [];

  (data.therapists || []).forEach((therapist) => {
    const record = recordsByProvider.get(therapist.providerId || "");
    if (!record) {
      rows.push({
        provider_id: therapist.providerId || "",
        therapist_id: therapist._id,
        licensure_record_id: "",
        name: therapist.name || "",
        credentials: therapist.credentials || "",
        location: [therapist.city, therapist.state, therapist.zip].filter(Boolean).join(", "),
        license_number: therapist.licenseNumber || "",
        refresh_status: "missing",
        next_refresh_due_at: "",
        last_refresh_success_at: "",
        expiration_date: formatDate(
          therapist.licensureVerification && therapist.licensureVerification.expirationDate,
        ),
        queue_reason: "missing_cache",
        reason: "No licensure cache record yet",
        next_move: "Run first licensure enrichment",
        profile_link: therapist.slug ? `therapist.html?slug=${therapist.slug}` : "",
      });
      return;
    }

    const expiry = formatDate(
      record.licensureVerification && record.licensureVerification.expirationDate,
    );
    const dueAt = record.nextRefreshDueAt || record.staleAfterAt || "";
    if (
      record.refreshStatus === "failed" ||
      !dueAt ||
      toTimestamp(dueAt) <= Date.now() ||
      (expiry && daysUntil(expiry) != null && daysUntil(expiry) <= 45)
    ) {
      const row = {
        provider_id: therapist.providerId || "",
        therapist_id: therapist._id,
        licensure_record_id: record._id,
        name: therapist.name || "",
        credentials: therapist.credentials || "",
        location: [therapist.city, therapist.state, therapist.zip].filter(Boolean).join(", "),
        license_number: therapist.licenseNumber || "",
        refresh_status: record.refreshStatus || "queued",
        next_refresh_due_at: formatDate(dueAt),
        last_refresh_success_at: formatDate(record.lastRefreshSuccessAt),
        expiration_date: expiry,
        queue_reason: record.refreshStatus === "failed" ? "refresh_failed" : "refresh_due",
        last_refresh_error: record.lastRefreshError || "",
        profile_link: therapist.slug ? `therapist.html?slug=${therapist.slug}` : "",
      };
      row.reason = buildReason(row);
      row.next_move = buildNextMove(row);
      rows.push(row);
    }
  });

  return rows.sort((a, b) => {
    const aFailed = a.refresh_status === "failed" ? 1 : 0;
    const bFailed = b.refresh_status === "failed" ? 1 : 0;
    if (aFailed !== bFailed) {
      return bFailed - aFailed;
    }
    return toTimestamp(a.next_refresh_due_at) - toTimestamp(b.next_refresh_due_at);
  });
}

function writeCsv(rows) {
  const headers = [
    "provider_id",
    "therapist_id",
    "licensure_record_id",
    "name",
    "credentials",
    "location",
    "license_number",
    "refresh_status",
    "next_refresh_due_at",
    "last_refresh_success_at",
    "expiration_date",
    "queue_reason",
    "reason",
    "next_move",
    "profile_link",
  ];
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header] || "")).join(","));
  });
  fs.writeFileSync(OUTPUT_CSV, `${lines.join("\n")}\n`, "utf8");
}

function writeMarkdown(rows) {
  const failed = rows.filter((row) => row.refresh_status === "failed").length;
  const missing = rows.filter((row) => row.queue_reason === "missing_cache").length;
  const expiring = rows.filter((row) => {
    const days = daysUntil(row.expiration_date);
    return days != null && days <= 45;
  }).length;

  const lines = [
    "# Licensure Refresh Queue",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `- Records in queue: ${rows.length}`,
    `- Failed refreshes: ${failed}`,
    `- Missing licensure cache: ${missing}`,
    `- Licenses expiring within 45 days: ${expiring}`,
    "",
    "## Priority work",
    "",
  ];

  rows.slice(0, 25).forEach((row, index) => {
    lines.push(`### ${index + 1}. ${row.name || "Unnamed therapist"}`);
    lines.push(`- Status: ${row.refresh_status || "missing"}`);
    lines.push(`- License: ${row.license_number || "Unknown"}`);
    if (row.expiration_date) {
      lines.push(`- Expiration: ${row.expiration_date}`);
    }
    lines.push(`- Reason: ${row.reason || "Refresh due"}`);
    lines.push(`- Next move: ${row.next_move || "Run licensure refresh"}`);
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

  const data = await fetchData(client);
  const rows = buildRows(data);
  writeCsv(rows);
  writeMarkdown(rows);
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(rows, null, 2) + "\n", "utf8");

  console.log(
    `Generated licensure refresh queue with ${rows.length} record(s).`,
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
