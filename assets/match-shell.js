var matchShellRefs = null;

var MATCH_JOURNEY_COPY = {
  intake: {
    builderTitle: "Start your match",
    kicker: "Only two answers required to begin",
    title: "Get to your first shortlist faster",
    copy: "Pick the type of support you want and enter your ZIP code. We’ll start with the strongest shortlist we can build from there.",
    searchButton: "See my matches",
    refinementButton: "See my top matches",
  },
  starterResults: {
    builderTitle: "Get a more specific match",
    kicker: "These are strong starting providers",
    title: "Add your details only if you want a tighter, more personalized fit",
    copy: "Start with the providers below, or add your ZIP code, insurance, format, or medication needs to narrow the match further.",
    searchButton: "Update shortlist",
    refinementButton: "Update shortlist",
  },
  personalizedResults: {
    builderTitle: "Get a more specific match",
    kicker: "Your homepage answers are already applied",
    title: "Only adjust these answers if you want a tighter fit",
    copy: "You already have a ranked starting point below. Change anything here only if you want to narrow, widen, or rerun the match.",
    searchButton: "Update shortlist",
    refinementButton: "Update shortlist",
  },
};

export function getMatchShellRefs() {
  if (matchShellRefs) {
    return matchShellRefs;
  }

  matchShellRefs = {
    builder: document.querySelector(".match-builder"),
    builderTitle: document.querySelector(".match-builder-header h2"),
    kicker: document.querySelector(".match-tool-kicker"),
    title: document.querySelector(".match-tool-title"),
    copy: document.querySelector(".match-tool-copy"),
    searchButton: document.getElementById("matchSearchButton"),
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

export function renderMatchLandingShell() {
  var refs = getMatchShellRefs();
  if (!refs.resultsRoot) {
    return;
  }

  refs.resultsRoot.className = "match-results match-results-hero match-empty";
  refs.resultsRoot.innerHTML =
    '<div class="match-hero-copy"><div class="match-hero-kicker">Guided match intake</div><h1>Find bipolar-specialist care without sorting through dozens of generic profiles.</h1><p>Answer a few practical questions and we’ll turn your search into a smaller, clearer shortlist of therapists or psychiatrists who may fit your needs.</p><div class="match-trust-strip" aria-label="Trust highlights"><span class="match-trust-pill">Built for bipolar-specific care</span><span class="match-trust-pill">Reviewed profile details where available</span><span class="match-trust-pill">Clear next-step guidance</span></div></div>';
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
    refs.searchButton.textContent = config.searchButton;
  }
  if (refs.refinementSubmitButton) {
    refs.refinementSubmitButton.textContent = config.refinementButton;
  }
  if (mode === "results" && refs.refinements) {
    refs.refinements.open = false;
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
