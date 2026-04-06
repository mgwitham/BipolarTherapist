import process from "node:process";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@sanity/client";

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

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
    therapistReportedFields: splitList(input.therapist_reported_fields),
    therapistReportedConfirmedAt: (input.therapist_reported_confirmed_at || "").trim() || now,
    fieldReviewStates: {
      estimatedWaitTime: "therapist_confirmed",
      insuranceAccepted: "therapist_confirmed",
      telehealthStates: "therapist_confirmed",
      bipolarYearsExperience: "therapist_confirmed",
    },
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
    therapistReportedFields: splitList(input.therapist_reported_fields),
    therapistReportedConfirmedAt: String(input.therapist_reported_confirmed_at || "").trim(),
    fieldReviewStates: {
      estimatedWaitTime:
        String(input.field_review_states && input.field_review_states.estimated_wait_time).trim() ||
        "therapist_confirmed",
      insuranceAccepted:
        String(input.field_review_states && input.field_review_states.insurance_accepted).trim() ||
        "therapist_confirmed",
      telehealthStates:
        String(input.field_review_states && input.field_review_states.telehealth_states).trim() ||
        "therapist_confirmed",
      bipolarYearsExperience:
        String(
          input.field_review_states && input.field_review_states.bipolar_years_experience,
        ).trim() || "therapist_confirmed",
    },
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

function buildTherapistDocument(application, existingId) {
  const slug =
    application.submittedSlug ||
    slugify([application.name, application.city, application.state].filter(Boolean).join(" "));
  const therapistId = existingId || `therapist-${slug}`;

  return {
    _id: therapistId,
    _type: "therapist",
    name: application.name,
    slug: {
      _type: "slug",
      current: slug,
    },
    credentials: application.credentials || "",
    title: application.title || "",
    ...(application.photo ? { photo: application.photo } : {}),
    photoSourceType: application.photoSourceType || "",
    photoReviewedAt: application.photoReviewedAt || "",
    photoUsagePermissionConfirmed: Boolean(application.photoUsagePermissionConfirmed),
    bio: application.bio || "",
    bioPreview: application.bio || "",
    practiceName: application.practiceName || "",
    email: application.email || "",
    phone: application.phone || "",
    website: application.website || "",
    preferredContactMethod: application.preferredContactMethod || "",
    preferredContactLabel: application.preferredContactLabel || "",
    contactGuidance: application.contactGuidance || "",
    firstStepExpectation: application.firstStepExpectation || "",
    bookingUrl: application.bookingUrl || "",
    city: application.city || "",
    state: application.state || "",
    zip: application.zip || "",
    country: application.country || "US",
    licenseState: application.licenseState || "",
    licenseNumber: application.licenseNumber || "",
    specialties: splitList(application.specialties),
    treatmentModalities: splitList(application.treatmentModalities),
    clientPopulations: splitList(application.clientPopulations),
    insuranceAccepted: splitList(application.insuranceAccepted),
    languages: splitList(application.languages).length
      ? splitList(application.languages)
      : ["English"],
    yearsExperience: parseNumber(application.yearsExperience),
    bipolarYearsExperience: parseNumber(application.bipolarYearsExperience),
    acceptsTelehealth: parseBoolean(application.acceptsTelehealth, true),
    acceptsInPerson: parseBoolean(application.acceptsInPerson, true),
    acceptingNewPatients: parseBoolean(application.acceptingNewPatients, true),
    telehealthStates: splitList(application.telehealthStates),
    estimatedWaitTime: application.estimatedWaitTime || "",
    careApproach: application.careApproach || "",
    medicationManagement: parseBoolean(application.medicationManagement, false),
    verificationStatus: "editorially_verified",
    therapistReportedFields: Array.isArray(application.therapistReportedFields)
      ? application.therapistReportedFields
      : [],
    therapistReportedConfirmedAt: application.therapistReportedConfirmedAt || "",
    sessionFeeMin: parseNumber(application.sessionFeeMin),
    sessionFeeMax: parseNumber(application.sessionFeeMax),
    slidingScale: parseBoolean(application.slidingScale, false),
    listingActive: true,
    status: "active",
  };
}

