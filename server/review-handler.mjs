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
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const loginAttemptStore = new Map();

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
    sessionSecret:
      process.env.REVIEW_API_SESSION_SECRET ||
      rootEnv.REVIEW_API_SESSION_SECRET ||
      process.env.REVIEW_API_ADMIN_PASSWORD ||
      rootEnv.REVIEW_API_ADMIN_PASSWORD ||
      process.env.REVIEW_API_ADMIN_KEY ||
      rootEnv.REVIEW_API_ADMIN_KEY ||
      "",
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
  };

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

  return config;
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
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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

function readSignedSession(token, config) {
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const encodedPayload = parts[0];
  const signature = parts[1];
  if (signValue(encodedPayload, config.sessionSecret) !== signature) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload));
    if (!payload || payload.sub !== "admin" || !payload.exp || payload.exp <= Date.now()) {
      return null;
    }

    return payload;
  } catch (_error) {
    return null;
  }
}

function isAuthorized(request, config) {
  const sessionPayload = readSignedSession(parseAuthorizationHeader(request), config);
  if (sessionPayload) {
    return true;
  }

  if (!config.adminKey) {
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

function buildApplicationDocument(input) {
  const slug = slugify(
    input.slug || [input.name, input.city, input.state].filter(Boolean).join(" "),
  );
  const now = new Date().toISOString();

  if (
    !input.name ||
    !input.credentials ||
    !input.email ||
    !input.city ||
    !input.state ||
    !input.bio
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
    practiceName: (input.practice_name || "").trim(),
    phone: (input.phone || "").trim(),
    website: (input.website || "").trim(),
    city: input.city.trim(),
    state: input.state.trim(),
    zip: (input.zip || "").trim(),
    country: "US",
    bio: input.bio.trim(),
    specialties: splitList(input.specialties),
    insuranceAccepted: splitList(input.insurance_accepted),
    languages: splitList(input.languages).length ? splitList(input.languages) : ["English"],
    yearsExperience: parseNumber(input.years_experience),
    acceptsTelehealth: parseBoolean(input.accepts_telehealth, true),
    acceptsInPerson: parseBoolean(input.accepts_in_person, true),
    acceptingNewPatients: true,
    sessionFeeMin: parseNumber(input.session_fee_min),
    sessionFeeMax: parseNumber(input.session_fee_max),
    slidingScale: parseBoolean(input.sliding_scale, false),
    status: "pending",
    submittedSlug: slug,
    submittedAt: now,
    updatedAt: now,
  };
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
    bio: application.bio || "",
    bioPreview: application.bio || "",
    practiceName: application.practiceName || "",
    email: application.email || "",
    phone: application.phone || "",
    website: application.website || "",
    city: application.city || "",
    state: application.state || "",
    zip: application.zip || "",
    country: application.country || "US",
    specialties: splitList(application.specialties),
    insuranceAccepted: splitList(application.insuranceAccepted),
    languages: splitList(application.languages).length
      ? splitList(application.languages)
      : ["English"],
    yearsExperience: parseNumber(application.yearsExperience),
    acceptsTelehealth: parseBoolean(application.acceptsTelehealth, true),
    acceptsInPerson: parseBoolean(application.acceptsInPerson, true),
    acceptingNewPatients: parseBoolean(application.acceptingNewPatients, true),
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
    bio: doc.bio || "",
    email: doc.email || "",
    phone: doc.phone || "",
    website: doc.website || "",
    practice_name: doc.practiceName || "",
    city: doc.city || "",
    state: doc.state || "",
    zip: doc.zip || "",
    specialties: Array.isArray(doc.specialties) ? doc.specialties : [],
    insurance_accepted: Array.isArray(doc.insuranceAccepted) ? doc.insuranceAccepted : [],
    accepts_telehealth: doc.acceptsTelehealth !== false,
    accepts_in_person: doc.acceptsInPerson !== false,
    accepting_new_patients: doc.acceptingNewPatients !== false,
    years_experience: doc.yearsExperience || null,
    languages: Array.isArray(doc.languages) && doc.languages.length ? doc.languages : ["English"],
    session_fee_min: doc.sessionFeeMin || null,
    session_fee_max: doc.sessionFeeMax || null,
    sliding_scale: Boolean(doc.slidingScale),
    notes: doc.notes || "",
    published_therapist_id: doc.publishedTherapistId || "",
  };
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
        const usingLegacyKey = config.adminKey;

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
            _id, _createdAt, _updatedAt, name, email, credentials, title, practiceName, phone, website, city, state, zip, country,
            bio, specialties, insuranceAccepted, languages, yearsExperience, acceptsTelehealth, acceptsInPerson,
            acceptingNewPatients, sessionFeeMin, sessionFeeMax, slidingScale, status, notes, submittedSlug,
            submittedAt, updatedAt, publishedTherapistId
          }`,
        );

        sendJson(response, 200, docs.map(normalizeApplication), origin, config);
        return;
      }

      if (request.method === "POST" && routePath === "/applications") {
        const body = await parseBody(request);
        const document = buildApplicationDocument(body);
        const created = await client.create(document);
        sendJson(response, 201, normalizeApplication(created), origin, config);
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
        const therapistId = `therapist-${slug}`;

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
        await client
          .patch(applicationId)
          .set({ status: "rejected", updatedAt: new Date().toISOString() })
          .commit({ visibility: "sync" });

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
