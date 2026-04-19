import crypto from "node:crypto";

const ALLOWED_LICENSE_TYPES = new Set(["LMFT", "LCSW", "LPCC", "LEP", "Psychologist"]);
const ALLOWED_BIPOLAR_ANSWERS = new Set(["yes", "sometimes", "no"]);

function buildDraftId(sessionId) {
  return "therapist-signup-draft-" + sessionId;
}

function newSessionId() {
  return crypto.randomBytes(16).toString("hex");
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeLicenseNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function pickString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeDraftForResponse(doc) {
  if (!doc) {
    return null;
  }
  return {
    session_id: doc.sessionId || "",
    email: doc.email || "",
    license_number: doc.licenseNumber || "",
    license_type: doc.licenseType || "",
    license_state: doc.licenseState || "CA",
    bipolar_answer: doc.bipolarAnswer || "",
    current_step: doc.currentStep || 0,
    outcome: doc.outcome || "pending",
    started_at: doc.startedAt || doc._createdAt || "",
    last_step_at: doc.lastStepAt || "",
  };
}

async function upsertDraft(client, sessionId, patch) {
  const id = buildDraftId(sessionId);
  const existing = await client.getDocument(id);
  const now = new Date().toISOString();
  const next = {
    _id: id,
    _type: "therapistSignupDraft",
    sessionId: sessionId,
    startedAt: (existing && existing.startedAt) || now,
    ...existing,
    ...patch,
    lastStepAt: now,
  };
  await client.transaction().createOrReplace(next).commit({ visibility: "async" });
  return next;
}

async function findTherapistByLicense(client, licenseNumber) {
  const normalized = normalizeLicenseNumber(licenseNumber);
  if (!normalized) {
    return null;
  }
  const query = `*[_type == "therapist" && licenseNumber == $license][0]`;
  const match = await client.fetch(query, { license: normalized });
  if (!match) {
    return null;
  }
  if (match.listingActive === false) {
    return null;
  }
  return match;
}

export function handleSignupRoutes(context) {
  const { client, config, deps, origin, request, response, routePath } = context;
  const { parseBody, sendJson, verifyLicense, resolveLicenseTypeCode } = deps;

  if (request.method !== "POST") {
    return Promise.resolve(false);
  }

  if (routePath === "/signup/draft") {
    return handleDraft({ client, config, deps, origin, request, response, parseBody, sendJson });
  }

  if (routePath === "/signup/verify-license") {
    return handleVerifyLicense({
      client,
      config,
      origin,
      request,
      response,
      parseBody,
      sendJson,
      verifyLicense,
      resolveLicenseTypeCode,
    });
  }

  if (routePath === "/signup/complete") {
    return handleComplete({ client, config, deps, origin, request, response, parseBody, sendJson });
  }

  return Promise.resolve(false);
}

async function handleDraft({ client, config, origin, request, response, parseBody, sendJson }) {
  let body;
  try {
    body = await parseBody(request);
  } catch (_error) {
    sendJson(response, 400, { error: "Invalid JSON body." }, origin, config);
    return true;
  }

  const sessionId = pickString(body && body.session_id) || newSessionId();
  const patch = {};

  if (body && typeof body.email === "string") {
    const email = normalizeEmail(body.email);
    if (!email || !email.includes("@")) {
      sendJson(response, 400, { error: "Valid email required." }, origin, config);
      return true;
    }
    patch.email = email;
  }

  if (body && typeof body.license_number === "string") {
    patch.licenseNumber = normalizeLicenseNumber(body.license_number);
  }

  if (body && typeof body.license_type === "string") {
    const type = pickString(body.license_type);
    if (type && !ALLOWED_LICENSE_TYPES.has(type)) {
      sendJson(response, 400, { error: "Unsupported license type." }, origin, config);
      return true;
    }
    patch.licenseType = type;
  }

  if (body && typeof body.bipolar_answer === "string") {
    const answer = pickString(body.bipolar_answer).toLowerCase();
    if (answer && !ALLOWED_BIPOLAR_ANSWERS.has(answer)) {
      sendJson(response, 400, { error: "Invalid bipolar answer." }, origin, config);
      return true;
    }
    patch.bipolarAnswer = answer;
  }

  if (body && typeof body.current_step === "number") {
    patch.currentStep = Math.max(0, Math.min(5, Math.floor(body.current_step)));
  }

  const draft = await upsertDraft(client, sessionId, patch);

  sendJson(
    response,
    200,
    {
      ok: true,
      draft: normalizeDraftForResponse(draft),
    },
    origin,
    config,
  );
  return true;
}

async function handleVerifyLicense({
  client,
  config,
  origin,
  request,
  response,
  parseBody,
  sendJson,
  verifyLicense,
  resolveLicenseTypeCode,
}) {
  let body;
  try {
    body = await parseBody(request);
  } catch (_error) {
    sendJson(response, 400, { error: "Invalid JSON body." }, origin, config);
    return true;
  }

  const sessionId = pickString(body && body.session_id);
  const licenseNumber = normalizeLicenseNumber(body && body.license_number);
  const licenseType = pickString(body && body.license_type);

  if (!sessionId) {
    sendJson(response, 400, { error: "Missing session id." }, origin, config);
    return true;
  }
  if (!licenseNumber) {
    sendJson(response, 400, { error: "Missing license number." }, origin, config);
    return true;
  }
  if (!ALLOWED_LICENSE_TYPES.has(licenseType)) {
    sendJson(response, 400, { error: "Unsupported license type." }, origin, config);
    return true;
  }

  const typeCode = resolveLicenseTypeCode(licenseType);
  const result = await verifyLicense(config, typeCode, licenseNumber);

  if (!result || !result.verified) {
    await upsertDraft(client, sessionId, {
      licenseNumber,
      licenseType,
      currentStep: 2,
    });
    sendJson(
      response,
      200,
      {
        ok: true,
        verified: false,
        error: (result && result.error) || "License not found.",
      },
      origin,
      config,
    );
    return true;
  }

  const name = result.name || {};
  const address = result.address || {};
  const displayName = [name.firstName, name.middleName, name.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  await upsertDraft(client, sessionId, {
    licenseNumber,
    licenseType,
    licensureVerification: result.licensureVerification,
    currentStep: 3,
  });

  sendJson(
    response,
    200,
    {
      ok: true,
      verified: true,
      is_active: Boolean(result.isActive),
      name: displayName,
      first_name: name.firstName || "",
      last_name: name.lastName || "",
      city: address.city || "",
      state: address.state || "CA",
      license_type: licenseType,
      discipline_flag: Boolean(
        result.licensureVerification && result.licensureVerification.disciplineFlag,
      ),
    },
    origin,
    config,
  );
  return true;
}

async function handleComplete({
  client,
  config,
  deps,
  origin,
  request,
  response,
  parseBody,
  sendJson,
}) {
  const { sendPortalClaimLink, sendSignupAcknowledgment, notifyAdminOfSubmission } = deps;

  let body;
  try {
    body = await parseBody(request);
  } catch (_error) {
    sendJson(response, 400, { error: "Invalid JSON body." }, origin, config);
    return true;
  }

  const sessionId = pickString(body && body.session_id);
  if (!sessionId) {
    sendJson(response, 400, { error: "Missing session id." }, origin, config);
    return true;
  }

  const draft = await client.getDocument(buildDraftId(sessionId));
  if (!draft) {
    sendJson(response, 404, { error: "Draft not found." }, origin, config);
    return true;
  }

  if (!draft.email || !draft.licenseNumber || !draft.bipolarAnswer) {
    sendJson(response, 400, { error: "Draft missing required fields." }, origin, config);
    return true;
  }

  const existingTherapist = await findTherapistByLicense(client, draft.licenseNumber);

  const now = new Date().toISOString();
  const portalBaseUrl = config.portalBaseUrl || "";

  if (existingTherapist && existingTherapist.slug && existingTherapist.slug.current) {
    try {
      await sendPortalClaimLink(config, existingTherapist, draft.email, portalBaseUrl);
    } catch (error) {
      sendJson(
        response,
        500,
        { error: error.message || "Failed to send claim link." },
        origin,
        config,
      );
      return true;
    }

    await upsertDraft(client, sessionId, {
      outcome: "promoted_claim",
      promotedTherapistSlug: existingTherapist.slug.current,
      completedAt: now,
      currentStep: 5,
    });

    sendJson(
      response,
      200,
      {
        ok: true,
        outcome: "claim_sent",
        therapist_name: existingTherapist.name || "",
      },
      origin,
      config,
    );
    return true;
  }

  // Net-new signup: create a minimal therapistApplication seeded from DCA data.
  const verification = draft.licensureVerification || {};
  const rawSnapshot = (function parseSnapshot() {
    try {
      return verification.rawSnapshot ? JSON.parse(verification.rawSnapshot) : {};
    } catch (_error) {
      return {};
    }
  })();
  const dcaName = rawSnapshot.name || {};
  const dcaAddress = rawSnapshot.address || {};
  const fullName = [dcaName.firstName, dcaName.lastName].filter(Boolean).join(" ").trim();

  const applicationId = `therapist-application-${sessionId}`;
  const applicationDoc = {
    _id: applicationId,
    _type: "therapistApplication",
    name: fullName || draft.email,
    email: draft.email,
    credentials: draft.licenseType || "",
    licenseState: "CA",
    licenseNumber: draft.licenseNumber,
    city: dcaAddress.city || "",
    state: dcaAddress.state || "CA",
    status: "pending",
    submissionIntent: "signup_wizard",
    signupWizardBipolarAnswer: draft.bipolarAnswer,
    licensureVerification: verification,
    submittedAt: now,
  };

  await client.transaction().createOrReplace(applicationDoc).commit({ visibility: "async" });

  if (notifyAdminOfSubmission) {
    try {
      await notifyAdminOfSubmission(config, {
        name: applicationDoc.name,
        email: applicationDoc.email,
        city: applicationDoc.city,
        state: applicationDoc.state,
        credentials: applicationDoc.credentials,
        specialties: [],
        status: applicationDoc.status,
      });
    } catch (_error) {
      // Admin notify failure must not block the applicant response.
    }
  }

  if (sendSignupAcknowledgment) {
    try {
      await sendSignupAcknowledgment(config, {
        email: draft.email,
        name: fullName,
      });
    } catch (_error) {
      // Applicant acknowledgment failure must not block the applicant response.
    }
  }

  await upsertDraft(client, sessionId, {
    outcome: "promoted_application",
    promotedApplicationId: applicationId,
    completedAt: now,
    currentStep: 5,
  });

  sendJson(
    response,
    200,
    {
      ok: true,
      outcome: "application_created",
      therapist_name: fullName,
    },
    origin,
    config,
  );
  return true;
}
