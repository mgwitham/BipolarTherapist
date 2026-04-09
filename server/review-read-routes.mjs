export async function handleReadRoutes(context) {
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
    isAuthorized,
    normalizeApplication,
    normalizeCandidate,
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
        publishedTherapistId
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

  return false;
}
