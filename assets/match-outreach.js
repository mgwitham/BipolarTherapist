function buildJourneyState(latestOutcome, options) {
  var settings = options || {};
  if (!latestOutcome) {
    return {
      tone: "neutral",
      label: "Ready to start",
      title: "You have not logged an outreach yet.",
      copy: "Start with the recommended route, then save what happened so the backup plan and list can adapt around real momentum.",
      nextMove: "Use the first contact route or copy the calm outreach draft.",
      pivot:
        "If you hear nothing back or hit a waitlist, the product will point you to the next provider.",
    };
  }

  var outcome = String(latestOutcome.outcome || "");
  var label = settings.formatOutcomeLabel ? settings.formatOutcomeLabel(outcome) : outcome;

  if (outcome === "reached_out") {
    return {
      tone: "neutral",
      label: label,
      title: "You have started the conversation.",
      copy: "Good. You now have momentum. Save the next change here so the list can react instead of forcing you to remember what happened.",
      nextMove: "Give this provider a reasonable reply window before widening the search.",
      pivot: latestOutcome.recommended_wait_window
        ? "Suggested wait window: " + latestOutcome.recommended_wait_window + "."
        : "If timing starts to feel uncertain, move to your backup instead of restarting from scratch.",
    };
  }
  if (outcome === "heard_back") {
    return {
      tone: "positive",
      label: label,
      title: "A live option is in motion.",
      copy: "You have a real response now. Stay focused on fit, logistics, and whether this route is actually moving toward a consult.",
      nextMove: "Clarify availability, format, cost, and next step while the thread is warm.",
      pivot:
        "Keep your backup in reserve, but do not split your attention unless this path stalls.",
    };
  }
  if (outcome === "booked_consult" || outcome === "good_fit_call") {
    return {
      tone: "positive",
      label: label,
      title: "This path is converting well.",
      copy: "You are past the hardest part. Use the list as backup insurance, but the main job now is evaluating fit and follow-through, not opening more tabs.",
      nextMove: "Prepare the key questions you want answered before deciding whether to continue.",
      pivot:
        "Only move to another provider if this consult reveals a trust, logistics, or care mismatch.",
    };
  }

  if (outcome === "insurance_mismatch") {
    return {
      tone: "negative",
      label: label,
      title: "This path is likely blocked by cost or coverage.",
      copy: "Do not spend more time hoping the economics will work if coverage is off. Keep momentum by moving to the backup that is more likely to fit your practical constraints.",
      nextMove: "Pivot to your backup and confirm coverage or out-of-pocket cost early.",
      pivot: "Use this result as a filter signal, not a dead end.",
    };
  }
  if (outcome === "waitlist") {
    return {
      tone: "negative",
      label: label,
      title: "This path is blocked by timing.",
      copy: "The list did its job by showing you a strong option, but timing matters. Preserve momentum by moving to the next provider instead of waiting indefinitely.",
      nextMove:
        "Start the backup route now if your timing matters more than this particular provider.",
      pivot: "You can always come back later if availability opens up.",
    };
  }
  if (outcome === "no_response") {
    return {
      tone: "negative",
      label: label,
      title: "This path may be losing momentum.",
      copy: "Silence is useful information. The best move is usually to protect momentum and open the next path rather than waiting too long on one provider.",
      nextMove: "Move to your backup once the reply window feels spent.",
      pivot:
        "Save another update if they respond later, but do not let one non-response stall the whole search.",
    };
  }

  return {
    tone: "neutral",
    label: label,
    title: "Your outreach state has been saved.",
    copy: "Keep updating what happens here so your list continues to behave like a guided process.",
    nextMove: "Choose the clearest next action and keep the backup ready if needed.",
    pivot: "The more accurately you log outcomes, the better the list can adapt.",
  };
}

