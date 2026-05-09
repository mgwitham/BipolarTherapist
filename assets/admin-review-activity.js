// Pure helpers and panel renderer for the Review Activity feed.
// Stateful wrappers (loadReviewActivityFeed, exportReviewActivity) stay in admin.js
// because they write to module-level vars. These functions are pure or DOM-only.

function formatReviewEventType(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, function (letter) {
      return letter.toUpperCase();
    });
}

export function getReviewEventLane(item) {
  const eventType = String((item && item.event_type) || "");
  if (
    eventType.startsWith("licensure_") ||
    eventType === "therapist_review_completed" ||
    eventType === "therapist_review_deferred"
  ) {
    return "ops";
  }
  if (item && item.application_id) {
    return "application";
  }
  if (item && (item.candidate_id || item.candidate_document_id)) {
    return "candidate";
  }
  if (item && item.therapist_id) {
    return "therapist";
  }
  return "ops";
}

export function getReviewEventLaneLabel(item) {
  const lane = getReviewEventLane(item);
  if (lane === "application") {
    return "Application review";
  }
  if (lane === "candidate") {
    return "Candidate queue";
  }
  if (lane === "therapist") {
    return "Therapist record";
  }
  return "Ops workflow";
}

export function getReviewActivityFilterLabel(value) {
  if (value === "application") {
    return "application events";
  }
  if (value === "candidate") {
    return "candidate events";
  }
  if (value === "therapist") {
    return "therapist events";
  }
  if (value === "ops") {
    return "ops events";
  }
  return "events";
}

export function getReviewEventActionLabel(item) {
  const eventType = String((item && item.event_type) || "");
  const actionMap = {
    application_approved: "Approved application",
    application_rejected: "Rejected application",
    application_requested_changes: "Requested changes",
    candidate_reviewed: "Reviewed candidate",
    candidate_archived: "Archived candidate",
    candidate_marked_duplicate: "Marked duplicate",
    candidate_merged: "Merged candidate",
    candidate_published: "Published candidate",
    candidate_follow_up_updated: "Updated candidate follow-up",
    application_follow_up_updated: "Updated application follow-up",
    therapist_live_fields_applied: "Applied live updates",
    therapist_review_completed: "Completed therapist review",
    therapist_review_deferred: "Deferred therapist review",
    licensure_refresh_deferred: "Deferred licensure refresh",
  };
  return actionMap[eventType] || formatReviewEventType(eventType) || "Review activity";
}

export function getReviewEventTargetLabel(item) {
  if (item && item.application_id) {
    return "Application " + item.application_id;
  }
  if (item && item.candidate_document_id) {
    return "Candidate " + item.candidate_document_id;
  }
  if (item && item.candidate_id) {
    return "Candidate " + item.candidate_id;
  }
  if (item && item.therapist_id) {
    return "Therapist " + item.therapist_id;
  }
  if (item && item.provider_id) {
    return "Provider " + item.provider_id;
  }
  return "Review event";
}

export function buildReviewEventSummary(item) {
  const fragments = [];
  if (item.actor_name) {
    fragments.push("By: " + item.actor_name);
  }
  if (item.decision) {
    fragments.push("Decision: " + item.decision);
  }
  if (item.review_status) {
    fragments.push("Status: " + item.review_status.replace(/_/g, " "));
  }
  if (item.publish_recommendation) {
    fragments.push("Recommendation: " + item.publish_recommendation.replace(/_/g, " "));
  }
  if (Array.isArray(item.changed_fields) && item.changed_fields.length) {
    fragments.push("Changed: " + item.changed_fields.slice(0, 3).join(", "));
  }
  return fragments.join(" · ");
}

// recentEvents is passed in rather than read from a module var to keep this pure.
export function getReviewEventsForApplication(application, recentEvents) {
  const events = Array.isArray(recentEvents) ? recentEvents : [];
  const applicationId = application && application.id ? application.id : "";
  const therapistId =
    application && application.published_therapist_id ? application.published_therapist_id : "";
  const providerId = application && application.provider_id ? application.provider_id : "";
  return events.filter(function (item) {
    return (
      (applicationId && item.application_id === applicationId) ||
      (therapistId && item.therapist_id === therapistId) ||
      (providerId && item.provider_id === providerId)
    );
  });
}

