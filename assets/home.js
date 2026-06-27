import "./sentry-init.js";
import { fetchHomePageContent } from "./cms.js";
import {
  getExperimentVariant,
  readFunnelEvents,
  summarizeAdaptiveSignals,
  trackExperimentExposure,
  trackFunnelEvent,
} from "./funnel-analytics.js";
import { getZipMarketStatus, preloadZipcodes } from "./zip-lookup.js";

let activeHomeExperimentVariant = "control";
const HOME_LAST_SEARCH_KEY = "bth_last_search";
const HOME_SEARCH_SESSION_KEY = "bth_search_session";

function applyHomePageCopy(homePage) {
  if (!homePage) {
    return;
  }

  const heroTitle = document.getElementById("heroTitle");
  const heroDescription = document.getElementById("heroDescription");
  const locationLabel = document.getElementById("locationLabel");
  const locationInput = document.getElementById("location");
  const searchButton = document.getElementById("searchButton");

  if (heroTitle && homePage.heroTitle) {
    heroTitle.textContent = homePage.heroTitle.replace(/\s*These do\.?\s*$/i, "").trim();
  }

  if (heroDescription && homePage.heroDescription) {
    heroDescription.textContent = homePage.heroDescription;
  }

  if (locationLabel && homePage.locationLabel) {
    locationLabel.textContent = homePage.locationLabel;
  }

  if (locationInput && homePage.locationPlaceholder) {
    locationInput.placeholder = homePage.locationPlaceholder;
  }

  if (searchButton && homePage.searchButtonLabel) {
    searchButton.textContent = homePage.searchButtonLabel;
  }
}

function applySiteSettings(siteSettings) {
  if (!siteSettings) {
    return;
  }

  const navBrowseLink = document.getElementById("navBrowseLink");
  const navCtaLink = document.getElementById("navCtaLink");
  const footerTagline = document.getElementById("footerTagline");
  const footerContactLink = document.getElementById("footerContactLink");

  if (
    navBrowseLink &&
    siteSettings.browseLabel &&
    !(navBrowseLink.dataset && navBrowseLink.dataset.matchNavManaged)
  ) {
    navBrowseLink.textContent = siteSettings.browseLabel;
  }

  if (navCtaLink) {
    if (siteSettings.therapistCtaLabel) {
      navCtaLink.textContent = siteSettings.therapistCtaLabel;
    }
    if (siteSettings.therapistCtaUrl) {
      navCtaLink.href = siteSettings.therapistCtaUrl;
    }
  }

  if (footerTagline && siteSettings.footerTagline) {
    footerTagline.textContent = siteSettings.footerTagline;
  }

  if (footerContactLink && siteSettings.supportEmail) {
    footerContactLink.href = "mailto:" + siteSettings.supportEmail;
  }
}

function syncHomeZipResolvedLabel(value) {
  const resolved = document.getElementById("homeZipResolved");
  const inline = resolved ? resolved.closest(".zip-inline") : null;
  if (!resolved) {
    return;
  }

  const zipStatus = getZipMarketStatus(value);
  if (!zipStatus.place) {
    resolved.textContent = "";
    resolved.classList.remove("is-visible");
    if (inline) {
      inline.classList.remove("is-resolved");
    }
    return;
  }

  resolved.textContent =
    zipStatus.status === "live" ? "- " + zipStatus.place.label : zipStatus.message;
  resolved.classList.add("is-visible");
  if (inline) {
    inline.classList.add("is-resolved");
  }
}

function syncHeroSearchState() {
  const hiddenInput = document.getElementById("homepage_interest");
  const locationInput = document.getElementById("location");
  const searchButton = document.getElementById("searchButton");
  const searchHelper = document.getElementById("searchHelper");
  const interestField = hiddenInput ? hiddenInput.closest(".search-field--prompt") : null;

  if (!hiddenInput || !locationInput) {
    return;
  }

  const interest = String(hiddenInput.value || "").trim();
  const hasLocation = Boolean(locationInput.value.trim());
  const isReady = Boolean(interest) && hasLocation;

  if (interestField) {
    interestField.classList.toggle("has-value", Boolean(interest));
  }

  syncHomeZipResolvedLabel(locationInput.value);

  if (searchButton) {
    searchButton.textContent = getHeroButtonLabel(interest);
  }

  if (searchHelper) {
    renderHeroHelperCopy(searchHelper, interest, hasLocation);
  }

  const careHint = document.getElementById("searchCareTypeHint");
  if (careHint) {
    careHint.textContent =
      interest === "psychiatrist"
        ? "We'll match you with psychiatrists and nurse practitioners for medication management."
        : "";
  }

  renderHomeSearchPreview(interest, String(locationInput.value || "").trim());

  if (isReady) {
    hideHeroValidationPopup();
  }
}

