// Needs Attention queue — silent-failure catcher.
//
// Lists every therapist whose admin intent is Live (lifecycle === "approved",
// visibilityIntent === "listed") but where isProfileLive returns false. The
// gap between intent and reality is the bug class this view exists to
// surface — anything that quietly hid a previously-Live profile.
//
// Sort: oldest _updatedAt first. The fields tracked by the trust gate
// don't carry their own timestamps yet, so _updatedAt is the best proxy
// for "this has been broken longest."

import { isProfileLive } from "../shared/profile-live-status.mjs";

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isAdminIntentLive(t) {
  const lifecycle = t.lifecycle || "";
  const visibility = t.visibility_intent || t.visibilityIntent || "";
  return lifecycle === "approved" && visibility === "listed";
}

export function buildNeedsAttentionEntries(therapists, candidates) {
  const safeTherapists = Array.isArray(therapists) ? therapists : [];
  const unconvertedCandidates = (Array.isArray(candidates) ? candidates : []).filter(function (c) {
    return !c.published_therapist_id;
  });
  const entries = [];
  for (const t of safeTherapists) {
    if (!isAdminIntentLive(t)) continue;
    const otherTherapists = safeTherapists.filter(function (other) {
      return (other.id || other._id) !== (t.id || t._id);
    });
    const live = isProfileLive(t, { otherTherapists, unconvertedCandidates });
    if (live.isLive) continue;
    entries.push({
      id: t.id || t._id,
      name: t.name || "(no name)",
      email: t.email || "",
      license: t.license_number || t.licenseNumber || "",
      updatedAt: t._updatedAt || t.updated_at || "",
      blockers: live.blockers,
      record: t,
    });
  }
  // Oldest _updatedAt first (treat empty as oldest).
  entries.sort(function (a, b) {
    return String(a.updatedAt || "").localeCompare(String(b.updatedAt || ""));
  });
  return entries;
}

function renderEntryHtml(entry) {
  const blockers = Array.isArray(entry.blockers) ? entry.blockers : [];
  const blockersHtml = blockers.length
    ? '<ul class="needs-attention-card-blockers">' +
      blockers.map((b) => "<li>" + escapeHtml(b) + "</li>").join("") +
      "</ul>"
    : "";
  return (
    '<div class="needs-attention-card">' +
    "<div>" +
    '<div class="needs-attention-card-head">' +
    escapeHtml(entry.name) +
    "</div>" +
    '<div class="needs-attention-card-meta">' +
    [escapeHtml(entry.email), escapeHtml(entry.license)].filter(Boolean).join(" · ") +
    "</div>" +
    "</div>" +
    '<div class="needs-attention-card-action">' +
    '<button type="button" class="btn-secondary" data-edit-therapist-id="' +
    escapeHtml(entry.id) +
    '">Edit profile →</button>' +
    "</div>" +
    blockersHtml +
    "</div>"
  );
}

export function renderNeedsAttentionQueue({ therapists, candidates }) {
  const section = document.getElementById("needsAttentionSection");
  const list = document.getElementById("needsAttentionList");
  const countBadge = document.getElementById("needsAttentionCount");
  if (!section || !list) return;

  const entries = buildNeedsAttentionEntries(therapists, candidates);

  // Update the nav-link count badge. Hidden when zero so the chip stays
  // quiet during normal operations.
  if (countBadge) {
    if (entries.length > 0) {
      countBadge.textContent = String(entries.length);
      countBadge.removeAttribute("hidden");
    } else {
      countBadge.setAttribute("hidden", "");
    }
  }

  if (entries.length === 0) {
    list.innerHTML = '<p class="needs-attention-empty">All Live-intent profiles are passing.</p>';
    section.setAttribute("hidden", "");
    return;
  }

  section.removeAttribute("hidden");
  list.innerHTML =
    '<div class="needs-attention-list">' + entries.map(renderEntryHtml).join("") + "</div>";
}
