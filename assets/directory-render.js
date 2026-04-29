function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildTherapistProfileHref(slug, source) {
  var cleanSlug = String(slug || "").trim();
  if (cleanSlug && !source) {
    return "/therapists/" + encodeURIComponent(cleanSlug) + "/";
  }
  var params = new URLSearchParams();
  if (source) {
    params.set("source", String(source));
  }
  return source && cleanSlug
    ? "/therapists/" + encodeURIComponent(cleanSlug) + "/?" + params.toString()
    : "therapist.html?slug=" + encodeURIComponent(cleanSlug);
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
    '<div class="empty-state"><div class="empty-state-kicker">No results</div><h3>' +
    escapeHtml((directoryPage && directoryPage.emptyStateTitle) || "No therapists found") +
    "</h3><p>" +
    escapeHtml(
      (directoryPage && directoryPage.emptyStateDescription) ||
        "Try adjusting your filters or search terms.",
    ) +
    '</p><div class="empty-state-grid"><div class="empty-state-card"><div class="empty-state-card-label">Loosen a filter</div><div class="empty-state-card-copy">Remove one filter at a time to see which one is narrowing the field too hard.</div></div><div class="empty-state-card"><div class="empty-state-card-label">Clear ZIP match</div><div class="empty-state-card-copy">The exact-ZIP filter is strict. Clear it, then use the sort-near-ZIP field to prioritize by distance instead.</div></div><div class="empty-state-card"><div class="empty-state-card-label">Try guided match</div><div class="empty-state-card-copy"><a href="match.html" style="color:inherit;text-decoration:underline">Answer four questions</a> for a shorter, more personal list before broadening your search.</div></div></div></div>'
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
      '" data-cta-tier="browse">View profile</a>';

  return (
    '<article class="t-card" data-card-slug="' +
    escapeHtml(therapist.slug) +
    '" data-card-click="' +
    escapeHtml(therapist.slug) +
    '">' +
    '<button type="button" class="t-card-save' +
    (model.shortlisted ? " is-saved" : "") +
    '" data-shortlist-slug="' +
    escapeHtml(therapist.slug) +
    '" aria-label="' +
    (model.shortlisted ? "Remove from saved list" : "Save to list") +
    '" aria-pressed="' +
    (model.shortlisted ? "true" : "false") +
    '">' +
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="' +
    (model.shortlisted ? "currentColor" : "none") +
    '" aria-hidden="true"><path d="M8 12.5L3 9.5C1.5 8.5 1.5 6.5 3 5.5C4.5 4.5 6 5 8 7C10 5 11.5 4.5 13 5.5C14.5 6.5 14.5 8.5 13 9.5L8 12.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>' +
    "</button>" +
    '<div class="t-card-body">' +
    '<div class="t-card-head"><div class="t-avatar">' +
    avatar +
    '</div><div class="t-info"><div class="t-name">' +
    escapeHtml(getTherapistDisplayName(therapist.name)) +
    '</div><div class="t-creds">' +
    escapeHtml(therapist.credentials || "") +
    (therapist.title ? " · " + escapeHtml(therapist.title) : "") +
    "</div></div></div>" +
    (model.metaLine ? '<div class="t-meta-line">' + escapeHtml(model.metaLine) + "</div>" : "") +
    (model.voiceQuote
      ? '<p class="t-card-quote">&ldquo;' + escapeHtml(model.voiceQuote) + "&rdquo;</p>"
      : "") +
    '<div class="t-card-actions">' +
    primaryAction +
    "</div>" +
    "</div>" +
    "</article>"
  );
}

export function renderDirectoryDetailsMarkup(options) {
  var model = options.model;
  if (!model || !model.therapist) {
    return "";
  }

  var therapist = model.therapist;
  var contactHref = model.contactRoute
    ? model.contactRoute.href
    : buildTherapistProfileHref(therapist.slug, "details_contact");
  var profileHref =
    model.profileHref || buildTherapistProfileHref(therapist.slug, "details_profile");

  return (
    '<div class="dir-panel-content">' +
    '<div class="dir-panel-profile-head">' +
    '<h2 class="dir-panel-name">' +
    escapeHtml(getTherapistDisplayName(therapist.name)) +
    "</h2>" +
    '<div class="dir-panel-creds">' +
    escapeHtml(therapist.credentials || "") +
    (therapist.title ? " · " + escapeHtml(therapist.title) : "") +
    "</div>" +
    (model.metaLine ? '<div class="dir-panel-meta">' + escapeHtml(model.metaLine) + "</div>" : "") +
    renderTrustSignals(model.trustSignals.slice(0, 3), "dir-panel-trust") +
    "</div>" +
    '<div class="dir-panel-actions">' +
    (model.contactRoute
      ? '<a href="' +
        escapeHtml(contactHref) +
        '"' +
        (model.contactRoute.external ? ' target="_blank" rel="noopener"' : "") +
        ' class="card-action-primary dir-panel-cta" data-primary-cta="' +
        escapeHtml(therapist.slug) +
        '" data-cta-tier="details">' +
        escapeHtml(model.contactLabel || "Contact therapist") +
        "</a>"
      : "") +
    '<a href="' +
    escapeHtml(profileHref) +
    '" class="dir-panel-profile-link">View full profile →</a>' +
    '<button type="button" class="dir-panel-save' +
    (model.shortlisted ? " is-saved" : "") +
    '" data-shortlist-slug="' +
    escapeHtml(therapist.slug) +
    '" aria-pressed="' +
    (model.shortlisted ? "true" : "false") +
    '">' +
    (model.shortlisted ? "Saved" : "Save to list") +
    "</button>" +
    "</div>" +
    (model.bio ? '<p class="dir-panel-bio">' + escapeHtml(model.bio) + "</p>" : "") +
    '<div class="dir-panel-details-grid">' +
    model.detailSections
      .map(function (section) {
        return (
          '<div class="dir-panel-detail-item"><div class="dir-panel-detail-label">' +
          escapeHtml(section.label) +
          '</div><div class="dir-panel-detail-value">' +
          escapeHtml(section.value) +
          "</div></div>"
        );
      })
      .join("") +
    "</div>" +
    "</div>"
  );
}

export function renderLoadMoreMarkup() {
  return '<button class="dir-load-more-btn" id="dirLoadMoreBtn" type="button">Show more therapists</button>';
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
