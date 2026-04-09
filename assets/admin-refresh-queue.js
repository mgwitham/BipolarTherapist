const refreshActionFlash = {};
const REFRESH_ACTION_FLASH_TTL_MS = 10 * 60 * 1000;
const EXPIRING_SOON_DAYS = 14;

function buildRefreshDecisionGuide(summary, escapeHtml) {
  return (
    '<div class="decision-guide"><div class="decision-guide-title">Pick one outcome</div><div class="decision-guide-note"><strong>Recommended next move:</strong> ' +
    escapeHtml(summary.recommended) +
    '</div><div class="decision-guide-note"><strong>If you can update it directly:</strong> ' +
    escapeHtml(summary.updatePath) +
    '</div><div class="decision-guide-note"><strong>If it needs therapist input:</strong> ' +
    escapeHtml(summary.confirmationPath) +
    '</div><div class="decision-guide-note"><strong>If it can wait:</strong> ' +
    escapeHtml(summary.deferPath) +
    "</div></div>"
  );
}

function toTimestamp(value) {
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function getDaysUntil(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) {
    return null;
  }
  return Math.round((timestamp - Date.now()) / 86400000);
}

function getRefreshPriorityMeta(entry, options) {
  const item = entry.item || {};
  const freshness = entry.freshness || {};
  const dueDays = getDaysUntil(item.nextReviewDueAt);
  const readiness = options.getTherapistMatchReadiness
    ? options.getTherapistMatchReadiness(item)
    : { score: 0 };
  const merchandising = options.getTherapistMerchandisingQuality
    ? options.getTherapistMerchandisingQuality(item)
    : { score: 0 };
  const expiringSoon = dueDays !== null && dueDays >= 0 && dueDays <= EXPIRING_SOON_DAYS;
  const highImpact =
    freshness.status !== "fresh" && readiness.score >= 85 && merchandising.score >= 80;
  const priorityScore =
    (freshness.status === "aging" ? 70 : freshness.status === "watch" ? 40 : 0) +
    (expiringSoon ? 28 : 0) +
    (highImpact ? 24 : 0) +
    Math.min(20, Number(entry.trustAttentionCount || 0) * 4) +
    Math.min(10, (freshness.needs_reconfirmation_fields || []).length * 2) +
    Math.max(0, 12 - Math.max(0, dueDays || 0));

  return {
    dueDays: dueDays,
    expiringSoon: expiringSoon,
    highImpact: highImpact,
    readiness: readiness,
    merchandising: merchandising,
    priorityScore: priorityScore,
  };
}

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
      const freshness = options.getDataFreshnessSummary(item);
      return {
        item: item,
        freshness: freshness,
        trustAttentionCount: options.getTherapistFieldTrustAttentionCount(item),
        priorityMeta: null,
      };
    })
    .filter(function (entry) {
      return entry.freshness.status !== "fresh" || entry.trustAttentionCount > 0;
    })
    .map(function (entry) {
      entry.priorityMeta = getRefreshPriorityMeta(entry, options);
      return entry;
    })
    .sort(function (a, b) {
      const priorityDiff =
        (b.priorityMeta && b.priorityMeta.priorityScore ? b.priorityMeta.priorityScore : 0) -
        (a.priorityMeta && a.priorityMeta.priorityScore ? a.priorityMeta.priorityScore : 0);
      if (priorityDiff) {
        return priorityDiff;
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
        const priorityMeta = entry.priorityMeta || {};
        const trustSummary = options.getTherapistFieldTrustSummary(item);
        const nextMove = options.getTherapistTrustRecommendation(item, freshness, trustSummary);
        const therapistId = getTherapistId(item);
        const sourceReference = options.getSourceReferenceMeta
          ? options.getSourceReferenceMeta(item)
          : {
              href: item.sourceUrl || item.source_url || "",
              label:
                item.sourceUrl || item.source_url
                  ? "Open original source"
                  : "No source page available",
              shortLabel: item.sourceUrl || item.source_url ? "Open source" : "No source page",
            };
        const cues = [
          priorityMeta.expiringSoon
            ? "Expiring soon" +
              (priorityMeta.dueDays != null ? " (" + priorityMeta.dueDays + "d)" : "")
            : "",
          priorityMeta.highImpact ? "High-impact stale" : "",
        ].filter(Boolean);
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
        const actionFlash = therapistId ? refreshActionFlash[therapistId]?.message || "" : "";
        const routeHealthWarnings = options.getRouteHealthWarnings
          ? options.getRouteHealthWarnings(item)
          : [];
        const routeHealthActions = options.getRouteHealthActionItems
          ? options.getRouteHealthActionItems(item)
          : [];
        const firstActionWhy =
          "This live listing has the highest current mix of staleness risk, trust attention, and near-term review urgency.";
        const decisionGuide = {
          recommended: nextMove,
          updatePath:
            "Open the live profile, review the stale details, and save the refresh decision when the information is clear enough to act on.",
          confirmationPath:
            "If a missing or aging field still needs therapist confirmation, move it into confirmation follow-up instead of guessing.",
          deferPath:
            "Defer only when the profile is not urgent enough to review now and you want it to come back later with a clear date.",
        };
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
          "</strong>" +
          (cues.length
            ? '<div class="queue-badge-row">' +
              cues
                .map(function (cue) {
                  return '<span class="queue-badge">' + options.escapeHtml(cue) + "</span>";
                })
                .join("") +
              "</div>"
            : "") +
          (routeHealthWarnings.length
            ? '<div class="queue-badge-row">' +
              routeHealthWarnings
                .map(function (warning) {
                  return '<span class="queue-badge">' + options.escapeHtml(warning) + "</span>";
                })
                .join("") +
              "</div>"
            : "") +
          (routeHealthActions.length
            ? '<div class="queue-actions secondary-actions" style="margin-top:0.55rem">' +
              routeHealthActions
                .map(function (action) {
                  return (
                    '<button class="btn-secondary btn-inline" type="button" data-route-health-action="' +
                    options.escapeHtml(therapistId) +
                    '" data-route-health-mode="' +
                    options.escapeHtml(action.key) +
                    '">' +
                    options.escapeHtml(action.label) +
                    "</button>"
                  );
                })
                .join("") +
              "</div>"
            : "") +
          '<div class="subtle">Priority score: ' +
          options.escapeHtml(String(priorityMeta.priorityScore || 0)) +
          '</div><div class="subtle">' +
          options.escapeHtml(freshness.label) +
          '</div><div class="subtle">' +
          options.escapeHtml(freshness.note) +
          '</div><div class="subtle">Next move: ' +
          options.escapeHtml(nextMove) +
          '</div><div class="subtle">Trust: ' +
          options.escapeHtml(trustSummary.headline) +
          "</div>" +
          (evidence ? '<div class="subtle">' + options.escapeHtml(evidence) + "</div>" : "") +
          '<div class="recommended-action-bar"><div class="recommended-action-label">Recommended action</div>' +
          (index === 0
            ? '<div class="mini-status" style="margin-bottom:0.65rem"><strong>Why this first:</strong> ' +
              options.escapeHtml(firstActionWhy) +
              "</div>"
            : "") +
          '<div class="recommended-action-row"><a class="btn-primary btn-inline" href="therapist.html?slug=' +
          encodeURIComponent(item.slug) +
          '">Open profile and review fields</a>' +
          (sourceReference.href
            ? '<a class="btn-secondary btn-inline" href="' +
              options.escapeHtml(sourceReference.href) +
              '" target="_blank" rel="noopener">' +
              options.escapeHtml(sourceReference.shortLabel) +
              "</a>"
            : "") +
          '</div><div class="mini-status" style="margin-top:0.65rem"><strong>Done when:</strong> The listing is updated, deferred with a reason, or moved into confirmation follow-up.</div></div>' +
          (index === 0 ? buildRefreshDecisionGuide(decisionGuide, options.escapeHtml) : "") +
          (therapistId
            ? '<div class="queue-actions secondary-actions"><button class="btn-secondary btn-inline" data-refresh-ops="' +
              options.escapeHtml(therapistId) +
              '" data-refresh-next="mark_reviewed">Mark reviewed after check</button><button class="btn-secondary btn-inline" data-refresh-ops="' +
              options.escapeHtml(therapistId) +
              '" data-refresh-next="snooze_7d">Defer 7 days</button><button class="btn-secondary btn-inline" data-refresh-ops="' +
              options.escapeHtml(therapistId) +
              '" data-refresh-next="snooze_30d">Defer 30 days</button></div>'
            : "") +
          (actionFlash
            ? '<div class="review-coach-status">' + options.escapeHtml(actionFlash) + "</div>"
            : "") +
          (therapistId ? options.renderReviewEntityTaskHtml("therapist", therapistId) : "") +
          '<div class="review-coach-status" data-refresh-status-id="' +
          options.escapeHtml(therapistId) +
          '"></div></div>' +
          (index !== 0 && sourceReference.href
            ? '<a class="btn-secondary btn-inline" href="' +
              options.escapeHtml(sourceReference.href) +
              '" target="_blank" rel="noopener">' +
              options.escapeHtml(sourceReference.shortLabel) +
              "</a>"
            : "") +
          "</div>"
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

  root.querySelectorAll("[data-route-health-action]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const therapistId = button.getAttribute("data-route-health-action") || "";
      const actionKey = button.getAttribute("data-route-health-mode") || "";
      if (!therapistId || !actionKey || !options.queueRouteHealthFollowUp) {
        return;
      }
      const status = root.querySelector(
        '[data-refresh-status-id="' + options.escapeHtml(therapistId) + '"]',
      );
      const prior = button.textContent;
      button.disabled = true;
      button.textContent = "Queuing...";
      try {
        const message = await options.queueRouteHealthFollowUp(therapistId, actionKey);
        if (status && message) {
          status.textContent = message;
        }
      } catch (_error) {
        if (status) {
          status.textContent = "Could not queue this route follow-up.";
        }
        button.disabled = false;
        button.textContent = prior;
      }
    });
  });
}
