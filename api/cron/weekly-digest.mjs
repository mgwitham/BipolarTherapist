// Cron entry point for the per-therapist weekly digest.
//
// NOT CURRENTLY SCHEDULED, deliberately. Its vercel.json schedule (Monday
// 09:00 UTC) was removed on 2026-05-07 by #599 ("halt all automated email
// sends"); this job emails therapists, so it is one of the intended targets of
// that halt. Do not re-schedule it without deciding to resume automated
// therapist email — EMAIL_KILL_SWITCH is not set in production, so the missing
// schedule is the only thing stopping these sends.
//
// When a schedule does exist, Vercel sends `Authorization: Bearer
// <CRON_SECRET>` automatically on a project with CRON_SECRET set; we verify
// that header before doing any work.
//
// Runs the weekly engagement digest for all paid therapists, then
// returns a JSON summary for observability (Vercel shows the response
// body in the cron run log).

import { createClient } from "@sanity/client";

import { isAuthorizedCronRequest } from "../../server/cron-auth.mjs";
import { getReviewApiConfig } from "../../server/review-config.mjs";
import { runWeeklyDigest } from "../../server/review-weekly-digest.mjs";

export default async function weeklyDigestCron(request, response) {
  const config = getReviewApiConfig();

  if (!isAuthorizedCronRequest(request, config)) {
    response.statusCode = 401;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  if (!config.projectId || !config.dataset) {
    response.statusCode = 500;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: "sanity_not_configured" }));
    return;
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token,
    useCdn: false,
    perspective: "raw",
  });

  try {
    const summary = await runWeeklyDigest({
      client,
      config,
      portalBaseUrl: config.portalBaseUrl,
      nowIso: new Date().toISOString(),
    });
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(summary));
  } catch (error) {
    console.error("weekly-digest cron failed", error);
    response.statusCode = 500;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: "runner_failed", message: String(error) }));
  }
}
