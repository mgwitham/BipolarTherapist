const MAX_BATCH_SIZE = 50;
const EXTRACTION_VERSION = "claude-ingest-v1";
const DEFAULT_SOURCE_TYPE = "manual_research";
const DCA_NOT_CONFIGURED_ERROR = "DCA credentials not configured";

function inferLicenseTypeCode(licenseNumber, credentials) {
  const number = String(licenseNumber || "")
    .toUpperCase()
    .trim();
  if (number.startsWith("PSY")) return "6001";
  if (number.startsWith("MFT") || number.startsWith("MFC")) return "2001";
  if (number.startsWith("LCSW") || number.startsWith("ASW")) return "2002";
  if (number.startsWith("LPCC") || number.startsWith("APCC")) return "2005";
  if (number.startsWith("LEP")) return "2003";

  const creds = String(credentials || "")
    .toUpperCase()
    .trim();
  if (/\bMD\b|\bDO\b/.test(creds)) return "8002";
  if (/\bLMFT\b|\bMFT\b/.test(creds)) return "2001";
  if (/\bLCSW\b/.test(creds)) return "2002";
  if (/\bLPCC\b/.test(creds)) return "2005";
  if (/\bPSY(D|\.?D)?\b|PHD\b/.test(creds) && /PSYCH/.test(creds)) return "6001";
  if (/\bPSYD\b/.test(creds)) return "6001";
  return null;
}

function normalizeNameTokens(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[,.]/g, " ")
    .replace(/\b(dr|doctor|prof|professor|mr|mrs|ms|mx)\b/g, "")
    .replace(/\b(phd|psyd|edd|mscp|lmft|mft|lcsw|lpcc|lep|md|do|ms|ma)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function namesProbablyMatch(ingestedName, dcaName) {
  if (!dcaName || (!dcaName.firstName && !dcaName.lastName)) return null;
  const ingested = normalizeNameTokens(ingestedName);
  const dcaFirst = String(dcaName.firstName || "")
    .toLowerCase()
    .trim();
  const dcaLast = String(dcaName.lastName || "")
    .toLowerCase()
    .trim();
  if (!dcaLast || !ingested.length) return null;

  const lastMatches = ingested.some(function (token) {
    return token === dcaLast;
  });
  if (!lastMatches) return false;

  if (!dcaFirst) return true;
  const firstMatches = ingested.some(function (token) {
    return token === dcaFirst || token.startsWith(dcaFirst) || dcaFirst.startsWith(token);
  });
  return firstMatches;
}
const ALLOWED_SOURCE_TYPES = new Set([
  "practice_website",
  "directory_profile",
  "licensing_board",
  "therapist_submitted",
  "manual_research",
  "import_batch",
]);

function clampString(value, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return maxLength && text.length > maxLength ? text.slice(0, maxLength) : text;
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(function (entry) {
      return typeof entry === "string" ? entry.trim() : "";
    })
    .filter(Boolean);
}

function urlArray(value) {
  return stringArray(value).filter(function (entry) {
    return /^https?:\/\//i.test(entry);
  });
}

function clampNumber(value, { min, max } = {}) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  let next = value;
  if (typeof min === "number" && next < min) next = min;
  if (typeof max === "number" && next > max) next = max;
  return next;
}

