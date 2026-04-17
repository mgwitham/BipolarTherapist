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
  } catch (error) {
    sendJson(response, 400, { error: error.message }, origin, config);
    return true;
  }

  const { slug, source, route, occurredAt } = normalized;
  const periodKey = buildEngagementPeriodKey(occurredAt);
  const id = buildEngagementSummaryId(slug, periodKey);

  const existing = await client.getDocument(id);
  const next = isView
    ? applyViewToSummary(existing, slug, source, occurredAt)
    : applyCtaClickToSummary(existing, slug, route, occurredAt);

  await client.transaction().createOrReplace(next).commit({ visibility: "async" });

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
