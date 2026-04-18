export function createAdminDashboardCardBuilders(config) {
  const options = config || {};
  const escapeHtml =
    options.escapeHtml ||
    function (value) {
      return String(value || "");
    };
  function buildPassiveStatCard(value, label, meta) {
    return (
      '<div class="stat-card is-passive"><div class="stat-value">' +
      escapeHtml(value) +
      '</div><div class="stat-label">' +
      escapeHtml(label) +
      "</div>" +
      (meta ? '<div class="stat-meta">' + escapeHtml(meta) + "</div>" : "") +
      "</div>"
    );
  }

  function buildActionStatCard(value, label, targetId, options) {
    var config = options || {};
    var attrs = [
      'type="button"',
      'class="stat-card is-actionable"',
      'data-admin-scroll-target="' + escapeHtml(targetId) + '"',
      'style="text-align:left;cursor:pointer"',
    ];
    if (config.confirmationFilter !== undefined) {
      attrs.push('data-admin-confirmation-filter="' + escapeHtml(config.confirmationFilter) + '"');
    }
    if (config.applicationStatus !== undefined) {
      attrs.push('data-admin-application-status="' + escapeHtml(config.applicationStatus) + '"');
    }
    if (config.conciergeStatus !== undefined) {
      attrs.push('data-admin-concierge-status="' + escapeHtml(config.conciergeStatus) + '"');
    }
    if (config.portalRequestStatus !== undefined) {
      attrs.push(
        'data-admin-portal-request-status="' + escapeHtml(config.portalRequestStatus) + '"',
      );
    }
    if (config.focusSelector !== undefined) {
      attrs.push('data-admin-focus-selector="' + escapeHtml(config.focusSelector) + '"');
    }
    if (config.focusTargetId !== undefined) {
      attrs.push('data-admin-focus-target-id="' + escapeHtml(config.focusTargetId) + '"');
    }

    return (
      "<button " +
      attrs.join(" ") +
      '><div class="stat-value">' +
      escapeHtml(value) +
      '</div><div class="stat-label">' +
      escapeHtml(label) +
      "</div>" +
      (config.meta ? '<div class="stat-meta">' + escapeHtml(config.meta) + "</div>" : "") +
      '<div class="stat-action-note">' +
      escapeHtml(config.actionLabel || "Open workflow") +
      "</div></button>"
    );
  }

  function wrapStatsGroup(title, cards, extraClass) {
    return (
      '<div class="stats-group"><div class="stats-group-title">' +
      escapeHtml(title) +
      '</div><div class="stats-grid' +
      (extraClass ? " " + escapeHtml(extraClass) : "") +
      '">' +
      cards.join("") +
      "</div></div>"
    );
  }

  function buildOperatorGuideCard(config) {
    var item = config || {};
    var primaryTargetId = item.targetId || item.focusTargetId || "";
    var secondaryTargetId = item.focusTargetId ? item.targetId || "" : "";
    var mainNeedsJs =
      item.focusTargetId !== undefined ||
      item.confirmationFilter !== undefined ||
      item.applicationStatus !== undefined ||
      item.conciergeStatus !== undefined ||
      item.portalRequestStatus !== undefined ||
      item.focusSelector !== undefined;
    var primaryActionLabel =
      item.focusTargetId && item.directActionLabel
        ? item.directActionLabel
        : item.actionLabel || "Open workflow";
    var secondaryActionLabel =
      item.focusTargetId && item.directActionLabel
        ? item.actionLabel || ""
        : item.directActionLabel || "";
    var mainAttrs = ['class="operator-guide-main"'];
    if (mainNeedsJs) {
      mainAttrs.unshift('type="button"');
      mainAttrs.push('data-admin-scroll-target="' + escapeHtml(primaryTargetId) + '"');
    } else {
      mainAttrs.push('href="#' + escapeHtml(primaryTargetId) + '"');
    }
    if (item.confirmationFilter !== undefined) {
      mainAttrs.push(
        'data-admin-confirmation-filter="' + escapeHtml(item.confirmationFilter) + '"',
      );
    }
    if (item.applicationStatus !== undefined) {
      mainAttrs.push('data-admin-application-status="' + escapeHtml(item.applicationStatus) + '"');
    }
    if (item.conciergeStatus !== undefined) {
      mainAttrs.push('data-admin-concierge-status="' + escapeHtml(item.conciergeStatus) + '"');
    }
    if (item.portalRequestStatus !== undefined) {
      mainAttrs.push(
        'data-admin-portal-request-status="' + escapeHtml(item.portalRequestStatus) + '"',
      );
    }
    if (item.focusSelector !== undefined) {
      mainAttrs.push('data-admin-focus-selector="' + escapeHtml(item.focusSelector) + '"');
    }
    if (item.focusTargetId !== undefined) {
      mainAttrs.push('data-admin-focus-target-id="' + escapeHtml(item.focusTargetId) + '"');
    }
    if (item.title !== undefined) {
      mainAttrs.push('data-admin-workflow-title="' + escapeHtml(item.title) + '"');
    }
    if (Array.isArray(item.steps) && item.steps[0] !== undefined) {
      mainAttrs.push('data-admin-workflow-first-step="' + escapeHtml(item.steps[0]) + '"');
    }
    if (Array.isArray(item.steps) && item.steps[1] !== undefined) {
      mainAttrs.push('data-admin-workflow-next-step="' + escapeHtml(item.steps[1]) + '"');
    }
    if (item.done !== undefined) {
      mainAttrs.push('data-admin-workflow-done="' + escapeHtml(item.done) + '"');
    }
    if (item.directActionLabel !== undefined) {
      mainAttrs.push(
        'data-admin-workflow-primary-action-label="' +
          escapeHtml(item.directActionLabel || "") +
          '"',
      );
    }
    if (item.focusTargetId !== undefined) {
      mainAttrs.push(
        'data-admin-workflow-primary-target-id="' + escapeHtml(item.focusTargetId || "") + '"',
      );
    }
    if (item.targetSummary !== undefined) {
      mainAttrs.push('data-admin-workflow-destination="' + escapeHtml(item.targetSummary) + '"');
    }
    var directAttrs = ['class="btn-secondary btn-inline"'];
    var mainTag = mainNeedsJs ? "button" : "a";

    return (
      '<div class="operator-guide-card"><' +
      mainTag +
      " " +
      mainAttrs.join(" ") +
      '><div class="operator-guide-head"><div><div class="operator-guide-kicker">' +
      escapeHtml(item.kicker || "Operator lane") +
      '</div><h3 class="operator-guide-title">' +
      escapeHtml(item.title || "Workflow") +
      '</h3></div><div class="operator-guide-count">' +
      escapeHtml(item.countLabel || "") +
      '</div></div><div class="operator-guide-copy">' +
      escapeHtml(item.copy || "") +
      '</div><div class="operator-guide-block"><div class="operator-guide-label">How To Work It</div><ol class="operator-guide-list">' +
      (item.steps || [])
        .map(function (step) {
          return "<li>" + escapeHtml(step) + "</li>";
        })
        .join("") +
      '</ol></div><div class="operator-guide-block"><div class="operator-guide-label">Done Means</div><div class="operator-guide-done">' +
      escapeHtml(item.done || "") +
      '</div></div><div class="operator-guide-block"><div class="operator-guide-label">Main Click Lands In</div><div class="operator-guide-destination">' +
      escapeHtml(item.targetSummary || "First actionable item in this workflow") +
      '</div></div><div class="operator-guide-action">' +
      escapeHtml(primaryActionLabel) +
      "</div></" +
      mainTag +
      ">" +
      (secondaryActionLabel && secondaryTargetId
        ? '<div class="operator-guide-secondary"><a href="#' +
          escapeHtml(secondaryTargetId) +
          '" ' +
          directAttrs.join(" ") +
          ">" +
          escapeHtml(secondaryActionLabel) +
          "</a></div>"
        : "") +
      "</div>"
    );
  }

  function buildPriorityActionCard(action, index) {
    var item = action || {};
    var attrs = [
      'type="button"',
      'class="stat-card is-actionable"',
      'data-admin-scroll-target="' + escapeHtml(item.targetId || "") + '"',
      'style="text-align:left;cursor:pointer"',
    ];
    if (item.confirmationFilter !== undefined) {
      attrs.push('data-admin-confirmation-filter="' + escapeHtml(item.confirmationFilter) + '"');
    }
    if (item.applicationStatus !== undefined) {
      attrs.push('data-admin-application-status="' + escapeHtml(item.applicationStatus) + '"');
    }
    if (item.conciergeStatus !== undefined) {
      attrs.push('data-admin-concierge-status="' + escapeHtml(item.conciergeStatus) + '"');
    }
    if (item.portalRequestStatus !== undefined) {
      attrs.push('data-admin-portal-request-status="' + escapeHtml(item.portalRequestStatus) + '"');
    }
    if (item.focusSelector !== undefined) {
      attrs.push('data-admin-focus-selector="' + escapeHtml(item.focusSelector) + '"');
    }
    if (item.focusTargetId !== undefined) {
      attrs.push('data-admin-focus-target-id="' + escapeHtml(item.focusTargetId) + '"');
    }
    if (item.headline !== undefined) {
      attrs.push('data-admin-workflow-title="' + escapeHtml(item.headline) + '"');
    }
    if (item.firstStep !== undefined) {
      attrs.push('data-admin-workflow-first-step="' + escapeHtml(item.firstStep) + '"');
    }
    if (item.successState !== undefined) {
      attrs.push('data-admin-workflow-done="' + escapeHtml(item.successState) + '"');
    }

    return (
      "<button " +
      attrs.join(" ") +
      '><div class="stat-value">' +
      escapeHtml(index + 1) +
      '</div><div class="stat-label">' +
      escapeHtml(item.headline || "Priority action") +
      "</div>" +
      (item.title
        ? '<div class="stat-meta"><strong>' + escapeHtml(item.title) + "</strong></div>"
        : "") +
      (item.detail ? '<div class="stat-meta">' + escapeHtml(item.detail) + "</div>" : "") +
      (item.whyNow
        ? '<div class="stat-context-label">Why This Matters</div><div class="stat-context-copy">' +
          escapeHtml(item.whyNow) +
          "</div>"
        : "") +
      (item.successState
        ? '<div class="stat-context-label">Good Outcome</div><div class="stat-context-copy">' +
          escapeHtml(item.successState) +
          "</div>"
        : "") +
      '<div class="stat-action-note">' +
      escapeHtml(item.actionLabel || "Open workflow") +
      "</div></button>"
    );
  }

  function buildPriorityActionRow(action, index) {
    var item = action || {};
    var attrs = [
      'type="button"',
      'class="priority-row"',
      'data-admin-scroll-target="' + escapeHtml(item.targetId || "") + '"',
    ];
    if (item.confirmationFilter !== undefined) {
      attrs.push('data-admin-confirmation-filter="' + escapeHtml(item.confirmationFilter) + '"');
    }
    if (item.applicationStatus !== undefined) {
      attrs.push('data-admin-application-status="' + escapeHtml(item.applicationStatus) + '"');
    }
    if (item.conciergeStatus !== undefined) {
      attrs.push('data-admin-concierge-status="' + escapeHtml(item.conciergeStatus) + '"');
    }
    if (item.portalRequestStatus !== undefined) {
      attrs.push('data-admin-portal-request-status="' + escapeHtml(item.portalRequestStatus) + '"');
    }
    if (item.focusSelector !== undefined) {
      attrs.push('data-admin-focus-selector="' + escapeHtml(item.focusSelector) + '"');
    }
    if (item.focusTargetId !== undefined) {
      attrs.push('data-admin-focus-target-id="' + escapeHtml(item.focusTargetId) + '"');
    }
    if (item.headline !== undefined) {
      attrs.push('data-admin-workflow-title="' + escapeHtml(item.headline) + '"');
    }
    if (item.firstStep !== undefined) {
      attrs.push('data-admin-workflow-first-step="' + escapeHtml(item.firstStep) + '"');
    }
    if (item.successState !== undefined) {
      attrs.push('data-admin-workflow-done="' + escapeHtml(item.successState) + '"');
    }

    return (
      "<button " +
      attrs.join(" ") +
      '><span class="priority-row-rank">' +
      escapeHtml(index + 1) +
      '</span><span class="priority-row-body"><span class="priority-row-headline">' +
      escapeHtml(item.headline || "Priority action") +
      "</span>" +
      (item.title
        ? '<span class="priority-row-target">' + escapeHtml(item.title) + "</span>"
        : "") +
      (item.whyNow ? '<span class="priority-row-why">' + escapeHtml(item.whyNow) + "</span>" : "") +
      '</span><span class="priority-row-action">' +
      escapeHtml(item.actionLabel || "Open") +
      '<span class="priority-row-arrow" aria-hidden="true">→</span></span></button>'
    );
  }

  return {
    buildActionStatCard,
    buildOperatorGuideCard,
    buildPassiveStatCard,
    buildPriorityActionCard,
    buildPriorityActionRow,
    wrapStatsGroup,
  };
}
