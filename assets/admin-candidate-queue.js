import {
  bindCandidateDecisionButtons,
  renderCandidateMergePreview,
  renderCandidateMergeWorkbench,
  renderCandidatePublishPacket,
  renderCandidateTrustChips,
} from "./admin-candidate-review.js";
import {
  renderActionFirstIntro,
  renderDecisionGuide,
  renderRecommendedActionBar,
} from "./admin-action-first.js";
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
      return "Published and removed from Add New Listings.";
    case "needs_confirmation":
      return "Moved to Confirm Listing Details.";
    case "reject_duplicate":
      return "Marked as duplicate and removed from the active new-listings lane.";
    case "merge":
      return "Merged with the existing record.";
    case "archive":
      return "Archived and removed from the active new-listings lane.";
    case "mark_ready":
      return "Marked ready for publish review.";
    default:
      return "Updated with a clearer next step.";
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

  if (item.dedupe_status === "possible_duplicate") {
    return {
      primaryAction: "reject_duplicate",
      primaryLabel: "Resolve duplicate now",
      whyNow:
        "Possible duplicate risk should be resolved first so you do not create clutter or publish the wrong profile.",
      doneWhen:
        "The listing is marked duplicate, merged, or clearly kept as unique before you move on.",
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

function renderCandidateDecisionGuide(item, guidance, escapeHtml) {
  const nextMove =
    guidance && guidance.primaryLabel ? guidance.primaryLabel : "Choose the next listing action";
  const publishLine =
    guidance && guidance.primaryAction === "publish"
      ? "Publish now: this is the fastest trusted win."
      : "Publish now: use this only if the listing is ready to go live.";
  const confirmationLine =
    guidance && guidance.primaryAction === "needs_confirmation"
      ? "Send to confirmation now: this listing needs therapist-confirmed details before publish."
      : "Send to confirmation now: use this when one important detail still needs therapist confirmation.";
  const duplicateLine =
    item && item.dedupe_status === "possible_duplicate"
      ? "Resolve duplicate now: clear the duplicate risk before moving forward."
      : "Resolve duplicate now: use this when the listing appears to match an existing profile.";

  return renderDecisionGuide({
    items: [
      { label: "Recommended next move", value: nextMove },
      { label: "Publish now", value: publishLine.replace(/^Publish now:\s*/, "") },
      {
        label: "Send to confirmation now",
        value: confirmationLine.replace(/^Send to confirmation now:\s*/, ""),
      },
      {
        label: "Resolve duplicate now",
        value: duplicateLine.replace(/^Resolve duplicate now:\s*/, ""),
      },
    ],
    escapeHtml: escapeHtml,
  });
}

function renderCandidateCardHtml(item, index, options, therapists, applications) {
  const location = [item.city, item.state, item.zip]
    .filter(Boolean)
    .join(", ")
    .replace(/, (?=\d{5}$)/, " ");
  const sourceTrail = [item.source_type, item.source_url].filter(Boolean).join(" · ");
  const sourceReference = options.getSourceReferenceMeta
    ? options.getSourceReferenceMeta(item)
    : {
        href: item.source_url || "",
        label: item.source_url ? "Open original source" : "No source page available",
        shortLabel: item.source_url ? "Open source" : "No source page",
      };
  const trustSummary = options.getCandidateTrustSummary(item);
  const trustRecommendation = options.getCandidateTrustRecommendation(item, trustSummary);
  const publishPacket = options.getCandidatePublishPacket(item, trustSummary);
  const reviewEvents = options.getReviewEventsForCandidate(item);
  const startHereGuidance = getCandidateStartHereGuidance(item);
  const actionFlash = getCandidateActionFlash(item.id);
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
  const recommendation =
    item.publish_recommendation === "ready"
      ? "Strong publish listing."
      : item.publish_recommendation === "needs_confirmation"
        ? "Worth keeping, but needs confirmation."
        : item.publish_recommendation === "reject"
          ? "Do not publish without resolving duplication."
          : "Needs a review decision.";
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
    renderActionFirstIntro({
      active: index === 0,
      title:
        "Review this listing first. It is the top current supply decision in the filtered view.",
      action: "Do this now: " + startHereGuidance.whyNow,
      escapeHtml: options.escapeHtml,
    }) +
    '<div class="queue-head"><div><h3>' +
    options.escapeHtml(item.name || "Unnamed listing") +
    '</h3><div class="subtle">' +
    options.escapeHtml([item.credentials, location].filter(Boolean).join(" · ")) +
    '</div></div><div class="queue-head-actions"><span class="tag">' +
    options.escapeHtml(options.getCandidateReviewChipLabel(item.review_status)) +
    '</span><span class="tag">' +
    options.escapeHtml(options.getCandidateDedupeChipLabel(item.dedupe_status)) +
    "</span></div></div>" +
    (index === 0
      ? renderRecommendedActionBar({
          why: startHereGuidance.whyNow,
          doneWhen: startHereGuidance.doneWhen,
          primaryActionHtml:
            '<button class="btn-primary" data-candidate-decision="' +
            options.escapeHtml(item.id) +
            '" data-candidate-next="' +
            options.escapeHtml(startHereGuidance.primaryAction) +
            '">' +
            options.escapeHtml(startHereGuidance.primaryLabel) +
            "</button>",
          secondaryActionHtml: sourceReference.href
            ? '<a class="btn-secondary btn-inline" href="' +
              options.escapeHtml(sourceReference.href) +
              '" target="_blank" rel="noopener">' +
              options.escapeHtml(sourceReference.label) +
              "</a>"
            : "",
          escapeHtml: options.escapeHtml,
        })
      : "") +
    '<div class="queue-summary-grid">' +
    '<div class="queue-kpi"><div class="queue-kpi-label">Recommendation</div><div class="queue-kpi-value">' +
    options.escapeHtml(recommendation) +
    '</div></div><div class="queue-kpi"><div class="queue-kpi-label">Ops lane</div><div class="queue-kpi-value">' +
    options.escapeHtml(String(item.review_lane || "editorial_review").replace(/_/g, " ")) +
    '</div></div><div class="queue-kpi"><div class="queue-kpi-label">Priority</div><div class="queue-kpi-value">' +
    options.escapeHtml(
      item.review_priority == null ? "Not scored" : String(item.review_priority) + "/100",
    ) +
    '</div></div><div class="queue-kpi"><div class="queue-kpi-label">Next review due</div><div class="queue-kpi-value">' +
    options.escapeHtml(
      item.next_review_due_at ? options.formatDate(item.next_review_due_at) : "Now",
    ) +
    "</div></div></div>" +
    '<div class="queue-summary"><strong>Readiness:</strong> ' +
    options.escapeHtml(
      item.readiness_score == null ? "Not scored" : item.readiness_score + "/100",
    ) +
    "</div>" +
    '<div class="queue-summary"><strong>Trust:</strong> ' +
    options.escapeHtml(trustSummary.headline) +
    "</div>" +
    '<div class="queue-summary"><strong>Next trust move:</strong> ' +
    options.escapeHtml(trustRecommendation) +
    "</div>" +
    (sourceTrail
      ? '<div class="queue-summary"><strong>Source trail:</strong> ' +
        options.escapeHtml(sourceTrail) +
        "</div>"
      : "") +
    (index === 0
      ? renderCandidateDecisionGuide(item, startHereGuidance, options.escapeHtml) +
        '<div class="queue-actions secondary-actions">'
      : '<div class="queue-actions">') +
    (index === 0
      ? options
          .buildCandidateDecisionActions(item)
          .replace(
            '<button class="btn-primary" data-candidate-decision="' +
              options.escapeHtml(item.id) +
              '" data-candidate-next="' +
              options.escapeHtml(startHereGuidance.primaryAction) +
              '">' +
              options.escapeHtml(startHereGuidance.primaryLabel) +
              "</button>",
            "",
          )
      : options.buildCandidateDecisionActions(item)) +
    (index === 0
      ? ""
      : sourceReference.href
        ? '<a class="btn-secondary btn-inline" href="' +
          options.escapeHtml(sourceReference.href) +
          '" target="_blank" rel="noopener">' +
          options.escapeHtml(sourceReference.shortLabel) +
          "</a>"
        : "") +
    (item.published_therapist_id
      ? '<a class="btn-secondary btn-inline" href="therapist.html?slug=' +
        encodeURIComponent(item.matched_therapist_slug || "") +
        '">View profile</a>'
      : "") +
    '</div><div class="review-coach-status" data-candidate-status-id="' +
    options.escapeHtml(item.id) +
    '">' +
    options.escapeHtml(actionFlash) +
    "</div>" +
    options.renderReviewEntityTaskHtml("candidate", item.id, {
      escapeHtml: options.escapeHtml,
      formatDate: options.formatDate,
    }) +
    (expandedDetails
      ? '<details class="queue-more-details"><summary>See full listing details</summary><div class="queue-more-details-body">' +
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
    return item.dedupe_status === "possible_duplicate";
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
}
