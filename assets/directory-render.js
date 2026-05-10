import {
  renderRoundAvatar,
  renderSpecialtyPills,
  getCardLocationLabel,
  getFeeLabel,
  getInsuranceLabel,
  renderAvailabilityBadge,
} from "./card-content.js";
import { renderOutreachPanelMarkup } from "./outreach-scripts.js";
import { escapeHtml } from "./escape-html.js";

var DIR_REASON_GENERIC = {
  "bipolar disorder": true,
  "bipolar i": true,
  "bipolar ii": true,
  "bipolar 1": true,
  "bipolar 2": true,
  "mood disorder": true,
  "mood disorders": true,
  psychosis: true,
};

function buildDirectoryReasonLine(therapist) {
  var t = therapist || {};
  var years = Number(t.bipolar_years_experience || 0);
  if (years > 0) {
    return years + " yr" + (years === 1 ? "" : "s") + " bipolar experience";
  }
  var specs = Array.isArray(t.specialties) ? t.specialties : [];
  for (var i = 0; i < specs.length; i++) {
    var s = String(specs[i] || "").trim();
    if (/bipolar|cycl|mixed/i.test(s) && !DIR_REASON_GENERIC[s.toLowerCase()]) {
      return s + " specialist";
    }
  }
  return "";
}

function buildDirectoryInfoRow(therapist) {
  var t = therapist || {};
  var parts = [];

  var locLabel = getCardLocationLabel(t, {});
  if (locLabel) parts.push('<span class="bth-card-info-item">' + escapeHtml(locLabel) + "</span>");

  var feeLabel = getFeeLabel(t);
  if (feeLabel) parts.push('<span class="bth-card-info-item">' + escapeHtml(feeLabel) + "</span>");

  var availHtml = renderAvailabilityBadge(t);
  if (availHtml) parts.push('<span class="bth-card-info-item">' + availHtml + "</span>");

  var insLabel = getInsuranceLabel(t);
  if (insLabel) parts.push('<span class="bth-card-info-item">' + escapeHtml(insLabel) + "</span>");

  if (!parts.length) return "";
  return (
    '<div class="bth-card-info">' +
    parts.join('<span class="bth-card-info-dot" aria-hidden="true">·</span>') +
    "</div>"
  );
}

