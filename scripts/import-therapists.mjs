import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

import {
  normalizeUrl,
  validateBookingUrl,
  validateEmail,
  validatePhone,
  validatePublicContactPresence,
  validateWebsite,
} from "../shared/contact-validation.mjs";
import { resolvePreferredContactMethod } from "../shared/contact-modal-content.mjs";

const ROOT = process.cwd();
const DEFAULT_CSV_PATH = path.join(ROOT, "data", "import", "therapists.csv");
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

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function parseFieldReviewState(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    normalized === "editorially_verified" ||
    normalized === "needs_reconfirmation" ||
    normalized === "therapist_confirmed"
  ) {
    return normalized;
  }
  return "therapist_confirmed";
}

function parsePhotoSourceType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    normalized === "therapist_uploaded" ||
    normalized === "practice_uploaded" ||
    normalized === "public_source"
  ) {
    return normalized;
  }
  return "";
}

function parseClaimStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "claimed" || normalized === "claim_requested" || normalized === "unclaimed") {
    return normalized;
  }
  return "unclaimed";
}

function buildTherapistDocument(row) {
  const slug = row.slug || slugify([row.name, row.city, row.state].filter(Boolean).join(" "));
  if (!row.name || !slug || !row.city || !row.state || !row.bio || !row.credentials) {
    throw new Error(
      `Each row needs at least name, credentials, city, state, bio, and a usable slug. Problem row: ${JSON.stringify(row)}`,
    );
  }

  const documentId = `therapist-${slug}`;

  return {
    _id: documentId,
    _type: "therapist",
    name: row.name,
    slug: {
      _type: "slug",
      current: slug,
    },
    credentials: row.credentials,
    title: row.title || "",
    bio: row.bio,
    bioPreview: row.bioPreview || row.bio,
    photoSourceType: parsePhotoSourceType(row.photoSourceType),
    photoReviewedAt: row.photoReviewedAt || "",
    photoUsagePermissionConfirmed: parseBoolean(row.photoUsagePermissionConfirmed, false),
    practiceName: row.practiceName || "",
    email: row.email || "",
    phone: row.phone || "",
    website: row.website || "",
    preferredContactMethod: row.preferredContactMethod || "",
    preferredContactLabel: row.preferredContactLabel || "",
    contactGuidance: row.contactGuidance || "",
    firstStepExpectation: row.firstStepExpectation || "",
    bookingUrl: row.bookingUrl || "",
    claimStatus: parseClaimStatus(row.claimStatus),
    claimedByEmail: row.claimedByEmail || "",
    claimedAt: row.claimedAt || "",
    portalLastSeenAt: row.portalLastSeenAt || "",
    listingPauseRequestedAt: row.listingPauseRequestedAt || "",
    listingRemovalRequestedAt: row.listingRemovalRequestedAt || "",
    city: row.city,
    state: row.state,
    zip: row.zip || "",
    country: row.country || "US",
    licenseState: row.licenseState || "",
    licenseNumber: row.licenseNumber || "",
    careApproach: row.careApproach || "",
    treatmentModalities: splitList(row.treatmentModalities),
    clientPopulations: splitList(row.clientPopulations),
    specialties: splitList(row.specialties),
    insuranceAccepted: splitList(row.insuranceAccepted),
    languages: splitList(row.languages).length ? splitList(row.languages) : ["English"],
    yearsExperience: parseNumber(row.yearsExperience),
    bipolarYearsExperience: parseNumber(row.bipolarYearsExperience),
    acceptsTelehealth: parseBoolean(row.acceptsTelehealth, true),
    acceptsInPerson: parseBoolean(row.acceptsInPerson, true),
    acceptingNewPatients: parseBoolean(row.acceptingNewPatients, true),
    telehealthStates: splitList(row.telehealthStates),
    estimatedWaitTime: row.estimatedWaitTime || "",
    medicationManagement: parseBoolean(row.medicationManagement, false),
    verificationStatus: row.verificationStatus || "under_review",
    sourceUrl: row.sourceUrl || row.website || "",
    supportingSourceUrls: splitList(row.supportingSourceUrls),
    sourceReviewedAt: row.sourceReviewedAt || "",
    therapistReportedFields: splitList(row.therapistReportedFields),
    therapistReportedConfirmedAt: row.therapistReportedConfirmedAt || "",
    fieldReviewStates: {
      estimatedWaitTime: parseFieldReviewState(row.estimatedWaitTimeReviewState),
      insuranceAccepted: parseFieldReviewState(row.insuranceAcceptedReviewState),
      telehealthStates: parseFieldReviewState(row.telehealthStatesReviewState),
      bipolarYearsExperience: parseFieldReviewState(row.bipolarYearsExperienceReviewState),
    },
    sessionFeeMin: parseNumber(row.sessionFeeMin),
    sessionFeeMax: parseNumber(row.sessionFeeMax),
    slidingScale: parseBoolean(row.slidingScale, false),
    listingActive: parseBoolean(row.listingActive, true),
    status: row.status || "active",
  };
}