function getHeroButtonLabel(_interest) {
  // Uniform "Find care" across all states, shorter, action-first, and
  // patient-facing without forcing a therapy-vs-psychiatry commitment
  // upfront. The unused param is kept for call-site compatibility.
  return "Find care";
}

function replaceWithLabelCopy(node, label, copy) {
  if (!node) {
    return;
  }

  const labelNode = document.createElement("strong");
  labelNode.textContent = label;
  node.replaceChildren(labelNode, document.createTextNode(" " + copy));
}

function renderHeroHelperCopy(node, interest, hasLocation) {
  if (!interest && !hasLocation) {
    replaceWithLabelCopy(
      node,
      "Recommended:",
      "choose your support type and California ZIP code to start with the calmer guided match.",
    );
    return;
  }

  if (interest && !hasLocation) {
    replaceWithLabelCopy(
      node,
      "Next:",
      "add your California ZIP code to see a more trustworthy " +
        (interest === "psychiatrist" ? "psychiatry" : "therapy") +
        " list.",
    );
    return;
  }

  if (!interest && hasLocation) {
    replaceWithLabelCopy(
      node,
      "Next:",
      "choose the kind of support you want so we can narrow toward the strongest first list.",
    );
    return;
  }

  replaceWithLabelCopy(
    node,
    "Next:",
    "answer a few quick questions and review a smaller, more decision-ready list built for bipolar care.",
  );
}

function setHomePreviewText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}

function getHomeSupportLabel(interest) {
  if (interest === "psychiatrist") {
    return "psychiatry";
  }
  if (interest === "therapist") {
    return "therapy";
  }
  return "care";
}

function renderHomeSearchPreview(interest, locationValue) {
  const zipStatus = getZipMarketStatus(locationValue);
  const supportLabel = getHomeSupportLabel(interest);

  if (!interest && !locationValue) {
    setHomePreviewText("homePreviewStateTitle", "Start with two lightweight answers.");
    setHomePreviewText(
      "homePreviewStateCopy",
      "Care type and California ZIP are enough to move from generic browsing into a calmer first pass.",
    );
    setHomePreviewText("homePreviewMomentumTitle", "Nothing heavy happens next.");
    setHomePreviewText(
      "homePreviewMomentumCopy",
      "You will answer a few focused questions before comparing profiles, not fill out a long intake.",
    );
    return;
  }

  if (interest && !locationValue) {
    setHomePreviewText("homePreviewStateTitle", "Care direction is set.");
    setHomePreviewText(
      "homePreviewStateCopy",
      "We know you want " +
        supportLabel +
        " first. ZIP is what makes the list feel local and more useful.",
    );
    setHomePreviewText("homePreviewMomentumTitle", "You are still in low-friction mode.");
    setHomePreviewText(
      "homePreviewMomentumCopy",
      "Once location is in place, the next step can narrow fit and trust signals without forcing a commitment.",
    );
    return;
  }

  if (!interest && locationValue) {
    setHomePreviewText("homePreviewStateTitle", "Location is grounded.");
    setHomePreviewText(
      "homePreviewStateCopy",
      zipStatus.place
        ? "We can shape the next step around " +
            zipStatus.place.label +
            " once you choose whether to start with therapy or psychiatry."
        : "Your ZIP is enough to carry forward. One care choice will make the list feel much more intentional.",
    );
    setHomePreviewText("homePreviewMomentumTitle", "One answer should change the feel fast.");
    setHomePreviewText(
      "homePreviewMomentumCopy",
      "Choosing therapy or psychiatry is usually what turns a broad local search into a more decision-ready list.",
    );
    return;
  }

  if (zipStatus.status === "out_of_state") {
    setHomePreviewText("homePreviewStateTitle", "Outside the current match area.");
    setHomePreviewText(
      "homePreviewStateCopy",
      "We are currently matching California ZIP codes, so this search will feel strongest once the location is in-range.",
    );
    setHomePreviewText("homePreviewMomentumTitle", "You can still decide how to continue.");
    setHomePreviewText(
      "homePreviewMomentumCopy",
      "If California is not the right location, browsing may still be the calmer next move while match coverage expands.",
    );
    return;
  }

  setHomePreviewText("homePreviewStateTitle", "Ready for a more relevant list.");
  setHomePreviewText(
    "homePreviewStateCopy",
    zipStatus.place
      ? "Starting with " +
          supportLabel +
          " in " +
          zipStatus.place.label +
          " should give you a more focused first pass than broad directory browsing."
      : "The core answers are in place, so the next step should feel more guided than generic browsing.",
  );
  setHomePreviewText("homePreviewMomentumTitle", "What gets easier next.");
  setHomePreviewText(
    "homePreviewMomentumCopy",
    zipStatus.status === "unknown"
      ? "We will carry this ZIP forward and tighten around fit, trust, and contact clarity on the next step."
      : "The next step should reduce guesswork around fit, trust, and who to contact first without making you start over.",
  );
}

