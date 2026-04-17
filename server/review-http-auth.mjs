import crypto from "node:crypto";

const loginAttemptStore = new Map();

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signValue(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function getAllowedOrigin(origin, config) {
  if (!origin) {
    return "";
  }

  return config.allowedOrigins.includes(origin) ? origin : "";
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

export function getSecurityWarnings(config) {
  const warnings = [];

  if (
    !(config.adminUsername && config.adminPassword) &&
    !(config.allowLegacyKey && config.adminKey)
  ) {
    warnings.push("Review API admin credentials are not configured.");
  }
  if (config.allowLegacyKey && config.adminKey) {
    warnings.push("Legacy x-admin-key authentication remains enabled.");
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

export function parseAuthorizationHeader(request) {
  const header = request.headers.authorization;
  if (!header || typeof header !== "string") {
    return "";
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
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
  if (signValue(encodedPayload, secret) !== signature) {
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

const DEFAULT_THERAPIST_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
  const payload = readTherapistSession(parseAuthorizationHeader(request), config);
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

export function getAuthorizedActor(request, config) {
  const sessionPayload = readSignedSession(parseAuthorizationHeader(request), config);
  if (sessionPayload) {
    return String(sessionPayload.username || sessionPayload.actorName || "admin").trim() || "admin";
  }

  if (config.allowLegacyKey && config.adminKey) {
    const requestKey = request.headers["x-admin-key"];
    if (typeof requestKey === "string" && requestKey === config.adminKey) {
      return "legacy-admin-key";
    }
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
