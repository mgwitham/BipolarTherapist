import {
  getApplications,
  getStats,
  getTherapists,
  publishApplication,
  rejectApplication,
  resetDemoData,
} from "./store.js";
import { fetchPublicTherapists } from "./cms.js";
import {
  approveTherapistApplication,
  checkReviewApiHealth,
  getAdminSessionToken,
  fetchTherapistApplications,
  rejectTherapistApplication as rejectTherapistApplicationRemote,
  setAdminSessionToken,
  signInAdmin,
  signOutAdmin,
} from "./review-api.js";

let dataMode = "local";
let remoteApplications = [];
let publishedTherapists = [];
let authRequired = false;

function formatDate(value) {
  return new Date(value).toLocaleString();
}

function renderStats() {
  if (authRequired) {
    document.getElementById("adminStats").innerHTML = "";
    return;
  }

  const stats =
    dataMode === "sanity"
      ? {
          total_therapists: publishedTherapists.length,
          states_covered: new Set(
            publishedTherapists.map(function (item) {
              return item.state;
            }),
          ).size,
          accepting_count: publishedTherapists.filter(function (item) {
            return item.accepting_new_patients;
          }).length,
        }
      : getStats();
  const therapists = dataMode === "sanity" ? publishedTherapists : getTherapists();
  const applications = dataMode === "sanity" ? remoteApplications : getApplications();

  document.getElementById("adminStats").innerHTML =
    '<div class="stat-card"><div class="stat-value">' +
    therapists.length +
    '</div><div class="stat-label">Published listings</div></div>' +
    '<div class="stat-card"><div class="stat-value">' +
    applications.filter(function (item) {
      return item.status === "pending";
    }).length +
    '</div><div class="stat-label">Pending applications</div></div>' +
    '<div class="stat-card"><div class="stat-value">' +
    stats.states_covered +
    '</div><div class="stat-label">States covered</div></div>' +
    '<div class="stat-card"><div class="stat-value">' +
    stats.accepting_count +
    '</div><div class="stat-label">Accepting patients</div></div>';
}

function renderListings() {
  if (authRequired) {
    document.getElementById("publishedListings").innerHTML = "";
    return;
  }

  const therapists = dataMode === "sanity" ? publishedTherapists : getTherapists();
  const root = document.getElementById("publishedListings");
  root.innerHTML = therapists
    .map(function (item) {
      return (
        '<div class="mini-card"><div><strong>' +
        item.name +
        '</strong><div class="subtle">' +
        item.city +
        ", " +
        item.state +
        " · " +
        item.credentials +
        '</div></div><a href="therapist.html?slug=' +
        item.slug +
        '">Open profile</a></div>'
      );
    })
    .join("");
}

function renderApplications() {
  const applications = dataMode === "sanity" ? remoteApplications : getApplications();
  const root = document.getElementById("applicationsList");

  if (authRequired) {
    root.innerHTML = "";
    return;
  }

  if (!applications.length) {
    root.innerHTML =
      '<div class="empty">No applications yet. Submit one through the signup page to test the workflow.</div>';
    return;
  }

  root.innerHTML = applications
    .map(function (item) {
      const actions =
        item.status === "pending"
          ? '<button class="btn-primary" data-action="publish" data-id="' +
            item.id +
            '">Publish</button><button class="btn-secondary" data-action="reject" data-id="' +
            item.id +
            '">Reject</button>'
          : '<span class="status ' + item.status + '">' + item.status + "</span>";

      return (
        '<article class="application-card">' +
        '<div class="application-head"><div><h3>' +
        item.name +
        '</h3><p class="subtle">' +
        item.credentials +
        (item.title ? " · " + item.title : "") +
        " · " +
        item.city +
        ", " +
        item.state +
        '</p></div><div class="subtle">' +
        formatDate(item.created_at) +
        "</div></div>" +
        '<p class="application-bio">' +
        item.bio +
        "</p>" +
        '<div class="tag-row">' +
        (item.specialties || [])
          .map(function (specialty) {
            return '<span class="tag">' + specialty + "</span>";
          })
          .join("") +
        "</div>" +
        '<div class="meta-grid">' +
        "<div><strong>Email:</strong> " +
        item.email +
        "</div>" +
        "<div><strong>Phone:</strong> " +
        (item.phone || "Not provided") +
        "</div>" +
        "<div><strong>Insurance:</strong> " +
        ((item.insurance_accepted || []).join(", ") || "Not provided") +
        "</div>" +
        "<div><strong>Format:</strong> " +
        [item.accepts_telehealth ? "Telehealth" : "", item.accepts_in_person ? "In-Person" : ""]
          .filter(Boolean)
          .join(" / ") +
        "</div>" +
        "</div>" +
        '<div class="action-row">' +
        actions +
        "</div>" +
        "</article>"
      );
    })
    .join("");

  root.querySelectorAll("[data-action]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const id = button.getAttribute("data-id");
      const action = button.getAttribute("data-action");
      button.disabled = true;
      try {
        if (dataMode === "sanity") {
          if (action === "publish") await approveTherapistApplication(id);
          if (action === "reject") await rejectTherapistApplicationRemote(id);
          await loadData();
        } else {
          if (action === "publish") publishApplication(id);
          if (action === "reject") rejectApplication(id);
          renderAll();
        }
      } finally {
        button.disabled = false;
      }
    });
  });
}

