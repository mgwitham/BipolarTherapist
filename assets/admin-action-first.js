export function renderActionFirstIntro(config) {
  if (!config || !config.active) {
    return "";
  }
  return (
    '<div class="start-here-chip">Start here</div><div class="start-here-copy">' +
    config.escapeHtml(String(config.title || "")) +
    '</div><div class="start-here-action">' +
    config.escapeHtml(String(config.action || "")) +
    "</div>"
  );
}

export function renderRecommendedActionBar(config) {
  if (!config) {
    return "";
  }
  return (
    '<div class="recommended-action-bar"><div class="recommended-action-label">Recommended action</div>' +
    (config.why
      ? '<div class="mini-status" style="margin-bottom:0.65rem"><strong>Why this first:</strong> ' +
        config.escapeHtml(String(config.why || "")) +
        "</div>"
      : "") +
    '<div class="recommended-action-row">' +
    (config.primaryActionHtml || "") +
    (config.secondaryActionHtml || "") +
    '</div><div class="mini-status" style="margin-top:0.65rem"><strong>Done when:</strong> ' +
    config.escapeHtml(String(config.doneWhen || "")) +
    "</div></div>"
  );
}

export function renderDecisionGuide(config) {
  if (!config || !Array.isArray(config.items) || !config.items.length) {
    return "";
  }
  return (
    '<div class="decision-guide"><div class="decision-guide-title">Pick one outcome</div>' +
    config.items
      .map(function (item, index) {
        if (!item) {
          return "";
        }
        var label = String(item.label || "").trim();
        var value = String(item.value || "").trim();
        var className =
          index === 0 ? "decision-guide-note" : config.itemClassName || "decision-guide-note";
        return (
          '<div class="' +
          className +
          '"><strong>' +
          config.escapeHtml(label) +
          ":</strong> " +
          config.escapeHtml(value) +
          "</div>"
        );
      })
      .join("") +
    "</div>"
  );
}
