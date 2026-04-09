import process from "node:process";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@sanity/client";
import { handleApplicationRoutes } from "./review-application-routes.mjs";
import { handleAuthAndPortalRoutes } from "./review-auth-portal-routes.mjs";
import { handleCandidateRoutes } from "./review-candidate-routes.mjs";
import { handleOpsRoutes } from "./review-ops-routes.mjs";
import { normalizePortableApplication } from "../shared/application-domain.mjs";
import {
  buildCandidateReviewEvent,
  buildTherapistApplicationFieldPatch,
  buildTherapistDocument,
  buildTherapistDocumentFromCandidate,
  buildTherapistOpsEvent,
  normalizePortableApplicationDocument,
  normalizePortableCandidate,
} from "../shared/therapist-publishing-domain.mjs";
import {
  buildFieldTrustMeta,
  computeTherapistVerificationMeta,
} from "../shared/therapist-trust-domain.mjs";
import {
  buildDuplicateIdentity,
  buildProviderId,
  compareDuplicateIdentity,
  createTherapistConfirmedFieldReviewStates,
  mapFieldReviewStatesToCamelCase,
  mapFieldReviewStatesToSnakeCase,
  normalizeFieldReviewStates,
  normalizeLower,
  normalizeText,
  resolveApplicationIntakeType,
  slugify,
} from "../shared/therapist-domain.mjs";

const publishingHelpers = {
  mergeLicensureVerification,
  normalizeFieldReviewStates,
  normalizeLicensureVerification,
  parseBoolean,
  parseNumber,
  splitList,
};

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const DEFAULT_PORT = 8787;
const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const DEFAULT_LOGIN_WINDOW_MS = 1000 * 60 * 15;
const DEFAULT_LOGIN_MAX_ATTEMPTS = 10;
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;
const MAX_PHOTO_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED_PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const loginAttemptStore = new Map();

