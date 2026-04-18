import {
  bindCandidateDecisionButtons,
  findCandidateMergeTarget,
  renderCandidatePublishPacket,
  renderCandidateTrustChips,
} from "./admin-candidate-review.js";

import { createActionFlashStore } from "./admin-action-flash.js";
import { createCandidateCompareModal } from "./admin-candidate-compare-modal.js";
import { reapplyFocusAfterRender, toggleFocusMode } from "./admin-triage-focus.js";

export { toggleFocusMode as toggleTriageFocusMode } from "./admin-triage-focus.js";

let sharedCompareModal = null;

function getSharedCompareModal(options) {
  if (sharedCompareModal) {
    return sharedCompareModal;
  }
  sharedCompareModal = createCandidateCompareModal(options);
  return sharedCompareModal;
}

function clearStaleWorkflowFocus(queueRoot) {
  if (!queueRoot) {
    return;
  }
  const grid = queueRoot.closest(".grid");
  if (!grid || !grid.classList.contains("workflow-focus-active")) {
    return;
  }
  // If there is no focus target anywhere in the grid, the focus mode is
  // stale from a prior navigation and should not keep dimming cards.
  if (!grid.querySelector(".workflow-focus-target")) {
    grid.classList.remove("workflow-focus-active");
    grid.querySelectorAll(".workflow-focus-owner").forEach(function (node) {
      node.classList.remove("workflow-focus-owner");
    });
  }
}

const candidateActionFlash = createActionFlashStore();

function setCandidateActionFlash(id, message) {
  candidateActionFlash.set(id, message);
}

function getCandidateActionFlash(id) {
  return candidateActionFlash.get(id);
}

function getRecentCandidateActionFlashes(candidates, limit) {
  const list = Array.isArray(candidates) ? candidates : [];
  return candidateActionFlash.getRecent(limit, function (entry) {
    const item = list.find(function (candidate) {
      return String(candidate.id) === String(entry.id);
    });
    return {
      id: entry.id,
      name: item && item.name ? item.name : entry.id,
      message: entry.message,
      createdAt: entry.createdAt,
    };
  });
}

function getCandidateDecisionOutcome(decision) {
  switch (decision) {
    case "publish":
      return "Published.";
    case "needs_review":
      return "Sent to review.";
    case "archive":
      return "Archived.";
    case "reject_duplicate":
      return "Marked as duplicate.";
    case "mark_unique":
      return "Confirmed as unique.";
    default:
      return "Done.";
  }
}

function getDedupeReasonLabel(reason) {
  switch (reason) {
    case "license":
      return "License number match";
    case "email":
      return "Email match";
    case "website":
      return "Website match";
    case "name_location_phone":
      return "Name + location + phone match";
    case "name_location":
      return "Name + location match";
    case "slug":
      return "Slug match";
    case "provider_id":
      return "Provider ID match";
    default:
      return reason;
  }
}

