export function renderNoResultsStateSection(options) {
  var settings = options || {};
  var root = settings.root;
  if (!root) {
    return;
  }

  var zipSuggestions = settings.zipSuggestions || [];
  var hasRefinements = Boolean(settings.hasRefinements);
  var escapeHtml = settings.escapeHtml || String;
  var formatZipSuggestionList =
    settings.formatZipSuggestionList ||
    function () {
      return "";
    };

  root.className = "match-empty";
  root.innerHTML =
    '<div class="match-empty-shell"><div class="match-empty-kicker">No strong shortlist yet</div><h2 class="match-empty-title">' +
    escapeHtml(
      hasRefinements
        ? "Your filters may be too tight for the current reviewed supply."
        : "We do not have a strong reviewed match for this exact setup yet.",
    ) +
    '</h2><p class="match-empty-copy">' +
    escapeHtml(
      hasRefinements
        ? "The fastest next move is usually to clear optional preferences, then widen only one constraint at a time if needed."
        : zipSuggestions.length
          ? "Try a nearby reviewed ZIP or widen to telehealth so we can surface a broader shortlist."
          : "Try telehealth, a nearby ZIP, or a lighter set of optional preferences to open the field.",
    ) +
    '</p><div class="match-empty-actions">' +
    zipSuggestions
      .map(function (item) {
        return (
          '<button type="button" class="btn-secondary match-empty-action" data-empty-zip="' +
          escapeHtml(item.zip) +
          '">Try ZIP ' +
          escapeHtml(item.zip) +
          "</button>"
        );
      })
      .join("") +
    '<button type="button" class="btn-primary match-empty-action" data-empty-telehealth="true">Try telehealth</button>' +
    '<button type="button" class="btn-secondary match-empty-action" data-empty-clear="true">Clear optional filters</button>' +
    '</div><div class="match-empty-note">' +
    escapeHtml(
      zipSuggestions.length
        ? "Nearest reviewed ZIPs: " + formatZipSuggestionList(zipSuggestions) + "."
        : "You can keep your core care type and ZIP, then widen the rest incrementally.",
    ) +
    "</div></div>";
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

export function renderShortlistQueueSection(options) {
  var settings = options || {};
  var root = settings.root;
  if (!root) {
    return;
  }

  var queueEntries = settings.queueEntries || [];
  var escapeHtml = settings.escapeHtml || String;
  var profileBaseHref = settings.profileBaseHref || "therapist.html?slug=";
  var formatTherapistLocationLine =
    settings.formatTherapistLocationLine ||
    function () {
      return "";
    };
  var buildQueueReserveCopy =
    settings.buildQueueReserveCopy ||
    function () {
      return "";
    };
  var shortlistLimit = Number(settings.shortlistLimit || 3);

  if (!queueEntries.length) {
    root.hidden = true;
    root.innerHTML = "";
    return;
  }

  root.hidden = false;
  root.innerHTML =
    '<details class="match-queue-disclosure"><summary><span class="match-queue-title">More options to consider</span><span class="match-queue-toggle" aria-hidden="true"></span></summary><div class="match-queue-list">' +
    queueEntries
      .map(function (entry, index) {
        var therapist = entry.therapist;
        return (
          '<article class="match-queue-card"><div><div class="match-queue-rank">Top ' +
          escapeHtml(String(shortlistLimit + index + 1)) +
          ' match</div><div class="match-queue-name">' +
          escapeHtml(therapist.name) +
          '</div><div class="match-queue-meta">' +
          escapeHtml(therapist.credentials || "") +
          (therapist.title ? " · " + escapeHtml(therapist.title) : "") +
          " · " +
          escapeHtml(formatTherapistLocationLine(therapist)) +
          '</div><div class="match-queue-copy">' +
          escapeHtml(buildQueueReserveCopy(entry)) +
          "</div></div>" +
          '<a href="' +
          profileBaseHref +
          encodeURIComponent(therapist.slug) +
          '" class="btn-secondary" style="width:auto" data-match-profile-link="' +
          escapeHtml(therapist.slug) +
          '" data-profile-link-context="queue">View Profile</a></article>'
        );
      })
      .join("") +
    "</div></details>";
}
