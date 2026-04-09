import { fetchHomePageContent } from "./cms.js";
import {
  getExperimentVariant,
  readFunnelEvents,
  summarizeAdaptiveSignals,
  trackExperimentExposure,
  trackFunnelEvent,
} from "./funnel-analytics.js";
import { getZipMarketStatus } from "./zip-lookup.js";

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

  if (!hiddenInput || !locationInput) {
    return;
  }

  var interest = String(hiddenInput.value || "").trim();
  var hasLocation = Boolean(locationInput.value.trim());
  var isReady = Boolean(interest) && hasLocation;
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
    return "Start therapist match";
  }

  if (interest === "psychiatrist") {
    return "Start psychiatry match";
  }

  if (interest === "telehealth") {
    return "Start telehealth match";
  }

  return "Start my match";
}

function getHeroHelperCopy(interest, hasLocation) {
  if (!interest && !hasLocation) {
    return "<strong>Next:</strong> choose your care type and ZIP code to begin the guided match.";
  }

  if (interest && !hasLocation) {
    return (
      "<strong>Next:</strong> add your ZIP code to start your " +
      escapeHtml(interest === "psychiatrist" ? "psychiatry" : interest) +
      " match."
    );
  }

  if (!interest && hasLocation) {
    return "<strong>Next:</strong> choose the kind of support you want so we can tailor the match.";
  }

  return "<strong>Next:</strong> answer a few quick questions and review bipolar-relevant options.";
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
    messages.push("Choose the kind of care you want.");
  }

  if (!locationInput.value.trim()) {
    messages.push("Enter your ZIP code to get matched.");
  } else if (zipStatus && zipStatus.status === "out_of_state") {
    messages.push(zipStatus.message + " We’re currently focused on California ZIP codes.");
  } else if (zipStatus && zipStatus.status === "unknown") {
    messages.push("Enter a valid California ZIP code to get matched.");
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

  if (mode === "speed") {
    if (eyebrow) eyebrow.textContent = "Faster start for bipolar-informed care";
    if (toolTitle) toolTitle.textContent = "See the fastest next options first";
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
    return;
  }

  if (mode === "specialization") {
    if (eyebrow) eyebrow.textContent = "Specialty-first bipolar care matching";
    if (toolTitle) toolTitle.textContent = "Surface the strongest bipolar-specific fit";
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
    return;
  }

  if (mode === "contact") {
    if (eyebrow) eyebrow.textContent = "Clearer path to first outreach";
    if (toolTitle) toolTitle.textContent = "Get to a stronger next contact step";
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
    return;
  }

  if (eyebrow) eyebrow.textContent = "Focused match for bipolar-informed care";
  if (toolTitle) toolTitle.textContent = "Get to the next step faster";
  if (proofLabel1) proofLabel1.textContent = "What happens next";
  if (proofValue1)
    proofValue1.textContent = "Answer a few quick questions and get a focused shortlist.";
  if (proofLabel2) proofLabel2.textContent = "Built for";
  if (proofValue2)
    proofValue2.textContent = "Therapy, psychiatry, or telehealth support for bipolar care.";
  if (proofLabel3) proofLabel3.textContent = "Current launch";
  if (proofValue3)
    proofValue3.textContent = "California ZIP codes with a calmer, guided starting point.";
  if (trustPill1) trustPill1.textContent = "Takes about 2 minutes to begin";
  if (trustPill2) trustPill2.textContent = "No account required to start";
}