function renderCandidateCardHtml(item, index, options, therapists, applications, candidates, mode) {
  const isReviewMode = mode === "review";
  const location = [item.city, item.state, item.zip]
    .filter(Boolean)
    .join(", ")
    .replace(/, (?=\d{5}$)/, " ");
  const sourceReference = options.getSourceReferenceMeta
    ? options.getSourceReferenceMeta(item)
    : {
        href: item.source_url || "",
        label: item.source_url ? "Open original source" : "No source page available",
        shortLabel: item.source_url ? "Open source" : "No source page",
      };
  const trustSummary = options.getCandidateTrustSummary(item);
  const publishPacket = options.getCandidatePublishPacket(item, trustSummary);
  const reviewEvents = options.getReviewEventsForCandidate(item);
  const actionFlash = getCandidateActionFlash(item.id);
  const isDefiniteDuplicate = item.dedupe_status === "definite_duplicate";
  const isPossibleDuplicate = item.dedupe_status === "possible_duplicate";
  const isDuplicateFlagged = isDefiniteDuplicate || isPossibleDuplicate;
  const hasMergeTarget = !!findCandidateMergeTarget(item, {
    therapists: therapists,
    applications: applications,
    candidates: candidates,
  });
  const dedupeReasons = Array.isArray(item.dedupe_reasons) ? item.dedupe_reasons : [];
  const dedupeReasonChipsHtml =
    isDuplicateFlagged && dedupeReasons.length
      ? '<div class="queue-dedupe-reasons">' +
        dedupeReasons
          .map(function (reason) {
            return (
              '<span class="queue-dedupe-reason-chip' +
              (isDefiniteDuplicate ? " is-definite" : "") +
              '">' +
              options.escapeHtml(getDedupeReasonLabel(reason)) +
              "</span>"
            );
          })
          .join("") +
        "</div>"
      : "";
  const expandedDetails =
    renderCandidatePublishPacket(publishPacket, {
      escapeHtml: options.escapeHtml,
    }) +
    (item.matched_therapist_slug || item.matched_application_id
      ? '<div class="queue-summary"><strong>Possible existing match:</strong> ' +
        options.escapeHtml(
          item.matched_therapist_slug ||
            item.matched_application_id ||
            item.matched_therapist_id ||
            "",
        ) +
        "</div>"
      : "") +
    (item.notes
      ? '<div class="queue-summary"><strong>Notes:</strong> ' +
        options.escapeHtml(item.notes) +
        "</div>"
      : "") +
    options.renderReviewEventSnippetHtml(reviewEvents, {
      escapeHtml: options.escapeHtml,
      formatDate: options.formatDate,
    }) +
    options.renderReviewEventTimelineHtml(reviewEvents, {
      escapeHtml: options.escapeHtml,
      formatDate: options.formatDate,
    }) +
    renderCandidateTrustChips(trustSummary, 4, {
      escapeHtml: options.escapeHtml,
    });

  const matchedLabel = item.matched_therapist_slug || item.matched_application_id || "";
  const duplicateBanner = isDuplicateFlagged
    ? '<div class="queue-duplicate-banner' +
      (isDefiniteDuplicate ? " is-definite" : "") +
      '"><span class="queue-duplicate-banner-icon">\u26A0</span><span>' +
      (isDefiniteDuplicate ? "Definite duplicate" : "Possible duplicate") +
      (matchedLabel ? " of <strong>" + options.escapeHtml(matchedLabel) + "</strong>" : "") +
      ". Check the match before publishing.</span></div>"
    : "";

  // Primary actions — review mode drops "Needs more work" since the card is already parked there
  const primaryActions = isReviewMode
    ? '<button class="btn-primary" data-candidate-decision="' +
      options.escapeHtml(item.id) +
      '" data-candidate-next="publish">Publish</button>' +
      '<button class="btn-danger-quiet" data-candidate-decision="' +
      options.escapeHtml(item.id) +
      '" data-candidate-confirm="Archive this listing? It will be removed from the queue." data-candidate-next="archive">Archive</button>'
    : '<button class="btn-primary" data-candidate-decision="' +
      options.escapeHtml(item.id) +
      '" data-candidate-next="publish">Publish</button>' +
      '<button class="btn-secondary" data-candidate-decision="' +
      options.escapeHtml(item.id) +
      '" data-candidate-next="needs_review">Needs more work</button>' +
      '<button class="btn-danger-quiet" data-candidate-decision="' +
      options.escapeHtml(item.id) +
      '" data-candidate-confirm="Archive this listing? It will be removed from the queue." data-candidate-next="archive">Archive</button>';

  // Conditional duplicate action row — only when a duplicate has been flagged
  const duplicateActions = isDuplicateFlagged
    ? '<div class="queue-duplicate-action">' +
      '<button class="btn-secondary" data-candidate-compare="' +
      options.escapeHtml(item.id) +
      '">Compare</button>' +
      '<button class="btn-secondary" data-candidate-decision="' +
      options.escapeHtml(item.id) +
      '" data-candidate-next="mark_unique">Not a duplicate</button>' +
      '<button class="btn-secondary" data-candidate-decision="' +
      options.escapeHtml(item.id) +
      '" data-candidate-next="reject_duplicate">Is a duplicate</button>' +
      "</div>"
    : "";

  // Secondary link row — de-emphasized tools. In review mode the details are
  // already open so we drop the "See full details" toggle.
  const linkRow =
    '<div class="queue-card-links">' +
    (sourceReference.href
      ? '<a href="' +
        options.escapeHtml(sourceReference.href) +
        '" target="_blank" rel="noopener">Open source</a>'
      : "") +
    '<button type="button" data-edit-candidate-id="' +
    options.escapeHtml(item.id) +
    '">Edit profile</button>' +
    (hasMergeTarget && !isDuplicateFlagged
      ? '<button type="button" data-candidate-compare="' +
        options.escapeHtml(item.id) +
        '">Compare possible match</button>'
      : "") +
    (expandedDetails && !isReviewMode
      ? '<button type="button" data-queue-card-toggle-details="' +
        options.escapeHtml(item.id) +
        '">See full details</button>'
      : "") +
    "</div>";

  return (
    '<article class="queue-card' +
    (index === 0 ? " is-start-here" : "") +
    (isReviewMode ? " is-review-mode" : "") +
    '"' +
    (actionFlash ? ' data-has-action-flash="true"' : "") +
    ' data-candidate-card-id="' +
    options.escapeHtml(item.id) +
    '"' +
    (index === 0 ? ' id="candidateQueueStartHere"' : "") +
    ">" +
    // Header: name + status tag
    '<div class="queue-head"><div><h3 style="display:flex;align-items:baseline;gap:0.55rem;flex-wrap:wrap">' +
    options.escapeHtml(item.name || "Unnamed listing") +
    (item.readiness_score != null
      ? '<span style="font-size:0.75rem;font-weight:700;padding:0.18rem 0.5rem;border-radius:999px;white-space:nowrap;background:' +
        (item.readiness_score >= 81
          ? "rgba(22,163,74,0.12);color:#16a34a"
          : item.readiness_score >= 61
            ? "rgba(217,119,6,0.12);color:#d97706"
            : "rgba(220,38,38,0.11);color:#dc2626") +
        '">Readiness: ' +
        options.escapeHtml(String(item.readiness_score)) +
        "/100</span>"
      : "") +
    "</h3>" +
    '<div class="subtle">' +
    options.escapeHtml([item.credentials, location].filter(Boolean).join(" · ")) +
    '</div></div><div class="queue-head-actions"><span class="tag">' +
    options.escapeHtml(options.getCandidateReviewChipLabel(item.review_status)) +
    "</span></div></div>" +
    duplicateBanner +
    dedupeReasonChipsHtml +
    // Primary action row
    '<div class="action-row" style="margin-top:0.75rem;gap:0.5rem;flex-wrap:wrap">' +
    primaryActions +
    "</div>" +
    duplicateActions +
    linkRow +
    // Status feedback
    '<div class="review-coach-status" data-candidate-status-id="' +
    options.escapeHtml(item.id) +
    '">' +
    options.escapeHtml(actionFlash) +
    "</div>" +
    // Collapsed details
    (expandedDetails
      ? '<details class="queue-more-details" data-queue-card-details-id="' +
        options.escapeHtml(item.id) +
        '"' +
        (isReviewMode ? " open" : "") +
        "><summary>" +
        (isReviewMode ? "Hide details" : "See full details") +
        '</summary><div class="queue-more-details-body">' +
        expandedDetails +
        "</div></details>"
      : "") +
    "</article>"
  );
}