function parseBooleanEnv(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

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

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signValue(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function normalizeSlugCandidate(value) {
  return slugify(value || "");
}

function normalizeEmail(value) {
  return normalizeLower(value);
}

async function findDuplicateTherapistEntity(client, input) {
  const identity = buildDuplicateIdentity(input);
  const [therapists, applications] = await Promise.all([
    client.fetch(
      `*[_type == "therapist"]{
        _id,
        name,
        credentials,
        email,
        phone,
        website,
        bookingUrl,
        city,
        state,
        licenseState,
        licenseNumber,
        "slug": slug.current,
        listingActive,
        status
      }`,
    ),
    client.fetch(
      `*[_type == "therapistApplication" && status in ["pending", "reviewing", "requested_changes", "approved"]]{
        _id,
        name,
        credentials,
        email,
        phone,
        website,
        bookingUrl,
        city,
        state,
        licenseState,
        licenseNumber,
        submittedSlug,
        status,
        publishedTherapistId
      }`,
    ),
  ]);

  const therapistMatch = (therapists || []).find(function (candidate) {
    const reasons = compareDuplicateIdentity(identity, candidate);
    if (
      reasons.length &&
      candidate.listingActive !== false &&
      String(candidate.status || "active").toLowerCase() !== "archived"
    ) {
      candidate.__duplicateReasons = reasons;
      return true;
    }
    return false;
  });

  if (therapistMatch) {
    return {
      kind: "therapist",
      id: therapistMatch._id,
      slug: therapistMatch.slug || "",
      name: therapistMatch.name || "",
      reasons: therapistMatch.__duplicateReasons || [],
    };
  }

  const applicationMatch = (applications || []).find(function (candidate) {
    const shapedCandidate = {
      ...candidate,
      slug: candidate.submittedSlug || "",
    };
    const reasons = compareDuplicateIdentity(identity, shapedCandidate);
    if (reasons.length) {
      candidate.__duplicateReasons = reasons;
      return true;
    }
    return false;
  });

  if (applicationMatch) {
    return {
      kind: "application",
      id: applicationMatch._id,
      slug: applicationMatch.submittedSlug || "",
      name: applicationMatch.name || "",
      status: applicationMatch.status || "pending",
      publishedTherapistId: applicationMatch.publishedTherapistId || "",
      reasons: applicationMatch.__duplicateReasons || [],
    };
  }

  return null;
}

export function getReviewApiConfig() {
  const rootEnv = readEnvFile(path.join(ROOT, ".env"));
  const studioEnv = readEnvFile(path.join(ROOT, "studio", ".env"));
  const allowedOrigins = (
    process.env.REVIEW_API_ALLOWED_ORIGINS ||
    rootEnv.REVIEW_API_ALLOWED_ORIGINS ||
    [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5174",
      "http://localhost:5175",
      "http://127.0.0.1:5175",
    ].join(",")
  )
    .split(",")
    .map(function (origin) {
      return origin.trim();
    })
    .filter(Boolean);

  const config = {
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
    token: process.env.SANITY_API_TOKEN || rootEnv.SANITY_API_TOKEN || "",
    adminKey: process.env.REVIEW_API_ADMIN_KEY || rootEnv.REVIEW_API_ADMIN_KEY || "",
    adminUsername: process.env.REVIEW_API_ADMIN_USERNAME || rootEnv.REVIEW_API_ADMIN_USERNAME || "",
    adminPassword: process.env.REVIEW_API_ADMIN_PASSWORD || rootEnv.REVIEW_API_ADMIN_PASSWORD || "",
    explicitSessionSecret:
      process.env.REVIEW_API_SESSION_SECRET || rootEnv.REVIEW_API_SESSION_SECRET || "",
    port: Number(process.env.REVIEW_API_PORT || rootEnv.REVIEW_API_PORT || DEFAULT_PORT),
    allowedOrigins: allowedOrigins,
    sessionTtlMs: Number(
      process.env.REVIEW_API_SESSION_TTL_MS ||
        rootEnv.REVIEW_API_SESSION_TTL_MS ||
        DEFAULT_SESSION_TTL_MS,
    ),
    loginWindowMs: Number(
      process.env.REVIEW_API_LOGIN_WINDOW_MS ||
        rootEnv.REVIEW_API_LOGIN_WINDOW_MS ||
        DEFAULT_LOGIN_WINDOW_MS,
    ),
    loginMaxAttempts: Number(
      process.env.REVIEW_API_LOGIN_MAX_ATTEMPTS ||
        rootEnv.REVIEW_API_LOGIN_MAX_ATTEMPTS ||
        DEFAULT_LOGIN_MAX_ATTEMPTS,
    ),
    allowLegacyKey: parseBooleanEnv(
      process.env.REVIEW_API_ALLOW_LEGACY_KEY || rootEnv.REVIEW_API_ALLOW_LEGACY_KEY,
      false,
    ),
    resendApiKey: process.env.RESEND_API_KEY || rootEnv.RESEND_API_KEY || "",
    emailFrom: process.env.REVIEW_EMAIL_FROM || rootEnv.REVIEW_EMAIL_FROM || "",
    notificationTo: process.env.REVIEW_NOTIFICATION_TO || rootEnv.REVIEW_NOTIFICATION_TO || "",
  };

  config.sessionSecret =
    config.explicitSessionSecret || config.adminPassword || config.adminKey || "";

  if (!config.projectId || !config.dataset || !config.token) {
    throw new Error("Missing Sanity config or SANITY_API_TOKEN for review API.");
  }

  if (!config.adminKey && !(config.adminUsername && config.adminPassword)) {
    throw new Error(
      "Missing admin auth config for review API. Set REVIEW_API_ADMIN_KEY or REVIEW_API_ADMIN_USERNAME/REVIEW_API_ADMIN_PASSWORD.",
    );
  }

  if (!config.sessionSecret) {
    throw new Error("Missing REVIEW_API_SESSION_SECRET or admin password/key to sign sessions.");
  }

  if (process.env.NODE_ENV === "production" && !config.explicitSessionSecret) {
    throw new Error("Missing REVIEW_API_SESSION_SECRET in production.");
  }

  return config;
}

function hasEmailConfig(config) {
  return Boolean(config.resendApiKey && config.emailFrom && config.notificationTo);
}

function getSecurityWarnings(config) {
  const warnings = [];

  if (!config.explicitSessionSecret) {
    warnings.push("Session secret is falling back to another admin secret.");
  }

  if (config.allowLegacyKey && config.adminKey) {
    warnings.push("Legacy X-Admin-Key auth is enabled.");
  }

  if (config.adminPassword === "Password" || config.adminKey === "Password") {
    warnings.push('Admin auth still uses the placeholder value "Password".');
  }

  return warnings;
}

function getAllowedOrigin(origin, config) {
  if (!origin) {
    return "";
  }

  return config.allowedOrigins.includes(origin) ? origin : "";
}

function normalizeRoutePath(pathname) {
  if (!pathname) {
    return "/";
  }

  if (pathname === "/api/review" || pathname === "/api/review/") {
    return "/";
  }

  if (pathname.startsWith("/api/review/")) {
    return pathname.replace(/^\/api\/review/, "") || "/";
  }

  return pathname;
}

function sendJson(response, statusCode, payload, origin, config) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    Vary: "Origin",
  };
  const allowedOrigin = getAllowedOrigin(origin, config);
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
  }

  response.writeHead(statusCode, headers);
  response.end(JSON.stringify(payload));
}