function renderJourneyState(latestOutcome, options) {
  var state = buildJourneyState(latestOutcome, options);
  return (
    '<div class="first-contact-journey tone-' +
    options.escapeHtml(state.tone) +
    '"><div class="first-contact-journey-top"><div><div class="first-contact-journey-kicker">Journey status</div><div class="first-contact-journey-title">' +
    options.escapeHtml(state.title) +
    '</div></div><div class="first-contact-journey-state tone-' +
    options.escapeHtml(state.tone) +
    '">' +
    options.escapeHtml(state.label) +
    '</div></div><div class="first-contact-journey-copy">' +
    options.escapeHtml(state.copy) +
    '</div><div class="first-contact-journey-mobile-rail"><div class="first-contact-journey-mobile-label">Right now</div><div class="first-contact-journey-mobile-value">' +
    options.escapeHtml(state.nextMove) +
    '</div></div><div class="first-contact-journey-grid"><div class="first-contact-journey-card"><div class="first-contact-journey-label">Next best move</div><div class="first-contact-journey-value">' +
    options.escapeHtml(state.nextMove) +
    '</div></div><div class="first-contact-journey-card"><div class="first-contact-journey-label">Pivot guidance</div><div class="first-contact-journey-value">' +
    options.escapeHtml(state.pivot) +
    "</div></div></div></div>"
  );
}

export function buildFirstContactRecommendation(profile, entries, options) {
  var settings = options || {};
  var picked = settings.pickRecommendedFirstContact(profile, entries);
  if (!picked) {
    return null;
  }

  var therapist = picked.entry.therapist;
  var readiness = picked.readiness;
  var routeLearning = picked.routeLearning;
  var shortcutSignal = picked.shortcutSignal;
  var reasons = [];

  if (readiness && readiness.tone === "high") {
    reasons.push("the contact path is especially friction-light");
  } else if (readiness && readiness.tone === "medium") {
    reasons.push("the contact path is straightforward");
  }
  if (therapist.accepting_new_patients) {
    reasons.push("they appear to be accepting new patients");
  }
  if (profile && profile.urgency && profile.urgency !== "ASAP" && therapist.estimated_wait_time) {
    reasons.push("their timing signal is clearer than most options");
  }
  if (settings.hasInsuranceClarity(profile, therapist)) {
    reasons.push("they explicitly list your insurance");
  } else if (settings.hasCostClarity(therapist)) {
    reasons.push("their fees are more transparent");
  }
  if (profile && profile.needs_medication_management === "Yes" && therapist.medication_management) {
    reasons.push("they offer medication management");
  }
  if (settings.getResponsivenessScore(therapist) === 2) {
    reasons.push("earlier outreach patterns suggest they tend to reply");
  } else if (settings.getResponsivenessScore(therapist) === 1) {
    reasons.push("there is some early contact signal to work with");
  }
  if (routeLearning && routeLearning.success > 0) {
    reasons.push(
      "similar users have seen stronger outcomes through " +
        routeLearning.routeType.replace(/_/g, " ") +
        " outreach",
    );
  }
  if (shortcutSignal && shortcutSignal.rank === 1 && shortcutSignal.preference.strong > 0) {
    reasons.push(
      "this also aligns with the strongest-performing " +
        shortcutSignal.title.toLowerCase() +
        " shortcut for similar users",
    );
  }

  return {
    therapist: therapist,
    entry: picked.entry,
    route: readiness ? readiness.route : "Review profile",
    rationale:
      reasons.length > 1
        ? reasons.slice(0, 2).join(" and ")
        : reasons[0] || "they balance fit and follow-through well",
    firstStep:
      (readiness && readiness.firstStep) ||
      "After first contact, the next step is usually a fit conversation or intake review.",
    segmentLearning: settings.getSegmentLearningCopy(picked.entry.evaluation),
    segmentCue: settings.getSegmentAwareRecommendationCue(profile, picked.entry.evaluation),
    routeLearning: routeLearning,
    shortcutSignal: shortcutSignal,
  };
}

