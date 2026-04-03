const reviewApiBaseUrl = import.meta.env.VITE_REVIEW_API_URL || "http://localhost:8787";

function sanitizeApplication(application) {
  return {
    ...application,
    specialties: Array.isArray(application.specialties) ? application.specialties : [],
    insurance_accepted: Array.isArray(application.insurance_accepted)
      ? application.insurance_accepted
      : [],
    languages: Array.isArray(application.languages) ? application.languages : ["English"],
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
  });

  return payload.map(sanitizeApplication);
}

export async function approveTherapistApplication(applicationId) {
  return request(`/applications/${encodeURIComponent(applicationId)}/approve`, {
    method: "POST",
  });
}

export async function rejectTherapistApplication(applicationId) {
  return request(`/applications/${encodeURIComponent(applicationId)}/reject`, {
    method: "POST",
  });
}

export async function checkReviewApiHealth() {
  return request("/health", {
    method: "GET",
  });
}
