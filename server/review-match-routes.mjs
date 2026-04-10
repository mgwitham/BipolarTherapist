export async function handleMatchRoutes(context) {
  const {
    client,
    config,
    deps,
    origin,
    request,
    response,
    routePath,
  } = context;

  const {
    buildMatchOutcomeDocument,
    buildMatchRequestDocument,
    parseBody,
    sendJson,
  } = deps;

  if (!(request.method === "POST" && (routePath === "/match/requests" || routePath === "/match/outcomes"))) {
    return false;
  }

  const body = await parseBody(request);
  const document =
    routePath === "/match/requests"
      ? buildMatchRequestDocument(body || {})
      : buildMatchOutcomeDocument(body || {});

  await client.transaction().createOrReplace(document).commit({ visibility: "sync" });
  sendJson(response, 201, { ok: true, id: document._id, type: document._type }, origin, config);
  return true;
}
