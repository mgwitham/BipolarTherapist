import { formatDirectoryFeeLabel } from "./directory-view-model.js";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildTherapistProfileHref(slug, source) {
  var params = new URLSearchParams();
  params.set("slug", String(slug || ""));
  if (source) {
    params.set("source", String(source));
  }
  return "therapist.html?" + params.toString();
}

function getTherapistDisplayName(name) {
  return String(name || "")
    .split(",")[0]
    .trim();
}

function buildCardActionTiming(model) {
  if (model && model.contactRoute && model.shortlisted) {
    return {
      title: "Open now and decide on contact from the full profile.",
      copy: "This route already looks usable enough to pressure-test immediately without losing your shortlist context.",
    };
  }

  if (model && model.contactRoute) {
    return {
      title: "Open now, then decide whether to contact right away.",
      copy: "The route looks clear enough that the full profile should help you decide between immediate outreach and saving as backup.",
    };
  }

  if (model && model.shortlisted) {
    return {
      title: "Keep saved until the lead and backup lose strength.",
      copy: "This looks promising, but it should stay in reserve until the stronger routes above it weaken.",
    };
  }

  return {
    title: "Open before outreach.",
    copy: "This looks worth reviewing, but the fuller profile should decide whether it becomes a lead contact or a saved option.",
  };
}

export function renderEmptyStateMarkup(directoryPage) {
  return (
    '<div class="empty-state"><div class="empty-state-kicker">No strong fit yet</div><h3>' +
    escapeHtml((directoryPage && directoryPage.emptyStateTitle) || "No therapists found") +
    "</h3><p>" +
    escapeHtml(
      (directoryPage && directoryPage.emptyStateDescription) ||
        "Try adjusting your filters or search terms.",
    ) +
    '</p><div class="empty-state-grid"><div class="empty-state-card"><div class="empty-state-card-label">Best next move</div><div class="empty-state-card-copy">Loosen one filter at a time so you can tell which answer is actually narrowing the field too hard.</div></div><div class="empty-state-card"><div class="empty-state-card-label">Keep your progress</div><div class="empty-state-card-copy">You do not need to restart the search. Small refinements usually bring good options back without starting over.</div></div><div class="empty-state-card"><div class="empty-state-card-label">If browsing feels thin</div><div class="empty-state-card-copy">Try the guided match for a smaller, more decision-ready shortlist before widening the search too broadly.</div></div></div></div>'
  );
}

export function renderDirectoryDecisionPreviewMarkup(options) {
  var model = options.model;
  if (!model || !model.therapist) {
    return "";
  }

  return (
    '<section class="directory-decision-preview" data-preview-slug="' +
    escapeHtml(model.therapist.slug) +
    '"><div class="directory-decision-preview-main"><div class="directory-decision-preview-kicker">Recommended profile</div><div class="directory-decision-preview-title">' +
    escapeHtml(model.therapist.name) +
    '</div><div class="directory-decision-preview-proof">📍 ' +
    escapeHtml(model.therapist.city || "") +
    (model.therapist.city && model.therapist.state ? ", " : "") +
    escapeHtml(model.therapist.state || "") +
    "</div>" +
    '<div class="directory-decision-preview-subtitle">' +
    escapeHtml(model.openReason) +
    '</div></div><div class="directory-decision-preview-actions"><div class="directory-decision-preview-stats">' +
    model.quickStats
      .map(function (item) {
        return (
          '<div class="directory-decision-preview-stat' +
          (item.plain ? " is-plain-text" : item.label ? "" : " is-value-only") +
          '">' +
          (item.label
            ? '<div class="directory-decision-preview-stat-label">' +
              escapeHtml(item.label) +
              "</div>"
            : "") +
          '<div class="directory-decision-preview-stat-value ' +
          escapeHtml(item.tone || "") +
          '">' +
          escapeHtml(item.value) +
          "</div></div>"
        );
      })
      .join("") +
    '</div><div class="directory-decision-preview-cta-group"><a href="' +
    escapeHtml(buildTherapistProfileHref(model.therapist.slug, "preview")) +
    '" class="card-action-primary" data-preview-open-profile="' +
    escapeHtml(model.therapist.slug) +
    '">Open profile</a><button type="button" class="card-action-btn' +
    (model.shortlisted ? " active" : "") +
    '" data-preview-shortlist="' +
    escapeHtml(model.therapist.slug) +
    '">' +
    (model.shortlisted ? "Saved to shortlist" : "Save to shortlist") +
    "</button></div></div></section>"
  );
}