function getHeroValidationMessages() {
  const hiddenInput = document.getElementById("homepage_interest");
  const locationInput = document.getElementById("location");
  const messages = [];
  const zipStatus = locationInput ? getZipMarketStatus(locationInput.value) : null;

  if (!hiddenInput || !locationInput) {
    return messages;
  }

  if (!String(hiddenInput.value || "").trim()) {
    messages.push("Choose the kind of support you want.");
  }

  if (!locationInput.value.trim()) {
    messages.push("Enter your California ZIP code to get matched.");
  } else if (zipStatus && zipStatus.status === "out_of_state") {
    messages.push(zipStatus.message + " We’re currently matching California ZIP codes.");
  } else if (zipStatus && zipStatus.status === "unknown") {
    messages.push(
      "We can still start with this California ZIP and tighten the list on the next step.",
    );
  }

  return messages;
}

function showHeroValidationPopup(messages) {
  const popup = document.getElementById("heroValidationPopup");
  const list = document.getElementById("heroValidationList");

  if (!popup || !list) {
    return;
  }

  list.replaceChildren(
    ...(messages || []).map(function (message) {
      const item = document.createElement("div");
      item.textContent = message;
      return item;
    }),
  );
  popup.classList.add("is-visible");
}

function hideHeroValidationPopup() {
  const popup = document.getElementById("heroValidationPopup");
  const list = document.getElementById("heroValidationList");

  if (!popup || !list) {
    return;
  }

  popup.classList.remove("is-visible");
  list.replaceChildren();
}

