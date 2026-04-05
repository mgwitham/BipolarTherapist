import { cmsEnabled, cmsStudioUrl, fetchHomePageContent, getCmsState } from "./cms.js";
import { getTherapistMatchReadiness, getTherapistMerchandisingQuality } from "./matching-model.js";
import { getPublicResponsivenessSignal } from "./responsiveness-signal.js";
import {
  readFunnelEvents,
  summarizeAdaptiveSignals,
  trackFunnelEvent,
} from "./funnel-analytics.js";

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

function renderTherapistCard(therapist) {
  var readiness = getTherapistMatchReadiness(therapist);
  var quality = getTherapistMerchandisingQuality(therapist);
  var responsivenessSignal = getPublicResponsivenessSignal(therapist);
  var readinessCopy =
    readiness.score >= 85
      ? "High match confidence"
      : readiness.score >= 65
        ? "Good match confidence"
        : "Profile still being completed";
  var initials = (therapist.name || "")
    .split(" ")
    .map(function (part) {
      return part[0];
    })
    .join("")
    .substring(0, 2);
  var avatar = therapist.photo_url
    ? '<img src="' +
      escapeHtml(therapist.photo_url) +
      '" alt="' +
      escapeHtml(therapist.name) +
      '" />'
    : escapeHtml(initials);
  var bio = escapeHtml((therapist.bio_preview || therapist.bio || "").replace(/\n/g, " "));
  var tags = (therapist.specialties || [])
    .slice(0, 3)
    .map(function (specialty) {
      return '<span class="tag">' + escapeHtml(specialty) + "</span>";
    })
    .join("");
  var trustTags = [
    quality.score >= 90 ? quality.label : "",
    therapist.verification_status === "editorially_verified" ? "Verified" : "",
    therapist.bipolar_years_experience
      ? therapist.bipolar_years_experience + " yrs bipolar care"
      : "",
    readinessCopy,
    responsivenessSignal ? responsivenessSignal.label : "",
    therapist.medication_management ? "Medication management" : "",
  ]
    .filter(Boolean)
    .map(function (tag) {
      return '<span class="tag tele">' + escapeHtml(tag) + "</span>";
    })
    .join("");
  var mode = [
    therapist.accepts_telehealth ? '<span class="tag tele">Telehealth</span>' : "",
    therapist.accepts_in_person ? '<span class="tag inperson">In-Person</span>' : "",
  ].join("");
  var accepting = therapist.accepting_new_patients
    ? '<span class="accepting">Accepting patients</span>'
    : '<span class="accepting not-acc">Waitlist only</span>';

  return (
    '<a href="therapist.html?slug=' +
    encodeURIComponent(therapist.slug) +
    '" class="t-card"><div class="t-card-top"><div class="t-avatar">' +
    avatar +
    '</div><div class="t-info"><div class="t-name">' +
    escapeHtml(therapist.name) +
    '</div><div class="t-creds">' +
    escapeHtml(therapist.credentials || "") +
    " " +
    escapeHtml(therapist.title ? "· " + therapist.title : "") +
    '</div><div class="t-loc">📍 ' +
    escapeHtml(therapist.city) +
    ", " +
    escapeHtml(therapist.state) +
    '</div></div></div><div class="t-bio">' +
    bio +
    '</div><div class="tags">' +
    tags +
    trustTags +
    mode +
    '</div><div class="t-footer">' +
    accepting +
    '<span class="view-link">View Profile →</span></div></a>'
  );
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
      label: "Trust",
      title: "Start with the most decision-ready profile",
      copy: "When trust leads, the product favors therapists with stronger verification, better bipolar-specific detail, clearer first-contact paths, and higher match readiness.",
      pills: ["Editorial verification", "Profile completeness", "Clear outreach path"],
    },
    {
      id: "speed",
      label: "Speed",
      title: "Shift toward the fastest realistic next step",
      copy: "When speed matters, the ranking leans harder on availability clarity, accepting-new-patient status, and lower-friction outreach routes like booking links or direct intake paths.",
      pills: ["Soonest availability", "Accepting patients", "Lower-friction outreach"],
    },
    {
      id: "specialization",
      label: "Specialization",
      title: "Lean into deeper bipolar-specific expertise",
      copy: "When specialization matters more, the product gives extra weight to bipolar-specific years of experience, focus areas, and profile evidence that the therapist works with the realities of bipolar care.",
      pills: ["Bipolar experience", "Subtype relevance", "Clinical depth"],
    },
    {
      id: "contact",
      label: "Follow-through",
      title: "Favor the path most likely to actually move",
      copy: "Matching is not finished when a profile looks good. The system also pays attention to contact readiness and early responsiveness cues so the best next step is practical, not just impressive.",
      pills: ["Contact readiness", "Responsive contact", "Easier first move"],
    },
  ];
  var adaptiveSignals = summarizeAdaptiveSignals(readFunnelEvents(), []);
  var activeMode = adaptiveSignals.preferred_home_mode || "trust";

  function getAdaptiveHomeNote(modeId) {
    var basis =
      adaptiveSignals && adaptiveSignals.match_action_basis === "outcomes"
        ? "what has worked best"
        : "how people tend to move";
    if (modeId === "speed") {
      return (
        "Right now, the product is leaning a little more toward speed and easier next steps because that best reflects " +
        basis +
        " in current browsing patterns."
      );
    }
    if (modeId === "specialization") {
      return (
        "Right now, the product is leaning a little more toward specialization because that best reflects " +
        basis +
        " in current browsing patterns."
      );
    }
    if (modeId === "contact") {
      return (
        "Right now, the product is leaning a little more toward follow-through because that best reflects " +
        basis +
        " in current browsing patterns."
      );
    }
    return (
      "Right now, the product is leaning a little more toward trust and decision-readiness because that best reflects " +
      basis +
      " in current browsing patterns."
    );
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
      '</div><div class="home-teaser-copy">' +
      escapeHtml(getAdaptiveHomeNote(mode.id)) +
      '</div><div class="home-teaser-pills">' +
      mode.pills
        .map(function (pill) {
          return '<span class="home-teaser-pill">' + escapeHtml(pill) + "</span>";
        })
        .join("") +
      "</div>";

    previewRoot.innerHTML = therapist
      ? '<div class="home-teaser-preview-label">Example preview</div><div class="home-teaser-preview-name">' +
        escapeHtml(therapist.name) +
        '</div><div class="home-teaser-preview-copy">' +
        escapeHtml(
          activeMode === "speed"
            ? therapist.name +
                " is the kind of profile that rises when speed matters because timing and first-step friction look stronger."
            : activeMode === "specialization"
              ? therapist.name +
                " is the kind of profile that rises when specialization matters because bipolar-specific depth appears stronger."
              : activeMode === "contact"
                ? therapist.name +
                  " is the kind of profile that rises when follow-through matters because the contact path looks clearer and more likely to move."
                : therapist.name +
                  " is the kind of profile that rises when trust leads because the profile looks more complete, credible, and decision-ready.",
        ) +
        "</div>"
      : '<div class="home-teaser-preview-label">Example preview</div><div class="home-teaser-preview-copy">As therapist supply grows, this will preview how different decision priorities change which profiles rise first.</div>';

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

function renderFeaturedSection(section, fallbackTherapists) {
  var therapists =
    Array.isArray(section.therapists) && section.therapists.length
      ? sortTherapistsForMerchandising(section.therapists)
      : sortTherapistsForMerchandising(fallbackTherapists);
  var cards = therapists.length
    ? therapists.map(renderTherapistCard).join("")
    : '<p style="text-align:center;color:var(--muted);grid-column:1/-1">No therapists found</p>';

  return (
    '<section style="background: var(--white)"><div class="section-header"><div class="eyebrow">' +
    escapeHtml(section.eyebrow || "") +
    "</div><h2>" +
    escapeHtml(section.title || "") +
    '</h2><p class="section-sub">' +
    escapeHtml(section.description || "") +
    '</p></div><div class="ranking-note"><div class="ranking-note-title">Why These Profiles Rise To The Top</div><div class="ranking-note-copy">We prioritize specialists with stronger trust signals, clearer first-contact paths, better bipolar-specific detail, and profiles that make it easier to decide and act.</div><div class="ranking-note-list"><span class="ranking-note-pill">Editorial verification</span><span class="ranking-note-pill">Higher match readiness</span><span class="ranking-note-pill">Clear outreach path</span><span class="ranking-note-pill">Availability and response clarity</span></div></div><div class="therapist-grid">' +
    cards +
    '</div><div class="center-btn"><a href="' +
    escapeHtml(section.buttonUrl || "directory.html") +
    '" class="btn-p">' +
    escapeHtml(section.buttonLabel || "View All Therapists →") +
    "</a></div></section>"
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

function defaultSectionsFromLegacy(homePage, featuredTherapists) {
  return [
    {
      _type: "iconCardsSection",
      eyebrow: homePage && homePage.whyEyebrow ? homePage.whyEyebrow : "Why BipolarTherapyHub",
      title:
        homePage && homePage.whyTitle
          ? homePage.whyTitle
          : "Built for calmer, higher-trust bipolar therapist decisions",
      description:
        homePage && homePage.whyDescription
          ? homePage.whyDescription
          : "This is not just a list of names. It is a bipolar-focused matching and decision layer built to help you choose with more confidence.",
      cards:
        homePage && Array.isArray(homePage.whyCards) && homePage.whyCards.length
          ? homePage.whyCards
          : [
              {
                icon: "🎯",
                title: "Bipolar-Specific Matching",
                description:
                  "Profiles are structured around bipolar-specific fit, not just generic therapy categories, so matching can reflect the realities of bipolar care.",
              },
              {
                icon: "✅",
                title: "Trust You Can See",
                description:
                  "See clearer credentials, specialization signals, responsiveness cues, and profile completeness before you decide who to contact.",
              },
              {
                icon: "🧭",
                title: "Guided Outreach Plan",
                description:
                  "Get a recommended first outreach, a backup path if it stalls, and a calmer next-step plan instead of guessing who to contact first.",
              },
              {
                icon: "🤝",
                title: "Concierge-Ready Backup",
                description:
                  "If the choice still feels hard, the product is already shaped to support concierge-style help and better recovery paths.",
              },
            ],
    },
    {
      _type: "stepsSection",
      eyebrow: homePage && homePage.stepsEyebrow ? homePage.stepsEyebrow : "For Patients",
      title:
        homePage && homePage.stepsTitle
          ? homePage.stepsTitle
          : "Finding the right specialist takes 3 steps",
      cards:
        homePage && Array.isArray(homePage.stepsCards) && homePage.stepsCards.length
          ? homePage.stepsCards
          : [
              {
                icon: "🔍",
                stepLabel: "Step 1",
                title: "Search & Filter",
                description:
                  "Narrow down by location, specialty focus, insurance, and whether they offer telehealth or in-person sessions.",
              },
              {
                icon: "👤",
                stepLabel: "Step 2",
                title: "Review Profiles",
                description:
                  "Read detailed bios, check credentials, see specialties, and understand their therapeutic approach before reaching out.",
              },
              {
                icon: "📞",
                stepLabel: "Step 3",
                title: "Make Contact",
                description:
                  "Reach out directly via phone, email, or their practice website. No middleman — direct contact with your potential therapist.",
              },
            ],
    },
    {
      _type: "featuredTherapistsSection",
      eyebrow:
        homePage && homePage.featuredEyebrow ? homePage.featuredEyebrow : "Featured Specialists",
      title:
        homePage && homePage.featuredTitle
          ? homePage.featuredTitle
          : "Most decision-ready bipolar specialists",
      description:
        homePage && homePage.featuredDescription
          ? homePage.featuredDescription
          : "These profiles rise to the top because they combine stronger trust signals, clearer outreach paths, and higher match readiness.",
      buttonLabel:
        homePage && homePage.featuredButtonLabel
          ? homePage.featuredButtonLabel
          : "View All Therapists →",
      buttonUrl:
        homePage && homePage.featuredButtonUrl ? homePage.featuredButtonUrl : "directory.html",
      therapists: featuredTherapists,
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
                  '"After years of seeing therapists who didn\'t really understand bipolar, finding someone through this directory who specializes in Bipolar I has completely changed my treatment. She knew exactly what IPSRT was."',
                author: "Sarah M.",
                role: "Living with Bipolar I for 8 years",
              },
              {
                stars: "★★★★★",
                quote:
                  '"The filters here are exactly what I needed. I found a psychiatrist who accepts my insurance AND offers telehealth AND specializes in Bipolar II. Took me 10 minutes to find the right person."',
                author: "Marcus T.",
                role: "Recently diagnosed with Bipolar II",
              },
              {
                stars: "★★★★★",
                quote:
                  '"As a caregiver for my spouse, the family therapy filter helped me find someone who understood the relational dynamics of bipolar disorder from day one. Invaluable resource."',
                author: "Jennifer K.",
                role: "Partner of someone with Bipolar I",
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
          : "Join a bipolar-specialist platform built around trust, fit quality, and better patient decision-making from first match through outreach.",
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

function renderPageSections(homePage, featuredTherapists) {
  var root = document.getElementById("pageSections");
  if (!root) {
    return;
  }

  var sections =
    homePage && Array.isArray(homePage.sections) && homePage.sections.length
      ? homePage.sections
      : defaultSectionsFromLegacy(homePage, featuredTherapists);

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

      if (section._type === "featuredTherapistsSection") {
        return renderFeaturedSection(section, featuredTherapists);
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
    var q = document.getElementById("q").value;
    var loc = document.getElementById("location").value.trim();
    trackFunnelEvent("home_search_submitted", {
      has_query: Boolean(String(q || "").trim()),
      has_location: Boolean(loc),
    });
    var params = new URLSearchParams();
    if (q) params.set("q", q);
    if (loc) {
      if (loc.length <= 2 || /^[A-Z]{2}$/i.test(loc)) {
        params.set("state", loc.toUpperCase());
      } else {
        params.set("city", loc);
      }
    }
    window.location.href = "directory.html" + (params.toString() ? "?" + params.toString() : "");
  };
})();
