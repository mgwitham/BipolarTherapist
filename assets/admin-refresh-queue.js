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
      '<div class="subtle">No published profiles are currently flagged for refresh.</div>';
    return;
  }

  root.innerHTML =
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
      .map(function (entry) {
        const item = entry.item;
        const freshness = entry.freshness;
        const trustSummary = options.getTherapistFieldTrustSummary(item);
        const nextMove = options.getTherapistTrustRecommendation(item, freshness, trustSummary);
        return (
          '<div class="mini-card"><div><strong>' +
          options.escapeHtml(item.name) +
          '</strong><div class="subtle">' +
          options.escapeHtml(freshness.label) +
          '</div><div class="subtle">' +
          options.escapeHtml(freshness.note) +
          '</div><div class="subtle">Next move: ' +
          options.escapeHtml(nextMove) +
          '</div><div class="subtle">Trust: ' +
          options.escapeHtml(trustSummary.headline) +
          '</div></div><a href="therapist.html?slug=' +
          encodeURIComponent(item.slug) +
          '">Open profile</a></div>'
        );
      })
      .join("");
}