function applyAdaptiveHomepageMode() {
  if (activeHomeExperimentVariant !== "adaptive") {
    return;
  }

  const adaptiveSignals = summarizeAdaptiveSignals(readFunnelEvents(), []);
  const mode =
    adaptiveSignals && adaptiveSignals.preferred_home_mode
      ? adaptiveSignals.preferred_home_mode
      : "trust";
  const eyebrow = document.getElementById("heroEyebrow");
  const toolTitle = document.getElementById("toolTitle");
  const proofLabel1 = document.getElementById("heroProofLabel1");
  const proofValue1 = document.getElementById("heroProofValue1");
  const proofLabel2 = document.getElementById("heroProofLabel2");
  const proofValue2 = document.getElementById("heroProofValue2");
  const proofLabel3 = document.getElementById("heroProofLabel3");
  const proofValue3 = document.getElementById("heroProofValue3");
  const trustPill1 = document.getElementById("homeTrustPill1");
  const trustPill2 = document.getElementById("homeTrustPill2");
  const handoffTitle1 = document.getElementById("handoffTitle1");
  const handoffCopy1 = document.getElementById("handoffCopy1");
  const handoffTitle2 = document.getElementById("handoffTitle2");
  const handoffCopy2 = document.getElementById("handoffCopy2");
  const handoffTitle3 = document.getElementById("handoffTitle3");
  const handoffCopy3 = document.getElementById("handoffCopy3");

  if (mode === "speed") {
    if (eyebrow) eyebrow.textContent = "Faster start for bipolar informed care";
    if (toolTitle) toolTitle.textContent = "Start with the fastest path to a strong list";
    if (proofLabel1) proofLabel1.textContent = "What it optimizes";
    if (proofValue1)
      proofValue1.textContent =
        "A faster path to a list that feels easier to contact without making the search heavier.";
    if (proofLabel2) proofLabel2.textContent = "What we raise first";
    if (proofValue2)
      proofValue2.textContent =
        "Clearer availability cues, easier contact paths, and lower-friction first moves.";
    if (proofLabel3) proofLabel3.textContent = "What you still confirm";
    if (proofValue3)
      proofValue3.textContent =
        "Openings, insurance, and whether the therapist feels right once you actually connect.";
    if (trustPill1) trustPill1.textContent = "Built to reduce time-to-first-contact";
    if (trustPill2) trustPill2.textContent = "Still honest about what outreach must confirm";
    if (handoffTitle1) handoffTitle1.textContent = "You get to a contact-ready list faster.";
    if (handoffCopy1)
      handoffCopy1.textContent =
        "The next step is built to shorten the distance between starting and knowing who to contact first, without making the search feel heavier.";
    if (handoffTitle2) handoffTitle2.textContent = "This path is optimized for momentum.";
    if (handoffCopy2)
      handoffCopy2.textContent =
        "It leans harder on follow-through and lower-friction contact signals so the search keeps moving with less hesitation.";
    if (handoffTitle3) handoffTitle3.textContent = "You can still slow down if you need to.";
    if (handoffCopy3)
      handoffCopy3.textContent =
        "A faster start does not trap you. You can still browse, compare, or pause before reaching out.";
    return;
  }

  if (mode === "specialization") {
    if (eyebrow) eyebrow.textContent = "Specialty-first bipolar care matching";
    if (toolTitle) toolTitle.textContent = "Start with the strongest bipolar-specific fit signals";
    if (proofLabel1) proofLabel1.textContent = "What it optimizes";
    if (proofValue1)
      proofValue1.textContent =
        "Deeper bipolar focus, stronger clinical-fit cues, and more relevant specialty depth.";
    if (proofLabel2) proofLabel2.textContent = "What we raise first";
    if (proofValue2)
      proofValue2.textContent =
        "Providers whose profiles suggest stronger bipolar-specific alignment before you spend time contacting broadly.";
    if (proofLabel3) proofLabel3.textContent = "What you still confirm";
    if (proofValue3)
      proofValue3.textContent =
        "Availability, cost path, and whether the actual conversation matches the profile signals.";
    if (trustPill1) trustPill1.textContent = "Leans harder on bipolar-specific depth";
    if (trustPill2) trustPill2.textContent = "Still honest about what profiles cannot prove alone";
    if (handoffTitle1) handoffTitle1.textContent = "You answer a few questions that sharpen fit.";
    if (handoffCopy1)
      handoffCopy1.textContent =
        "The next step helps the list lean harder on specialty relevance instead of broad similarity, so the comparison feels more grounded.";
    if (handoffTitle2)
      handoffTitle2.textContent = "This is for quality of fit, not just more results.";
    if (handoffCopy2)
      handoffCopy2.textContent =
        "It is designed for people who want the list to feel more clinically and practically aligned before they spend energy reaching out.";
    if (handoffTitle3) handoffTitle3.textContent = "You are not locked into one path.";
    if (handoffCopy3)
      handoffCopy3.textContent =
        "You can still step back into browsing if you want to compare more widely before acting.";
    return;
  }

  if (mode === "contact") {
    if (eyebrow) eyebrow.textContent = "Clearer path to first outreach";
    if (toolTitle) toolTitle.textContent = "Start with the clearest path to first outreach";
    if (proofLabel1) proofLabel1.textContent = "What it optimizes";
    if (proofValue1)
      proofValue1.textContent =
        "A quicker move from list to first message, with less hesitation about who to contact.";
    if (proofLabel2) proofLabel2.textContent = "What we raise first";
    if (proofValue2)
      proofValue2.textContent =
        "Providers with better contact clarity, stronger follow-through cues, and more usable next steps.";
    if (proofLabel3) proofLabel3.textContent = "What you still confirm";
    if (proofValue3)
      proofValue3.textContent =
        "How quickly they reply, whether they fit your coverage, and whether the route still feels right after outreach.";
    if (trustPill1) trustPill1.textContent = "Built to reduce contact hesitation";
    if (trustPill2) trustPill2.textContent = "Still grounded in what real outreach must confirm";
    if (handoffTitle1)
      handoffTitle1.textContent = "You move quickly into a clearer first outreach plan.";
    if (handoffCopy1)
      handoffCopy1.textContent =
        "The match is tuned to help you feel more certain about who to contact and what to do next, without forcing a rushed decision.";
    if (handoffTitle2) handoffTitle2.textContent = "This path is built for lower hesitation.";
    if (handoffCopy2)
      handoffCopy2.textContent =
        "It favors providers with clearer route and follow-through signals so the list feels easier to use.";
    if (handoffTitle3) handoffTitle3.textContent = "You can still pause before outreach.";
    if (handoffCopy3)
      handoffCopy3.textContent =
        "Nothing about starting the match forces immediate contact. It simply gets you to a better first move.";
    return;
  }

  if (eyebrow) eyebrow.textContent = "Bipolar-focused therapist matching";
  if (toolTitle) toolTitle.textContent = "Start with a smaller, more relevant list";
  if (proofLabel1) proofLabel1.textContent = "First pass";
  if (proofValue1)
    proofValue1.textContent =
      "About 2 minutes to move from broad searching into a smaller, more decision-ready list.";
  if (proofLabel2) proofLabel2.textContent = "What it checks first";
  if (proofValue2)
    proofValue2.textContent =
      "Bipolar-relevant fit, stronger profile trust signals, and a clearer first-contact path.";
  if (proofLabel3) proofLabel3.textContent = "What you still confirm";
  if (proofValue3)
    proofValue3.textContent =
      "Openings, insurance, cost path, and whether the therapist feels right in actual conversation.";
  if (trustPill1) trustPill1.textContent = "Built specifically for bipolar-related care search";
  if (trustPill2) trustPill2.textContent = "You still confirm openings and fit directly";
  if (handoffTitle1) handoffTitle1.textContent = "You answer a few focused questions.";
  if (handoffCopy1)
    handoffCopy1.textContent =
      "The match uses only a small amount of information up front so you can get to a useful list quickly.";
  if (handoffTitle2) handoffTitle2.textContent = "It is designed to reduce second-guessing.";
  if (handoffCopy2)
    handoffCopy2.textContent =
      "The goal is not endless browsing. It is to help you decide where to focus first with more trust, less noise, and less search fatigue.";
  if (handoffTitle3) handoffTitle3.textContent = "You are not signing up for a heavy process.";
  if (handoffCopy3)
    handoffCopy3.textContent =
      "No account is required to start, and you can still browse on your own at any point if that feels better.";
}

