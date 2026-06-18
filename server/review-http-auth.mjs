import crypto from "node:crypto";

import { getRateLimiter } from "./rate-limit-store.mjs";

// Rate-limit windows + caps. When config has Upstash Redis credentials,
// the store persists across Vercel cold starts and concurrent function
// instances. When it doesn't, falls back to an in-process Map (matching
// the original behavior). See server/rate-limit-store.mjs for details.

const INTAKE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const INTAKE_MAX_ATTEMPTS = 5; // lenient: legitimate therapist may retry after DCA failures
const PORTAL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const PORTAL_MAX_ATTEMPTS = 10; // lenient: portal sign-in / claim-link / OTP / recovery

// Resolve the client IP for security-sensitive use (rate limiters,
// brute-force lockouts). Prefer headers the Vercel edge sets and
// overwrites — x-vercel-forwarded-for (Vercel's validated XFF) and
// x-real-ip — because a client cannot spoof them. The raw
// x-forwarded-for chain is only used as a fallback for non-Vercel
// setups (local dev, self-hosting); its left-most entry IS
// client-controllable, so it must never take precedence over the
// platform-trusted headers. Falls back to the socket address last.
export function getClientAddress(request) {
  const headers = request.headers || {};
  const firstEntry = function (value) {
    if (!value) return "";
    const raw = Array.isArray(value) ? value[0] : value;
    return String(raw).split(",")[0].trim();
  };
  const trusted = firstEntry(headers["x-vercel-forwarded-for"]) || firstEntry(headers["x-real-ip"]);
  if (trusted) return trusted;
  const forwarded = firstEntry(headers["x-forwarded-for"]);
  if (forwarded) return forwarded;
  return (request.socket && request.socket.remoteAddress) || "unknown";
}

export async function canAttemptIntake(request, config) {
  const limiter = getRateLimiter("intake", INTAKE_WINDOW_MS, INTAKE_MAX_ATTEMPTS, config);
  return limiter.canAttempt(getClientAddress(request));
}

export async function recordIntakeAttempt(request, config) {
  const limiter = getRateLimiter("intake", INTAKE_WINDOW_MS, INTAKE_MAX_ATTEMPTS, config);
  await limiter.record(getClientAddress(request));
}

export async function canAttemptPortalAuth(request, config) {
  const limiter = getRateLimiter("portal", PORTAL_WINDOW_MS, PORTAL_MAX_ATTEMPTS, config);
  return limiter.canAttempt(getClientAddress(request));
}

export async function recordPortalAuthAttempt(request, config) {
  const limiter = getRateLimiter("portal", PORTAL_WINDOW_MS, PORTAL_MAX_ATTEMPTS, config);
  await limiter.record(getClientAddress(request));
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

function signaturesMatch(expected, actual) {
  const expectedBuffer = Buffer.from(String(expected || ""), "base64url");
  const actualBuffer = Buffer.from(String(actual || ""), "base64url");
  return (
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function getAllowedOrigin(origin, config) {
  if (!origin) {
    return "";
  }

  return config.allowedOrigins.includes(origin) ? origin : "";
}

export function getSecurityWarnings(config) {
  const warnings = [];

  if (!(config.adminUsername && config.adminPassword)) {
    warnings.push("Review API admin credentials are not configured.");
  }
  return warnings;
}

export function normalizeRoutePath(pathname) {
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

export function sendJson(response, statusCode, payload, origin, config) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Cache-Control": "no-store",
    // Defense-in-depth for API responses: never sniff away from JSON,
    // never render inside a frame, and treat any markup an attacker
    // manages to reflect through a JSON body as inert if a browser is
    // ever coaxed into rendering the response directly.
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    Vary: "Origin",
  };
  const allowedOrigin = getAllowedOrigin(origin, config);
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  response.writeHead(statusCode, headers);
  response.end(JSON.stringify(payload));
}

export const ADMIN_SESSION_COOKIE = "bt_admin_session";
export const THERAPIST_SESSION_COOKIE = "bt_therapist_session";

function parseCookieHeader(request) {
  const header = request && request.headers ? request.headers.cookie : "";
  if (!header || typeof header !== "string") {
    return {};
  }

  return header.split(";").reduce(function (cookies, entry) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex === -1) {
      return cookies;
    }
    const name = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();
    if (!name) {
      return cookies;
    }
    try {
      cookies[name] = decodeURIComponent(value);
    } catch (_error) {
      cookies[name] = value;
    }
    return cookies;
  }, {});
}

function readSessionToken(request, cookieName) {
  return parseCookieHeader(request)[cookieName] || "";
}