function normalizeApplication(doc) {
  return {
    id: doc._id,
    created_at: doc.submittedAt || doc._createdAt,
    updated_at: doc.updatedAt || doc._updatedAt || doc.submittedAt || doc._createdAt,
    status: doc.status || "pending",
    slug: doc.submittedSlug || "",
    name: doc.name || "",
    credentials: doc.credentials || "",
    title: doc.title || "",
    photo_url: doc.photo && doc.photo.asset ? doc.photo.asset.url || "" : "",
    photo_source_type: doc.photoSourceType || "",
    photo_reviewed_at: doc.photoReviewedAt || "",
    photo_usage_permission_confirmed: Boolean(doc.photoUsagePermissionConfirmed),
    bio: doc.bio || "",
    email: doc.email || "",
    phone: doc.phone || "",
    website: doc.website || "",
    preferred_contact_method: doc.preferredContactMethod || "",
    preferred_contact_label: doc.preferredContactLabel || "",
    contact_guidance: doc.contactGuidance || "",
    first_step_expectation: doc.firstStepExpectation || "",
    booking_url: doc.bookingUrl || "",
    practice_name: doc.practiceName || "",
    city: doc.city || "",
    state: doc.state || "",
    zip: doc.zip || "",
    license_state: doc.licenseState || "",
    license_number: doc.licenseNumber || "",
    specialties: Array.isArray(doc.specialties) ? doc.specialties : [],
    treatment_modalities: Array.isArray(doc.treatmentModalities) ? doc.treatmentModalities : [],
    client_populations: Array.isArray(doc.clientPopulations) ? doc.clientPopulations : [],
    insurance_accepted: Array.isArray(doc.insuranceAccepted) ? doc.insuranceAccepted : [],
    accepts_telehealth: doc.acceptsTelehealth !== false,
    accepts_in_person: doc.acceptsInPerson !== false,
    accepting_new_patients: doc.acceptingNewPatients !== false,
    years_experience: doc.yearsExperience || null,
    bipolar_years_experience: doc.bipolarYearsExperience || null,
    languages: Array.isArray(doc.languages) && doc.languages.length ? doc.languages : ["English"],
    telehealth_states: Array.isArray(doc.telehealthStates) ? doc.telehealthStates : [],
    estimated_wait_time: doc.estimatedWaitTime || "",
    care_approach: doc.careApproach || "",
    medication_management: Boolean(doc.medicationManagement),
    verification_status: doc.verificationStatus || "",
    therapist_reported_fields: Array.isArray(doc.therapistReportedFields)
      ? doc.therapistReportedFields
      : [],
    therapist_reported_confirmed_at: doc.therapistReportedConfirmedAt || "",
    field_review_states: {
      estimated_wait_time:
        (doc.fieldReviewStates && doc.fieldReviewStates.estimatedWaitTime) || "therapist_confirmed",
      insurance_accepted:
        (doc.fieldReviewStates && doc.fieldReviewStates.insuranceAccepted) || "therapist_confirmed",
      telehealth_states:
        (doc.fieldReviewStates && doc.fieldReviewStates.telehealthStates) || "therapist_confirmed",
      bipolar_years_experience:
        (doc.fieldReviewStates && doc.fieldReviewStates.bipolarYearsExperience) ||
        "therapist_confirmed",
    },
    session_fee_min: doc.sessionFeeMin || null,
    session_fee_max: doc.sessionFeeMax || null,
    sliding_scale: Boolean(doc.slidingScale),
    notes: doc.notes || "",
    review_request_message: doc.reviewRequestMessage || "",
    revision_history: Array.isArray(doc.revisionHistory) ? doc.revisionHistory : [],
    revision_count: doc.revisionCount || 0,
    published_therapist_id: doc.publishedTherapistId || "",
  };
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

export function createReviewApiHandler(configOverride) {
  const config = configOverride || getReviewApiConfig();
  const client = createClient({
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
      if (request.method === "GET" && routePath === "/health") {
        sendJson(
          response,
          200,
          {
            ok: true,
            authMode: config.adminUsername && config.adminPassword ? "password" : "legacy-key",
            sessionTtlMs: config.sessionTtlMs,
            legacyKeyEnabled: config.allowLegacyKey && Boolean(config.adminKey),
            securityWarnings: getSecurityWarnings(config),
          },
          origin,
          config,
        );
        return;
      }

      if (request.method === "POST" && routePath === "/auth/login") {
        if (!canAttemptLogin(request, config)) {
          sendJson(
            response,
            429,
            { error: "Too many login attempts. Try again later." },
            origin,
            config,
          );
          return;
        }

        const body = await parseBody(request);
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        const usingUserPass = config.adminUsername && config.adminPassword;
        const usingLegacyKey = config.allowLegacyKey && config.adminKey;

        const valid =
          (usingUserPass &&
            username === config.adminUsername &&
            password === config.adminPassword) ||
          (usingLegacyKey && password === config.adminKey);

        if (!valid) {
          recordFailedLogin(request, config);
          sendJson(response, 401, { error: "Invalid admin credentials." }, origin, config);
          return;
        }

        clearFailedLogins(request);
        const sessionToken = createSignedSession(config);
        sendJson(
          response,
          200,
          {
            ok: true,
            sessionToken: sessionToken,
            authMode: usingUserPass ? "password" : "legacy-key",
          },
          origin,
          config,
        );
        return;
      }

      if (request.method === "GET" && routePath === "/auth/session") {
        const session = readSignedSession(parseAuthorizationHeader(request), config);
        if (!session) {
          sendJson(response, 401, { authenticated: false }, origin, config);
          return;
        }

        sendJson(
          response,
          200,
          {
            authenticated: true,
            expiresAt: session.exp,
          },
          origin,
          config,
        );
        return;
      }

      if (request.method === "POST" && routePath === "/auth/logout") {
        sendJson(response, 200, { ok: true }, origin, config);
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

      if (request.method === "GET" && routePath === "/portal/requests") {
        if (!isAuthorized(request, config)) {
          sendJson(response, 401, { error: "Unauthorized." }, origin, config);
          return;
        }

        const docs = await client.fetch(
          `*[_type == "therapistPortalRequest"] | order(coalesce(requestedAt, _createdAt) desc){
            _id, _createdAt, therapistSlug, therapistName, requestType, requesterName, requesterEmail, licenseNumber, message, status, requestedAt, reviewedAt
          }`,
        );

        sendJson(response, 200, docs.map(normalizePortalRequest), origin, config);
        return;
      }

      if (request.method === "POST" && routePath === "/portal/requests") {
        const body = await parseBody(request);
        const document = buildPortalRequestDocument(body);
        const created = await client.create(document);
        sendJson(response, 201, normalizePortalRequest(created), origin, config);
        return;
      }

      const portalRequestUpdateMatch = routePath.match(/^\/portal\/requests\/([^/]+)$/);
      if ((request.method === "PATCH" || request.method === "POST") && portalRequestUpdateMatch) {
        if (!isAuthorized(request, config)) {
          sendJson(response, 401, { error: "Unauthorized." }, origin, config);
          return;
        }

        const requestId = decodeURIComponent(portalRequestUpdateMatch[1]);
        const existing = await client.getDocument(requestId);
        if (!existing || existing._type !== "therapistPortalRequest") {
          sendJson(response, 404, { error: "Portal request not found." }, origin, config);
          return;
        }

        const body = await parseBody(request);
        const updated = await updatePortalRequestFields(client, requestId, body);
        sendJson(response, 200, normalizePortalRequest(updated), origin, config);
        return;
      }

      if (request.method === "POST" && routePath === "/portal/claim-link") {
        const body = await parseBody(request);
        const therapistSlug = String(body.therapist_slug || "").trim();
        const requesterEmail = String(body.requester_email || "")
          .trim()
          .toLowerCase();

        if (!therapistSlug || !requesterEmail) {
          sendJson(response, 400, { error: "Missing therapist slug or email." }, origin, config);
          return;
        }

        const therapist = await client.fetch(
          `*[_type == "therapist" && slug.current == $slug][0]{
            _id, name, email, claimStatus, "slug": slug
          }`,
          { slug: therapistSlug },
        );

        if (!therapist || !therapist.slug || !therapist.slug.current) {
          sendJson(response, 404, { error: "Therapist profile not found." }, origin, config);
          return;
        }

        const profileEmail = String(therapist.email || "")
          .trim()
          .toLowerCase();
        if (!profileEmail || profileEmail !== requesterEmail) {
          sendJson(
            response,
            403,
            {
              error:
                "That email does not match the public contact email on this profile yet. Use the request form instead so we can verify ownership manually.",
            },
            origin,
            config,
          );
          return;
        }

        await sendPortalClaimLink(
          config,
          therapist,
          requesterEmail,
          `${url.protocol}//${url.host}`.replace(/\/+$/, ""),
        );

        await client
          .patch(therapist._id)
          .set({
            claimStatus: therapist.claimStatus === "claimed" ? "claimed" : "claim_requested",
          })
          .commit({ visibility: "sync" });

        sendJson(
          response,
          200,
          { ok: true, message: "Claim link sent if the profile email matched." },
          origin,
          config,
        );
        return;
      }

      if (request.method === "GET" && routePath === "/portal/claim-session") {
        const token = String(url.searchParams.get("token") || "").trim();
        const payload = readPortalClaimToken(config, token);
        if (!payload) {
          sendJson(response, 401, { error: "Claim link is invalid or expired." }, origin, config);
          return;
        }

        const therapist = await client.fetch(
          `*[_type == "therapist" && slug.current == $slug][0]{
            _id, name, email, city, state, practiceName, claimStatus, claimedByEmail, claimedAt,
            portalLastSeenAt, listingPauseRequestedAt, listingRemovalRequestedAt,
            "slug": slug.current
          }`,
          { slug: payload.slug },
        );

        if (!therapist) {
          sendJson(response, 404, { error: "Therapist profile not found." }, origin, config);
          return;
        }

        sendJson(
          response,
          200,
          {
            ok: true,
            therapist: {
              slug: therapist.slug,
              name: therapist.name,
              email: therapist.email || "",
              city: therapist.city || "",
              state: therapist.state || "",
              practice_name: therapist.practiceName || "",
              claim_status: therapist.claimStatus || "unclaimed",
              claimed_by_email: therapist.claimedByEmail || "",
              claimed_at: therapist.claimedAt || "",
              portal_last_seen_at: therapist.portalLastSeenAt || "",
              listing_pause_requested_at: therapist.listingPauseRequestedAt || "",
              listing_removal_requested_at: therapist.listingRemovalRequestedAt || "",
            },
          },
          origin,
          config,
        );
        return;
      }

      if (request.method === "POST" && routePath === "/portal/claim-accept") {
        const body = await parseBody(request);
        const token = String(body.token || "").trim();
        const payload = readPortalClaimToken(config, token);
        if (!payload) {
          sendJson(response, 401, { error: "Claim link is invalid or expired." }, origin, config);
          return;
        }

        const therapist = await client.fetch(
          `*[_type == "therapist" && slug.current == $slug][0]{ _id, name, "slug": slug.current }`,
          { slug: payload.slug },
        );
        if (!therapist) {
          sendJson(response, 404, { error: "Therapist profile not found." }, origin, config);
          return;
        }

        const now = new Date().toISOString();
        await client
          .patch(therapist._id)
          .set({
            claimStatus: "claimed",
            claimedByEmail: payload.email,
            claimedAt: now,
            portalLastSeenAt: now,
          })
          .commit({ visibility: "sync" });

        sendJson(
          response,
          200,
          {
            ok: true,
            therapist_slug: therapist.slug,
            claimed_by_email: payload.email,
          },
          origin,
          config,
        );
        return;
      }

      if (request.method === "POST" && routePath === "/applications") {
        const body = await parseBody(request);
        const document = await buildApplicationDocument(client, body);
        const created = await client.create(document);
        try {
          await notifyAdminOfSubmission(config, created);
        } catch (error) {
          console.error("Failed to send new-submission email.", error);
        }
        sendJson(response, 201, normalizeApplication(created), origin, config);
        return;
      }

      const revisionFetchMatch = routePath.match(/^\/applications\/([^/]+)\/revision$/);
      if (request.method === "GET" && revisionFetchMatch) {
        const applicationId = decodeURIComponent(revisionFetchMatch[1]);
        const application = await client.getDocument(applicationId);
        if (!application || application._type !== "therapistApplication") {
          sendJson(response, 404, { error: "Application not found." }, origin, config);
          return;
        }

        if (application.status !== "requested_changes") {
          sendJson(
            response,
            409,
            { error: "This application is not currently open for revision." },
            origin,
            config,
          );
          return;
        }

        sendJson(response, 200, normalizeApplication(application), origin, config);
        return;
      }

      const revisionSubmitMatch = routePath.match(/^\/applications\/([^/]+)\/revise$/);
      if (request.method === "POST" && revisionSubmitMatch) {
        const applicationId = decodeURIComponent(revisionSubmitMatch[1]);
        const application = await client.getDocument(applicationId);
        if (!application || application._type !== "therapistApplication") {
          sendJson(response, 404, { error: "Application not found." }, origin, config);
          return;
        }

        if (application.status !== "requested_changes") {
          sendJson(
            response,
            409,
            { error: "This application is not currently open for revision." },
            origin,
            config,
          );
          return;
        }

        const body = await parseBody(request);
        validateRevisionInput(body);
        const timestamp = new Date().toISOString();
        const updated = await client
          .patch(applicationId)
          .set({
            ...(await buildRevisionFieldUpdates(client, body, application)),
            status: "pending",
            reviewRequestMessage: "",
            updatedAt: timestamp,
            revisionCount: (Number(application.revisionCount || 0) || 0) + 1,
          })
          .setIfMissing({ revisionHistory: [] })
          .append("revisionHistory", [
            {
              _key: `${Date.now()}`,
              type: "resubmitted",
              at: timestamp,
              message: "Therapist submitted an updated revision.",
            },
          ])
          .commit({ visibility: "sync" });

        sendJson(response, 200, normalizeApplication(updated), origin, config);
        return;
      }

      const updateMatch = routePath.match(/^\/applications\/([^/]+)$/);
      if ((request.method === "PATCH" || request.method === "POST") && updateMatch) {
        if (!isAuthorized(request, config)) {
          sendJson(response, 401, { error: "Unauthorized." }, origin, config);
          return;
        }

        const applicationId = decodeURIComponent(updateMatch[1]);
        const existing = await client.getDocument(applicationId);
        if (!existing || existing._type !== "therapistApplication") {
          sendJson(response, 404, { error: "Application not found." }, origin, config);
          return;
        }

        const body = await parseBody(request);
        const updated = await updateApplicationFields(client, applicationId, body);
        sendJson(response, 200, normalizeApplication(updated), origin, config);
        return;
      }

      const approveMatch = routePath.match(/^\/applications\/([^/]+)\/approve$/);
      if (request.method === "POST" && approveMatch) {
        if (!isAuthorized(request, config)) {
          sendJson(response, 401, { error: "Unauthorized." }, origin, config);
          return;
        }

        const applicationId = decodeURIComponent(approveMatch[1]);
        const application = await client.getDocument(applicationId);
        if (!application || application._type !== "therapistApplication") {
          sendJson(response, 404, { error: "Application not found." }, origin, config);
          return;
        }

        const slug =
          application.submittedSlug ||
          slugify(
            [application.name, application.city, application.state].filter(Boolean).join(" "),
          );
        const therapistId = application.publishedTherapistId || `therapist-${slug}`;

        const transaction = client.transaction();
        transaction.createOrReplace(buildTherapistDocument(application, therapistId));
        transaction.delete(`drafts.${therapistId}`);
        transaction.patch(applicationId, function (patch) {
          return patch.set({
            status: "approved",
            updatedAt: new Date().toISOString(),
            publishedTherapistId: therapistId,
          });
        });

        await transaction.commit({ visibility: "sync" });

        try {
          await notifyApplicantOfDecision(config, application, "approved");
        } catch (error) {
          console.error("Failed to send approval email.", error);
        }

        sendJson(response, 200, { ok: true, therapistId: therapistId }, origin, config);
        return;
      }

      const rejectMatch = routePath.match(/^\/applications\/([^/]+)\/reject$/);
      if (request.method === "POST" && rejectMatch) {
        if (!isAuthorized(request, config)) {
          sendJson(response, 401, { error: "Unauthorized." }, origin, config);
          return;
        }

        const applicationId = decodeURIComponent(rejectMatch[1]);
        const application = await client.getDocument(applicationId);
        await client
          .patch(applicationId)
          .set({ status: "rejected", updatedAt: new Date().toISOString() })
          .commit({ visibility: "sync" });

        if (application) {
          try {
            await notifyApplicantOfDecision(config, application, "rejected");
          } catch (error) {
            console.error("Failed to send rejection email.", error);
          }
        }

        sendJson(response, 200, { ok: true }, origin, config);
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
