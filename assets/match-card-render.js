import { escapeHtml } from "./escape-html.js";
import { getPreferredRouteType } from "./match-ranking.js";
import { renderOutreachPanelMarkup } from "./outreach-scripts.js";
import { renderRoundAvatar, renderSpecialtyPills } from "./card-content.js";

// Generic bipolar terms too broad to use as a card reason label.
const REASON_LINE_GENERIC = {
  "bipolar disorder": true,
  "bipolar i": true,
  "bipolar ii": true,
  "bipolar 1": true,
  "bipolar 2": true,
  "mood disorder": true,
  "mood disorders": true,
  psychosis: true,
};

export function buildMatchReasonLine(therapist) {
  var t = therapist || {};
  var years = Number(t.bipolar_years_experience || 0);
  if (years > 0) {
    return years + " yr" + (years === 1 ? "" : "s") + " bipolar experience";
  }
  var specs = Array.isArray(t.specialties) ? t.specialties : [];
  for (var i = 0; i < specs.length; i++) {
    var s = String(specs[i] || "").trim();
    if (/bipolar|cycl|mixed/i.test(s) && !REASON_LINE_GENERIC[s.toLowerCase()]) {
      return s + " specialist";
    }
  }
  return "";
}

export function getPersonalizedCtaLabel(routeType) {
  if (routeType === "website") return "Visit their website";
  if (routeType === "booking") return "Book a session";
  if (routeType === "email") return "Email therapist";
  if (routeType === "phone") return "Call therapist";
  return "";
}

export function countActiveRefinements(profile) {
  if (!profile) return 0;
  var count = 0;
  if (profile.insurance) count += 1;
  if (profile.care_format) count += 1;
  if (profile.budget_max) count += 1;
  if (profile.urgency && profile.urgency !== "ASAP") count += 1;
  if (Array.isArray(profile.bipolar_focus) && profile.bipolar_focus.length) count += 1;
  if (Array.isArray(profile.preferred_modalities) && profile.preferred_modalities.length)
    count += 1;
  if (Array.isArray(profile.population_fit) && profile.population_fit.length) count += 1;
  if (Array.isArray(profile.language_preferences) && profile.language_preferences.length)
    count += 1;
  return count;
}

export function buildActiveFilterChipsHtml(profile) {
  if (!profile) return "";
  var chips = [];

  // Only chip for an explicit format choice, "Either" is the model's
  // internal default for "Any" and should not surface as an active filter.
  if (
    profile.care_format &&
    profile.care_format !== "No preference" &&
    profile.care_format !== "Either"
  ) {
    chips.push({ key: "care_format", label: profile.care_format });
  }
  if (profile.insurance) {
    chips.push({ key: "insurance", label: profile.insurance + " insurance" });
  }
  if (profile.budget_max) {
    chips.push({ key: "budget_max", label: "Under $" + profile.budget_max + "/session" });
  }
  if (profile.priority_mode && profile.priority_mode !== "Best overall fit") {
    var modeLabels = {
      "Soonest availability": "Soonest",
      "Lowest cost": "Affordable",
      "Highest specialization": "Most experienced",
    };
    chips.push({
      key: "priority_mode",
      label: modeLabels[profile.priority_mode] || profile.priority_mode,
    });
  }
  if (Array.isArray(profile.language_preferences) && profile.language_preferences.length) {
    chips.push({
      key: "language_preferences",
      label: profile.language_preferences.join(", "),
    });
  }

  if (!chips.length) return "";

  var xIcon =
    '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" width="9" height="9">' +
    '<line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/>' +
    "</svg>";

  return (
    '<div class="mx-active-filters">' +
    chips
      .map(function (chip) {
        return (
          '<button type="button" class="mx-filter-chip" data-clear-filter="' +
          escapeHtml(chip.key) +
          '">' +
          escapeHtml(chip.label) +
          xIcon +
          "</button>"
        );
      })
      .join("") +
    "</div>"
  );
}