function isSecureCookieRequest(request) {
  const headers = (request && request.headers) || {};
  const proto = String(headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  if (proto) {
    return proto === "https";
  }
  const host = String(headers.host || "").toLowerCase();
  return (
    host &&
    host !== "localhost:8787" &&
    !host.startsWith("localhost:") &&
    !host.startsWith("127.0.0.1:")
  );
}

export function buildSessionCookie(request, name, token, maxAgeSeconds) {
  // SameSite=Strict for admin and portal sessions. Both are
  // same-origin only — never linked from a third-party origin in a
  // way that needs cookie delivery on the first hop. Strict
  // eliminates the residual CSRF surface that Lax leaves on GET
  // navigations. Minor UX cost: if a logged-in user follows a link
  // from a third-party site (e.g. an email client) the first request
  // arrives without the cookie, so they'll see a logged-out page
  // until the next navigation or refresh.
  const parts = [
    `${name}=${encodeURIComponent(token || "")}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (Number.isFinite(maxAgeSeconds)) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  }
  if (isSecureCookieRequest(request)) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function buildExpiredSessionCookie(request, name) {
  return buildSessionCookie(request, name, "", 0);
}

export function createSignedSession(config, claims) {
  const extraClaims = claims && typeof claims === "object" ? claims : {};
  return createSignedPayload(
    {
      sub: "admin",
      iat: Date.now(),
      exp: Date.now() + config.sessionTtlMs,
      nonce: crypto.randomBytes(12).toString("hex"),
      ...extraClaims,
    },
    config.sessionSecret,
  );
}

export function createSignedPayload(payload, secret) {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signValue(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

// Ordered list of secrets accepted when VERIFYING a signed session/token:
// the current secret first, then any previous secrets still inside their
// rotation overlap window (config.sessionSecretsPrevious). Signing always
// uses the current secret only (createSignedPayload), so rotating is:
// move the old secret into REVIEW_API_SESSION_SECRET_PREVIOUS, set a new
// REVIEW_API_SESSION_SECRET, and tokens signed with the old one keep
// verifying until they expire or the previous entry is dropped.
export function sessionVerificationSecrets(config) {
  const previous = Array.isArray(config && config.sessionSecretsPrevious)
    ? config.sessionSecretsPrevious
    : [];
  return [config && config.sessionSecret, ...previous].filter(Boolean);
}

// Accepts either a single secret (string) or a list of secrets to try in
// order. Returns the decoded payload if ANY secret produces a matching
// signature, else null. Each comparison is constant-time; trying multiple
// server-side secrets leaks no useful timing signal.
export function readSignedPayload(token, secret) {
  if (!token) {
    return null;
  }

  const parts = String(token).split(".");
  if (parts.length !== 2) {
    return null;
  }

  const encodedPayload = parts[0];
  const signature = parts[1];
  const secrets = Array.isArray(secret) ? secret : [secret];
  const matched = secrets.some(
    (candidate) => candidate && signaturesMatch(signValue(encodedPayload, candidate), signature),
  );
  if (!matched) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64Url(encodedPayload));
  } catch (_error) {
    return null;
  }
}

export function readSignedSession(token, config) {
  const payload = readSignedPayload(token, sessionVerificationSecrets(config));
  if (!payload || payload.sub !== "admin" || !payload.exp || payload.exp <= Date.now()) {
    return null;
  }

  return payload;
}

export function readAdminSessionFromRequest(request, config) {
  return readSignedSession(readSessionToken(request, ADMIN_SESSION_COOKIE), config);
}

// 14-day absolute TTL. Therapists edit listings monthly at best, so a
// shorter window bounds risk from shared devices / lost tablets without
// forcing frequent re-auth during normal use. Sliding refresh can be
// added later if retention data warrants it.
const DEFAULT_THERAPIST_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function createTherapistSession(config, claims) {
  const extraClaims = claims && typeof claims === "object" ? claims : {};
  const ttl = Number.isFinite(config.therapistSessionTtlMs)
    ? config.therapistSessionTtlMs
    : DEFAULT_THERAPIST_SESSION_TTL_MS;
  return createSignedPayload(
    {
      sub: "therapist",
      iat: Date.now(),
      exp: Date.now() + ttl,
      nonce: crypto.randomBytes(12).toString("hex"),
      ...extraClaims,
    },
    config.sessionSecret,
  );
}

export function readTherapistSession(token, config) {
  const payload = readSignedPayload(token, sessionVerificationSecrets(config));
  if (!payload || payload.sub !== "therapist" || !payload.exp || payload.exp <= Date.now()) {
    return null;
  }
  if (!payload.slug) {
    return null;
  }
  return payload;
}

export function getAuthorizedTherapist(request, config) {
  const payload = readTherapistSession(readSessionToken(request, THERAPIST_SESSION_COOKIE), config);
  if (!payload) {
    return null;
  }
  return {
    slug: String(payload.slug || ""),
    email: String(payload.email || ""),
    issuedAt: payload.iat || 0,
    expiresAt: payload.exp || 0,
  };
}

// A therapist session is bound to the email that owned the listing when the
// token was minted (the `email` claim). Sessions are cryptographically valid
// for 14 days, but ownership can change before then — account recovery flips
// `claimedByEmail` to a new address. A stale token stays signature-valid, so
// without this check a previous owner (or a phished old session) keeps full
// edit/billing access to a listing they no longer own.
//
// Returns true when we can prove the session no longer owns the listing, via
// either of two gates:
//
//   1. Timestamp gate: the listing carries `ownershipChangedAt`, stamped every
//      time account recovery transfers it, and the session was issued before
//      that transfer. This is authoritative — it catches the case the email
//      gate below misses (a legacy doc with no claimedByEmail, or a transfer
//      that happens to land back on the same email) and does not depend on the
//      session carrying an email claim.
//   2. Email gate: the current owner email (`claimedByEmail`) differs from the
//      email the session was bound to at mint time.
//
// Missing data (no ownershipChangedAt and no claimedByEmail, or no email on the
// session) is treated as "not proven stale" so we fall back to the other gates
// (claimStatus etc.) rather than locking out legitimate owners of older records.
export function sessionIsStaleForListing(session, therapistDoc) {
  if (!session || !therapistDoc) {
    return false;
  }
  // Sessions minted by getAuthorizedTherapist expose `issuedAt`; raw JWT
  // payloads expose `iat`. Both are epoch milliseconds.
  const issuedAtMs = Number(session.issuedAt || session.iat || 0);
  const ownershipChangedAtMs = Date.parse(therapistDoc.ownershipChangedAt || "");
  if (
    issuedAtMs > 0 &&
    Number.isFinite(ownershipChangedAtMs) &&
    ownershipChangedAtMs > issuedAtMs
  ) {
    return true;
  }
  const sessionEmail = String(session.email || "")
    .trim()
    .toLowerCase();
  const ownerEmail = String(therapistDoc.claimedByEmail || "")
    .trim()
    .toLowerCase();
  if (!sessionEmail || !ownerEmail) {
    return false;
  }
  return sessionEmail !== ownerEmail;
}

export function isAuthorized(request, config) {
  const sessionPayload = readAdminSessionFromRequest(request, config);
  if (sessionPayload) {
    return true;
  }

  return false;
}

export function getAuthorizedActor(request, config) {
  const sessionPayload = readAdminSessionFromRequest(request, config);
  if (sessionPayload) {
    return String(sessionPayload.username || sessionPayload.actorName || "admin").trim() || "admin";
  }

  return "";
}

export function parseBody(request, maxRequestBodyBytes) {
  return new Promise(function (resolve, reject) {
    let raw = "";

    request.on("data", function (chunk) {
      raw += chunk;
      if (raw.length > maxRequestBodyBytes) {
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

export function parseRawBody(request, maxRequestBodyBytes) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let total = 0;

    request.on("data", function (chunk) {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += piece.length;
      if (total > maxRequestBodyBytes) {
        reject(new Error("Request body too large."));
        request.destroy();
        return;
      }
      chunks.push(piece);
    });

    request.on("end", function () {
      resolve(Buffer.concat(chunks));
    });

    request.on("error", reject);
  });
}

function getLoginLimiter(config) {
  return getRateLimiter("login", config.loginWindowMs, config.loginMaxAttempts, config);
}

export async function canAttemptLogin(request, config) {
  return getLoginLimiter(config).canAttempt(getClientAddress(request));
}

export async function recordFailedLogin(request, config) {
  await getLoginLimiter(config).record(getClientAddress(request));
}

export async function clearFailedLogins(request, config) {
  await getLoginLimiter(config).clear(getClientAddress(request));
}

// Rotate the therapist session cookie on every portal request when the token
// is more than 1 hour old. Keeps the effective window sliding rather than
// fixed at issuance time, so a therapist editing their listing monthly never
// gets unexpectedly logged out during a session.
const SESSION_REFRESH_THRESHOLD_MS = 60 * 60 * 1000;

export function refreshTherapistSessionIfStale(request, response, config) {
  const token = readSessionToken(request, THERAPIST_SESSION_COOKIE);
  const payload = readTherapistSession(token, config);
  if (!payload) return;
  if (Date.now() - (payload.iat || 0) < SESSION_REFRESH_THRESHOLD_MS) return;
  const newToken = createTherapistSession(config, {
    slug: payload.slug,
    email: payload.email,
  });
  const ttl = Number.isFinite(config.therapistSessionTtlMs)
    ? config.therapistSessionTtlMs
    : DEFAULT_THERAPIST_SESSION_TTL_MS;
  response.setHeader(
    "Set-Cookie",
    buildSessionCookie(request, THERAPIST_SESSION_COOKIE, newToken, ttl / 1000),
  );
}

export function makeSessionHelpers(deps, request, response) {
  function setSessionCookie(name, token, maxAgeSeconds) {
    if (typeof deps.buildSessionCookie !== "function") return;
    response.setHeader("Set-Cookie", deps.buildSessionCookie(request, name, token, maxAgeSeconds));
  }
  function clearSessionCookie(name) {
    if (typeof deps.buildExpiredSessionCookie !== "function") return;
    response.setHeader("Set-Cookie", deps.buildExpiredSessionCookie(request, name));
  }
  return { setSessionCookie, clearSessionCookie };
}
