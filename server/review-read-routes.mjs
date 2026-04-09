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
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    Vary: "Origin",
  };
  if (origin && Array.isArray(config.allowedOrigins) && config.allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function slugifyReviewerId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

export async function handleReadRoutes(context) {
  const {
    client,
    config,
    deps,
    origin,
    request,
    response,
    routePath,
    url,
  } = context;

  const {
    isAuthorized,
    normalizeApplication,
    normalizeCandidate,
    normalizeReviewEvent,
    sendJson,
  } = deps;

  if (request.method === "GET" && routePath === "/applications") {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const docs = await client.fetch(
      `*[_type == "therapistApplication"] | order(coalesce(submittedAt, _createdAt) desc){
        _id, _createdAt, _updatedAt, name, email, credentials, title, "photo": photo{asset->{url}}, photoSourceType, photoReviewedAt, photoUsagePermissionConfirmed, practiceName, phone, website, preferredContactMethod, preferredContactLabel, contactGuidance, firstStepExpectation, bookingUrl, city, state, zip, country,
        licenseState, licenseNumber, bio, careApproach, specialties, treatmentModalities, clientPopulations,
        insuranceAccepted, languages, yearsExperience, bipolarYearsExperience, acceptsTelehealth, acceptsInPerson,
        acceptingNewPatients, telehealthStates, estimatedWaitTime, medicationManagement, verificationStatus,
        sessionFeeMin, sessionFeeMax, slidingScale, status, notes, submittedSlug, submittedAt, updatedAt, reviewRequestMessage, revisionHistory, revisionCount,
        publishedTherapistId, reviewFollowUp
      }`,
    );

    sendJson(response, 200, docs.map(normalizeApplication), origin, config);
    return true;
  }

  if (request.method === "GET" && routePath === "/candidates") {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const docs = await client.fetch(
      `*[_type == "therapistCandidate"] | order(coalesce(reviewPriority, 0) desc, coalesce(nextReviewDueAt, _updatedAt) asc, _updatedAt desc){
        ...
      }`,
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

    const docs = await client.fetch(
      `*[_type == "therapistPublishEvent"] | order(coalesce(createdAt, _createdAt) desc){
        _id, _createdAt, eventType, providerId, candidateId, candidateDocumentId, applicationId,
        therapistId, decision, reviewStatus, publishRecommendation, actorName, rationale,
        notes, changedFields, createdAt
      }`,
    );

    const filtered = docs
      .filter(function (doc) {
        if (laneFilter && getEventLane(doc) !== laneFilter) {
          return false;
        }
        if (beforeCursor) {
          const createdAt = doc.createdAt || doc._createdAt || "";
          if (!createdAt || createdAt >= beforeCursor) {
            return false;
          }
        }
        return true;
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
            ? [{ id: slugifyReviewerId(config.adminUsername), name: config.adminUsername, active: true }]
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
    const format = String((url && url.searchParams.get("format")) || "json").trim().toLowerCase();
    const limit = parsePositiveInteger(url && url.searchParams.get("limit"), 500, 1000);

    const docs = await client.fetch(
      `*[_type == "therapistPublishEvent"] | order(coalesce(createdAt, _createdAt) desc){
        _id, _createdAt, eventType, providerId, candidateId, candidateDocumentId, applicationId,
        therapistId, decision, reviewStatus, publishRecommendation, actorName, rationale,
        notes, changedFields, createdAt
      }`,
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
            return headers.map(function (key) {
              return formatCsvCell(row[key]);
            }).join(",");
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