export function buildFallbackRecommendation(profile, entries, options) {
  var settings = options || {};
  var recommendation = settings.buildFirstContactRecommendation(profile, entries);
  if (!recommendation) {
    return null;
  }

  var latestOutcome = settings.getLatestOutreachOutcome(recommendation.therapist.slug);
  if (
    !latestOutcome ||
    ["no_response", "waitlist", "insurance_mismatch"].indexOf(latestOutcome.outcome) === -1
  ) {
    return null;
  }

  var outcomes = settings.readOutreachOutcomes();
  var fallbackLearning = settings.buildFallbackLearningMap(outcomes);
  var activeSegments = settings.buildLearningSegments(profile);
  var fallbackCandidates = (entries || []).filter(function (entry) {
    return entry.therapist.slug !== recommendation.therapist.slug;
  });
  var rankedFallbacks = fallbackCandidates
    .map(function (entry, index) {
      var learningScore = 0;
      var learningWins = 0;
      var learningAttempts = 0;
      var routeLearning = settings.getRouteLearningForProfile(profile, entry, outcomes);

      activeSegments.forEach(function (segment) {
        var bucket =
          fallbackLearning[latestOutcome.outcome + "::" + segment] &&
          fallbackLearning[latestOutcome.outcome + "::" + segment][entry.therapist.slug];
        if (!bucket) {
          return;
        }
        learningWins += bucket.success;
        learningAttempts += bucket.attempts;
        learningScore += bucket.success * 5 + Math.max(0, bucket.attempts - bucket.success);
      });

      return {
        entry: entry,
        learningScore: learningScore,
        learningWins: learningWins,
        learningAttempts: learningAttempts,
        routeLearning: routeLearning,
        fallbackRank: index + 2,
      };
    })
    .sort(function (a, b) {
      return (
        b.learningScore - a.learningScore ||
        b.routeLearning.score - a.routeLearning.score ||
        b.entry.evaluation.score - a.entry.evaluation.score ||
        a.fallbackRank - b.fallbackRank
      );
    });

  var fallbackPick = rankedFallbacks[0] || null;
  var fallbackEntry = fallbackPick ? fallbackPick.entry : null;
  if (!fallbackEntry) {
    return null;
  }

  var fallbackRoute = settings.getPreferredOutreach(fallbackEntry);
  var fallbackReason =
    latestOutcome.outcome === "no_response"
      ? "the first outreach has not gotten a reply yet"
      : latestOutcome.outcome === "waitlist"
        ? "the first outreach appears to be blocked by availability"
        : "the first outreach hit an insurance or cost mismatch";
  var nextMove =
    latestOutcome.outcome === "insurance_mismatch"
      ? "Lead by confirming coverage and expected out-of-pocket cost right away."
      : latestOutcome.outcome === "waitlist"
        ? "Lead with timing and ask whether they have a realistic next opening."
        : "Use the backup option now rather than waiting too long on the first path.";

  return {
    therapist: fallbackEntry.therapist,
    entry: fallbackEntry,
    route: fallbackRoute ? fallbackRoute.label : "Review profile",
    triggerLabel: settings.formatOutcomeLabel(latestOutcome.outcome),
    rationale:
      "Because " +
      fallbackReason +
      ", this looks like the strongest backup option based on fit, follow-through, and current list position." +
      (fallbackPick && fallbackPick.learningWins
        ? " Similar fallback journeys have also produced " +
          fallbackPick.learningWins +
          " strong outcome" +
          (fallbackPick.learningWins > 1 ? "s" : "") +
          " for this backup path."
        : ""),
    nextMove: nextMove,
    learningWins: fallbackPick ? fallbackPick.learningWins : 0,
    learningAttempts: fallbackPick ? fallbackPick.learningAttempts : 0,
    routeLearning: fallbackPick ? fallbackPick.routeLearning : null,
  };
}

