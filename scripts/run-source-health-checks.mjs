import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

import { buildPublishEventId } from "../shared/therapist-publishing-domain.mjs";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const OUTPUT_CSV = path.join(ROOT, "data", "import", "generated-source-health-checks.csv");
const OUTPUT_MD = path.join(ROOT, "data", "import", "generated-source-health-checks.md");
const HEALTHY_STATUSES = new Set(["healthy", "redirected"]);
const FIELD_TRUST_KEYS = [
  "estimatedWaitTime",
  "insuranceAccepted",
  "telehealthStates",
  "bipolarYearsExperience",
];
const FIELD_STALE_AFTER_DAYS = {
  estimatedWaitTime: 21,
  insuranceAccepted: 45,
  telehealthStates: 45,
  bipolarYearsExperience: 180,
};
const DEGRADED_STATUS_PRIORITY = {
  missing_source: 99,
  not_found: 99,
  server_error: 97,
  timeout: 96,
  network_error: 95,
  blocked: 92,
  unknown: 90,
};

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

function addDays(value, days) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function daysSince(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function toValidDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

function computeTherapistCompletenessScore(record) {
  const checks = [
    Boolean(record.name),
    Boolean(record.credentials),
    Boolean(record.city && record.state),
    Boolean(record.email || record.phone || record.website || record.bookingUrl),
    Boolean(record.careApproach || record.bio),
    Array.isArray(record.specialties) ? record.specialties.length > 0 : Boolean(record.specialties),
    Array.isArray(record.insuranceAccepted)
      ? record.insuranceAccepted.length > 0
      : Boolean(record.insuranceAccepted),
    Array.isArray(record.languages) ? record.languages.length > 0 : Boolean(record.languages),
    Boolean(record.sourceUrl),
    Boolean(record.sourceReviewedAt || record.therapistReportedConfirmedAt),
  ];
  const passed = checks.filter(Boolean).length;
  return Math.round((passed / checks.length) * 100);
}

function getFieldReviewState(record, fieldName) {
  return (record.fieldReviewStates && record.fieldReviewStates[fieldName]) || "therapist_confirmed";
}

function getFieldSourceKind(record, fieldName, reviewState) {
  const hasSourceReview = Boolean(record.sourceReviewedAt);
  const hasTherapistConfirmation = Boolean(record.therapistReportedConfirmedAt);
  const reportedFields = Array.isArray(record.therapistReportedFields)
    ? record.therapistReportedFields
    : [];
  const sourceHealthDegraded =
    record.sourceHealthStatus &&
    !["healthy", "redirected"].includes(String(record.sourceHealthStatus));

  if (sourceHealthDegraded && reviewState === "needs_reconfirmation") {
    return "degraded_source";
  }
  if (
    reviewState === "editorially_verified" &&
    hasSourceReview &&
    hasTherapistConfirmation &&
    reportedFields.includes(fieldName)
  ) {
    return "blended";
  }
  if (reviewState === "editorially_verified" && hasSourceReview) {
    return "editorial_source_review";
  }
  if (hasTherapistConfirmation && reportedFields.includes(fieldName)) {
    return "therapist_confirmed";
  }
  if (hasSourceReview && hasTherapistConfirmation) {
    return "blended";
  }
  return "unknown";
}

function getFieldVerifiedAt(record, fieldName, sourceKind) {
  const sourceReviewedAt = toValidDate(record.sourceReviewedAt);
  const therapistConfirmedAt = toValidDate(record.therapistReportedConfirmedAt);

  if (sourceKind === "editorial_source_review" && sourceReviewedAt) {
    return sourceReviewedAt.toISOString();
  }
  if (sourceKind === "therapist_confirmed" && therapistConfirmedAt) {
    return therapistConfirmedAt.toISOString();
  }
  if (sourceKind === "blended") {
    const dates = [sourceReviewedAt, therapistConfirmedAt].filter(Boolean);
    if (dates.length) {
      return new Date(Math.max(...dates.map((value) => value.getTime()))).toISOString();
    }
  }
  if (therapistConfirmedAt && Array.isArray(record.therapistReportedFields)) {
    if (record.therapistReportedFields.includes(fieldName)) {
      return therapistConfirmedAt.toISOString();
    }
  }
  if (sourceReviewedAt) {
    return sourceReviewedAt.toISOString();
  }
  if (therapistConfirmedAt) {
    return therapistConfirmedAt.toISOString();
  }
  return "";
}

function computeFieldConfidenceScore(record, fieldName, reviewState, sourceKind) {
  let score =
    reviewState === "editorially_verified" ? 92 : reviewState === "needs_reconfirmation" ? 44 : 76;

  if (sourceKind === "blended") score += 3;
  else if (sourceKind === "degraded_source") score -= 16;
  else if (sourceKind === "unknown") score -= 10;

  const sourceAgeDays = toValidDate(record.sourceReviewedAt)
    ? Math.max(0, Math.floor((Date.now() - new Date(record.sourceReviewedAt).getTime()) / 86400000))
    : null;
  const confirmationAgeDays = toValidDate(record.therapistReportedConfirmedAt)
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(record.therapistReportedConfirmedAt).getTime()) / 86400000,
        ),
      )
    : null;

  if (sourceAgeDays !== null && sourceAgeDays >= 120) score -= 12;
  else if (sourceAgeDays !== null && sourceAgeDays >= 75) score -= 6;
  if (confirmationAgeDays !== null && confirmationAgeDays >= 120) score -= 16;
  else if (confirmationAgeDays !== null && confirmationAgeDays >= 60) score -= 8;

  return Math.max(5, Math.min(99, score));
}

