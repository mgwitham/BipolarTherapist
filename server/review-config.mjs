import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const DEFAULT_PORT = 8787;
const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const DEFAULT_LOGIN_WINDOW_MS = 1000 * 60 * 15;
const DEFAULT_LOGIN_MAX_ATTEMPTS = 10;

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
