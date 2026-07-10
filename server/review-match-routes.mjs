import { validateBody } from "./validate.mjs";

// The match client identifies a request by `journey_id`; script/API callers send
// `request_id`. The domain shaper coalesces both (normalizePortableMatchRequest),
// so neither may be `required` here on its own — marking one required rejects
// the other caller outright. Identity is enforced by hasRequestIdentity instead.
const MATCH_REQUEST_SCHEMA = {
  request_id: { type: "string", maxLength: 128 },
  journey_id: { type: "string", maxLength: 128 },
  session_id: { type: "string", maxLength: 128 },
  source_surface: { type: "string", maxLength: 64 },
  request_summary: { type: "string", maxLength: 2000 },
  // Referral attribution code; the domain layer sanitizes it further.
  referral_code: { type: "string", maxLength: 40 },
};

/** True when the body carries an identifier the shaper can key the document on. */
function hasRequestIdentity(body) {
  const src = body == null ? {} : body;
  return Boolean(
    String(src.request_id || "").trim() ||
    String(src.journey_id || "").trim() ||
    String(src.requestId || "").trim(),
  );
}

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

  if (!(
    request.method === "POST" &&
    (routePath === "/match/requests" || routePath === "/match/outcomes")
  )) {
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
  if (routePath === "/match/requests" && !hasRequestIdentity(body)) {
    sendJson(response, 400, { error: "request_id or journey_id is required." }, origin, config);
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
