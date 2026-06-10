import { slugify as slugifyReviewerId } from "../shared/therapist-domain.mjs";

function getEventLane(doc) {
  const eventType = String((doc && doc.eventType) || "");
  if (
    eventType.startsWith("licensure_") ||
    eventType === "therapist_review_completed" ||
    eventType === "therapist_review_deferred"
  ) {
    return "ops";
  }
  if (doc && doc.applicationId) {
    return "application";
  }
  if (doc && (doc.candidateId || doc.candidateDocumentId)) {
    return "candidate";
  }
  if (doc && doc.therapistId) {
    return "therapist";
  }
  return "ops";
}

function parsePositiveInteger(value, fallback, maxValue) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, maxValue || parsed);
}

function formatCsvCell(value) {
  const text = String(value == null ? "" : value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildTextResponseHeaders(origin, config, contentType) {
  const headers = {
    "Content-Type": contentType,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    Vary: "Origin",
  };
  if (origin && Array.isArray(config.allowedOrigins) && config.allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function normalizeReviewerDirectoryEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map(function (entry) {
      if (entry && typeof entry === "object") {
        const name = String(entry.name || "").trim();
        const reviewerId = String(
          entry.reviewerId || entry.reviewer_id || entry.id || slugifyReviewerId(name),
        ).trim();
        return {
          id: reviewerId,
          name: name,
          active: entry.active !== false,
        };
      }
      const name = String(entry || "").trim();
      return {
        id: slugifyReviewerId(name),
        name: name,
        active: true,
      };
    })
    .filter(function (entry) {
      return entry.id && entry.name;
    });
}

function stringifyExportValue(value) {
  if (Array.isArray(value)) {
    return value.join(" | ");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return value == null ? "" : String(value);
}

function buildCsvResponse(rows, columns) {
  const header = columns.map(function (column) {
    return formatCsvCell(column.header);
  });
  const body = rows.map(function (row) {
    return columns
      .map(function (column) {
        return formatCsvCell(stringifyExportValue(row[column.key]));
      })
      .join(",");
  });
  return [header.join(","), ...body].join("\n");
}

export async function handleReadRoutes(context) {
  const { client, config, deps, origin, request, response, routePath, url } = context;

  const {
    annotateProviderFieldObservationForDisplay,
    annotateMatchOutcomeForDisplay,
    annotateMatchRequestForDisplay,
    isAuthorized,
    normalizeAdminTherapist,
    normalizeApplication,
    normalizeCandidate,
    normalizeReviewEvent,
    sendJson,
  } = deps;

  const therapistByIdMatch = routePath.match(/^\/therapists\/([^/]+)\/admin$/);
  if (request.method === "GET" && therapistByIdMatch) {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const doc = await client.fetch(
      `*[_type == "therapist" && _id == $id][0]{
        _id, _createdAt, _updatedAt, name, credentials, title, bio, bioPreview, "photo": photo{asset->{url}}, photoSourceType, photoReviewedAt, photoUsagePermissionConfirmed,
        email, phone, website, preferredContactMethod, preferredContactLabel, contactGuidance, firstStepExpectation, bookingUrl,
        claimStatus, claimedByEmail, claimedAt, portalLastSeenAt, listingPauseRequestedAt, listingRemovalRequestedAt,
        practiceName, gender, city, state, zip, country, licenseState, licenseNumber,
        specialties, treatmentModalities, clientPopulations, insuranceAccepted, acceptsTelehealth, acceptsInPerson, acceptingNewPatients,
        yearsExperience, bipolarYearsExperience, languages, telehealthStates, estimatedWaitTime, careApproach, medicationManagement,
        verificationStatus, sourceUrl, supportingSourceUrls, sourceReviewedAt, therapistReportedFields, therapistReportedConfirmedAt,
        fieldReviewStates, sessionFeeMin, sessionFeeMax, slidingScale, listingActive, status, lifecycle, visibilityIntent, notes, auditLog, "slug": slug.current
      }`,
      { id: decodeURIComponent(therapistByIdMatch[1]) },
    );

    if (!doc) {
      sendJson(response, 404, { error: "Not found." }, origin, config);
      return true;
    }

    sendJson(response, 200, normalizeAdminTherapist(doc), origin, config);
    return true;
  }

  const therapistBySlugMatch = routePath.match(/^\/therapists\/by-slug\/([^/]+)\/admin$/);
  if (request.method === "GET" && therapistBySlugMatch) {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const doc = await client.fetch(
      `*[_type == "therapist" && slug.current == $slug][0]{
        _id, _createdAt, _updatedAt, name, credentials, title, bio, bioPreview, "photo": photo{asset->{url}}, photoSourceType, photoReviewedAt, photoUsagePermissionConfirmed,
        email, phone, website, preferredContactMethod, preferredContactLabel, contactGuidance, firstStepExpectation, bookingUrl,
        claimStatus, claimedByEmail, claimedAt, portalLastSeenAt, listingPauseRequestedAt, listingRemovalRequestedAt,
        practiceName, gender, city, state, zip, country, licenseState, licenseNumber,
        specialties, treatmentModalities, clientPopulations, insuranceAccepted, acceptsTelehealth, acceptsInPerson, acceptingNewPatients,
        yearsExperience, bipolarYearsExperience, languages, telehealthStates, estimatedWaitTime, careApproach, medicationManagement,
        verificationStatus, sourceUrl, supportingSourceUrls, sourceReviewedAt, therapistReportedFields, therapistReportedConfirmedAt,
        fieldReviewStates, sessionFeeMin, sessionFeeMax, slidingScale, listingActive, status, lifecycle, visibilityIntent, notes, auditLog, "slug": slug.current
      }`,
      { slug: decodeURIComponent(therapistBySlugMatch[1]) },
    );

    if (!doc) {
      sendJson(response, 404, { error: "Not found." }, origin, config);
      return true;
    }

    sendJson(response, 200, normalizeAdminTherapist(doc), origin, config);
    return true;
  }

  if (request.method === "GET" && routePath === "/applications") {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    // Optional ?status= and ?limit= narrow the result set in GROQ so the
    // wire response stays small. Default limit is generous (500) for
    // backward compatibility with callers that fetch and filter
    // client-side; raise to max 1000 if needed.
    const statusFilter = String((url && url.searchParams.get("status")) || "").trim();
    const limit = parsePositiveInteger(url && url.searchParams.get("limit"), 500, 1000);

    const docs = await client.fetch(
      `*[_type == "therapistApplication" && (!defined($status) || status == $status)]
        | order(coalesce(submittedAt, _createdAt) desc)[0...$limit]{
        _id, _createdAt, _updatedAt, name, email, credentials, title, "photo": photo{asset->{url}}, photoSourceType, photoReviewedAt, photoUsagePermissionConfirmed, practiceName, gender, phone, website, preferredContactMethod, preferredContactLabel, contactGuidance, firstStepExpectation, bookingUrl, city, state, zip, country,
        licenseState, licenseNumber, bio, careApproach, specialties, treatmentModalities, clientPopulations,
        insuranceAccepted, languages, yearsExperience, bipolarYearsExperience, acceptsTelehealth, acceptsInPerson,
        acceptingNewPatients, telehealthStates, estimatedWaitTime, medicationManagement, verificationStatus,
        sessionFeeMin, sessionFeeMax, slidingScale, status, notes, submittedSlug, submittedAt, updatedAt, reviewRequestMessage, revisionHistory, revisionCount,
        publishedTherapistId, reviewFollowUp
      }`,
      { status: statusFilter || null, limit },
    );

    sendJson(response, 200, docs.map(normalizeApplication), origin, config);
    return true;
  }

  if (request.method === "GET" && routePath === "/candidates") {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    // Same shape as /applications: optional status + limit pushed into
    // GROQ. Candidate volume is the highest of any list on the admin
    // page, so this matters most here.
    const statusFilter = String((url && url.searchParams.get("status")) || "").trim();
    const limit = parsePositiveInteger(url && url.searchParams.get("limit"), 500, 1000);

    const docs = await client.fetch(
      `*[_type == "therapistCandidate" && (!defined($status) || reviewStatus == $status)]
        | order(coalesce(reviewPriority, 0) desc, coalesce(nextReviewDueAt, _updatedAt) asc, _updatedAt desc)[0...$limit]{
        ...
      }`,
      { status: statusFilter || null, limit },
    );

    sendJson(response, 200, docs.map(normalizeCandidate), origin, config);
    return true;
  }

  if (request.method === "GET" && routePath === "/events") {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const laneFilter = String((url && url.searchParams.get("lane")) || "").trim();
    const beforeCursor = String((url && url.searchParams.get("before")) || "").trim();
    const limit = parsePositiveInteger(url && url.searchParams.get("limit"), 50, 200);

    // Push `before` cursor and a hard fetch window into GROQ so the
    // event log doesn't get fully materialized on every admin page load.
    // Lane filter stays JS-side (the lane logic in getEventLane() is
    // non-trivial), but only operates over the bounded window. The
    // window is intentionally larger than `limit` so lane-filtered
    // pagination can find enough matches without a second round-trip.
    const fetchWindow = Math.min(500, limit * 5);
    const docs = await client.fetch(
      `*[_type == "therapistPublishEvent" && (!defined($before) || coalesce(createdAt, _createdAt) < $before)]
        | order(coalesce(createdAt, _createdAt) desc)[0...$window]{
        _id, _createdAt, eventType, providerId, candidateId, candidateDocumentId, applicationId,
        therapistId, decision, reviewStatus, publishRecommendation, actorName, rationale,
        notes, changedFields, createdAt
      }`,
      { before: beforeCursor || null, window: fetchWindow },
    );

    const filtered = docs
      .filter(function (doc) {
        return !laneFilter || getEventLane(doc) === laneFilter;
      })
      .slice(0, limit + 1);

    const hasMore = filtered.length > limit;
    const page = filtered.slice(0, limit);
    const lastDoc = page[page.length - 1];
    sendJson(
      response,
      200,
      {
        items: page.map(normalizeReviewEvent),
        next_cursor: hasMore && lastDoc ? lastDoc.createdAt || lastDoc._createdAt || "" : "",
      },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "GET" && routePath === "/match/requests") {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const limit = parsePositiveInteger(url && url.searchParams.get("limit"), 50, 200);
    const docs = await client.fetch(
      `*[_type == "matchRequest"] | order(coalesce(createdAt, _createdAt) desc)[0...$limit]{
        _id,
        requestId,
        sessionId,
        userId,
        careState,
        careFormat,
        careIntent,
        needsMedicationManagement,
        insurancePreference,
        budgetMax,
        priorityMode,
        urgency,
        bipolarFocus,
        preferredModalities,
        populationFit,
        languagePreferences,
        culturalPreferences,
        requestSummary,
        sourceSurface,
        createdAt
      }`,
      { limit },
    );

    sendJson(
      response,
      200,
      (Array.isArray(docs) ? docs : []).map(annotateMatchRequestForDisplay),
      origin,
      config,
    );
    return true;
  }

  if (request.method === "GET" && routePath === "/match/requests/export") {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const limit = parsePositiveInteger(url && url.searchParams.get("limit"), 200, 1000);
    const format = String((url && url.searchParams.get("format")) || "json")
      .trim()
      .toLowerCase();
    const docs = await client.fetch(
      `*[_type == "matchRequest"] | order(coalesce(createdAt, _createdAt) desc)[0...$limit]{
        _id,
        requestId,
        sessionId,
        userId,
        careState,
        careFormat,
        careIntent,
        needsMedicationManagement,
        insurancePreference,
        budgetMax,
        priorityMode,
        urgency,
        bipolarFocus,
        preferredModalities,
        populationFit,
        languagePreferences,
        culturalPreferences,
        requestSummary,
        sourceSurface,
        createdAt
      }`,
      { limit },
    );
    const items = (Array.isArray(docs) ? docs : []).map(annotateMatchRequestForDisplay);

    if (format === "csv") {
      const csv = buildCsvResponse(items, [
        { key: "requestId", header: "request_id" },
        { key: "careState", header: "care_state" },
        { key: "careFormat", header: "care_format" },
        { key: "careIntent", header: "care_intent" },
        { key: "needsMedicationManagement", header: "needs_medication_management" },
        { key: "insurancePreference", header: "insurance_preference" },
        { key: "budgetMax", header: "budget_max" },
        { key: "priorityMode", header: "priority_mode" },
        { key: "urgency", header: "urgency" },
        { key: "bipolarFocus", header: "bipolar_focus" },
        { key: "preferredModalities", header: "preferred_modalities" },
        { key: "populationFit", header: "population_fit" },
        { key: "languagePreferences", header: "language_preferences" },
        { key: "requestSummary", header: "request_summary" },
        { key: "sourceSurface", header: "source_surface" },
        { key: "createdAt", header: "created_at" },
      ]);
      const headers = buildTextResponseHeaders(origin, config, "text/csv; charset=utf-8");
      response.writeHead(200, headers);
      response.end(csv);
      return true;
    }

    sendJson(response, 200, items, origin, config);
    return true;
  }

  if (request.method === "GET" && routePath === "/match/outcomes") {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const limit = parsePositiveInteger(url && url.searchParams.get("limit"), 50, 200);
    const docs = await client.fetch(
      `*[_type == "matchOutcome"] | order(coalesce(recordedAt, _createdAt) desc)[0...$limit]{
        _id,
        outcomeId,
        requestId,
        providerId,
        therapistSlug,
        rankPosition,
        resultCount,
        topSlug,
        routeType,
        outcome,
        requestSummary,
        strategySnapshot,
        recordedAt
      }`,
      { limit },
    );

    sendJson(
      response,
      200,
      (Array.isArray(docs) ? docs : []).map(annotateMatchOutcomeForDisplay),
      origin,
      config,
    );
    return true;
  }

  if (request.method === "GET" && routePath === "/match/outcomes/export") {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const limit = parsePositiveInteger(url && url.searchParams.get("limit"), 200, 1000);
    const format = String((url && url.searchParams.get("format")) || "json")
      .trim()
      .toLowerCase();
    const docs = await client.fetch(
      `*[_type == "matchOutcome"] | order(coalesce(recordedAt, _createdAt) desc)[0...$limit]{
        _id,
        outcomeId,
        requestId,
        providerId,
        therapistSlug,
        therapistName,
        rankPosition,
        resultCount,
        topSlug,
        routeType,
        shortcutType,
        pivotAt,
        recommendedWaitWindow,
        outcome,
        requestSummary,
        contextSummary,
        strategySnapshot,
        recordedAt
      }`,
      { limit },
    );
    const items = (Array.isArray(docs) ? docs : []).map(annotateMatchOutcomeForDisplay);

    if (format === "csv") {
      const csv = buildCsvResponse(items, [
        { key: "outcomeId", header: "outcome_id" },
        { key: "requestId", header: "request_id" },
        { key: "providerId", header: "provider_id" },
        { key: "therapistSlug", header: "therapist_slug" },
        { key: "therapistName", header: "therapist_name" },
        { key: "rankPosition", header: "rank_position" },
        { key: "resultCount", header: "result_count" },
        { key: "topSlug", header: "top_slug" },
        { key: "routeType", header: "route_type" },
        { key: "shortcutType", header: "shortcut_type" },
        { key: "pivotAt", header: "pivot_at" },
        { key: "recommendedWaitWindow", header: "recommended_wait_window" },
        { key: "outcome", header: "outcome" },
        { key: "requestSummary", header: "request_summary" },
        { key: "contextSummary", header: "context_summary" },
        { key: "recordedAt", header: "recorded_at" },
      ]);
      const headers = buildTextResponseHeaders(origin, config, "text/csv; charset=utf-8");
      response.writeHead(200, headers);
      response.end(csv);
      return true;
    }

    sendJson(response, 200, items, origin, config);
    return true;
  }

  if (request.method === "GET" && routePath === "/provider-observations") {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const providerId = String((url && url.searchParams.get("providerId")) || "").trim();
    if (!providerId) {
      sendJson(response, 400, { error: "Missing providerId." }, origin, config);
      return true;
    }

    const limit = parsePositiveInteger(url && url.searchParams.get("limit"), 50, 500);
    const docs = await client.fetch(
      `*[_type == "providerFieldObservation" && providerId == $providerId] | order(fieldName asc)[0...$limit]{
        _id,
        providerId,
        fieldName,
        rawValue,
        normalizedValue,
        sourceType,
        sourceDocumentType,
        sourceDocumentId,
        sourceUrl,
        observedAt,
        verifiedAt,
        confidenceScore,
        verificationMethod,
        isCurrent
      }`,
      { providerId, limit },
    );

    sendJson(
      response,
      200,
      (Array.isArray(docs) ? docs : []).map(annotateProviderFieldObservationForDisplay),
      origin,
      config,
    );
    return true;
  }

  if (request.method === "GET" && routePath === "/provider-observations/export") {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const providerId = String((url && url.searchParams.get("providerId")) || "").trim();
    if (!providerId) {
      sendJson(response, 400, { error: "Missing providerId." }, origin, config);
      return true;
    }

    const limit = parsePositiveInteger(url && url.searchParams.get("limit"), 200, 1000);
    const format = String((url && url.searchParams.get("format")) || "json")
      .trim()
      .toLowerCase();
    const docs = await client.fetch(
      `*[_type == "providerFieldObservation" && providerId == $providerId] | order(fieldName asc)[0...$limit]{
        _id,
        providerId,
        fieldName,
        rawValue,
        normalizedValue,
        sourceType,
        sourceDocumentType,
        sourceDocumentId,
        sourceUrl,
        observedAt,
        verifiedAt,
        confidenceScore,
        verificationMethod,
        isCurrent
      }`,
      { providerId, limit },
    );
    const items = (Array.isArray(docs) ? docs : []).map(annotateProviderFieldObservationForDisplay);

    if (format === "csv") {
      const csv = buildCsvResponse(items, [
        { key: "providerId", header: "provider_id" },
        { key: "fieldName", header: "field_name" },
        { key: "rawValue", header: "raw_value" },
        { key: "normalizedValue", header: "normalized_value" },
        { key: "parsedRawValue", header: "parsed_raw_value" },
        { key: "parsedNormalizedValue", header: "parsed_normalized_value" },
        { key: "sourceType", header: "source_type" },
        { key: "sourceDocumentType", header: "source_document_type" },
        { key: "sourceDocumentId", header: "source_document_id" },
        { key: "sourceUrl", header: "source_url" },
        { key: "observedAt", header: "observed_at" },
        { key: "verifiedAt", header: "verified_at" },
        { key: "confidenceScore", header: "confidence_score" },
        { key: "verificationMethod", header: "verification_method" },
        { key: "isCurrent", header: "is_current" },
      ]);
      const headers = buildTextResponseHeaders(origin, config, "text/csv; charset=utf-8");
      response.writeHead(200, headers);
      response.end(csv);
      return true;
    }

    sendJson(response, 200, items, origin, config);
    return true;
  }

  if (request.method === "GET" && routePath === "/reviewers") {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const [siteSettings, applications, candidates, events] = await Promise.all([
      client.getDocument("siteSettings"),
      client.fetch(`*[_type == "therapistApplication"]{reviewFollowUp}`),
      client.fetch(`*[_type == "therapistCandidate"]{reviewFollowUp}`),
      client.fetch(`*[_type == "therapistPublishEvent"]{actorName}`),
    ]);

    const configuredReviewers = normalizeReviewerDirectoryEntries(
      siteSettings && siteSettings.reviewerDirectory,
    );

    const derivedReviewers = []
      .concat(
        configuredReviewers.length
          ? []
          : config.adminUsername
            ? [
                {
                  id: slugifyReviewerId(config.adminUsername),
                  name: config.adminUsername,
                  active: true,
                },
              ]
            : [],
      )
      .concat(
        (Array.isArray(applications) ? applications : []).map(function (doc) {
          const followUp = doc && doc.reviewFollowUp ? doc.reviewFollowUp : null;
          const name = followUp
            ? String(followUp.assigneeName || followUp.assignee || "").trim()
            : "";
          const id = followUp ? String(followUp.assigneeId || slugifyReviewerId(name)).trim() : "";
          return { id, name, active: true };
        }),
      )
      .concat(
        (Array.isArray(candidates) ? candidates : []).map(function (doc) {
          const followUp = doc && doc.reviewFollowUp ? doc.reviewFollowUp : null;
          const name = followUp
            ? String(followUp.assigneeName || followUp.assignee || "").trim()
            : "";
          const id = followUp ? String(followUp.assigneeId || slugifyReviewerId(name)).trim() : "";
          return { id, name, active: true };
        }),
      )
      .concat(
        (Array.isArray(events) ? events : []).map(function (doc) {
          const name = doc ? String(doc.actorName || "").trim() : "";
          return {
            id: slugifyReviewerId(name),
            name,
            active: true,
          };
        }),
      )
      .filter(function (entry) {
        return entry.id && entry.name;
      });

    const reviewerMap = new Map();
    configuredReviewers.concat(derivedReviewers).forEach(function (entry) {
      if (!entry || !entry.id || !entry.name) {
        return;
      }
      if (!reviewerMap.has(entry.id)) {
        reviewerMap.set(entry.id, entry);
        return;
      }
      const current = reviewerMap.get(entry.id);
      reviewerMap.set(entry.id, {
        id: current.id,
        name: current.name || entry.name,
        active: current.active !== false && entry.active !== false,
      });
    });

    sendJson(
      response,
      200,
      Array.from(reviewerMap.values())
        .filter(function (entry) {
          return entry.active !== false;
        })
        .sort(function (a, b) {
          return a.name.localeCompare(b.name);
        }),
      origin,
      config,
    );
    return true;
  }

  if (request.method === "PATCH" && routePath === "/reviewers") {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const body = await deps.parseBody(request);
    const reviewers = normalizeReviewerDirectoryEntries(body && body.reviewers);
    const existing = (await client.getDocument("siteSettings")) || {
      _id: "siteSettings",
      _type: "siteSettings",
    };
    await client
      .transaction()
      .createOrReplace({
        ...existing,
        _id: "siteSettings",
        _type: "siteSettings",
        reviewerDirectory: reviewers.map(function (entry) {
          return {
            reviewerId: entry.id,
            name: entry.name,
            active: entry.active !== false,
          };
        }),
      })
      .commit();

    sendJson(
      response,
      200,
      reviewers.filter(function (entry) {
        return entry.active !== false;
      }),
      origin,
      config,
    );
    return true;
  }

  if (request.method === "GET" && routePath === "/events/export") {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const laneFilter = String((url && url.searchParams.get("lane")) || "").trim();
    const format = String((url && url.searchParams.get("format")) || "json")
      .trim()
      .toLowerCase();
    const limit = parsePositiveInteger(url && url.searchParams.get("limit"), 500, 1000);

    // Bound the export the same way as /events: push `limit` into GROQ
    // so we don't materialize the entire event log just to slice it
    // down. Lane filter stays JS-side; over-fetch by 5x to give it
    // enough matches without a second round-trip.
    const fetchWindow = Math.min(limit * 5, 5000);
    const docs = await client.fetch(
      `*[_type == "therapistPublishEvent"] | order(coalesce(createdAt, _createdAt) desc)[0...$window]{
        _id, _createdAt, eventType, providerId, candidateId, candidateDocumentId, applicationId,
        therapistId, decision, reviewStatus, publishRecommendation, actorName, rationale,
        notes, changedFields, createdAt
      }`,
      { window: fetchWindow },
    );

    const items = docs
      .filter(function (doc) {
        return !laneFilter || getEventLane(doc) === laneFilter;
      })
      .slice(0, limit)
      .map(normalizeReviewEvent);

    if (format === "csv") {
      const rows = items.map(function (item) {
        return {
          created_at: item.created_at || "",
          lane: getEventLane({
            eventType: item.event_type,
            applicationId: item.application_id,
            candidateId: item.candidate_id,
            candidateDocumentId: item.candidate_document_id,
            therapistId: item.therapist_id,
          }),
          event_type: item.event_type || "",
          provider_id: item.provider_id || "",
          candidate_id: item.candidate_id || "",
          candidate_document_id: item.candidate_document_id || "",
          application_id: item.application_id || "",
          therapist_id: item.therapist_id || "",
          actor_name: item.actor_name || "",
          decision: item.decision || "",
          review_status: item.review_status || "",
          publish_recommendation: item.publish_recommendation || "",
          rationale: item.rationale || "",
          notes: item.notes || "",
          changed_fields: Array.isArray(item.changed_fields) ? item.changed_fields.join(", ") : "",
        };
      });
      const headers = rows.length
        ? Object.keys(rows[0])
        : [
            "created_at",
            "lane",
            "event_type",
            "provider_id",
            "candidate_id",
            "candidate_document_id",
            "application_id",
            "therapist_id",
            "actor_name",
            "decision",
            "review_status",
            "publish_recommendation",
            "rationale",
            "notes",
            "changed_fields",
          ];
      const csv = [headers.join(",")]
        .concat(
          rows.map(function (row) {
            return headers
              .map(function (key) {
                return formatCsvCell(row[key]);
              })
              .join(",");
          }),
        )
        .join("\n");
      response.writeHead(200, buildTextResponseHeaders(origin, config, "text/csv; charset=utf-8"));
      response.end(csv);
      return true;
    }

    response.writeHead(
      200,
      buildTextResponseHeaders(origin, config, "application/json; charset=utf-8"),
    );
    response.end(JSON.stringify(items));
    return true;
  }

  return false;
}
