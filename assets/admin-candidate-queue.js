import {
  bindCandidateDecisionButtons,
  renderCandidateMergePreview,
  renderCandidateMergeWorkbench,
  renderCandidatePublishPacket,
  renderCandidateTrustChips,
} from "./admin-candidate-review.js";

import { createActionFlashStore } from "./admin-action-flash.js";

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
      return "Deleted.";
    case "reject_duplicate":
      return "Marked as duplicate.";
    default:
      return "Done.";
  }
}

function renderCandidateCardHtml(item, index, options, therapists, applications) {
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
  const isPossibleDuplicate = item.dedupe_status === "possible_duplicate";
  const mergeWorkbench = renderCandidateMergeWorkbench(item, {
    therapists: therapists,
    applications: applications,
    escapeHtml: options.escapeHtml,
  });
  const mergePreview = renderCandidateMergePreview(item, {
    therapists: therapists,
    applications: applications,
    escapeHtml: options.escapeHtml,
  });
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
    }) +
    mergeWorkbench +
    mergePreview;

  const duplicateMatchLabel = isPossibleDuplicate
    ? item.matched_therapist_slug || item.matched_application_id || item.matched_therapist_id || ""
    : "";
  const duplicateBanner = isPossibleDuplicate
    ? '<div class="queue-duplicate-banner"><span class="queue-duplicate-banner-icon">\u26A0</span><span>Possible duplicate' +
      (duplicateMatchLabel
        ? " of <strong>" + options.escapeHtml(duplicateMatchLabel) + "</strong>"
        : "") +
      ". Check the match before publishing.</span></div>"
    : "";

  // Primary three actions, identical on every card
  const primaryActions =
    '<button class="btn-primary" data-candidate-decision="' +
    options.escapeHtml(item.id) +
    '" data-candidate-next="publish">Publish</button>' +
    '<button class="btn-secondary" data-candidate-decision="' +
    options.escapeHtml(item.id) +
    '" data-candidate-next="needs_review">Send to Review</button>' +
    '<button class="btn-danger-quiet" data-candidate-decision="' +
    options.escapeHtml(item.id) +
    '" data-candidate-confirm="Delete this listing? This archives it and removes it from the queue." data-candidate-next="archive">Delete</button>';

  // Conditional duplicate action — only when a duplicate has been flagged
  const duplicateAction = isPossibleDuplicate
    ? '<div class="queue-duplicate-action"><button class="btn-secondary" data-candidate-decision="' +
      options.escapeHtml(item.id) +
      '" data-candidate-next="reject_duplicate">Mark as duplicate</button></div>'
    : "";

  // Secondary link row — open source, edit profile, see full details
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
    (expandedDetails
      ? '<button type="button" data-queue-card-toggle-details="' +
        options.escapeHtml(item.id) +
        '">See full details</button>'
      : "") +
    "</div>";

  return (
    '<article class="queue-card' +
    (index === 0 ? " is-start-here" : "") +
    '"' +
    (actionFlash ? ' data-has-action-flash="true"' : "") +
    ' data-candidate-card-id="' +
    options.escapeHtml(item.id) +
    '"' +
    (index === 0 ? ' id="candidateQueueStartHere"' : "") +
    ">" +
    // Header: name + status tags
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
    // Primary action row
    '<div class="action-row" style="margin-top:0.75rem;gap:0.5rem;flex-wrap:wrap">' +
    primaryActions +
    "</div>" +
    duplicateAction +
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
        '"><summary>See full details</summary><div class="queue-more-details-body">' +
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
      const id = button.getAttribute("data-queue-card-toggle-details");
      if (!id) {
        return;
      }
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
    if (filters.review_status && item.review_status !== filters.review_status) {
      return false;
    }
    if (filters.dedupe_status && item.dedupe_status !== filters.dedupe_status) {
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

  if (!candidates.length) {
    root.innerHTML =
      '<div class="empty">No new therapist listings have been added yet. Run the discovery or import workflow and they will appear here.</div>';
    return;
  }

  const recentFlashes = getRecentCandidateActionFlashes(candidates, 3);
  const firstFiltered = filtered.length ? filtered[0] : null;
  const remainingFiltered = filtered.length > 1 ? filtered.slice(1) : [];

  root.innerHTML =
    (firstFiltered
      ? renderCandidateCardHtml(firstFiltered, 0, options, therapists, applications)
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
    (filtered.length ? "" : '<div class="empty">No new listings match the current filters.</div>') +
    remainingFiltered
      .map(function (item, index) {
        return renderCandidateCardHtml(item, index + 1, options, therapists, applications);
      })
      .join("");

  bindCandidateDecisionButtons(root, {
    decideTherapistCandidate: options.decideTherapistCandidate,
    onDecisionComplete: function (id, decision) {
      setCandidateActionFlash(id, getCandidateDecisionOutcome(decision));
    },
    loadData: options.loadData,
  });
  bindQueueCardDetailToggles(root);
}