function initHeroCareDropdown() {
  const select = document.getElementById("homepage_interest");

  if (!select) {
    return;
  }

  select.addEventListener("change", function () {
    hideHeroValidationPopup();
    syncHeroSearchState();
  });

  syncHeroSearchState();
}

function initHeroZipFocusRow() {
  const zipField = document.querySelector(".search-field--zip");
  const zipInput = document.getElementById("location");

  if (!zipField || !zipInput) {
    return;
  }

  zipField.addEventListener("click", function (event) {
    if (event.target === zipInput) {
      return;
    }
    zipInput.focus();
  });
}

function appendTextElement(parent, tagName, className, value) {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  node.textContent = value || "";
  parent.appendChild(node);
  return node;
}

function createSectionShell() {
  const section = document.createElement("section");
  section.className = "home-cms-section--white";
  return section;
}

function renderIconCardsSection(section) {
  const cards = Array.isArray(section.cards) ? section.cards : [];
  const sectionNode = createSectionShell();
  const header = document.createElement("div");
  header.className = "section-header";
  appendTextElement(header, "div", "eyebrow", section.eyebrow || "");
  appendTextElement(header, "h2", "", section.title || "");
  appendTextElement(header, "p", "section-sub", section.description || "");
  sectionNode.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "why-grid";
  cards.forEach(function (card) {
    const cardNode = document.createElement("div");
    cardNode.className = "why-card";
    if (card.icon) {
      appendTextElement(cardNode, "div", "why-icon", card.icon);
    }
    appendTextElement(cardNode, "div", "why-title", card.title || "");
    appendTextElement(cardNode, "div", "why-desc", card.description || "");
    grid.appendChild(cardNode);
  });
  sectionNode.appendChild(grid);
  return sectionNode;
}

function renderTestimonialsSection(section) {
  const items = Array.isArray(section.items) ? section.items : [];
  const sectionNode = createSectionShell();
  sectionNode.classList.add("home-cms-section--flush-top");
  const header = document.createElement("div");
  header.className = "section-header";
  header.classList.add("home-cms-section-header--padded");
  appendTextElement(header, "div", "eyebrow", section.eyebrow || "");
  appendTextElement(header, "h2", "", section.title || "");
  sectionNode.appendChild(header);

  const list = document.createElement("div");
  list.className = "testimonials";
  items.forEach(function (item) {
    const testimonial = document.createElement("div");
    testimonial.className = "testimonial";
    appendTextElement(testimonial, "div", "stars", item.stars || "★★★★★");
    appendTextElement(testimonial, "div", "t-text", item.quote || "");
    appendTextElement(testimonial, "div", "t-author", item.author || "");
    appendTextElement(testimonial, "div", "t-role", item.role || "");
    list.appendChild(testimonial);
  });
  sectionNode.appendChild(list);
  return sectionNode;
}

