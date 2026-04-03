import http from "node:http";
import process from "node:process";
import path from "node:path";
import fs from "node:fs";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const DEFAULT_PORT = 8787;

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
    token: process.env.SANITY_API_TOKEN || rootEnv.SANITY_API_TOKEN || "",
    adminKey: process.env.REVIEW_API_ADMIN_KEY || rootEnv.REVIEW_API_ADMIN_KEY || "",
    port: Number(process.env.REVIEW_API_PORT || rootEnv.REVIEW_API_PORT || DEFAULT_PORT),
  };
}

function allowOrigin(origin) {
  const allowedOrigins = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
  ]);

  return allowedOrigins.has(origin) ? origin : "http://localhost:5173";
}

function sendJson(response, statusCode, payload, origin) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": allowOrigin(origin),
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  response.end(JSON.stringify(payload));
}

function isAuthorized(request, adminKey) {
  if (!adminKey) {
    return false;
  }

  const requestKey = request.headers["x-admin-key"];
  return typeof requestKey === "string" && requestKey === adminKey;
}

function parseBody(request) {
  return new Promise(function (resolve, reject) {
    let raw = "";

    request.on("data", function (chunk) {
      raw += chunk;
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

async function makeServer() {
  const config = getConfig();
  if (!config.projectId || !config.dataset || !config.token) {
    throw new Error("Missing Sanity config or SANITY_API_TOKEN for review API.");
  }

  if (!config.adminKey) {
    throw new Error("Missing REVIEW_API_ADMIN_KEY for review API.");
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token,
    useCdn: false,
    perspective: "raw",
  });

  const server = http.createServer(async function (request, response) {
    const origin = request.headers.origin || "";
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "OPTIONS") {
      sendJson(response, 200, { ok: true }, origin);
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true }, origin);
        return;
      }

      if (request.method === "GET" && url.pathname === "/applications") {
        if (!isAuthorized(request, config.adminKey)) {
          sendJson(response, 401, { error: "Unauthorized." }, origin);
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

        sendJson(response, 200, docs.map(normalizeApplication), origin);
        return;
      }

      if (request.method === "POST" && url.pathname === "/applications") {
        const body = await parseBody(request);
        const document = buildApplicationDocument(body);
        const created = await client.create(document);
        sendJson(response, 201, normalizeApplication(created), origin);
        return;
      }

      const approveMatch = url.pathname.match(/^\/applications\/([^/]+)\/approve$/);
      if (request.method === "POST" && approveMatch) {
        if (!isAuthorized(request, config.adminKey)) {
          sendJson(response, 401, { error: "Unauthorized." }, origin);
          return;
        }

        const applicationId = decodeURIComponent(approveMatch[1]);
        const application = await client.getDocument(applicationId);
        if (!application || application._type !== "therapistApplication") {
          sendJson(response, 404, { error: "Application not found." }, origin);
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

        sendJson(response, 200, { ok: true, therapistId: therapistId }, origin);
        return;
      }

      const rejectMatch = url.pathname.match(/^\/applications\/([^/]+)\/reject$/);
      if (request.method === "POST" && rejectMatch) {
        if (!isAuthorized(request, config.adminKey)) {
          sendJson(response, 401, { error: "Unauthorized." }, origin);
          return;
        }

        const applicationId = decodeURIComponent(rejectMatch[1]);
        await client
          .patch(applicationId)
          .set({ status: "rejected", updatedAt: new Date().toISOString() })
          .commit({ visibility: "sync" });

        sendJson(response, 200, { ok: true }, origin);
        return;
      }

      sendJson(response, 404, { error: "Not found." }, origin);
    } catch (error) {
      sendJson(
        response,
        500,
        { error: error && error.message ? error.message : "Unexpected server error." },
        origin,
      );
    }
  });

  server.listen(config.port, function () {
    console.log(`Review API ready at http://localhost:${config.port}`);
  });
}

makeServer().catch(function (error) {
  console.error(error.message || error);
  process.exitCode = 1;
});
