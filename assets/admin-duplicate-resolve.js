// Resolve Duplicate workflow.
//
// Opens from the "Resolve duplicate" button on a Needs Attention card. The
// button only renders when isProfileLive flagged a duplicate, so this
// module never shows up on profiles that don't have a duplicate to act on.
//
// Layout: side-by-side compare of the live therapist (left) vs the
// duplicate counterpart (right, usually a candidate, occasionally another
// therapist). Mismatched fields are highlighted so the admin can decide
// fast.
//
// Actions:
//   - Merge into existing therapist (only when counterpart is a candidate
//     and the candidate's matchedTherapistId points at this therapist,
//     the existing /candidates/:id/decision merge_to_therapist flow does
//     the heavy lifting).
//   - Mark as not duplicate (sets candidate dedupeStatus =
//     "rejected_duplicate"; the duplicate detector then filters it out).
//   - Cancel (close, no changes).

import {
  decideTherapistCandidate,
  updateTherapist,
  updateTherapistCandidate,
} from "./review-api.js";
import { trackFunnelEvent } from "./funnel-analytics.js";
import { escapeHtml } from "./escape-html.js";

const COMPARE_FIELDS = [
  // [snake_case, camelCase, human-readable label]
  ["name", "name", "Name"],
  ["email", "email", "Email"],
  ["phone", "phone", "Phone"],
  ["website", "website", "Website"],
  ["license_state", "licenseState", "License state"],
  ["license_number", "licenseNumber", "License number"],
  ["city", "city", "City"],
  ["zip", "zip", "ZIP"],
  ["specialties", "specialties", "Specialties"],
  ["source_url", "sourceUrl", "Source URL"],
];

let _backdropEl = null;
let _therapist = null;
let _counterpartKind = null; // "candidate" | "therapist"
let _counterpart = null;
let _onResolved = null;

function read(doc, snake, camel) {
  if (!doc) return undefined;
  if (doc[snake] !== undefined) return doc[snake];
  return doc[camel];
}

function fieldDisplay(value) {
  if (value === null || value === undefined || value === "") {
    return { html: "(empty)", isEmpty: true };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { html: "(empty)", isEmpty: true };
    return { html: escapeHtml(value.join(", ")), isEmpty: false };
  }
  return { html: escapeHtml(String(value)), isEmpty: false };
}

function valuesEqualish(a, b) {
  // Lightweight equality for the compare highlight: arrays as sorted
  // joined strings, primitives as trim+lowercase. Good enough to flag
  // "different here" without being pedantic about whitespace or order.
  const norm = (v) => {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v))
      return v
        .map((x) =>
          String(x || "")
            .trim()
            .toLowerCase(),
        )
        .sort()
        .join("|");
    return String(v).trim().toLowerCase();
  };
  return norm(a) === norm(b);
}

function renderGrid() {
  const grid = document.getElementById("resolveDuplicateGrid");
  if (!grid) return;
  const therapistLabel = "Live therapist";
  const counterpartLabel = _counterpartKind === "therapist" ? "Other therapist" : "Candidate";

  let html =
    '<div class="resolve-dup-grid-head">' +
    escapeHtml(therapistLabel) +
    "</div>" +
    '<div class="resolve-dup-grid-head">' +
    escapeHtml(counterpartLabel) +
    "</div>";

  for (const [snake, camel, label] of COMPARE_FIELDS) {
    const a = read(_therapist, snake, camel);
    const b = read(_counterpart, snake, camel);
    const aDisp = fieldDisplay(a);
    const bDisp = fieldDisplay(b);
    const mismatch = !valuesEqualish(a, b);
    const cellClass = (disp) =>
      "resolve-dup-cell" + (disp.isEmpty ? " is-empty" : "") + (mismatch ? " is-mismatch" : "");
    html +=
      '<div class="resolve-dup-row-label">' +
      escapeHtml(label) +
      "</div>" +
      '<div class="' +
      cellClass(aDisp) +
      '">' +
      aDisp.html +
      "</div>" +
      '<div class="' +
      cellClass(bDisp) +
      '">' +
      bDisp.html +
      "</div>";
  }
  grid.innerHTML = html;
}

function setStatus(message, type) {
  const el = document.getElementById("resolveDuplicateStatus");
  if (!el) return;
  el.textContent = message || "";
  el.className = "resolve-dup-status" + (type === "error" ? " is-error" : "");
}

