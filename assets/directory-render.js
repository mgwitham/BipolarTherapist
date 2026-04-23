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

function renderTrustSignals(signals, className) {
  if (!Array.isArray(signals) || !signals.length) {
    return "";
  }

  return (
    '<div class="' +
    escapeHtml(className) +
    '">' +
    signals
      .map(function (signal) {
        return '<span class="trust-signal">' + escapeHtml(signal) + "</span>";
      })
      .join("") +
    "</div>"
  );
}

function renderFitReasons(model, limit) {
  var items = (model.fitReasons || []).slice(0, limit || 2);
  if (!items.length) {
    return "";
  }

  return (
    '<div class="card-fit-block"><div class="card-fit-title">Why this may be a good fit</div><ul class="card-fit-list">' +
    items
      .map(function (item) {
        return "<li>" + escapeHtml(item) + "</li>";
      })
      .join("") +
    "</ul></div>"
  );
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
    '</p><div class="empty-state-grid"><div class="empty-state-card"><div class="empty-state-card-label">Best next move</div><div class="empty-state-card-copy">Loosen one filter at a time so you can tell which answer is actually narrowing the field too hard.</div></div><div class="empty-state-card"><div class="empty-state-card-label">Keep your progress</div><div class="empty-state-card-copy">You do not need to restart the search. Small refinements usually bring good options back without starting over.</div></div><div class="empty-state-card"><div class="empty-state-card-label">If browsing feels thin</div><div class="empty-state-card-copy">Try the guided match for a smaller, more decision-ready list before widening the search too broadly.</div></div></div></div>'
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
    '"><div class="directory-decision-preview-main"><div class="directory-decision-preview-kicker">Start here</div><div class="directory-decision-preview-title">' +
    escapeHtml(getTherapistDisplayName(model.therapist.name)) +
    '</div><div class="directory-decision-preview-creds">' +
    escapeHtml(model.therapist.credentials || "") +
    (model.therapist.title ? " " + escapeHtml(model.therapist.title) : "") +
    '</div><div class="directory-decision-preview-proof">' +
    escapeHtml(model.locationSummary || "") +
    (model.locationSummary && model.careFormatSummary ? " • " : "") +
    escapeHtml(model.careFormatSummary || "") +
    "</div>" +
    renderTrustSignals(model.trustSignals, "directory-decision-preview-trust") +
    '<div class="directory-decision-preview-fit-label">Why this may be a good fit</div><div class="directory-decision-preview-subtitle">' +
    escapeHtml(model.openReason) +
    "</div>" +
    (model.secondaryReasons && model.secondaryReasons.length
      ? '<div class="directory-decision-preview-supporting">' +
        model.secondaryReasons
          .map(function (reason) {
            return (
              '<span class="directory-decision-preview-supporting-item">' +
              escapeHtml(reason) +
              "</span>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (model.valuePillHtml ? '<div class="value-pill-row">' + model.valuePillHtml + "</div>" : "") +
    '</div><div class="directory-decision-preview-actions"><div class="directory-decision-preview-stats">' +
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
    '</div><div class="directory-decision-preview-next-step">These are strong options to begin with. Contact one now, then come back if you need a backup.</div><div class="directory-decision-preview-cta-group"><a href="' +
    escapeHtml(
      model.contactRoute
        ? model.contactRoute.href
        : buildTherapistProfileHref(model.therapist.slug, "preview_contact"),
    ) +
    '"' +
    (model.contactRoute && model.contactRoute.external ? ' target="_blank" rel="noopener"' : "") +
    ' class="card-action-primary" data-primary-cta="' +
    escapeHtml(model.therapist.slug) +
    '" data-cta-tier="featured">' +
    escapeHtml(model.contactLabel || "Contact therapist") +
    '</a><button type="button" class="card-action-secondary" data-view-details="' +
    escapeHtml(model.therapist.slug) +
    '" data-details-tier="featured">View details</button><button type="button" class="card-save-link' +
    (model.shortlisted ? " active" : "") +
    '" data-preview-shortlist="' +
    escapeHtml(model.therapist.slug) +
    '">' +
    (model.shortlisted ? "Saved" : "Save") +
    "</button></div></div></section>"
  );
}

export function renderDirectoryRecommendationsMarkup(options) {
  var model = options.model;
  if (!model || !model.featured) {
    return "";
  }

  return (
    '<section class="directory-recommendations" aria-labelledby="directoryRecommendationsTitle"><div class="directory-recommendations-head"><div><div class="directory-recommendations-kicker">' +
    escapeHtml(model.recommendationKicker || "Strong starting options") +
    '</div><h2 id="directoryRecommendationsTitle">' +
    escapeHtml(
      model.recommendationTitle || "Start with one strong option, then use the backups if needed.",
    ) +
    '</h2><p class="directory-recommendations-copy">' +
    escapeHtml(
      model.recommendationCopy ||
        "You do not need to get this perfect. These are strong options to begin with.",
    ) +
    "</p>" +
    (model.recommendationContext
      ? '<p class="directory-recommendations-context">' +
        escapeHtml(model.recommendationContext) +
        "</p>"
      : "") +
    '</div><p class="directory-recommendations-reassurance">' +
    escapeHtml(
      model.recommendationReassurance || "You can contact one now and come back if needed.",
    ) +
    "</p></div>" +
    renderDirectoryDecisionPreviewMarkup({ model: model.featured }) +
    (model.backups.length
      ? '<div class="directory-backups"><div class="directory-backups-label">Backup options</div><div class="directory-backups-grid">' +
        model.backups
          .map(function (backup) {
            return renderBackupCardMarkup({ model: backup });
          })
          .join("") +
        "</div></div>"
      : "") +
    "</section>"
  );
}

export function renderBackupCardMarkup(options) {
  var model = options.model;
  var therapist = model.therapist;

  return (
    '<article class="directory-backup-card" data-card-slug="' +
    escapeHtml(therapist.slug) +
    '"><div class="directory-backup-card-label">Backup</div><div class="directory-backup-card-name">' +
    escapeHtml(getTherapistDisplayName(therapist.name)) +
    '</div><div class="directory-backup-card-creds">' +
    escapeHtml(therapist.credentials || "") +
    (therapist.title ? " " + escapeHtml(therapist.title) : "") +
    '</div><div class="directory-backup-card-meta">' +
    escapeHtml(model.locationSummary || "") +
    (model.locationSummary && model.careFormatSummary ? " • " : "") +
    escapeHtml(model.careFormatSummary || "") +
    "</div>" +
    renderTrustSignals(model.trustSignals.slice(0, 3), "directory-backup-card-trust") +
    renderFitReasons(model, 2) +
    '<div class="directory-backup-card-actions"><a href="' +
    escapeHtml(
      model.contactRoute
        ? model.contactRoute.href
        : buildTherapistProfileHref(therapist.slug, "backup_contact"),
    ) +
    '"' +
    (model.contactRoute && model.contactRoute.external ? ' target="_blank" rel="noopener"' : "") +
    ' class="card-action-primary" data-primary-cta="' +
    escapeHtml(therapist.slug) +
    '" data-cta-tier="backup">Contact therapist</a><button type="button" class="card-action-secondary" data-view-details="' +
    escapeHtml(therapist.slug) +
    '" data-details-tier="backup">View details</button><button type="button" class="card-save-link' +
    (model.shortlisted ? " active" : "") +
    '" data-shortlist-slug="' +
    escapeHtml(therapist.slug) +
    '">' +
    (model.shortlisted ? "Saved" : "Save") +
    "</button></div></article>"
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
      '" loading="lazy" decoding="async" />'
    : escapeHtml(initials);
  var primaryAction = model.contactRoute
    ? '<a href="' +
      escapeHtml(model.contactRoute.href) +
      '"' +
      (model.contactRoute.external ? ' target="_blank" rel="noopener"' : "") +
      ' class="card-action-primary" data-primary-cta="' +
      escapeHtml(therapist.slug) +
      '" data-cta-tier="browse">' +
      escapeHtml(model.contactLabel || "Contact therapist") +
      "</a>"
    : '<a href="' +
      escapeHtml(buildTherapistProfileHref(therapist.slug, "card_primary")) +
      '" class="card-action-primary" data-primary-cta="' +
      escapeHtml(therapist.slug) +
      '" data-cta-tier="browse">Contact therapist</a>';

  return (
    '<article class="t-card" data-card-slug="' +
    escapeHtml(therapist.slug) +
    '">' +
    '<div class="t-card-top"><div class="t-card-head"><div class="t-avatar">' +
    avatar +
    '</div><div class="t-info"><div class="t-name">' +
    escapeHtml(getTherapistDisplayName(therapist.name)) +
    '</div><div class="t-creds">' +
    escapeHtml(therapist.credentials) +
    (therapist.title ? " " + escapeHtml(therapist.title) : "") +
    '</div><div class="t-loc">' +
    escapeHtml(model.locationSummary || "") +
    (model.locationSummary && model.careFormatSummary ? " • " : "") +
    escapeHtml(model.careFormatSummary || "") +
    '</div></div><div class="card-header-status"><div class="card-header-availability ' +
    escapeHtml(model.acceptanceTone) +
    '">' +
    escapeHtml(model.acceptance) +
    '</div><div class="card-header-fee">' +
    escapeHtml(model.availabilitySummary || model.feeSummary) +
    "</div></div></div>" +
    renderTrustSignals(model.trustSignals.slice(0, 2), "card-trust-signals") +
    '<p class="card-fit-summary">' +
    escapeHtml(model.fitSummary) +
    '</p><div class="card-highlights"><span>' +
    escapeHtml(model.feeSummary) +
    "</span>" +
    (model.valuePillHtml ? '<div class="value-pill-row">' + model.valuePillHtml + "</div>" : "") +
    "</div>" +
    '<div class="card-actions"><button type="button" class="card-action-secondary" data-view-details="' +
    escapeHtml(therapist.slug) +
    '" data-details-tier="browse">View details</button>' +
    primaryAction +
    '<button class="card-save-link' +
    (model.shortlisted ? " active" : "") +
    '" data-shortlist-slug="' +
    escapeHtml(therapist.slug) +
    '" type="button">' +
    (model.shortlisted ? "Saved" : "Save") +
    "</div>" +
    "</article>"
  );
}

export function renderDirectoryDetailsMarkup(options) {
  var model = options.model;
  if (!model || !model.therapist) {
    return "";
  }

  return (
    '<div class="directory-details-sheet"><div class="directory-details-intro"><div><div class="directory-details-kicker">View details</div><h2 class="directory-details-name">' +
    escapeHtml(getTherapistDisplayName(model.therapist.name)) +
    '</h2><div class="directory-details-creds">' +
    escapeHtml(model.therapist.credentials || "") +
    (model.therapist.title ? " " + escapeHtml(model.therapist.title) : "") +
    '</div><div class="directory-details-meta">' +
    escapeHtml(model.locationSummary || "") +
    (model.locationSummary && model.careFormatSummary ? " • " : "") +
    escapeHtml(model.careFormatSummary || "") +
    "</div></div>" +
    renderTrustSignals(model.trustSignals, "directory-details-trust") +
    '<div class="directory-details-actions"><a href="' +
    escapeHtml(
      model.contactRoute
        ? model.contactRoute.href
        : buildTherapistProfileHref(model.therapist.slug, "details_contact"),
    ) +
    '"' +
    (model.contactRoute && model.contactRoute.external ? ' target="_blank" rel="noopener"' : "") +
    ' class="card-action-primary" data-primary-cta="' +
    escapeHtml(model.therapist.slug) +
    '" data-cta-tier="details">Contact therapist</a><button type="button" class="card-save-link' +
    (model.shortlisted ? " active" : "") +
    '" data-shortlist-slug="' +
    escapeHtml(model.therapist.slug) +
    '">' +
    (model.shortlisted ? "Saved" : "Save") +
    '</button></div></div><div class="directory-details-reassurance">' +
    escapeHtml(model.reassurance) +
    "</div>" +
    renderFitReasons(model, 3) +
    '<div class="directory-details-grid">' +
    model.detailSections
      .map(function (section) {
        return (
          '<div class="directory-details-item"><div class="directory-details-item-label">' +
          escapeHtml(section.label) +
          '</div><div class="directory-details-item-value">' +
          escapeHtml(section.value) +
          "</div></div>"
        );
      })
      .join("") +
    "</div></div>"
  );
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