export function renderFallbackRecommendation(profile, entries, options) {
  var settings = options || {};
  var root = settings.root;
  if (!root) {
    return;
  }

  var fallback = settings.buildFallbackRecommendation(profile, entries);
  var contactPlan = settings.buildContactOrderPlan(profile, entries);
  if (!fallback) {
    root.innerHTML = "";
    return;
  }

  var preferredRoute = settings.getPreferredOutreach(fallback.entry);
  var fallbackSummaryCopy =
    "Open this only if your first outreach stalls, hits a waitlist, or turns into an insurance mismatch.";

  root.innerHTML =
    '<details class="result-disclosure"><summary><div><div class="result-disclosure-title">Keep a backup ready</div><div class="result-disclosure-copy">' +
    settings.escapeHtml(fallbackSummaryCopy) +
    '</div></div><span class="result-disclosure-toggle" aria-hidden="true"></span></summary><div class="result-disclosure-body"><section class="match-support-panel"><div class="match-support-panel-static"><div><div class="match-support-panel-title">Backup option if the first path stalls</div><div class="match-support-panel-copy">If your first choice is not available or does not respond, this is the next option to try.</div></div></div><div class="match-support-panel-body"><section class="first-contact-reco"><div class="first-contact-card"><div class="first-contact-top"><div><div class="first-contact-kicker">Backup option</div><div class="first-contact-name">' +
    settings.escapeHtml(fallback.therapist.name) +
    '</div><div class="first-contact-meta">' +
    settings.escapeHtml(settings.formatTherapistLocationLine(fallback.therapist) || "") +
    '</div></div><a href="therapist.html?slug=' +
    encodeURIComponent(fallback.therapist.slug) +
    '" class="btn-secondary" style="width:auto" data-match-profile-link="' +
    settings.escapeHtml(fallback.therapist.slug) +
    '" data-profile-link-context="fallback">Review profile</a></div><div class="first-contact-body"><p><strong>Why this backup:</strong> ' +
    settings.escapeHtml(fallback.rationale) +
    '</p><div class="first-contact-summary-grid"><div class="first-contact-summary-card"><div class="first-contact-summary-label">Pivot when</div><div class="first-contact-summary-value">' +
    settings.escapeHtml(
      contactPlan ? contactPlan.trigger : "Move here if the first outreach stalls.",
    ) +
    '</div></div><div class="first-contact-summary-card"><div class="first-contact-summary-label">Suggested timing</div><div class="first-contact-summary-value">' +
    settings.escapeHtml(
      contactPlan
        ? "Around " +
            contactPlan.waitWindow +
            " from first outreach, or by " +
            contactPlan.pivotAtLabel
        : "As soon as the first path looks blocked.",
    ) +
    '</div></div><div class="first-contact-summary-card"><div class="first-contact-summary-label">Lead with</div><div class="first-contact-summary-value">' +
    settings.escapeHtml(
      fallback.nextMove || "Use the clearest next contact route and keep momentum.",
    ) +
    "</div></div></div>" +
    (contactPlan && contactPlan.timingRationale
      ? '<div class="first-contact-signal">' +
        settings.escapeHtml(contactPlan.timingRationale) +
        "</div>"
      : fallback.routeLearning && fallback.routeLearning.success > 0
        ? '<div class="first-contact-signal">Similar users have seen stronger backup outcomes through ' +
          settings.escapeHtml(fallback.routeLearning.routeType.replace(/_/g, " ")) +
          " outreach.</div>"
        : "") +
    '<div class="first-contact-actions">' +
    (preferredRoute
      ? '<a class="btn-primary" href="' +
        settings.escapeHtml(preferredRoute.href) +
        '"' +
        (preferredRoute.external ? ' target="_blank" rel="noopener"' : "") +
        ' data-fallback-contact-link="' +
        settings.escapeHtml(fallback.therapist.slug) +
        '" data-fallback-route-label="' +
        settings.escapeHtml(preferredRoute.label) +
        '">' +
        settings.escapeHtml(preferredRoute.label) +
        "</a>"
      : "") +
    '<button type="button" class="btn-secondary" data-copy-fallback-draft="' +
    settings.escapeHtml(fallback.therapist.slug) +
    '">Copy calm backup message</button></div></div></div></section></div></section></div></details>';

  root.querySelectorAll("[data-match-profile-link]").forEach(function (link) {
    link.addEventListener("click", function () {
      var slug = link.getAttribute("data-match-profile-link") || "";
      settings.trackFunnelEvent(
        "match_result_profile_opened",
        settings.buildMatchTrackingPayload(slug, {
          context: link.getAttribute("data-profile-link-context") || "result",
        }),
      );
    });
  });

  root.querySelectorAll("[data-fallback-contact-link]").forEach(function (link) {
    link.addEventListener("click", function () {
      var slug = link.getAttribute("data-fallback-contact-link") || "";
      settings.trackFunnelEvent(
        "match_fallback_outreach_started",
        settings.buildMatchTrackingPayload(slug, {
          route: link.getAttribute("data-fallback-route-label") || "",
        }),
      );
    });
  });

  root.querySelectorAll("[data-copy-fallback-draft]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-copy-fallback-draft") || "";
      var entry = (entries || []).find(function (item) {
        return item && item.therapist && item.therapist.slug === slug;
      });
      if (!entry) {
        return;
      }
      try {
        await navigator.clipboard.writeText(settings.buildEntryOutreachDraft(entry, profile));
        settings.trackFunnelEvent(
          "match_fallback_draft_copied",
          settings.buildMatchTrackingPayload(slug, {
            route: fallback.route || "Backup option",
          }),
        );
        settings.setActionState(
          true,
          "Copied the backup outreach for " + entry.therapist.name + ".",
        );
      } catch (_error) {
        settings.setActionState(true, "Unable to copy the backup outreach automatically.");
      }
    });
  });
}

