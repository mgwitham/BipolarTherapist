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
      " shortlist."
    );
  }

  if (!interest && hasLocation) {
    return "<strong>Next:</strong> choose the kind of support you want so we can narrow toward the strongest first shortlist.";
  }

  return "<strong>Next:</strong> answer a few quick questions and review a smaller, more decision-ready shortlist built for bipolar care.";
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
      "We can still start with this California ZIP and tighten the shortlist on the next step.",
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
    if (toolTitle) toolTitle.textContent = "Start with the fastest path to a strong shortlist";
    if (proofLabel1) proofLabel1.textContent = "Fastest path";
    if (proofValue1)
      proofValue1.textContent = "Start with a quick match and get to contact-ready options faster.";
    if (proofLabel2) proofLabel2.textContent = "What rises";
    if (proofValue2)
      proofValue2.textContent =
        "Clear availability, easier contact paths, and less guesswork up front.";
    if (proofLabel3) proofLabel3.textContent = "Why this mode";
    if (proofValue3)
      proofValue3.textContent =
        "Similar users have been responding well to speed and follow-through cues.";
    if (trustPill1) trustPill1.textContent = "Built to reduce time-to-first-contact";
    if (trustPill2) trustPill2.textContent = "Highlights easier follow-through paths";
    if (handoffTitle1) handoffTitle1.textContent = "You get to a contact-ready shortlist faster.";
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
    if (proofLabel1) proofLabel1.textContent = "What rises";
    if (proofValue1)
      proofValue1.textContent =
        "Deeper bipolar focus, stronger clinical-fit cues, and more relevant expertise.";
    if (proofLabel2) proofLabel2.textContent = "Best for";
    if (proofValue2)
      proofValue2.textContent =
        "People who want the shortlist to lean harder on specialty relevance.";
    if (proofLabel3) proofLabel3.textContent = "Current learning";
    if (proofValue3)
      proofValue3.textContent =
        "Recent journeys suggest specialization signals are doing more decision work.";
    if (trustPill1) trustPill1.textContent = "Leans harder on bipolar-specific depth";
    if (trustPill2) trustPill2.textContent = "Built for fit before volume";
    if (handoffTitle1) handoffTitle1.textContent = "You answer a few questions that sharpen fit.";
    if (handoffCopy1)
      handoffCopy1.textContent =
        "The next step helps the shortlist lean harder on specialty relevance instead of broad similarity, so the comparison feels more grounded.";
    if (handoffTitle2)
      handoffTitle2.textContent = "This is for quality of fit, not just more results.";
    if (handoffCopy2)
      handoffCopy2.textContent =
        "It is designed for people who want the shortlist to feel more clinically and practically aligned before they spend energy reaching out.";
    if (handoffTitle3) handoffTitle3.textContent = "You are not locked into one path.";
    if (handoffCopy3)
      handoffCopy3.textContent =
        "You can still step back into browsing if you want to compare more widely before acting.";
    return;
  }

  if (mode === "contact") {
    if (eyebrow) eyebrow.textContent = "Clearer path to first outreach";
    if (toolTitle) toolTitle.textContent = "Start with the clearest path to first outreach";
    if (proofLabel1) proofLabel1.textContent = "What happens next";
    if (proofValue1)
      proofValue1.textContent =
        "Start matching, then move into clearer outreach guidance and ready-to-use next steps.";
    if (proofLabel2) proofLabel2.textContent = "What rises";
    if (proofValue2)
      proofValue2.textContent =
        "Providers with better contact clarity and stronger follow-through signals.";
    if (proofLabel3) proofLabel3.textContent = "Current learning";
    if (proofValue3)
      proofValue3.textContent =
        "Recent journeys suggest contact-readiness is helping people move sooner.";
    if (trustPill1) trustPill1.textContent = "Built to reduce contact hesitation";
    if (trustPill2) trustPill2.textContent = "Stronger next-step guidance near the match";
    if (handoffTitle1)
      handoffTitle1.textContent = "You move quickly into a clearer first outreach plan.";
    if (handoffCopy1)
      handoffCopy1.textContent =
        "The match is tuned to help you feel more certain about who to contact and what to do next, without forcing a rushed decision.";
    if (handoffTitle2) handoffTitle2.textContent = "This path is built for lower hesitation.";
    if (handoffCopy2)
      handoffCopy2.textContent =
        "It favors providers with clearer route and follow-through signals so the shortlist feels easier to use.";
    if (handoffTitle3) handoffTitle3.textContent = "You can still pause before outreach.";
    if (handoffCopy3)
      handoffCopy3.textContent =
        "Nothing about starting the match forces immediate contact. It simply gets you to a better first move.";
    return;
  }

  if (eyebrow) eyebrow.textContent = "Bipolar-focused therapist matching";
  if (toolTitle) toolTitle.textContent = "Start with a smaller, more relevant shortlist";
  if (proofLabel1) proofLabel1.textContent = "How long it takes";
  if (proofValue1)
    proofValue1.textContent = "About 2 minutes to begin and get to a more focused shortlist.";
  if (proofLabel2) proofLabel2.textContent = "Designed for";
  if (proofValue2)
    proofValue2.textContent = "Therapy and psychiatry options shaped around bipolar care.";
  if (proofLabel3) proofLabel3.textContent = "Currently available";
  if (proofValue3) proofValue3.textContent = "Matching California ZIP codes right now.";
  if (trustPill1) trustPill1.textContent = "Built specifically for bipolar-related care search";
  if (trustPill2) trustPill2.textContent = "No account required";
  if (handoffTitle1) handoffTitle1.textContent = "You answer a few focused questions.";
  if (handoffCopy1)
    handoffCopy1.textContent =
      "The match uses only a small amount of information up front so you can get to a useful shortlist quickly.";
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
          '<div class="why-card"><div class="why-icon">' +
          escapeHtml(card.icon || "•") +
          '</div><div class="why-title">' +
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
          '<div class="step-card"><div class="step-icon">' +
          escapeHtml(card.icon || "•") +
          '</div><div class="step-num">' +
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
          : "A calmer way to find bipolar-informed care",
      description:
        homePage && homePage.whyDescription
          ? homePage.whyDescription
          : "General directories can leave you guessing. This one is built to make therapist search feel more relevant, more understandable, and easier to act on.",
      cards:
        homePage && Array.isArray(homePage.whyCards) && homePage.whyCards.length
          ? homePage.whyCards
          : [
              {
                icon: "🎯",
                title: "Specialty-first search",
                description:
                  "Bipolar disorder is the starting point, not a buried filter inside a broad therapist marketplace.",
              },
              {
                icon: "✅",
                title: "Trust signals that feel useful",
                description:
                  "Profiles are designed to make expertise, fit, and practical details easier to understand before you reach out.",
              },
              {
                icon: "🧭",
                title: "Less noise, more relevance",
                description:
                  "The goal is not to show the most options. It is to help you narrow toward the right ones faster.",
              },
              {
                icon: "🤝",
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
                icon: "🔍",
                stepLabel: "Step 1",
                title: "Start with your care type and location",
                description:
                  "Tell us whether you want therapy or psychiatry support, then add your ZIP code to ground the search.",
              },
              {
                icon: "👤",
                stepLabel: "Step 2",
                title: "See bipolar-relevant therapist options",
                description:
                  "Compare profiles built to highlight specialty relevance, fit, and practical details that matter before first contact.",
              },
              {
                icon: "📞",
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
          : "Start with the guided match if you want a smaller, more relevant shortlist, or browse the directory if you prefer to explore first.",
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
        return renderStepsSection(section);
      }

      if (section._type === "testimonialsSection") {
        return renderTestimonialsSection(section);
      }

      if (section._type === "ctaSection") {
        return renderCtaSection(section);
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
  try {
    return JSON.parse(window.localStorage.getItem("bth_directory_shortlist_v1") || "[]")
      .map(function (item) {
        if (typeof item === "string") {
          return { slug: item };
        }
        return item && item.slug ? item : null;
      })
      .filter(Boolean)
      .slice(0, 3);
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

function renderHomepageReturnJourney() {
  var panel = document.getElementById("homeReturnPanel");
  var title = document.getElementById("homeReturnTitle");
  var copy = document.getElementById("homeReturnCopy");
  var actions = document.getElementById("homeReturnActions");
  if (!panel || !title || !copy || !actions) {
    return;
  }

  var shortlist = readHomepageShortlist();
  if (!shortlist.length) {
    panel.classList.remove("is-visible");
    title.textContent = "";
    copy.textContent = "";
    actions.innerHTML = "";
    return;
  }

  var shortlistSlugs = shortlist.map(function (item) {
    return item.slug;
  });
  var touchedCount = readHomepageOutcomes().filter(function (item) {
    return item && shortlistSlugs.indexOf(item.therapist_slug) !== -1;
  }).length;

  panel.classList.add("is-visible");
  title.textContent =
    touchedCount > 0
      ? "Your saved shortlist is still here, and some outreach progress is already in motion."
      : "Your saved shortlist is still here and ready whenever you want to pick the search back up.";
  copy.textContent =
    touchedCount > 0
      ? "Resume the shortlist to compare the same saved therapists, review where outreach stands, and decide your next move without rebuilding context."
      : "You can reopen the shortlist, review the same saved therapists, and keep narrowing without starting the search over from scratch.";
  actions.innerHTML =
    '<a class="hero-return-link primary" href="match.html?shortlist=' +
    encodeURIComponent(shortlistSlugs.join(",")) +
    '">Resume saved shortlist</a><a class="hero-return-link secondary" href="directory.html">Browse with saved progress</a>';
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