export function renderCardMarkup(options) {
  var model = options.model;
  var therapist = model.therapist;
  var profileHref = buildTherapistProfileHref(
    therapist.slug,
    model.shortlisted ? "card_profile_saved" : "card_profile",
  );
  var initials = therapist.name
    .split(" ")
    .map(function (part) {
      return part.charAt(0);
    })
    .join("")
    .slice(0, 2);
  var avatar = therapist.photo_url
    ? '<img src="' +
      escapeHtml(therapist.photo_url) +
      '" alt="' +
      escapeHtml(therapist.name) +
      '" />'
    : escapeHtml(initials);
  var tags = model.tags
    .map(function (tag) {
      return '<span class="tag">' + escapeHtml(tag) + "</span>";
    })
    .join("");
  var mode = model.modes
    .map(function (item) {
      return (
        '<span class="tag ' +
        (item === "In-Person" ? "inperson" : "tele") +
        '">' +
        escapeHtml(item) +
        "</span>"
      );
    })
    .join("");
  var primaryAction = model.contactRoute
    ? '<a href="' +
      escapeHtml(model.contactRoute.href) +
      '"' +
      (model.contactRoute.external ? ' target="_blank" rel="noopener"' : "") +
      ' class="card-action-primary" data-primary-cta="' +
      escapeHtml(therapist.slug) +
      '">' +
      escapeHtml(model.contactRoute.label) +
      "</a>"
    : '<a href="' +
      escapeHtml(buildTherapistProfileHref(therapist.slug, "card_primary")) +
      '" class="card-action-primary" data-primary-cta="' +
      escapeHtml(therapist.slug) +
      '">See best next step</a>';
  var quickStats = model.quickStats
    .map(function (item) {
      return (
        '<div class="card-quick-stat"><div class="card-quick-stat-label">' +
        escapeHtml(item.label) +
        '</div><div class="card-quick-stat-value ' +
        escapeHtml(item.tone || "") +
        '">' +
        escapeHtml(item.value) +
        "</div></div>"
      );
    })
    .join("");
  var headerStatus =
    '<div class="card-header-status"><div class="card-header-meta"><div class="card-header-availability ' +
    escapeHtml(model.acceptanceTone) +
    '"><span class="card-header-availability-text">' +
    escapeHtml(model.acceptance) +
    '</span></div><div class="card-header-fee">' +
    escapeHtml(model.feeSummary) +
    '</div></div><a href="' +
    escapeHtml(profileHref) +
    '" class="card-inline-link" data-review-fit="' +
    escapeHtml(therapist.slug) +
    '">Open profile</a></div>';
  var decisionRow = model.decisionPills
    .map(function (item) {
      return '<span class="card-decision-pill">' + escapeHtml(item) + "</span>";
    })
    .join("");
  var primaryDecisionTitle = model.contactRoute ? model.contactRoute.label : "Open profile";

  return (
    '<article class="t-card" data-card-slug="' +
    escapeHtml(therapist.slug) +
    '">' +
    '<div class="t-card-top"><div class="t-card-head"><div class="t-avatar">' +
    avatar +
    "</div>" +
    headerStatus +
    '</div><div class="t-info"><div class="t-name">' +
    escapeHtml(getTherapistDisplayName(therapist.name)) +
    '</div><div class="t-creds">' +
    escapeHtml(therapist.credentials) +
    (therapist.title ? " " + escapeHtml(therapist.title) : "") +
    '</div><div class="t-loc">📍 ' +
    escapeHtml(therapist.city) +
    ", " +
    escapeHtml(therapist.state) +
    "</div></div></div>" +
    '<div class="t-bio">' +
    escapeHtml(model.cardSummary) +
    "</div>" +
    '<div class="t-fit-summary"><div class="card-fit-summary-label">Fast fit read</div>' +
    escapeHtml(model.fitSummary) +
    "</div>" +
    '<div class="card-quick-stats">' +
    quickStats +
    "</div>" +
    (decisionRow ? '<div class="card-decision-row">' + decisionRow + "</div>" : "") +
    '<div class="card-signal-card"><div class="card-signal-label">Why open</div><div class="card-signal-copy">' +
    escapeHtml(model.standoutCopy) +
    "</div></div>" +
    '<div class="card-next-step"><div class="card-next-step-label">Next step</div><div class="card-next-step-copy">' +
    escapeHtml(model.actionSummary) +
    "</div></div>" +
    '<div class="tags">' +
    tags +
    mode +
    "</div>" +
    '<div class="card-contact-detail"><strong>Freshness:</strong> ' +
    escapeHtml(model.freshnessSummary) +
    '</div><div class="card-contact-detail"><strong>Trust:</strong> ' +
    escapeHtml(model.trustSummaryShort) +
    "</div>" +
    '<div class="card-actions"><a href="' +
    escapeHtml(profileHref) +
    '" class="card-open-profile-btn" data-review-fit="' +
    escapeHtml(therapist.slug) +
    '">Open full profile</a><button class="card-action-btn' +
    (model.shortlisted ? " active" : "") +
    '" data-shortlist-slug="' +
    escapeHtml(therapist.slug) +
    '" type="button">' +
    (model.shortlisted ? "Saved to shortlist" : "Save to shortlist") +
    "</button>" +
    primaryAction +
    "</div>" +
    (model.shortlisted
      ? '<div class="card-priority-row"><label class="card-priority-label" for="priority-' +
        escapeHtml(therapist.slug) +
        '">Priority</label><select class="card-priority-select" id="priority-' +
        escapeHtml(therapist.slug) +
        '" data-shortlist-priority="' +
        escapeHtml(therapist.slug) +
        '"><option value="">No label yet</option>' +
        model.shortlistPriorityOptions
          .map(function (option) {
            return (
              '<option value="' +
              escapeHtml(option) +
              '"' +
              (model.shortlistEntry && model.shortlistEntry.priority === option
                ? " selected"
                : "") +
              ">" +
              escapeHtml(option) +
              "</option>"
            );
          })
          .join("") +
        '</select></div><div class="card-note-row"><label class="card-priority-label" for="note-' +
        escapeHtml(therapist.slug) +
        '">Note</label><input class="card-note-input" id="note-' +
        escapeHtml(therapist.slug) +
        '" data-shortlist-note="' +
        escapeHtml(therapist.slug) +
        '" type="text" maxlength="120" placeholder="Add a quick reminder..." value="' +
        escapeHtml(
          model.shortlistEntry && model.shortlistEntry.note ? model.shortlistEntry.note : "",
        ) +
        '" /></div>'
      : "") +
    '<div class="t-footer"><span class="' +
    escapeHtml(model.acceptanceTone) +
    '">' +
    escapeHtml(model.acceptance) +
    '</span><span class="view-link">' +
    escapeHtml(model.footerLabel) +
    "</span></div></article>"
  );
}

