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
  var title = hasRefinements
    ? "Your optional filters may be making the list smaller than it needs to be."
    : "We do not have a strong reviewed match for this exact setup yet.";
  var introCopy = hasRefinements
    ? "This usually means the core request is workable, but one or two optional preferences are narrowing the field too aggressively."
    : zipSuggestions.length
      ? "The core request still makes sense. We just need a slightly wider reviewed supply area or a more flexible first contact path."
      : "The core request is clear, but the current reviewed supply is not giving us a strong enough first-pass recommendation yet.";
  var nearbyNote = zipSuggestions.length
    ? "Nearest reviewed ZIPs: " + formatZipSuggestionList(zipSuggestions) + "."
    : "You can keep your core care type and ZIP, then widen the rest one step at a time.";

  root.className = "match-empty";
  root.innerHTML =
    '<div class="match-empty-shell"><div class="match-empty-kicker">No strong list yet</div><h2 class="match-empty-title">' +
    escapeHtml(title) +
    '</h2><p class="match-empty-copy">' +
    escapeHtml(introCopy) +
    '</p><div class="match-empty-decision-grid"><section class="match-empty-decision-card tone-primary"><div class="match-empty-decision-label">Best next move</div><div class="match-empty-decision-title">' +
    escapeHtml(
      hasRefinements
        ? "Clear optional filters before you widen the whole search."
        : zipSuggestions.length
          ? "Try a nearby reviewed ZIP first."
          : "Try telehealth before rebuilding the request.",
    ) +
    '</div><div class="match-empty-decision-copy">' +
    escapeHtml(
      hasRefinements
        ? "That preserves your core request while removing the narrowest constraints that may be blocking a usable list."
        : zipSuggestions.length
          ? "A nearby reviewed area usually preserves most of the same decision logic while giving the system more viable first-contact options."
          : "That is usually the cleanest way to open the field without losing the core intent of the search.",
    ) +
    '</div></section><section class="match-empty-decision-card tone-secondary"><div class="match-empty-decision-label">Safest fallback</div><div class="match-empty-decision-title">' +
    escapeHtml(
      zipSuggestions.length
        ? "Use telehealth as the second recovery move."
        : "Clear optional filters one layer at a time.",
    ) +
    '</div><div class="match-empty-decision-copy">' +
    escapeHtml(
      zipSuggestions.length
        ? "If the nearby reviewed ZIP still feels thin, telehealth is the next best way to expand choice without starting over."
        : "Widening gradually usually protects fit better than throwing away the whole request and starting from scratch.",
    ) +
    '</div></section><section class="match-empty-decision-card tone-refine"><div class="match-empty-decision-label">What not to do yet</div><div class="match-empty-decision-title">Do not widen everything at once.</div><div class="match-empty-decision-copy">' +
    escapeHtml(
      "The strongest recovery path is usually one deliberate change at a time so you can see which answer actually improves the list.",
    ) +
    '</div></section></div><div class="match-empty-actions">' +
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
    '<button type="button" class="btn-primary match-empty-action" data-empty-telehealth="true">Open the field with telehealth</button>' +
    '<button type="button" class="btn-secondary match-empty-action" data-empty-clear="true">Clear optional filters</button>' +
    '<button type="button" class="btn-secondary match-empty-action" id="refineSearchButton">Refine one answer instead</button>' +
    '</div><div class="match-empty-note">' +
    escapeHtml(nearbyNote) +
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
  var shortlistLimit = Number(settings.shortlistLimit || 6);

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
