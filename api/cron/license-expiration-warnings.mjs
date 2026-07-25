// Cron entry point for the daily license expiration warnings.
//
// NOT CURRENTLY SCHEDULED, deliberately. Its vercel.json schedule was removed
// on 2026-05-07 by #599 ("halt all automated email sends"); this job emails
// therapists, so it is one of the intended targets of that halt. Do not
// re-schedule it without deciding to resume automated therapist email — note
// EMAIL_KILL_SWITCH is not set in production, so the missing schedule is the
// only thing stopping these sends.
//
// Preview without sending:
//   node --env-file=.env server/license-expiration-warnings.mjs --dry-run
//
// Sends 60/30/14-day warning emails to therapists whose CA license is
// approaching expiration, tracks each send in Sanity to prevent
// double-sending.

import { createClient } from "@sanity/client";

import { isAuthorizedCronRequest } from "../../server/cron-auth.mjs";
import { getReviewApiConfig } from "../../server/review-config.mjs";
import { runLicenseExpirationWarnings } from "../../server/license-expiration-warnings.mjs";

export default async function licenseExpirationWarningsCron(request, response) {
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
    const summary = await runLicenseExpirationWarnings({ client, config });
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(summary));
  } catch (error) {
    console.error("license-expiration-warnings cron failed", error);
    response.statusCode = 500;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: "runner_failed", message: String(error) }));
  }
}
