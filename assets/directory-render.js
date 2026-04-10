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

export function renderEmptyStateMarkup(directoryPage) {
  return (
    '<div class="empty-state"><h3>' +
    escapeHtml((directoryPage && directoryPage.emptyStateTitle) || "No therapists found") +
    "</h3><p>" +
    escapeHtml(
      (directoryPage && directoryPage.emptyStateDescription) ||
        "Try adjusting your filters or search terms.",
    ) +
    "</p></div>"
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
    '"><div class="directory-decision-preview-main"><div class="directory-decision-preview-kicker">' +
    escapeHtml(model.handoffLabel || "Open this profile first") +
    "</div>" +
    (model.handoffNote
      ? '<div class="directory-decision-preview-handoff-note">' +
        escapeHtml(model.handoffNote) +
        "</div>"
      : "") +
    '<div class="directory-decision-preview-title">' +
    escapeHtml(model.therapist.name) +
    '</div><div class="directory-decision-preview-subtitle">' +
    escapeHtml(model.openReason) +
    '</div><div class="directory-decision-preview-proof">' +
    escapeHtml(model.proofLine) +
    '</div><div class="directory-decision-preview-grid"><div class="directory-decision-preview-card"><div class="directory-decision-preview-label">What you will know fast</div><div class="directory-decision-preview-copy">' +
    escapeHtml(model.learnFastCopy) +
    '</div></div><div class="directory-decision-preview-card"><div class="directory-decision-preview-label">Best next step if it fits</div><div class="directory-decision-preview-copy">' +
    escapeHtml(model.nextStepCopy) +
    '</div></div><div class="directory-decision-preview-card"><div class="directory-decision-preview-label">Best reason to open now</div><div class="directory-decision-preview-copy">' +
    escapeHtml(model.whyNowCopy) +
    '</div></div></div></div><div class="directory-decision-preview-actions"><div class="directory-decision-preview-stats">' +
    model.quickStats
      .map(function (item) {
        return (
          '<div class="directory-decision-preview-stat"><div class="directory-decision-preview-stat-label">' +
          escapeHtml(item.label) +
          '</div><div class="directory-decision-preview-stat-value ' +
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
  var trustTags = model.trustTags
    .map(function (tag) {
      return '<span class="tag tele">' + escapeHtml(tag) + "</span>";
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
  var contactDetail = model.contactRoute
    ? '<div class="card-contact-detail">' +
      escapeHtml(therapist.contact_guidance || model.contactRoute.detail) +
      "</div>"
    : "";
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
  var decisionRow = model.decisionPills
    .map(function (item) {
      return '<span class="card-decision-pill">' + escapeHtml(item) + "</span>";
    })
    .join("");
  var primaryDecisionTitle = model.contactRoute ? model.contactRoute.label : "Open profile first";
  var primaryDecisionCopy =
    model.contactRoute && model.contactRoute.detail
      ? model.contactRoute.detail
      : model.nextStepLine || model.likelyFitCopy;

  return (
    '<article class="t-card" data-card-slug="' +
    escapeHtml(therapist.slug) +
    '">' +
    '<div class="card-hero-rail"><div class="card-hero-kicker">' +
    escapeHtml(model.handoffLabel || "Best profile to open now") +
    '</div><div class="card-hero-title">' +
    escapeHtml(model.openReason || model.fitSummary) +
    '</div><div class="card-hero-copy">' +
    escapeHtml(model.proofLine || model.standoutCopy) +
    "</div></div>" +
    '<div class="t-card-top"><div class="t-avatar">' +
    avatar +
    '</div><div class="t-info"><div class="t-name">' +
    escapeHtml(therapist.name) +
    '</div><div class="t-creds">' +
    escapeHtml(therapist.credentials) +
    (therapist.title ? " · " + escapeHtml(therapist.title) : "") +
    '</div><div class="t-loc">📍 ' +
    escapeHtml(therapist.city) +
    ", " +
    escapeHtml(therapist.state) +
    "</div></div></div>" +
    '<div class="t-bio">' +
    escapeHtml(therapist.bio_preview || therapist.bio || "") +
    "</div>" +
    (model.freshnessBadge
      ? '<div class="card-freshness-banner tone-' +
        escapeHtml(model.freshnessBadge.tone) +
        '"><div class="card-freshness-label">Freshness</div><div class="card-freshness-value">' +
        escapeHtml(model.freshnessBadge.label) +
        '</div><div class="card-freshness-note">' +
        escapeHtml(model.freshnessBadge.note) +
        "</div></div>"
      : "") +
    '<div class="t-fit-summary"><div class="card-fit-summary-label">Fast fit read</div>' +
    escapeHtml(model.fitSummary) +
    '</div><div class="card-fit-note">' +
    escapeHtml(model.likelyFitCopy) +
    "</div>" +
    '<div class="card-primary-decision"><div class="card-primary-decision-label">Recommended move</div><div class="card-primary-decision-title">' +
    escapeHtml(primaryDecisionTitle) +
    '</div><div class="card-primary-decision-copy">' +
    escapeHtml(primaryDecisionCopy) +
    "</div></div>" +
    '<div class="card-quick-stats">' +
    quickStats +
    "</div>" +
    (decisionRow ? '<div class="card-decision-row">' + decisionRow + "</div>" : "") +
    '<div class="card-signal-card"><div class="card-signal-label">Why this stands out</div><div class="card-signal-copy">' +
    escapeHtml(model.standoutCopy) +
    '</div></div><div class="card-signal-card card-signal-card-soft"><div class="card-signal-label">Reachability</div><div class="card-signal-copy">' +
    escapeHtml(model.reachabilityCopy) +
    '</div></div><div class="card-signal-card card-signal-card-soft"><div class="card-signal-label">Decision readiness</div><div class="card-signal-copy">' +
    escapeHtml(model.decisionReadySummary) +
    '</div></div><div class="tags">' +
    tags +
    trustTags +
    mode +
    '</div><div class="card-contact-detail"><strong>Reviewed strength:</strong> ' +
    escapeHtml(model.trustSnapshot) +
    "</div>" +
    (model.operationalTrustCopy && model.operationalTrustCopy !== model.trustSnapshot
      ? '<div class="card-contact-detail">' + escapeHtml(model.operationalTrustCopy) + "</div>"
      : "") +
    (model.reviewedDetailsCopy && model.reviewedDetailsCopy !== model.trustSnapshot
      ? '<div class="card-contact-detail">' + escapeHtml(model.reviewedDetailsCopy) + "</div>"
      : "") +
    '<div class="card-next-step"><div class="card-next-step-label">What happens next</div><div class="card-next-step-copy">' +
    escapeHtml(model.nextStepLine) +
    "</div></div>" +
    contactDetail +
    '<div class="card-actions"><button class="card-action-btn' +
    (model.shortlisted ? " active" : "") +
    '" data-shortlist-slug="' +
    escapeHtml(therapist.slug) +
    '" type="button">' +
    (model.shortlisted ? "Saved to shortlist" : "Save to shortlist") +
    "</button>" +
    primaryAction +
    '<a href="' +
    escapeHtml(buildTherapistProfileHref(therapist.slug, "card_profile")) +
    '" class="card-action-link" data-review-fit="' +
    escapeHtml(therapist.slug) +
    '">View profile</a></div>' +
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
  if (!model.shortlist.length) {
    return {
      html: '<div class="shortlist-bar-copy"><strong>Your compare list is empty.</strong><span>Save up to 3 therapists to narrow your options before you reach out.</span></div><a href="match.html" class="shortlist-bar-link">Start guided match</a>',
    };
  }

  var compareRows = model.compareCards
    .map(function (card) {
      return (
        '<div class="shortlist-compare-card"><div class="shortlist-compare-name">' +
        escapeHtml(card.therapist.name) +
        '</div><div class="shortlist-compare-meta">' +
        escapeHtml(card.meta) +
        '</div><div class="shortlist-compare-note">' +
        escapeHtml(card.note) +
        '</div><a href="' +
        escapeHtml(buildTherapistProfileHref(card.therapist.slug, "shortlist_card")) +
        '" class="shortlist-compare-link">Open profile</a></div>'
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
        '" class="shortlist-compare-link">Open profile</a></article>'
      );
    })
    .join("");

  return {
    html:
      '<div class="shortlist-bar-copy"><strong>' +
      (model.leadTherapist
        ? "Your outreach queue is ready"
        : model.selected.length + " saved for comparison") +
      "</strong><span>" +
      escapeHtml(model.queueSummary || model.summary.join(" • ")) +
      "</span>" +
      (model.outreachQueueNote
        ? '<span class="shortlist-bar-progress">' + escapeHtml(model.outreachQueueNote) + "</span>"
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
      '" class="shortlist-bar-link">Compare details</a><button type="button" class="shortlist-bar-clear" id="clearDirectoryShortlist">Clear</button></div>' +
      (queueCards ? '<div class="shortlist-queue-grid">' + queueCards + "</div>" : "") +
      (compareRows ? '<div class="shortlist-compare-grid">' + compareRows + "</div>" : ""),
  };
}

function buildCardMeta(therapist) {
  return [
    therapist.bipolar_years_experience
      ? therapist.bipolar_years_experience + " yrs bipolar care"
      : "Bipolar depth to confirm",
    therapist.estimated_wait_time ||
      (therapist.accepting_new_patients ? "Accepting" : "Timing to confirm"),
    therapist.session_fee_min || therapist.session_fee_max
      ? "$" +
        String(therapist.session_fee_min || therapist.session_fee_max) +
        (therapist.session_fee_max &&
        String(therapist.session_fee_max) !== String(therapist.session_fee_min || "")
          ? "-$" + String(therapist.session_fee_max)
          : "")
      : therapist.sliding_scale
        ? "Sliding scale"
        : "Fee details pending",
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