function getLegacyTherapistIds(document) {
  const slug = document.slug && document.slug.current ? document.slug.current : "";
  if (!slug) {
    return [];
  }

  return [`therapist.${slug}`, `drafts.therapist.${slug}`];
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

async function run() {
  const csvPath = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : DEFAULT_CSV_PATH;
  if (!fs.existsSync(csvPath)) {
    throw new Error(
      `Could not find CSV file at ${csvPath}. Copy data/import/therapists-template.csv to data/import/therapists.csv first.`,
    );
  }

  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    throw new Error("Missing Sanity project config. Check .env and studio/.env.");
  }

  if (!config.token) {
    throw new Error(
      "Missing SANITY_API_TOKEN. Create a write-enabled token in Sanity Manage and run the import like: SANITY_API_TOKEN=... npm run cms:import:therapists",
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
    throw new Error(`No therapist rows found in ${csvPath}.`);
  }

  const rawDocuments = rows.map(buildTherapistDocument);

  const CONTACT_VALIDATORS = [
    { field: "email", validate: validateEmail },
    { field: "phone", validate: validatePhone },
    { field: "website", validate: validateWebsite },
    { field: "bookingUrl", validate: validateBookingUrl },
  ];

  const documents = [];
  let clearedRecordCount = 0;
  let skippedCount = 0;

  rawDocuments.forEach(function (document) {
    // Normalize scraped URL fields so a bare domain ("practice.com")
    // becomes "https://practice.com" before both validation and insert.
    if (document.website) {
      document.website = normalizeUrl(document.website);
    }
    if (document.bookingUrl) {
      document.bookingUrl = normalizeUrl(document.bookingUrl);
    }

    const clearedFields = [];
    CONTACT_VALIDATORS.forEach(function (spec) {
      const value = document[spec.field];
      if (value === undefined || value === null || value === "") {
        return;
      }
      const result = spec.validate(value);
      if (!result.valid) {
        clearedFields.push({ field: spec.field, value: value, reason: result.error });
        document[spec.field] = "";
      }
    });

    if (clearedFields.length) {
      clearedRecordCount += 1;
      clearedFields.forEach(function (entry) {
        console.warn(
          `WARN cleared ${entry.field} on "${document.name}" (slug: ${document.slug && document.slug.current}): ${JSON.stringify(entry.value)} — ${entry.reason}`,
        );
      });
    }

    const presence = validatePublicContactPresence({
      email: document.email,
      phone: document.phone,
      website: document.website,
      bookingUrl: document.bookingUrl,
    });
    if (!presence.valid) {
      skippedCount += 1;
      console.warn(`Skipped: ${document.name} — no valid public contact method after validation.`);
      return;
    }

    // Default-picker: if the CSV didn't set preferredContactMethod (or
    // set it to a field that ended up empty after validation-clearing),
    // fill it in with the first non-empty of booking > website > phone
    // > email. This matches the contact modal's layout-selection order
    // so a published record always has a deterministic primary CTA.
    document.preferredContactMethod = resolvePreferredContactMethod(document) || "";

    documents.push(document);
  });

  if (!documents.length) {
    console.log(
      `Ingestion summary: 0 records ingested, ${clearedRecordCount} had fields cleared, ${skippedCount} skipped.`,
    );
    return;
  }

  const transaction = client.transaction();

  documents.forEach(function (document) {
    transaction.createOrReplace(document);
    transaction.delete(`drafts.${document._id}`);
    getLegacyTherapistIds(document).forEach(function (legacyId) {
      transaction.delete(legacyId);
    });
  });

  await transaction.commit({ visibility: "sync" });

  console.log(
    `Imported ${documents.length} therapist record(s) into Sanity dataset "${config.dataset}" and cleaned up any legacy therapist IDs.`,
  );
  console.log(
    `Ingestion summary: ${documents.length} records ingested, ${clearedRecordCount} had fields cleared, ${skippedCount} skipped entirely.`,
  );
}

run().catch(function (error) {
  console.error(error.message || error);
  process.exitCode = 1;
});
