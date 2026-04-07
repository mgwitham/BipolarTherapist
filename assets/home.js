import { cmsEnabled, cmsStudioUrl, fetchHomePageContent, getCmsState } from "./cms.js";
import { getTherapistMerchandisingQuality } from "./matching-model.js";
import { getPublicResponsivenessSignal } from "./responsiveness-signal.js";
import {
  readFunnelEvents,
  summarizeAdaptiveSignals,
  trackFunnelEvent,
} from "./funnel-analytics.js";
import { getZipMarketStatus } from "./zip-lookup.js";

var isInternalMode = new URLSearchParams(window.location.search).get("internal") === "1";

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

  var heroBadge = document.getElementById("heroBadge");
  var heroTitle = document.getElementById("heroTitle");
  var heroDescription = document.getElementById("heroDescription");
  var searchLabel = document.getElementById("searchLabel");
  var searchInput = document.getElementById("q");
  var locationLabel = document.getElementById("locationLabel");
  var locationInput = document.getElementById("location");
  var searchButton = document.getElementById("searchButton");

  if (heroBadge && homePage.heroBadge) {
    heroBadge.textContent = homePage.heroBadge;
  }

  if (heroTitle && homePage.heroTitle) {
    heroTitle.textContent = homePage.heroTitle;
  }

  if (heroDescription && homePage.heroDescription) {
    heroDescription.textContent = homePage.heroDescription;
  }

  if (searchLabel && homePage.searchLabel) {
    searchLabel.textContent = homePage.searchLabel;
  }

  if (searchInput && homePage.searchPlaceholder) {
    searchInput.placeholder = homePage.searchPlaceholder;
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

  if (!hiddenInput || !locationInput) {
    return;
  }

  var isReady =
    Boolean(String(hiddenInput.value || "").trim()) && Boolean(locationInput.value.trim());
  syncHomeZipResolvedLabel(locationInput.value);
  if (isReady) {
    hideHeroValidationPopup();
  }
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

function initHeroCareDropdown() {
  var selectRoot = document.querySelector("[data-custom-select]");
  var hiddenInput = document.getElementById("homepage_interest");

  if (!selectRoot || !hiddenInput) {
    return;
  }

  var field = selectRoot.closest(".search-field--prompt");
  var trigger = selectRoot.querySelector(".custom-select-trigger");
  var options = Array.from(selectRoot.querySelectorAll(".custom-select-option"));
  var defaultLabel = "What type of care do you want?";

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

function sortTherapistsForMerchandising(therapists) {
  return (Array.isArray(therapists) ? therapists.slice() : []).sort(function (a, b) {
    var aQuality = getTherapistMerchandisingQuality(a);
    var bQuality = getTherapistMerchandisingQuality(b);
    return (
      bQuality.score - aQuality.score ||
      Number(b.accepting_new_patients === true) - Number(a.accepting_new_patients === true) ||
      Number(b.bipolar_years_experience || 0) - Number(a.bipolar_years_experience || 0) ||
      String(a.name || "").localeCompare(String(b.name || ""))
    );
  });
}

function getBestTherapistBySignal(therapists, mode) {
  var pool = Array.isArray(therapists) ? therapists.slice() : [];
  if (!pool.length) {
    return null;
  }

  if (mode === "speed") {
    var waitRank = {
      "Immediate availability": 0,
      "Within 1 week": 1,
      "Within 2 weeks": 2,
      "2-4 weeks": 3,
      "1-2 months": 4,
      "Waitlist only": 5,
    };
    return pool.sort(function (a, b) {
      return (
        Number(waitRank[a.estimated_wait_time] ?? 10) -
          Number(waitRank[b.estimated_wait_time] ?? 10) ||
        Number(b.accepting_new_patients === true) - Number(a.accepting_new_patients === true) ||
        getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score
      );
    })[0];
  }

  if (mode === "specialization") {
    return pool.sort(function (a, b) {
      return (
        Number(b.bipolar_years_experience || 0) - Number(a.bipolar_years_experience || 0) ||
        getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score
      );
    })[0];
  }

  if (mode === "contact") {
    return pool.sort(function (a, b) {
      return (
        Number(Boolean(getPublicResponsivenessSignal(b))) -
          Number(Boolean(getPublicResponsivenessSignal(a))) ||
        getTherapistMerchandisingQuality(b).score - getTherapistMerchandisingQuality(a).score
      );
    })[0];
  }

  return sortTherapistsForMerchandising(pool)[0];
}

function renderHomeMatchingTeaser(featuredTherapists) {
  var tabsRoot = document.getElementById("homeTeaserTabs");
  var explainerRoot = document.getElementById("homeTeaserExplainer");
  var previewRoot = document.getElementById("homeTeaserPreview");
  if (!tabsRoot || !explainerRoot || !previewRoot) {
    return;
  }

  var therapists = sortTherapistsForMerchandising(featuredTherapists || []);
  var modes = [
    {
      id: "trust",
      label: "Reviewed",
      title: "Profiles with stronger reviewed details rise first",
      copy: "This view favors specialists with stronger verification, clearer profile detail, and a more decision-ready first impression.",
    },
    {
      id: "speed",
      label: "Fastest",
      title: "Profiles with the quickest-looking next step rise first",
      copy: "This view leans harder on availability clarity, accepting-new-patient status, and lower-friction outreach routes.",
    },
    {
      id: "specialization",
      label: "Depth",
      title: "Profiles with deeper bipolar specialization rise first",
      copy: "This view gives extra weight to bipolar-specific experience, focus areas, and evidence of deeper specialization.",
    },
    {
      id: "contact",
      label: "Follow-through",
      title: "Profiles with clearer contact paths rise first",
      copy: "This view leans harder on contact readiness, responsiveness cues, and which next step looks easiest to actually use.",
    },
  ];
  var adaptiveSignals = summarizeAdaptiveSignals(readFunnelEvents(), []);
  var activeMode = adaptiveSignals.preferred_home_mode || "trust";

  function getAdaptiveHomeNote(modeId) {
    if (modeId === "speed") {
      return "This preview brings easier next steps and lower-friction options to the top.";
    }
    if (modeId === "specialization") {
      return "This preview brings bipolar-specific depth and specialization to the top.";
    }
    if (modeId === "contact") {
      return "This preview brings the clearest contact paths and follow-through potential to the top.";
    }
    return "This preview brings stronger reviewed details and decision-readiness to the top.";
  }

  function render() {
    tabsRoot.innerHTML = modes
      .map(function (mode) {
        return (
          '<button type="button" class="home-teaser-tab' +
          (mode.id === activeMode ? " active" : "") +
          '" data-home-mode="' +
          escapeHtml(mode.id) +
          '">' +
          escapeHtml(mode.label) +
          "</button>"
        );
      })
      .join("");

    var mode =
      modes.find(function (item) {
        return item.id === activeMode;
      }) || modes[0];
    var therapist = getBestTherapistBySignal(therapists, activeMode);

    explainerRoot.innerHTML =
      '<div class="home-teaser-title">' +
      escapeHtml(mode.title) +
      '</div><div class="home-teaser-copy">' +
      escapeHtml(mode.copy) +
      '</div><div class="home-teaser-note">' +
      escapeHtml(getAdaptiveHomeNote(mode.id)) +
      "</div>";

    previewRoot.innerHTML = therapist
      ? '<div class="home-teaser-preview-label">Example profile</div><div class="home-teaser-preview-name">' +
        escapeHtml(therapist.name) +
        '</div><div class="home-teaser-preview-copy">' +
        escapeHtml(
          activeMode === "speed"
            ? therapist.name +
                " is the kind of profile that can move up when speed matters because the next step looks lower-friction."
            : activeMode === "specialization"
              ? therapist.name +
                " is the kind of profile that can move up when deeper bipolar specialization matters more."
              : activeMode === "contact"
                ? therapist.name +
                  " is the kind of profile that can move up when the contact path looks clearer and more usable."
                : therapist.name +
                  " is the kind of profile that can move up when reviewed details are especially strong.",
        ) +
        "</div>"
      : '<div class="home-teaser-preview-label">Example profile</div><div class="home-teaser-preview-copy">As therapist supply grows, this preview will show how different second-pass priorities can change which profiles rise first.</div>';

    tabsRoot.querySelectorAll("[data-home-mode]").forEach(function (button) {
      button.addEventListener("click", function () {
        activeMode = button.getAttribute("data-home-mode") || "trust";
        render();
      });
    });
  }

  render();
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
          : "Built to make the first good decision easier",
      description:
        homePage && homePage.whyDescription
          ? homePage.whyDescription
          : "The goal is not to overwhelm you with profiles. It is to help you narrow the field, understand what has been reviewed, and know what to do next.",
      cards:
        homePage && Array.isArray(homePage.whyCards) && homePage.whyCards.length
          ? homePage.whyCards
          : [
              {
                icon: "🎯",
                title: "Clearer bipolar-specific fit",
                description:
                  "Profiles are structured around bipolar-specific needs, not just generic therapy categories, so it is easier to spot who may actually fit.",
              },
              {
                icon: "✅",
                title: "Reviewed details you can see",
                description:
                  "See reviewed details, freshness cues, and contact clarity before you decide who to reach out to.",
              },
              {
                icon: "🧭",
                title: "Clearer next steps",
                description:
                  "Get a calmer first-contact path, a backup if it stalls, and less guessing about who to contact first.",
              },
              {
                icon: "🤝",
                title: "Help if you still feel stuck",
                description:
                  "If the choice still feels hard, the product is already shaped to support a second set of eyes and a calmer recovery path.",
              },
            ],
    },
    {
      _type: "stepsSection",
      eyebrow: homePage && homePage.stepsEyebrow ? homePage.stepsEyebrow : "For Patients",
      title:
        homePage && homePage.stepsTitle
          ? homePage.stepsTitle
          : "Getting started should feel simple",
      cards:
        homePage && Array.isArray(homePage.stepsCards) && homePage.stepsCards.length
          ? homePage.stepsCards
          : [
              {
                icon: "🔍",
                stepLabel: "Step 1",
                title: "Start with what matters most",
                description:
                  "Choose Los Angeles or California telehealth first, then narrow by practical needs like format, insurance, or medication support.",
              },
              {
                icon: "👤",
                stepLabel: "Step 2",
                title: "Compare a smaller, calmer set of options",
                description:
                  "Review profiles with clearer reviewed details, fit, and reachability information before deciding who deserves the first outreach.",
              },
              {
                icon: "📞",
                stepLabel: "Step 3",
                title: "Reach out with a clearer next step",
                description:
                  "Use the suggested contact path, practical details, and backup options so you can act without feeling like you are guessing.",
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
          : "Making the right connection changes everything",
      items:
        homePage && Array.isArray(homePage.testimonials) && homePage.testimonials.length
          ? homePage.testimonials
          : [
              {
                stars: "★★★★★",
                quote:
                  '"I needed someone in Los Angeles who actually understood bipolar care, not another generic therapist listing. This was the first time the shortlist felt like it reflected what I was actually looking for."',
                author: "Alyssa R.",
                role: "Los Angeles therapy search",
              },
              {
                stars: "★★★★★",
                quote:
                  '"California telehealth made this feel usable right away. I could tell who looked strongest for medication support before I ever reached out."',
                author: "David P.",
                role: "California telehealth psychiatry search",
              },
              {
                stars: "★★★★★",
                quote:
                  '"As a partner helping someone else look, the family-support angle made a real difference. It narrowed the list to people who actually seemed ready for this kind of care."',
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
          : "Are you a bipolar disorder specialist?",
      description:
        homePage && homePage.ctaDescription
          ? homePage.ctaDescription
          : "Join a bipolar-specialist platform built around reviewed details, fit quality, and better patient decision-making from first match through outreach.",
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
  var therapists = content.therapists;
  var stats = content.stats;

  var statT = document.getElementById("statT");
  var statS = document.getElementById("statS");
  var statTH = document.getElementById("statTH");
  var statAcc = document.getElementById("statAcc");
  if (statT) statT.textContent = stats.total_therapists || therapists.length || 0;
  if (statS)
    statS.textContent =
      stats.states_covered ||
      new Set(
        therapists.map(function (therapist) {
          return therapist.state;
        }),
      ).size;
  if (statTH)
    statTH.textContent =
      stats.telehealth_count ||
      therapists.filter(function (therapist) {
        return therapist.accepts_telehealth;
      }).length;
  if (statAcc)
    statAcc.textContent =
      stats.accepting_count ||
      therapists.filter(function (therapist) {
        return therapist.accepting_new_patients;
      }).length;

  applyHomePageCopy(content.homePage);
  applySiteSettings(content.siteSettings);
  renderHomeMatchingTeaser(content.featuredTherapists || therapists || []);
  renderPageSections(content.homePage, content.featuredTherapists || []);

  var cmsBadge = document.getElementById("cmsBadge");
  if (cmsBadge) {
    if (!isInternalMode) {
      cmsBadge.style.display = "none";
    } else if (cmsEnabled) {
      var cmsState = getCmsState();
      if (cmsState.error) {
        cmsBadge.innerHTML =
          'Live CMS mode is on, but the public content query failed. Check your published therapist documents, dataset permissions, or browser console. Manage content in <a href="' +
          cmsStudioUrl +
          '" target="_blank" rel="noopener">Sanity Studio</a>.';
      } else if (!therapists.length) {
        cmsBadge.innerHTML =
          'Live CMS mode is on, but there are no published public therapist listings yet. Create and publish active therapist documents in <a href="' +
          cmsStudioUrl +
          '" target="_blank" rel="noopener">Sanity Studio</a>.';
      } else {
        cmsBadge.innerHTML =
          'Live CMS mode is on. Manage content in <a href="' +
          cmsStudioUrl +
          '" target="_blank" rel="noopener">Sanity Studio</a>.';
      }
    } else {
      cmsBadge.textContent =
        "CMS fallback mode: this preview is still using the seeded local data until Sanity is connected.";
    }
  }

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