function defaultSectionsFromLegacy(homePage) {
  return [
    {
      _type: "iconCardsSection",
      eyebrow: homePage && homePage.whyEyebrow ? homePage.whyEyebrow : "Why BipolarTherapyHub",
      title:
        homePage && homePage.whyTitle
          ? homePage.whyTitle
          : "Less noise. Less guesswork. Built for bipolar.",
      description:
        homePage && homePage.whyDescription
          ? homePage.whyDescription
          : "General directories make you do the sorting. This one starts with bipolar and narrows toward the therapists most likely to help.",
      cards:
        homePage && Array.isArray(homePage.whyCards) && homePage.whyCards.length
          ? homePage.whyCards
          : [
              {
                icon: "",
                title: "Specialty-first search",
                description:
                  "Bipolar disorder is the starting point, not a buried filter inside a broad therapist marketplace.",
              },
              {
                icon: "",
                title: "Less noise, more relevance",
                description:
                  "The goal is not to show the most options. It is to help you narrow toward the right ones faster.",
              },
              {
                icon: "",
                title: "Built for overwhelmed moments",
                description:
                  "The experience is meant to reduce stress and make the next step feel more manageable when the search already feels heavy.",
              },
            ],
    },
    {
      _type: "stepsSection",
      eyebrow: homePage && homePage.stepsEyebrow ? homePage.stepsEyebrow : "For Patients",
      title: homePage && homePage.stepsTitle ? homePage.stepsTitle : "How the search gets clearer",
      cards:
        homePage && Array.isArray(homePage.stepsCards) && homePage.stepsCards.length
          ? homePage.stepsCards
          : [
              {
                icon: "",
                stepLabel: "Step 1",
                title: "Start with your care type and location",
                description:
                  "Tell us whether you want therapy or psychiatry support, then add your ZIP code to ground the search.",
              },
              {
                icon: "",
                stepLabel: "Step 2",
                title: "See bipolar-relevant therapist options",
                description:
                  "Compare profiles built to highlight specialty relevance, fit, and practical details that matter before first contact.",
              },
              {
                icon: "",
                stepLabel: "Step 3",
                title: "Choose your next step with confidence",
                description:
                  "Move forward with less guesswork about who may understand bipolar care and where to start outreach.",
              },
            ],
    },
    {
      _type: "testimonialsSection",
      eyebrow:
        homePage && homePage.testimonialsEyebrow ? homePage.testimonialsEyebrow : "Patient Stories",
      title:
        homePage && homePage.testimonialsTitle
          ? homePage.testimonialsTitle
          : "What a better search experience should feel like",
      items:
        homePage && Array.isArray(homePage.testimonials) && homePage.testimonials.length
          ? homePage.testimonials
          : [
              {
                stars: "★★★★★",
                quote:
                  '"I did not need hundreds of generic listings. I needed a shorter list of therapists who actually seemed prepared for bipolar care."',
                author: "Alyssa R.",
                role: "Los Angeles therapy search",
              },
              {
                stars: "★★★★★",
                quote:
                  '"This felt clearer right away. I could compare options without wondering if bipolar disorder was just another keyword on the profile."',
                author: "David P.",
                role: "California telehealth psychiatry search",
              },
              {
                stars: "★★★★★",
                quote:
                  '"As a partner helping with the search, I needed something calmer and easier to trust. The focused approach made a real difference."',
                author: "Marina K.",
                role: "Partner helping with bipolar care search",
              },
            ],
    },
    {
      _type: "ctaSection",
      title:
        homePage && homePage.ctaTitle
          ? homePage.ctaTitle
          : "Are you a therapist with bipolar-related expertise?",
      description:
        homePage && homePage.ctaDescription
          ? homePage.ctaDescription
          : "Start with the guided match if you want a smaller, more relevant list, or browse the directory if you prefer to explore first.",
      primaryLabel:
        homePage && homePage.ctaPrimaryLabel ? homePage.ctaPrimaryLabel : "Start Your Match",
      primaryUrl: homePage && homePage.ctaPrimaryUrl ? homePage.ctaPrimaryUrl : "#startMatch",
      secondaryLabel:
        homePage && homePage.ctaSecondaryLabel
          ? homePage.ctaSecondaryLabel
          : "Browse the Directory",
      secondaryUrl:
        homePage && homePage.ctaSecondaryUrl ? homePage.ctaSecondaryUrl : "directory.html",
    },
  ];
}

function renderPageSections(homePage) {
  const root = document.getElementById("pageSections");
  if (!root) {
    return;
  }

  const sections =
    homePage && Array.isArray(homePage.sections) && homePage.sections.length
      ? homePage.sections
      : defaultSectionsFromLegacy(homePage);

  const renderedSections = sections
    .map(function (section) {
      if (!section || !section._type) {
        return null;
      }

      if (section._type === "iconCardsSection") {
        return renderIconCardsSection(section);
      }

      if (section._type === "stepsSection") {
        return null;
      }

      if (section._type === "testimonialsSection") {
        return renderTestimonialsSection(section);
      }

      // ctaSection is the bottom therapist-recruitment strip; suppressed on the
      // patient-facing home until we have a demand story worth pitching.
      if (section._type === "ctaSection") {
        return null;
      }

      return null;
    })
    .filter(Boolean);

  root.replaceChildren(...renderedSections);
}

function getHomeSearchElements() {
  return {
    form: document.getElementById("homeSearchForm"),
    locationInput: document.getElementById("location"),
    interestInput: document.getElementById("homepage_interest"),
    careIntentInput: document.getElementById("homepage_care_intent"),
    medicationNeedInput: document.getElementById("homepage_medication_need"),
  };
}

function readHomeSearchInputs(elements) {
  return {
    locationQuery:
      elements && elements.locationInput ? String(elements.locationInput.value || "").trim() : "",
    interest:
      elements && elements.interestInput ? String(elements.interestInput.value || "").trim() : "",
  };
}

