import {
  bindCandidateDecisionButtons,
  findCandidateMergeTarget,
  renderCandidateMergePreview,
  renderCandidateMergeWorkbench,
  renderCandidatePublishPacket,
  renderCandidateTrustChips,
} from "./admin-candidate-review.js";

import { createActionFlashStore } from "./admin-action-flash.js";
import { createCandidateCompareModal } from "./admin-candidate-compare-modal.js";

let sharedCompareModal = null;

function getSharedCompareModal(options) {
  if (sharedCompareModal) {
    return sharedCompareModal;
  }
  sharedCompareModal = createCandidateCompareModal(options);
  return sharedCompareModal;
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
    case "needs_confirmation":
      return "Sent to confirmation.";
    case "reject_duplicate":
      return "Marked as duplicate.";
    case "mark_unique":
      return "Confirmed as unique.";
    case "merge":
      return "Merged.";
    case "archive":
      return "Archived.";
    case "mark_ready":
      return "Queued for publish.";
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

function getCandidateStartHereGuidance(item) {
  if (!item) {
    return {
      primaryAction: "mark_ready",
      primaryLabel: "Queue for publish",
      whyNow: "This is the top current new listing in the filtered view.",
      doneWhen: "This listing has a clear next state and is no longer sitting in unworked review.",
    };
  }

  if (item.dedupe_status === "definite_duplicate") {
    const matchedName =
      item.matched_therapist_slug || item.matched_application_id || "an existing record";
    return {
      primaryAction: "reject_duplicate",
      primaryLabel: "Mark as duplicate",
      whyNow:
        "License number and name both match " + matchedName + ", so this is the same provider.",
      doneWhen: "The listing is marked duplicate or merged into the matched record.",
    };
  }

  if (item.dedupe_status === "possible_duplicate") {
    const matchedLabel =
      item.matched_therapist_slug || item.matched_application_id || "the possible match";
    return {
      primaryAction: "compare_match",
      primaryLabel: "Compare with " + matchedLabel,
      whyNow:
        "Some identity signals match an existing record but it is not verified. Look before deciding.",
      doneWhen: "The listing is confirmed unique, marked duplicate, or merged.",
    };
  }

  if (
    item.review_status === "needs_confirmation" ||
    item.review_lane === "needs_confirmation" ||
    item.publish_recommendation === "needs_confirmation"
  ) {
    return {
      primaryAction: "needs_confirmation",
      primaryLabel: "Send to confirmation now",
      whyNow:
        "This listing looks promising but still needs one more trust pass before it is safe to publish.",
      doneWhen:
        "The listing is clearly moved into confirmation follow-up instead of staying in ambiguous review.",
    };
  }

  if (item.review_status === "ready_to_publish" || item.review_lane === "publish_now") {
    return {
      primaryAction: "publish",
      primaryLabel: "Publish now",
      whyNow: "This is a strong publish-ready listing and the fastest way to add trusted supply.",
      doneWhen:
        "The listing is published or moved out of publish-ready with a clear reason recorded.",
    };
  }

  return {
    primaryAction: "mark_ready",
    primaryLabel: "Queue for publish",
    whyNow:
      "This listing appears unique enough to move forward, even if you are not publishing it immediately.",
    doneWhen:
      "The listing is moved into the right next state: publish-ready, confirmation, duplicate, merge, or archive.",
  };
}

function buildCandidateButton(itemId, action, label, isPrimary) {
  return (
    '<button class="' +
    (isPrimary ? "btn-primary" : "btn-secondary") +
    '" data-candidate-decision="' +
    itemId +
    '" data-candidate-next="' +
    action +
    '">' +
    label +
    "</button>"
  );
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
  const startHereGuidance = getCandidateStartHereGuidance(item);
  const actionFlash = getCandidateActionFlash(item.id);
  const mergeWorkbenchHtml = renderCandidateMergeWorkbench(item, {
    therapists: therapists,
    applications: applications,
    escapeHtml: options.escapeHtml,
  });
  const mergeWorkbench = mergeWorkbenchHtml
    ? '<div data-candidate-merge-workbench="' +
      options.escapeHtml(item.id) +
      '">' +
      mergeWorkbenchHtml +
      "</div>"
    : "";
  const mergePreview = renderCandidateMergePreview(item, {
    therapists: therapists,
    applications: applications,
    escapeHtml: options.escapeHtml,
  });
  const dedupeReasons = Array.isArray(item.dedupe_reasons) ? item.dedupe_reasons : [];
  const dedupeReasonChipsHtml = dedupeReasons.length
    ? '<div class="queue-dedupe-reasons" style="margin-top:0.5rem;display:flex;gap:0.35rem;flex-wrap:wrap">' +
      dedupeReasons
        .map(function (reason) {
          return (
            '<span class="tag" style="background:' +
            (item.dedupe_status === "definite_duplicate"
              ? "rgba(194,65,12,0.12);color:#c2410c"
              : "rgba(217,119,6,0.12);color:#d97706") +
            ';font-size:0.72rem">' +
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
    }) +
    mergeWorkbench +
    mergePreview;

  // Fallback actions (exclude the primary)
  var fallbackBtns = [];
  if (
    startHereGuidance.primaryAction !== "mark_ready" &&
    item.review_status !== "ready_to_publish"
  ) {
    fallbackBtns.push(buildCandidateButton(item.id, "mark_ready", "Queue for publish", false));
  }
  if (
    startHereGuidance.primaryAction !== "needs_confirmation" &&
    item.review_status !== "needs_confirmation"
  ) {
    fallbackBtns.push(
      buildCandidateButton(item.id, "needs_confirmation", "Send to confirmation", false),
    );
  }
  if (
    startHereGuidance.primaryAction !== "reject_duplicate" &&
    item.dedupe_status !== "rejected_duplicate"
  ) {
    fallbackBtns.push(
      buildCandidateButton(item.id, "reject_duplicate", "Mark as duplicate", false),
    );
  }
  const isDuplicateFlagged =
    item.dedupe_status === "possible_duplicate" || item.dedupe_status === "definite_duplicate";
  if (isDuplicateFlagged) {
    fallbackBtns.push(buildCandidateButton(item.id, "mark_unique", "Keep as unique", false));
  }
  if (startHereGuidance.primaryAction !== "publish") {
    fallbackBtns.push(buildCandidateButton(item.id, "publish", "Publish now", false));
  }

  const primaryButtonHtml =
    startHereGuidance.primaryAction === "compare_match"
      ? '<button class="btn-primary" data-candidate-compare="' +
        options.escapeHtml(item.id) +
        '">' +
        options.escapeHtml(startHereGuidance.primaryLabel) +
        "</button>"
      : '<button class="btn-primary" data-candidate-decision="' +
        options.escapeHtml(item.id) +
        '" data-candidate-next="' +
        options.escapeHtml(startHereGuidance.primaryAction) +
        '">' +
        options.escapeHtml(startHereGuidance.primaryLabel) +
        "</button>";

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
    '</span><span class="tag">' +
    options.escapeHtml(options.getCandidateDedupeChipLabel(item.dedupe_status)) +
    "</span></div></div>" +
    // Dedupe reason chips (when present)
    dedupeReasonChipsHtml +
    // Recommended next step sentence
    '<div class="queue-summary" style="margin-top:0.6rem">' +
    options.escapeHtml(startHereGuidance.whyNow) +
    "</div>" +
    // Action buttons
    '<div class="action-row" style="margin-top:0.75rem;gap:0.5rem;flex-wrap:wrap">' +
    primaryButtonHtml +
    fallbackBtns.join("") +
    (sourceReference.href
      ? '<a class="btn-secondary btn-inline" href="' +
        options.escapeHtml(sourceReference.href) +
        '" target="_blank" rel="noopener">Open source</a>'
      : "") +
    '<button class="btn-secondary btn-inline" data-edit-candidate-id="' +
    options.escapeHtml(item.id) +
    '">Edit profile</button>' +
    "</div>" +
    // Status feedback
    '<div class="review-coach-status" data-candidate-status-id="' +
    options.escapeHtml(item.id) +
    '">' +
    options.escapeHtml(actionFlash) +
    "</div>" +
    // Collapsed details
    (expandedDetails
      ? '<details class="queue-more-details"><summary>See full details</summary><div class="queue-more-details-body">' +
        expandedDetails +
        "</div></details>"
      : "") +
    "</article>"
  );
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
    if (filters.review_lane && item.review_lane !== filters.review_lane) {
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

  const duplicateCount = candidates.filter(function (item) {
    return (
      item.dedupe_status === "possible_duplicate" || item.dedupe_status === "definite_duplicate"
    );
  }).length;
  const confirmCount = candidates.filter(function (item) {
    return item.review_status === "needs_confirmation";
  }).length;
  const publishNowCount = candidates.filter(function (item) {
    return item.review_lane === "publish_now";
  }).length;
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
    '<div class="queue-insights"><div class="queue-insights-title">New listings snapshot</div><div class="queue-insights-grid">' +
    [
      {
        value: publishNowCount,
        label: "Publish now lane",
        note: "These are the fastest trustworthy wins if the source trail looks clean.",
      },
      {
        value: confirmCount,
        label: "Needs confirmation",
        note: "Good listings that still need one more trust pass before publish.",
      },
      {
        value: duplicateCount,
        label: "Possible duplicates",
        note: "Review these before publishing to keep the provider graph clean.",
      },
    ]
      .map(function (item) {
        return (
          '<div class="queue-insight-card"><div class="queue-insight-value">' +
          options.escapeHtml(item.value) +
          '</div><div class="queue-insight-label">' +
          options.escapeHtml(item.label) +
          '</div><div class="queue-insight-note">' +
          options.escapeHtml(item.note) +
          "</div></div>"
        );
      })
      .join("") +
    "</div></div>" +
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
      });
      compareModal.open(item, matchTarget, item.dedupe_reasons || [], button);
    });
  });
}