function renderAll() {
  renderStats();
  renderListings();
  renderApplications();
}

function setAuthUiState() {
  const gate = document.getElementById("adminAuthGate");
  const app = document.getElementById("adminApp");
  const resetButton = document.getElementById("resetDemo");
  const signOutButton = document.getElementById("signOutAdmin");
  const authError = document.getElementById("authError");

  if (authRequired) {
    gate.style.display = "block";
    app.style.display = "none";
    resetButton.style.display = "none";
    signOutButton.style.display = "none";
    if (authError) {
      authError.style.display = "block";
    }
    return;
  }

  gate.style.display = "none";
  app.style.display = "block";
  resetButton.style.display = dataMode === "local" ? "inline-flex" : "none";
  signOutButton.style.display = dataMode === "sanity" ? "inline-flex" : "none";
  if (authError) {
    authError.style.display = "none";
  }
}

async function loadData() {
  let reviewApiAvailable = false;

  try {
    await checkReviewApiHealth();
    reviewApiAvailable = true;
  } catch (_error) {
    reviewApiAvailable = false;
  }

  if (reviewApiAvailable && !getAdminSessionToken()) {
    dataMode = "sanity";
    remoteApplications = [];
    publishedTherapists = [];
    authRequired = true;
    setAuthUiState();
    renderAll();
    return;
  }

  try {
    const [applications, therapists] = await Promise.all([
      fetchTherapistApplications(),
      fetchPublicTherapists(),
    ]);
    remoteApplications = applications;
    publishedTherapists = therapists;
    dataMode = "sanity";
    authRequired = false;
  } catch (_error) {
    if (reviewApiAvailable || getAdminSessionToken()) {
      dataMode = "sanity";
      remoteApplications = [];
      publishedTherapists = [];
      authRequired = true;
    } else {
      dataMode = "local";
      remoteApplications = [];
      publishedTherapists = [];
      authRequired = false;
    }
  }

  setAuthUiState();
  renderAll();
}

document.getElementById("resetDemo").addEventListener("click", function () {
  resetDemoData();
  renderAll();
});

document.getElementById("adminAuthForm").addEventListener("submit", async function (event) {
  event.preventDefault();
  const field = document.getElementById("adminKey");
  const usernameField = document.getElementById("adminUsername");
  const error = document.getElementById("authError");
  const value = field.value.trim();
  const username = usernameField.value.trim();

  if (!value) {
    error.textContent = "Enter your admin password.";
    error.style.display = "block";
    return;
  }

  try {
    const result = await signInAdmin({
      username: username,
      password: value,
    });
    setAdminSessionToken(result.sessionToken);
    authRequired = false;
    error.style.display = "none";
    await loadData();

    if (authRequired) {
      error.textContent = "Those admin credentials were not accepted.";
      error.style.display = "block";
    } else {
      field.value = "";
    }
  } catch (_error) {
    authRequired = true;
    error.textContent = "Those admin credentials were not accepted.";
    error.style.display = "block";
  }
});

document.getElementById("signOutAdmin").addEventListener("click", async function () {
  await signOutAdmin();
  authRequired = false;
  dataMode = "local";
  remoteApplications = [];
  publishedTherapists = [];
  setAuthUiState();
  renderAll();
});

if (getAdminSessionToken()) {
  authRequired = false;
}

loadData();
