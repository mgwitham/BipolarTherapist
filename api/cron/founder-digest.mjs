// Vercel cron entry. Reads funnelEventLog.singleton, builds the
// 7-day operator digest, and emails it to config.notificationTo.
// Schedule lives in vercel.json (currently Monday 14:00 UTC, an hour
// after the per-therapist weekly-digest cron so the two emails don't
// collide if Resend rate-limits).

import { createClient } from "@sanity/client";

import { getReviewApiConfig } from "../../server/review-config.mjs";
import { runFounderDigest } from "../../server/review-founder-digest.mjs";

export default async function founderDigestCron(request, response) {
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
    const summary = await runFounderDigest({
      client,
      config,
      adminUrl: (config.portalBaseUrl || "https://www.bipolartherapyhub.com") + "/admin.html",
      nowIso: new Date().toISOString(),
    });
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(summary));
  } catch (error) {
    console.error("founder-digest cron failed", error);
    response.statusCode = 500;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: "runner_failed", message: String(error) }));
  }
}
