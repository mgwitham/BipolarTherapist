import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const OUTPUT_CSV = path.join(ROOT, "data", "import", "generated-candidate-review-queue.csv");
const OUTPUT_MD = path.join(ROOT, "data", "import", "generated-candidate-review-queue.md");
const API_VERSION = "2026-04-02";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce(function (accumulator, line) {
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
  const raw = String(value == null ? "" : value);
  if (!/[",\n]/.test(raw)) {
    return raw;
  }
  return `"${raw.replace(/"/g, '""')}"`;
}

function joinList(value) {
  return Array.isArray(value) ? value.filter(Boolean).join(" | ") : "";
}

function formatDate(value) {
  return value ? String(value).slice(0, 10) : "";
}

function scoreCandidate(candidate) {
  let score = 0;
  if (candidate.licenseNumber) score += 25;
  if (candidate.website) score += 15;
  if (candidate.sourceUrl) score += 10;
  if (candidate.careApproach) score += 10;
  if (Array.isArray(candidate.specialties) && candidate.specialties.length) score += 10;
  if (Array.isArray(candidate.languages) && candidate.languages.length) score += 5;
  if (candidate.acceptingNewPatients) score += 5;
  if (candidate.preferredContactMethod) score += 5;
  if (candidate.extractionConfidence) score += Math.round(Number(candidate.extractionConfidence) * 15);
  if (candidate.dedupeStatus === "possible_duplicate") score -= 25;
  if (candidate.reviewStatus === "needs_confirmation") score -= 10;
  return Math.max(0, Math.min(100, score));
}

function getNextAction(candidate) {
  if (candidate.dedupeStatus === "possible_duplicate") {
    return "Review duplicate match";
  }
  if (candidate.reviewStatus === "needs_confirmation") {
    return "Request confirmation";
  }
  if (!candidate.licenseNumber) {
    return "Add license details";
  }
  if (!candidate.sourceUrl) {
    return "Add primary source";
  }
  if (!candidate.website && !candidate.phone && !candidate.email) {
    return "Add contact path";
  }
  return "Ready for editorial review";
}

function sortCandidates(candidates) {
  return candidates.slice().sort(function (a, b) {
    const scoreDelta = (b.readinessScore || 0) - (a.readinessScore || 0);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    const dedupePriority = a.dedupeStatus === "possible_duplicate" ? 1 : 0;
    const otherDedupePriority = b.dedupeStatus === "possible_duplicate" ? 1 : 0;
    if (dedupePriority !== otherDedupePriority) {
      return otherDedupePriority - dedupePriority;
    }

    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function buildCsv(candidates) {
  const headers = [
    "candidate_id",
    "name",
    "location",
    "provider_id",
    "review_status",
    "dedupe_status",
    "matched_therapist_slug",
    "matched_application_id",
    "readiness_score",
    "next_action",
    "source_type",
    "source_url",
    "license_number",
    "website",
    "specialties",
    "languages",
    "notes",
  ];

  const rows = candidates.map(function (candidate) {
    return [
      candidate.candidateId,
      candidate.name,
      [candidate.city, candidate.state, candidate.zip].filter(Boolean).join(", "),
      candidate.providerId,
      candidate.reviewStatus,
      candidate.dedupeStatus,
      candidate.matchedTherapistSlug,
      candidate.matchedApplicationId,
      candidate.readinessScore,
      candidate.nextAction,
      candidate.sourceType,
      candidate.sourceUrl,
      candidate.licenseNumber,
      candidate.website,
      joinList(candidate.specialties),
      joinList(candidate.languages),
      candidate.notes,
    ].map(csvEscape).join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

function buildMarkdown(candidates) {
  const queued = candidates.filter(function (candidate) {
    return candidate.reviewStatus === "queued" || candidate.reviewStatus === "needs_review";
  }).length;
  const duplicates = candidates.filter(function (candidate) {
    return candidate.dedupeStatus === "possible_duplicate";
  }).length;
  const confirmation = candidates.filter(function (candidate) {
    return candidate.reviewStatus === "needs_confirmation";
  }).length;
  const ready = candidates.filter(function (candidate) {
    return candidate.nextAction === "Ready for editorial review";
  }).length;

  const lines = [
    "# Candidate Review Queue",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Total candidates: ${candidates.length}`,
    `- Queued for review: ${queued}`,
    `- Possible duplicates: ${duplicates}`,
    `- Need confirmation: ${confirmation}`,
    `- Ready for editorial review: ${ready}`,
    "",
    "## Priority Candidates",
    "",
  ];

  candidates.slice(0, 15).forEach(function (candidate, index) {
    lines.push(`### ${index + 1}. ${candidate.name || "Unnamed candidate"}`);
    lines.push(`- Location: ${[candidate.city, candidate.state, candidate.zip].filter(Boolean).join(", ")}`);
    lines.push(`- Review status: ${candidate.reviewStatus || "queued"}`);
    lines.push(`- Dedupe status: ${candidate.dedupeStatus || "unreviewed"}`);
    lines.push(`- Readiness score: ${candidate.readinessScore || 0}`);
    lines.push(`- Next action: ${candidate.nextAction}`);
    if (candidate.matchedTherapistSlug) {
      lines.push(`- Matched therapist: ${candidate.matchedTherapistSlug}`);
    }
    if (candidate.matchedApplicationId) {
      lines.push(`- Matched application: ${candidate.matchedApplicationId}`);
    }
    if (candidate.sourceUrl) {
      lines.push(`- Source: ${candidate.sourceUrl}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

async function run() {
  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    throw new Error("Missing Sanity project config. Check .env and studio/.env.");
  }
  if (!config.token) {
    throw new Error(
      "Missing SANITY_API_TOKEN. Create a read/write token in Sanity Manage and run npm run cms:generate:candidate-review-queue.",
    );
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token,
    useCdn: false,
  });

  const rawCandidates = await client.fetch(`*[_type == "therapistCandidate"]{
    candidateId,
    providerId,
    name,
    city,
    state,
    zip,
    reviewStatus,
    dedupeStatus,
    matchedTherapistSlug,
    matchedApplicationId,
    sourceType,
    sourceUrl,
    licenseNumber,
    website,
    specialties,
    languages,
    notes,
    extractionConfidence,
    acceptingNewPatients,
    careApproach
  }`);

  const candidates = sortCandidates(
    rawCandidates.map(function (candidate) {
      const readinessScore =
        typeof candidate.readinessScore === "number"
          ? candidate.readinessScore
          : scoreCandidate(candidate);
      return {
        ...candidate,
        readinessScore: readinessScore,
        nextAction: getNextAction(candidate),
      };
    }),
  );

  fs.writeFileSync(OUTPUT_CSV, buildCsv(candidates));
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(candidates));

  console.log(
    `Wrote candidate review queue with ${candidates.length} candidate(s) to ${path.relative(ROOT, OUTPUT_CSV)} and ${path.relative(ROOT, OUTPUT_MD)}.`,
  );
}

run().catch(function (error) {
  console.error(error.message || error);
  process.exitCode = 1;
});
