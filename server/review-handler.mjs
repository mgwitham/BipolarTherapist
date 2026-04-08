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

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeSlugCandidate(value) {
  return slugify(value || "");
}

function normalizeLicense(value) {
  return normalizeLower(value).replace(/[^a-z0-9]/g, "");
}

function normalizeEmail(value) {
  return normalizeLower(value);
}

function normalizePhone(value) {
  return normalizeText(value).replace(/[^0-9]/g, "");
}

function normalizeWebsite(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.hostname.toLowerCase()}${pathname}`;
  } catch (_error) {
    return normalizeLower(raw).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
}

function buildDuplicateIdentity(input) {
  const name = normalizeLower(input.name);
  const city = normalizeLower(input.city);
  const state = normalizeLower(input.state);
  const credentials = normalizeLower(input.credentials);
  const website = normalizeWebsite(input.website || input.booking_url);
  const phone = normalizePhone(input.phone);
  return {
    slug: normalizeSlugCandidate(input.slug || [input.name, input.city, input.state].join(" ")),
    name,
    city,
    state,
    credentials,
    email: normalizeEmail(input.email),
    phone,
    website,
    licenseState: normalizeLower(input.license_state),
    licenseNumber: normalizeLicense(input.license_number),
  };
}

function compareDuplicateIdentity(identity, candidate) {
  const candidateSlug = normalizeSlugCandidate(candidate.slug);
  const candidateEmail = normalizeEmail(candidate.email);
  const candidatePhone = normalizePhone(candidate.phone);
  const candidateWebsite = normalizeWebsite(candidate.website || candidate.bookingUrl || candidate.booking_url);
  const candidateLicenseState = normalizeLower(candidate.licenseState || candidate.license_state);
  const candidateLicenseNumber = normalizeLicense(candidate.licenseNumber || candidate.license_number);
  const candidateName = normalizeLower(candidate.name);
  const candidateCity = normalizeLower(candidate.city);
  const candidateState = normalizeLower(candidate.state);
  const candidateCredentials = normalizeLower(candidate.credentials);
  const reasons = [];

  if (
    identity.licenseState &&
    identity.licenseNumber &&
    identity.licenseState === candidateLicenseState &&
    identity.licenseNumber === candidateLicenseNumber
  ) {
    reasons.push("license");
  }

  if (identity.slug && identity.slug === candidateSlug) {
    reasons.push("slug");
  }

  if (identity.email && identity.email === candidateEmail) {
    reasons.push("email");
  }

  const sameNamePlace =
    identity.name &&
    identity.city &&
    identity.state &&
    identity.name === candidateName &&
    identity.city === candidateCity &&
    identity.state === candidateState;

  if (sameNamePlace) {
    if (
      (identity.phone && identity.phone === candidatePhone) ||
      (identity.website && identity.website === candidateWebsite) ||
      (identity.credentials && identity.credentials === candidateCredentials)
    ) {
      reasons.push("name_location");
    }
  }

  return reasons;
}

function parseApplicationIntakeType(input) {
  const requested = String(input.application_intake_type || input.intake_type || "").trim();
  if (
    requested === "new_listing" ||
    requested === "claim_existing" ||
    requested === "update_existing" ||
    requested === "confirmation_update"
  ) {
    return requested;
  }

  if (String(input.published_therapist_id || "").trim() || String(input.slug || "").trim()) {
    return "confirmation_update";
  }

  return "new_listing";
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

function buildProviderId(input) {
  const licenseState = normalizeKeySegment(input.license_state || input.licenseState);
  const licenseNumber = normalizeLicenseSegment(input.license_number || input.licenseNumber);
  if (licenseState && licenseNumber) {
    return `provider-${licenseState}-${licenseNumber}`;
  }

  const fallback = normalizeKeySegment(
    [input.name, input.city, input.state].filter(Boolean).join(" "),
  );
  return `provider-${fallback || Date.now()}`;
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
  const intakeType = parseApplicationIntakeType(input);
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
    sourceUrl: String(input.source_url || input.website || "").trim(),
    supportingSourceUrls: splitList(input.supporting_source_urls),
    sourceReviewedAt: String(input.source_reviewed_at || "").trim(),
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

function toValidDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getFieldReviewState(record, fieldName) {
  return (
    (record.fieldReviewStates && record.fieldReviewStates[fieldName]) || "therapist_confirmed"
  );
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
      return new Date(Math.max.apply(null, dates.map((value) => value.getTime()))).toISOString();
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
    reviewState === "editorially_verified"
      ? 92
      : reviewState === "needs_reconfirmation"
        ? 44
        : 76;

  if (sourceKind === "blended") {
    score += 3;
  } else if (sourceKind === "degraded_source") {
    score -= 16;
  } else if (sourceKind === "unknown") {
    score -= 10;
  }

  const sourceAgeDays = toValidDate(record.sourceReviewedAt)
    ? Math.max(0, Math.floor((Date.now() - new Date(record.sourceReviewedAt).getTime()) / 86400000))
    : null;
  const confirmationAgeDays = toValidDate(record.therapistReportedConfirmedAt)
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(record.therapistReportedConfirmedAt).getTime()) / 86400000),
      )
    : null;

  if (sourceAgeDays !== null && sourceAgeDays >= 120) {
    score -= 12;
  } else if (sourceAgeDays !== null && sourceAgeDays >= 75) {
    score -= 6;
  }

  if (confirmationAgeDays !== null && confirmationAgeDays >= 120) {
    score -= 16;
  } else if (confirmationAgeDays !== null && confirmationAgeDays >= 60) {
    score -= 8;
  }

  return Math.max(5, Math.min(99, score));
}

function buildFieldTrustMeta(record) {
  return FIELD_TRUST_KEYS.reduce(function (accumulator, fieldName) {
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
  const validDates = [sourceReviewedAt, therapistConfirmedAt].filter(function (value) {
    return value instanceof Date && !Number.isNaN(value.getTime());
  });
  const lastOperationalReviewAt = validDates.length
    ? new Date(Math.max.apply(null, validDates.map((value) => value.getTime()))).toISOString()
    : "";
  const needsReconfirmationFields = Object.entries(record.fieldReviewStates || {})
    .filter(function (entry) {
      return entry[1] === "needs_reconfirmation";
    })
    .map(function (entry) {
      return entry[0];
    });
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

function buildTherapistDocument(application, existingId) {
  const slug =
    application.submittedSlug ||
    slugify([application.name, application.city, application.state].filter(Boolean).join(" "));
  const therapistId = existingId || `therapist-${slug}`;
  const draft = {
    sourceUrl: application.sourceUrl || application.website || "",
    supportingSourceUrls: splitList(application.supportingSourceUrls),
    sourceReviewedAt: application.sourceReviewedAt || "",
    therapistReportedConfirmedAt: application.therapistReportedConfirmedAt || "",
    fieldReviewStates: application.fieldReviewStates || {},
    name: application.name,
    credentials: application.credentials,
    city: application.city,
    state: application.state,
    email: application.email,
    phone: application.phone,
    website: application.website,
    bookingUrl: application.bookingUrl,
    careApproach: application.careApproach,
    bio: application.bio,
    specialties: splitList(application.specialties),
    insuranceAccepted: splitList(application.insuranceAccepted),
    languages: splitList(application.languages),
  };
  const verificationMeta = computeTherapistVerificationMeta(draft);
  const fieldTrustMeta = buildFieldTrustMeta(draft);

  return {
    _id: therapistId,
    _type: "therapist",
    providerId: application.providerId || buildProviderId(application),
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
    sourceUrl: application.sourceUrl || application.website || "",
    supportingSourceUrls: splitList(application.supportingSourceUrls),
    sourceReviewedAt: application.sourceReviewedAt || "",
    therapistReportedFields: Array.isArray(application.therapistReportedFields)
      ? application.therapistReportedFields
      : [],
    therapistReportedConfirmedAt: application.therapistReportedConfirmedAt || "",
    lastOperationalReviewAt: verificationMeta.lastOperationalReviewAt,
    nextReviewDueAt: verificationMeta.nextReviewDueAt,
    verificationPriority: verificationMeta.verificationPriority,
    verificationLane: verificationMeta.verificationLane,
    dataCompletenessScore: verificationMeta.dataCompletenessScore,
    fieldTrustMeta,
    sessionFeeMin: parseNumber(application.sessionFeeMin),
    sessionFeeMax: parseNumber(application.sessionFeeMax),
    slidingScale: parseBoolean(application.slidingScale, false),
    listingActive: true,
    status: "active",
  };
}

function buildTherapistDocumentFromCandidate(candidate, existingId) {
  const slug = slugify([candidate.name, candidate.city, candidate.state].filter(Boolean).join(" "));
  const therapistId =
    existingId || candidate.matchedTherapistId || candidate.publishedTherapistId || `therapist-${slug}`;
  const draft = {
    sourceUrl: candidate.sourceUrl || candidate.website || "",
    supportingSourceUrls: splitList(candidate.supportingSourceUrls),
    sourceReviewedAt: candidate.sourceReviewedAt || "",
    therapistReportedConfirmedAt: "",
    fieldReviewStates: {},
    name: candidate.name,
    credentials: candidate.credentials,
    city: candidate.city,
    state: candidate.state,
    email: candidate.email,
    phone: candidate.phone,
    website: candidate.website,
    bookingUrl: candidate.bookingUrl,
    careApproach: candidate.careApproach,
    bio: candidate.careApproach,
    specialties: splitList(candidate.specialties),
    insuranceAccepted: splitList(candidate.insuranceAccepted),
    languages: splitList(candidate.languages),
  };
  const verificationMeta = computeTherapistVerificationMeta(draft);
  const fieldTrustMeta = buildFieldTrustMeta(draft);

  return {
    _id: therapistId,
    _type: "therapist",
    providerId: candidate.providerId || buildProviderId(candidate),
    name: candidate.name || "",
    slug: {
      _type: "slug",
      current: slug,
    },
    credentials: candidate.credentials || "",
    title: candidate.title || "",
    bio: candidate.careApproach || "",
    bioPreview: candidate.careApproach || "",
    practiceName: candidate.practiceName || "",
    email: candidate.email || "",
    phone: candidate.phone || "",
    website: candidate.website || "",
    preferredContactMethod: "",
    preferredContactLabel: "",
    contactGuidance: "",
    firstStepExpectation: "",
    bookingUrl: candidate.bookingUrl || "",
    city: candidate.city || "",
    state: candidate.state || "",
    zip: candidate.zip || "",
    country: candidate.country || "US",
    licenseState: candidate.licenseState || "",
    licenseNumber: candidate.licenseNumber || "",
    specialties: splitList(candidate.specialties),
    treatmentModalities: splitList(candidate.treatmentModalities),
    clientPopulations: splitList(candidate.clientPopulations),
    insuranceAccepted: splitList(candidate.insuranceAccepted),
    languages: splitList(candidate.languages).length
      ? splitList(candidate.languages)
      : ["English"],
    yearsExperience: undefined,
    bipolarYearsExperience: undefined,
    acceptsTelehealth: parseBoolean(candidate.acceptsTelehealth, true),
    acceptsInPerson: parseBoolean(candidate.acceptsInPerson, true),
    acceptingNewPatients: parseBoolean(candidate.acceptingNewPatients, true),
    telehealthStates: splitList(candidate.telehealthStates),
    estimatedWaitTime: candidate.estimatedWaitTime || "",
    careApproach: candidate.careApproach || "",
    medicationManagement: parseBoolean(candidate.medicationManagement, false),
    verificationStatus:
      candidate.sourceReviewedAt || candidate.reviewStatus === "published"
        ? "editorially_verified"
        : "under_review",
    sourceUrl: candidate.sourceUrl || candidate.website || "",
    supportingSourceUrls: splitList(candidate.supportingSourceUrls),
    sourceReviewedAt: candidate.sourceReviewedAt || "",
    therapistReportedFields: [],
    therapistReportedConfirmedAt: "",
    lastOperationalReviewAt: verificationMeta.lastOperationalReviewAt,
    nextReviewDueAt: verificationMeta.nextReviewDueAt,
    verificationPriority: verificationMeta.verificationPriority,
    verificationLane: verificationMeta.verificationLane,
    dataCompletenessScore: verificationMeta.dataCompletenessScore,
    fieldTrustMeta,
    sessionFeeMin: parseNumber(candidate.sessionFeeMin),
    sessionFeeMax: parseNumber(candidate.sessionFeeMax),
    slidingScale: parseBoolean(candidate.slidingScale, false),
    listingActive: true,
    status: "active",
  };
}

function normalizeCandidate(doc) {
  return {
    id: doc._id,
    candidate_id: doc.candidateId || "",
    provider_id: doc.providerId || buildProviderId(doc),
    provider_fingerprint: doc.providerFingerprint || "",
    name: doc.name || "",
    credentials: doc.credentials || "",
    title: doc.title || "",
    practice_name: doc.practiceName || "",
    city: doc.city || "",
    state: doc.state || "",
    zip: doc.zip || "",
    country: doc.country || "US",
    license_state: doc.licenseState || "",
    license_number: doc.licenseNumber || "",
    email: doc.email || "",
    phone: doc.phone || "",
    website: doc.website || "",
    booking_url: doc.bookingUrl || "",
    source_type: doc.sourceType || "",
    source_url: doc.sourceUrl || "",
    supporting_source_urls: Array.isArray(doc.supportingSourceUrls) ? doc.supportingSourceUrls : [],
    raw_source_snapshot: doc.rawSourceSnapshot || "",
    extracted_at: doc.extractedAt || "",
    source_reviewed_at: doc.sourceReviewedAt || "",
    extraction_version: doc.extractionVersion || "",
    extraction_confidence:
      typeof doc.extractionConfidence === "number" ? doc.extractionConfidence : null,
    care_approach: doc.careApproach || "",
    specialties: Array.isArray(doc.specialties) ? doc.specialties : [],
    treatment_modalities: Array.isArray(doc.treatmentModalities) ? doc.treatmentModalities : [],
    client_populations: Array.isArray(doc.clientPopulations) ? doc.clientPopulations : [],
    insurance_accepted: Array.isArray(doc.insuranceAccepted) ? doc.insuranceAccepted : [],
    languages: Array.isArray(doc.languages) ? doc.languages : [],
    accepts_telehealth: doc.acceptsTelehealth !== false,
    accepts_in_person: doc.acceptsInPerson !== false,
    accepting_new_patients: doc.acceptingNewPatients !== false,
    telehealth_states: Array.isArray(doc.telehealthStates) ? doc.telehealthStates : [],
    estimated_wait_time: doc.estimatedWaitTime || "",
    medication_management: Boolean(doc.medicationManagement),
    session_fee_min: typeof doc.sessionFeeMin === "number" ? doc.sessionFeeMin : null,
    session_fee_max: typeof doc.sessionFeeMax === "number" ? doc.sessionFeeMax : null,
    sliding_scale: Boolean(doc.slidingScale),
    dedupe_status: doc.dedupeStatus || "unreviewed",
    dedupe_confidence: typeof doc.dedupeConfidence === "number" ? doc.dedupeConfidence : null,
    matched_therapist_slug: doc.matchedTherapistSlug || "",
    matched_therapist_id: doc.matchedTherapistId || "",
    matched_application_id: doc.matchedApplicationId || "",
    published_therapist_id: doc.publishedTherapistId || "",
    published_at: doc.publishedAt || "",
    review_status: doc.reviewStatus || "queued",
    review_lane: doc.reviewLane || "editorial_review",
    review_priority: typeof doc.reviewPriority === "number" ? doc.reviewPriority : null,
    next_review_due_at: doc.nextReviewDueAt || "",
    last_reviewed_at: doc.lastReviewedAt || "",
    readiness_score: typeof doc.readinessScore === "number" ? doc.readinessScore : null,
    publish_recommendation: doc.publishRecommendation || "",
    notes: doc.notes || "",
    review_history: Array.isArray(doc.reviewHistory) ? doc.reviewHistory : [],
  };
}

function buildCandidateReviewEvent(candidate, updates) {
  const now = new Date().toISOString();
  return {
    _id: `therapist-publish-event-${candidate.candidateId || candidate._id}-${Date.now()}`,
    _type: "therapistPublishEvent",
    eventType: updates.eventType,
    providerId: candidate.providerId || buildProviderId(candidate),
    candidateId: candidate.candidateId || "",
    candidateDocumentId: candidate._id,
    applicationId: updates.applicationId || candidate.matchedApplicationId || "",
    therapistId: updates.therapistId || candidate.matchedTherapistId || "",
    decision: updates.decision || "",
    reviewStatus: updates.reviewStatus || "",
    publishRecommendation: updates.publishRecommendation || "",
    notes: updates.notes || "",
    changedFields: Array.isArray(updates.changedFields) ? updates.changedFields : [],
    createdAt: now,
  };
}

function buildTherapistOpsEvent(therapist, updates) {
  const now = new Date().toISOString();
  return {
    _id: `therapist-publish-event-${therapist._id}-${Date.now()}`,
    _type: "therapistPublishEvent",
    eventType: updates.eventType,
    providerId: therapist.providerId || buildProviderId(therapist),
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

function buildTherapistApplicationFieldPatch(application, therapist, selectedFields, nowIso) {
  const allowed = new Set([
    "credentials",
    "title",
    "location",
    "website",
    "email",
    "phone",
    "preferred_contact_method",
    "preferred_contact_label",
    "insurance_accepted",
    "telehealth_states",
    "accepting_new_patients",
    "medication_management",
  ]);
  const fields = Array.isArray(selectedFields)
    ? selectedFields.map((field) => String(field || "").trim()).filter((field) => allowed.has(field))
    : [];

  const patch = {};
  fields.forEach(function (field) {
    if (field === "credentials") patch.credentials = application.credentials || "";
    else if (field === "title") patch.title = application.title || "";
    else if (field === "location") {
      patch.city = application.city || "";
      patch.state = application.state || "";
      patch.zip = application.zip || "";
    } else if (field === "website") patch.website = application.website || "";
    else if (field === "email") patch.email = application.email || "";
    else if (field === "phone") patch.phone = application.phone || "";
    else if (field === "preferred_contact_method")
      patch.preferredContactMethod = application.preferredContactMethod || "";
    else if (field === "preferred_contact_label")
      patch.preferredContactLabel = application.preferredContactLabel || "";
    else if (field === "insurance_accepted")
      patch.insuranceAccepted = splitList(application.insuranceAccepted);
    else if (field === "telehealth_states")
      patch.telehealthStates = splitList(application.telehealthStates);
    else if (field === "accepting_new_patients")
      patch.acceptingNewPatients = parseBoolean(application.acceptingNewPatients, true);
    else if (field === "medication_management")
      patch.medicationManagement = parseBoolean(application.medicationManagement, false);
  });

  const mergedDraft = {
    ...therapist,
    ...patch,
    sourceUrl: therapist.sourceUrl || application.sourceUrl || application.website || "",
    supportingSourceUrls: mergeUniqueUrls(
      therapist.sourceUrl,
      therapist.supportingSourceUrls,
      mergeUniqueUrls(
        application.sourceUrl,
        application.supportingSourceUrls,
        application.website ? [application.website] : [],
      ),
    ),
    sourceReviewedAt: application.sourceReviewedAt || therapist.sourceReviewedAt || nowIso,
    therapistReportedConfirmedAt:
      application.therapistReportedConfirmedAt || therapist.therapistReportedConfirmedAt || "",
    fieldReviewStates: therapist.fieldReviewStates || {},
    therapistReportedFields: Array.from(
      new Set([].concat(therapist.therapistReportedFields || []).concat(application.therapistReportedFields || [])),
    ),
  };
  const verificationMeta = computeTherapistVerificationMeta(mergedDraft);

  return {
    patch: {
      ...patch,
      supportingSourceUrls: mergedDraft.supportingSourceUrls,
      sourceReviewedAt: mergedDraft.sourceReviewedAt,
      therapistReportedConfirmedAt: mergedDraft.therapistReportedConfirmedAt,
      therapistReportedFields: mergedDraft.therapistReportedFields,
      fieldTrustMeta: buildFieldTrustMeta(mergedDraft),
      lastOperationalReviewAt: verificationMeta.lastOperationalReviewAt,
      nextReviewDueAt: verificationMeta.nextReviewDueAt,
      verificationPriority: verificationMeta.verificationPriority,
      verificationLane: verificationMeta.verificationLane,
      dataCompletenessScore: verificationMeta.dataCompletenessScore,
    },
    appliedFields: fields,
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

function mergeUniqueUrls(primary, supporting, extra) {
  const urls = []
    .concat(primary ? [primary] : [])
    .concat(Array.isArray(supporting) ? supporting : [])
    .concat(Array.isArray(extra) ? extra : [])
    .map(function (value) {
      return String(value || "").trim();
    })
    .filter(Boolean);

  return Array.from(new Set(urls));
}

function normalizeApplication(doc) {
  return {
    id: doc._id,
    created_at: doc.submittedAt || doc._createdAt,
    updated_at: doc.updatedAt || doc._updatedAt || doc.submittedAt || doc._createdAt,
    status: doc.status || "pending",
    intake_type: doc.intakeType || "new_listing",
    provider_id: doc.providerId || buildProviderId(doc),
    target_therapist_slug: doc.targetTherapistSlug || "",
    target_therapist_id: doc.targetTherapistId || "",
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
    source_url: doc.sourceUrl || "",
    supporting_source_urls: Array.isArray(doc.supportingSourceUrls) ? doc.supportingSourceUrls : [],
    source_reviewed_at: doc.sourceReviewedAt || "",
    source_health_status: doc.sourceHealthStatus || "",
    source_health_checked_at: doc.sourceHealthCheckedAt || "",
    source_health_status_code:
      typeof doc.sourceHealthStatusCode === "number" ? doc.sourceHealthStatusCode : null,
    source_health_final_url: doc.sourceHealthFinalUrl || "",
    source_health_error: doc.sourceHealthError || "",
    source_drift_signals: Array.isArray(doc.sourceDriftSignals) ? doc.sourceDriftSignals : [],
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
        const duplicate = await findDuplicateTherapistEntity(client, body);
        if (duplicate) {
          const responsePayload =
            duplicate.kind === "therapist"
              ? {
                  error:
                    "This therapist already has a listing. Please claim or update the existing profile instead of creating a new application.",
                  duplicate_kind: duplicate.kind,
                  duplicate_id: duplicate.id,
                  duplicate_slug: duplicate.slug,
                  duplicate_name: duplicate.name,
                  duplicate_reasons: duplicate.reasons,
                  recommended_intake_type: "claim_existing",
                }
              : {
                  error:
                    "An application is already in progress for this therapist. Please continue that application instead of starting a new one.",
                  duplicate_kind: duplicate.kind,
                  duplicate_id: duplicate.id,
                  duplicate_slug: duplicate.slug,
                  duplicate_name: duplicate.name,
                  duplicate_status: duplicate.status,
                  duplicate_reasons: duplicate.reasons,
                  recommended_intake_type: "update_existing",
                };
          sendJson(response, 409, responsePayload, origin, config);
          return;
        }
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

      const applyLiveFieldsMatch = routePath.match(/^\/applications\/([^/]+)\/apply-live-fields$/);
      if (request.method === "POST" && applyLiveFieldsMatch) {
        if (!isAuthorized(request, config)) {
          sendJson(response, 401, { error: "Unauthorized." }, origin, config);
          return;
        }

        const applicationId = decodeURIComponent(applyLiveFieldsMatch[1]);
        const application = await client.getDocument(applicationId);
        if (!application || application._type !== "therapistApplication") {
          sendJson(response, 404, { error: "Application not found." }, origin, config);
          return;
        }

        const body = await parseBody(request);
        const selectedFields = Array.isArray(body.fields) ? body.fields : [];
        if (!selectedFields.length) {
          sendJson(response, 400, { error: "No fields selected." }, origin, config);
          return;
        }

        const therapistId =
          application.targetTherapistId ||
          application.publishedTherapistId ||
          (application.targetTherapistSlug ? `therapist-${application.targetTherapistSlug}` : "");
        if (!therapistId) {
          sendJson(
            response,
            409,
            { error: "This application is not linked to a live therapist yet." },
            origin,
            config,
          );
          return;
        }

        const therapist = await client.getDocument(therapistId);
        if (!therapist || therapist._type !== "therapist") {
          sendJson(response, 404, { error: "Linked therapist not found." }, origin, config);
          return;
        }

        const nowIso = new Date().toISOString();
        const nextPatch = buildTherapistApplicationFieldPatch(application, therapist, selectedFields, nowIso);
        const fieldReviewStatePatch = buildAppliedFieldReviewStatePatch(selectedFields);
        if (!nextPatch.appliedFields.length) {
          sendJson(
            response,
            400,
            { error: "No supported changed fields were selected." },
            origin,
            config,
          );
          return;
        }

        const transaction = client.transaction();
        transaction.patch(therapistId, function (patch) {
          return patch.set({
            ...nextPatch.patch,
            ...(Object.keys(fieldReviewStatePatch).length
              ? {
                  fieldReviewStates: {
                    ...(therapist.fieldReviewStates || {}),
                    ...fieldReviewStatePatch,
                  },
                }
              : {}),
          });
        });
        transaction.patch(applicationId, function (patch) {
          return patch
            .set({
              status: "approved",
              updatedAt: nowIso,
              publishedTherapistId: therapistId,
              ...(Object.keys(fieldReviewStatePatch).length
                ? {
                    fieldReviewStates: {
                      ...(application.fieldReviewStates || {}),
                      ...fieldReviewStatePatch,
                    },
                  }
                : {}),
            })
            .setIfMissing({ revisionHistory: [] })
            .append("revisionHistory", [
              {
                _key: `${Date.now()}`,
                type: "applied_live_fields",
                at: nowIso,
                message: `Applied live fields: ${nextPatch.appliedFields.join(", ")}`,
              },
            ]);
        });
        transaction.create(
          buildTherapistOpsEvent(therapist, {
            eventType: "therapist_live_fields_applied",
            decision: "apply_live_fields",
            notes: `Application ${applicationId} applied fields: ${nextPatch.appliedFields.join(", ")}`,
            changedFields: nextPatch.appliedFields,
          }),
        );

        await transaction.commit({ visibility: "sync" });
        const updatedTherapist = await client.getDocument(therapistId);
        const updatedApplication = await client.getDocument(applicationId);
        sendJson(
          response,
          200,
          {
            ok: true,
            therapist: updatedTherapist,
            application: normalizeApplication(updatedApplication),
            applied_fields: nextPatch.appliedFields,
          },
          origin,
          config,
        );
        return;
      }

      const candidateDecisionMatch = routePath.match(/^\/candidates\/([^/]+)\/decision$/);
      if (request.method === "POST" && candidateDecisionMatch) {
        if (!isAuthorized(request, config)) {
          sendJson(response, 401, { error: "Unauthorized." }, origin, config);
          return;
        }

        const candidateId = decodeURIComponent(candidateDecisionMatch[1]);
        const candidate = await client.getDocument(candidateId);
        if (!candidate || candidate._type !== "therapistCandidate") {
          sendJson(response, 404, { error: "Candidate not found." }, origin, config);
          return;
        }

        const body = await parseBody(request);
        const decision = String(body.decision || "").trim();
        const notes = String(body.notes || "").trim();
        const allowedDecisions = new Set([
          "mark_ready",
          "needs_review",
          "needs_confirmation",
          "archive",
          "reject_duplicate",
          "merge_to_therapist",
          "merge_to_application",
          "publish",
        ]);

        if (!allowedDecisions.has(decision)) {
          sendJson(response, 400, { error: "Unsupported candidate decision." }, origin, config);
          return;
        }

        const now = new Date().toISOString();
        const historyEntry = {
          _key: `${Date.now()}`,
          type: "review_decision",
          at: now,
          decision,
          note: notes,
        };

        let reviewStatus = candidate.reviewStatus || "queued";
        let publishRecommendation = candidate.publishRecommendation || "";
        let dedupeStatus = candidate.dedupeStatus || "unreviewed";
        let eventType = "candidate_reviewed";
        let therapistId = "";
        let applicationId = "";
        const changedFields = [
          "reviewStatus",
          "publishRecommendation",
          "notes",
          "reviewHistory",
          "reviewLane",
          "reviewPriority",
          "nextReviewDueAt",
          "lastReviewedAt",
        ];

        if (decision === "mark_ready") {
          reviewStatus = "ready_to_publish";
          publishRecommendation = "ready";
        } else if (decision === "needs_review") {
          reviewStatus = "needs_review";
        } else if (decision === "needs_confirmation") {
          reviewStatus = "needs_confirmation";
          publishRecommendation = "needs_confirmation";
        } else if (decision === "archive") {
          reviewStatus = "archived";
          publishRecommendation = "hold";
          eventType = "candidate_archived";
        } else if (decision === "reject_duplicate") {
          reviewStatus = "archived";
          publishRecommendation = "reject";
          dedupeStatus = "rejected_duplicate";
          eventType = "candidate_marked_duplicate";
          changedFields.push("dedupeStatus");
        } else if (decision === "merge_to_therapist") {
          therapistId = candidate.matchedTherapistId || "";
          if (!therapistId) {
            sendJson(
              response,
              409,
              { error: "This candidate is not linked to an existing therapist yet." },
              origin,
              config,
            );
            return;
          }
          reviewStatus = "archived";
          publishRecommendation = "hold";
          dedupeStatus = "merged";
          eventType = "candidate_merged";
          changedFields.push("matchedTherapistId", "dedupeStatus");
        } else if (decision === "publish") {
          const nextTherapist = buildTherapistDocumentFromCandidate(
            candidate,
            candidate.matchedTherapistId,
          );
          therapistId = nextTherapist._id;
          reviewStatus = "published";
          publishRecommendation = "ready";
          eventType = "candidate_published";
          changedFields.push("publishedTherapistId", "publishedAt", "matchedTherapistId");
        } else if (decision === "merge_to_application") {
          applicationId = candidate.matchedApplicationId || "";
          if (!applicationId) {
            sendJson(
              response,
              409,
              { error: "This candidate is not linked to an existing application yet." },
              origin,
              config,
            );
            return;
          }
          reviewStatus = "archived";
          publishRecommendation = "hold";
          dedupeStatus = "merged";
          eventType = "candidate_merged";
          changedFields.push("matchedApplicationId", "dedupeStatus");
        }

        const reviewMeta = computeCandidateReviewMeta({
          ...candidate,
          reviewStatus,
          publishRecommendation,
          dedupeStatus,
        });

        const transaction = client.transaction();
        if (decision === "publish") {
          transaction.createOrReplace(buildTherapistDocumentFromCandidate(candidate, therapistId));
          transaction.delete(`drafts.${therapistId}`);
        } else if (decision === "merge_to_therapist") {
          const therapist = await client.getDocument(therapistId);
          if (!therapist || therapist._type !== "therapist") {
            sendJson(response, 404, { error: "Matched therapist not found." }, origin, config);
            return;
          }
          const mergedTherapistDraft = {
            ...therapist,
            supportingSourceUrls: mergeUniqueUrls(
              therapist.sourceUrl,
              therapist.supportingSourceUrls,
              mergeUniqueUrls(
                candidate.sourceUrl,
                candidate.supportingSourceUrls,
                candidate.website ? [candidate.website] : [],
              ),
            ),
            sourceReviewedAt: candidate.sourceReviewedAt || therapist.sourceReviewedAt || now,
          };

          transaction.patch(therapistId, function (patch) {
            return patch.set({
              supportingSourceUrls: mergedTherapistDraft.supportingSourceUrls,
              sourceReviewedAt: mergedTherapistDraft.sourceReviewedAt,
              fieldTrustMeta: buildFieldTrustMeta(mergedTherapistDraft),
            });
          });
        } else if (decision === "merge_to_application") {
          const application = await client.getDocument(applicationId);
          if (!application || application._type !== "therapistApplication") {
            sendJson(response, 404, { error: "Matched application not found." }, origin, config);
            return;
          }

          transaction.patch(applicationId, function (patch) {
            return patch.set({
              supportingSourceUrls: mergeUniqueUrls(
                application.sourceUrl,
                application.supportingSourceUrls,
                mergeUniqueUrls(
                  candidate.sourceUrl,
                  candidate.supportingSourceUrls,
                  candidate.website ? [candidate.website] : [],
                ),
              ),
              sourceReviewedAt: candidate.sourceReviewedAt || application.sourceReviewedAt || now,
              notes: [application.notes, notes, `Merged candidate: ${candidate.name || candidate.candidateId}`]
                .filter(Boolean)
                .join("\n\n"),
            });
          });
        }

        transaction.patch(candidateId, function (patch) {
          return patch
            .set({
              reviewStatus,
              publishRecommendation,
              dedupeStatus,
              reviewLane: reviewMeta.reviewLane,
              reviewPriority: reviewMeta.reviewPriority,
              nextReviewDueAt: reviewMeta.nextReviewDueAt,
              lastReviewedAt: now,
              notes,
              sourceReviewedAt: candidate.sourceReviewedAt || now,
              ...(therapistId
                ? {
                    matchedTherapistId: therapistId,
                    ...(decision === "publish"
                      ? {
                          publishedTherapistId: therapistId,
                          publishedAt: now,
                        }
                      : {}),
                  }
                : {}),
              ...(applicationId ? { matchedApplicationId: applicationId } : {}),
            })
            .setIfMissing({ reviewHistory: [] })
            .append("reviewHistory", [historyEntry]);
        });

        transaction.create(
          buildCandidateReviewEvent(candidate, {
            eventType,
            therapistId,
            applicationId,
            decision,
            reviewStatus,
            publishRecommendation,
            notes,
            changedFields,
          }),
        );

        await transaction.commit({ visibility: "sync" });
        const updatedCandidate = await client.getDocument(candidateId);
        sendJson(
          response,
          200,
          {
            ok: true,
            candidate: normalizeCandidate(updatedCandidate),
            therapistId: therapistId || updatedCandidate.publishedTherapistId || "",
          },
          origin,
          config,
        );
        return;
      }

      const therapistOpsMatch = routePath.match(/^\/therapists\/([^/]+)\/ops$/);
      if (request.method === "POST" && therapistOpsMatch) {
        if (!isAuthorized(request, config)) {
          sendJson(response, 401, { error: "Unauthorized." }, origin, config);
          return;
        }

        const therapistId = decodeURIComponent(therapistOpsMatch[1]);
        const therapist = await client.getDocument(therapistId);
        if (!therapist || therapist._type !== "therapist") {
          sendJson(response, 404, { error: "Therapist not found." }, origin, config);
          return;
        }

        const body = await parseBody(request);
        const decision = String(body.decision || "").trim();
        const notes = String(body.notes || "").trim();
        const allowedDecisions = new Set(["mark_reviewed", "snooze_7d", "snooze_30d"]);

        if (!allowedDecisions.has(decision)) {
          sendJson(response, 400, { error: "Unsupported therapist ops decision." }, origin, config);
          return;
        }

        const nowIso = new Date().toISOString();
        let patchFields;
        let eventType;
        let changedFields;

        if (decision === "mark_reviewed") {
          const nextTherapist = {
            ...therapist,
            sourceReviewedAt: nowIso,
          };
          const verificationMeta = computeTherapistVerificationMeta({
            ...nextTherapist,
          });
          patchFields = {
            sourceReviewedAt: nowIso,
            lastOperationalReviewAt: verificationMeta.lastOperationalReviewAt,
            nextReviewDueAt: verificationMeta.nextReviewDueAt,
            verificationPriority: verificationMeta.verificationPriority,
            verificationLane: verificationMeta.verificationLane,
            dataCompletenessScore: verificationMeta.dataCompletenessScore,
            fieldTrustMeta: buildFieldTrustMeta(nextTherapist),
          };
          eventType = "therapist_review_completed";
          changedFields = [
            "sourceReviewedAt",
            "lastOperationalReviewAt",
            "nextReviewDueAt",
            "verificationPriority",
            "verificationLane",
            "dataCompletenessScore",
            "fieldTrustMeta",
          ];
        } else {
          const snoozeDays = decision === "snooze_30d" ? 30 : 7;
          patchFields = {
            nextReviewDueAt: addDays(nowIso, snoozeDays),
            verificationLane: "refresh_soon",
          };
          eventType = "therapist_review_deferred";
          changedFields = ["nextReviewDueAt", "verificationLane"];
        }

        const transaction = client.transaction();
        transaction.patch(therapistId, function (patch) {
          return patch.set(patchFields);
        });
        transaction.create(
          buildTherapistOpsEvent(therapist, {
            eventType,
            decision,
            notes,
            changedFields,
          }),
        );

        await transaction.commit({ visibility: "sync" });
        const updatedTherapist = await client.getDocument(therapistId);
        sendJson(response, 200, { ok: true, therapist: updatedTherapist }, origin, config);
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
