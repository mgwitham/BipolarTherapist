import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const OUTPUT_CSV = path.join(ROOT, "data", "import", "generated-operational-drift-checks.csv");
const OUTPUT_MD = path.join(ROOT, "data", "import", "generated-operational-drift-checks.md");
const FIELD_KEYS = [
  "estimatedWaitTime",
  "insuranceAccepted",
  "telehealthStates",
  "bipolarYearsExperience",
];

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
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
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
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
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
    _id: `therapist-publish-event-${therapist._id}-${Date.now()}`,
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
  const options = { limit: 50, all: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--all") options.all = true;
    if (arg.startsWith("--limit=")) {
      const value = Number(arg.split("=")[1]);
      if (Number.isFinite(value) && value > 0) options.limit = Math.floor(value);
    }
  }
  return options;
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
    bookingUrl,
    bio,
    careApproach,
    specialties,
    insuranceAccepted,
    languages,
    sourceUrl,
    sourceReviewedAt,
    sourceHealthStatus,
    sourceDriftSignals,
    therapistReportedFields,
    therapistReportedConfirmedAt,
    fieldReviewStates,
    verificationLane,
    verificationPriority,
    nextReviewDueAt,
    dataCompletenessScore
  }`);
}

function chooseFieldsForDrift(therapist) {
  const reported = Array.isArray(therapist.therapistReportedFields)
    ? therapist.therapistReportedFields.filter((value) => FIELD_KEYS.includes(value))
    : [];
  if (reported.length) {
    return reported;
  }
  return FIELD_KEYS.filter((field) => {
    if (field === "estimatedWaitTime") return Boolean(therapist.estimatedWaitTime);
    if (field === "insuranceAccepted") {
      return Array.isArray(therapist.insuranceAccepted) && therapist.insuranceAccepted.length > 0;
    }
    if (field === "telehealthStates") {
      return Array.isArray(therapist.telehealthStates) && therapist.telehealthStates.length > 0;
    }
    if (field === "bipolarYearsExperience") return therapist.bipolarYearsExperience != null;
    return false;
  });
}

function detectDrift(therapist) {
  const confirmationAgeDays = daysSince(therapist.therapistReportedConfirmedAt);
  const sourceHealthDegraded =
    therapist.sourceHealthStatus && !["healthy", "redirected"].includes(therapist.sourceHealthStatus);
  const fields = chooseFieldsForDrift(therapist).filter((field) => {
    const current = therapist.fieldReviewStates && therapist.fieldReviewStates[field];
    return current !== "needs_reconfirmation";
  });

  const reasons = [];
  if (confirmationAgeDays !== null && confirmationAgeDays >= 60) {
    reasons.push(`therapist confirmation is ${confirmationAgeDays} days old`);
  }
  if (sourceHealthDegraded) {
    reasons.push(`source health is ${therapist.sourceHealthStatus}`);
  }

  return {
    shouldFlag: reasons.length > 0 && fields.length > 0,
    fields,
    reasons,
    confirmationAgeDays,
  };
}

function buildCsv(rows) {
  const headers = [
    "therapist_id",
    "provider_id",
    "name",
    "location",
    "fields_flagged",
    "reasons",
    "verification_lane",
    "priority",
    "next_review_due_at",
  ];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

function buildMarkdown(rows) {
  const lines = ["# Operational Drift Checks", ""];
  if (!rows.length) {
    lines.push("No therapists required operational drift escalation right now.");
    return lines.join("\n");
  }
  for (const row of rows) {
    lines.push(`## ${row.name || row.therapist_id}`);
    lines.push(`- Location: ${row.location || "Unknown"}`);
    lines.push(`- Fields flagged: ${row.fields_flagged || "None"}`);
    lines.push(`- Reasons: ${row.reasons || "None"}`);
    lines.push(`- Verification lane: ${row.verification_lane}`);
    lines.push(`- Priority: ${row.priority}`);
    lines.push(`- Next review due: ${row.next_review_due_at || "Now"}`);
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
  const queue = (options.all ? therapists : therapists.filter((therapist) => detectDrift(therapist).shouldFlag)).slice(0, options.limit);
  const rows = [];

  for (const therapist of queue) {
    const drift = detectDrift(therapist);
    if (!drift.shouldFlag) continue;

    const nextFieldStates = {
      ...(therapist.fieldReviewStates || {}),
    };
    for (const field of drift.fields) {
      nextFieldStates[field] = "needs_reconfirmation";
    }

    const verificationMeta = computeTherapistVerificationMeta({
      ...therapist,
      fieldReviewStates: nextFieldStates,
    });

    const changedFields = ["fieldReviewStates", "verificationLane", "verificationPriority", "nextReviewDueAt", "dataCompletenessScore"];
    const note = `Operational drift detected: ${drift.reasons.join("; ")}. Fields flagged: ${drift.fields.join(", ")}.`;

    const transaction = client.transaction();
    transaction.patch(therapist._id, (patch) =>
      patch.set({
        fieldReviewStates: nextFieldStates,
        verificationLane: verificationMeta.verificationLane,
        verificationPriority: verificationMeta.verificationPriority,
        nextReviewDueAt: verificationMeta.nextReviewDueAt,
        dataCompletenessScore: verificationMeta.dataCompletenessScore,
      }),
    );
    transaction.create(
      buildTherapistOpsEvent(therapist, {
        eventType: "therapist_field_drift_detected",
        decision: "operational_drift_check",
        notes: note,
        changedFields,
      }),
    );
    await transaction.commit({ visibility: "sync" });

    rows.push({
      therapist_id: therapist._id,
      provider_id: therapist.providerId || "",
      name: therapist.name || "",
      location: [therapist.city, therapist.state, therapist.zip].filter(Boolean).join(", "),
      fields_flagged: drift.fields.join(" · "),
      reasons: drift.reasons.join(" · "),
      verification_lane: verificationMeta.verificationLane,
      priority: verificationMeta.verificationPriority,
      next_review_due_at: formatDate(verificationMeta.nextReviewDueAt),
    });
  }

  fs.writeFileSync(OUTPUT_CSV, `${buildCsv(rows)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, `${buildMarkdown(rows)}\n`, "utf8");
  console.log(
    `Checked ${queue.length} therapist operational profile(s) and wrote ${path.relative(ROOT, OUTPUT_CSV)} plus ${path.relative(ROOT, OUTPUT_MD)}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