function initHeroCareDropdown() {
  var selectRoot = document.querySelector("[data-custom-select]");
  var hiddenInput = document.getElementById("homepage_interest");

  if (!selectRoot || !hiddenInput) {
    return;
  }

  var field = selectRoot.closest(".search-field--prompt");
  var trigger = selectRoot.querySelector(".custom-select-trigger");
  var options = Array.from(selectRoot.querySelectorAll(".custom-select-option"));
  var defaultLabel = "What kind of support are you looking for?";

  function setOpenState(isOpen) {
    selectRoot.classList.toggle("is-open", isOpen);
    if (field) {
      field.classList.toggle("is-open", isOpen);
    }
    if (trigger) {
      trigger.setAttribute("aria-expanded", String(isOpen));
    }
  }

  function closeMenu() {
    setOpenState(false);
  }

  function setSelectedValue(value, label) {
    hiddenInput.value = value || "";
    if (trigger) {
      trigger.textContent = label || defaultLabel;
    }
    options.forEach(function (option) {
      option.setAttribute("aria-selected", String(option.dataset.value === value));
    });
    syncHeroSearchState();
  }

  if (trigger) {
    trigger.textContent = defaultLabel;
    trigger.addEventListener("click", function () {
      var willOpen = !selectRoot.classList.contains("is-open");
      setOpenState(willOpen);
    });

    trigger.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setOpenState(true);
        if (options[0]) {
          options[0].focus();
        }
      } else if (event.key === "Escape") {
        closeMenu();
      }
    });
  }

  options.forEach(function (option, index) {
    option.addEventListener("click", function () {
      setSelectedValue(option.dataset.value || "", option.textContent.trim());
      closeMenu();
      if (trigger) {
        trigger.focus();
      }
    });

    option.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        if (trigger) {
          trigger.focus();
        }
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        (options[index + 1] || options[0]).focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        (options[index - 1] || options[options.length - 1]).focus();
      }
    });
  });

  document.addEventListener("click", function (event) {
    if (!selectRoot.contains(event.target)) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeMenu();
    }
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
                  "Tell us whether you want therapy, psychiatry, or telehealth support, then add your ZIP code to ground the search.",
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
          : "Join a focused directory designed to help people looking for bipolar-informed care find and understand your practice more easily.",
      primaryLabel:
        homePage && homePage.ctaPrimaryLabel ? homePage.ctaPrimaryLabel : "List Your Practice",
      primaryUrl: homePage && homePage.ctaPrimaryUrl ? homePage.ctaPrimaryUrl : "signup.html",
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

(async function () {
  var content = await fetchHomePageContent();

  applyHomePageCopy(content.homePage);
  applySiteSettings(content.siteSettings);
  activeHomeExperimentVariant = getExperimentVariant("homepage_messaging", ["control", "adaptive"]);
  trackExperimentExposure("homepage_messaging", activeHomeExperimentVariant, {
    surface: "homepage",
  });
  applyAdaptiveHomepageMode();
  renderPageSections(content.homePage, content.featuredTherapists || []);

  window.handleSearch = function (event) {
    event.preventDefault();
    var loc = document.getElementById("location").value.trim();
    var interest = document.getElementById("homepage_interest").value || "";
    var validationMessages = getHeroValidationMessages();
    var zipStatus = getZipMarketStatus(loc);

    if (validationMessages.length) {
      showHeroValidationPopup(validationMessages);
    }

    if (!interest) {
      var trigger = document.querySelector(".custom-select-trigger");
      if (trigger) {
        trigger.focus();
      }
      syncHeroSearchState();
      return;
    }

    if (!loc) {
      var locationInput = document.getElementById("location");
      if (locationInput) {
        locationInput.focus();
      }
      syncHeroSearchState();
      return;
    }

    if (zipStatus.status === "out_of_state" || zipStatus.status === "unknown") {
      var locationField = document.getElementById("location");
      if (locationField) {
        locationField.focus();
      }
      syncHeroSearchState();
      return;
    }

    trackFunnelEvent("home_location_submitted", {
      has_location: Boolean(loc),
      interest_type: interest || "unspecified",
    });
    trackFunnelEvent("home_match_started", {
      has_location: Boolean(loc),
      interest_type: interest || "unspecified",
      source: "hero",
      experiments: {
        homepage_messaging: activeHomeExperimentVariant,
      },
    });
    var params = new URLSearchParams();
    if (loc) {
      params.set("location_query", loc);
    }
    if (interest === "therapist") {
      params.set("care_intent", "Therapy");
      params.set("care_format", "In-Person");
      params.set("needs_medication_management", "No");
    } else if (interest === "psychiatrist") {
      params.set("care_intent", "Psychiatry");
      params.set("needs_medication_management", "Yes");
    } else if (interest === "telehealth") {
      params.set("care_format", "Telehealth");
    }
    window.location.href = "match.html" + (params.toString() ? "?" + params.toString() : "");
  };

  initHeroCareDropdown();
  initHeroZipFocusRow();
  var locationInput = document.getElementById("location");
  if (locationInput) {
    locationInput.addEventListener("input", syncHeroSearchState);
    locationInput.addEventListener("change", syncHeroSearchState);
  }
  syncHeroSearchState();
})();