function buildCandidateDocumentId(providerId) {
  const safe = String(providerId || "")
    .replace(/[^a-z0-9-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const id = `candidate-${safe || `adhoc-${Date.now()}`}`;
  return id.length > 120 ? id.slice(0, 120) : id;
}

function fetchDedupeCorpus(client) {
  return Promise.all([
    client.fetch(
      `*[_type == "therapist"]{
        _id,
        name,
        credentials,
        email,
        phone,
        website,
        bookingUrl,
        city,
        state,
        licenseState,
        licenseNumber,
        "slug": slug.current,
        listingActive,
        status
      }`,
    ),
    client.fetch(
      `*[_type == "therapistApplication" && status in ["pending", "reviewing", "requested_changes", "approved"]]{
        _id,
        name,
        credentials,
        email,
        phone,
        website,
        bookingUrl,
        city,
        state,
        licenseState,
        licenseNumber,
        submittedSlug,
        status,
        publishedTherapistId
      }`,
    ),
    client.fetch(
      `*[_type == "therapistCandidate"]{
        _id,
        name,
        credentials,
        email,
        phone,
        website,
        bookingUrl,
        city,
        state,
        licenseState,
        licenseNumber,
        reviewStatus
      }`,
    ),
  ]);
}

function filterActiveCandidates(candidates) {
  return (candidates || []).filter(function (doc) {
    return String(doc.reviewStatus || "").toLowerCase() !== "archived";
  });
}

function findDuplicateMatch(identity, deps, corpus) {
  const [therapists, applications, candidatesRaw] = corpus;
  const candidates = filterActiveCandidates(candidatesRaw);
  const { compareDuplicateIdentity } = deps;

  for (const therapist of therapists || []) {
    if (
      therapist.listingActive === false ||
      String(therapist.status || "active").toLowerCase() === "archived"
    ) {
      continue;
    }
    const reasons = compareDuplicateIdentity(identity, therapist);
    if (reasons.length) {
      return {
        kind: "therapist",
        id: therapist._id,
        slug: therapist.slug || "",
        name: therapist.name || "",
        reasons,
      };
    }
  }

  for (const application of applications || []) {
    const shaped = { ...application, slug: application.submittedSlug || "" };
    const reasons = compareDuplicateIdentity(identity, shaped);
    if (reasons.length) {
      return {
        kind: "application",
        id: application._id,
        slug: application.submittedSlug || "",
        name: application.name || "",
        reasons,
      };
    }
  }

  for (const candidate of candidates || []) {
    const reasons = compareDuplicateIdentity(identity, candidate);
    if (reasons.length) {
      return {
        kind: "candidate",
        id: candidate._id,
        name: candidate.name || "",
        reasons,
      };
    }
  }

  return null;
}

function normalizeIngestRecord(input) {
  return {
    name: clampString(input.name, 200),
    credentials: clampString(input.credentials, 80),
    title: clampString(input.title, 120),
    practiceName: clampString(input.practice_name || input.practiceName, 160),
    city: clampString(input.city, 120),
    state: clampString(input.state || "CA", 80),
    zip: clampString(input.zip, 16),
    licenseState: clampString(input.license_state || input.licenseState, 8),
    licenseNumber: clampString(input.license_number || input.licenseNumber, 40),
    email: clampString(input.email, 200).toLowerCase(),
    phone: clampString(input.phone, 40),
    website: clampString(input.website, 400),
    bookingUrl: clampString(input.booking_url || input.bookingUrl, 400),
    careApproach: clampString(input.care_approach || input.careApproach, 2000),
    specialties: stringArray(input.specialties),
    treatmentModalities: stringArray(input.treatment_modalities || input.treatmentModalities),
    clientPopulations: stringArray(input.client_populations || input.clientPopulations),
    insuranceAccepted: stringArray(input.insurance_accepted || input.insuranceAccepted),
    languages: stringArray(input.languages),
    telehealthStates: stringArray(input.telehealth_states || input.telehealthStates),
    acceptsTelehealth:
      typeof input.accepts_telehealth === "boolean"
        ? input.accepts_telehealth
        : typeof input.acceptsTelehealth === "boolean"
          ? input.acceptsTelehealth
          : null,
    acceptsInPerson:
      typeof input.accepts_in_person === "boolean"
        ? input.accepts_in_person
        : typeof input.acceptsInPerson === "boolean"
          ? input.acceptsInPerson
          : null,
    sourceType: ALLOWED_SOURCE_TYPES.has(input.source_type || input.sourceType)
      ? input.source_type || input.sourceType
      : DEFAULT_SOURCE_TYPE,
    sourceUrl: clampString(input.source_url || input.sourceUrl, 500),
    supportingSourceUrls: urlArray(input.supporting_source_urls || input.supportingSourceUrls),
    rawSourceSnapshot: clampString(input.raw_source_snapshot || input.rawSourceSnapshot, 8000),
    extractionConfidence: clampNumber(
      typeof input.extraction_confidence === "number"
        ? input.extraction_confidence
        : input.extractionConfidence,
      { min: 0, max: 1 },
    ),
    notes: clampString(input.notes, 2000),
  };
}

export async function handleCandidateIngestRoutes(context) {
  const { client, config, deps, origin, request, response, routePath } = context;
  const {
    buildDuplicateIdentity,
    buildProviderId,
    compareDuplicateIdentity,
    computeCandidateReviewMeta,
    getAuthorizedActor,
    isAuthorized,
    parseBody,
    sendJson,
    verifyLicense,
  } = deps;

  if (!(request.method === "POST" && routePath === "/candidates/ingest")) {
    return false;
  }

  if (!isAuthorized(request, config)) {
    sendJson(response, 401, { error: "Unauthorized." }, origin, config);
    return true;
  }

  const body = await parseBody(request);
  const rawCandidates = Array.isArray(body.candidates) ? body.candidates : [];
  if (!rawCandidates.length) {
    sendJson(
      response,
      400,
      { error: "Request must include a non-empty `candidates` array." },
      origin,
      config,
    );
    return true;
  }
  if (rawCandidates.length > MAX_BATCH_SIZE) {
    sendJson(
      response,
      400,
      { error: `Batch size exceeds limit of ${MAX_BATCH_SIZE}.` },
      origin,
      config,
    );
    return true;
  }

  const corpus = await fetchDedupeCorpus(client);
  const actor = getAuthorizedActor(request, config) || "ingest";
  const now = new Date().toISOString();

  const created = [];
  const updated = [];
  const skippedDuplicate = [];
  const errors = [];

  const seenIdsInBatch = new Set();

  for (let index = 0; index < rawCandidates.length; index += 1) {
    const raw = rawCandidates[index] || {};
    try {
      const normalized = normalizeIngestRecord(raw);

      if (!normalized.name) {
        errors.push({ index, error: "`name` is required." });
        continue;
      }

      const identity = buildDuplicateIdentity(normalized);
      const providerId = buildProviderId({
        name: normalized.name,
        city: normalized.city,
        state: normalized.state,
        licenseState: normalized.licenseState,
        licenseNumber: normalized.licenseNumber,
      });
      const candidateId = buildCandidateDocumentId(providerId);

      if (seenIdsInBatch.has(candidateId)) {
        errors.push({
          index,
          error: "Duplicate candidate within the same batch.",
          candidateId,
        });
        continue;
      }
      seenIdsInBatch.add(candidateId);

      const duplicateMatch = findDuplicateMatch(
        { ...identity, slug: identity.slug },
        { compareDuplicateIdentity },
        corpus,
      );

      if (
        duplicateMatch &&
        (duplicateMatch.kind === "therapist" || duplicateMatch.kind === "application")
      ) {
        skippedDuplicate.push({
          index,
          name: normalized.name,
          candidateId,
          match: duplicateMatch,
        });
        continue;
      }

      const existing = await client.getDocument(candidateId);
      const isUpdate = existing && existing._type === "therapistCandidate" ? true : false;

      let verification = { attempted: false };
      let licensureVerification = null;
      let confidenceAdjustment = 0;
      let verificationNote = "";
      if (verifyLicense && normalized.licenseState === "CA" && normalized.licenseNumber) {
        const typeCode = inferLicenseTypeCode(normalized.licenseNumber, normalized.credentials);
        if (typeCode) {
          const result = await verifyLicense(config, typeCode, normalized.licenseNumber);
          if (result && result.verified) {
            licensureVerification = result.licensureVerification || null;
            const nameCheck = namesProbablyMatch(normalized.name, result.name);
            if (nameCheck === true) {
              verification = {
                attempted: true,
                ok: true,
                status: result.isActive ? "active" : "verified_inactive",
                nameMatch: "match",
              };
              confidenceAdjustment = 0.4;
            } else if (nameCheck === false) {
              const dcaName = [result.name?.firstName, result.name?.lastName]
                .filter(Boolean)
                .join(" ");
              verificationNote = `DCA name mismatch: license ${normalized.licenseNumber} is registered to "${dcaName}" (ingested as "${normalized.name}")`;
              verification = {
                attempted: true,
                ok: false,
                status: "name_mismatch",
                dcaName,
              };
              confidenceAdjustment = -0.3;
            } else {
              verification = {
                attempted: true,
                ok: true,
                status: result.isActive ? "active" : "verified_inactive",
                nameMatch: "indeterminate",
              };
              confidenceAdjustment = 0.2;
            }
          } else {
            const error = result && result.error ? result.error : "verification failed";
            if (error === DCA_NOT_CONFIGURED_ERROR) {
              verification = { attempted: false, reason: "dca_not_configured" };
            } else {
              verificationNote = `DCA verification failed: ${error}`;
              verification = { attempted: true, ok: false, status: "lookup_failed", error };
              confidenceAdjustment = -0.2;
            }
          }
        } else {
          verification = { attempted: false, reason: "license_type_unknown" };
        }
      }

      const dedupeSignal =
        duplicateMatch && duplicateMatch.kind === "candidate"
          ? {
              dedupeStatus: "possible_duplicate",
              dedupeReasons: duplicateMatch.reasons,
              matchedCandidateId: duplicateMatch.id || "",
            }
          : { dedupeStatus: "unreviewed", dedupeReasons: [] };

      const baseConfidence =
        normalized.extractionConfidence == null ? 0.5 : normalized.extractionConfidence;
      const adjustedConfidence = Math.max(0, Math.min(1, baseConfidence + confidenceAdjustment));
      const mergedNotes = [normalized.notes, verificationNote].filter(Boolean).join("\n\n");

      const docFields = {
        _type: "therapistCandidate",
        _id: candidateId,
        candidateId,
        providerFingerprint: providerId,
        providerId,
        name: normalized.name,
        credentials: normalized.credentials,
        title: normalized.title,
        practiceName: normalized.practiceName,
        city: normalized.city,
        state: normalized.state,
        zip: normalized.zip,
        country: "US",
        licenseState: normalized.licenseState,
        licenseNumber: normalized.licenseNumber,
        email: normalized.email,
        phone: normalized.phone,
        website: normalized.website,
        bookingUrl: normalized.bookingUrl,
        careApproach: normalized.careApproach,
        specialties: normalized.specialties,
        treatmentModalities: normalized.treatmentModalities,
        clientPopulations: normalized.clientPopulations,
        insuranceAccepted: normalized.insuranceAccepted,
        languages: normalized.languages,
        telehealthStates: normalized.telehealthStates,
        sourceType: normalized.sourceType,
        sourceUrl: normalized.sourceUrl,
        supportingSourceUrls: normalized.supportingSourceUrls,
        rawSourceSnapshot: normalized.rawSourceSnapshot,
        extractedAt: now,
        extractionVersion: EXTRACTION_VERSION,
        extractionConfidence: adjustedConfidence,
        notes: mergedNotes,
        reviewStatus: "queued",
        publishRecommendation: "",
        ...dedupeSignal,
      };

      if (licensureVerification) {
        docFields.licensureVerification = licensureVerification;
      }

      if (typeof normalized.acceptsTelehealth === "boolean") {
        docFields.acceptsTelehealth = normalized.acceptsTelehealth;
      }
      if (typeof normalized.acceptsInPerson === "boolean") {
        docFields.acceptsInPerson = normalized.acceptsInPerson;
      }

      const reviewMeta = computeCandidateReviewMeta(docFields);
      docFields.reviewLane = reviewMeta.reviewLane;
      docFields.reviewPriority = reviewMeta.reviewPriority;
      docFields.nextReviewDueAt = reviewMeta.nextReviewDueAt;

      const historyEntry = {
        _key: `ingest-${Date.now()}-${index}`,
        type: "ingested",
        at: now,
        decision: isUpdate ? "ingest_update" : "ingest_create",
        note: `Ingested by ${actor} (${docFields.sourceType})`,
      };

      const resultEntry = {
        index,
        candidateId,
        name: docFields.name,
        dedupeStatus: docFields.dedupeStatus,
        possibleDuplicate:
          duplicateMatch && duplicateMatch.kind === "candidate" ? duplicateMatch : null,
        verification,
      };

      const transaction = client.transaction();
      if (isUpdate) {
        const mergedSupportingUrls = Array.from(
          new Set(
            [
              ...(Array.isArray(existing.supportingSourceUrls)
                ? existing.supportingSourceUrls
                : []),
              ...docFields.supportingSourceUrls,
            ].filter(Boolean),
          ),
        );
        transaction.patch(candidateId, function (patch) {
          return patch
            .setIfMissing({ reviewHistory: [] })
            .set({
              ...docFields,
              reviewStatus: existing.reviewStatus || "queued",
              publishRecommendation: existing.publishRecommendation || "",
              notes: existing.notes || docFields.notes,
              supportingSourceUrls: mergedSupportingUrls,
            })
            .append("reviewHistory", [historyEntry]);
        });
        await transaction.commit({ visibility: "sync" });
        updated.push(resultEntry);
      } else {
        transaction.create({
          ...docFields,
          reviewHistory: [historyEntry],
        });
        await transaction.commit({ visibility: "sync" });
        created.push(resultEntry);
      }
    } catch (error) {
      errors.push({
        index,
        error: (error && error.message) || "Unknown ingest error.",
      });
    }
  }

  sendJson(
    response,
    200,
    {
      ok: true,
      summary: {
        received: rawCandidates.length,
        created: created.length,
        updated: updated.length,
        skippedDuplicate: skippedDuplicate.length,
        errors: errors.length,
      },
      created,
      updated,
      skippedDuplicate,
      errors,
    },
    origin,
    config,
  );
  return true;
}