export function buildResultsHeaderHtml(profile, totalCount, options) {
  var settings = options || {};
  var mirrorSentence = settings.buildIntakeMirrorSentence
    ? settings.buildIntakeMirrorSentence(profile)
    : "";

  var activeCount = countActiveRefinements(profile);
  var countBadge = activeCount
    ? '<span class="mx-refine-btn-count">' + activeCount + "</span>"
    : '<span class="mx-refine-btn-count" hidden>0</span>';

  return (
    '<header class="mx-results-header">' +
    '<div class="mx-results-kicker">Your matches</div>' +
    '<h1 class="mx-results-title">' +
    totalCount +
    " bipolar informed " +
    (totalCount === 1 ? "match" : "matches") +
    " for you</h1>" +
    (mirrorSentence ? '<p class="mx-results-sub">' + escapeHtml(mirrorSentence) + "</p>" : "") +
    '<button type="button" class="mx-refine-btn mx-refine-btn--header" data-mx-refine-open="header">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<line x1="4" y1="21" x2="4" y2="14"></line>' +
    '<line x1="4" y1="10" x2="4" y2="3"></line>' +
    '<line x1="12" y1="21" x2="12" y2="12"></line>' +
    '<line x1="12" y1="8" x2="12" y2="3"></line>' +
    '<line x1="20" y1="21" x2="20" y2="16"></line>' +
    '<line x1="20" y1="12" x2="20" y2="3"></line>' +
    '<line x1="1" y1="14" x2="7" y2="14"></line>' +
    '<line x1="9" y1="8" x2="15" y2="8"></line>' +
    '<line x1="17" y1="16" x2="23" y2="16"></line>' +
    "</svg>" +
    "Edit my preferences" +
    countBadge +
    "</button>" +
    "</header>"
  );
}

// Build the "How to reach out" disclosure for a match card.
// Returns "" when the therapist has no contactable channel.
export function buildMatchOutreachDisclosure(entry, options) {
  var therapist = entry && entry.therapist ? entry.therapist : null;
  if (!therapist) return "";
  var settings = options || {};
  var expanded = settings.expanded === true;
  var routeType = getPreferredRouteType(entry) || "";
  var inner = renderOutreachPanelMarkup({
    therapist: therapist,
    contactStrategy: routeType ? { route: routeType } : null,
    escapeHtml: escapeHtml,
    inline: expanded,
  });
  if (!inner) return "";
  var slug = String(therapist.slug || "");
  if (expanded) {
    var firstName = String(therapist.name || "").split(" ")[0] || "them";
    return (
      '<details open class="mx-outreach mx-outreach--expanded" data-mx-outreach="' +
      escapeHtml(slug) +
      '">' +
      '<summary class="mx-outreach-expanded-summary">' +
      '<div class="mx-outreach-expanded-header">' +
      '<span class="mx-outreach-expanded-kicker">Next step</span>' +
      '<span class="mx-outreach-expanded-label">Reach out to ' +
      escapeHtml(firstName) +
      "</span>" +
      "</div>" +
      '<svg class="mx-outreach-chevron mx-outreach-expanded-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      "</summary>" +
      '<div class="mx-outreach-body outreach-script-shell">' +
      inner +
      "</div></details>"
    );
  }
  return (
    '<details class="mx-outreach" data-mx-outreach="' +
    escapeHtml(slug) +
    '">' +
    '<summary class="mx-outreach-summary">' +
    '<span class="mx-outreach-summary-label">How to reach out</span>' +
    '<span class="mx-outreach-summary-helper">We\'ve drafted a message for you</span>' +
    '<svg class="mx-outreach-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    "</summary>" +
    '<div class="mx-outreach-body outreach-script-shell">' +
    inner +
    "</div></details>"
  );
}

