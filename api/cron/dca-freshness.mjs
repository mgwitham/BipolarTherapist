// Cron entry point for the DCA license freshness check.
//
// NOT CURRENTLY SCHEDULED. Its vercel.json schedule was removed on
// 2026-05-07 by #599 ("halt all automated email sends") along with the other
// three cron schedules, so nothing invokes this endpoint today and no ongoing
// license monitoring is running. This job sends no email — it was collateral
// in that batch rather than a target of it. Re-adding a `crons` entry in
// vercel.json is all it needs; Vercel then sends `Authorization: Bearer
// <CRON_SECRET>` automatically, which isAuthorizedCronRequest verifies.
//
// Until then, run it manually:
//   node --env-file=.env server/dca-freshness-check.mjs --dry-run   # preview
//   node --env-file=.env server/dca-freshness-check.mjs             # live
//
// Re-verifies every published therapist against CA DCA, refreshes the
// stored licensureVerification snapshot, and auto-unpublishes anyone
// whose license has lost active status or picked up a public
// disciplinary action since the last check.

import { createClient } from "@sanity/client";

import { isAuthorizedCronRequest } from "../../server/cron-auth.mjs";
import { getReviewApiConfig } from "../../server/review-config.mjs";
import { runDcaFreshnessCheck } from "../../server/dca-freshness-check.mjs";

export default async function dcaFreshnessCron(request, response) {
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
