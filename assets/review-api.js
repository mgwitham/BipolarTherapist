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
const adminActorIdKey = "bt_review_admin_actor_id_v1";
const adminActorKey = "bt_review_admin_actor_v1";
const therapistSessionKey = "bt_therapist_session_v1";

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
    review_follow_up:
      candidate && candidate.review_follow_up && typeof candidate.review_follow_up === "object"
        ? {
            status: candidate.review_follow_up.status || "open",
            note: candidate.review_follow_up.note || "",
            assignee_id: candidate.review_follow_up.assignee_id || "",
            assignee_name:
              candidate.review_follow_up.assignee_name || candidate.review_follow_up.assignee || "",
            assignee:
              candidate.review_follow_up.assignee_name || candidate.review_follow_up.assignee || "",
            due_at: candidate.review_follow_up.due_at || "",
            updated_at: candidate.review_follow_up.updated_at || "",
          }
        : {
            status: "open",
            note: "",
            assignee_id: "",
            assignee_name: "",
            assignee: "",
            due_at: "",
            updated_at: "",
          },
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

async function requestText(path, options) {
  let response;
  try {
    response = await fetch(`${reviewApiBaseUrl}${path}`, {
      headers: {
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
  if (!response.ok) {
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (_error) {
      payload = null;
    }
    const requestError = new Error(payload && payload.error ? payload.error : "Request failed.");
    requestError.status = response.status;
    requestError.payload = payload;
    throw requestError;
  }

  return text;
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

export function getAdminActorName() {
  if (!canUseSessionStorage()) {
    return "";
  }
  return window.sessionStorage.getItem(adminActorKey) || "";
}

export function getAdminActorId() {
  if (!canUseSessionStorage()) {
    return "";
  }
  return window.sessionStorage.getItem(adminActorIdKey) || "";
}

export function setAdminActorIdentity(actor) {
  if (!canUseSessionStorage()) {
    return;
  }
  window.sessionStorage.setItem(adminActorIdKey, String((actor && actor.id) || "").trim());
  window.sessionStorage.setItem(adminActorKey, String((actor && actor.name) || "").trim());
}

export function clearAdminSessionToken() {
  if (!canUseSessionStorage()) {
    return;
  }

  window.sessionStorage.removeItem(adminSessionKey);
  window.sessionStorage.removeItem(adminActorIdKey);
  window.sessionStorage.removeItem(adminActorKey);
}

function canUseLocalStorage() {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch (_error) {
    return false;
  }
}

export function getTherapistSessionToken() {
  if (!canUseLocalStorage()) {
    return "";
  }
  return window.localStorage.getItem(therapistSessionKey) || "";
}

export function setTherapistSessionToken(token) {
  if (!canUseLocalStorage()) {
    return;
  }
  if (token) {
    window.localStorage.setItem(therapistSessionKey, token);
  } else {
    window.localStorage.removeItem(therapistSessionKey);
  }
}

export function clearTherapistSessionToken() {
  setTherapistSessionToken("");
}

function getTherapistHeaders() {
  const token = getTherapistSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchTherapistMe() {
  return request("/portal/me", {
    method: "GET",
    headers: getTherapistHeaders(),
  });
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
  const payload = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
  if (payload && (payload.actorName || payload.actorId)) {
    setAdminActorIdentity({
      id: payload.actorId || "",
      name: payload.actorName || "",
    });
  }
  return payload;
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

export async function fetchAdminSession() {
  const payload = await request("/auth/session", {
    method: "GET",
    headers: getAdminHeaders(),
  });
  if (payload && (payload.actorName || payload.actorId)) {
    setAdminActorIdentity({
      id: payload.actorId || "",
      name: payload.actorName || "",
    });
  }
  return payload;
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

export async function submitMatchRequest(matchRequest) {
  return request("/match/requests", {
    method: "POST",
    body: JSON.stringify(matchRequest),
  });
}

export async function submitMatchOutcome(matchOutcome) {
  return request("/match/outcomes", {
    method: "POST",
    body: JSON.stringify(matchOutcome),
  });
}

export async function submitTherapistProfileView(payload) {
  return request("/engagement/view", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function submitTherapistCtaClick(payload) {
  return request("/engagement/cta-click", {
    method: "POST",
    body: JSON.stringify(payload),
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

export async function requestTherapistQuickClaim(payload) {
  return request("/portal/quick-claim", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function searchTherapistQuickClaim(query) {
  return request("/portal/quick-claim/search?q=" + encodeURIComponent(query || ""), {
    method: "GET",
  });
}

// Single-result lookup by slug — used for /claim?slug=X deep-links
// so clicking a listing on /signup drops the therapist straight into
// the confirm panel without another search.
export async function lookupTherapistBySlug(slug) {
  return request("/portal/quick-claim/lookup?slug=" + encodeURIComponent(slug || ""), {
    method: "GET",
  });
}

export async function sendClaimLinkToSlug(slug) {
  return request("/portal/claim-by-slug", {
    method: "POST",
    body: JSON.stringify({ slug }),
  });
}

export async function fetchTherapistClaimSession(token) {
  return request(`/portal/claim-session?token=${encodeURIComponent(token)}`, {
    method: "GET",
  });
}

export async function acceptTherapistClaim(token) {
  const result = await request("/portal/claim-accept", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  if (result && result.therapist_session_token) {
    setTherapistSessionToken(result.therapist_session_token);
  }
  return result;
}

export async function createStripeFeaturedCheckoutSession(payload) {
  return request("/stripe/checkout-session", {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
}

// One-click claim+trial: server looks up the on-file email, sends the
// activation magic link, and returns a Stripe Checkout URL. The client
// then redirects the user to Stripe. See /portal/claim-trial handler.
export async function startClaimTrial(payload) {
  return request("/portal/claim-trial", {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
}

export async function createStripeBillingPortalSession(payload) {
  return request("/stripe/portal-session", {
    method: "POST",
    headers: getTherapistHeaders(),
    body: JSON.stringify(payload || {}),
  });
}

export async function fetchTherapistSubscription() {
  return request("/stripe/subscription", {
    method: "GET",
    headers: getTherapistHeaders(),
  });
}

// Portal analytics V0 — returns the authenticated therapist's
// engagement summary for the current calendar month plus the prior
// month. Server endpoint is read-only and requires a therapist session
// token (getTherapistHeaders supplies it from localStorage).
export async function fetchPortalAnalytics() {
  return request("/portal/analytics", {
    method: "GET",
    headers: getTherapistHeaders(),
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

export async function fetchTherapistReviewers() {
  return request("/reviewers", {
    method: "GET",
    headers: getAdminHeaders(),
  });
}

export async function updateTherapistReviewers(reviewers) {
  return request("/reviewers", {
    method: "PATCH",
    headers: getAdminHeaders(),
    body: JSON.stringify({ reviewers }),
  });
}

export async function fetchTherapistCandidates() {
  const payload = await request("/candidates", {
    method: "GET",
    headers: getAdminHeaders(),
  });

  return payload.map(sanitizeCandidate);
}

export async function fetchReviewEvents(options) {
  const params = new URLSearchParams();
  if (options && options.lane) {
    params.set("lane", options.lane);
  }
  if (options && options.limit) {
    params.set("limit", String(options.limit));
  }
  if (options && options.before) {
    params.set("before", options.before);
  }
  return request(`/events${params.toString() ? `?${params.toString()}` : ""}`, {
    method: "GET",
    headers: getAdminHeaders(),
  });
}

export async function exportReviewEvents(format, options) {
  const params = new URLSearchParams();
  params.set("format", format === "csv" ? "csv" : "json");
  if (options && options.lane) {
    params.set("lane", options.lane);
  }
  if (options && options.limit) {
    params.set("limit", String(options.limit));
  }
  return requestText(`/events/export?${params.toString()}`, {
    method: "GET",
    headers: getAdminHeaders(),
  });
}

export async function fetchMatchRequests(options) {
  const params = new URLSearchParams();
  if (options && options.limit) {
    params.set("limit", String(options.limit));
  }
  return request(`/match/requests${params.toString() ? `?${params.toString()}` : ""}`, {
    method: "GET",
    headers: getAdminHeaders(),
  });
}

export async function fetchMatchOutcomes(options) {
  const params = new URLSearchParams();
  if (options && options.limit) {
    params.set("limit", String(options.limit));
  }
  return request(`/match/outcomes${params.toString() ? `?${params.toString()}` : ""}`, {
    method: "GET",
    headers: getAdminHeaders(),
  });
}

export async function exportMatchRequests(format, options) {
  const params = new URLSearchParams();
  params.set("format", format === "csv" ? "csv" : "json");
  if (options && options.limit) {
    params.set("limit", String(options.limit));
  }
  if (format === "csv") {
    return requestText(`/match/requests/export?${params.toString()}`, {
      method: "GET",
      headers: getAdminHeaders(),
    });
  }
  return request(`/match/requests/export?${params.toString()}`, {
    method: "GET",
    headers: getAdminHeaders(),
  });
}

export async function exportMatchOutcomes(format, options) {
  const params = new URLSearchParams();
  params.set("format", format === "csv" ? "csv" : "json");
  if (options && options.limit) {
    params.set("limit", String(options.limit));
  }
  if (format === "csv") {
    return requestText(`/match/outcomes/export?${params.toString()}`, {
      method: "GET",
      headers: getAdminHeaders(),
    });
  }
  return request(`/match/outcomes/export?${params.toString()}`, {
    method: "GET",
    headers: getAdminHeaders(),
  });
}

export async function fetchProviderObservations(providerId, options) {
  const params = new URLSearchParams();
  params.set("providerId", String(providerId || "").trim());
  if (options && options.limit) {
    params.set("limit", String(options.limit));
  }
  return request(`/provider-observations?${params.toString()}`, {
    method: "GET",
    headers: getAdminHeaders(),
  });
}

export async function exportProviderObservations(providerId, format, options) {
  const params = new URLSearchParams();
  params.set("providerId", String(providerId || "").trim());
  params.set("format", format === "csv" ? "csv" : "json");
  if (options && options.limit) {
    params.set("limit", String(options.limit));
  }
  if (format === "csv") {
    return requestText(`/provider-observations/export?${params.toString()}`, {
      method: "GET",
      headers: getAdminHeaders(),
    });
  }
  return request(`/provider-observations/export?${params.toString()}`, {
    method: "GET",
    headers: getAdminHeaders(),
  });
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

export async function updateTherapistCandidate(candidateId, updates) {
  return sanitizeCandidate(
    await request(`/candidates/${encodeURIComponent(candidateId)}`, {
      method: "PATCH",
      headers: getAdminHeaders(),
      body: JSON.stringify(updates),
    }),
  );
}

export async function updateTherapist(therapistId, updates) {
  return request(`/therapists/${encodeURIComponent(therapistId)}`, {
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
