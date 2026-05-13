// Vercel cron entry for the abandoned-claim alert. Runs hourly per
// the schedule in vercel.json; flags any therapist who requested a
// claim link 4–5h ago and hasn't completed the claim.

import { createClient } from "@sanity/client";

import { getReviewApiConfig } from "../../server/review-config.mjs";
import { runAbandonedClaimAlerts } from "../../server/abandoned-claim-alerts.mjs";

export default async function abandonedClaimAlertsCron(request, response) {
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
    const summary = await runAbandonedClaimAlerts({
      client,
      config,
      nowIso: new Date().toISOString(),
    });
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(summary));
  } catch (err) {
    response.statusCode = 500;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: err?.message || String(err) }));
  }
}
