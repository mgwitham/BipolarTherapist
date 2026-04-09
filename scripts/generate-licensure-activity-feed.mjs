import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const OUTPUT_CSV = path.join(ROOT, "data", "import", "generated-licensure-activity-feed.csv");
const OUTPUT_MD = path.join(ROOT, "data", "import", "generated-licensure-activity-feed.md");
const OUTPUT_JSON = path.join(ROOT, "data", "import", "generated-licensure-activity-feed.json");

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
      accumulator[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
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

function labelActivityType(value) {
  if (value === "refresh_success") return "Refresh succeeded";
  if (value === "refresh_failed") return "Refresh failed";
  if (value === "licensure_refresh_deferred") return "Refresh deferred";
  return "Licensure activity";
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
      "slug": slug.current
    },
    "licensureRecords": *[_type == "licensureRecord" && jurisdiction == "CA"]{
      _id,
      providerId,
      sourceDocumentId,
      sourceDocumentType,
      refreshStatus,
      lastRefreshSuccessAt,
      lastRefreshFailureAt,
      lastRefreshError,
      deferredUntilAt,
      licensureVerification
    },
    "events": *[_type == "therapistPublishEvent" && eventType == "licensure_refresh_deferred"] | order(createdAt desc)[0...50]{
      _id,
      eventType,
      providerId,
      therapistId,
      decision,
      notes,
      changedFields,
      createdAt
    }
  }`);
}

function buildRows(data) {
  const therapistsByProvider = new Map();
  (data.therapists || []).forEach((item) => {
    therapistsByProvider.set(item.providerId || "", item);
  });

  const rows = [];

  (data.licensureRecords || []).forEach((record) => {
    const therapist = therapistsByProvider.get(record.providerId || "") || null;
    const base = {
      provider_id: record.providerId || "",
      therapist_id: (therapist && therapist._id) || record.sourceDocumentId || "",
      licensure_record_id: record._id,
      name: (therapist && therapist.name) || "Unnamed therapist",
      credentials: (therapist && therapist.credentials) || "",
      location: therapist
        ? [therapist.city, therapist.state, therapist.zip].filter(Boolean).join(", ")
        : "",
      license_status:
        (record.licensureVerification && record.licensureVerification.primaryStatus) ||
        record.refreshStatus ||
        "",
      official_profile_url:
        (record.licensureVerification && record.licensureVerification.profileUrl) || "",
      profile_link: therapist && therapist.slug ? `therapist.html?slug=${therapist.slug}` : "",
    };

    if (record.lastRefreshSuccessAt) {
      rows.push({
        ...base,
        activity_type: "refresh_success",
        activity_at: record.lastRefreshSuccessAt,
        headline: "Primary-source licensure refresh succeeded",
        detail:
          (record.licensureVerification && record.licensureVerification.boardName) ||
          "Official source data captured",
      });
    }

    if (record.lastRefreshFailureAt) {
      rows.push({
        ...base,
        activity_type: "refresh_failed",
        activity_at: record.lastRefreshFailureAt,
        headline: "Licensure refresh failed",
        detail: record.lastRefreshError || "Official lookup did not complete.",
      });
    }
  });

  (data.events || []).forEach((event) => {
    const therapist = therapistsByProvider.get(event.providerId || "") || null;
    rows.push({
      provider_id: event.providerId || "",
      therapist_id: event.therapistId || (therapist && therapist._id) || "",
      licensure_record_id: "",
      name: (therapist && therapist.name) || "Unnamed therapist",
      credentials: (therapist && therapist.credentials) || "",
      location: therapist ? [therapist.city, therapist.state, therapist.zip].filter(Boolean).join(", ") : "",
      license_status: "",
      official_profile_url: "",
      profile_link: therapist && therapist.slug ? `therapist.html?slug=${therapist.slug}` : "",
      activity_type: event.eventType || "licensure_refresh_deferred",
      activity_at: event.createdAt || "",
      headline:
        event.decision === "unsnooze_now"
          ? "Licensure work reopened"
          : "Licensure refresh deferred",
      detail:
        event.decision === "unsnooze_now"
          ? "Deferred licensure work was returned to the active queue."
          : "Licensure work was snoozed for a later refresh window.",
    });
  });

  return rows
    .filter((row) => row.activity_at)
    .sort((a, b) => toTimestamp(b.activity_at) - toTimestamp(a.activity_at))
    .slice(0, 40);
}

function writeCsv(rows) {
  const headers = [
    "provider_id",
    "therapist_id",
    "licensure_record_id",
    "name",
    "credentials",
    "location",
    "license_status",
    "activity_type",
    "activity_at",
    "headline",
    "detail",
    "profile_link",
    "official_profile_url",
  ];
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header] || "")).join(","));
  });
  fs.writeFileSync(OUTPUT_CSV, `${lines.join("\n")}\n`, "utf8");
}

function writeMarkdown(rows) {
  const lines = ["# Licensure Activity Feed", "", `Generated: ${new Date().toISOString()}`, "", `- Activity items: ${rows.length}`, "", "## Recent activity", ""];
  rows.slice(0, 25).forEach((row, index) => {
    lines.push(`### ${index + 1}. ${row.name || "Unnamed therapist"}`);
    lines.push(`- Activity: ${labelActivityType(row.activity_type)}`);
    lines.push(`- Date: ${formatDate(row.activity_at)}`);
    lines.push(`- Headline: ${row.headline || "Licensure update"}`);
    if (row.detail) {
      lines.push(`- Detail: ${row.detail}`);
    }
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
  console.log(`Generated licensure activity feed with ${rows.length} item(s).`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