function syncHomeSearchHiddenFields(interest, elements) {
  const refs = elements || getHomeSearchElements();
  const careIntentInput = refs.careIntentInput;
  const medicationNeedInput = refs.medicationNeedInput;

  if (!careIntentInput || !medicationNeedInput) {
    return;
  }

  if (interest === "therapist") {
    careIntentInput.value = "Therapy";
    medicationNeedInput.value = "No";
    return;
  }

  if (interest === "psychiatrist") {
    careIntentInput.value = "Psychiatry";
    medicationNeedInput.value = "Yes";
    return;
  }

  careIntentInput.value = "";
  medicationNeedInput.value = "";
}

function validateHomeSearchInputs(elements) {
  const values = readHomeSearchInputs(elements);
  const zipStatus = getZipMarketStatus(values.locationQuery);
  const state = {
    locationQuery: values.locationQuery,
    interest: values.interest,
    zipStatus: zipStatus,
    validationMessages: getHeroValidationMessages(),
    canSubmit: true,
    focusTarget: null,
  };

  if (!values.interest) {
    state.canSubmit = false;
    state.focusTarget = elements && elements.interestInput ? elements.interestInput : null;
    return state;
  }

  if (!values.locationQuery) {
    state.canSubmit = false;
    state.focusTarget = elements && elements.locationInput ? elements.locationInput : null;
    return state;
  }

  if (zipStatus.status === "out_of_state") {
    state.canSubmit = false;
    state.focusTarget = elements && elements.locationInput ? elements.locationInput : null;
  }

  return state;
}

function buildHomeSearchTarget(form) {
  const params = new URLSearchParams();
  if (form && form.elements) {
    Array.from(form.elements).forEach(function (field) {
      if (!field || !field.name || field.disabled) {
        return;
      }

      if ((field.type === "checkbox" || field.type === "radio") && !field.checked) {
        return;
      }

      const normalized = String(field.value || "").trim();
      if (!normalized) {
        return;
      }

      params.set(field.name, normalized);
    });
  }

  const action = (form && form.getAttribute("action")) || "match.html";
  return action + (params.toString() ? "?" + params.toString() : "");
}