export function renderLeadResultCard(entry, options) {
  var settings = options || {};
  var therapist = entry.therapist || {};
  var preferredRoute = settings.getPreferredOutreach(entry);
  var routeType = getPreferredRouteType(entry);
  var ctaLabel = getPersonalizedCtaLabel(routeType);
  var reasonLine = buildMatchReasonLine(therapist);

  var topMatchLabel = settings.showBestBadge
    ? '<span class="mx-top-match-label">Best fit for what you described</span>'
    : "";

  return (
    '<article class="bth-card bth-card-lead">' +
    topMatchLabel +
    '<div class="bth-card-header">' +
    '<div class="bth-card-avatar-slot">' +
    renderRoundAvatar(therapist, "profile") +
    "</div>" +
    '<div class="bth-card-ident">' +
    '<h3 class="bth-card-name">' +
    escapeHtml(therapist.name || "") +
    (therapist.credentials
      ? ', <span class="bth-card-creds">' + escapeHtml(therapist.credentials) + "</span>"
      : "") +
    "</h3>" +
    (reasonLine ? '<p class="mx-card-reason">' + escapeHtml(reasonLine) + "</p>" : "") +
    "</div>" +
    settings.renderSaveButton(therapist.slug || "", "card") +
    "</div>" +
    renderSpecialtyPills(therapist) +
    settings.buildCardInfoRow(therapist) +
    '<div class="bth-card-actions">' +
    (preferredRoute
      ? '<a href="' +
        escapeHtml(preferredRoute.href) +
        '" class="bth-btn-primary" data-match-primary-cta="' +
        escapeHtml(therapist.slug || "") +
        '" data-match-primary-route="' +
        escapeHtml(routeType || "") +
        '"' +
        (preferredRoute.external ? ' target="_blank" rel="noopener noreferrer"' : "") +
        ">" +
        escapeHtml(ctaLabel) +
        "</a>"
      : "") +
    '<a href="' +
    escapeHtml(settings.buildTherapistProfileHref(therapist)) +
    '" class="mx-profile-link">See full profile</a>' +
    "</div>" +
    buildMatchOutreachDisclosure(entry, { expanded: true }) +
    "</article>"
  );
}

export function renderSupportingResultCard(entry, options) {
  var settings = options || {};
  var therapist = entry.therapist || {};
  var preferredRoute = settings.getPreferredOutreach(entry);
  var routeType = getPreferredRouteType(entry);
  var ctaLabel = getPersonalizedCtaLabel(routeType);
  var reasonLine = buildMatchReasonLine(therapist);
  return (
    '<article class="bth-card">' +
    '<div class="bth-card-header">' +
    '<div class="bth-card-avatar-slot">' +
    renderRoundAvatar(therapist, "card") +
    "</div>" +
    '<div class="bth-card-ident">' +
    '<h3 class="bth-card-name">' +
    escapeHtml(therapist.name || "") +
    (therapist.credentials
      ? ', <span class="bth-card-creds">' + escapeHtml(therapist.credentials) + "</span>"
      : "") +
    "</h3>" +
    (reasonLine ? '<p class="mx-card-reason">' + escapeHtml(reasonLine) + "</p>" : "") +
    "</div>" +
    settings.renderSaveButton(therapist.slug || "", "card") +
    "</div>" +
    renderSpecialtyPills(therapist) +
    settings.buildCardInfoRow(therapist) +
    '<div class="bth-card-actions">' +
    (preferredRoute
      ? '<a href="' +
        escapeHtml(preferredRoute.href) +
        '" class="bth-btn-primary" data-match-primary-cta="' +
        escapeHtml(therapist.slug || "") +
        '" data-match-primary-route="' +
        escapeHtml(routeType || "") +
        '"' +
        (preferredRoute.external ? ' target="_blank" rel="noopener noreferrer"' : "") +
        ">" +
        escapeHtml(ctaLabel) +
        "</a>"
      : "") +
    '<a href="' +
    escapeHtml(settings.buildTherapistProfileHref(therapist)) +
    '" class="mx-profile-link">See full profile</a>' +
    "</div>" +
    buildMatchOutreachDisclosure(entry) +
    "</article>"
  );
}

