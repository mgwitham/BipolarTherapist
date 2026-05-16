// Needs Attention queue, silent-failure catcher.
//
// Lists every therapist whose admin intent is Live (lifecycle === "approved",
// visibilityIntent === "listed") but where isProfileLive returns false. The
// gap between intent and reality is the bug class this view exists to
// surface, anything that quietly hid a previously-Live profile.
//
// Sort: oldest _updatedAt first. The fields tracked by the trust gate
// don't carry their own timestamps yet, so _updatedAt is the best proxy
// for "this has been broken longest."

import { isProfileLive } from "../shared/profile-live-status.mjs";
import { escapeHtml } from "./escape-html.js";

function isAdminIntentLive(t) {
  const lifecycle = t.lifecycle || "";
  const visibility = t.visibility_intent || t.visibilityIntent || "";
  return lifecycle === "approved" && visibility === "listed";
}

export function buildNeedsAttentionEntries(therapists, candidates) {
  const safeTherapists = Array.isArray(therapists) ? therapists : [];
  // A candidate counts as "unconverted" (and so capable of triggering the
  // duplicate detector) only when it has no publishedTherapistId AND it
  // hasn't been explicitly marked as rejected_duplicate by the admin
  // Resolve Duplicate workflow.
  const unconvertedCandidates = (Array.isArray(candidates) ? candidates : []).filter(function (c) {
    if (c.published_therapist_id) return false;
    if (c.dedupe_status === "rejected_duplicate") return false;
    return true;
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

// Parse the counterpart doc id and kind out of a duplicate blocker string.
// Blocker text is human-readable, but the id appears in parentheses; we
// extract it here so the Resolve Duplicate workflow can launch with the
// right doc on the other side. Returns null when no duplicate blocker is
// present (so callers can decide whether to show the button at all).
export function parseDuplicateCounterpart(blockers) {
  for (const b of Array.isArray(blockers) ? blockers : []) {
    if (typeof b !== "string" || !b.startsWith("Duplicate detected")) continue;
    const idMatch = b.match(/\(([^)]+)\)/);
    if (!idMatch) continue;
    const id = idMatch[1];
    const kind = b.includes("unconverted candidate") ? "candidate" : "therapist";
    return { id, kind };
  }
  return null;
}

function renderEntryHtml(entry) {
  const blockers = Array.isArray(entry.blockers) ? entry.blockers : [];
  const blockersHtml = blockers.length
    ? '<ul class="needs-attention-card-blockers">' +
      blockers.map((b) => "<li>" + escapeHtml(b) + "</li>").join("") +
      "</ul>"
    : "";
  // Surface a Resolve Duplicate button only when one of the blockers is a
  // duplicate detection. Routine missing-field blockers stay simple, only
  // the Edit button shows. Avoids cluttering every card with an action that
  // would be a no-op for most rows.
  const counterpart = parseDuplicateCounterpart(blockers);
  const resolveBtn = counterpart
    ? '<button type="button" class="btn-secondary needs-attention-resolve-btn" ' +
      'data-resolve-duplicate-therapist-id="' +
      escapeHtml(entry.id) +
      '" data-resolve-duplicate-counterpart-id="' +
      escapeHtml(counterpart.id) +
      '" data-resolve-duplicate-counterpart-kind="' +
      escapeHtml(counterpart.kind) +
      '">Resolve duplicate</button>'
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
    resolveBtn +
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

  // Update the nav-link count badge AND the inline count next to the
  // section title. The chip-nav lives in the (currently hidden) Live
  // listings sidebar region, so the inline count is the visible signal
  // when the queue lives inside the Review tab. Both are hidden when
  // the queue is empty.
  const inlineCount = document.getElementById("needsAttentionInlineCount");
  for (const el of [countBadge, inlineCount]) {
    if (!el) continue;
    if (entries.length > 0) {
      el.textContent = String(entries.length);
      el.removeAttribute("hidden");
    } else {
      el.setAttribute("hidden", "");
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
