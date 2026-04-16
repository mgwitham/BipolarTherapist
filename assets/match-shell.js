var matchShellRefs = null;

var MATCH_JOURNEY_COPY = {
  intake: {
    builderTitle: "Refine your match",
    kicker: "Start broad, then narrow fast",
    title: "Use a few practical details to shape a better list",
    copy: "Your broad match starts on the homepage. This page helps you tighten the list around how you want care to work.",
    searchButton: "Refine my search",
    refinementButton: "Update my matches",
  },
  starterResults: {
    builderTitle: "Refine your match",
    kicker: "Narrow the list",
    title: "Add the details that matter most and rerun the ranking here",
    copy: "You already started on the homepage. Use these filters to make the current matches feel more specific, practical, and trustworthy.",
    searchButton: "Refine my search",
    refinementButton: "Update my matches",
  },
  personalizedResults: {
    builderTitle: "Refine your match",
    kicker: "Tune this list",
    title: "Change the filters that will sharpen who rises to the top",
    copy: "Use these controls to narrow the list around cost, format, timing, and clinical fit without starting over.",
    searchButton: "Refine my search",
    refinementButton: "Update my matches",
  },
};

export function getMatchShellRefs() {
  if (matchShellRefs) {
    return matchShellRefs;
  }

  var builder = document.querySelector(".match-builder");
  var builderAnchor = null;
  if (builder && builder.parentNode) {
    builderAnchor = document.createElement("div");
    builderAnchor.hidden = true;
    builderAnchor.setAttribute("data-match-builder-anchor", "true");
    builder.parentNode.insertBefore(builderAnchor, builder);
  }

  matchShellRefs = {
    builder: builder,
    builderAnchor: builderAnchor,
    builderTitle: document.querySelector(".match-builder-header h2"),
    kicker: document.querySelector(".match-tool-kicker"),
    title: document.querySelector(".match-tool-title"),
    copy: document.querySelector(".match-tool-copy"),
    searchButton: document.getElementById("openAdvancedFiltersButton"),
    refinementSubmitButton: document.getElementById("refinementSubmitButton"),
    refinements: document.querySelector(".match-refinements"),
    resultsRoot: document.getElementById("matchResults"),
    compare: document.getElementById("matchCompare"),
    outreach: document.getElementById("matchOutreach"),
    adaptiveGuidance: document.getElementById("matchAdaptiveGuidance"),
    firstContact: document.getElementById("matchFirstContact"),
    fallbackContact: document.getElementById("matchFallbackContact"),
    feedbackBar: document.getElementById("matchFeedbackBar"),
    queue: document.getElementById("matchQueue"),
    feedbackStatus: document.getElementById("feedbackStatus"),
    status: document.getElementById("matchActionStatus"),
    form: document.getElementById("matchForm"),
  };

  return matchShellRefs;
}

export function placeBuilderInResults(resultsRoot) {
  var refs = getMatchShellRefs();
  if (!refs.builder || !resultsRoot) {
    return;
  }

  refs.builder.classList.add("is-inline-results");

  // Create collapsible refine wrapper
  var refineWrapper = document.getElementById("matchRefineSection");
  if (!refineWrapper) {
    refineWrapper = document.createElement("details");
    refineWrapper.className = "match-refine-section";
    refineWrapper.id = "matchRefineSection";
    refineWrapper.innerHTML =
      '<summary class="match-refine-toggle">' +
      '<span class="match-refine-toggle-text">Refine your results</span>' +
      '<svg class="refine-chevron" width="11" height="7" viewBox="0 0 11 7" fill="none" aria-hidden="true">' +
      '<path d="M1 1l4.5 4.5L10 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg></summary>";
  }

  // Place refine wrapper (with builder inside) after the results panel
  resultsRoot.appendChild(refineWrapper);
  refineWrapper.appendChild(refs.builder);

  // Order: results → refine tool → queue (more options)
  if (refs.firstContact) {
    resultsRoot.insertBefore(refs.firstContact, refineWrapper);
  }
  if (refs.fallbackContact) {
    resultsRoot.insertBefore(refs.fallbackContact, refineWrapper);
  }
  if (refs.queue) {
    resultsRoot.appendChild(refs.queue);
  }
}

