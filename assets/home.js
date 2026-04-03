import { cmsEnabled, cmsStudioUrl, fetchHomePageContent, getCmsState } from "./cms.js";

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
    mode +
    '</div><div class="t-footer">' +
    accepting +
    '<span class="view-link">View Profile →</span></div></a>'
  );
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
      ? section.therapists
      : fallbackTherapists;
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
    '</p></div><div class="therapist-grid">' +
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
      eyebrow: homePage && homePage.whyEyebrow ? homePage.whyEyebrow : "Why BipolarTherapists",
      title:
        homePage && homePage.whyTitle
          ? homePage.whyTitle
          : "Built for people navigating bipolar disorder",
      description:
        homePage && homePage.whyDescription
          ? homePage.whyDescription
          : "Generic directories don't cut it. You need someone who specializes in exactly what you're facing.",
      cards:
        homePage && Array.isArray(homePage.whyCards) && homePage.whyCards.length
          ? homePage.whyCards
          : [
              {
                icon: "🎯",
                title: "Bipolar-Specific Focus",
                description:
                  "Every therapist here specializes in bipolar spectrum disorders. Filter by Bipolar I, II, Cyclothymia, rapid cycling, and more.",
              },
              {
                icon: "✅",
                title: "Verified Credentials",
                description:
                  "See actual credentials, licenses, and years of experience. No vague listings — you know exactly who you're reaching out to.",
              },
              {
                icon: "💻",
                title: "Telehealth & In-Person",
                description:
                  "Filter by your preferred format. Many specialists offer both options and are licensed in multiple states for remote sessions.",
              },
              {
                icon: "💳",
                title: "Insurance Filters",
                description:
                  "See which providers accept your insurance. Many also offer sliding scale fees for those without coverage.",
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
          : "Therapists accepting new patients",
      description:
        homePage && homePage.featuredDescription
          ? homePage.featuredDescription
          : "These specialists are currently available and actively taking new clients.",
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
          : "Join our directory and connect with patients actively seeking your expertise. Be found by the people who need you most.",
      primaryLabel:
        homePage && homePage.ctaPrimaryLabel
          ? homePage.ctaPrimaryLabel
          : "List Your Practice — $39/mo",
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
  renderPageSections(content.homePage, content.featuredTherapists || []);

  var cmsBadge = document.getElementById("cmsBadge");
  if (cmsBadge) {
    if (cmsEnabled) {
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
