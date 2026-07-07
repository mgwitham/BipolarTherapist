// Keyless auth for GitHub Actions → review API, used by the photo-sourcing
// sweep workflow so no CRON_SECRET has to be copied into GitHub.
//
// How it works: a workflow job requests an OIDC token from GitHub's issuer
// (https://token.actions.githubusercontent.com). That token is a signed JWT
// whose claims name the repository and ref the job is running for. We verify
// the RS256 signature against the issuer's published JWKS and then pin every
// claim that matters:
//   iss  — must be GitHub's Actions issuer
//   aud  — must be our custom audience (workflow requests it explicitly)
//   repository — must be THIS repo
//   ref  — must be refs/heads/main (a branch can't grant itself access)
//   exp/nbf — standard freshness checks
//
// Scope: callers gate ONLY the /cron/source-photos route with this — it is
// deliberately not a general alternative to the cron secret.

import crypto from "node:crypto";

export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const GITHUB_OIDC_AUDIENCE = "bipolartherapyhub-cron";
export const GITHUB_OIDC_ALLOWED_REPOSITORY = "mgwitham/BipolarTherapist";
export const GITHUB_OIDC_ALLOWED_REF = "refs/heads/main";

const JWKS_URL = GITHUB_OIDC_ISSUER + "/.well-known/jwks";
const JWKS_CACHE_MS = 10 * 60 * 1000;

let jwksCache = { keys: null, fetchedAt: 0 };

function b64urlToBuffer(value) {
  const s = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Buffer.from(s, "base64");
}

function decodeJsonSegment(segment) {
  try {
    return JSON.parse(b64urlToBuffer(segment).toString("utf8"));
  } catch {
    return null;
  }
}

async function getJwks(fetchImpl, nowMs) {
  if (jwksCache.keys && nowMs - jwksCache.fetchedAt < JWKS_CACHE_MS) {
    return jwksCache.keys;
  }
  const res = await fetchImpl(JWKS_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
  const body = await res.json();
  const keys = Array.isArray(body && body.keys) ? body.keys : [];
  jwksCache = { keys, fetchedAt: nowMs };
  return keys;
}

// Verify a GitHub Actions OIDC token. Returns the claims payload when the
// token is valid for this repo's main branch, or null otherwise. Never
// throws for a bad token — only for infrastructure failures (JWKS fetch),
// which callers treat as unauthorized.
export async function verifyGitHubActionsToken(token, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    nowMs = Date.now(),
    audience = GITHUB_OIDC_AUDIENCE,
    repository = GITHUB_OIDC_ALLOWED_REPOSITORY,
    ref = GITHUB_OIDC_ALLOWED_REF,
  } = options;

  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const header = decodeJsonSegment(parts[0]);
  const payload = decodeJsonSegment(parts[1]);
  if (!header || !payload) return null;
  if (header.alg !== "RS256" || !header.kid) return null;

  // Claim pinning before any crypto — cheap rejects first.
  if (payload.iss !== GITHUB_OIDC_ISSUER) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(audience)) return null;
  if (payload.repository !== repository) return null;
  if (payload.ref !== ref) return null;
  const nowSec = Math.floor(nowMs / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;
  if (typeof payload.nbf === "number" && payload.nbf > nowSec + 60) return null;

  let keys;
  try {
    keys = await getJwks(fetchImpl, nowMs);
  } catch {
    return null;
  }
  const jwk = keys.find((k) => k && k.kid === header.kid && (k.kty === "RSA" || !k.kty));
  if (!jwk) return null;

  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    return null;
  }
  const data = Buffer.from(parts[0] + "." + parts[1], "utf8");
  const signature = b64urlToBuffer(parts[2]);
  let valid = false;
  try {
    valid = crypto.verify("RSA-SHA256", data, publicKey, signature);
  } catch {
    return null;
  }
  return valid ? payload : null;
}

// Request-level helper for routes: reads the Bearer token and verifies it.
export async function isAuthorizedGitHubActionsRequest(request, options = {}) {
  const header = String((request && request.headers && request.headers.authorization) || "");
  if (!header.startsWith("Bearer ")) return false;
  const payload = await verifyGitHubActionsToken(header.slice("Bearer ".length), options);
  return Boolean(payload);
}

// Test hook: reset the module-level JWKS cache between cases.
export function _resetJwksCacheForTests() {
  jwksCache = { keys: null, fetchedAt: 0 };
}
