function normalizeNameForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^(dr|mr|mrs|ms|mx|prof)\.?\s+/i, "")
    .split(",")[0]
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLicenseForMatch(value) {
  return String(value || "")
    .replace(/[^a-z0-9]/gi, "")
    .replace(/^[a-z]+/i, "")
    .trim();
}

const AGGREGATOR_DOMAINS = new Set([
  "psychologytoday.com",
  "goodtherapy.org",
  "therapyden.com",
  "rula.com",
  "headway.co",
  "growtherapy.com",
  "zencare.co",
  "alma.com",
  "helloalma.com",
  "betterhelp.com",
  "talkspace.com",
  "lifestance.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "yelp.com",
  "healthgrades.com",
  "wellsheet.com",
  "mentalhealthmatch.com",
]);

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "comcast.net",
  "sbcglobal.net",
  "att.net",
  "verizon.net",
  "cox.net",
]);

function extractRegistrableDomain(value) {
  let host = String(value || "")
    .trim()
    .toLowerCase();
  if (!host) {
    return "";
  }
  host = host.replace(/^https?:\/\//, "").replace(/^www\./, "");
  host = host.split("/")[0].split("?")[0].split("#")[0].split(":")[0];
  host = host.replace(/\.+$/, "");
  if (!host || !host.includes(".")) {
    return "";
  }
  const parts = host.split(".");
  if (
    parts.length >= 3 &&
    parts[parts.length - 2].length <= 3 &&
    parts[parts.length - 1].length <= 3
  ) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

function emailDomainMatchesWebsite(email, website) {
  const emailDomain = extractRegistrableDomain(String(email || "").split("@")[1] || "");
  const siteDomain = extractRegistrableDomain(website);
  if (!emailDomain || !siteDomain) {
    return false;
  }
  if (AGGREGATOR_DOMAINS.has(emailDomain) || AGGREGATOR_DOMAINS.has(siteDomain)) {
    return false;
  }
  if (FREE_EMAIL_DOMAINS.has(emailDomain)) {
    return false;
  }
  return emailDomain === siteDomain;
}

function maskEmail(email) {
  const trimmed = String(email || "").trim();
  if (!trimmed) {
    return "";
  }
  const at = trimmed.indexOf("@");
  if (at < 1) {
    return trimmed.slice(0, 1) + "***";
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const domainHead = dot > 0 ? domain.slice(0, dot) : domain;
  const domainTail = dot > 0 ? domain.slice(dot) : "";
  const maskLocal = local.slice(0, 1) + "***";
  const maskDomain = (domainHead ? domainHead.slice(0, 1) + "***" : "***") + domainTail;
  return maskLocal + "@" + maskDomain;
}

export async function handleAuthAndPortalRoutes(context) {
  const { client, config, deps, origin, request, response, routePath, url } = context;

  const {
    buildPortalRequestDocument,
    canAttemptLogin,
    clearFailedLogins,
    createSignedSession,
    createTherapistSession,
    getAuthorizedTherapist,
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

  if (request.method === "GET" && routePath === "/portal/quick-claim/search") {
    const query = String((url && url.searchParams.get("q")) || "").trim();
    if (query.length < 2) {
      sendJson(response, 200, { results: [] }, origin, config);
      return true;
    }

    const normalizedLicense = normalizeLicenseForMatch(query);
    const normalizedName = normalizeNameForMatch(query);
    const nameMatcher = normalizedName ? `*${normalizedName.split(" ").join("*")}*` : "";

    const docs = await client.fetch(
      `*[_type == "therapist" && listingActive == true && defined(slug.current) && (
        ($license != "" && licenseNumber match $license) ||
        ($nameMatcher != "" && name match $nameMatcher)
      )] | order(name asc) [0...8]{
        _id, name, email, city, state, credentials, licenseNumber, claimStatus, "slug": slug.current
      }`,
      { license: normalizedLicense || "__none__", nameMatcher: nameMatcher || "__none__" },
    );

    const results = (docs || []).map(function (doc) {
      return {
        slug: doc.slug,
        name: doc.name || "",
        city: doc.city || "",
        state: doc.state || "",
        credentials: doc.credentials || "",
        license_number: doc.licenseNumber || "",
        email_hint: maskEmail(doc.email),
        has_email: Boolean(doc.email),
        claim_status: doc.claimStatus || "unclaimed",
      };
    });

    sendJson(response, 200, { results }, origin, config);
    return true;
  }

  if (request.method === "POST" && routePath === "/portal/quick-claim") {
    const body = await parseBody(request);
    const rawFullName = String(body.full_name || "").trim();
    const rawEmail = String(body.email || "").trim();
    const rawLicense = String(body.license_number || "").trim();

    const fullName = normalizeNameForMatch(rawFullName);
    const requesterEmail = rawEmail.toLowerCase();
    const licenseNumber = normalizeLicenseForMatch(rawLicense);

    if (!fullName || !requesterEmail || !licenseNumber) {
      sendJson(
        response,
        400,
        { error: "Full name, email, and CA license number are all required." },
        origin,
        config,
      );
      return true;
    }

    const therapist = await client.fetch(
      `*[_type == "therapist" && licenseNumber match $license][0]{
        _id, name, email, website, claimStatus, "slug": slug
      }`,
      { license: `*${licenseNumber}*` },
    );

    if (!therapist || !therapist.slug || !therapist.slug.current) {
      sendJson(
        response,
        404,
        {
          error:
            "We do not see a profile for that license in our directory yet. Create a new listing below.",
          reason: "not_found",
        },
        origin,
        config,
      );
      return true;
    }

    const profileName = normalizeNameForMatch(therapist.name);
    if (!profileName || profileName !== fullName) {
      sendJson(
        response,
        403,
        {
          error:
            "The name you entered doesn't match the profile for that license. Double-check spelling, or use the search above to find your listing.",
          reason: "name_mismatch",
          name_hint: therapist.name
            ? therapist.name.charAt(0) + "***" + therapist.name.slice(-1)
            : "",
        },
        origin,
        config,
      );
      return true;
    }

    const profileEmail = String(therapist.email || "")
      .trim()
      .toLowerCase();
    const emailMatches = profileEmail && profileEmail === requesterEmail;
    const domainVerified =
      !emailMatches && emailDomainMatchesWebsite(requesterEmail, therapist.website);

    if (!emailMatches && !domainVerified) {
      sendJson(
        response,
        403,
        {
          error:
            "That email doesn't match the contact email on your profile. Use the email on file, or contact us if you no longer have access to it.",
          reason: "email_mismatch",
          email_hint: maskEmail(therapist.email),
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

    const claimStatusUpdate = therapist.claimStatus === "claimed" ? "claimed" : "claim_requested";
    const patchBuilder = client.patch(therapist._id).set({ claimStatus: claimStatusUpdate });
    if (domainVerified) {
      patchBuilder.set({
        lastClaimVerificationMethod: "email_domain_match",
        lastClaimVerificationAt: new Date().toISOString(),
      });
    }
    await patchBuilder.commit({ visibility: "sync" });

    sendJson(
      response,
      200,
      {
        ok: true,
        message: domainVerified
          ? "Claim link sent. We verified ownership via your practice website domain."
          : "Claim link sent. Check your inbox.",
        therapist_slug: therapist.slug.current,
        verification_method: domainVerified ? "email_domain_match" : "email_on_file",
      },
      origin,
      config,
    );
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

    const therapistSessionToken = createTherapistSession(config, {
      slug: therapist.slug,
      email: payload.email,
    });

    sendJson(
      response,
      200,
      {
        ok: true,
        therapist_slug: therapist.slug,
        claimed_by_email: payload.email,
        therapist_session_token: therapistSessionToken,
      },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "GET" && routePath === "/portal/me") {
    const session = getAuthorizedTherapist(request, config);
    if (!session) {
      sendJson(response, 401, { error: "Not signed in." }, origin, config);
      return true;
    }

    const therapist = await client.fetch(
      `*[_type == "therapist" && slug.current == $slug][0]{
        _id, name, email, city, state, practiceName, claimStatus, claimedByEmail, claimedAt,
        portalLastSeenAt, listingPauseRequestedAt, listingRemovalRequestedAt,
        "slug": slug.current
      }`,
      { slug: session.slug },
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
        session: {
          slug: session.slug,
          email: session.email,
          expires_at: session.expiresAt,
        },
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

  return false;
}
