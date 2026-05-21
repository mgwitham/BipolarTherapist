import { log } from "./logger.mjs";

// Patient-side signal aggregator for the outreach CRM. Returns rolled-up
// counts of match requests, profile views, and CTA clicks so the
// founder can see at a glance whether the directory is generating real
// patient activity, separately from however cold-email outreach is
// performing.
//
// Lives inside the review-handler route table to stay under the
// 12-function Vercel Hobby cap. Endpoint URL:
//
//   GET /api/review/admin/patient-signal
//
// Gated on the same bt_admin_session cookie the rest of /admin and
// /outreach use; returns 401 if missing.

const QUERY = `{
  "matchRequestsLast7d": count(*[_type == "matchRequest" && _createdAt >= $threshold7d]),
  "matchRequestsPrev7d": count(*[_type == "matchRequest" && _createdAt >= $threshold14d && _createdAt < $threshold7d]),
  "matchRequestsLast30d": count(*[_type == "matchRequest" && _createdAt >= $threshold30d]),
  "matchRequestsAllTime": count(*[_type == "matchRequest"]),
  "viewsLast7d": math::sum(*[_type == "therapistEngagementSummary" && periodStart >= $threshold7d].profileViewsTotal),
  "viewsLast30d": math::sum(*[_type == "therapistEngagementSummary" && periodStart >= $threshold30d].profileViewsTotal),
  "clicksLast7d": math::sum(*[_type == "therapistEngagementSummary" && periodStart >= $threshold7d].ctaClicksTotal),
  "clicksLast30d": math::sum(*[_type == "therapistEngagementSummary" && periodStart >= $threshold30d].ctaClicksTotal),
  "matchScoredLast7d": count(*[_type == "matchRequest" && _createdAt >= $threshold7d && defined(resultCount)]),
  "matchReturnedLast7d": count(*[_type == "matchRequest" && _createdAt >= $threshold7d && resultCount > 0]),
  "matchScoredLast30d": count(*[_type == "matchRequest" && _createdAt >= $threshold30d && defined(resultCount)]),
  "matchReturnedLast30d": count(*[_type == "matchRequest" && _createdAt >= $threshold30d && resultCount > 0])
}`;

function trendDirection(current, previous) {
  // Treat any movement on a near-zero base as "flat" — small absolute
  // numbers are noisy. Only call growth/decline when the change is
  // both proportionally meaningful and at least a few absolute units.
  if (current < 3 && previous < 3) return "flat";
  if (previous === 0) return current > 0 ? "growing" : "flat";
  const ratio = (current - previous) / previous;
  if (ratio >= 0.3) return "growing";
  if (ratio <= -0.3) return "declining";
  return "flat";
}

export async function handlePatientSignalRoutes(context) {
  const { client, config, request, response, routePath, deps } = context;
  if (routePath !== "/admin/patient-signal") return false;

  if (request.method !== "GET") {
    response.writeHead(405, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Method not allowed" }));
    return true;
  }

  const session = deps.readAdminSessionFromRequest(request, config);
  if (!session) {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Unauthorized" }));
    return true;
  }

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const params = {
    threshold7d: new Date(now - 7 * day).toISOString(),
    threshold14d: new Date(now - 14 * day).toISOString(),
    threshold30d: new Date(now - 30 * day).toISOString(),
  };

  let raw;
  try {
    raw = await client.fetch(QUERY, params);
  } catch (err) {
    log.error("patient-signal fetch error", { err: err?.message || String(err) });
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Failed to compute signal" }));
    return true;
  }

  const payload = {
    matchRequests: {
      last7d: Number(raw?.matchRequestsLast7d) || 0,
      last30d: Number(raw?.matchRequestsLast30d) || 0,
      allTime: Number(raw?.matchRequestsAllTime) || 0,
      trend7dVsPrev7d: trendDirection(
        Number(raw?.matchRequestsLast7d) || 0,
        Number(raw?.matchRequestsPrev7d) || 0,
      ),
    },
    profileViews: {
      last7d: Number(raw?.viewsLast7d) || 0,
      last30d: Number(raw?.viewsLast30d) || 0,
    },
    ctaClicks: {
      last7d: Number(raw?.clicksLast7d) || 0,
      last30d: Number(raw?.clicksLast30d) || 0,
    },
    // Match result coverage. "scored" = match requests that recorded a
    // resultCount (instrumented from 2026-05 onward); "returned" = those
    // that surfaced >=1 provider. scored - returned = zero-result matches
    // (demand we could not serve). Older requests lack resultCount and are
    // excluded from scored so the rate isn't diluted by un-instrumented data.
    matchResults: {
      scored7d: Number(raw?.matchScoredLast7d) || 0,
      returned7d: Number(raw?.matchReturnedLast7d) || 0,
      scored30d: Number(raw?.matchScoredLast30d) || 0,
      returned30d: Number(raw?.matchReturnedLast30d) || 0,
    },
    generatedAt: new Date().toISOString(),
  };

  response.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
  return true;
}
