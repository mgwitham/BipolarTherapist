import { validateBody } from "./validate.mjs";

const MATCH_REQUEST_SCHEMA = {
  request_id: { type: "string", required: true, maxLength: 128 },
  session_id: { type: "string", maxLength: 128 },
  source_surface: { type: "string", maxLength: 64 },
  request_summary: { type: "string", maxLength: 2000 },
};

const MATCH_OUTCOME_SCHEMA = {
  request_id: { type: "string", maxLength: 128 },
  therapist_slug: { type: "string", maxLength: 128 },
  outcome: { type: "string", maxLength: 64 },
  context_summary: { type: "string", maxLength: 2000 },
  strategy_snapshot: { type: "string", maxLength: 2000 },
};

export async function handleMatchRoutes(context) {
  const { client, config, deps, origin, request, response, routePath } = context;

  const { buildMatchOutcomeDocument, buildMatchRequestDocument, parseBody, sendJson } = deps;

  if (
    !(
      request.method === "POST" &&
      (routePath === "/match/requests" || routePath === "/match/outcomes")
    )
  ) {
    return false;
  }

  let body;
  try {
    body = await parseBody(request);
  } catch (_error) {
    sendJson(response, 400, { error: "Invalid JSON body." }, origin, config);
    return true;
  }
  const schema = routePath === "/match/requests" ? MATCH_REQUEST_SCHEMA : MATCH_OUTCOME_SCHEMA;
  const validation = validateBody(schema, body);
  if (!validation.ok) {
    sendJson(response, 400, { error: validation.error }, origin, config);
    return true;
  }

  const document =
    routePath === "/match/requests"
      ? buildMatchRequestDocument(body || {})
      : buildMatchOutcomeDocument(body || {});

  await client.transaction().createOrReplace(document).commit({ visibility: "sync" });
  sendJson(response, 201, { ok: true, id: document._id, type: document._type }, origin, config);
  return true;
}
