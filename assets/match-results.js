export function renderNoResultsStateSection(options) {
  var settings = options || {};
  var root = settings.root;
  if (!root) {
    return;
  }

  root.className = "match-empty";
  root.innerHTML =
    '<div class="match-empty-shell">' +
    '<p class="match-empty-copy">No matches for those filters right now — try adjusting your search or <a href="/" class="match-empty-home-link">start over from the home page</a>.</p>' +
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
  var escapeHtml = settings.escapeHtml || String;

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
