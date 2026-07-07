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
import { runPhotoSourcingBatch } from "./photo-sourcing.mjs";
import { runReferralCadence } from "./referral-cadence-runner.mjs";

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

  if (routePath === "/cron/referral-cadence") {
    if (!checkCronAuth(request, config)) {
      writeJson(response, 401, { error: "unauthorized" });
      return true;
    }
    try {
      const summary = await runReferralCadence({ client, nowIso: new Date().toISOString() });
      writeJson(response, 200, summary);
    } catch (err) {
      writeJson(response, 500, { error: err?.message || String(err) });
    }
    return true;
  }

  // Source candidate headshots from unclaimed listings' own websites into
  // the review vault (nothing publishes without admin approval). Small,
  // resumable batches sized for serverless limits — each call processes
  // the next few listings, so hitting it repeatedly (Vercel cron, or
  // manually with the Bearer secret) sweeps the whole directory:
  //   curl -H "Authorization: Bearer $CRON_SECRET" \
  //     "https://<host>/api/review/cron/source-photos?limit=4"
  // Query params: limit (1-10, default 4), dry=1 for a no-write pass.
  if (routePath === "/cron/source-photos") {
    if (!checkCronAuth(request, config)) {
      writeJson(response, 401, { error: "unauthorized" });
      return true;
    }
    try {
      const params = context.url && context.url.searchParams;
      const rawLimit = Number(params && params.get("limit"));
      const limit =
        Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(10, Math.floor(rawLimit)) : 4;
      const dryRun = Boolean(params && params.get("dry") === "1");
      const summary = await runPhotoSourcingBatch({
        client,
        limit,
        dryRun,
        deadlineMs: 40000,
      });
      writeJson(response, 200, summary);
    } catch (err) {
      writeJson(response, 500, { error: err?.message || String(err) });
    }
    return true;
  }

  return false;
}