export function renderShortlistBarMarkup(options) {
  var model = options.model;
  var undoState = options.undoState || null;
  var historyState = options.historyState || null;
  if (!model.shortlist.length) {
    return {
      html: '<div class="shortlist-bar-copy"><strong>No saved progress yet.</strong><span>Save up to 3 therapists so you can compare, leave short notes, and come back without restarting your search.</span><span class="shortlist-bar-progress">Your saved shortlist stays available on this browser for easy return.</span></div><a href="match.html" class="shortlist-bar-link">Start guided match</a>',
    };
  }

  var compareRows = model.compareCards
    .map(function (card, index) {
      var roleLabel =
        index === 0 ? "Compare first" : index === 1 ? "Keep as backup" : "Saved option";
      var roleTitle =
        index === 0
          ? "Pressure-test this one first."
          : index === 1
            ? "Keep this ready if the lead slips."
            : "Hold this only if the top two weaken.";
      var roleCopy =
        index === 0
          ? "Open this profile when you want the clearest read on fit, trust, and whether you should reach out now."
          : index === 1
            ? "This is the safest backup if timing, cost, or fit uncertainty makes the lead feel weaker after review."
            : "You do not need to act on every saved option. Keep this available only if your lead and backup both lose momentum.";
      return (
        '<div class="shortlist-compare-card"><div class="shortlist-compare-role">' +
        escapeHtml(roleLabel) +
        '</div><div class="shortlist-compare-name">' +
        escapeHtml(card.therapist.name) +
        '</div><div class="shortlist-compare-title">' +
        escapeHtml(roleTitle) +
        '</div><div class="shortlist-compare-meta">' +
        escapeHtml(card.meta) +
        '</div><div class="shortlist-compare-note-label">' +
        escapeHtml(card.noteTitle || "Why you saved this") +
        '</div><div class="shortlist-compare-note">' +
        escapeHtml(card.note) +
        '</div><div class="shortlist-compare-change-label">' +
        escapeHtml(card.changedTitle || "What changed since then") +
        '</div><div class="shortlist-compare-change">' +
        escapeHtml(
          card.changedCopy || "Reopen this only if it still looks stronger than your backup.",
        ) +
        '</div><div class="shortlist-compare-prune"><div class="shortlist-compare-prune-title">' +
        escapeHtml(card.pruneTitle || "Prune this if it no longer belongs") +
        '</div><div class="shortlist-compare-prune-copy">' +
        escapeHtml(
          card.pruneCopy ||
            "Drop this if the newer signal is clearly weaker than the old save reason.",
        ) +
        "</div>" +
        (card.replacement
          ? '<div class="shortlist-compare-replacement"><div class="shortlist-compare-replacement-label">' +
            escapeHtml(card.replacement.roleLabel || "Best replacement if you drop this") +
            '</div><div class="shortlist-compare-replacement-name">' +
            escapeHtml(card.replacement.name) +
            '</div><div class="shortlist-compare-replacement-meta">' +
            escapeHtml(card.replacement.meta) +
            '</div><div class="shortlist-compare-replacement-copy">' +
            escapeHtml(card.replacement.reason) +
            '</div><div class="shortlist-compare-replacement-edge">' +
            escapeHtml(card.replacement.edgeCopy || "") +
            '</div><div class="shortlist-replacement-confidence tone-' +
            escapeHtml(
              (card.replacement.confidence && card.replacement.confidence.tone) || "soft",
            ) +
            '"><div class="shortlist-replacement-confidence-label">' +
            escapeHtml(
              (card.replacement.confidence && card.replacement.confidence.label) ||
                "Replacement confidence",
            ) +
            '</div><div class="shortlist-replacement-confidence-copy">' +
            escapeHtml(
              (card.replacement.confidence && card.replacement.confidence.copy) ||
                "Review this replacement before you reshape the shortlist.",
            ) +
            '</div><div class="shortlist-compare-replacement-next">' +
            escapeHtml(card.replacement.nextStep) +
            '</div><div class="shortlist-compare-replacement-actions"><a href="' +
            escapeHtml(buildTherapistProfileHref(card.replacement.slug, "shortlist_replacement")) +
            '" class="shortlist-compare-link">' +
            escapeHtml("Review replacement") +
            '</a><button type="button" class="shortlist-compare-replace" data-shortlist-replace="' +
            escapeHtml(card.therapist.slug) +
            '" data-shortlist-replacement-slug="' +
            escapeHtml(card.replacement.slug) +
            '">' +
            escapeHtml(card.replacement.cta || "Use this as replacement") +
            "</button></div></div>"
          : "") +
        '</div></div><div class="shortlist-compare-actions">' +
        '<a href="' +
        escapeHtml(buildTherapistProfileHref(card.therapist.slug, "shortlist_card")) +
        '" class="shortlist-compare-link">' +
        escapeHtml(index === 0 ? "Open lead profile" : "Open saved profile") +
        '</a><button type="button" class="shortlist-compare-drop" data-shortlist-remove="' +
        escapeHtml(card.therapist.slug) +
        '">' +
        escapeHtml(card.pruneCta || "Remove from shortlist") +
        '</button></div><div class="shortlist-compare-guidance">' +
        escapeHtml(roleCopy) +
        "</div></div>"
      );
    })
    .join("");

  var queueCards = [model.leadTherapist, model.backupTherapist]
    .filter(Boolean)
    .map(function (item) {
      return (
        '<article class="shortlist-queue-card"><div class="shortlist-queue-kicker">' +
        escapeHtml(item.title) +
        '</div><div class="shortlist-queue-name">' +
        escapeHtml(item.therapist.name) +
        '</div><div class="shortlist-queue-meta">' +
        escapeHtml(buildCardMeta(item.therapist)) +
        '</div><div class="shortlist-queue-copy">' +
        escapeHtml(item.reason) +
        '</div><div class="shortlist-queue-next-step">' +
        escapeHtml(item.nextStep) +
        '</div><a href="' +
        escapeHtml(
          buildTherapistProfileHref(
            item.therapist.slug,
            item.title === "Contact first" ? "shortlist_lead" : "shortlist_backup",
          ),
        ) +
        '" class="shortlist-compare-link">' +
        escapeHtml(item.title === "Contact first" ? "Open lead profile" : "Open backup profile") +
        "</a></article>"
      );
    })
    .join("");

  var reshapingCards = (model.reshapingSuggestions || [])
    .map(function (item) {
      return (
        '<article class="shortlist-queue-card shortlist-reshaping-card"><div class="shortlist-queue-kicker">' +
        escapeHtml(item.title) +
        '</div><div class="shortlist-queue-name">' +
        escapeHtml(item.name) +
        '</div><div class="shortlist-queue-meta">' +
        escapeHtml(item.meta) +
        '</div><div class="shortlist-queue-copy">' +
        escapeHtml(item.reason) +
        '</div><div class="shortlist-compare-replacement-edge">' +
        escapeHtml(item.edgeCopy || "") +
        '</div><div class="shortlist-replacement-confidence tone-' +
        escapeHtml((item.confidence && item.confidence.tone) || "soft") +
        '"><div class="shortlist-replacement-confidence-label">' +
        escapeHtml((item.confidence && item.confidence.label) || "Replacement confidence") +
        '</div><div class="shortlist-replacement-confidence-copy">' +
        escapeHtml(
          (item.confidence && item.confidence.copy) ||
            "Review this replacement before you reshape the shortlist.",
        ) +
        '</div><div class="shortlist-queue-next-step">' +
        escapeHtml(item.nextStep) +
        '</div><div class="shortlist-reshaping-note">' +
        escapeHtml(item.description) +
        '</div><div class="shortlist-compare-actions"><a href="' +
        escapeHtml(buildTherapistProfileHref(item.slug, "shortlist_reshaping")) +
        '" class="shortlist-compare-link">Review candidate</a><button type="button" class="shortlist-compare-replace" data-shortlist-fill="' +
        escapeHtml(item.slug) +
        '">' +
        escapeHtml(item.cta) +
        "</button></div></article>"
      );
    })
    .join("");
  var reshapingSummary = model.reshapingSummary
    ? '<div class="shortlist-reshaping-summary"><div class="shortlist-section-kicker">' +
      escapeHtml(model.reshapingSummary.title) +
      '</div><div class="shortlist-reshaping-summary-copy">' +
      escapeHtml(model.reshapingSummary.intro) +
      '</div><div class="shortlist-reshaping-summary-list">' +
      (model.reshapingSummary.bullets || [])
        .map(function (item) {
          return '<div class="shortlist-reshaping-summary-item">' + escapeHtml(item) + "</div>";
        })
        .join("") +
      "</div>" +
      (model.reshapingPlan && model.reshapingPlan.changed
        ? '<div class="shortlist-reshaping-review"><div class="shortlist-replacement-confidence-label">' +
          escapeHtml(
            (model.reshapingReview && model.reshapingReview.title) ||
              "Review the reshape before applying it",
          ) +
          '</div><div class="shortlist-reshaping-review-grid">' +
          ((model.reshapingReview && model.reshapingReview.rows) || [])
            .map(function (row) {
              return (
                '<div class="shortlist-reshaping-review-row' +
                (row.changed ? " is-changed" : "") +
                '"><div class="shortlist-reshaping-review-slot">' +
                escapeHtml(row.label) +
                '</div><div class="shortlist-reshaping-review-before">' +
                escapeHtml(row.beforeName) +
                '</div><div class="shortlist-reshaping-review-arrow">→</div><div class="shortlist-reshaping-review-after">' +
                escapeHtml(row.afterName) +
                "</div></div>"
              );
            })
            .join("") +
          '</div><div class="shortlist-reshaping-summary-actions"><button type="button" class="shortlist-compare-replace" data-shortlist-apply-reshaping="' +
          escapeHtml(encodeURIComponent(JSON.stringify(model.reshapingPlan.entries || []))) +
          '">Apply recommended reshape</button></div></div>'
        : "") +
      "</div>"
    : "";

  return {
    html:
      '<div class="shortlist-bar-copy"><strong>' +
      (model.leadTherapist
        ? "Your saved progress is ready to use"
        : model.selected.length +
          " therapist" +
          (model.selected.length === 1 ? "" : "s") +
          " saved") +
      "</strong><span>" +
      escapeHtml(model.queueSummary || model.summary.join(" • ")) +
      "</span>" +
      '<span class="shortlist-bar-progress">This shortlist is saved on this browser, so you can compare now and come back without losing your place.</span>' +
      (model.leadTherapist
        ? '<span class="shortlist-bar-progress">Best sequence: open ' +
          escapeHtml(model.leadTherapist.therapist.name) +
          (model.backupTherapist
            ? ", then keep " + escapeHtml(model.backupTherapist.therapist.name) + " as backup."
            : " first.") +
          "</span>"
        : "") +
      (model.outreachQueueNote
        ? '<span class="shortlist-bar-progress">' + escapeHtml(model.outreachQueueNote) + "</span>"
        : "") +
      (historyState && historyState.summary
        ? '<div class="shortlist-reshaping-history"><div class="shortlist-section-kicker">' +
          escapeHtml(historyState.title || "Last shortlist reshape") +
          '</div><div class="shortlist-reshaping-history-copy">' +
          escapeHtml(historyState.summary) +
          '</div><div class="shortlist-reshaping-history-meta">' +
          escapeHtml(historyState.meta || "") +
          "</div></div>"
        : "") +
      '</div><div class="shortlist-bar-actions"><a href="' +
      escapeHtml(model.outreachQueueUrl) +
      '" class="card-action-primary shortlist-bar-primary" data-start-outreach-queue="true"' +
      (model.leadTherapist
        ? ' data-queue-lead-slug="' + escapeHtml(model.leadTherapist.therapist.slug) + '"'
        : "") +
      ">" +
      escapeHtml(model.outreachQueueLabel || "Start outreach queue") +
      '</a><a href="' +
      escapeHtml(model.compareUrl) +
      '" class="shortlist-bar-link">Compare details</a>' +
      (undoState && undoState.canUndo
        ? '<button type="button" class="shortlist-bar-link shortlist-bar-undo" id="undoDirectoryReshape">' +
          escapeHtml(undoState.label || "Undo reshape") +
          "</button>"
        : "") +
      '<button type="button" class="shortlist-bar-clear" id="clearDirectoryShortlist">Clear</button></div>' +
      (queueCards
        ? '<div class="shortlist-queue-shell"><div class="shortlist-section-header"><div class="shortlist-section-kicker">Decision queue</div><div class="shortlist-section-title">Start with the lead, keep the backup close.</div></div><div class="shortlist-queue-grid">' +
          queueCards +
          "</div></div>"
        : "") +
      (reshapingCards
        ? '<div class="shortlist-queue-shell"><div class="shortlist-section-header"><div class="shortlist-section-kicker">Reshape the shortlist</div><div class="shortlist-section-title">If a saved option weakens, these are the strongest candidates to take the open lead, backup, or reserve slot next.</div></div><div class="shortlist-queue-grid">' +
          reshapingSummary +
          reshapingCards +
          "</div></div>"
        : "") +
      (compareRows
        ? '<div class="shortlist-compare-shell"><div class="shortlist-section-header"><div class="shortlist-section-kicker">Saved comparison</div><div class="shortlist-section-title">Reopen the strongest saved options without rebuilding context.</div></div><div class="shortlist-compare-grid">' +
          compareRows +
          "</div></div>"
        : ""),
  };
}