function buildFieldTrustMeta(record) {
  return FIELD_TRUST_KEYS.reduce((accumulator, fieldName) => {
    const reviewState = getFieldReviewState(record, fieldName);
    const sourceKind = getFieldSourceKind(record, fieldName, reviewState);
    const verifiedAt = getFieldVerifiedAt(record, fieldName, sourceKind);
    const staleAfterDays = FIELD_STALE_AFTER_DAYS[fieldName];
    accumulator[fieldName] = {
      reviewState,
      confidenceScore: computeFieldConfidenceScore(record, fieldName, reviewState, sourceKind),
      sourceKind,
      verifiedAt,
      staleAfterDays,
      staleAfterAt: verifiedAt ? addDays(verifiedAt, staleAfterDays) : "",
    };
    return accumulator;
  }, {});
}

function computeTherapistVerificationMeta(record) {
  const now = new Date();
  const sourceReviewedAt = record.sourceReviewedAt ? new Date(record.sourceReviewedAt) : null;
  const therapistConfirmedAt = record.therapistReportedConfirmedAt
    ? new Date(record.therapistReportedConfirmedAt)
    : null;
  const validDates = [sourceReviewedAt, therapistConfirmedAt].filter((value) => {
    return value instanceof Date && !Number.isNaN(value.getTime());
  });
  const lastOperationalReviewAt = validDates.length
    ? new Date(Math.max(...validDates.map((value) => value.getTime()))).toISOString()
    : "";
  const needsReconfirmationFields = Object.entries(record.fieldReviewStates || {})
    .filter((entry) => entry[1] === "needs_reconfirmation")
    .map((entry) => entry[0]);
  const sourceAgeDays =
    sourceReviewedAt && !Number.isNaN(sourceReviewedAt.getTime())
      ? Math.max(0, Math.floor((now.getTime() - sourceReviewedAt.getTime()) / 86400000))
      : null;

  if (!lastOperationalReviewAt) {
    return {
      lastOperationalReviewAt: "",
      nextReviewDueAt: now.toISOString(),
      verificationPriority: 95,
      verificationLane: "needs_verification",
      dataCompletenessScore: computeTherapistCompletenessScore(record),
    };
  }

  if (needsReconfirmationFields.length) {
    return {
      lastOperationalReviewAt,
      nextReviewDueAt: addDays(lastOperationalReviewAt, 7),
      verificationPriority: Math.min(98, 82 + needsReconfirmationFields.length * 4),
      verificationLane: "needs_reconfirmation",
      dataCompletenessScore: computeTherapistCompletenessScore(record),
    };
  }

  if (sourceAgeDays !== null && sourceAgeDays >= 120) {
    return {
      lastOperationalReviewAt,
      nextReviewDueAt: addDays(lastOperationalReviewAt, 120),
      verificationPriority: 84,
      verificationLane: "refresh_now",
      dataCompletenessScore: computeTherapistCompletenessScore(record),
    };
  }

  if (sourceAgeDays !== null && sourceAgeDays >= 75) {
    return {
      lastOperationalReviewAt,
      nextReviewDueAt: addDays(lastOperationalReviewAt, 105),
      verificationPriority: 61,
      verificationLane: "refresh_soon",
      dataCompletenessScore: computeTherapistCompletenessScore(record),
    };
  }

  return {
    lastOperationalReviewAt,
    nextReviewDueAt: addDays(lastOperationalReviewAt, 120),
    verificationPriority: 28,
    verificationLane: "fresh",
    dataCompletenessScore: computeTherapistCompletenessScore(record),
  };
}

