// Cron endpoints served inside the review-handler route table rather
// than as standalone Vercel functions. This keeps us under the Hobby
// plan's 12-function cap. Vercel cron entries in vercel.json point
// at /api/review/cron/* which falls through the catch-all to here.
//
// Auth: each route checks the Bearer cron secret via the shared
// fail-closed helper. If CRON_SECRET isn't configured, every request
// is rejected rather than running the job wide open.

import { runAbandonedClaimAlerts } from "./abandoned-claim-alerts.mjs";
import { isAuthorizedCronRequest } from "./cron-auth.mjs";
import { runOutreachClickDigest } from "./outreach-click-digest.mjs";

function checkCronAuth(request, config) {
  return isAuthorizedCronRequest(request, config);
}

function writeJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

export async function handleCronRoutes(context) {
  const { client, config, request, routePath, response } = context;
  if (request.method !== "GET" && request.method !== "POST") return false;

  if (routePath === "/cron/abandoned-claim-alerts") {
    if (!checkCronAuth(request, config)) {
      writeJson(response, 401, { error: "unauthorized" });
      return true;
    }
    try {
      const summary = await runAbandonedClaimAlerts({
        client,
        config,
        nowIso: new Date().toISOString(),
      });
      writeJson(response, 200, summary);
    } catch (err) {
      writeJson(response, 500, { error: err?.message || String(err) });
    }
    return true;
  }

  if (routePath === "/cron/outreach-click-digest") {
    if (!checkCronAuth(request, config)) {
      writeJson(response, 401, { error: "unauthorized" });
      return true;
    }
    try {
      const summary = await runOutreachClickDigest({
        client,
        config,
        nowIso: new Date().toISOString(),
      });
      writeJson(response, 200, summary);
    } catch (err) {
      writeJson(response, 500, { error: err?.message || String(err) });
    }
    return true;
  }

  return false;
}