function setButtonsDisabled(disabled) {
  const ids = ["resolveDuplicateMergeBtn", "resolveDuplicateNotDupBtn"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  }
}

function configureButtonsForCounterpart() {
  const mergeBtn = document.getElementById("resolveDuplicateMergeBtn");
  const notDupBtn = document.getElementById("resolveDuplicateNotDupBtn");
  if (!mergeBtn || !notDupBtn) return;
  if (_counterpartKind === "candidate") {
    // Merge action only makes sense when we can hand the candidate to the
    // existing merge_to_therapist server flow.
    mergeBtn.removeAttribute("hidden");
    notDupBtn.removeAttribute("hidden");
  } else {
    // Therapist-vs-therapist duplicate: merge is still risky and stays
    // disabled, but the admin can mark "not a duplicate" when two live
    // records intentionally share an email (e.g. clinicians at the same
    // group practice with one inbox). The handler patches dedupeOverrides
    // on both sides; the duplicate detector then suppresses the warning.
    mergeBtn.setAttribute("hidden", "");
    notDupBtn.removeAttribute("hidden");
  }
}

function close() {
  if (!_backdropEl) return;
  _backdropEl.classList.remove("is-open");
  _therapist = null;
  _counterpart = null;
  _counterpartKind = null;
  setStatus("");
  setButtonsDisabled(false);
}

async function handleMerge() {
  if (_counterpartKind !== "candidate" || !_counterpart || !_therapist) return;
  const candidateId = _counterpart.id || _counterpart._id;
  const therapistId = _therapist.id || _therapist._id;
  if (!candidateId || !therapistId) {
    setStatus("Missing record id; cannot merge.", "error");
    return;
  }
  setButtonsDisabled(true);
  setStatus("Merging…");
  try {
    // The merge_to_therapist decision requires matchedTherapistId on the
    // candidate to point at the target therapist. Older candidate records
    // sometimes have it empty or pointing elsewhere; PATCH first to make
    // sure the server can act, then call the decision endpoint.
    const currentMatch = read(_counterpart, "matched_therapist_id", "matchedTherapistId");
    if (currentMatch !== therapistId) {
      await updateTherapistCandidate(candidateId, {
        matched_therapist_id: therapistId,
      });
    }
    await decideTherapistCandidate(candidateId, {
      decision: "merge_to_therapist",
      notes: "Merged via Resolve Duplicate workflow",
    });
    trackFunnelEvent("admin_duplicate_resolved", {
      action: "merge_to_therapist",
      therapist_id: therapistId,
      candidate_id: candidateId,
    });
    setStatus("Merged. Reloading…");
    if (typeof _onResolved === "function") _onResolved();
    window.setTimeout(close, 600);
  } catch (err) {
    setStatus("Merge failed: " + (err && err.message ? err.message : "try again"), "error");
    setButtonsDisabled(false);
  }
}

async function handleMarkNotDuplicate() {
  if (!_counterpart) return;

  if (_counterpartKind === "therapist") {
    return handleMarkNotDuplicateTherapist();
  }

  const candidateId = _counterpart.id || _counterpart._id;
  if (!candidateId) {
    setStatus("Missing candidate id.", "error");
    return;
  }
  // Confirm, this is irreversible from the UI today.
  const confirmed = window.confirm(
    "Mark this candidate as NOT a duplicate? It will stop triggering the duplicate detector. Use only if you've verified these are different people.",
  );
  if (!confirmed) return;

  setButtonsDisabled(true);
  setStatus("Saving…");
  try {
    // "unique" is the system-wide status for a verified not-a-duplicate
    // (what the mark_unique decision writes); rejected_duplicate means the
    // opposite — an admin confirmed the candidate IS a duplicate.
    await updateTherapistCandidate(candidateId, {
      dedupe_status: "unique",
      notes:
        (read(_counterpart, "notes", "notes") || "") +
        (read(_counterpart, "notes", "notes") ? "\n" : "") +
        "[" +
        new Date().toISOString().slice(0, 10) +
        "] Marked as not-a-duplicate via Resolve Duplicate workflow.",
    });
    trackFunnelEvent("admin_duplicate_resolved", {
      action: "mark_unique",
      candidate_id: candidateId,
    });
    setStatus("Marked. Reloading…");
    if (typeof _onResolved === "function") _onResolved();
    window.setTimeout(close, 600);
  } catch (err) {
    setStatus("Save failed: " + (err && err.message ? err.message : "try again"), "error");
    setButtonsDisabled(false);
  }
}