function buildTherapistOpsEvent(therapist, updates) {
  const now = new Date().toISOString();
  return {
    _id: buildPublishEventId(therapist._id),
    _type: "therapistPublishEvent",
    eventType: updates.eventType,
    providerId: therapist.providerId || "",
    candidateId: "",
    candidateDocumentId: "",
    applicationId: "",
    therapistId: therapist._id,
    decision: updates.decision || "",
    reviewStatus: "",
    publishRecommendation: "",
    notes: updates.notes || "",
    changedFields: Array.isArray(updates.changedFields) ? updates.changedFields : [],
    createdAt: now,
  };
}

function parseArgs(argv) {
  const options = {
    limit: 25,
    all: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg === "--all") {
      options.all = true;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const value = Number(arg.split("=")[1]);
      if (Number.isFinite(value) && value > 0) {
        options.limit = Math.floor(value);
      }
    }
  }

  return options;
}

async function fetchTherapists(client) {
  return client.fetch(`*[_type == "therapist" && listingActive != false] | order(coalesce(verificationPriority, 0) desc, coalesce(nextReviewDueAt, _updatedAt) asc) {
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
    bio,
    careApproach,
    specialties,
    insuranceAccepted,
    languages,
    sourceUrl,
    sourceReviewedAt,
    sourceHealthStatus,
    sourceHealthCheckedAt,
    sourceHealthStatusCode,
    sourceHealthFinalUrl,
    sourceHealthError,
    sourceDriftSignals,
    therapistReportedFields,
    therapistReportedConfirmedAt,
    fieldReviewStates,
    verificationLane,
    verificationPriority,
    nextReviewDueAt,
    dataCompletenessScore,
    "slug": slug.current
  }`);
}

function needsHealthCheck(therapist) {
  if (!therapist.sourceUrl) {
    return true;
  }
  const checkAgeDays = daysSince(therapist.sourceHealthCheckedAt);
  if (checkAgeDays === null || checkAgeDays >= 7) {
    return true;
  }
  if (!HEALTHY_STATUSES.has(String(therapist.sourceHealthStatus || ""))) {
    return true;
  }
  return therapist.verificationLane === "needs_verification";
}

