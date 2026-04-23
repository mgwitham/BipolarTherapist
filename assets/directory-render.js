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
    '"><div class="directory-decision-preview-main"><div class="directory-decision-preview-kicker">Recommended profile</div><div class="directory-decision-preview-title">' +
    escapeHtml(getTherapistDisplayName(model.therapist.name)) +
    '</div><div class="directory-decision-preview-creds">' +
    escapeHtml(model.therapist.credentials || "") +
    (model.therapist.title ? " " + escapeHtml(model.therapist.title) : "") +
    '</div><div class="directory-decision-preview-proof">📍 ' +
    escapeHtml(model.therapist.city || "") +
    (model.therapist.city && model.therapist.state ? ", " : "") +
    escapeHtml(model.therapist.state || "") +
    "</div>" +
    '<div class="directory-decision-preview-subtitle">' +
    escapeHtml(model.openReason) +
    "</div>" +
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
    '</div><div class="directory-decision-preview-cta-group"><a href="' +
    escapeHtml(buildTherapistProfileHref(model.therapist.slug, "preview")) +
    '" class="card-action-primary" data-preview-open-profile="' +
    escapeHtml(model.therapist.slug) +
    '">Open profile</a><button type="button" class="card-action-btn' +
    (model.shortlisted ? " active" : "") +
    '" data-preview-shortlist="' +
    escapeHtml(model.therapist.slug) +
    '">' +
    (model.shortlisted ? "Saved to list" : "Save to list") +
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
      '" loading="lazy" decoding="async" />'
    : escapeHtml(initials);
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
    (model.valuePillHtml ? '<div class="value-pill-row">' + model.valuePillHtml + "</div>" : "") +
    '<div class="card-actions"><a href="' +
    escapeHtml(profileHref) +
    '" class="card-open-profile-btn" data-review-fit="' +
    escapeHtml(therapist.slug) +
    '">Open full profile</a><button class="card-action-btn' +
    (model.shortlisted ? " active" : "") +
    '" data-shortlist-slug="' +
    escapeHtml(therapist.slug) +
    '" type="button">' +
    (model.shortlisted ? "Saved to list" : "Save to list") +
    "</button>" +
    primaryAction +
    "</div>" +
    (model.shortlisted
      ? '<div class="card-note-row"><label class="card-priority-label" for="note-' +
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
    "</article>"
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