function bindQueueCardDetailToggles(root) {
  if (!root) {
    return;
  }
  root.querySelectorAll("[data-queue-card-toggle-details]").forEach(function (button) {
    button.addEventListener("click", function () {
      const card = button.closest("[data-candidate-card-id]");
      const details = card ? card.querySelector("[data-queue-card-details-id]") : null;
      if (details) {
        details.open = !details.open;
        if (details.open) {
          details.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }
    });
  });
}

export function renderCandidateQueuePanel(options) {
  const root = options.root;
  const countEl = options.countEl;
  if (!root || !countEl) {
    return;
  }

  if (options.authRequired) {
    root.innerHTML = "";
    countEl.textContent = "";
    return;
  }

  const candidates = Array.isArray(options.candidates) ? options.candidates : [];
  const therapists = Array.isArray(options.therapists) ? options.therapists : [];
  const applications = Array.isArray(options.applications) ? options.applications : [];
  const filters = options.filters || {};
  const mode = options.mode === "review" ? "review" : "triage";

  const filtered = candidates.filter(function (item) {
    const haystack = [
      item.name,
      item.city,
      item.state,
      item.credentials,
      item.practice_name,
      item.website,
      item.source_type,
    ]
      .concat(item.specialties || [])
      .join(" ")
      .toLowerCase();

    if (filters.q && !haystack.includes(filters.q.toLowerCase())) {
      return false;
    }
    if (mode === "review") {
      // Review bay shows only parked listings. Review-status filter is ignored here.
      if (item.review_status !== "needs_review") {
        return false;
      }
      if (filters.dedupe_status && item.dedupe_status !== filters.dedupe_status) {
        return false;
      }
      return true;
    }
    // Triage mode: hide archived, published, and parked review items by default.
    const INACTIVE_REVIEW = ["archived", "published", "needs_review"];
    const INACTIVE_DEDUPE = ["rejected_duplicate", "merged"];
    if (filters.review_status) {
      if (item.review_status !== filters.review_status) return false;
    } else if (INACTIVE_REVIEW.includes(item.review_status)) {
      return false;
    }
    if (filters.dedupe_status) {
      if (item.dedupe_status !== filters.dedupe_status) return false;
    } else if (INACTIVE_DEDUPE.includes(item.dedupe_status)) {
      return false;
    }
    return true;
  });

  countEl.textContent =
    filtered.length +
    " of " +
    candidates.length +
    " listing" +
    (candidates.length === 1 ? "" : "s");

  if (mode === "review" && !filtered.length) {
    root.innerHTML =
      '<div class="empty">Nothing parked in review. Send a listing here from Triage when it needs more investigation before publishing.</div>';
    return;
  }

  if (!candidates.length) {
    root.innerHTML =
      '<div class="empty">No new therapist listings have been added yet. Run the discovery or import workflow and they will appear here.</div>';
    return;
  }

  const recentFlashes = mode === "review" ? [] : getRecentCandidateActionFlashes(candidates, 3);
  const firstFiltered = filtered.length ? filtered[0] : null;
  const remainingFiltered = filtered.length > 1 ? filtered.slice(1) : [];

  root.innerHTML =
    (firstFiltered
      ? renderCandidateCardHtml(
          firstFiltered,
          0,
          options,
          therapists,
          applications,
          candidates,
          mode,
        )
      : "") +
    (recentFlashes.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Done Recently</div><div class="queue-insights-grid">' +
        recentFlashes
          .map(function (entry) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
              options.escapeHtml(entry.name) +
              '</strong></div><div class="queue-insight-note">' +
              options.escapeHtml(entry.message) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    (filtered.length ? "" : '<div class="empty">No listings match the current filters.</div>') +
    remainingFiltered
      .map(function (item, index) {
        return renderCandidateCardHtml(
          item,
          index + 1,
          options,
          therapists,
          applications,
          candidates,
          mode,
        );
      })
      .join("");

  // Self-heal any stuck workflow-focus-active state. Focus mode is applied
  // when the user jumps into this section from the landing priority row; once
  // the original focus target is gone (after a decision + re-render), the
  // grid should not keep dimming fresh cards.
  clearStaleWorkflowFocus(root);

  bindCandidateDecisionButtons(root, {
    decideTherapistCandidate: options.decideTherapistCandidate,
    onDecisionComplete: function (id, decision) {
      setCandidateActionFlash(id, getCandidateDecisionOutcome(decision));
    },
    loadData: options.loadData,
  });
  bindQueueCardDetailToggles(root);

  const compareModal = getSharedCompareModal({
    decideTherapistCandidate: options.decideTherapistCandidate,
    loadData: options.loadData,
    escapeHtml: options.escapeHtml,
    getQueueRoot: function () {
      return root;
    },
    onDecisionComplete: function (id, decision) {
      setCandidateActionFlash(id, getCandidateDecisionOutcome(decision));
    },
  });

  root.querySelectorAll("[data-candidate-compare]").forEach(function (button) {
    button.addEventListener("click", function () {
      const id = button.getAttribute("data-candidate-compare");
      const item = candidates.find(function (entry) {
        return String(entry.id) === String(id);
      });
      if (!item) return;
      const matchTarget = findCandidateMergeTarget(item, {
        therapists: therapists,
        applications: applications,
        candidates: candidates,
      });
      compareModal.open(item, matchTarget, item.dedupe_reasons || [], button);
    });
  });

  // If focus mode was active before this re-render (e.g. after a decision),
  // restore the HUD and re-select the same position so keyboard flow survives
  // data reloads.
  reapplyFocusAfterRender(root);
}