export function restoreBuilderPlacement() {
  var refs = getMatchShellRefs();
  if (!refs.builder || !refs.builderAnchor || !refs.builderAnchor.parentNode) {
    return;
  }

  // Unwrap from refine section if wrapped
  var refineWrapper = document.getElementById("matchRefineSection");
  if (refineWrapper && refineWrapper.contains(refs.builder)) {
    refineWrapper.parentNode.insertBefore(refs.builder, refineWrapper);
    refineWrapper.parentNode.removeChild(refineWrapper);
  }

  refs.builder.classList.remove("is-inline-results");
  refs.builderAnchor.parentNode.insertBefore(refs.builder, refs.builderAnchor.nextSibling);
}

export function renderMatchLandingShell() {
  var refs = getMatchShellRefs();
  if (!refs.resultsRoot) {
    return;
  }

  refs.resultsRoot.className = "match-results match-results-hero match-empty";
  refs.resultsRoot.innerHTML =
    '<div class="match-hero-copy"><div class="match-hero-kicker">Guided match intake</div><h1>Find bipolar-specialist care without sorting through dozens of generic profiles.</h1><p>Answer a few practical questions and we’ll turn your search into a smaller, clearer list of therapists or psychiatrists who may fit your needs.</p><div class="match-trust-strip" aria-label="Trust highlights"><span class="match-trust-pill">Built for bipolar-specific care</span><span class="match-trust-pill">Reviewed profile details where available</span><span class="match-trust-pill">Clear next-step guidance</span></div></div>';
}

export function clearRenderedMatchPanels() {
  var refs = getMatchShellRefs();

  if (refs.queue) {
    refs.queue.hidden = true;
    refs.queue.innerHTML = "";
  }
  if (refs.compare) {
    refs.compare.innerHTML = "";
  }
  if (refs.outreach) {
    refs.outreach.innerHTML = "";
  }
  if (refs.adaptiveGuidance) {
    refs.adaptiveGuidance.innerHTML = "";
  }
  if (refs.firstContact) {
    refs.firstContact.innerHTML = "";
  }
  if (refs.fallbackContact) {
    refs.fallbackContact.innerHTML = "";
  }
  if (refs.feedbackBar) {
    refs.feedbackBar.hidden = true;
  }
}

export function setMatchJourneyMode(mode, starterResultsMode) {
  var refs = getMatchShellRefs();

  if (!refs.builder || !refs.builderTitle || !refs.kicker || !refs.title || !refs.copy) {
    return;
  }

  if (!refs.builder.dataset.defaultTitle) {
    refs.builder.dataset.defaultTitle = refs.builderTitle.textContent || "";
    refs.kicker.dataset.defaultText = refs.kicker.textContent || "";
    refs.title.dataset.defaultText = refs.title.textContent || "";
    refs.copy.dataset.defaultText = refs.copy.textContent || "";
  }

  var configKey =
    mode === "results" ? (starterResultsMode ? "starterResults" : "personalizedResults") : "intake";
  var config = MATCH_JOURNEY_COPY[configKey];

  refs.builder.classList.toggle("is-results-mode", mode === "results");
  refs.builderTitle.textContent = config.builderTitle;
  refs.kicker.textContent = config.kicker;
  refs.title.textContent = config.title;
  refs.copy.textContent = config.copy;

  if (refs.searchButton) {
    // Only update text if the element is a simple text node (not the new refine-more-btn)
    if (!refs.searchButton.querySelector(".refine-chevron")) {
      refs.searchButton.textContent = config.searchButton;
    }
  }
  if (refs.refinementSubmitButton) {
    refs.refinementSubmitButton.textContent = config.refinementButton;
  }
  if (refs.refinements) {
    // In intake mode, close the advanced panel. In results mode, leave it as-is
    // so the user controls it via "More filters" — don't auto-open.
    if (mode !== "results") {
      refs.refinements.open = false;
      var moreBtn = document.getElementById("openAdvancedFiltersButton");
      if (moreBtn) {
        moreBtn.setAttribute("aria-expanded", "false");
        moreBtn.classList.remove("is-expanded");
      }
    }
  }
  if (mode !== "results") {
    restoreBuilderPlacement();
  }
}

export function setActionState(_enabled, message) {
  var refs = getMatchShellRefs();
  if (message && refs.status) {
    refs.status.textContent = message;
    refs.status.classList.remove("motion-pulse");
    void refs.status.offsetWidth;
    refs.status.classList.add("motion-pulse");
  }
}

export function scrollToTopMatches() {
  window.requestAnimationFrame(function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}
