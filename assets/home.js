import { fetchHomePageContent } from "./cms.js";
import {
  getExperimentVariant,
  readFunnelEvents,
  summarizeAdaptiveSignals,
  trackExperimentExposure,
  trackFunnelEvent,
} from "./funnel-analytics.js";
import { getZipMarketStatus, preloadZipcodes } from "./zip-lookup.js";

var activeHomeExperimentVariant = "control";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyHomePageCopy(homePage) {
  if (!homePage) {
    return;
  }

  var heroTitle = document.getElementById("heroTitle");
  var heroDescription = document.getElementById("heroDescription");
  var locationLabel = document.getElementById("locationLabel");
  var locationInput = document.getElementById("location");
  var searchButton = document.getElementById("searchButton");

  if (heroTitle && homePage.heroTitle) {
    heroTitle.textContent = homePage.heroTitle;
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

  var navBrowseLink = document.getElementById("navBrowseLink");
  var navCtaLink = document.getElementById("navCtaLink");
  var footerTagline = document.getElementById("footerTagline");
  var footerContactLink = document.getElementById("footerContactLink");

  if (navBrowseLink && siteSettings.browseLabel) {
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
  var resolved = document.getElementById("homeZipResolved");
  var inline = resolved ? resolved.closest(".zip-inline") : null;
  if (!resolved) {
    return;
  }

  var zipStatus = getZipMarketStatus(value);
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
  var hiddenInput = document.getElementById("homepage_interest");
  var locationInput = document.getElementById("location");
  var searchButton = document.getElementById("searchButton");
  var searchHelper = document.getElementById("searchHelper");
  var interestField = hiddenInput ? hiddenInput.closest(".search-field--prompt") : null;

  if (!hiddenInput || !locationInput) {
    return;
  }

  var interest = String(hiddenInput.value || "").trim();
  var hasLocation = Boolean(locationInput.value.trim());
  var isReady = Boolean(interest) && hasLocation;

  if (interestField) {
    interestField.classList.toggle("has-value", Boolean(interest));
  }

  syncHomeZipResolvedLabel(locationInput.value);

  if (searchButton) {
    searchButton.textContent = getHeroButtonLabel(interest);
  }

  if (searchHelper) {
    searchHelper.innerHTML = getHeroHelperCopy(interest, hasLocation);
  }

  renderHomeSearchPreview(interest, String(locationInput.value || "").trim());

  if (isReady) {
    hideHeroValidationPopup();
  }
}

function getHeroButtonLabel(interest) {
  if (interest === "therapist") {
    return "See therapy matches";
  }

  if (interest === "psychiatrist") {
    return "See psychiatry matches";
  }

  return "See my matches";
}

function getHeroHelperCopy(interest, hasLocation) {
  if (!interest && !hasLocation) {
    return "<strong>Recommended:</strong> choose your support type and California ZIP code to start with the calmer guided match.";
  }

  if (interest && !hasLocation) {
    return (
      "<strong>Next:</strong> add your California ZIP code to see a more trustworthy " +
      escapeHtml(interest === "psychiatrist" ? "psychiatry" : "therapy") +
      " list."
    );
  }

  if (!interest && hasLocation) {
    return "<strong>Next:</strong> choose the kind of support you want so we can narrow toward the strongest first list.";
  }

  return "<strong>Next:</strong> answer a few quick questions and review a smaller, more decision-ready list built for bipolar care.";
}

function setHomePreviewText(id, value) {
  var node = document.getElementById(id);
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
  var zipStatus = getZipMarketStatus(locationValue);
  var supportLabel = getHomeSupportLabel(interest);

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
  var hiddenInput = document.getElementById("homepage_interest");
  var locationInput = document.getElementById("location");
  var messages = [];
  var zipStatus = locationInput ? getZipMarketStatus(locationInput.value) : null;

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
  var popup = document.getElementById("heroValidationPopup");
  var list = document.getElementById("heroValidationList");

  if (!popup || !list) {
    return;
  }

  list.innerHTML = (messages || [])
    .map(function (message) {
      return "<div>" + escapeHtml(message) + "</div>";
    })
    .join("");
  popup.classList.add("is-visible");
}

function hideHeroValidationPopup() {
  var popup = document.getElementById("heroValidationPopup");
  var list = document.getElementById("heroValidationList");

  if (!popup || !list) {
    return;
  }

  popup.classList.remove("is-visible");
  list.innerHTML = "";
}

function applyAdaptiveHomepageMode() {
  if (activeHomeExperimentVariant !== "adaptive") {
    return;
  }

  var adaptiveSignals = summarizeAdaptiveSignals(readFunnelEvents(), []);
  var mode =
    adaptiveSignals && adaptiveSignals.preferred_home_mode
      ? adaptiveSignals.preferred_home_mode
      : "trust";
  var eyebrow = document.getElementById("heroEyebrow");
  var toolTitle = document.getElementById("toolTitle");
  var proofLabel1 = document.getElementById("heroProofLabel1");
  var proofValue1 = document.getElementById("heroProofValue1");
  var proofLabel2 = document.getElementById("heroProofLabel2");
  var proofValue2 = document.getElementById("heroProofValue2");
  var proofLabel3 = document.getElementById("heroProofLabel3");
  var proofValue3 = document.getElementById("heroProofValue3");
  var trustPill1 = document.getElementById("homeTrustPill1");
  var trustPill2 = document.getElementById("homeTrustPill2");
  var handoffTitle1 = document.getElementById("handoffTitle1");
  var handoffCopy1 = document.getElementById("handoffCopy1");
  var handoffTitle2 = document.getElementById("handoffTitle2");
  var handoffCopy2 = document.getElementById("handoffCopy2");
  var handoffTitle3 = document.getElementById("handoffTitle3");
  var handoffCopy3 = document.getElementById("handoffCopy3");

  if (mode === "speed") {
    if (eyebrow) eyebrow.textContent = "Faster start for bipolar-informed care";
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
  var select = document.getElementById("homepage_interest");

  if (!select) {
    return;
  }

  ["change", "input"].forEach(function (eventName) {
    select.addEventListener(eventName, function () {
      hideHeroValidationPopup();
      syncHeroSearchState();
    });
  });

  syncHeroSearchState();
}

function initHeroZipFocusRow() {
  var zipField = document.querySelector(".search-field--zip");
  var zipInput = document.getElementById("location");

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

function renderIconCardsSection(section) {
  var cards = Array.isArray(section.cards) ? section.cards : [];
  return (
    '<section style="background: var(--white)"><div class="section-header"><div class="eyebrow">' +
    escapeHtml(section.eyebrow || "") +
    "</div><h2>" +
    escapeHtml(section.title || "") +
    '</h2><p class="section-sub">' +
    escapeHtml(section.description || "") +
    '</p></div><div class="why-grid">' +
    cards
      .map(function (card) {
        return (
          '<div class="why-card">' +
          (card.icon ? '<div class="why-icon">' + escapeHtml(card.icon) + "</div>" : "") +
          '<div class="why-title">' +
          escapeHtml(card.title || "") +
          '</div><div class="why-desc">' +
          escapeHtml(card.description || "") +
          "</div></div>"
        );
      })
      .join("") +
    "</div></section>"
  );
}

function renderStepsSection(section) {
  var cards = Array.isArray(section.cards) ? section.cards : [];
  return (
    '<section><div class="section-header"><div class="eyebrow">' +
    escapeHtml(section.eyebrow || "") +
    "</div><h2>" +
    escapeHtml(section.title || "") +
    '</h2></div><div class="steps">' +
    cards
      .map(function (card) {
        return (
          '<div class="step-card">' +
          (card.icon ? '<div class="step-icon">' + escapeHtml(card.icon) + "</div>" : "") +
          '<div class="step-num">' +
          escapeHtml(card.stepLabel || "") +
          '</div><div class="step-title">' +
          escapeHtml(card.title || "") +
          '</div><div class="step-desc">' +
          escapeHtml(card.description || "") +
          "</div></div>"
        );
      })
      .join("") +
    "</div></section>"
  );
}

function renderTestimonialsSection(section) {
  var items = Array.isArray(section.items) ? section.items : [];
  return (
    '<section style="background: var(--white); padding-top: 0"><div class="section-header" style="padding-top: 4rem"><div class="eyebrow">' +
    escapeHtml(section.eyebrow || "") +
    "</div><h2>" +
    escapeHtml(section.title || "") +
    '</h2></div><div class="testimonials">' +
    items
      .map(function (item) {
        return (
          '<div class="testimonial"><div class="stars">' +
          escapeHtml(item.stars || "★★★★★") +
          '</div><div class="t-text">' +
          escapeHtml(item.quote || "") +
          '</div><div class="t-author">' +
          escapeHtml(item.author || "") +
          '</div><div class="t-role">' +
          escapeHtml(item.role || "") +
          "</div></div>"
        );
      })
      .join("") +
    "</div></section>"
  );
}

function renderCtaSection(section) {
  return (
    '<section class="cta-sect"><h2>' +
    escapeHtml(section.title || "") +
    "</h2><p>" +
    escapeHtml(section.description || "") +
    '</p><div class="cta-btns"><a href="' +
    escapeHtml(section.primaryUrl || "signup.html") +
    '" class="btn-p">' +
    escapeHtml(section.primaryLabel || "Primary CTA") +
    '</a><a href="' +
    escapeHtml(section.secondaryUrl || "directory.html") +
    '" class="btn-s">' +
    escapeHtml(section.secondaryLabel || "Secondary CTA") +
    "</a></div></section>"
  );
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

function renderPageSections(homePage, _featuredTherapists) {
  var root = document.getElementById("pageSections");
  if (!root) {
    return;
  }

  var sections =
    homePage && Array.isArray(homePage.sections) && homePage.sections.length
      ? homePage.sections
      : defaultSectionsFromLegacy(homePage);

  root.innerHTML = sections
    .map(function (section) {
      if (!section || !section._type) {
        return "";
      }

      if (section._type === "iconCardsSection") {
        return renderIconCardsSection(section);
      }

      if (section._type === "stepsSection") {
        return "";
      }

      if (section._type === "testimonialsSection") {
        return renderTestimonialsSection(section);
      }

      // ctaSection is the bottom therapist-recruitment strip; suppressed on the
      // patient-facing home until we have a demand story worth pitching.
      if (section._type === "ctaSection") {
        return "";
      }

      return "";
    })
    .join("");
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
  var refs = elements || getHomeSearchElements();
  var careIntentInput = refs.careIntentInput;
  var medicationNeedInput = refs.medicationNeedInput;

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

function readHomepageShortlist() {
  var DIRECTORY_LIST_LIMIT = 6;
  try {
    return JSON.parse(window.localStorage.getItem("bth_directory_shortlist_v1") || "[]")
      .map(function (item) {
        if (typeof item === "string") {
          return { slug: item };
        }
        return item && item.slug ? item : null;
      })
      .filter(Boolean)
      .slice(0, DIRECTORY_LIST_LIMIT);
  } catch (_error) {
    return [];
  }
}

function readHomepageOutcomes() {
  try {
    return JSON.parse(window.localStorage.getItem("bth_outreach_outcomes_v1") || "[]");
  } catch (_error) {
    return [];
  }
}

function readHomepageReshapeHistory() {
  try {
    return JSON.parse(window.localStorage.getItem("bth_shortlist_reshape_history_v1") || "null");
  } catch (_error) {
    return null;
  }
}

function getHomepagePriorityRank(value) {
  var normalized = String(value || "").toLowerCase();
  if (normalized === "best fit") {
    return 3;
  }
  if (normalized === "best availability") {
    return 2;
  }
  if (normalized === "best value") {
    return 1;
  }
  return 0;
}

function formatHomepageTherapistName(slug, latestOutcome) {
  if (latestOutcome && latestOutcome.therapist_name) {
    return latestOutcome.therapist_name;
  }
  return String(slug || "this therapist")
    .replace(/-/g, " ")
    .replace(/\b\w/g, function (char) {
      return char.toUpperCase();
    });
}

function buildHomepageReturnSnapshot(shortlist, outcomes) {
  var latestBySlug = {};

  (Array.isArray(outcomes) ? outcomes : [])
    .slice()
    .sort(function (a, b) {
      return new Date(b.recorded_at || 0).getTime() - new Date(a.recorded_at || 0).getTime();
    })
    .forEach(function (item) {
      if (!item || !item.therapist_slug || latestBySlug[item.therapist_slug]) {
        return;
      }
      latestBySlug[item.therapist_slug] = item;
    });

  var ranked = (Array.isArray(shortlist) ? shortlist : [])
    .map(function (item, index) {
      return {
        slug: item.slug,
        rank: getHomepagePriorityRank(item.priority),
        index: index,
        latestOutcome: latestBySlug[item.slug] || null,
      };
    })
    .sort(function (a, b) {
      return b.rank - a.rank || a.index - b.index;
    });

  return {
    lead:
      ranked.find(function (item) {
        return (
          !item.latestOutcome ||
          ["insurance_mismatch", "waitlist", "no_response"].indexOf(
            String(item.latestOutcome.outcome || ""),
          ) === -1
        );
      }) ||
      ranked[0] ||
      null,
    live:
      ranked.find(function (item) {
        return (
          item.latestOutcome &&
          ["heard_back", "booked_consult", "good_fit_call"].indexOf(
            String(item.latestOutcome.outcome || ""),
          ) !== -1
        );
      }) || null,
    stalled:
      ranked.find(function (item) {
        return (
          item.latestOutcome &&
          ["insurance_mismatch", "waitlist", "no_response"].indexOf(
            String(item.latestOutcome.outcome || ""),
          ) !== -1
        );
      }) || null,
  };
}

function renderHomepageReturnJourney() {
  var panel = document.getElementById("homeReturnPanel");
  var title = document.getElementById("homeReturnTitle");
  var copy = document.getElementById("homeReturnCopy");
  var meta = document.getElementById("homeReturnMeta");
  var actions = document.getElementById("homeReturnActions");
  if (!panel || !title || !copy || !meta || !actions) {
    return;
  }

  var shortlist = readHomepageShortlist();
  if (!shortlist.length) {
    panel.classList.remove("is-visible");
    title.textContent = "";
    copy.textContent = "";
    meta.innerHTML = "";
    actions.innerHTML = "";
    return;
  }

  var shortlistSlugs = shortlist.map(function (item) {
    return item.slug;
  });
  var outcomes = readHomepageOutcomes();
  var reshapeHistory = readHomepageReshapeHistory();
  var touchedCount = outcomes.filter(function (item) {
    return item && shortlistSlugs.indexOf(item.therapist_slug) !== -1;
  }).length;
  var snapshot = buildHomepageReturnSnapshot(shortlist, outcomes);
  var leadName = snapshot.lead
    ? formatHomepageTherapistName(snapshot.lead.slug, snapshot.lead.latestOutcome)
    : "your lead option";
  var liveName = snapshot.live
    ? formatHomepageTherapistName(snapshot.live.slug, snapshot.live.latestOutcome)
    : "";
  var stalledName = snapshot.stalled
    ? formatHomepageTherapistName(snapshot.stalled.slug, snapshot.stalled.latestOutcome)
    : "";

  panel.classList.add("is-visible");
  title.textContent =
    touchedCount > 0
      ? "Your saved list is still here, and the decision context is still intact."
      : "Your saved list is still here and ready whenever you want to pick the search back up.";
  copy.textContent =
    touchedCount > 0
      ? "Resume from the same saved options, reopen the route with live momentum, and decide whether your lead still deserves the top spot."
      : "You can reopen the list, review the same saved therapists, and keep narrowing without starting the search over from scratch.";
  meta.innerHTML = [
    reshapeHistory && reshapeHistory.summary
      ? '<div class="hero-return-chip"><div class="hero-return-chip-label">' +
        escapeHtml(reshapeHistory.title || "Last list reshape") +
        '</div><div class="hero-return-chip-value">Queue updated</div><div class="hero-return-chip-copy">' +
        escapeHtml(reshapeHistory.summary) +
        (reshapeHistory.meta ? " " + escapeHtml(reshapeHistory.meta) : "") +
        "</div></div>"
      : "",
    snapshot.lead
      ? '<div class="hero-return-chip"><div class="hero-return-chip-label">Still looks strongest</div><div class="hero-return-chip-value">' +
        escapeHtml(leadName) +
        '</div><div class="hero-return-chip-copy">Start here first unless fresh friction or live outreach changes the order.</div></div>'
      : "",
    snapshot.live
      ? '<div class="hero-return-chip"><div class="hero-return-chip-label">Already has momentum</div><div class="hero-return-chip-value">' +
        escapeHtml(liveName) +
        '</div><div class="hero-return-chip-copy">A reply or consult is already in motion here, so compare it against the backup using real follow-through, not just profile polish.</div></div>'
      : "",
    snapshot.stalled
      ? '<div class="hero-return-chip"><div class="hero-return-chip-label">Probably demote or drop</div><div class="hero-return-chip-value">' +
        escapeHtml(stalledName) +
        '</div><div class="hero-return-chip-copy">This path already hit friction. Keep it only if new information clearly changes the picture.</div></div>'
      : "",
  ]
    .filter(Boolean)
    .join("");
  actions.innerHTML =
    '<a class="hero-return-link primary" href="match.html?shortlist=' +
    encodeURIComponent(shortlistSlugs.join(",")) +
    '">Resume saved list</a><a class="hero-return-link secondary" href="directory.html">Reopen saved comparison</a>';
}

function validateHomeSearchInputs(elements) {
  var values = readHomeSearchInputs(elements);
  var zipStatus = getZipMarketStatus(values.locationQuery);
  var state = {
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
  var params = new URLSearchParams();
  if (form && form.elements) {
    Array.from(form.elements).forEach(function (field) {
      if (!field || !field.name || field.disabled) {
        return;
      }

      if ((field.type === "checkbox" || field.type === "radio") && !field.checked) {
        return;
      }

      var normalized = String(field.value || "").trim();
      if (!normalized) {
        return;
      }

      params.set(field.name, normalized);
    });
  }

  var action = (form && form.getAttribute("action")) || "match.html";
  return action + (params.toString() ? "?" + params.toString() : "");
}

function handleHomeSearch(event) {
  if (event && typeof event.preventDefault === "function") {
    event.preventDefault();
  }

  var elements = getHomeSearchElements();
  var validation = validateHomeSearchInputs(elements);

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
  window.location.assign(buildHomeSearchTarget(elements.form));
}

function initHomeSearchForm() {
  var elements = getHomeSearchElements();
  var form = elements.form;
  if (!form || form.dataset.bound === "true") {
    return;
  }

  form.addEventListener("submit", handleHomeSearch);
  form.dataset.bound = "true";
}

(async function () {
  initHomeSearchForm();
  window.handleSearch = handleHomeSearch;

  initHeroCareDropdown();
  initHeroZipFocusRow();
  preloadZipcodes().catch(function () {
    return null;
  });
  var locationInput = document.getElementById("location");
  if (locationInput) {
    locationInput.addEventListener("input", syncHeroSearchState);
    locationInput.addEventListener("change", syncHeroSearchState);
  }
  var interestInput = document.getElementById("homepage_interest");
  if (interestInput) {
    interestInput.addEventListener("change", function () {
      syncHomeSearchHiddenFields(String(interestInput.value || "").trim());
    });
  }
  syncHomeSearchHiddenFields(interestInput ? String(interestInput.value || "").trim() : "");
  syncHeroSearchState();
  renderHomepageReturnJourney();

  try {
    var content = await fetchHomePageContent();

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
    renderHomepageReturnJourney();
    renderPageSections(content.homePage, content.featuredTherapists || []);
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
    renderHomepageReturnJourney();
    renderPageSections(null, []);
  }
})();