function classifyHttpResult(sourceUrl, response) {
  const finalUrl = response.url || sourceUrl;
  if (response.status >= 200 && response.status < 300) {
    return {
      status:
        finalUrl &&
        finalUrl !== sourceUrl &&
        new URL(finalUrl).toString() !== new URL(sourceUrl).toString()
          ? "redirected"
          : "healthy",
      statusCode: response.status,
      finalUrl,
      error: "",
    };
  }
  if (response.status === 404 || response.status === 410) {
    return { status: "not_found", statusCode: response.status, finalUrl, error: "" };
  }
  if (response.status === 401 || response.status === 403) {
    return { status: "blocked", statusCode: response.status, finalUrl, error: "" };
  }
  if (response.status >= 500) {
    return { status: "server_error", statusCode: response.status, finalUrl, error: "" };
  }
  return { status: "unknown", statusCode: response.status, finalUrl, error: "" };
}

async function checkSourceUrl(sourceUrl) {
  if (!sourceUrl) {
    return {
      status: "missing_source",
      statusCode: null,
      finalUrl: "",
      error: "No primary source URL",
    };
  }

  try {
    const response = await fetch(sourceUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent": "BipolarTherapyHubOpsBot/1.0 (+source health check)",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12000),
    });
    return classifyHttpResult(sourceUrl, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Unknown error");
    const isTimeout =
      (error instanceof Error && error.name === "TimeoutError") || /timed out/i.test(message);
    return {
      status: isTimeout ? "timeout" : "network_error",
      statusCode: null,
      finalUrl: "",
      error: message,
    };
  }
}

function buildDriftSignals(therapist, result) {
  const signals = [];
  const sourceAgeDays = daysSince(therapist.sourceReviewedAt);
  if (result.status === "missing_source") {
    signals.push("missing_primary_source");
  }
  if (!HEALTHY_STATUSES.has(result.status)) {
    signals.push("source_unreachable");
  }
  if (result.status === "redirected") {
    signals.push("source_redirected");
  }
  if (sourceAgeDays !== null && sourceAgeDays >= 120) {
    signals.push("source_review_stale");
  }
  return Array.from(new Set(signals));
}

function computeVerificationPatch(therapist, result, nowIso) {
  if (!HEALTHY_STATUSES.has(result.status)) {
    return {
      lastOperationalReviewAt: therapist.lastOperationalReviewAt || "",
      nextReviewDueAt: nowIso,
      verificationPriority: DEGRADED_STATUS_PRIORITY[result.status] || 90,
      verificationLane: "needs_verification",
      dataCompletenessScore: computeTherapistCompletenessScore(therapist),
    };
  }

  return computeTherapistVerificationMeta(therapist);
}

