import crypto from "node:crypto";

const loginAttemptStore = new Map();

// Separate store for intake (signup) rate limiting. Keyed by real client IP
// (x-forwarded-for takes precedence over socket address since Vercel proxies
// all traffic). Window and cap are intentionally more lenient than admin login
// — a legitimate therapist retrying after a DCA failure should not be locked out.
const intakeAttemptStore = new Map();
const INTAKE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const INTAKE_MAX_ATTEMPTS = 5;

// IP-level rate limit for portal auth endpoints (sign-in, claim-link, OTP,
// recovery requests). Keyed by IP. More lenient than admin login — a real
// therapist might retry a few times, but 10 attempts per 15 min is plenty.
const portalAttemptStore = new Map();
const PORTAL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const PORTAL_MAX_ATTEMPTS = 10;

function getClientAddress(request) {
  // x-forwarded-for may be a comma-separated chain; take the first entry.
  const xff = request.headers && request.headers["x-forwarded-for"];
  if (xff) {
    const first = String(xff).split(",")[0].trim();
    if (first) return first;
  }
  return (request.socket && request.socket.remoteAddress) || "unknown";
}

function purgeExpiredIntakeWindows() {
  const now = Date.now();
  for (const [key, value] of intakeAttemptStore.entries()) {
    if (!value || now - value.windowStartedAt > INTAKE_WINDOW_MS) {
      intakeAttemptStore.delete(key);
    }
  }
}

export function canAttemptIntake(request) {
  purgeExpiredIntakeWindows();
  const ip = getClientAddress(request);
  const record = intakeAttemptStore.get(ip);
  return !record || record.count < INTAKE_MAX_ATTEMPTS;
}

export function recordIntakeAttempt(request) {
  purgeExpiredIntakeWindows();
  const ip = getClientAddress(request);
  const existing = intakeAttemptStore.get(ip);
  if (!existing) {
    intakeAttemptStore.set(ip, { count: 1, windowStartedAt: Date.now() });
  } else {
    intakeAttemptStore.set(ip, {
      count: existing.count + 1,
      windowStartedAt: existing.windowStartedAt,
    });
  }
}

function purgeExpiredPortalWindows() {
  const now = Date.now();
  for (const [key, value] of portalAttemptStore.entries()) {
    if (!value || now - value.windowStartedAt > PORTAL_WINDOW_MS) {
      portalAttemptStore.delete(key);
    }
  }
}

export function canAttemptPortalAuth(request) {
  purgeExpiredPortalWindows();
  const ip = getClientAddress(request);
  const record = portalAttemptStore.get(ip);
  return !record || record.count < PORTAL_MAX_ATTEMPTS;
}

export function recordPortalAuthAttempt(request) {
  purgeExpiredPortalWindows();
  const ip = getClientAddress(request);
  const existing = portalAttemptStore.get(ip);
  if (!existing) {
    portalAttemptStore.set(ip, { count: 1, windowStartedAt: Date.now() });
  } else {
    portalAttemptStore.set(ip, {
      count: existing.count + 1,
      windowStartedAt: existing.windowStartedAt,
    });
  }
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

function purgeExpiredLoginWindows(config) {
  const now = Date.now();
  Array.from(loginAttemptStore.entries()).forEach(function ([key, value]) {
    if (!value || now - value.windowStartedAt > config.loginWindowMs) {
      loginAttemptStore.delete(key);
    }
  });
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
  const parts = [
    `${name}=${encodeURIComponent(token || "")}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
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
  if (!signaturesMatch(signValue(encodedPayload, secret), signature)) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64Url(encodedPayload));
  } catch (_error) {
    return null;
  }
}

export function readSignedSession(token, config) {
  const payload = readSignedPayload(token, config.sessionSecret);
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
  const payload = readSignedPayload(token, config.sessionSecret);
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

export function canAttemptLogin(request, config) {
  purgeExpiredLoginWindows(config);
  const clientAddress = getClientAddress(request);
  const attempts = loginAttemptStore.get(clientAddress);
  if (!attempts) {
    return true;
  }

  return attempts.count < config.loginMaxAttempts;
}

export function recordFailedLogin(request, config) {
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

export function clearFailedLogins(request) {
  const clientAddress = getClientAddress(request);
  loginAttemptStore.delete(clientAddress);
}
