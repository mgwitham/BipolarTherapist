// Vercel cron entry point. Invoked per the schedule in vercel.json
// (currently Monday 09:00 UTC). Vercel sends `Authorization: Bearer
// <CRON_SECRET>` automatically when a cron is configured on a project
// that has the CRON_SECRET env var set; we verify that header before
// doing any work.
//
// Runs the weekly engagement digest for all paid therapists, then
// returns a JSON summary for observability (Vercel shows the response
// body in the cron run log).

import { createClient } from "@sanity/client";

import { getReviewApiConfig } from "../../server/review-config.mjs";
import { runWeeklyDigest } from "../../server/review-weekly-digest.mjs";

export default async function weeklyDigestCron(request, response) {
  const config = getReviewApiConfig();

  if (config.cronSecret) {
    const header = String((request.headers && request.headers.authorization) || "");
    const expected = "Bearer " + config.cronSecret;
    if (header !== expected) {
      response.statusCode = 401;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
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