function buildNotes(therapist, result, driftSignals) {
  if (result.status === "healthy") {
    return "Primary source URL responded normally.";
  }
  if (result.status === "redirected") {
    return `Primary source redirected to ${result.finalUrl || "another URL"}.`;
  }
  return [
    `Primary source health degraded: ${result.status}.`,
    result.error || "",
    driftSignals.length ? `Signals: ${driftSignals.join(", ")}.` : "",
    therapist.sourceUrl || "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildCsv(rows) {
  const headers = [
    "therapist_id",
    "provider_id",
    "name",
    "location",
    "source_url",
    "source_health_status",
    "status_code",
    "final_url",
    "verification_lane",
    "priority",
    "next_review_due_at",
    "drift_signals",
    "note",
  ];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

function buildMarkdown(rows) {
  const lines = ["# Source Health Checks", ""];
  if (!rows.length) {
    lines.push("No therapists required a source health check right now.");
    return lines.join("\n");
  }

  for (const row of rows) {
    lines.push(`## ${row.name || row.therapist_id}`);
    lines.push(`- Location: ${row.location || "Unknown"}`);
    lines.push(`- Source: ${row.source_url || "None"}`);
    lines.push(`- Source health: ${row.source_health_status}`);
    if (row.status_code) {
      lines.push(`- HTTP status: ${row.status_code}`);
    }
    if (row.final_url) {
      lines.push(`- Final URL: ${row.final_url}`);
    }
    lines.push(`- Verification lane: ${row.verification_lane}`);
    lines.push(`- Priority: ${row.priority}`);
    lines.push(`- Next review due: ${row.next_review_due_at || "Now"}`);
    if (row.drift_signals) {
      lines.push(`- Drift signals: ${row.drift_signals}`);
    }
    if (row.note) {
      lines.push(`- Note: ${row.note}`);
    }
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

  const therapists = await fetchTherapists(client);
  const queue = (options.all ? therapists : therapists.filter(needsHealthCheck)).slice(
    0,
    options.limit,
  );
  const rows = [];

  for (const therapist of queue) {
    const result = await checkSourceUrl(therapist.sourceUrl || "");
    const nowIso = new Date().toISOString();
    const driftSignals = buildDriftSignals(therapist, result);
    const verificationPatch = computeVerificationPatch(therapist, result, nowIso);
    const notes = buildNotes(therapist, result, driftSignals);
    const changedFields = [
      "sourceHealthStatus",
      "sourceHealthCheckedAt",
      "sourceHealthStatusCode",
      "sourceHealthFinalUrl",
      "sourceHealthError",
      "sourceDriftSignals",
      "verificationLane",
      "verificationPriority",
      "nextReviewDueAt",
      "dataCompletenessScore",
      "fieldTrustMeta",
    ];

    const patch = {
      sourceHealthStatus: result.status,
      sourceHealthCheckedAt: nowIso,
      sourceHealthStatusCode: result.statusCode,
      sourceHealthFinalUrl: result.finalUrl || "",
      sourceHealthError: result.error || "",
      sourceDriftSignals: driftSignals,
      verificationLane: verificationPatch.verificationLane,
      verificationPriority: verificationPatch.verificationPriority,
      nextReviewDueAt: verificationPatch.nextReviewDueAt,
      dataCompletenessScore: verificationPatch.dataCompletenessScore,
      fieldTrustMeta: buildFieldTrustMeta({
        ...therapist,
        sourceHealthStatus: result.status,
      }),
      ...(verificationPatch.lastOperationalReviewAt
        ? { lastOperationalReviewAt: verificationPatch.lastOperationalReviewAt }
        : {}),
    };

    const eventType =
      HEALTHY_STATUSES.has(result.status) &&
      HEALTHY_STATUSES.has(therapist.sourceHealthStatus || "")
        ? "therapist_source_checked"
        : HEALTHY_STATUSES.has(result.status)
          ? "therapist_source_checked"
          : "therapist_source_degraded";

    const transaction = client.transaction();
    transaction.patch(therapist._id, (draft) => draft.set(patch));
    transaction.create(
      buildTherapistOpsEvent(therapist, {
        eventType,
        decision: "source_health_check",
        notes,
        changedFields,
      }),
    );
    await transaction.commit({ visibility: "sync" });

    rows.push({
      therapist_id: therapist._id,
      provider_id: therapist.providerId || "",
      name: therapist.name || "",
      location: [therapist.city, therapist.state, therapist.zip].filter(Boolean).join(", "),
      source_url: therapist.sourceUrl || "",
      source_health_status: result.status,
      status_code: result.statusCode == null ? "" : result.statusCode,
      final_url: result.finalUrl || "",
      verification_lane: patch.verificationLane || "",
      priority: patch.verificationPriority == null ? "" : patch.verificationPriority,
      next_review_due_at: formatDate(patch.nextReviewDueAt),
      drift_signals: driftSignals.join(" · "),
      note: notes,
    });
  }

  fs.writeFileSync(OUTPUT_CSV, `${buildCsv(rows)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, `${buildMarkdown(rows)}\n`, "utf8");

  console.log(
    `Checked ${rows.length} therapist source(s) and wrote ${path.relative(ROOT, OUTPUT_CSV)} plus ${path.relative(ROOT, OUTPUT_MD)}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