export function renderFirstContactRecommendation(profile, entries, options) {
  var settings = options || {};
  var root = settings.root;
  if (!root) {
    return;
  }

  var recommendation = settings.buildFirstContactRecommendation(profile, entries);
  if (!recommendation) {
    root.innerHTML = "";
    return;
  }

  var preferredRoute = settings.getPreferredOutreach(recommendation.entry);
  var latestOutcome = settings.getLatestOutreachOutcome(recommendation.therapist.slug);
  var trackerOpen = Boolean(latestOutcome);
  var trackerSummaryCopy = latestOutcome
    ? "Your first outreach already has a saved outcome. Open this to update what happened or change course."
    : "Open this after you contact the first provider so the backup plan can adapt if needed.";
  var contactPlan = settings.buildContactOrderPlan
    ? settings.buildContactOrderPlan(profile, entries)
    : null;

  root.innerHTML =
    '<details class="result-disclosure"' +
    (trackerOpen ? " open" : "") +
    '><summary><div><div class="result-disclosure-title">Track what happened after your first outreach</div><div class="result-disclosure-copy">' +
    settings.escapeHtml(trackerSummaryCopy) +
    '</div></div><span class="result-disclosure-toggle" aria-hidden="true"></span></summary><div class="result-disclosure-body"><section class="first-contact-reco"><div class="first-contact-header"><h3>First outreach tracker</h3><p>This supports your next step after you contact the lead provider. Save the outcome here so the backup plan can respond.</p></div><div class="first-contact-card"><div class="first-contact-top"><div><div class="first-contact-kicker">Lead provider</div><div class="first-contact-name">' +
    settings.escapeHtml(recommendation.therapist.name) +
    '</div><div class="first-contact-meta">' +
    settings.escapeHtml(settings.formatTherapistLocationLine(recommendation.therapist) || "") +
    '</div></div><a href="therapist.html?slug=' +
    encodeURIComponent(recommendation.therapist.slug) +
    '" class="btn-secondary" style="width:auto" data-match-profile-link="' +
    settings.escapeHtml(recommendation.therapist.slug) +
    '" data-profile-link-context="first-contact">Review profile</a></div><div class="first-contact-body"><p><strong>Why this one:</strong> ' +
    settings.escapeHtml(recommendation.rationale) +
    '</p><div class="first-contact-summary-grid"><div class="first-contact-summary-card"><div class="first-contact-summary-label">Best route</div><div class="first-contact-summary-value">' +
    settings.escapeHtml(recommendation.route || "Review profile") +
    '</div></div><div class="first-contact-summary-card"><div class="first-contact-summary-label">First step</div><div class="first-contact-summary-value">' +
    settings.escapeHtml(recommendation.firstStep || "Start with a brief fit-oriented outreach.") +
    '</div></div><div class="first-contact-summary-card"><div class="first-contact-summary-label">Why it rose</div><div class="first-contact-summary-value">' +
    settings.escapeHtml(
      recommendation.segmentCue ||
        recommendation.segmentLearning ||
        "This option looks strongest when balancing fit and follow-through.",
    ) +
    "</div></div></div>" +
    (recommendation.routeLearning && recommendation.routeLearning.success > 0
      ? '<div class="first-contact-signal">Similar users have seen stronger outcomes through ' +
        settings.escapeHtml(recommendation.routeLearning.routeType.replace(/_/g, " ")) +
        ' outreach.<div class="first-contact-signal-note">Use that route first before widening to backup options.</div></div>'
      : recommendation.shortcutSignal && recommendation.shortcutSignal.preference.strong > 0
        ? '<div class="first-contact-signal">This also lines up with the strongest-performing ' +
          settings.escapeHtml(recommendation.shortcutSignal.title.toLowerCase()) +
          " shortcut for similar users.</div>"
        : "") +
    '<div class="first-contact-actions">' +
    (preferredRoute
      ? '<a class="btn-primary" href="' +
        settings.escapeHtml(preferredRoute.href) +
        '"' +
        (preferredRoute.external ? ' target="_blank" rel="noopener"' : "") +
        ' data-entry-contact-link="' +
        settings.escapeHtml(recommendation.therapist.slug) +
        '" data-entry-route-label="' +
        settings.escapeHtml(preferredRoute.label) +
        '">' +
        settings.escapeHtml(preferredRoute.label) +
        "</a>"
      : "") +
    '<button type="button" class="btn-secondary" data-copy-entry-draft="' +
    settings.escapeHtml(recommendation.therapist.slug) +
    '">Copy calm first message</button></div><div class="first-contact-tracker">' +
    renderJourneyState(latestOutcome, settings) +
    '<div class="first-contact-tracker-title">What happened after outreach?</div><div class="first-contact-tracker-actions">' +
    settings.outreachOutcomeOptions
      .map(function (option) {
        return (
          '<button type="button" class="feedback-btn' +
          (latestOutcome && latestOutcome.outcome === option.value
            ? option.tone === "negative"
              ? " active-negative"
              : " active-positive"
            : "") +
          '" data-entry-outreach="' +
          settings.escapeHtml(recommendation.therapist.slug) +
          '" data-entry-outcome="' +
          settings.escapeHtml(option.value) +
          '">' +
          settings.escapeHtml(option.label) +
          "</button>"
        );
      })
      .join("") +
    '</div><div class="first-contact-tracker-note">' +
    settings.escapeHtml(
      contactPlan
        ? "Suggested pivot window: " +
            contactPlan.waitWindow +
            ". Save each update here so the backup plan reacts at the right time."
        : "Save the outcome here so the backup plan and ranking logic can adapt.",
    ) +
    "</div></div></div></div></section></div></details>";

  root.querySelectorAll("[data-match-profile-link]").forEach(function (link) {
    link.addEventListener("click", function () {
      var slug = link.getAttribute("data-match-profile-link") || "";
      settings.trackFunnelEvent(
        "match_result_profile_opened",
        settings.buildMatchTrackingPayload(slug, {
          context: link.getAttribute("data-profile-link-context") || "first-contact",
        }),
      );
    });
  });

  root.querySelectorAll("[data-entry-contact-link]").forEach(function (link) {
    link.addEventListener("click", function () {
      var slug = link.getAttribute("data-entry-contact-link") || "";
      settings.trackFunnelEvent(
        "match_recommended_outreach_started",
        settings.buildMatchTrackingPayload(slug, {
          route: link.getAttribute("data-entry-route-label") || "",
        }),
      );
    });
  });

  root.querySelectorAll("[data-copy-entry-draft]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-copy-entry-draft") || "";
      var entry = (entries || []).find(function (item) {
        return item && item.therapist && item.therapist.slug === slug;
      });
      if (!entry) {
        return;
      }
      try {
        await navigator.clipboard.writeText(settings.buildEntryOutreachDraft(entry, profile));
        settings.trackFunnelEvent(
          "match_recommended_draft_copied",
          settings.buildMatchTrackingPayload(slug, {
            route: recommendation.route || "Recommended first contact",
          }),
        );
        settings.setActionState(
          true,
          "Copied the recommended first outreach for " + entry.therapist.name + ".",
        );
      } catch (_error) {
        settings.setActionState(true, "Unable to copy the recommended outreach automatically.");
      }
    });
  });

  root.querySelectorAll("[data-entry-outreach]").forEach(function (button) {
    button.addEventListener("click", function () {
      settings.recordEntryOutreachOutcome(
        button.getAttribute("data-entry-outreach"),
        button.getAttribute("data-entry-outcome"),
      );
    });
  });
}

