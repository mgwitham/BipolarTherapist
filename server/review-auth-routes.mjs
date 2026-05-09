import { log } from "./logger.mjs";
import {
  ADMIN_SESSION_COOKIE,
  THERAPIST_SESSION_COOKIE,
  makeSessionHelpers,
} from "./review-http-auth.mjs";

// POST /portal/dev-login — BYPASSES the magic-link email flow for local
// testing. Mints a therapist session JWT for one of a small, hardcoded
// set of test emails, as long as three independent guards all pass:
//
//   1. process.env.NODE_ENV === "development"
//   2. process.env.ALLOW_DEV_LOGIN === "true"
//   3. the requested email is in DEV_LOGIN_ALLOWED_EMAILS below
//
// If guard 1 or 2 fails, the endpoint returns 404 with no logging so it
// is indistinguishable from "this route does not exist." If guard 3
// fails, it returns 404 for the same reason — even with the bypass
// accidentally enabled in a real env, it cannot be aimed at a real
// claimed therapist.
//
// When the bypass IS used, a conspicuous line is written to stderr so
// it's loud and traceable if it ever fires somewhere it shouldn't.
//
// To add a new test therapist to the allowlist, add the email here AND
// seed the doc via scripts/seed-dev-test-therapists.mjs. Do not remove
// this allowlist — it is the third layer of defense.
const DEV_LOGIN_ALLOWED_EMAILS = new Set([
  "test-complete@dev.bipolartherapyhub.invalid",
  "test-minimal@dev.bipolartherapyhub.invalid",
  "test-empty@dev.bipolartherapyhub.invalid",
]);

function isDevLoginEnabled(config) {
  if (process.env.NODE_ENV !== "development") return false;
  // Accept either a parsed config flag (loaded from .env via review-config)
  // or a directly-set process env var (used by tests and shell overrides).
  if (config && config.allowDevLogin === true) return true;
  return process.env.ALLOW_DEV_LOGIN === "true";
}

export async function handleAuthRoutes(context) {
  const { client, config, deps, origin, request, response, routePath } = context;

  const {
    canAttemptLogin,
    clearFailedLogins,
    createSignedSession,
    createTherapistSession,
    getSecurityWarnings,
    parseBody,
    readAdminSessionFromRequest,
    recordFailedLogin,
    sendJson,
  } = deps;

  const { setSessionCookie, clearSessionCookie } = makeSessionHelpers(deps, request, response);

  // Dev-only login bypass. See comment block above DEV_LOGIN_ALLOWED_EMAILS.
  // Placed first so it short-circuits before any other auth path, and so
  // a misconfigured env fails closed (404) before touching Sanity.
  if (request.method === "POST" && routePath === "/portal/dev-login") {
    // Guard 0 (tripwire): if this route is ever hit in production, log
    // loudly. Runs before the silent guard-1 check so probing leaves a
    // trace in the prod logs. Still returns 404 — no behavioral leak.
    if (process.env.NODE_ENV === "production") {
      const probeIp =
        (request.socket && request.socket.remoteAddress) ||
        request.headers["x-forwarded-for"] ||
        "unknown";
      log.warn("[DEV LOGIN] Route hit in production", { ip: probeIp });
      sendJson(response, 404, { error: "Not found." }, origin, config);
      return true;
    }
    if (!isDevLoginEnabled(config)) {
      sendJson(response, 404, { error: "Not found." }, origin, config);
      return true;
    }
    const body = await parseBody(request);
    const email = String((body && body.email) || "")
      .trim()
      .toLowerCase();
    if (!email || !DEV_LOGIN_ALLOWED_EMAILS.has(email)) {
      sendJson(response, 404, { error: "Not found." }, origin, config);
      return true;
    }
    const therapist = await client.fetch(
      `*[_type == "therapist" && claimStatus == "claimed" && lower(claimedByEmail) == $email][0]{
        _id, name, "slug": slug.current, claimedByEmail, listingActive, status
      }`,
      { email },
    );
    const slug =
      therapist && therapist.slug && typeof therapist.slug === "object"
        ? therapist.slug.current || ""
        : therapist && therapist.slug
          ? therapist.slug
          : "";
    if (!therapist || !slug) {
      sendJson(
        response,
        404,
        { error: "No claimed therapist for that dev email. Run the seed script." },
        origin,
        config,
      );
      return true;
    }
    // Defense-in-depth: even if the allowlist were ever bypassed, the
    // matched record must be off the public directory. A fixture email
    // on a live record is a configuration bug that should fail closed
    // and be loudly traceable.
    if (therapist.listingActive !== false || therapist.status !== "inactive") {
      log.error("[DEV LOGIN] REFUSED: matched active therapist", {
        email,
        id: therapist._id,
        listingActive: therapist.listingActive,
        status: therapist.status,
      });
      sendJson(response, 404, { error: "Not found." }, origin, config);
      return true;
    }
    const ip =
      (request.socket && request.socket.remoteAddress) ||
      request.headers["x-forwarded-for"] ||
      "unknown";
    log.error("[DEV LOGIN] Bypass used", { email, ip });
    const sessionToken = createTherapistSession(config, {
      slug,
      email: therapist.claimedByEmail || email,
    });
    setSessionCookie(
      THERAPIST_SESSION_COOKIE,
      sessionToken,
      Number(config.therapistSessionTtlMs) / 1000,
    );
    sendJson(
      response,
      200,
      {
        ok: true,
        slug,
        email: therapist.claimedByEmail || email,
      },
      origin,
      config,
    );
    return true;
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
      return true;
    }

    const body = await parseBody(request);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const usingUserPass = config.adminUsername && config.adminPassword;

    const valid =
      usingUserPass && username === config.adminUsername && password === config.adminPassword;

    if (!valid) {
      recordFailedLogin(request, config);
      sendJson(response, 401, { error: "Invalid admin credentials." }, origin, config);
      return true;
    }

    clearFailedLogins(request);
    const sessionToken = createSignedSession(config, {
      username: username || config.adminUsername,
    });
    const actorId = username || config.adminUsername;
    setSessionCookie(ADMIN_SESSION_COOKIE, sessionToken, Number(config.sessionTtlMs) / 1000);
    sendJson(
      response,
      200,
      {
        ok: true,
        actorId,
        actorName: actorId,
        authMode: "password",
      },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "GET" && routePath === "/auth/session") {
    const session =
      typeof readAdminSessionFromRequest === "function"
        ? readAdminSessionFromRequest(request, config)
        : null;
    if (!session) {
      sendJson(response, 401, { authenticated: false }, origin, config);
      return true;
    }

    sendJson(
      response,
      200,
      {
        authenticated: true,
        expiresAt: session.exp,
        actorId: session.username || "admin",
        actorName: session.username || "admin",
      },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "POST" && routePath === "/auth/logout") {
    clearSessionCookie(ADMIN_SESSION_COOKIE);
    sendJson(response, 200, { ok: true }, origin, config);
    return true;
  }

  if (request.method === "GET" && routePath === "/health") {
    sendJson(
      response,
      200,
      {
        ok: true,
        authMode: "password",
        sessionTtlMs: config.sessionTtlMs,
        securityWarnings: getSecurityWarnings(config),
      },
      origin,
      config,
    );
    return true;
  }

  return false;
}
