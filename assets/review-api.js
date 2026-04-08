function getDefaultReviewApiBaseUrl() {
  if (import.meta.env.VITE_REVIEW_API_URL) {
    return import.meta.env.VITE_REVIEW_API_URL;
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
  var fieldReviewStates = application.field_review_states || {};
  return {
    ...application,
    photo_url: application.photo_url || "",
    photo_source_type: application.photo_source_type || "",
    photo_reviewed_at: application.photo_reviewed_at || "",
    photo_usage_permission_confirmed: Boolean(application.photo_usage_permission_confirmed),
    specialties: Array.isArray(application.specialties) ? application.specialties : [],
    insurance_accepted: Array.isArray(application.insurance_accepted)
      ? application.insurance_accepted
      : [],
    therapist_reported_fields: Array.isArray(application.therapist_reported_fields)
      ? application.therapist_reported_fields
      : [],
    field_review_states: {
      estimated_wait_time: fieldReviewStates.estimated_wait_time || "therapist_confirmed",
      insurance_accepted: fieldReviewStates.insurance_accepted || "therapist_confirmed",
      telehealth_states: fieldReviewStates.telehealth_states || "therapist_confirmed",
      bipolar_years_experience: fieldReviewStates.bipolar_years_experience || "therapist_confirmed",
    },
    languages: Array.isArray(application.languages) ? application.languages : ["English"],
    revision_history: Array.isArray(application.revision_history)
      ? application.revision_history
      : [],
    review_request_message: application.review_request_message || "",
    revision_count: Number(application.revision_count || 0) || 0,
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

export async function checkReviewApiHealth() {
  return request("/health", {
    method: "GET",
  });
}
