// Vercel cron entry point for the weekly DCA license freshness check.
// Schedule lives in vercel.json; Vercel sends `Authorization: Bearer
// <CRON_SECRET>` automatically when CRON_SECRET is set on the project.
//
// Re-verifies every published therapist against CA DCA, refreshes the
// stored licensureVerification snapshot, and auto-unpublishes anyone
// whose license has lost active status or picked up a public
// disciplinary action since the last check.

import { createClient } from "@sanity/client";

import { getReviewApiConfig } from "../../server/review-config.mjs";
import { runDcaFreshnessCheck } from "../../server/dca-freshness-check.mjs";

export default async function dcaFreshnessCron(request, response) {
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

  if (!config.dcaAppId || !config.dcaAppKey) {
    response.statusCode = 500;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: "dca_credentials_not_configured" }));
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
    const summary = await runDcaFreshnessCheck({ client, config });
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(summary));
  } catch (error) {
    console.error("dca-freshness cron failed", error);
    response.statusCode = 500;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: "runner_failed", message: String(error) }));
  }
}
