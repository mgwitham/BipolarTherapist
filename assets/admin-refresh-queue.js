import {
  renderActionFirstIntro,
  renderDecisionGuide,
  renderRecommendedActionBar,
} from "./admin-action-first.js";
import { createActionFlashStore } from "./admin-action-flash.js";

const refreshActionFlash = createActionFlashStore();
const EXPIRING_SOON_DAYS = 14;

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
  refreshActionFlash.set(id, message);
}

function getRecentRefreshActionFlashes(limit) {
  return refreshActionFlash.getRecent(limit, function (entry) {
    return {
      id: entry.id,
      message: entry.message,
      createdAt: entry.createdAt,
    };
  });
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
              '" target="bth-profile" rel="noopener">Open profile</a></div></div>'
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
        // Split the card into a compact summary header (always visible)
        // and an expandable detail section. One card expanded at a time —
        // the first card in the queue is expanded by default so the
        // primary "START HERE" context is on-screen without a click.
        const isExpanded = index === 0;
        const compactBadgesHtml =
          cues.length || routeHealthWarnings.length
            ? '<div class="queue-badge-row">' +
              cues
                .map(function (cue) {
                  return '<span class="queue-badge">' + options.escapeHtml(cue) + "</span>";
                })
                .join("") +
              routeHealthWarnings
                .map(function (warning) {
                  return '<span class="queue-badge">' + options.escapeHtml(warning) + "</span>";
                })
                .join("") +
              "</div>"
            : "";
        return (
          '<div class="mini-card' +
          (index === 0 ? " is-start-here" : "") +
          (isExpanded ? " is-expanded" : "") +
          '" data-refresh-card="' +
          options.escapeHtml(therapistId || String(index)) +
          '"' +
          (index === 0 ? ' id="refreshQueueStartHere"' : "") +
          "><div>" +
          // Compact header — clickable strip that toggles this card open
          // and collapses others. Shows just enough to pick a card at a
          // glance: name, priority score pill, staleness cues.
          '<button type="button" class="refresh-card-toggle" data-toggle-refresh-card="' +
          options.escapeHtml(therapistId || String(index)) +
          '">' +
          '<span class="refresh-card-toggle-name"><strong>' +
          options.escapeHtml(item.name) +
          "</strong></span>" +
          '<span class="refresh-card-toggle-meta">' +
          '<span class="queue-priority-chip">Priority ' +
          options.escapeHtml(String(priorityMeta.priorityScore || 0)) +
          "</span>" +
          '<span class="refresh-card-toggle-freshness">' +
          options.escapeHtml(freshness.label) +
          "</span>" +
          '<span class="refresh-card-toggle-indicator" aria-hidden="true"></span>' +
          "</span>" +
          "</button>" +
          compactBadgesHtml +
          '<div class="refresh-card-detail">' +
          renderActionFirstIntro({
            active: index === 0,
            title:
              "Work this listing first. It is the highest-priority live listing that may need updated details.",
            action:
              "Do this now: open the profile, review the stale fields, and decide whether you can update them directly or need therapist confirmation.",
            escapeHtml: options.escapeHtml,
          }) +
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
          '<div class="subtle">' +
          options.escapeHtml(freshness.note) +
          '</div><div class="subtle">Next move: ' +
          options.escapeHtml(nextMove) +
          '</div><div class="subtle">Trust: ' +
          options.escapeHtml(trustSummary.headline) +
          "</div>" +
          (evidence ? '<div class="subtle">' + options.escapeHtml(evidence) + "</div>" : "") +
          renderRecommendedActionBar({
            why: index === 0 ? firstActionWhy : "",
            doneWhen:
              "The listing is updated, deferred with a reason, or moved into confirmation follow-up.",
            primaryActionHtml:
              '<a class="btn-primary btn-inline" href="therapist.html?slug=' +
              encodeURIComponent(item.slug) +
              '" target="bth-profile" rel="noopener">Open profile and review fields</a>',
            secondaryActionHtml: sourceReference.href
              ? '<a class="btn-secondary btn-inline" href="' +
                options.escapeHtml(sourceReference.href) +
                '" target="bth-source" rel="noopener">' +
                options.escapeHtml(sourceReference.shortLabel) +
                "</a>"
              : "",
            escapeHtml: options.escapeHtml,
          }) +
          (index === 0
            ? renderDecisionGuide({
                items: [
                  { label: "Recommended next move", value: decisionGuide.recommended },
                  { label: "If you can update it directly", value: decisionGuide.updatePath },
                  {
                    label: "If it needs therapist input",
                    value: decisionGuide.confirmationPath,
                  },
                  { label: "If it can wait", value: decisionGuide.deferPath },
                ],
                escapeHtml: options.escapeHtml,
              })
            : "") +
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
          '"></div>' +
          "</div>" + // close .refresh-card-detail
          "</div>" + // close inner wrapper
          "</div>"
        );
      })
      .join("");

  // Card-collapse toggle: clicking a compact card header expands that
  // card and collapses the others, so only one card is "active" at a
  // time. Prevents the whole queue rendering as a wall of full-detail
  // cards. The first card is rendered pre-expanded server-side.
  root.querySelectorAll("[data-toggle-refresh-card]").forEach(function (toggle) {
    toggle.addEventListener("click", function () {
      const card = toggle.closest(".mini-card");
      if (!card) return;
      const wasExpanded = card.classList.contains("is-expanded");
      root.querySelectorAll(".mini-card.is-expanded").forEach(function (expanded) {
        expanded.classList.remove("is-expanded");
      });
      if (!wasExpanded) {
        card.classList.add("is-expanded");
      }
    });
  });

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
      } catch (error) {
        const detail =
          (error && error.status ? "[" + error.status + "] " : "") +
          (error && error.message ? error.message : "Request failed.");
        const message = "Could not update this refresh item. " + detail;
        if (status) {
          status.textContent = message;
        }
        setRefreshActionFlash(therapistId, message);
        button.disabled = false;
        button.textContent = prior;
        console.error("decideTherapistOps failed", error);
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
