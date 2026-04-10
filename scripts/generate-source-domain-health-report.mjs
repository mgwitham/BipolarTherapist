import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const OUTPUT_CSV = path.join(ROOT, "data", "import", "generated-source-domain-health-report.csv");
const OUTPUT_MD = path.join(ROOT, "data", "import", "generated-source-domain-health-report.md");

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

function getDomain(value) {
  if (!value) {
    return "";
  }
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch (_error) {
    return "";
  }
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) {
    return null;
  }
  return Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length);
}

function getRecommendedAction(group) {
  if (group.degradedCount >= 3) {
    return "Audit this domain and repair source strategy";
  }
  if (group.degradedCount > 0) {
    return "Review degraded listings on this domain";
  }
  if (group.agingCount >= 3) {
    return "Schedule a refresh wave for this domain";
  }
  return "Monitor";
}

function buildCsv(rows) {
  const headers = [
    "domain",
    "therapist_count",
    "degraded_count",
    "aging_count",
    "healthy_count",
    "avg_priority",
    "latest_health_check",
    "recommended_action",
    "example_therapists",
  ];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

function buildMarkdown(rows) {
  const lines = ["# Source Domain Health Report", ""];
  if (!rows.length) {
    lines.push("No source domains are represented in the current therapist graph.");
    return lines.join("\n");
  }

  for (const row of rows) {
    lines.push(`## ${row.domain}`);
    lines.push(`- Therapists: ${row.therapist_count}`);
    lines.push(`- Degraded: ${row.degraded_count}`);
    lines.push(`- Aging: ${row.aging_count}`);
    lines.push(`- Healthy: ${row.healthy_count}`);
    lines.push(`- Avg priority: ${row.avg_priority || "Not scored"}`);
    lines.push(`- Latest health check: ${row.latest_health_check || "Unknown"}`);
    lines.push(`- Recommended action: ${row.recommended_action}`);
    if (row.example_therapists) {
      lines.push(`- Examples: ${row.example_therapists}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function fetchTherapists(client) {
  return client.fetch(`*[_type == "therapist" && listingActive != false]{
    _id,
    name,
    sourceUrl,
    sourceHealthStatus,
    sourceHealthCheckedAt,
    verificationLane,
    verificationPriority
  }`);
}

async function main() {
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

  const therapists = await fetchTherapists(client);
  const groups = new Map();

  for (const therapist of therapists) {
    const domain = getDomain(therapist.sourceUrl);
    if (!domain) {
      continue;
    }

    const group = groups.get(domain) || {
      domain,
      therapistCount: 0,
      degradedCount: 0,
      agingCount: 0,
      healthyCount: 0,
      priorities: [],
      latestHealthCheck: "",
      examples: [],
    };

    group.therapistCount += 1;
    if (
      therapist.sourceHealthStatus &&
      !["healthy", "redirected"].includes(therapist.sourceHealthStatus)
    ) {
      group.degradedCount += 1;
    } else if (
      therapist.verificationLane === "refresh_now" ||
      therapist.verificationLane === "refresh_soon"
    ) {
      group.agingCount += 1;
    } else {
      group.healthyCount += 1;
    }

    if (Number.isFinite(therapist.verificationPriority)) {
      group.priorities.push(Number(therapist.verificationPriority));
    }

    if (
      therapist.sourceHealthCheckedAt &&
      (!group.latestHealthCheck ||
        new Date(therapist.sourceHealthCheckedAt).getTime() >
          new Date(group.latestHealthCheck).getTime())
    ) {
      group.latestHealthCheck = therapist.sourceHealthCheckedAt;
    }

    if (group.examples.length < 3 && therapist.name) {
      group.examples.push(therapist.name);
    }

    groups.set(domain, group);
  }

  const rows = Array.from(groups.values())
    .map((group) => ({
      domain: group.domain,
      therapist_count: group.therapistCount,
      degraded_count: group.degradedCount,
      aging_count: group.agingCount,
      healthy_count: group.healthyCount,
      avg_priority: average(group.priorities),
      latest_health_check: formatDate(group.latestHealthCheck),
      recommended_action: getRecommendedAction(group),
      example_therapists: group.examples.join(" · "),
    }))
    .sort((a, b) => {
      const degradedDiff = Number(b.degraded_count) - Number(a.degraded_count);
      if (degradedDiff) return degradedDiff;
      const agingDiff = Number(b.aging_count) - Number(a.aging_count);
      if (agingDiff) return agingDiff;
      return Number(b.therapist_count) - Number(a.therapist_count);
    });

  fs.writeFileSync(OUTPUT_CSV, `${buildCsv(rows)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, `${buildMarkdown(rows)}\n`, "utf8");

  console.log(
    `Generated source domain health report for ${rows.length} domain(s) to ${path.relative(ROOT, OUTPUT_CSV)} and ${path.relative(ROOT, OUTPUT_MD)}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