export function getReviewEventsForCandidate(candidate, recentEvents) {
  const events = Array.isArray(recentEvents) ? recentEvents : [];
  const candidateId = candidate && candidate.id ? candidate.id : "";
  const candidateDocumentId = candidateId;
  const providerId = candidate && candidate.provider_id ? candidate.provider_id : "";
  const therapistId =
    candidate && candidate.published_therapist_id ? candidate.published_therapist_id : "";
  return events.filter(function (item) {
    return (
      (candidateId && item.candidate_id === candidateId) ||
      (candidateDocumentId && item.candidate_document_id === candidateDocumentId) ||
      (providerId && item.provider_id === providerId) ||
      (therapistId && item.therapist_id === therapistId)
    );
  });
}

export function renderReviewEventSnippetHtml(events, options) {
  const items = Array.isArray(events) ? events.slice(0, 3) : [];
  if (!items.length) {
    return "";
  }

  return (
    '<div class="queue-summary" style="margin-bottom:0.35rem"><strong>Recent activity</strong></div>' +
    '<div style="margin-bottom:0.75rem">' +
    items
      .map(function (item) {
        const summary = buildReviewEventSummary(item);
        const showRationale = item.rationale && item.rationale !== item.notes;
        return (
          '<div style="display:flex;justify-content:space-between;gap:0.75rem;font-size:0.82rem;padding:0.3rem 0;border-bottom:1px solid rgba(0,0,0,0.06)">' +
          '<div style="min-width:0">' +
          '<span style="font-weight:600;color:var(--navy)">' +
          options.escapeHtml(getReviewEventActionLabel(item)) +
          "</span>" +
          '<span class="tag" style="margin-left:0.4rem;font-size:0.7rem;padding:0.1rem 0.4rem">' +
          options.escapeHtml(getReviewEventLaneLabel(item)) +
          "</span>" +
          (summary
            ? '<div style="color:var(--slate);margin-top:0.1rem">' +
              options.escapeHtml(summary) +
              "</div>"
            : "") +
          (showRationale
            ? '<div style="margin-top:0.2rem;font-size:0.78rem;color:#333">' +
              options.escapeHtml(item.rationale) +
              "</div>"
            : "") +
          "</div>" +
          '<div class="subtle" style="white-space:nowrap;font-size:0.76rem;padding-top:0.1rem">' +
          options.escapeHtml(options.formatDate(item.created_at)) +
          "</div>" +
          "</div>"
        );
      })
      .join("") +
    "</div>"
  );
}

export function renderReviewEventTimelineHtml(events, options) {
  const items = Array.isArray(events) ? events : [];
  if (!items.length) {
    return "";
  }

  return (
    '<details class="review-details" style="margin-top:0.4rem"><summary class="review-details-summary">Full activity history (' +
    options.escapeHtml(String(items.length)) +
    ')</summary><div class="review-details-body" style="padding-top:0.85rem">' +
    items
      .map(function (item) {
        const summary = buildReviewEventSummary(item);
        const showRationale = item.rationale && item.rationale !== item.notes;
        return (
          '<div class="mini-card" style="padding:0.75rem 0.85rem;margin-bottom:0.65rem">' +
          '<div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start">' +
          '<div style="min-width:0">' +
          '<div style="display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center">' +
          '<div style="font-size:0.88rem;font-weight:700;color:var(--navy)">' +
          options.escapeHtml(getReviewEventActionLabel(item)) +
          '</div><span class="tag">' +
          options.escapeHtml(getReviewEventLaneLabel(item)) +
          "</span></div>" +
          '<div class="subtle" style="margin-top:0.15rem">' +
          options.escapeHtml(getReviewEventTargetLabel(item)) +
          "</div>" +
          (summary
            ? '<div style="margin-top:0.35rem;font-size:0.82rem;color:var(--slate)">' +
              options.escapeHtml(summary) +
              "</div>"
            : "") +
          (showRationale
            ? '<div style="margin-top:0.35rem;font-size:0.82rem;color:#333">' +
              options.escapeHtml(item.rationale) +
              "</div>"
            : "") +
          (item.notes
            ? '<div style="margin-top:0.35rem;font-size:0.82rem;color:#333">' +
              options.escapeHtml(item.notes) +
              "</div>"
            : "") +
          "</div>" +
          '<div class="subtle" style="white-space:nowrap;font-size:0.78rem">' +
          options.escapeHtml(options.formatDate(item.created_at)) +
          "</div>" +
          "</div></div>"
        );
      })
      .join("") +
    "</div></details>"
  );
}

