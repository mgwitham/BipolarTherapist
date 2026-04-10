export async function handleAuthAndPortalRoutes(context) {
  const { client, config, deps, origin, request, response, routePath, url } = context;

  const {
    buildPortalRequestDocument,
    canAttemptLogin,
    clearFailedLogins,
    createSignedSession,
    getSecurityWarnings,
    normalizePortalRequest,
    parseAuthorizationHeader,
    parseBody,
    readPortalClaimToken,
    readSignedSession,
    recordFailedLogin,
    sendJson,
    sendPortalClaimLink,
    updatePortalRequestFields,
  } = deps;

  if (request.method === "POST" && routePath === "/auth/login") {
    if (!canAttemptLogin(request, config)) {
      sendJson(
        response,
        429,
        { error: "Too many login attempts. Try again later." },
        origin,
        config,
      );
      return true;
    }

    const body = await parseBody(request);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const usingUserPass = config.adminUsername && config.adminPassword;
    const usingLegacyKey = config.allowLegacyKey && config.adminKey;

    const valid =
      (usingUserPass && username === config.adminUsername && password === config.adminPassword) ||
      (usingLegacyKey && password === config.adminKey);

    if (!valid) {
      recordFailedLogin(request, config);
      sendJson(response, 401, { error: "Invalid admin credentials." }, origin, config);
      return true;
    }

    clearFailedLogins(request);
    const sessionToken = createSignedSession(config, {
      username: usingUserPass ? username || config.adminUsername : "legacy-admin-key",
    });
    const actorId = usingUserPass ? username || config.adminUsername : "legacy-admin-key";
    sendJson(
      response,
      200,
      {
        ok: true,
        sessionToken,
        actorId,
        actorName: actorId,
        authMode: usingUserPass ? "password" : "legacy-key",
      },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "GET" && routePath === "/auth/session") {
    const session = readSignedSession(parseAuthorizationHeader(request), config);
    if (!session) {
      sendJson(response, 401, { authenticated: false }, origin, config);
      return true;
    }

    sendJson(
      response,
      200,
      {
        authenticated: true,
        expiresAt: session.exp,
        actorId: session.username || "admin",
        actorName: session.username || "admin",
      },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "POST" && routePath === "/auth/logout") {
    sendJson(response, 200, { ok: true }, origin, config);
    return true;
  }

  if (request.method === "GET" && routePath === "/health") {
    sendJson(
      response,
      200,
      {
        ok: true,
        authMode: config.adminUsername && config.adminPassword ? "password" : "legacy-key",
        sessionTtlMs: config.sessionTtlMs,
        legacyKeyEnabled: config.allowLegacyKey && Boolean(config.adminKey),
        securityWarnings: getSecurityWarnings(config),
      },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "GET" && routePath === "/portal/requests") {
    if (!deps.isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const docs = await client.fetch(
      `*[_type == "therapistPortalRequest"] | order(coalesce(requestedAt, _createdAt) desc){
        _id, _createdAt, therapistSlug, therapistName, requestType, requesterName, requesterEmail, licenseNumber, message, status, requestedAt, reviewedAt
      }`,
    );

    sendJson(response, 200, docs.map(normalizePortalRequest), origin, config);
    return true;
  }

  if (request.method === "POST" && routePath === "/portal/requests") {
    const body = await parseBody(request);
    const document = buildPortalRequestDocument(body);
    const created = await client.create(document);
    sendJson(response, 201, normalizePortalRequest(created), origin, config);
    return true;
  }

  const portalRequestUpdateMatch = routePath.match(/^\/portal\/requests\/([^/]+)$/);
  if ((request.method === "PATCH" || request.method === "POST") && portalRequestUpdateMatch) {
    if (!deps.isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const requestId = decodeURIComponent(portalRequestUpdateMatch[1]);
    const existing = await client.getDocument(requestId);
    if (!existing || existing._type !== "therapistPortalRequest") {
      sendJson(response, 404, { error: "Portal request not found." }, origin, config);
      return true;
    }

    const body = await parseBody(request);
    const updated = await updatePortalRequestFields(client, requestId, body);
    sendJson(response, 200, normalizePortalRequest(updated), origin, config);
    return true;
  }

  if (request.method === "POST" && routePath === "/portal/claim-link") {
    const body = await parseBody(request);
    const therapistSlug = String(body.therapist_slug || "").trim();
    const requesterEmail = String(body.requester_email || "")
      .trim()
      .toLowerCase();

    if (!therapistSlug || !requesterEmail) {
      sendJson(response, 400, { error: "Missing therapist slug or email." }, origin, config);
      return true;
    }

    const therapist = await client.fetch(
      `*[_type == "therapist" && slug.current == $slug][0]{
        _id, name, email, claimStatus, "slug": slug
      }`,
      { slug: therapistSlug },
    );

    if (!therapist || !therapist.slug || !therapist.slug.current) {
      sendJson(response, 404, { error: "Therapist profile not found." }, origin, config);
      return true;
    }

    const profileEmail = String(therapist.email || "")
      .trim()
      .toLowerCase();
    if (!profileEmail || profileEmail !== requesterEmail) {
      sendJson(
        response,
        403,
        {
          error:
            "That email does not match the public contact email on this profile yet. Use the request form instead so we can verify ownership manually.",
        },
        origin,
        config,
      );
      return true;
    }

    await sendPortalClaimLink(
      config,
      therapist,
      requesterEmail,
      `${url.protocol}//${url.host}`.replace(/\/+$/, ""),
    );

    await client
      .patch(therapist._id)
      .set({
        claimStatus: therapist.claimStatus === "claimed" ? "claimed" : "claim_requested",
      })
      .commit({ visibility: "sync" });

    sendJson(
      response,
      200,
      { ok: true, message: "Claim link sent if the profile email matched." },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "GET" && routePath === "/portal/claim-session") {
    const token = String(url.searchParams.get("token") || "").trim();
    const payload = readPortalClaimToken(config, token);
    if (!payload) {
      sendJson(response, 401, { error: "Claim link is invalid or expired." }, origin, config);
      return true;
    }

    const therapist = await client.fetch(
      `*[_type == "therapist" && slug.current == $slug][0]{
        _id, name, email, city, state, practiceName, claimStatus, claimedByEmail, claimedAt,
        portalLastSeenAt, listingPauseRequestedAt, listingRemovalRequestedAt,
        "slug": slug.current
      }`,
      { slug: payload.slug },
    );

    if (!therapist) {
      sendJson(response, 404, { error: "Therapist profile not found." }, origin, config);
      return true;
    }

    sendJson(
      response,
      200,
      {
        ok: true,
        therapist: {
          slug: therapist.slug,
          name: therapist.name,
          email: therapist.email || "",
          city: therapist.city || "",
          state: therapist.state || "",
          practice_name: therapist.practiceName || "",
          claim_status: therapist.claimStatus || "unclaimed",
          claimed_by_email: therapist.claimedByEmail || "",
          claimed_at: therapist.claimedAt || "",
          portal_last_seen_at: therapist.portalLastSeenAt || "",
          listing_pause_requested_at: therapist.listingPauseRequestedAt || "",
          listing_removal_requested_at: therapist.listingRemovalRequestedAt || "",
        },
      },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "POST" && routePath === "/portal/claim-accept") {
    const body = await parseBody(request);
    const token = String(body.token || "").trim();
    const payload = readPortalClaimToken(config, token);
    if (!payload) {
      sendJson(response, 401, { error: "Claim link is invalid or expired." }, origin, config);
      return true;
    }

    const therapist = await client.fetch(
      `*[_type == "therapist" && slug.current == $slug][0]{ _id, name, "slug": slug.current }`,
      { slug: payload.slug },
    );
    if (!therapist) {
      sendJson(response, 404, { error: "Therapist profile not found." }, origin, config);
      return true;
    }

    const now = new Date().toISOString();
    await client
      .patch(therapist._id)
      .set({
        claimStatus: "claimed",
        claimedByEmail: payload.email,
        claimedAt: now,
        portalLastSeenAt: now,
      })
      .commit({ visibility: "sync" });

    sendJson(
      response,
      200,
      {
        ok: true,
        therapist_slug: therapist.slug,
        claimed_by_email: payload.email,
      },
      origin,
      config,
    );
    return true;
  }

  return false;
}
