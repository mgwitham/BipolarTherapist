import {
  applyCtaClickToSummary,
  applyViewToSummary,
  buildEngagementPeriodKey,
  buildEngagementSummaryId,
  normalizeEngagementInput,
} from "../shared/therapist-engagement-domain.mjs";

export async function handleEngagementRoutes(context) {
  const { client, config, deps, origin, request, response, routePath } = context;
  const { parseBody, sendJson } = deps;

  if (request.method !== "POST") {
    return false;
  }

  const isView = routePath === "/engagement/view";
  const isCtaClick = routePath === "/engagement/cta-click";
  if (!isView && !isCtaClick) {
    return false;
  }

  let body;
  try {
    body = await parseBody(request);
  } catch (_error) {
    sendJson(response, 400, { error: "Invalid JSON body." }, origin, config);
    return true;
  }

  let normalized;
  try {
    normalized = normalizeEngagementInput(body || {});
  } catch (_error) {
    // Fixed string — never echo raw exception text to anonymous callers.
    sendJson(response, 400, { error: "Invalid engagement event." }, origin, config);
    return true;
  }

  const { slug, source, route, occurredAt } = normalized;
  const periodKey = buildEngagementPeriodKey(occurredAt);
  const id = buildEngagementSummaryId(slug, periodKey);

  // Read-modify-write on a shared per-therapist/per-week counter. A plain
  // createOrReplace loses increments when two events for the same summary
  // race (both read N, both write N+1). Gate the write on the revision we
  // read and retry on conflict, matching appendFunnelLogEvents / the Stripe
  // webhook. On the first event for a period there is no doc yet, so create
  // it — a concurrent create surfaces as a conflict and we re-read.
  const MAX_ATTEMPTS = 5;
  let next = null;
  let lastError = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const existing = await client.getDocument(id);
    next = isView
      ? applyViewToSummary(existing, slug, source, occurredAt)
      : applyCtaClickToSummary(existing, slug, route, occurredAt);
    try {
      if (existing && existing._rev) {
        const fields = { ...next };
        delete fields._id;
        delete fields._type;
        delete fields._rev;
        delete fields._createdAt;
        delete fields._updatedAt;
        await client
          .patch(id)
          .ifRevisionId(existing._rev)
          .set(fields)
          .commit({ visibility: "async" });
      } else {
        await client.create(next);
      }
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      // Revision conflict or create race — another writer landed first.
      // Re-read and recompute on the next attempt.
    }
  }
  if (lastError) {
    throw lastError;
  }

  sendJson(
    response,
    200,
    {
      ok: true,
      id: next._id,
      profileViewsTotal: next.profileViewsTotal || 0,
      ctaClicksTotal: next.ctaClicksTotal || 0,
    },
    origin,
    config,
  );
  return true;
}