function buildCardMeta(therapist) {
  return [
    therapist.bipolar_years_experience
      ? therapist.bipolar_years_experience + " yrs bipolar care"
      : "Bipolar depth to confirm",
    therapist.estimated_wait_time ||
      (therapist.accepting_new_patients ? "Accepting" : "Timing to confirm"),
    formatDirectoryFeeLabel(therapist, "Fee details pending"),
  ].join(" • ");
}

export function renderPaginationMarkup(currentPage, pages) {
  if (pages <= 1) {
    return "";
  }

  var html = "";
  if (currentPage > 1) {
    html += '<button class="page-btn" data-page="' + (currentPage - 1) + '">← Prev</button>';
  }

  for (var i = 1; i <= pages; i += 1) {
    if (i === currentPage) {
      html += '<button class="page-btn active">' + i + "</button>";
    } else if (i <= 3 || i > pages - 2 || Math.abs(i - currentPage) <= 1) {
      html += '<button class="page-btn" data-page="' + i + '">' + i + "</button>";
    } else if ((i === 4 && currentPage > 4) || (i === pages - 2 && currentPage < pages - 3)) {
      html += '<span style="padding:.4rem .5rem;color:var(--muted)">…</span>';
    }
  }

  if (currentPage < pages) {
    html += '<button class="page-btn" data-page="' + (currentPage + 1) + '">Next →</button>';
  }

  return html;
}
