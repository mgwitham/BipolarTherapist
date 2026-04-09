import {
  bindCandidateDecisionButtons,
  renderCandidateMergePreview,
  renderCandidateMergeWorkbench,
  renderCandidatePublishPacket,
  renderCandidateTrustChips,
} from "./admin-candidate-review.js";

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
    " candidate" +
    (candidates.length === 1 ? "" : "s");

  if (!candidates.length) {
    root.innerHTML =
      '<div class="empty">No sourced therapist candidates yet. Run the discovery or candidate import workflow and they will appear here.</div>';
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

  root.innerHTML =
    '<div class="queue-insights"><div class="queue-insights-title">Candidate queue snapshot</div><div class="queue-insights-grid">' +
    [
      {
        value: publishNowCount,
        label: "Publish now lane",
        note: "These are the fastest trustworthy wins if the source trail looks clean.",
      },
      {
        value: confirmCount,
        label: "Needs confirmation",
        note: "Good candidates that still need one more trust pass before publish.",
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
    (filtered.length ? "" : '<div class="empty">No candidates match the current filters.</div>') +
    filtered
      .map(function (item) {
        const location = [item.city, item.state, item.zip]
          .filter(Boolean)
          .join(", ")
          .replace(/, (?=\d{5}$)/, " ");
        const sourceTrail = [item.source_type, item.source_url].filter(Boolean).join(" · ");
        const trustSummary = options.getCandidateTrustSummary(item);
        const trustRecommendation = options.getCandidateTrustRecommendation(item, trustSummary);
        const publishPacket = options.getCandidatePublishPacket(item, trustSummary);
        const reviewEvents = options.getReviewEventsForCandidate(item);
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
            ? "Strong publish candidate."
            : item.publish_recommendation === "needs_confirmation"
              ? "Worth keeping, but needs confirmation."
              : item.publish_recommendation === "reject"
                ? "Do not publish without resolving duplication."
                : "Needs a review decision.";

        return (
          '<article class="queue-card" data-candidate-card-id="' +
          options.escapeHtml(item.id) +
          '"><div class="queue-head"><div><h3>' +
          options.escapeHtml(item.name || "Unnamed candidate") +
          '</h3><div class="subtle">' +
          options.escapeHtml([item.credentials, location].filter(Boolean).join(" · ")) +
          '</div></div><div class="queue-head-actions"><span class="tag">' +
          options.escapeHtml(options.getCandidateReviewChipLabel(item.review_status)) +
          '</span><span class="tag">' +
          options.escapeHtml(options.getCandidateDedupeChipLabel(item.dedupe_status)) +
          "</span></div></div>" +
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
          renderCandidatePublishPacket(publishPacket, {
            escapeHtml: options.escapeHtml,
          }) +
          (sourceTrail
            ? '<div class="queue-summary"><strong>Source trail:</strong> ' +
              options.escapeHtml(sourceTrail) +
              "</div>"
            : "") +
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
          options.renderReviewEntityTaskHtml("candidate", item.id, {
            escapeHtml: options.escapeHtml,
            formatDate: options.formatDate,
          }) +
          renderCandidateTrustChips(trustSummary, 4, {
            escapeHtml: options.escapeHtml,
          }) +
          mergeWorkbench +
          mergePreview +
          '<div class="queue-actions">' +
          options.buildCandidateDecisionActions(item) +
          (item.source_url
            ? '<a class="btn-secondary btn-inline" href="' +
              options.escapeHtml(item.source_url) +
              '" target="_blank" rel="noopener">Open source</a>'
            : "") +
          (item.published_therapist_id
            ? '<a class="btn-secondary btn-inline" href="therapist.html?slug=' +
              encodeURIComponent(item.matched_therapist_slug || "") +
              '">View profile</a>'
            : "") +
          '</div><div class="review-coach-status" data-candidate-status-id="' +
          options.escapeHtml(item.id) +
          '"></div></article>'
        );
      })
      .join("");

  bindCandidateDecisionButtons(root, {
    decideTherapistCandidate: options.decideTherapistCandidate,
    loadData: options.loadData,
  });
}