// Build the full primary-results markup string (header, chips, lead card,
// runner-ups, "show more", refine bar, compare trigger). Returns "" when
// no contactable entries remain; the caller owns the DOM write + wiring.
export function buildPrimaryMatchCardsMarkup(entries, profile, services) {
  var settings = services || {};
  var isAsap = profile && String(profile.urgency || "").toUpperCase() === "ASAP";

  // Hide entries with no working contact method, never render a card whose
  // only action would 404 or dead-end. A card must have at least one of:
  // booking_url, website, phone, or email.
  // When urgency is ASAP, also exclude therapists who are not accepting new patients.
  var allEntries = (entries || [])
    .filter(function (entry) {
      if (!settings.getPreferredOutreach(entry)) return false;
      if (isAsap && entry.therapist && entry.therapist.accepting_new_patients === false) {
        return false;
      }
      return true;
    })
    .slice(0, 8);

  if (!allEntries.length) {
    return { html: "", allEntries: [], leadEntry: null };
  }

  var leadEntry = allEntries[0];
  var runnerUps = allEntries.slice(1, 5); // ranks 2-5, 2×2 grid, always visible
  var moreEntries = allEntries.slice(5); // ranks 6+, hidden behind Show more

  // Only show the "Best match" badge when rank 1 materially beats rank 2.
  var leadScore = leadEntry && typeof leadEntry.score === "number" ? leadEntry.score : null;
  var runnerScore =
    runnerUps[0] && typeof runnerUps[0].score === "number" ? runnerUps[0].score : null;
  var showBestBadge =
    leadScore !== null && runnerScore !== null ? leadScore - runnerScore > 0.05 : true;

  var runnersHtml = runnerUps.length
    ? '<div class="mx-runners">' +
      runnerUps
        .map(function (entry) {
          return renderSupportingResultCard(entry, settings);
        })
        .join("") +
      "</div>"
    : "";

  var moreHtml = moreEntries.length
    ? '<section class="mx-more-cards" hidden>' +
      moreEntries
        .map(function (entry) {
          return renderSupportingResultCard(entry, settings);
        })
        .join("") +
      "</section>" +
      '<div class="mx-show-more-wrap">' +
      '<button type="button" class="mx-show-more" id="matchShowMore">' +
      "Show " +
      moreEntries.length +
      " more " +
      (moreEntries.length === 1 ? "match" : "matches") +
      "</button>" +
      "</div>"
    : "";

  var compareTriggerHtml =
    allEntries.length >= 2
      ? '<div class="mx-compare-trigger-wrap">' +
        '<button type="button" class="mx-compare-trigger" id="matchCompareTrigger">Compare these</button>' +
        "</div>"
      : "";

  var noFitLinkHtml =
    '<div id="matchNoFitLink" class="mx-no-fit-link-wrap">' +
    '<button type="button" class="mx-no-fit-link" id="matchNoFitOpen">Not seeing the right fit?</button>' +
    "</div>";

  var refineBarHtml =
    '<div class="mx-refine-bar">' +
    '<button type="button" class="mx-refine-bar-btn" data-mx-refine-open="bar">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" width="16" height="16">' +
    '<line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line>' +
    '<line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line>' +
    '<line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line>' +
    '<line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line>' +
    '<line x1="17" y1="16" x2="23" y2="16"></line>' +
    "</svg>" +
    "Edit my preferences" +
    "</button>" +
    "</div>";

  var html =
    '<div class="results-panel">' +
    buildResultsHeaderHtml(profile, allEntries.length, {
      buildIntakeMirrorSentence: settings.buildIntakeMirrorSentence,
    }) +
    buildActiveFilterChipsHtml(profile) +
    '<section class="mx-top-three">' +
    renderLeadResultCard(leadEntry, Object.assign({ showBestBadge: showBestBadge }, settings)) +
    runnersHtml +
    "</section>" +
    moreHtml +
    refineBarHtml +
    compareTriggerHtml +
    noFitLinkHtml +
    "</div>";

  return { html: html, allEntries: allEntries, leadEntry: leadEntry };
}
