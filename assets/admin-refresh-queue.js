const refreshActionFlash = {};
const REFRESH_ACTION_FLASH_TTL_MS = 10 * 60 * 1000;

function setRefreshActionFlash(id, message) {
  if (!id) {
    return;
  }
  const trimmed = String(message || "").trim();
  if (!trimmed) {
    delete refreshActionFlash[id];
    return;
  }
  refreshActionFlash[id] = {
    message: trimmed,
    createdAt: Date.now(),
  };
}

function getRecentRefreshActionFlashes(limit) {
  const maxItems = Number(limit) > 0 ? Number(limit) : 3;
  const now = Date.now();
  return Object.entries(refreshActionFlash)
    .map(function (entry) {
      return {
        id: entry[0],
        message: entry[1] && entry[1].message ? entry[1].message : "",
        createdAt: entry[1] && entry[1].createdAt ? entry[1].createdAt : 0,
      };
    })
    .filter(function (entry) {
      return (
        entry.message && entry.createdAt && now - entry.createdAt <= REFRESH_ACTION_FLASH_TTL_MS
      );
    })
    .sort(function (a, b) {
      return b.createdAt - a.createdAt;
    })
    .slice(0, maxItems);
}

export function renderRefreshQueuePanel(options) {
  const root = document.getElementById("refreshQueue");
  if (!root) {
    return;
  }

  if (options.authRequired) {
    root.innerHTML = "";
    return;
  }

  const therapists =
    options.dataMode === "sanity" ? options.publishedTherapists : options.getTherapists();
  const recentlyMaintained = therapists
    .filter(function (item) {
      return Boolean(options.getConfirmationGraceWindowNote(item));
    })
    .slice(0, 4);
  const queue = therapists
    .map(function (item) {
      return {
        item: item,
        freshness: options.getDataFreshnessSummary(item),
        trustAttentionCount: options.getTherapistFieldTrustAttentionCount(item),
      };
    })
    .filter(function (entry) {
      return entry.freshness.status !== "fresh" || entry.trustAttentionCount > 0;
    })
    .sort(function (a, b) {
      const weight = {
        aging: 0,
        watch: 1,
        fresh: 2,
      };
      const statusDiff = (weight[a.freshness.status] || 9) - (weight[b.freshness.status] || 9);
      if (statusDiff) {
        return statusDiff;
      }
      const trustDiff = (b.trustAttentionCount || 0) - (a.trustAttentionCount || 0);
      if (trustDiff) {
        return trustDiff;
      }
      return (
        (b.freshness.needs_reconfirmation_fields || []).length -
        (a.freshness.needs_reconfirmation_fields || []).length
      );
    });

  if (!queue.length && !recentlyMaintained.length) {
    root.innerHTML =
      '<div class="subtle">No published listings currently need an update review here.</div>';
    return;
  }

  function getTherapistId(item) {
    return item && (item.id || item._id) ? item.id || item._id : "";
  }
  const recentFlashes = getRecentRefreshActionFlashes(3);

  root.innerHTML =
    (recentFlashes.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Done Recently</div><div class="queue-insights-grid">' +
        recentFlashes
          .map(function (entry) {
            const therapist = therapists.find(function (item) {
              return getTherapistId(item) === entry.id;
            });
            return (
              '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
              options.escapeHtml(therapist && therapist.name ? therapist.name : entry.id) +
              '</strong></div><div class="queue-insight-note">' +
              options.escapeHtml(entry.message) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    (recentlyMaintained.length
      ? '<div class="queue-insights" id="recentlyMaintainedRefresh"><div class="queue-insights-title">Recently maintained</div><div class="subtle" style="margin-bottom:0.7rem">These profiles were updated recently and are currently in a short freshness grace window.</div><div class="queue-insights-grid">' +
        recentlyMaintained
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
              options.escapeHtml(item.name) +
              '</strong></div><div class="queue-insight-note">' +
              options.escapeHtml(options.getConfirmationGraceWindowNote(item)) +
              '</div><div class="queue-insight-action"><a href="therapist.html?slug=' +
              encodeURIComponent(item.slug) +
              '">Open profile</a></div></div>'
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    queue
      .map(function (entry, index) {
        const item = entry.item;
        const freshness = entry.freshness;
        const trustSummary = options.getTherapistFieldTrustSummary(item);
        const nextMove = options.getTherapistTrustRecommendation(item, freshness, trustSummary);
        const therapistId = getTherapistId(item);
        const sourceUrl = item.sourceUrl || item.source_url || "";
        const evidence = [
          item.nextReviewDueAt ? "Due " + options.formatDate(item.nextReviewDueAt) : "",
          item.sourceReviewedAt
            ? "Source reviewed " + options.formatDate(item.sourceReviewedAt)
            : "",
          freshness.source_review_age_days != null
            ? "Source age " + freshness.source_review_age_days + "d"
            : "",
          freshness.therapist_confirmation_age_days != null
            ? "Confirmation age " + freshness.therapist_confirmation_age_days + "d"
            : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          '<div class="mini-card' +
          (index === 0 ? " is-start-here" : "") +
          '"' +
          (index === 0 ? ' id="refreshQueueStartHere"' : "") +
          "><div>" +
          (index === 0
            ? '<div class="start-here-chip">Start here</div><div class="start-here-copy">Work this listing first. It is the highest-priority live listing that may need updated details.</div><div class="start-here-action">Do this now: open the profile, review the stale fields, and decide whether you can update them directly or need therapist confirmation.</div>'
            : "") +
          "<strong>" +
          options.escapeHtml(item.name) +
          '</strong><div class="subtle">' +
          options.escapeHtml(freshness.label) +
          '</div><div class="subtle">' +
          options.escapeHtml(freshness.note) +
          '</div><div class="subtle">Next move: ' +
          options.escapeHtml(nextMove) +
          '</div><div class="subtle">Trust: ' +
          options.escapeHtml(trustSummary.headline) +
          "</div>" +
          (evidence ? '<div class="subtle">' + options.escapeHtml(evidence) + "</div>" : "") +
          '<div class="recommended-action-bar"><div class="recommended-action-label">Recommended action</div><div class="recommended-action-row"><a class="btn-primary btn-inline" href="therapist.html?slug=' +
          encodeURIComponent(item.slug) +
          '">Open profile and review fields</a></div><div class="mini-status" style="margin-top:0.65rem"><strong>Done when:</strong> The listing is updated, deferred with a reason, or moved into confirmation follow-up.</div></div>' +
          (therapistId
            ? '<div class="queue-actions secondary-actions"><button class="btn-secondary btn-inline" data-refresh-ops="' +
              options.escapeHtml(therapistId) +
              '" data-refresh-next="mark_reviewed">Mark reviewed after check</button><button class="btn-secondary btn-inline" data-refresh-ops="' +
              options.escapeHtml(therapistId) +
              '" data-refresh-next="snooze_7d">Defer 7 days</button><button class="btn-secondary btn-inline" data-refresh-ops="' +
              options.escapeHtml(therapistId) +
              '" data-refresh-next="snooze_30d">Defer 30 days</button></div>'
            : "") +
          (therapistId ? options.renderReviewEntityTaskHtml("therapist", therapistId) : "") +
          '<div class="review-coach-status" data-refresh-status-id="' +
          options.escapeHtml(therapistId) +
          '"></div></div><div class="queue-actions" style="margin-top:0">' +
          (sourceUrl
            ? '<a class="btn-secondary btn-inline" href="' +
              options.escapeHtml(sourceUrl) +
              '" target="_blank" rel="noopener">Open source</a>'
            : "") +
          "</div></div>"
        );
      })
      .join("");

  root.querySelectorAll("[data-refresh-ops]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const therapistId = button.getAttribute("data-refresh-ops");
      const decision = button.getAttribute("data-refresh-next");
      if (!therapistId || !decision) {
        return;
      }

      const prior = button.textContent;
      const status = root.querySelector(
        '[data-refresh-status-id="' + options.escapeHtml(therapistId) + '"]',
      );
      button.disabled = true;
      button.textContent = decision === "mark_reviewed" ? "Saving..." : "Deferring...";

      try {
        await options.decideTherapistOps(therapistId, { decision: decision });
        if (status) {
          var message =
            decision === "mark_reviewed"
              ? "Completed: refresh review saved and removed from the active queue on reload."
              : decision === "snooze_30d"
                ? "Deferred: this refresh item is snoozed for 30 days."
                : "Deferred: this refresh item is snoozed for 7 days.";
          status.textContent = message;
          setRefreshActionFlash(therapistId, message);
        }
        await options.loadData();
      } catch (_error) {
        if (status) {
          status.textContent = "Could not update this refresh item.";
        }
        setRefreshActionFlash(therapistId, "Could not update this refresh item.");
        button.disabled = false;
        button.textContent = prior;
      }
    });
  });
}
