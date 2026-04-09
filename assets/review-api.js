import { normalizePortableApplication } from "../shared/application-domain.mjs";

const env = (import.meta && import.meta.env) || {};

function getDefaultReviewApiBaseUrl() {
  if (env.VITE_REVIEW_API_URL) {
    return env.VITE_REVIEW_API_URL;
  }

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:8787";
    }
  }

  return "/api/review";
}

const reviewApiBaseUrl = getDefaultReviewApiBaseUrl();
const adminSessionKey = "bt_review_admin_key_v1";

function sanitizeApplication(application) {
  return normalizePortableApplication(application || {});
}

function sanitizeCandidate(candidate) {
  return {
    ...candidate,
    supporting_source_urls: Array.isArray(candidate.supporting_source_urls)
      ? candidate.supporting_source_urls
      : [],
    specialties: Array.isArray(candidate.specialties) ? candidate.specialties : [],
    treatment_modalities: Array.isArray(candidate.treatment_modalities)
      ? candidate.treatment_modalities
      : [],
    client_populations: Array.isArray(candidate.client_populations)
      ? candidate.client_populations
      : [],
    insurance_accepted: Array.isArray(candidate.insurance_accepted)
      ? candidate.insurance_accepted
      : [],
    languages: Array.isArray(candidate.languages) ? candidate.languages : [],
    telehealth_states: Array.isArray(candidate.telehealth_states)
      ? candidate.telehealth_states
      : [],
    review_history: Array.isArray(candidate.review_history) ? candidate.review_history : [],
    review_lane: candidate.review_lane || "editorial_review",
    review_priority:
      typeof candidate.review_priority === "number" ? candidate.review_priority : null,
    next_review_due_at: candidate.next_review_due_at || "",
    last_reviewed_at: candidate.last_reviewed_at || "",
  };
}

async function request(path, options) {
  let response;
  try {
    response = await fetch(`${reviewApiBaseUrl}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(options && options.headers ? options.headers : {}),
      },
      ...options,
    });
  } catch (error) {
    const networkError = new Error(error && error.message ? error.message : "Request failed.");
    networkError.isNetworkError = true;
    throw networkError;
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const requestError = new Error(payload && payload.error ? payload.error : "Request failed.");
    requestError.status = response.status;
    requestError.payload = payload;
    throw requestError;
  }

  return payload;
}

function canUseSessionStorage() {
  try {
    return typeof window !== "undefined" && !!window.sessionStorage;
  } catch (_error) {
    return false;
  }
}

export function getAdminSessionToken() {
  if (!canUseSessionStorage()) {
    return "";
  }

  return window.sessionStorage.getItem(adminSessionKey) || "";
}

export function setAdminSessionToken(adminSessionToken) {
  if (!canUseSessionStorage()) {
    return;
  }

  window.sessionStorage.setItem(adminSessionKey, adminSessionToken);
}

export function clearAdminSessionToken() {
  if (!canUseSessionStorage()) {
    return;
  }

  window.sessionStorage.removeItem(adminSessionKey);
}

function getAdminHeaders() {
  const sessionToken = getAdminSessionToken();
  return sessionToken
    ? {
        Authorization: `Bearer ${sessionToken}`,
      }
    : {};
}

export async function signInAdmin(credentials) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export async function signOutAdmin() {
  const token = getAdminSessionToken();
  try {
    if (token) {
      await request("/auth/logout", {
        method: "POST",
        headers: getAdminHeaders(),
      });
    }
  } finally {
    clearAdminSessionToken();
  }
}

export async function submitTherapistApplication(application) {
  return sanitizeApplication(
    await request("/applications", {
      method: "POST",
      body: JSON.stringify(application),
    }),
  );
}

export async function submitTherapistPortalRequest(requestPayload) {
  return request("/portal/requests", {
    method: "POST",
    body: JSON.stringify(requestPayload),
  });
}

export async function fetchTherapistPortalRequests() {
  return request("/portal/requests", {
    method: "GET",
    headers: getAdminHeaders(),
  });
}

export async function updateTherapistPortalRequest(requestId, updates) {
  return request(`/portal/requests/${encodeURIComponent(requestId)}`, {
    method: "PATCH",
    headers: getAdminHeaders(),
    body: JSON.stringify(updates),
  });
}

export async function requestTherapistClaimLink(payload) {
  return request("/portal/claim-link", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchTherapistClaimSession(token) {
  return request(`/portal/claim-session?token=${encodeURIComponent(token)}`, {
    method: "GET",
  });
}

export async function acceptTherapistClaim(token) {
  return request("/portal/claim-accept", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function fetchTherapistApplicationRevision(applicationId) {
  return sanitizeApplication(
    await request(`/applications/${encodeURIComponent(applicationId)}/revision`, {
      method: "GET",
    }),
  );
}

export async function submitTherapistApplicationRevision(applicationId, application) {
  return sanitizeApplication(
    await request(`/applications/${encodeURIComponent(applicationId)}/revise`, {
      method: "POST",
      body: JSON.stringify(application),
    }),
  );
}

export async function fetchTherapistApplications() {
  const payload = await request("/applications", {
    method: "GET",
    headers: getAdminHeaders(),
  });

  return payload.map(sanitizeApplication);
}

export async function fetchTherapistCandidates() {
  const payload = await request("/candidates", {
    method: "GET",
    headers: getAdminHeaders(),
  });

  return payload.map(sanitizeCandidate);
}

export async function decideTherapistCandidate(candidateId, decisionPayload) {
  const payload = await request(`/candidates/${encodeURIComponent(candidateId)}/decision`, {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify(decisionPayload),
  });

  return {
    ...payload,
    candidate: payload && payload.candidate ? sanitizeCandidate(payload.candidate) : null,
  };
}

export async function decideTherapistOps(therapistId, decisionPayload) {
  return request(`/therapists/${encodeURIComponent(therapistId)}/ops`, {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify(decisionPayload),
  });
}

export async function decideLicensureOps(licensureRecordId, decisionPayload) {
  return request(`/licensure-records/${encodeURIComponent(licensureRecordId)}/ops`, {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify(decisionPayload),
  });
}

export async function approveTherapistApplication(applicationId) {
  return request(`/applications/${encodeURIComponent(applicationId)}/approve`, {
    method: "POST",
    headers: getAdminHeaders(),
  });
}

export async function rejectTherapistApplication(applicationId) {
  return request(`/applications/${encodeURIComponent(applicationId)}/reject`, {
    method: "POST",
    headers: getAdminHeaders(),
  });
}

export async function updateTherapistApplication(applicationId, updates) {
  return request(`/applications/${encodeURIComponent(applicationId)}`, {
    method: "PATCH",
    headers: getAdminHeaders(),
    body: JSON.stringify(updates),
  });
}

export async function applyTherapistApplicationFields(applicationId, fields) {
  return request(`/applications/${encodeURIComponent(applicationId)}/apply-live-fields`, {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ fields: Array.isArray(fields) ? fields : [] }),
  });
}

export async function checkReviewApiHealth() {
  return request("/health", {
    method: "GET",
  });
}
