export function renderNoResultsStateSection(options) {
  var settings = options || {};
  var root = settings.root;
  if (!root) {
    return;
  }

  root.className = "match-empty";
  root.innerHTML =
    '<div class="match-empty-shell">' +
    '<h2 class="match-empty-title">No matches with those filters</h2>' +
    '<p class="match-empty-copy">Try loosening one or two filters. Most patients find a fit after relaxing insurance or care format.</p>' +
    '<div class="match-empty-actions">' +
    '<button type="button" class="match-empty-primary" data-empty-action="open-refine">Adjust filters</button>' +
    '<a href="/match?mode=form" class="match-empty-secondary">Reset answers and start over</a>' +
    "</div>" +
    "</div>";
}

export function renderAdaptiveGuidanceSection(options) {
  var settings = options || {};
  var root = settings.root;
  if (!root) {
    return;
  }

  if (!settings.isInternalMode) {
    root.innerHTML = "";
    return;
  }

  var items = settings.items || [];
  var escapeHtml =
    settings.escapeHtml ||
    function (value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
        return ch === "&"
          ? "&amp;"
          : ch === "<"
            ? "&lt;"
            : ch === ">"
              ? "&gt;"
              : ch === '"'
                ? "&quot;"
                : "&#39;";
      });
    };

  if (!items.length) {
    root.innerHTML = "";
    return;
  }

  root.innerHTML =
    '<section class="adaptive-guidance"><div class="adaptive-guidance-header"><h3>Helpful guidance before you reach out</h3><p>This adapts to your request and the hesitation patterns we have been seeing in the product.</p></div><div class="adaptive-guidance-grid">' +
    items
      .map(function (item) {
        return (
          '<article class="adaptive-guidance-card tone-' +
          escapeHtml(item.tone) +
          '"><div class="adaptive-guidance-title">' +
          escapeHtml(item.title) +
          '</div><div class="adaptive-guidance-body">' +
          escapeHtml(item.body) +
          "</div></article>"
        );
      })
      .join("") +
    "</div></section>";
}