function readHomeLastSearch() {
  try {
    const raw =
      window.sessionStorage.getItem(HOME_LAST_SEARCH_KEY) ||
      window.localStorage.getItem(HOME_LAST_SEARCH_KEY) ||
      "null";
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function writeHomeLastSearch(search) {
  try {
    window.sessionStorage.setItem(HOME_LAST_SEARCH_KEY, JSON.stringify(search || {}));
    window.localStorage.removeItem(HOME_LAST_SEARCH_KEY);
  } catch (_error) {
    // Last-search persistence is just a convenience.
  }
}

function clearHomeSearchSession() {
  try {
    window.sessionStorage.removeItem(HOME_SEARCH_SESSION_KEY);
    window.sessionStorage.removeItem(HOME_LAST_SEARCH_KEY);
    window.localStorage.removeItem(HOME_LAST_SEARCH_KEY);
  } catch (_error) {
    // Ignore storage failures.
  }
}

function handleHomeSearch(event) {
  if (event && typeof event.preventDefault === "function") {
    event.preventDefault();
  }

  const elements = getHomeSearchElements();
  const validation = validateHomeSearchInputs(elements);

  if (validation.validationMessages.length) {
    showHeroValidationPopup(validation.validationMessages);
  }

  if (!validation.canSubmit) {
    if (validation.focusTarget) {
      validation.focusTarget.focus();
    }
    syncHeroSearchState();
    return;
  }

  trackFunnelEvent("home_location_submitted", {
    has_location: Boolean(validation.locationQuery),
    interest_type: validation.interest || "unspecified",
  });
  trackFunnelEvent("home_match_started", {
    has_location: Boolean(validation.locationQuery),
    interest_type: validation.interest || "unspecified",
    source: "hero",
    experiments: {
      homepage_messaging: activeHomeExperimentVariant,
    },
  });
  syncHomeSearchHiddenFields(validation.interest, elements);
  try {
    writeHomeLastSearch({
      interest: validation.interest || "",
      location_query: validation.locationQuery || "",
    });
    // Mark this tab as having an active search session so the homepage can
    // distinguish a within-session back-navigation from a fresh visit.
    window.sessionStorage.setItem(HOME_SEARCH_SESSION_KEY, "1");
  } catch (_e) {
    /* ignore */
  }
  window.location.assign(buildHomeSearchTarget(elements.form));
}

function initHomeSearchForm() {
  const elements = getHomeSearchElements();
  const form = elements.form;
  if (!form || form.dataset.bound === "true") {
    return;
  }

  form.addEventListener("submit", handleHomeSearch);
  form.dataset.bound = "true";

  // Restore last search values only within the same browser session.
  // sessionStorage is cleared when the tab is closed, so a fresh visit
  // (reopen site, bookmark, external link) always starts with a blank form.
  try {
    const sessionActive = window.sessionStorage.getItem(HOME_SEARCH_SESSION_KEY);
    if (sessionActive) {
      const lastSearch = readHomeLastSearch();
      if (lastSearch) {
        if (lastSearch.location_query && elements.locationInput) {
          elements.locationInput.value = lastSearch.location_query;
        }
        if (lastSearch.interest && elements.interestInput) {
          elements.interestInput.value = lastSearch.interest;
          syncHomeSearchHiddenFields(lastSearch.interest, elements);
        }
      }
    }
  } catch (_e) {
    /* ignore */
  }
}

(async function () {
  try {
    const isFreshVisit =
      !document.referrer || !document.referrer.includes(window.location.hostname);
    if (isFreshVisit) {
      clearHomeSearchSession();
      window.sessionStorage.removeItem("matchResultsUrl");
    }
  } catch (_e) {}

  initHomeSearchForm();
  window.handleSearch = handleHomeSearch;

  initHeroCareDropdown();
  initHeroZipFocusRow();
  // ca-zipcodes.json is ~198 KB. Most home visitors never type a
  // location, so defer the fetch until they focus or start typing in
  // the location field. preloadZipcodes() is idempotent — calling it
  // twice is free.
  const locationInput = document.getElementById("location");
  if (locationInput) {
    const triggerZipPreload = function () {
      preloadZipcodes().catch(function () {
        return null;
      });
    };
    locationInput.addEventListener("focus", triggerZipPreload, { once: true });
    locationInput.addEventListener("input", triggerZipPreload, { once: true });
    locationInput.addEventListener("input", syncHeroSearchState);
    locationInput.addEventListener("change", syncHeroSearchState);
  } else {
    // No location input on this layout — preload eagerly so downstream
    // pages that depend on warmed cache (e.g. quick zip checks) still
    // get the benefit. Negligible impact since this branch is rare.
    preloadZipcodes().catch(function () {
      return null;
    });
  }
  const interestInput = document.getElementById("homepage_interest");
  if (interestInput) {
    interestInput.addEventListener("change", function () {
      syncHomeSearchHiddenFields(String(interestInput.value || "").trim());
    });
  }
  syncHomeSearchHiddenFields(interestInput ? String(interestInput.value || "").trim() : "");
  syncHeroSearchState();

  // Bottom "Start my match ↑" CTA scrolls to top and focuses the
  // first form field. A plain href="#startMatch" jumps without smooth
  // scroll and leaves the ZIP field blurred, this makes the round
  // trip feel intentional on long scroll.
  document.querySelectorAll('a[href="#startMatch"]').forEach(function (link) {
    link.addEventListener("click", function (event) {
      event.preventDefault();
      // Demand-side top-of-funnel signal: a visitor clicked a "Find care"
      // CTA. Surfaced in the admin funnel dashboard's "At a glance" counts
      // (see HEADLINE_KEY_EVENTS in assets/admin-funnel.js).
      trackFunnelEvent("home_find_care_clicked", {
        surface: "homepage",
        cta_location: link.classList.contains("mobile-sticky-cta")
          ? "mobile_sticky"
          : link.classList.contains("btn-cta-white")
            ? "footer"
            : "inline",
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      const first = document.getElementById("homepage_interest");
      if (first) {
        window.setTimeout(function () {
          first.focus({ preventScroll: true });
        }, 450);
      }
    });
  });

  try {
    const content = await fetchHomePageContent();

    const therapistCount =
      (content.stats && Number(content.stats.total_therapists)) ||
      (Array.isArray(content.therapists) ? content.therapists.length : 0);
    if (therapistCount > 0) {
      const countEl = document.querySelector("[data-proof-therapist-count]");
      if (countEl) {
        countEl.textContent = String(therapistCount);
      }
    }

    applyHomePageCopy(content.homePage);
    applySiteSettings(content.siteSettings);
    activeHomeExperimentVariant = getExperimentVariant("homepage_messaging", [
      "control",
      "adaptive",
    ]);
    trackExperimentExposure("homepage_messaging", activeHomeExperimentVariant, {
      surface: "homepage",
    });
    applyAdaptiveHomepageMode();
    renderPageSections(content.homePage);
  } catch (error) {
    console.error("Failed to initialize homepage content.", error);
    activeHomeExperimentVariant = getExperimentVariant("homepage_messaging", [
      "control",
      "adaptive",
    ]);
    trackExperimentExposure("homepage_messaging", activeHomeExperimentVariant, {
      surface: "homepage",
    });
    applyAdaptiveHomepageMode();
    renderPageSections(null, []);
  }
})();