// Therapist-vs-therapist override: patch dedupeOverrides on BOTH records so
// either side appearing first in the detector's loop suppresses the warning.
// The detector is also lenient (one side declaring is enough), but writing
// both keeps the data symmetric.
async function handleMarkNotDuplicateTherapist() {
  const therapistId = _therapist && (_therapist.id || _therapist._id);
  const otherId = _counterpart && (_counterpart.id || _counterpart._id);
  if (!therapistId || !otherId) {
    setStatus("Missing therapist id on one side.", "error");
    return;
  }

  const confirmed = window.confirm(
    "Mark these two therapists as NOT duplicates of each other? The duplicate warning will stop showing for this pair. Use only when both records are intentionally distinct (e.g. two clinicians at a group practice sharing one inbox).",
  );
  if (!confirmed) return;

  setButtonsDisabled(true);
  setStatus("Saving…");

  function withAdded(list, id) {
    const arr = Array.isArray(list) ? list.slice() : [];
    if (!arr.includes(id)) arr.push(id);
    return arr;
  }

  try {
    const therapistOverrides = withAdded(
      read(_therapist, "dedupe_overrides", "dedupeOverrides"),
      otherId,
    );
    const otherOverrides = withAdded(
      read(_counterpart, "dedupe_overrides", "dedupeOverrides"),
      therapistId,
    );
    await Promise.all([
      updateTherapist(therapistId, { dedupeOverrides: therapistOverrides }),
      updateTherapist(otherId, { dedupeOverrides: otherOverrides }),
    ]);
    trackFunnelEvent("admin_duplicate_resolved", {
      action: "therapist_override",
      therapist_id: therapistId,
      counterpart_id: otherId,
    });
    setStatus("Marked. Reloading…");
    if (typeof _onResolved === "function") _onResolved();
    window.setTimeout(close, 600);
  } catch (err) {
    setStatus("Save failed: " + (err && err.message ? err.message : "try again"), "error");
    setButtonsDisabled(false);
  }
}

export function openResolveDuplicate({ therapist, counterpart, counterpartKind, onResolved }) {
  if (!_backdropEl) _backdropEl = document.getElementById("resolveDuplicateBackdrop");
  if (!_backdropEl) return;
  _therapist = therapist;
  _counterpart = counterpart;
  _counterpartKind = counterpartKind === "therapist" ? "therapist" : "candidate";
  _onResolved = onResolved || null;

  const subtitle = document.getElementById("resolveDuplicateSubtitle");
  if (subtitle) {
    subtitle.textContent =
      _counterpartKind === "therapist"
        ? "Two therapist documents share an identifier. If they're intentionally distinct (e.g. shared group-practice inbox), use 'Mark as not duplicate' below, it patches both records so the warning stops."
        : "Compare the two records below, then pick the action that matches.";
  }

  configureButtonsForCounterpart();
  renderGrid();
  setStatus("");
  setButtonsDisabled(false);
  _backdropEl.classList.add("is-open");
  trackFunnelEvent("admin_duplicate_resolve_opened", {
    therapist_id: therapist && (therapist.id || therapist._id),
    counterpart_id: counterpart && (counterpart.id || counterpart._id),
    counterpart_kind: _counterpartKind,
  });
}

export function bindResolveDuplicate() {
  if (!_backdropEl) _backdropEl = document.getElementById("resolveDuplicateBackdrop");
  if (!_backdropEl) return;

  // Close on backdrop click (but not when clicking the panel itself).
  _backdropEl.addEventListener("click", function (e) {
    if (e.target === _backdropEl) close();
  });
  const closeBtn = document.getElementById("resolveDuplicateCloseBtn");
  if (closeBtn) closeBtn.addEventListener("click", close);

  const mergeBtn = document.getElementById("resolveDuplicateMergeBtn");
  if (mergeBtn) mergeBtn.addEventListener("click", handleMerge);
  const notDupBtn = document.getElementById("resolveDuplicateNotDupBtn");
  if (notDupBtn) notDupBtn.addEventListener("click", handleMarkNotDuplicate);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && _backdropEl.classList.contains("is-open")) close();
  });
}
