import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";
import { buildProviderId } from "../shared/therapist-domain.mjs";

const ROOT = process.cwd();
const DEFAULT_CSV_PATH = path.join(ROOT, "data", "import", "therapist-candidates.csv");
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

function parseCsv(content) {
  const rows = [];
  let current = "";
  let row = [];
  let insideQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (character === "," && !insideQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(current);
      current = "";
      if (
        row.some(function (value) {
          return value.trim() !== "";
        })
      ) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    current += character;
  }

  if (current.length || row.length) {
    row.push(current);
    if (
      row.some(function (value) {
        return value.trim() !== "";
      })
    ) {
      rows.push(row);
    }
  }

  return rows;
}

function mapRowsToObjects(rows) {
  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map(function (header) {
    return header.trim();
  });

  return rows.slice(1).map(function (values) {
    return headers.reduce(function (accumulator, header, index) {
      accumulator[header] = (values[index] || "").trim();
      return accumulator;
    }, {});
  });
}

function splitList(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split("|")
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function parseNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeKeySegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeLicenseSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function normalizeWebsite(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.hostname.toLowerCase()}${pathname}`;
  } catch (_error) {
    return raw
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");
  }
}

function buildProviderFingerprint(record) {
  const providerId = buildProviderId(record);
  const website = normalizeWebsite(record.website || record.bookingUrl || record.booking_url);
  const email = normalizeEmail(record.email);
  const phone = normalizePhone(record.phone);
  return [providerId, website, email, phone].filter(Boolean).join("|");
}

function addDays(isoString, days) {
  const base = isoString ? new Date(isoString) : new Date();
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date();
    fallback.setUTCDate(fallback.getUTCDate() + days);
    return fallback.toISOString();
  }
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString();
}

function computeCandidateReviewMeta(input) {
  const readiness = Number(input.readinessScore || 0) || 0;
  const extractionConfidence = Number(input.extractionConfidence || 0) || 0;
  const reviewStatus = String(input.reviewStatus || "queued")
    .trim()
    .toLowerCase();
  const dedupeStatus = String(input.dedupeStatus || "unreviewed")
    .trim()
    .toLowerCase();
  const publishRecommendation = String(input.publishRecommendation || "")
    .trim()
    .toLowerCase();
  const now = new Date().toISOString();

  if (reviewStatus === "published" || reviewStatus === "archived") {
    return { reviewLane: "archived", reviewPriority: 10, nextReviewDueAt: addDays(now, 30) };
  }
  if (dedupeStatus === "possible_duplicate") {
    return { reviewLane: "resolve_duplicates", reviewPriority: 96, nextReviewDueAt: now };
  }
  if (reviewStatus === "needs_confirmation" || publishRecommendation === "needs_confirmation") {
    return {
      reviewLane: "needs_confirmation",
      reviewPriority: Math.max(72, Math.min(88, readiness || 72)),
      nextReviewDueAt: addDays(now, 2),
    };
  }
  if (reviewStatus === "ready_to_publish" || publishRecommendation === "ready") {
    return {
      reviewLane: "publish_now",
      reviewPriority: Math.max(85, Math.min(98, readiness || 85)),
      nextReviewDueAt: now,
    };
  }
  return {
    reviewLane: "editorial_review",
    reviewPriority: Math.max(
      52,
      Math.min(84, Math.round(readiness * 0.7 + extractionConfidence * 20 + 10)),
    ),
    nextReviewDueAt: addDays(now, readiness >= 70 ? 1 : 4),
  };
}

function parseSourceType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    normalized === "practice_website" ||
    normalized === "directory_profile" ||
    normalized === "licensing_board" ||
    normalized === "therapist_submitted" ||
    normalized === "manual_research" ||
    normalized === "import_batch"
  ) {
    return normalized;
  }
  return "manual_research";
}

function parseReviewStatus(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    normalized === "queued" ||
    normalized === "needs_review" ||
    normalized === "needs_confirmation" ||
    normalized === "ready_to_publish" ||
    normalized === "published" ||
    normalized === "archived"
  ) {
    return normalized;
  }
  return fallback;
}

function parseDedupeStatus(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    normalized === "unreviewed" ||
    normalized === "unique" ||
    normalized === "possible_duplicate" ||
    normalized === "merged" ||
    normalized === "rejected_duplicate"
  ) {
    return normalized;
  }
  return fallback;
}

function buildCandidateId(row, fallbackIndex) {
  return (
    row.candidateId ||
    [row.name, row.city, row.state, row.licenseState || row.license_number || "", fallbackIndex]
      .filter(Boolean)
      .map(slugify)
      .filter(Boolean)
      .join("-")
  );
}

function compareIdentity(candidateIdentity, record) {
  const reasons = [];
  const recordLicenseState = normalizeKeySegment(record.licenseState || record.license_state);
  const recordLicenseNumber = normalizeLicenseSegment(
    record.licenseNumber || record.license_number,
  );
  const recordProviderId = String(record.providerId || record.provider_id || "").trim();
  const recordWebsite = normalizeWebsite(record.website || record.bookingUrl || record.booking_url);
  const recordEmail = normalizeEmail(record.email);
  const recordPhone = normalizePhone(record.phone);
  const sameNamePlace =
    candidateIdentity.name &&
    candidateIdentity.city &&
    candidateIdentity.state &&
    candidateIdentity.name === normalizeKeySegment(record.name) &&
    candidateIdentity.city === normalizeKeySegment(record.city) &&
    candidateIdentity.state === normalizeKeySegment(record.state);

  if (
    candidateIdentity.licenseState &&
    candidateIdentity.licenseNumber &&
    candidateIdentity.licenseState === recordLicenseState &&
    candidateIdentity.licenseNumber === recordLicenseNumber
  ) {
    reasons.push("license");
  }
  if (candidateIdentity.providerId && candidateIdentity.providerId === recordProviderId) {
    reasons.push("provider_id");
  }
  if (candidateIdentity.website && candidateIdentity.website === recordWebsite) {
    reasons.push("website");
  }
  if (candidateIdentity.email && candidateIdentity.email === recordEmail) {
    reasons.push("email");
  }
  if (sameNamePlace && candidateIdentity.phone && candidateIdentity.phone === recordPhone) {
    reasons.push("name_location_phone");
  }

  return reasons;
}

function buildCandidateDocument(row, context, index) {
  const candidateId = buildCandidateId(row, index + 1);
  if (!row.name || !row.city || !row.state) {
    throw new Error(
      `Each candidate row needs at least name, city, and state. Problem row: ${JSON.stringify(row)}`,
    );
  }

  const identity = {
    providerId: buildProviderId(row),
    name: normalizeKeySegment(row.name),
    city: normalizeKeySegment(row.city),
    state: normalizeKeySegment(row.state),
    licenseState: normalizeKeySegment(row.licenseState),
    licenseNumber: normalizeLicenseSegment(row.licenseNumber),
    website: normalizeWebsite(row.website || row.bookingUrl),
    email: normalizeEmail(row.email),
    phone: normalizePhone(row.phone),
  };

  const therapistMatch = context.therapists.find(function (record) {
    return compareIdentity(identity, record).length > 0;
  });
  const applicationMatch = context.applications.find(function (record) {
    return compareIdentity(identity, record).length > 0;
  });
  const existingCandidateMatch = context.candidates.find(function (record) {
    return record.candidateId !== candidateId && compareIdentity(identity, record).length > 0;
  });

  const hasDuplicate = Boolean(therapistMatch || applicationMatch || existingCandidateMatch);
  const dedupeStatus = parseDedupeStatus(
    row.dedupeStatus,
    hasDuplicate ? "possible_duplicate" : "unique",
  );
  const reviewStatus = parseReviewStatus(
    row.reviewStatus,
    hasDuplicate ? "needs_review" : "queued",
  );
  const readinessScore = parseNumber(row.readinessScore);
  const extractionConfidence = parseNumber(row.extractionConfidence);
  const reviewMeta = computeCandidateReviewMeta({
    readinessScore,
    extractionConfidence,
    reviewStatus,
    dedupeStatus,
    publishRecommendation: row.publishRecommendation || (hasDuplicate ? "hold" : ""),
  });

  return {
    _id: `therapist-candidate-${candidateId}`,
    _type: "therapistCandidate",
    candidateId: candidateId,
    providerId: identity.providerId,
    providerFingerprint: buildProviderFingerprint(row),
    name: row.name,
    credentials: row.credentials || "",
    title: row.title || "",
    practiceName: row.practiceName || "",
    city: row.city,
    state: row.state,
    zip: row.zip || "",
    country: row.country || "US",
    licenseState: row.licenseState || "",
    licenseNumber: row.licenseNumber || "",
    email: row.email || "",
    phone: row.phone || "",
    website: row.website || "",
    bookingUrl: row.bookingUrl || "",
    sourceType: parseSourceType(row.sourceType),
    sourceUrl: row.sourceUrl || row.website || "",
    supportingSourceUrls: splitList(row.supportingSourceUrls),
    rawSourceSnapshot: row.rawSourceSnapshot || "",
    extractedAt: row.extractedAt || "",
    sourceReviewedAt: row.sourceReviewedAt || "",
    extractionVersion: row.extractionVersion || "manual-v1",
    extractionConfidence: extractionConfidence,
    careApproach: row.careApproach || "",
    specialties: splitList(row.specialties),
    treatmentModalities: splitList(row.treatmentModalities),
    clientPopulations: splitList(row.clientPopulations),
    insuranceAccepted: splitList(row.insuranceAccepted),
    languages: splitList(row.languages),
    acceptsTelehealth: parseBoolean(row.acceptsTelehealth, true),
    acceptsInPerson: parseBoolean(row.acceptsInPerson, true),
    acceptingNewPatients: parseBoolean(row.acceptingNewPatients, false),
    telehealthStates: splitList(row.telehealthStates),
    estimatedWaitTime: row.estimatedWaitTime || "",
    medicationManagement: parseBoolean(row.medicationManagement, false),
    sessionFeeMin: parseNumber(row.sessionFeeMin),
    sessionFeeMax: parseNumber(row.sessionFeeMax),
    slidingScale: parseBoolean(row.slidingScale, false),
    dedupeStatus: dedupeStatus,
    dedupeConfidence:
      parseNumber(row.dedupeConfidence) ||
      (hasDuplicate ? 0.9 : parseNumber(row.extractionConfidence)),
    matchedTherapistSlug: therapistMatch ? therapistMatch.slug || "" : "",
    matchedTherapistId: therapistMatch ? therapistMatch._id || "" : "",
    matchedApplicationId: applicationMatch ? applicationMatch._id || "" : "",
    reviewStatus: reviewStatus,
    reviewLane: row.reviewLane || reviewMeta.reviewLane,
    reviewPriority: parseNumber(row.reviewPriority) ?? reviewMeta.reviewPriority,
    nextReviewDueAt: row.nextReviewDueAt || reviewMeta.nextReviewDueAt,
    lastReviewedAt: row.lastReviewedAt || "",
    readinessScore: readinessScore,
    publishRecommendation: row.publishRecommendation || (hasDuplicate ? "hold" : ""),
    notes: row.notes || "",
  };
}

async function fetchExistingContext(client) {
  const query = `{
    "therapists": *[_type == "therapist"]{
      _id, providerId, name, city, state, licenseState, licenseNumber, email, phone, website, bookingUrl,
      "slug": slug.current
    },
    "applications": *[_type == "therapistApplication" && status in ["pending", "reviewing", "requested_changes", "approved"]]{
      _id, providerId, name, city, state, licenseState, licenseNumber, email, phone, website, bookingUrl,
      "slug": submittedSlug
    },
    "candidates": *[_type == "therapistCandidate"]{
      _id, candidateId, providerId, name, city, state, licenseState, licenseNumber, email, phone, website, bookingUrl
    }
  }`;

  return client.fetch(query);
}

async function run() {
  const csvPath = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : DEFAULT_CSV_PATH;
  if (!fs.existsSync(csvPath)) {
    throw new Error(
      `Could not find CSV file at ${csvPath}. Copy data/import/therapist-candidates-template.csv to data/import/therapist-candidates.csv first.`,
    );
  }

  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    throw new Error("Missing Sanity project config. Check .env and studio/.env.");
  }

  if (!config.token) {
    throw new Error(
      "Missing SANITY_API_TOKEN. Create a write-enabled token in Sanity Manage and run the import like: SANITY_API_TOKEN=... npm run cms:import:candidates",
    );
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token,
    useCdn: false,
  });

  const csvContent = fs.readFileSync(csvPath, "utf8");
  const rows = mapRowsToObjects(parseCsv(csvContent));
  if (!rows.length) {
    throw new Error(`No therapist candidate rows found in ${csvPath}.`);
  }

  const context = await fetchExistingContext(client);
  const documents = rows.map(function (row, index) {
    return buildCandidateDocument(row, context, index);
  });

  const transaction = client.transaction();
  documents.forEach(function (document) {
    transaction.createOrReplace(document);
    transaction.delete(`drafts.${document._id}`);
  });

  await transaction.commit({ visibility: "sync" });

  const duplicateCount = documents.filter(function (document) {
    return document.dedupeStatus === "possible_duplicate";
  }).length;

  console.log(
    `Imported ${documents.length} therapist candidate record(s) into Sanity dataset "${config.dataset}". ${duplicateCount} candidate(s) were flagged as possible duplicates.`,
  );
}

run().catch(function (error) {
  console.error(error.message || error);
  process.exitCode = 1;
});