// options carries all state the panel needs:
//   authRequired, dataMode, reviewActivityFilter, reviewActivityItems,
//   reviewActivityLoading, reviewActivityNextCursor,
//   escapeHtml, formatDate,
//   renderReviewActivitySavedViews, renderReviewActivitySavedViewMeta
export function renderReviewActivityPanel(options) {
  const root = document.getElementById("reviewActivityFeed");
  const countEl = document.getElementById("reviewActivityCount");
  const filterEl = document.getElementById("reviewActivityFilter");
  if (!root) {
    return;
  }

  const {
    authRequired,
    dataMode,
    reviewActivityFilter,
    reviewActivityItems,
    reviewActivityLoading,
    reviewActivityNextCursor,
    escapeHtml,
    formatDate,
    renderReviewActivitySavedViews,
    renderReviewActivitySavedViewMeta,
  } = options;

  if (filterEl) {
    filterEl.value = reviewActivityFilter;
  }
  renderReviewActivitySavedViews();
  renderReviewActivitySavedViewMeta();

  if (authRequired || dataMode !== "sanity") {
    if (countEl) {
      countEl.textContent = authRequired ? "Sign in to load review activity." : "Remote only";
    }
    root.innerHTML =
      '<div class="empty">Recent review activity appears here when the review API is connected.</div>';
    return;
  }

  const items = Array.isArray(reviewActivityItems) ? reviewActivityItems : [];
  if (countEl) {
    countEl.textContent = items.length
      ? items.length +
        " recent " +
        getReviewActivityFilterLabel(reviewActivityFilter) +
        (reviewActivityNextCursor ? " loaded so far" : "")
      : reviewActivityLoading
        ? "Loading review activity..."
        : "No recent events";
  }

  if (!items.length) {
    root.innerHTML =
      '<div class="empty">' +
      escapeHtml(
        reviewActivityLoading
          ? "Loading review activity..."
          : reviewActivityFilter
            ? "No review activity matches this filter yet."
            : "No review events yet. Decisions, publishes, and ops actions will appear here.",
      ) +
      "</div>";
    return;
  }

  root.innerHTML =
    items
      .map(function (item) {
        const summary = buildReviewEventSummary(item);
        const showRationale = item.rationale && item.rationale !== item.notes;
        return (
          '<div class="mini-card" style="padding:0.9rem 1rem;margin-bottom:0.75rem">' +
          '<div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start">' +
          "<div>" +
          '<div style="display:flex;flex-wrap:wrap;gap:0.45rem;align-items:center">' +
          '<div style="font-weight:700;color:var(--navy)">' +
          escapeHtml(getReviewEventActionLabel(item)) +
          '</div><span class="tag">' +
          escapeHtml(getReviewEventLaneLabel(item)) +
          "</span></div>" +
          '<div class="subtle" style="margin-top:0.15rem">' +
          escapeHtml(getReviewEventTargetLabel(item)) +
          "</div>" +
          (summary
            ? '<div style="margin-top:0.45rem;font-size:0.88rem;color:var(--slate)">' +
              escapeHtml(summary) +
              "</div>"
            : "") +
          (showRationale
            ? '<div style="margin-top:0.45rem;font-size:0.84rem;color:#333">' +
              escapeHtml(item.rationale) +
              "</div>"
            : "") +
          (item.notes
            ? '<div style="margin-top:0.45rem;font-size:0.84rem;color:#333">' +
              escapeHtml(item.notes) +
              "</div>"
            : "") +
          "</div>" +
          '<div class="subtle" style="white-space:nowrap">' +
          escapeHtml(formatDate(item.created_at)) +
          "</div>" +
          "</div>" +
          "</div>"
        );
      })
      .join("") +
    (reviewActivityNextCursor || reviewActivityLoading
      ? '<div style="margin-top:0.9rem;display:flex;justify-content:center"><button class="btn-secondary" type="button" id="reviewActivityLoadMore"' +
        (reviewActivityLoading ? " disabled" : "") +
        ">" +
        escapeHtml(reviewActivityLoading ? "Loading..." : "Load more activity") +
        "</button></div>"
      : "");
}