function buildTherapistProfileHref(slug, source) {
  var cleanSlug = String(slug || "").trim();
  var params = new URLSearchParams();
  params.set("ref", "directory");
  if (source) {
    params.set("source", String(source));
  }
  return cleanSlug
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
    '</p><div class="empty-state-grid"><div class="empty-state-card"><div class="empty-state-card-label">Loosen a filter</div><div class="empty-state-card-copy">Remove one filter at a time to see which one is narrowing the field too hard.</div></div><div class="empty-state-card"><div class="empty-state-card-label">Clear ZIP match</div><div class="empty-state-card-copy">The exact-ZIP filter is strict. Clear it, then use the sort-near-ZIP field to prioritize by distance instead.</div></div><div class="empty-state-card"><div class="empty-state-card-label">Try guided match</div><div class="empty-state-card-copy"><a href="/match.html" style="color:inherit;text-decoration:underline">Answer four questions</a> for a shorter, more personal list before broadening your search.</div></div></div></div>'
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
    (model.contactRoute && model.contactRoute.external
      ? ' target="_blank" rel="noopener noreferrer"'
      : "") +
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
    (model.contactRoute && model.contactRoute.external
      ? ' target="_blank" rel="noopener noreferrer"'
      : "") +
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

// Bipolar subtype keywords used to derive the expertise-band line. Matches
// the new design's "Bipolar I, Bipolar II, Cyclothymia" surface.
var BIPOLAR_SUBTYPE_PATTERNS = [
  { match: /bipolar\s*i+\b|bipolar\s*2/i, label: "Bipolar II" },
  { match: /bipolar\s*i\b|bipolar\s*1\b/i, label: "Bipolar I" },
  { match: /cyclothym/i, label: "Cyclothymia" },
];
function getBipolarSubtypes(therapist) {
  var specs = Array.isArray(therapist.specialties) ? therapist.specialties : [];
  var found = [];
  BIPOLAR_SUBTYPE_PATTERNS.forEach(function (pat) {
    var hit = specs.some(function (s) {
      return pat.match.test(String(s || ""));
    });
    if (hit && found.indexOf(pat.label) === -1) found.push(pat.label);
  });
  return found;
}

function buildExpertiseBand(therapist) {
  var t = therapist || {};
  var years = Number(t.bipolar_years_experience || 0);
  var subtypes = getBipolarSubtypes(t);
  var modalities = (Array.isArray(t.treatment_modalities) ? t.treatment_modalities : [])
    .map(function (m) {
      return String(m || "").trim();
    })
    .filter(Boolean)
    .slice(0, 3);

  var line1 = "";
  var line2 = "";
  if (years > 0) {
    line1 = years + " yr" + (years === 1 ? "" : "s") + " bipolar experience";
    line2 = subtypes.concat(modalities).slice(0, 4).join(" · ");
  } else if (subtypes.length) {
    line1 = subtypes.join(" · ");
    line2 = modalities.join(" · ");
  } else if (modalities.length) {
    line1 = modalities.join(" · ");
  } else {
    line1 = "Bipolar specialist";
  }

  return (
    '<div class="dir-card-expertise">' +
    '<div class="dir-card-expertise-line">' +
    escapeHtml(line1) +
    "</div>" +
    (line2
      ? '<div class="dir-card-expertise-sub">' + escapeHtml(line2) + "</div>"
      : "") +
    "</div>"
  );
}

function buildAvailabilityRow(therapist) {
  var t = therapist || {};
  if (t.accepting_new_patients === true) {
    return (
      '<div class="dir-card-avail dir-card-avail--open">' +
      '<span class="dir-card-avail-dot" aria-hidden="true"></span>' +
      "Available now" +
      "</div>"
    );
  }
  if (t.accepting_new_patients === false) {
    return (
      '<div class="dir-card-avail dir-card-avail--closed">' +
      '<span class="dir-card-avail-dot" aria-hidden="true"></span>' +
      "Not currently accepting" +
      "</div>"
    );
  }
  return "";
}

function buildFormatPriceRow(therapist) {
  var t = therapist || {};
  var mode = "";
  if (t.accepts_telehealth && t.accepts_in_person) mode = "In-person & telehealth";
  else if (t.accepts_telehealth) mode = "Telehealth";
  else if (t.accepts_in_person) mode = "In-person";

  var fee = "";
  if (t.session_fee_min) {
    var max = t.session_fee_max && t.session_fee_max !== t.session_fee_min;
    fee = "$" + t.session_fee_min + (max ? "–$" + t.session_fee_max : "") + "/session";
  }

  var parts = [mode, fee].filter(Boolean);
  if (!parts.length) return "";
  return '<div class="dir-card-format">' + escapeHtml(parts.join(" · ")) + "</div>";
}

function buildInsuranceLine(therapist) {
  var list = Array.isArray(therapist.insurance_accepted)
    ? therapist.insurance_accepted.filter(Boolean)
    : [];
  if (!list.length) return "";
  var visible = list.slice(0, 2);
  var overflow = list.length - visible.length;
  var copy = visible.join(", ") + (overflow > 0 ? " +" + overflow + " more" : "");
  return '<div class="dir-card-insurance">' + escapeHtml(copy) + "</div>";
}

export function renderCardMarkup(options) {
  var model = options.model;
  var therapist = model.therapist;
  var primaryHref = buildTherapistProfileHref(therapist.slug, "card_primary");

  return (
    '<article class="t-card dir-card" data-card-slug="' +
    escapeHtml(therapist.slug) +
    '" data-card-click="' +
    escapeHtml(therapist.slug) +
    '">' +
    '<button type="button" class="t-card-save dir-card-save' +
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
    '" aria-hidden="true"><path d="M4 2h8a1 1 0 0 1 1 1v10.5l-5-3-5 3V3a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>' +
    "</button>" +
    '<div class="dir-card-body">' +
    '<div class="dir-card-head">' +
    '<div class="dir-card-avatar">' +
    renderRoundAvatar(therapist, "card") +
    "</div>" +
    '<div class="dir-card-id">' +
    '<div class="dir-card-name">' +
    escapeHtml(getTherapistDisplayName(therapist.name)) +
    "</div>" +
    (therapist.credentials || therapist.title
      ? '<div class="dir-card-creds">' +
        escapeHtml(
          [therapist.credentials, therapist.title].filter(Boolean).join(" · "),
        ) +
        "</div>"
      : "") +
    "</div>" +
    "</div>" +
    buildExpertiseBand(therapist) +
    buildAvailabilityRow(therapist) +
    buildFormatPriceRow(therapist) +
    buildInsuranceLine(therapist) +
    '<div class="dir-card-spacer"></div>' +
    '<div class="dir-card-actions">' +
    '<a href="' +
    escapeHtml(primaryHref) +
    '" class="dir-card-cta" data-primary-cta="' +
    escapeHtml(therapist.slug) +
    '" data-cta-tier="browse">View profile →</a>' +
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

  // Avatar: photo or clean initials block
  var initials = therapist.name
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(function (p) {
      return p.charAt(0);
    })
    .join("")
    .slice(0, 2)
    .toUpperCase();
  var avatarHtml = therapist.photo_url
    ? '<img class="dir-panel-avatar-img" src="' +
      escapeHtml(therapist.photo_url) +
      '" alt="' +
      escapeHtml(therapist.name) +
      '" loading="lazy" decoding="async" />'
    : '<div class="dir-panel-avatar-initials" aria-hidden="true">' +
      escapeHtml(initials) +
      "</div>";

  // Credential + role line — prefer full title over abbreviation
  var credLine = therapist.title
    ? escapeHtml(therapist.title)
    : escapeHtml(therapist.credentials || "");

  // Identity strip
  var identityHtml =
    '<div class="dir-panel-identity">' +
    '<div class="dir-panel-avatar">' +
    avatarHtml +
    "</div>" +
    '<div class="dir-panel-identity-info">' +
    '<h2 class="dir-panel-name">' +
    escapeHtml(getTherapistDisplayName(therapist.name)) +
    "</h2>" +
    (credLine ? '<div class="dir-panel-creds">' + credLine + "</div>" : "") +
    (model.locationSummary
      ? '<div class="dir-panel-location">' + escapeHtml(model.locationSummary) + "</div>"
      : "") +
    "</div>" +
    "</div>";

  // Quick-answer pills (conditional — absent if all data missing)
  var pills = Array.isArray(model.quickAnswerPills) ? model.quickAnswerPills : [];
  var pillsHtml = pills.length
    ? '<div class="dir-panel-pills" aria-label="Quick overview">' +
      pills
        .map(function (pill) {
          return '<span class="dir-panel-pill">' + escapeHtml(pill) + "</span>";
        })
        .join("") +
      "</div>"
    : "";

  // Bipolar approach section (conditional)
  var bipolarHtml = model.bipolarApproach
    ? '<div class="dir-panel-approach">' +
      '<div class="dir-panel-section-label">Bipolar approach</div>' +
      '<p class="dir-panel-approach-text">' +
      escapeHtml(model.bipolarApproach) +
      "</p>" +
      "</div>"
    : "";

  // Trust strip (editorial/clinical signals only, conditional)
  var panelTrust = Array.isArray(model.panelTrustSignals) ? model.panelTrustSignals : [];
  var trustHtml = renderTrustSignals(panelTrust, "dir-panel-trust");

  // About/bio — more vertical presence when it carries the panel alone
  var bioHtml = "";
  if (model.bio) {
    var isMinimal = !pillsHtml && !bipolarHtml && !trustHtml;
    bioHtml =
      '<p class="dir-panel-bio' +
      (isMinimal ? " dir-panel-bio--prominent" : "") +
      '">' +
      escapeHtml(model.bio) +
      "</p>";
  }

  // Details grid (conditional — absent when no sections)
  var sections = Array.isArray(model.detailSections) ? model.detailSections : [];
  var detailsHtml = sections.length
    ? '<div class="dir-panel-details-grid">' +
      sections
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
      "</div>"
    : "";

  // Actions: Contact (primary), Save to list, View full profile
  var actionsHtml =
    '<div class="dir-panel-actions">' +
    (model.contactRoute
      ? '<a href="' +
        escapeHtml(contactHref) +
        '"' +
        (model.contactRoute.external ? ' target="_blank" rel="noopener noreferrer"' : "") +
        ' class="card-action-primary dir-panel-cta" data-primary-cta="' +
        escapeHtml(therapist.slug) +
        '" data-cta-tier="details">' +
        escapeHtml(model.contactLabel || "Contact therapist") +
        "</a>"
      : "") +
    '<button type="button" class="dir-panel-save' +
    (model.shortlisted ? " is-saved" : "") +
    '" data-shortlist-slug="' +
    escapeHtml(therapist.slug) +
    '" aria-pressed="' +
    (model.shortlisted ? "true" : "false") +
    '" aria-label="' +
    (model.shortlisted ? "Remove from saved list" : "Save to list") +
    '">' +
    (model.shortlisted ? "Saved" : "Save to list") +
    "</button>" +
    '<a href="' +
    escapeHtml(profileHref) +
    '" class="dir-panel-profile-link">View full profile →</a>' +
    "</div>";

  return (
    '<div class="dir-panel-content">' +
    identityHtml +
    pillsHtml +
    bipolarHtml +
    trustHtml +
    bioHtml +
    detailsHtml +
    actionsHtml +
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

// ── Bottom sheet helpers ──────────────────────────────────────────────────────

function bshContactIcon(method, href) {
  var resolved = method || "";
  if (!resolved && href) {
    if (href.startsWith("tel:")) resolved = "phone";
    else if (href.startsWith("mailto:")) resolved = "email";
    else if (/book|calendly|acuity|schedule/i.test(href)) resolved = "booking";
  }
  switch (resolved) {
    case "phone":
      return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 2h3l1.5 3.5-1.75 1.25C6.5 8.5 7.5 9.5 8.25 10.25L9.5 8.5 13 10v3a1 1 0 01-1 1C5.5 14 2 10.5 2 3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    case "booking":
      return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5 2v2M11 2v2M2 7h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    case "intake_form":
    case "website":
      return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 2c-1.5 2-2.5 3.8-2.5 6s1 4 2.5 6M8 2c1.5 2 2.5 3.8 2.5 6s-1 4-2.5 6M2 8h12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
    default:
      return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="4" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M2 5l6 5 6-5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  }
}

function bshInsuranceHtml(plans, slug) {
  var safeSlug = escapeHtml(slug);
  if (!plans.length) {
    return (
      '<div class="bsh-ins-pill-wrap">' +
      '<span class="bsh-ins-self-pay">Self-pay only</span>' +
      "</div>" +
      '<div class="bsh-ins-note">No insurance accepted.</div>'
    );
  }
  if (plans.length <= 3) {
    return (
      '<div class="bsh-ins-pill-wrap">' +
      plans
        .map(function (p) {
          return '<span class="bsh-ins-pill">' + escapeHtml(p) + "</span>";
        })
        .join("") +
      "</div>"
    );
  }
  if (plans.length < 20) {
    // Collapsed: first 3 + chip. Expanded: ALL plans so nothing disappears on open.
    var shown = plans.slice(0, 3);
    return (
      '<div data-ins-collapsed="' +
      safeSlug +
      '">' +
      '<div class="bsh-ins-pill-wrap">' +
      shown
        .map(function (p) {
          return '<span class="bsh-ins-pill">' + escapeHtml(p) + "</span>";
        })
        .join("") +
      '<button type="button" class="bsh-ins-more-chip" data-ins-expand="' +
      safeSlug +
      '">+' +
      (plans.length - 3) +
      " more</button>" +
      "</div>" +
      "</div>" +
      '<div class="bsh-ins-expanded" hidden>' +
      '<div class="bsh-ins-pill-wrap">' +
      plans
        .map(function (p) {
          return '<span class="bsh-ins-pill">' + escapeHtml(p) + "</span>";
        })
        .join("") +
      "</div>" +
      '<button type="button" class="bsh-ins-less" data-ins-collapse="' +
      safeSlug +
      '">Show less</button>' +
      "</div>"
    );
  }
  // 20+ plans — collapsed with live search
  return (
    '<div class="bsh-ins-collapsed-row" data-ins-collapsed="' +
    safeSlug +
    '">' +
    '<span class="bsh-ins-many-label">Accepts 20+ insurance plans</span>' +
    '<button type="button" class="bsh-ins-see-all" data-ins-expand="' +
    safeSlug +
    '">See all plans</button>' +
    "</div>" +
    '<div class="bsh-ins-expanded" hidden>' +
    '<input type="search" class="bsh-ins-search" placeholder="Search plans…" data-ins-search="' +
    safeSlug +
    '" autocomplete="off" />' +
    '<div class="bsh-ins-pill-wrap" data-ins-plan-list="' +
    safeSlug +
    '">' +
    plans
      .map(function (p) {
        return (
          '<span class="bsh-ins-pill" data-plan-name="' +
          escapeHtml(p.toLowerCase()) +
          '">' +
          escapeHtml(p) +
          "</span>"
        );
      })
      .join("") +
    "</div>" +
    '<button type="button" class="bsh-ins-less" data-ins-collapse="' +
    safeSlug +
    '">Show less</button>' +
    "</div>"
  );
}

export function renderBottomSheetMarkup(options) {
  var model = options.model;
  var therapist = model.therapist;
  var slug = therapist.slug || "";

  // Avatar
  var initials = therapist.name
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(function (p) {
      return p.charAt(0);
    })
    .join("")
    .slice(0, 2)
    .toUpperCase();
  var avatarInner = therapist.photo_url
    ? '<img class="bsh-avatar-img" src="' +
      escapeHtml(therapist.photo_url) +
      '" alt="' +
      escapeHtml(therapist.name) +
      '" loading="lazy" decoding="async" />'
    : '<div class="bsh-avatar-initials" aria-hidden="true">' + escapeHtml(initials) + "</div>";

  // Credential line
  var credLine = escapeHtml(therapist.credentials || "");
  if (therapist.title) {
    credLine += (credLine ? " · " : "") + escapeHtml(therapist.title);
  }

  // Location + distance pill
  var locationRowHtml = "";
  if (model.locationSummary || model.distancePill) {
    locationRowHtml = '<div class="bsh-location-row">';
    if (model.locationSummary) {
      locationRowHtml +=
        '<span class="bsh-location">' + escapeHtml(model.locationSummary) + "</span>";
    }
    if (model.distancePill) {
      locationRowHtml +=
        '<span class="bsh-distance-pill">' + escapeHtml(model.distancePill) + "</span>";
    }
    locationRowHtml += "</div>";
  }

  // Price
  var priceHtml = model.feeDisplay
    ? '<div class="bsh-price">' + escapeHtml(model.feeDisplay) + "</div>"
    : "";

  // Availability chips
  var chipsHtml = "";
  if (Array.isArray(model.availabilityChips) && model.availabilityChips.length) {
    chipsHtml =
      '<div class="bsh-avail-chips">' +
      model.availabilityChips
        .map(function (chip) {
          return (
            '<span class="bsh-avail-chip bsh-avail-chip--' +
            escapeHtml(chip.tone) +
            '">' +
            escapeHtml(chip.label) +
            "</span>"
          );
        })
        .join("") +
      "</div>";
  }

  // Bookmark button (top bar, left)
  var bookmarkSaved = Boolean(model.shortlisted);
  var bookmarkHtml =
    '<button type="button" class="bsh-topbar-btn' +
    (bookmarkSaved ? " is-saved" : "") +
    '" data-shortlist-slug="' +
    escapeHtml(slug) +
    '" aria-label="' +
    (bookmarkSaved ? "Remove from saved list" : "Save to list") +
    '" aria-pressed="' +
    (bookmarkSaved ? "true" : "false") +
    '">' +
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="' +
    (bookmarkSaved ? "currentColor" : "none") +
    '" aria-hidden="true"><path d="M4 2h8a1 1 0 0 1 1 1v10.5l-5-3-5 3V3a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>' +
    "</button>";

  // Close button (top bar, right) — reuses existing ID for focus management
  var closeHtml =
    '<button type="button" class="bsh-topbar-btn" id="directoryDetailsClose" aria-label="Close">' +
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
    "</button>";

  var topbarHtml =
    '<div class="bsh-topbar">' +
    bookmarkHtml +
    '<div class="bsh-topbar-spacer"></div>' +
    closeHtml +
    "</div>";

  var headerHtml =
    '<div class="bsh-header">' +
    '<div class="bsh-header-identity">' +
    '<div class="bsh-avatar">' +
    avatarInner +
    "</div>" +
    '<div class="bsh-identity-info">' +
    '<div class="bsh-name">' +
    escapeHtml(getTherapistDisplayName(therapist.name)) +
    "</div>" +
    (credLine ? '<div class="bsh-creds">' + credLine + "</div>" : "") +
    locationRowHtml +
    "</div>" +
    "</div>" +
    priceHtml +
    chipsHtml +
    "</div>";

  // Bio with gradient fade + read-more toggle
  var bioHtml = "";
  if (model.bio) {
    bioHtml =
      '<div class="bsh-divider"></div>' +
      '<div class="bsh-bio-section">' +
      '<div class="bsh-bio-wrap">' +
      '<div class="bsh-bio-text" id="bsh-bio-' +
      escapeHtml(slug) +
      '">' +
      escapeHtml(model.bio) +
      "</div>" +
      '<div class="bsh-bio-fade" id="bsh-bio-fade-' +
      escapeHtml(slug) +
      '" aria-hidden="true"></div>' +
      "</div>" +
      '<button type="button" class="bsh-bio-toggle" data-bio-toggle="' +
      escapeHtml(slug) +
      '">Read more ↓</button>' +
      "</div>";
  }

  // Bipolar approach — the single most differentiating field for this directory
  var bipolarHtml = "";
  if (model.bipolarApproach) {
    bipolarHtml =
      '<div class="bsh-divider"></div>' +
      '<div class="bsh-bipolar-section">' +
      '<div class="bsh-section-label">Bipolar approach</div>' +
      '<p class="bsh-bipolar-text">' +
      escapeHtml(model.bipolarApproach) +
      "</p>" +
      "</div>";
  }

  // Specialties & Populations — "Bipolar disorder" always sorts first
  var specialties = (Array.isArray(therapist.specialties) ? therapist.specialties : [])
    .slice()
    .sort(function (a, b) {
      var aB = /bipolar/i.test(a);
      var bB = /bipolar/i.test(b);
      return aB === bB ? 0 : aB ? -1 : 1;
    });
  var populations = Array.isArray(therapist.client_populations) ? therapist.client_populations : [];
  var specsHtml = "";
  if (specialties.length || populations.length) {
    specsHtml =
      '<div class="bsh-divider"></div><div class="bsh-specs-section"><div class="bsh-specs-row">';
    if (specialties.length) {
      specsHtml +=
        '<div class="bsh-specs-col">' +
        '<div class="bsh-section-label">Specialties</div>' +
        '<div class="bsh-pill-row">' +
        specialties
          .map(function (s) {
            return '<span class="bsh-spec-pill">' + escapeHtml(s) + "</span>";
          })
          .join("") +
        "</div></div>";
    }
    if (populations.length) {
      specsHtml +=
        '<div class="bsh-specs-col">' +
        '<div class="bsh-section-label">Serves</div>' +
        '<div class="bsh-pill-row">' +
        populations
          .map(function (p) {
            return '<span class="bsh-spec-pill">' + escapeHtml(p) + "</span>";
          })
          .join("") +
        "</div></div>";
    }
    specsHtml += "</div></div>";
  }

  // Insurance
  var plans = Array.isArray(therapist.insurance_accepted) ? therapist.insurance_accepted : [];
  var insuranceHtml =
    '<div class="bsh-divider"></div>' +
    '<div class="bsh-insurance-section" data-ins-wrap="' +
    escapeHtml(slug) +
    '">' +
    '<div class="bsh-ins-heading">Insurance</div>' +
    bshInsuranceHtml(plans, slug) +
    "</div>";

  // Outreach disclosure — collapsed by default; reveals draft message + phone script
  var outreachInner = renderOutreachPanelMarkup({
    therapist: therapist,
    contactStrategy: model.contactRoute
      ? { route: model.contactRoute.kind || model.contactRoute.type || "" }
      : null,
    escapeHtml: escapeHtml,
  });
  var outreachHtml = "";
  if (outreachInner) {
    outreachHtml =
      '<div class="bsh-divider"></div>' +
      '<details class="bsh-outreach" data-bsh-outreach="' +
      escapeHtml(slug) +
      '">' +
      '<summary class="bsh-outreach-summary">' +
      '<span class="bsh-outreach-summary-label">How to reach out</span>' +
      '<span class="bsh-outreach-summary-helper">We\'ve drafted a message for you</span>' +
      '<svg class="bsh-outreach-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      "</summary>" +
      '<div class="bsh-outreach-body outreach-script-shell">' +
      outreachInner +
      "</div>" +
      "</details>";
  }

  // Actions — View full profile is the primary; the contact action is secondary
  var profileHref = model.profileHref || "/therapists/" + encodeURIComponent(slug) + "/";

  var profileCta =
    '<a href="' +
    escapeHtml(profileHref) +
    '" class="bsh-cta-primary" target="_blank" rel="noopener noreferrer" data-primary-cta="' +
    escapeHtml(slug) +
    '" data-cta-tier="bottom-sheet">View full profile' +
    '<svg class="bsh-cta-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 12L12 2M12 2H7M12 2V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    "</a>";

  var contactCtaHtml = "";
  if (model.contactRoute) {
    var contactHref = model.contactRoute.href || "";
    var contactIcon = bshContactIcon(therapist.preferred_contact_method || "", contactHref);
    contactCtaHtml =
      '<a href="' +
      escapeHtml(contactHref) +
      '"' +
      (model.contactRoute.external ? ' target="_blank" rel="noopener noreferrer"' : "") +
      ' class="bsh-cta-secondary" data-primary-cta="' +
      escapeHtml(slug) +
      '" data-cta-tier="bottom-sheet">' +
      contactIcon +
      escapeHtml(model.contactLabel || "Contact therapist") +
      "</a>";
  }

  var footnoteHtml = model.contactFootnote
    ? '<div class="bsh-footnote">' + escapeHtml(model.contactFootnote) + "</div>"
    : "";

  var actionsHtml =
    '<div class="bsh-divider"></div>' +
    '<div class="bsh-actions">' +
    profileCta +
    contactCtaHtml +
    footnoteHtml +
    "</div>";

  return (
    topbarHtml +
    headerHtml +
    bioHtml +
    bipolarHtml +
    specsHtml +
    insuranceHtml +
    outreachHtml +
    actionsHtml
  );
}
