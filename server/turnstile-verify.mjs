// Server-side verification for Cloudflare Turnstile tokens.
//
// Fail-closed when the secret is configured (any verification failure
// rejects the request). No-op pass-through when TURNSTILE_SECRET_KEY
// is unset, so the integration can ship before Cloudflare is wired up
// in Vercel envs. Client-side mounting is similarly gated on
// VITE_TURNSTILE_SITE_KEY — both halves can be flipped on
// independently via env vars without redeploying code.
//
// API: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function isTurnstileConfigured(config) {
  return Boolean(config && config.turnstileSecretKey);
}

// Verify a Turnstile token. Returns { ok: true } on success or
// when not configured. Returns { ok: false, code, ... } on any failure.
// The caller decides the response shape — typically a 403 with a
// generic "verification failed" message so attackers cannot learn
// which specific check tripped.
export async function verifyTurnstileToken({ token, remoteIp, config, fetchImpl }) {
  if (!isTurnstileConfigured(config)) {
    return { ok: true, bypassed: true };
  }
  if (!token || typeof token !== "string") {
    return { ok: false, code: "missing-token" };
  }

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    return { ok: false, code: "no-fetch-available" };
  }

  const body = new URLSearchParams({
    secret: config.turnstileSecretKey,
    response: token,
  });
  if (remoteIp) body.set("remoteip", remoteIp);

  let response;
  try {
    response = await doFetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    return { ok: false, code: "siteverify-network-error", error: String(err && err.message) };
  }

  if (!response.ok) {
    return { ok: false, code: "siteverify-bad-status", status: response.status };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, code: "siteverify-bad-json" };
  }

  if (data && data.success === true) {
    return { ok: true };
  }

  return {
    ok: false,
    code: "rejected",
    errorCodes: Array.isArray(data && data["error-codes"]) ? data["error-codes"] : [],
  };
}
