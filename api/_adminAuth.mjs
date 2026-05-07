import crypto from "node:crypto";

// Reuses the review API's existing admin session.
// Cookie + signing format must match server/review-http-auth.mjs.
const COOKIE_NAME = "bt_admin_session";

function readCookie(request, name) {
  const header =
    (typeof request.headers?.get === "function"
      ? request.headers.get("cookie")
      : request.headers?.cookie) || "";
  if (!header) return "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return part.slice(i + 1).trim();
      }
    }
  }
  return "";
}

function signValue(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function signaturesMatch(expected, actual) {
  const a = Buffer.from(String(expected || ""), "base64url");
  const b = Buffer.from(String(actual || ""), "base64url");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyAdminSession(request) {
  const secret = process.env.REVIEW_API_SESSION_SECRET;
  if (!secret) return false;

  const token = readCookie(request, COOKIE_NAME);
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [encodedPayload, signature] = parts;
  if (!signaturesMatch(signValue(encodedPayload, secret), signature)) return false;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return false;
  }

  return payload && payload.sub === "admin" && payload.exp > Date.now();
}
