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
  return {
    ...application,
    specialties: Array.isArray(application.specialties) ? application.specialties : [],
    insurance_accepted: Array.isArray(application.insurance_accepted)
      ? application.insurance_accepted
      : [],
    languages: Array.isArray(application.languages) ? application.languages : ["English"],
    revision_history: Array.isArray(application.revision_history)
      ? application.revision_history
      : [],
    review_request_message: application.review_request_message || "",
    revision_count: Number(application.revision_count || 0) || 0,
  };
}

async function request(path, options) {
  const response = await fetch(`${reviewApiBaseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options && options.headers ? options.headers : {}),
    },
    ...options,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload && payload.error ? payload.error : "Request failed.");
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