export function renderOutreachPanel(entries, options) {
  var settings = options || {};
  var root = settings.root;
  if (!root) {
    return;
  }

  if (!entries || !entries.length) {
    root.innerHTML = "";
    return;
  }
  var topEntries = entries.slice(0, 3);
  var focusSlug = settings.outreachFocusSlug || (topEntries[0] ? topEntries[0].therapist.slug : "");
  var focusIndex = Math.max(
    0,
    topEntries.findIndex(function (entry) {
      return entry.therapist.slug === focusSlug;
    }),
  );
  if (!topEntries[focusIndex]) {
    focusIndex = 0;
  }
  var hasRecordedOutcome = topEntries.some(function (entry) {
    return Boolean(settings.getLatestOutreachOutcome(entry.therapist.slug));
  });
  root.innerHTML =
    '<details class="result-disclosure"' +
    (hasRecordedOutcome || settings.outreachFocusSlug ? " open" : "") +
    '><summary><div><div class="result-disclosure-title">Outreach scripts and tracking</div><div class="result-disclosure-copy">Open this when you are ready to contact providers or save what happened next.</div></div><span class="result-disclosure-toggle" aria-hidden="true"></span></summary><div class="result-disclosure-body"><section class="match-support-panel"><div class="match-support-panel-static"><div><div class="match-support-panel-title">What to do next</div><div class="match-support-panel-copy">Start with one provider, then move to your backup if the first option stalls.</div></div><div class="outreach-carousel-meta"><div class="outreach-carousel-count">' +
    settings.escapeHtml(String(focusIndex + 1) + " of " + String(topEntries.length)) +
    '</div><div class="outreach-carousel-nav"><button type="button" class="btn-secondary" id="outreachPrev"' +
    (focusIndex === 0 ? " disabled" : "") +
    '>Previous</button><button type="button" class="btn-secondary" id="outreachNext"' +
    (focusIndex === topEntries.length - 1 ? " disabled" : "") +
    '>Next</button></div></div></div><div class="match-support-panel-body"><div class="outreach-carousel-frame">' +
    topEntries
      .map(function (entry, index) {
        var therapist = entry.therapist;
        var preferredRoute = settings.getPreferredOutreach(entry);
        var latestOutcome = settings.getLatestOutreachOutcome(therapist.slug);
        var journeyState = buildJourneyState(latestOutcome, settings);
        var role = index === 0 ? "Contact first" : index === 1 ? "Contact second" : "Contact third";
        var script = settings
          .buildEntryOutreachDraft(entry, settings.profile)
          .replace(/\n+/g, " ")
          .trim();
        return (
          '<article class="outreach-carousel-card"' +
          (index === focusIndex ? "" : " hidden") +
          ' data-outreach-card="' +
          settings.escapeHtml(therapist.slug) +
          '"><div class="outreach-card-top"><div><h4>' +
          settings.escapeHtml(therapist.name) +
          "</h4><p>" +
          settings.escapeHtml(
            (therapist.credentials || "") + (therapist.title ? " · " + therapist.title : ""),
          ) +
          '</p><div class="outreach-note">' +
          settings.escapeHtml(settings.formatTherapistLocationLine(therapist)) +
          '</div></div><span class="match-summary-pill">' +
          settings.escapeHtml(role) +
          '</span></div><div class="outreach-compact-grid"><div class="outreach-card-route"><div class="outreach-note-label">Start here</div><div class="outreach-note-body outreach-note-body-compact">' +
          settings.escapeHtml(preferredRoute ? preferredRoute.label : "View full profile") +
          '</div></div><div class="outreach-card-route outreach-card-script"><div class="outreach-note-label">What to say</div><div class="outreach-note-body outreach-script-preview">' +
          settings.escapeHtml(script) +
          '</div></div></div><div class="first-contact-journey tone-' +
          settings.escapeHtml(journeyState.tone) +
          '"><div class="first-contact-journey-top"><div><div class="first-contact-journey-kicker">Current state</div><div class="first-contact-journey-title">' +
          settings.escapeHtml(journeyState.title) +
          '</div></div><div class="first-contact-journey-state tone-' +
          settings.escapeHtml(journeyState.tone) +
          '">' +
          settings.escapeHtml(journeyState.label) +
          '</div></div><div class="first-contact-journey-copy">' +
          settings.escapeHtml(journeyState.nextMove) +
          '</div><div class="outreach-mobile-state"><div class="outreach-mobile-state-label">If this stalls</div><div class="outreach-mobile-state-value">' +
          settings.escapeHtml(journeyState.pivot) +
          '</div></div></div><div class="outreach-card-actions">' +
          (preferredRoute
            ? '<a class="btn-primary" href="' +
              settings.escapeHtml(preferredRoute.href) +
              '"' +
              (preferredRoute.external ? ' target="_blank" rel="noopener"' : "") +
              ' data-entry-contact-link="' +
              settings.escapeHtml(therapist.slug) +
              '" data-entry-route-label="' +
              settings.escapeHtml(preferredRoute.label) +
              '">' +
              settings.escapeHtml(preferredRoute.label) +
              "</a>"
            : "") +
          '<button type="button" class="btn-secondary" data-copy-entry-draft="' +
          settings.escapeHtml(therapist.slug) +
          '">Copy script</button><a class="btn-secondary" href="therapist.html?slug=' +
          encodeURIComponent(therapist.slug) +
          '" data-match-profile-link="' +
          settings.escapeHtml(therapist.slug) +
          '" data-profile-link-context="outreach-card">View profile</a></div><div class="first-contact-tracker"><div class="first-contact-tracker-title">Update outcome</div><div class="first-contact-tracker-actions">' +
          settings.outreachOutcomeOptions
            .map(function (option) {
              return (
                '<button type="button" class="feedback-btn' +
                (latestOutcome && latestOutcome.outcome === option.value
                  ? option.tone === "negative"
                    ? " active-negative"
                    : " active-positive"
                  : "") +
                '" data-entry-outreach="' +
                settings.escapeHtml(therapist.slug) +
                '" data-entry-outcome="' +
                settings.escapeHtml(option.value) +
                '">' +
                settings.escapeHtml(option.label) +
                "</button>"
              );
            })
            .join("") +
          "</div></div></article>"
        );
      })
      .join("") +
    "</div></div></section></div></details>";

  var prevButton = document.getElementById("outreachPrev");
  if (prevButton) {
    prevButton.addEventListener("click", function () {
      var nextIndex = Math.max(0, focusIndex - 1);
      settings.setOutreachFocusSlug(topEntries[nextIndex].therapist.slug);
      settings.renderOutreachPanel(entries);
    });
  }

  var nextButton = document.getElementById("outreachNext");
  if (nextButton) {
    nextButton.addEventListener("click", function () {
      var nextIndex = Math.min(topEntries.length - 1, focusIndex + 1);
      settings.setOutreachFocusSlug(topEntries[nextIndex].therapist.slug);
      settings.renderOutreachPanel(entries);
    });
  }

  root.querySelectorAll("[data-copy-entry-draft]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-copy-entry-draft");
      var entry = entries.find(function (item) {
        return item.therapist.slug === slug;
      });
      if (!entry) {
        return;
      }
      try {
        await navigator.clipboard.writeText(
          settings.buildEntryOutreachDraft(entry, settings.profile),
        );
        settings.trackFunnelEvent(
          "match_entry_draft_copied",
          settings.buildMatchTrackingPayload(entry.therapist.slug, {
            route: settings.getPreferredOutreach(entry)
              ? settings.getPreferredOutreach(entry).label
              : "Review profile",
          }),
        );
        settings.setActionState(
          true,
          "Tailored outreach draft copied for " + entry.therapist.name + ".",
        );
      } catch (_error) {
        settings.setActionState(true, "Unable to copy the tailored outreach draft automatically.");
      }
    });
  });

  root.querySelectorAll("[data-entry-contact-link]").forEach(function (link) {
    link.addEventListener("click", function () {
      var slug = link.getAttribute("data-entry-contact-link") || "";
      settings.trackFunnelEvent(
        "match_entry_outreach_started",
        settings.buildMatchTrackingPayload(slug, {
          route: link.getAttribute("data-entry-route-label") || "",
        }),
      );
    });
  });

  root.querySelectorAll("[data-match-profile-link]").forEach(function (link) {
    link.addEventListener("click", function () {
      var slug = link.getAttribute("data-match-profile-link") || "";
      settings.trackFunnelEvent(
        "match_result_profile_opened",
        settings.buildMatchTrackingPayload(slug, {
          context: link.getAttribute("data-profile-link-context") || "result",
        }),
      );
    });
  });

  root.querySelectorAll("[data-entry-outreach]").forEach(function (button) {
    button.addEventListener("click", function () {
      settings.recordEntryOutreachOutcome(
        button.getAttribute("data-entry-outreach"),
        button.getAttribute("data-entry-outcome"),
      );
      settings.renderOutreachPanel(entries);
    });
  });

  var frame = root.querySelector(".outreach-carousel-frame");
  if (frame) {
    var touchStartX = 0;
    frame.addEventListener("touchstart", function (event) {
      touchStartX = event.touches[0] ? event.touches[0].clientX : 0;
    });
    frame.addEventListener("touchend", function (event) {
      var touchEndX = event.changedTouches[0] ? event.changedTouches[0].clientX : 0;
      var delta = touchEndX - touchStartX;
      if (Math.abs(delta) < 40) {
        return;
      }
      if (delta < 0 && focusIndex < topEntries.length - 1) {
        settings.setOutreachFocusSlug(topEntries[focusIndex + 1].therapist.slug);
        settings.renderOutreachPanel(entries);
      } else if (delta > 0 && focusIndex > 0) {
        settings.setOutreachFocusSlug(topEntries[focusIndex - 1].therapist.slug);
        settings.renderOutreachPanel(entries);
      }
    });
  }
}