function parseAuthorizationHeader(request) {
  const header = request.headers.authorization;
  if (!header || typeof header !== "string") {
    return "";
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function createSignedSession(config) {
  const payload = {
    sub: "admin",
    iat: Date.now(),
    exp: Date.now() + config.sessionTtlMs,
    nonce: crypto.randomBytes(12).toString("hex"),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signValue(encodedPayload, config.sessionSecret);
  return `${encodedPayload}.${signature}`;
}

function createSignedPayload(payload, secret) {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signValue(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function readSignedPayload(token, secret) {
  if (!token) {
    return null;
  }

  const parts = String(token).split(".");
  if (parts.length !== 2) {
    return null;
  }

  const encodedPayload = parts[0];
  const signature = parts[1];
  if (signValue(encodedPayload, secret) !== signature) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64Url(encodedPayload));
  } catch (_error) {
    return null;
  }
}

function readSignedSession(token, config) {
  const payload = readSignedPayload(token, config.sessionSecret);
  if (!payload || payload.sub !== "admin" || !payload.exp || payload.exp <= Date.now()) {
    return null;
  }

  return payload;
}

function isAuthorized(request, config) {
  const sessionPayload = readSignedSession(parseAuthorizationHeader(request), config);
  if (sessionPayload) {
    return true;
  }

  if (!config.allowLegacyKey || !config.adminKey) {
    return false;
  }

  const requestKey = request.headers["x-admin-key"];
  return typeof requestKey === "string" && requestKey === config.adminKey;
}

function parseBody(request) {
  return new Promise(function (resolve, reject) {
    let raw = "";

    request.on("data", function (chunk) {
      raw += chunk;
      if (raw.length > MAX_REQUEST_BODY_BYTES) {
        reject(new Error("Request body too large."));
        request.destroy();
      }
    });

    request.on("end", function () {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function getClientAddress(request) {
  return request.socket && request.socket.remoteAddress ? request.socket.remoteAddress : "unknown";
}

function purgeExpiredLoginWindows(config) {
  const now = Date.now();
  Array.from(loginAttemptStore.entries()).forEach(function ([key, value]) {
    if (!value || now - value.windowStartedAt > config.loginWindowMs) {
      loginAttemptStore.delete(key);
    }
  });
}

function canAttemptLogin(request, config) {
  purgeExpiredLoginWindows(config);
  const clientAddress = getClientAddress(request);
  const attempts = loginAttemptStore.get(clientAddress);
  if (!attempts) {
    return true;
  }

  return attempts.count < config.loginMaxAttempts;
}

function recordFailedLogin(request, config) {
  purgeExpiredLoginWindows(config);
  const clientAddress = getClientAddress(request);
  const existing = loginAttemptStore.get(clientAddress);

  if (!existing) {
    loginAttemptStore.set(clientAddress, {
      count: 1,
      windowStartedAt: Date.now(),
    });
    return;
  }

  loginAttemptStore.set(clientAddress, {
    count: existing.count + 1,
    windowStartedAt: existing.windowStartedAt,
  });
}

function clearFailedLogins(request) {
  const clientAddress = getClientAddress(request);
  loginAttemptStore.delete(clientAddress);
}

function splitList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(function (item) {
      return String(item || "").trim();
    })
    .filter(Boolean);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
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

function normalizeLicensureVerification(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const normalized = {
    jurisdiction: String(value.jurisdiction || "").trim(),
    sourceSystem: String(value.sourceSystem || "").trim(),
    boardName: String(value.boardName || "").trim(),
    boardCode: String(value.boardCode || "").trim(),
    licenseType: String(value.licenseType || "").trim(),
    primaryStatus: String(value.primaryStatus || "").trim(),
    statusStanding: String(value.statusStanding || "").trim(),
    issueDate: String(value.issueDate || "").trim(),
    expirationDate: String(value.expirationDate || "").trim(),
    addressOfRecord: String(value.addressOfRecord || "").trim(),
    addressCity: String(value.addressCity || "").trim(),
    addressState: String(value.addressState || "").trim(),
    addressZip: String(value.addressZip || "").trim(),
    county: String(value.county || "").trim(),
    professionalUrl: String(value.professionalUrl || "").trim(),
    profileUrl: String(value.profileUrl || "").trim(),
    searchUrl: String(value.searchUrl || "").trim(),
    verifiedAt: String(value.verifiedAt || "").trim(),
    verificationMethod: String(value.verificationMethod || "").trim(),
    confidenceScore: Number.isFinite(Number(value.confidenceScore))
      ? Number(value.confidenceScore)
      : undefined,
    disciplineFlag: Boolean(value.disciplineFlag),
    disciplineSummary: String(value.disciplineSummary || "").trim(),
    rawSnapshot: String(value.rawSnapshot || "").trim(),
  };

  const hasValue = Object.values(normalized).some(function (entry) {
    return entry !== "" && entry !== false && entry !== undefined;
  });
  return hasValue ? normalized : null;
}

function mergeLicensureVerification(existingValue, incomingValue) {
  const existing = normalizeLicensureVerification(existingValue);
  const incoming = normalizeLicensureVerification(incomingValue);
  if (!existing) return incoming;
  if (!incoming) return existing;

  const existingVerifiedAt = existing.verifiedAt ? new Date(existing.verifiedAt).getTime() : 0;
  const incomingVerifiedAt = incoming.verifiedAt ? new Date(incoming.verifiedAt).getTime() : 0;
  const preferred = incomingVerifiedAt >= existingVerifiedAt ? incoming : existing;
  const secondary = preferred === incoming ? existing : incoming;

  return normalizeLicensureVerification({
    ...secondary,
    ...preferred,
    disciplineFlag: Boolean(existing.disciplineFlag || incoming.disciplineFlag),
    disciplineSummary: [secondary.disciplineSummary, preferred.disciplineSummary]
      .filter(Boolean)
      .join("\n\n"),
  });
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

function decodeBase64FilePayload(payload) {
  const raw = String(payload || "").trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid headshot upload format.");
  }

  const mimeType = String(match[1] || "")
    .trim()
    .toLowerCase();
  const base64 = String(match[2] || "").trim();
  if (!ALLOWED_PHOTO_MIME_TYPES.has(mimeType)) {
    throw new Error("Headshot must be a JPG, PNG, or WebP image.");
  }

  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) {
    throw new Error("Headshot upload was empty.");
  }
  if (buffer.length > MAX_PHOTO_UPLOAD_BYTES) {
    throw new Error("Headshot image is too large. Keep it under 4 MB.");
  }

  return {
    mimeType: mimeType,
    buffer: buffer,
  };
}

async function uploadPhotoAssetIfPresent(client, input) {
  const decoded = decodeBase64FilePayload(input.photo_upload_base64);
  if (!decoded) {
    return null;
  }

  const filename =
    String(input.photo_filename || "therapist-headshot").trim() || "therapist-headshot";
  const asset = await client.assets.upload("image", decoded.buffer, {
    filename: filename,
    contentType: decoded.mimeType,
  });

  return {
    _type: "image",
    asset: {
      _type: "reference",
      _ref: asset._id,
    },
  };
}

async function buildApplicationDocument(client, input) {
  const slug = slugify(
    input.slug || [input.name, input.city, input.state].filter(Boolean).join(" "),
  );
  const now = new Date().toISOString();
  const photo = await uploadPhotoAssetIfPresent(client, input);
  const photoSourceType = parsePhotoSourceType(input.photo_source_type);
  const intakeType = resolveApplicationIntakeType(input);
  const providerId = buildProviderId(input);

  if (
    !input.name ||
    !input.credentials ||
    !input.email ||
    !input.city ||
    !input.state ||
    !input.bio ||
    !input.license_state ||
    !input.license_number ||
    !input.care_approach
  ) {
    throw new Error("Missing required application fields.");
  }

  return {
    _id: `therapist-application-${slug || Date.now()}-${Date.now()}`,
    _type: "therapistApplication",
    intakeType: intakeType,
    providerId: providerId,
    targetTherapistSlug: String(input.target_therapist_slug || input.slug || "").trim(),
    targetTherapistId: String(
      input.target_therapist_id || input.published_therapist_id || "",
    ).trim(),
    name: input.name.trim(),
    email: input.email.trim(),
    credentials: input.credentials.trim(),
    title: (input.title || "").trim(),
    ...(photo ? { photo: photo } : {}),
    photoSourceType: photoSourceType,
    photoReviewedAt: photoSourceType ? now : "",
    photoUsagePermissionConfirmed: parseBoolean(input.photo_usage_permission_confirmed, false),
    practiceName: (input.practice_name || "").trim(),
    phone: (input.phone || "").trim(),
    website: (input.website || "").trim(),
    preferredContactMethod: (input.preferred_contact_method || "").trim(),
    preferredContactLabel: (input.preferred_contact_label || "").trim(),
    contactGuidance: (input.contact_guidance || "").trim(),
    firstStepExpectation: (input.first_step_expectation || "").trim(),
    bookingUrl: (input.booking_url || "").trim(),
    city: input.city.trim(),
    state: input.state.trim(),
    zip: (input.zip || "").trim(),
    country: "US",
    licenseState: (input.license_state || "").trim().toUpperCase(),
    licenseNumber: (input.license_number || "").trim(),
    licensureVerification: normalizeLicensureVerification(input.licensure_verification),
    bio: input.bio.trim(),
    careApproach: (input.care_approach || "").trim(),
    specialties: splitList(input.specialties),
    treatmentModalities: splitList(input.treatment_modalities),
    clientPopulations: splitList(input.client_populations),
    insuranceAccepted: splitList(input.insurance_accepted),
    languages: splitList(input.languages).length ? splitList(input.languages) : ["English"],
    yearsExperience: parseNumber(input.years_experience),
    bipolarYearsExperience: parseNumber(input.bipolar_years_experience),
    acceptsTelehealth: parseBoolean(input.accepts_telehealth, true),
    acceptsInPerson: parseBoolean(input.accepts_in_person, true),
    acceptingNewPatients: true,
    telehealthStates: splitList(input.telehealth_states),
    estimatedWaitTime: (input.estimated_wait_time || "").trim(),
    medicationManagement: parseBoolean(input.medication_management, false),
    verificationStatus: "under_review",
    sourceUrl: (input.source_url || input.website || "").trim(),
    supportingSourceUrls: splitList(input.supporting_source_urls),
    sourceReviewedAt: (input.source_reviewed_at || "").trim(),
    therapistReportedFields: splitList(input.therapist_reported_fields),
    therapistReportedConfirmedAt: (input.therapist_reported_confirmed_at || "").trim() || now,
    fieldReviewStates: createTherapistConfirmedFieldReviewStates({
      keyStyle: "camelCase",
    }),
    sessionFeeMin: parseNumber(input.session_fee_min),
    sessionFeeMax: parseNumber(input.session_fee_max),
    slidingScale: parseBoolean(input.sliding_scale, false),
    status: "pending",
    notes: (input.notes || "").trim(),
    publishedTherapistId: (input.published_therapist_id || "").trim(),
    submittedSlug: slug,
    submittedAt: now,
    updatedAt: now,
  };
}

async function buildRevisionFieldUpdates(client, input, existingApplication) {
  const photo = await uploadPhotoAssetIfPresent(client, input);
  const photoSourceType = parsePhotoSourceType(input.photo_source_type);
  return {
    name: String(input.name || "").trim(),
    email: String(input.email || "").trim(),
    credentials: String(input.credentials || "").trim(),
    title: String(input.title || "").trim(),
    ...(photo ? { photo: photo } : {}),
    photoSourceType: photoSourceType || existingApplication.photoSourceType || "",
    photoReviewedAt:
      photo || photoSourceType
        ? new Date().toISOString()
        : String(existingApplication.photoReviewedAt || "").trim(),
    photoUsagePermissionConfirmed: parseBoolean(
      input.photo_usage_permission_confirmed,
      Boolean(existingApplication.photoUsagePermissionConfirmed),
    ),
    practiceName: String(input.practice_name || "").trim(),
    phone: String(input.phone || "").trim(),
    website: String(input.website || "").trim(),
    preferredContactMethod: String(input.preferred_contact_method || "").trim(),
    preferredContactLabel: String(input.preferred_contact_label || "").trim(),
    contactGuidance: String(input.contact_guidance || "").trim(),
    firstStepExpectation: String(input.first_step_expectation || "").trim(),
    bookingUrl: String(input.booking_url || "").trim(),
    city: String(input.city || "").trim(),
    state: String(input.state || "").trim(),
    zip: String(input.zip || "").trim(),
    licenseState: String(input.license_state || "")
      .trim()
      .toUpperCase(),
    licenseNumber: String(input.license_number || "").trim(),
    licensureVerification: normalizeLicensureVerification(
      input.licensure_verification || existingApplication.licensureVerification,
    ),
    bio: String(input.bio || "").trim(),
    careApproach: String(input.care_approach || "").trim(),
    specialties: splitList(input.specialties),
    treatmentModalities: splitList(input.treatment_modalities),
    clientPopulations: splitList(input.client_populations),
    insuranceAccepted: splitList(input.insurance_accepted),
    languages: splitList(input.languages).length ? splitList(input.languages) : ["English"],
    yearsExperience: parseNumber(input.years_experience),
    bipolarYearsExperience: parseNumber(input.bipolar_years_experience),
    acceptsTelehealth: parseBoolean(input.accepts_telehealth, true),
    acceptsInPerson: parseBoolean(input.accepts_in_person, true),
    telehealthStates: splitList(input.telehealth_states),
    estimatedWaitTime: String(input.estimated_wait_time || "").trim(),
    medicationManagement: parseBoolean(input.medication_management, false),
    sourceUrl: String(input.source_url || input.website || "").trim(),
    supportingSourceUrls: splitList(input.supporting_source_urls),
    sourceReviewedAt: String(input.source_reviewed_at || "").trim(),
    therapistReportedFields: splitList(input.therapist_reported_fields),
    therapistReportedConfirmedAt: String(input.therapist_reported_confirmed_at || "").trim(),
    fieldReviewStates: mapFieldReviewStatesToCamelCase(input.field_review_states, {
      fallbackState: "therapist_confirmed",
    }),
    sessionFeeMin: parseNumber(input.session_fee_min),
    sessionFeeMax: parseNumber(input.session_fee_max),
    slidingScale: parseBoolean(input.sliding_scale, false),
  };
}

function validateRevisionInput(input) {
  if (
    !input.name ||
    !input.credentials ||
    !input.email ||
    !input.city ||
    !input.state ||
    !input.bio ||
    !input.license_state ||
    !input.license_number ||
    !input.care_approach
  ) {
    throw new Error("Missing required application fields.");
  }
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

function computeCandidateReviewMeta(candidateLike) {
  const readiness = Number(candidateLike.readinessScore || 0) || 0;
  const extractionConfidence = Number(candidateLike.extractionConfidence || 0) || 0;
  const reviewStatus = String(candidateLike.reviewStatus || "queued").trim().toLowerCase();
  const dedupeStatus = String(candidateLike.dedupeStatus || "unreviewed").trim().toLowerCase();
  const recommendation = String(candidateLike.publishRecommendation || "").trim().toLowerCase();
  const now = new Date().toISOString();

  if (reviewStatus === "published" || reviewStatus === "archived") {
    return {
      reviewLane: "archived",
      reviewPriority: 10,
      nextReviewDueAt: addDays(now, 30),
    };
  }

  if (dedupeStatus === "possible_duplicate") {
    return {
      reviewLane: "resolve_duplicates",
      reviewPriority: 96,
      nextReviewDueAt: now,
    };
  }

  if (reviewStatus === "needs_confirmation" || recommendation === "needs_confirmation") {
    return {
      reviewLane: "needs_confirmation",
      reviewPriority: Math.max(72, Math.min(88, readiness || 72)),
      nextReviewDueAt: addDays(now, 2),
    };
  }

  if (reviewStatus === "ready_to_publish" || recommendation === "ready") {
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

function buildLicensureOpsEvent(record, updates) {
  const now = new Date().toISOString();
  return {
    _id: `therapist-publish-event-${record._id}-${crypto.randomUUID()}`,
    _type: "therapistPublishEvent",
    eventType: updates.eventType,
    providerId: record.providerId || "",
    candidateId: "",
    candidateDocumentId: "",
    applicationId: "",
    therapistId: record.sourceDocumentType === "therapist" ? record.sourceDocumentId || "" : "",
    decision: updates.decision || "",
    reviewStatus: "",
    publishRecommendation: "",
    notes: updates.notes || "",
    changedFields: Array.isArray(updates.changedFields) ? updates.changedFields : [],
    createdAt: now,
  };
}

function buildAppliedFieldReviewStatePatch(selectedFields) {
  const nextStates = {};
  (Array.isArray(selectedFields) ? selectedFields : []).forEach(function (field) {
    if (field === "insurance_accepted") {
      nextStates.insuranceAccepted = "editorially_verified";
    }
    if (field === "telehealth_states") {
      nextStates.telehealthStates = "editorially_verified";
    }
  });
  return nextStates;
}

function normalizeApplication(doc) {
  return normalizePortableApplicationDocument(doc, {
    normalizeFieldReviewStates,
    normalizeLicensureVerification,
  });
}

function normalizePortalRequest(doc) {
  return {
    id: doc._id,
    therapist_slug: doc.therapistSlug || "",
    therapist_name: doc.therapistName || "",
    request_type: doc.requestType || "",
    requester_name: doc.requesterName || "",
    requester_email: doc.requesterEmail || "",
    license_number: doc.licenseNumber || "",
    message: doc.message || "",
    status: doc.status || "open",
    requested_at: doc.requestedAt || doc._createdAt || "",
    reviewed_at: doc.reviewedAt || "",
  };
}

function buildPortalRequestDocument(input) {
  const requestType = String(input.request_type || "").trim();
  const therapistSlug = String(input.therapist_slug || "").trim();
  const therapistName = String(input.therapist_name || "").trim();
  const requesterName = String(input.requester_name || "").trim();
  const requesterEmail = String(input.requester_email || "").trim();

  if (!therapistSlug || !therapistName || !requestType || !requesterName || !requesterEmail) {
    throw new Error("Missing required therapist portal request fields.");
  }

  const allowedRequestTypes = new Set([
    "claim_profile",
    "pause_listing",
    "remove_listing",
    "profile_update",
  ]);
  if (!allowedRequestTypes.has(requestType)) {
    throw new Error("Invalid therapist portal request type.");
  }

  const now = new Date().toISOString();
  return {
    _id: `therapist-portal-request-${therapistSlug}-${Date.now()}`,
    _type: "therapistPortalRequest",
    therapistSlug: therapistSlug,
    therapistName: therapistName,
    requestType: requestType,
    requesterName: requesterName,
    requesterEmail: requesterEmail,
    licenseNumber: String(input.license_number || "").trim(),
    message: String(input.message || "").trim(),
    status: "open",
    requestedAt: now,
  };
}

function buildPortalClaimToken(config, therapist, requesterEmail) {
  return createSignedPayload(
    {
      sub: "therapist-portal",
      slug: therapist.slug.current,
      email: requesterEmail,
      exp: Date.now() + 1000 * 60 * 30,
      nonce: crypto.randomBytes(12).toString("hex"),
    },
    config.sessionSecret,
  );
}

function readPortalClaimToken(config, token) {
  const payload = readSignedPayload(token, config.sessionSecret);
  if (!payload || payload.sub !== "therapist-portal" || !payload.exp || payload.exp <= Date.now()) {
    return null;
  }
  return payload;
}

async function sendEmail(config, payload) {
  if (!hasEmailConfig(config)) {
    return { skipped: true };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.resendApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    throw new Error(result.message || result.error || "Email send failed.");
  }

  return result;
}

async function notifyAdminOfSubmission(config, application) {
  if (!hasEmailConfig(config)) {
    return;
  }

  await sendEmail(config, {
    from: config.emailFrom,
    to: [config.notificationTo],
    subject: `New therapist application: ${application.name}`,
    html: `<h2>New therapist application</h2>
<p><strong>Name:</strong> ${application.name}</p>
<p><strong>Email:</strong> ${application.email}</p>
<p><strong>Location:</strong> ${application.city}, ${application.state}</p>
<p><strong>Credentials:</strong> ${application.credentials || "Not provided"}</p>
<p><strong>Specialties:</strong> ${(application.specialties || []).join(", ") || "Not provided"}</p>
<p><strong>Status:</strong> ${application.status}</p>
<p>Open the admin review page to review this submission.</p>`,
  });
}

async function notifyApplicantOfDecision(config, application, decision) {
  if (!config.resendApiKey || !config.emailFrom || !application.email) {
    return;
  }

  const subject =
    decision === "approved"
      ? "Your BipolarTherapyHub application was approved"
      : "Your BipolarTherapyHub application was reviewed";
  const html =
    decision === "approved"
      ? `<h2>Your listing was approved</h2>
<p>Hi ${application.name},</p>
<p>Your BipolarTherapyHub application has been approved and your listing is now live.</p>
<p>Thank you for joining the directory.</p>`
      : `<h2>Your application was reviewed</h2>
<p>Hi ${application.name},</p>
<p>Your BipolarTherapyHub application was reviewed and is not moving forward right now.</p>
<p>You can reply to this email if you want to follow up with updated details later.</p>`;

  await sendEmail(config, {
    from: config.emailFrom,
    to: [application.email],
    reply_to: config.notificationTo,
    subject: subject,
    html: html,
  });
}

async function sendPortalClaimLink(config, therapist, requesterEmail, portalBaseUrl) {
  if (!hasEmailConfig(config)) {
    throw new Error("Email delivery is not configured for claim links yet.");
  }

  const token = buildPortalClaimToken(config, therapist, requesterEmail);
  const manageUrl =
    String(portalBaseUrl || "http://localhost:5173").replace(/\/+$/, "") +
    "/portal.html?token=" +
    encodeURIComponent(token);

  await sendEmail(config, {
    from: config.emailFrom,
    to: [requesterEmail],
    reply_to: config.notificationTo,
    subject: `Your BipolarTherapyHub manage link for ${therapist.name}`,
    html: `<h2>Claim or manage your profile</h2>
<p>Hi ${therapist.name},</p>
<p>Use the secure link below to access your lightweight profile portal.</p>
<p><a href="${manageUrl}">${manageUrl}</a></p>
<p>This link expires in 30 minutes.</p>`,
  });
}

async function updateApplicationFields(client, applicationId, fields) {
  const allowedUpdates = {};

  if (typeof fields.notes === "string") {
    allowedUpdates.notes = fields.notes.trim();
  }

  if (
    typeof fields.status === "string" &&
    ["pending", "reviewing", "requested_changes", "approved", "rejected"].includes(fields.status)
  ) {
    allowedUpdates.status = fields.status;
  }

  if (typeof fields.review_request_message === "string") {
    allowedUpdates.reviewRequestMessage = fields.review_request_message.trim();
  }

  if (!Object.keys(allowedUpdates).length && !fields.revision_history_entry) {
    throw new Error("No valid application updates were provided.");
  }

  allowedUpdates.updatedAt = new Date().toISOString();
  const patch = client.patch(applicationId).set(allowedUpdates);

  if (fields.revision_history_entry && typeof fields.revision_history_entry === "object") {
    patch.setIfMissing({ revisionHistory: [] }).append("revisionHistory", [
      {
        _key: `${Date.now()}`,
        type: String(fields.revision_history_entry.type || "updated"),
        at: new Date().toISOString(),
        message: String(fields.revision_history_entry.message || "").trim(),
      },
    ]);
  }

  return patch.commit({ visibility: "sync" });
}

async function updatePortalRequestFields(client, requestId, fields) {
  const allowedUpdates = {};

  if (
    typeof fields.status === "string" &&
    ["open", "in_review", "resolved"].includes(fields.status)
  ) {
    allowedUpdates.status = fields.status;
    allowedUpdates.reviewedAt = new Date().toISOString();
  }

  if (!Object.keys(allowedUpdates).length) {
    throw new Error("No valid portal request updates were provided.");
  }

  return client.patch(requestId).set(allowedUpdates).commit({ visibility: "sync" });
}

export function createReviewApiHandler(configOverride, clientOverride) {
  const config = configOverride || getReviewApiConfig();
  const client =
    clientOverride ||
    createClient({
      projectId: config.projectId,
      dataset: config.dataset,
      apiVersion: config.apiVersion,
      token: config.token,
      useCdn: false,
      perspective: "raw",
    });

  return async function reviewApiHandler(request, response) {
    const origin = request.headers.origin || "";
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const routePath = normalizeRoutePath(url.pathname);

    if (request.method === "OPTIONS") {
      sendJson(response, 200, { ok: true }, origin, config);
      return;
    }

    try {
      if (
        await handleAuthAndPortalRoutes({
          client,
          config,
          deps: {
            buildPortalRequestDocument,
            canAttemptLogin,
            clearFailedLogins,
            createSignedSession,
            getSecurityWarnings,
            isAuthorized,
            normalizePortalRequest,
            parseAuthorizationHeader,
            parseBody,
            readPortalClaimToken,
            readSignedSession,
            recordFailedLogin,
            sendJson,
            sendPortalClaimLink,
            updatePortalRequestFields,
          },
          origin,
          request,
          response,
          routePath,
          url,
        })
      ) {
        return;
      }

      if (request.method === "GET" && routePath === "/applications") {
        if (!isAuthorized(request, config)) {
          sendJson(response, 401, { error: "Unauthorized." }, origin, config);
          return;
        }

        const docs = await client.fetch(
          `*[_type == "therapistApplication"] | order(coalesce(submittedAt, _createdAt) desc){
            _id, _createdAt, _updatedAt, name, email, credentials, title, "photo": photo{asset->{url}}, photoSourceType, photoReviewedAt, photoUsagePermissionConfirmed, practiceName, phone, website, preferredContactMethod, preferredContactLabel, contactGuidance, firstStepExpectation, bookingUrl, city, state, zip, country,
            licenseState, licenseNumber, bio, careApproach, specialties, treatmentModalities, clientPopulations,
            insuranceAccepted, languages, yearsExperience, bipolarYearsExperience, acceptsTelehealth, acceptsInPerson,
            acceptingNewPatients, telehealthStates, estimatedWaitTime, medicationManagement, verificationStatus,
            sessionFeeMin, sessionFeeMax, slidingScale, status, notes, submittedSlug, submittedAt, updatedAt, reviewRequestMessage, revisionHistory, revisionCount,
            publishedTherapistId
          }`,
        );

        sendJson(response, 200, docs.map(normalizeApplication), origin, config);
        return;
      }

      if (request.method === "GET" && routePath === "/candidates") {
        if (!isAuthorized(request, config)) {
          sendJson(response, 401, { error: "Unauthorized." }, origin, config);
          return;
        }

        const docs = await client.fetch(
          `*[_type == "therapistCandidate"] | order(coalesce(reviewPriority, 0) desc, coalesce(nextReviewDueAt, _updatedAt) asc, _updatedAt desc){
            ...
          }`,
        );

        sendJson(response, 200, docs.map(normalizeCandidate), origin, config);
        return;
      }

      if (
        await handleApplicationRoutes({
          client,
          config,
          deps: {
            buildApplicationDocument,
            buildAppliedFieldReviewStatePatch,
            buildRevisionFieldUpdates,
            buildTherapistApplicationFieldPatch,
            buildTherapistDocument,
            buildTherapistOpsEvent,
            findDuplicateTherapistEntity,
            isAuthorized,
            normalizeApplication,
            notifyAdminOfSubmission,
            notifyApplicantOfDecision,
            parseBody,
            publishingHelpers,
            sendJson,
            slugify,
            updateApplicationFields,
            validateRevisionInput,
          },
          origin,
          request,
          response,
          routePath,
        })
      ) {
        return;
      }

      if (
        await handleCandidateRoutes({
          client,
          config,
          deps: {
            addDays,
            buildCandidateReviewEvent,
            buildFieldTrustMeta,
            buildTherapistDocumentFromCandidate,
            computeCandidateReviewMeta,
            computeTherapistVerificationMeta,
            isAuthorized,
            mergeLicensureVerification,
            normalizeLicensureVerification,
            normalizePortableCandidate,
            parseBody,
            publishingHelpers,
            sendJson,
          },
          origin,
          request,
          response,
          routePath,
        })
      ) {
        return;
      }

      if (
        await handleOpsRoutes({
          client,
          config,
          deps: {
            addDays,
            buildFieldTrustMeta,
            buildLicensureOpsEvent,
            buildTherapistOpsEvent,
            computeTherapistVerificationMeta,
            isAuthorized,
            parseBody,
            sendJson,
          },
          origin,
          request,
          response,
          routePath,
        })
      ) {
        return;
      }


      sendJson(response, 404, { error: "Not found." }, origin, config);
    } catch (error) {
      sendJson(
        response,
        500,
        { error: error && error.message ? error.message : "Unexpected server error." },
        origin,
        config,
      );
    }
  };
}
