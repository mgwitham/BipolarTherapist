// Admin session check for the standalone api/admin/* functions (the outreach
// CRM endpoints, which live outside the review dispatcher).
//
// Delegates to server/review-http-auth.mjs rather than reimplementing the
// cookie parse + HMAC verify. The previous local copy had already drifted: it
// read only REVIEW_API_SESSION_SECRET and ignored
// REVIEW_API_SESSION_SECRET_PREVIOUS, so during a documented rotation overlap
// admin sessions kept working on /api/review/* while every endpoint here
// started returning 401 — a confusing half-broken admin UI rather than a clean
// re-login. That module is light (node:crypto plus the rate-limit store), so
// there is no cold-start reason to keep a second implementation.
import { readAdminSessionFromRequest } from "../server/review-http-auth.mjs";

// Mirrors review-config.mjs: signing always uses REVIEW_API_SESSION_SECRET,
// while verification also accepts a comma-separated list of previous secrets
// for the duration of a rotation overlap.
function sessionConfigFromEnv() {
  return {
    sessionSecret: process.env.REVIEW_API_SESSION_SECRET || "",
    sessionSecretsPrevious: String(process.env.REVIEW_API_SESSION_SECRET_PREVIOUS || "")
      .split(",")
      .map((secret) => secret.trim())
      .filter(Boolean),
  };
}

export function verifyAdminSession(request) {
  if (!process.env.REVIEW_API_SESSION_SECRET) return false;
  return Boolean(readAdminSessionFromRequest(request, sessionConfigFromEnv()));
}
