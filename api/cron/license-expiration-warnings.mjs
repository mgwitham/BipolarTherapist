// Vercel cron entry point for the daily license expiration warnings.
// Schedule lives in vercel.json; Vercel sends `Authorization: Bearer
// <CRON_SECRET>` automatically when CRON_SECRET is set on the project.
//
// Sends 60/30/14-day warning emails to therapists whose CA license is
// approaching expiration, tracks each send in Sanity to prevent
// double-sending.

import { createClient } from "@sanity/client";

import { getReviewApiConfig } from "../../server/review-config.mjs";
import { runLicenseExpirationWarnings } from "../../server/license-expiration-warnings.mjs";

export default async function licenseExpirationWarningsCron(request, response) {
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
