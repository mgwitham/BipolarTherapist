import "./sentry-init.js";
import { fetchPublicTherapistBySlug, fetchPublicTherapists } from "./cms.js";
import { escapeHtml } from "./escape-html.js";
import { getDataFreshnessSummary, getTherapistMatchReadiness } from "./matching-model.js";
import {
  getPublicResponsivenessSignal,
  summarizeTherapistContactRouteOutcomes,
} from "./responsiveness-signal.js";
import {
  getExperimentVariant,
  readFunnelEvents,
  rememberTherapistContactRoute,
  summarizeProfileBackupSignals,
  summarizeTherapistContactRoutePerformance,
  trackExperimentExposure,
  trackFunnelEvent,
} from "./funnel-analytics.js";
import { isBookingRouteHealthy, isWebsiteRouteHealthy } from "./route-health.js";
import { submitTherapistCtaClick, submitTherapistProfileView } from "./review-api.js";
import { buildOutreachScript } from "./outreach-scripts.js";
import { isSaved, toggleSaved, subscribe } from "./saved-list.js";
import { initValuePillPopover } from "./therapist-pills.js";
import {
  MAX_ENTRIES as SAVED_LIST_MAX,
  readList as readSavedList,
  isSaved as isSavedSlug,
  toggleSaved as toggleSavedSlug,
  updateNote as updateSavedListNote,
  updatePriority as updateSavedListPriority,
} from "./saved-list.js";

function detectProfileViewSource() {
  try {
    var params = new URLSearchParams(window.location.search || "");
    var utmSource = (params.get("utm_source") || "").toLowerCase();
    if (utmSource === "email") {
      return "email";
    }
    if (utmSource === "directory") {
      return "directory";
    }
    if (utmSource === "match") {
      return "match";
    }
    var referrer = String(document.referrer || "").toLowerCase();
    if (!referrer) {
      return "direct";
    }
    var currentHost = (window.location.hostname || "").toLowerCase();
    if (currentHost && referrer.indexOf(currentHost) === -1) {
      return "search";
    }
    if (referrer.indexOf("/directory") !== -1) {
      return "directory";
    }
    if (referrer.indexOf("/match") !== -1) {
      return "match";
    }
    return "direct";
  } catch (_error) {
    return "other";
  }
}

function recordProfileViewSafely(slug) {
  var cleanSlug = String(slug || "").trim();
  if (!cleanSlug) {
    return;
  }
  try {
    var promise = submitTherapistProfileView({
      therapist_slug: cleanSlug,
      source: detectProfileViewSource(),
    });
    if (promise && typeof promise.catch === "function") {
      promise.catch(function () {});
    }
  } catch (_error) {
    // Engagement pings are best-effort — never block page render.
  }
}

function recordCtaClickSafely(slug, route) {
  var cleanSlug = String(slug || "").trim();
  var cleanRoute = String(route || "").trim();
  if (!cleanSlug || !cleanRoute) {
    return;
  }
  try {
    var promise = submitTherapistCtaClick({
      therapist_slug: cleanSlug,
      route: cleanRoute,
    });
    if (promise && typeof promise.catch === "function") {
      promise.catch(function () {});
    }
  } catch (_error) {
    // Engagement pings are best-effort.
  }
}

function getSlugFromPath(pathname) {
  var match = String(pathname || "").match(/^\/therapists\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function buildTherapistProfileUrl(slugValue) {
  var cleanSlug = String(slugValue || "").trim();
  return cleanSlug
    ? `https://www.bipolartherapyhub.com/therapists/${encodeURIComponent(cleanSlug)}/`
    : "https://www.bipolartherapyhub.com/directory";
}

var profileParams = new URLSearchParams(window.location.search);
var slug = profileParams.get("slug") || getSlugFromPath(window.location.pathname);
var profileSource = profileParams.get("source") || "";
var OUTREACH_OUTCOMES_KEY = "bth_outreach_outcomes_v1";
var DIRECTORY_LIST_LIMIT = SAVED_LIST_MAX;
var activeTherapistContactExperimentVariant = "control";

// Strip everything but digits and + so tel: URIs work across iOS, Android,
// and VoIP dialers. iOS auto-normalizes "(805) 870-8901" but Android Auto
// and some VoIP softphones don't. Display value can keep formatting; the
// href should always be digits-only.
function normalizeTelUri(phone) {
  return String(phone || "").replace(/[^0-9+]/g, "");
}

// Per-therapist SEO: update/insert meta tags + Schema.org JSON-LD so
// each /therapists/X/ has unique title, description, OG tags,
// and structured data. Injected client-side after the therapist fetch
// resolves — Google's crawler executes JS and picks these up.
function upsertMeta(attr, key, content) {
  if (!content) return;
  let node = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute(attr, key);
    document.head.appendChild(node);
  }
  node.setAttribute("content", content);
}

function upsertLinkRel(rel, href) {
  if (!href) return;
  let node = document.head.querySelector(`link[rel="${rel}"]`);
  if (!node) {
    node = document.createElement("link");
    node.setAttribute("rel", rel);
    document.head.appendChild(node);
  }
  node.setAttribute("href", href);
}

function buildTherapistSeoDescription(t) {
  var name = t.name || "Bipolar therapist";
  var credentials = t.credentials ? ", " + t.credentials : "";
  var location = [t.city, t.state].filter(Boolean).join(", ") || "California";
  var parts = [];
  parts.push(name + credentials + " — bipolar disorder specialist in " + location + ".");
  if (t.accepting_new_patients) parts.push("Accepting new patients.");
  var formats = [];
  if (t.accepts_telehealth) formats.push("telehealth");
  if (t.accepts_in_person) formats.push("in-person");
  if (formats.length) parts.push("Offers " + formats.join(" & ") + ".");
  if (t.session_fee_min) {
    var feeStr =
      "$" +
      t.session_fee_min +
      (t.session_fee_max && t.session_fee_max !== t.session_fee_min
        ? "–$" + t.session_fee_max
        : "") +
      "/session";
    parts.push("Fee: " + feeStr + (t.sliding_scale ? " (sliding scale)." : "."));
  }
  var insurance = (t.insurance_accepted || []).filter(Boolean);
  if (insurance.length)
    parts.push(
      "Accepts " + insurance.slice(0, 3).join(", ") + (insurance.length > 3 ? " & more." : "."),
    );
  var result = parts.join(" ");
  return result.length > 158 ? result.slice(0, 155) + "…" : result;
}

var ZIP_GEO = {
  90001: [33.9731, -118.2479],
  90002: [33.9494, -118.2466],
  90007: [34.027, -118.2843],
  90010: [34.0627, -118.3085],
  90012: [34.0576, -118.2399],
  90019: [34.048, -118.3499],
  90024: [34.0628, -118.4426],
  90025: [34.0421, -118.4485],
  90034: [34.0139, -118.3953],
  90036: [34.0709, -118.3483],
  90048: [34.0764, -118.3814],
  90049: [34.0804, -118.4776],
  90056: [33.9881, -118.363],
  90064: [34.0336, -118.4271],
  90066: [33.9983, -118.4262],
  90073: [34.0446, -118.4617],
  90077: [34.0933, -118.4545],
  90095: [34.0689, -118.4452],
  90210: [34.0901, -118.4065],
  90211: [34.0794, -118.3926],
  90212: [34.0737, -118.3997],
  90230: [33.9938, -118.3894],
  90245: [33.9192, -118.4065],
  90254: [33.8636, -118.3995],
  90272: [34.0447, -118.5267],
  90290: [34.096, -118.5765],
  90291: [33.9924, -118.4718],
  90292: [33.9804, -118.4487],
  90401: [34.0195, -118.4912],
  90403: [34.0249, -118.4979],
  90405: [34.0068, -118.4741],
  90501: [33.8328, -118.3133],
  90503: [33.8337, -118.358],
  90505: [33.8121, -118.3438],
  90630: [33.8258, -118.0003],
  90631: [33.9283, -117.9828],
  90710: [33.792, -118.2952],
  90731: [33.7435, -118.2899],
  90740: [33.7876, -118.0657],
  90745: [33.8179, -118.2601],
  90802: [33.7701, -118.1937],
  90804: [33.7817, -118.14],
  90807: [33.8229, -118.1792],
  91001: [34.1497, -118.1025],
  91007: [34.1296, -118.0301],
  91011: [34.194, -118.1764],
  91101: [34.1478, -118.1445],
  91103: [34.162, -118.1583],
  91104: [34.1647, -118.122],
  91105: [34.1484, -118.1644],
  91106: [34.1448, -118.1202],
  91107: [34.1695, -118.0881],
  91201: [34.1757, -118.2595],
  91203: [34.152, -118.2585],
  91205: [34.1405, -118.2394],
  91301: [34.1569, -118.8784],
  91302: [34.1399, -118.7963],
  91303: [34.1967, -118.5991],
  91304: [34.2283, -118.6003],
  91316: [34.178, -118.5286],
  91324: [34.235, -118.5443],
  91325: [34.2415, -118.5336],
  91326: [34.2671, -118.5499],
  91330: [34.2369, -118.5268],
  91340: [34.2809, -118.4378],
  91343: [34.2431, -118.4874],
  91344: [34.2803, -118.4897],
  91345: [34.2644, -118.4519],
  91350: [34.393, -118.5414],
  91351: [34.4031, -118.5009],
  91352: [34.2252, -118.3881],
  91356: [34.1804, -118.5641],
  91364: [34.1732, -118.596],
  91367: [34.1782, -118.5813],
  91401: [34.1797, -118.4052],
  91403: [34.1562, -118.4473],
  91405: [34.2005, -118.4097],
  91406: [34.2034, -118.4633],
  91411: [34.1804, -118.4259],
  91423: [34.1544, -118.4301],
  91436: [34.1569, -118.4868],
  91501: [34.1818, -118.3088],
  91502: [34.1752, -118.3209],
  91504: [34.1968, -118.3231],
  91505: [34.1844, -118.3537],
  91506: [34.1774, -118.3288],
  92037: [32.8487, -117.2745],
  92093: [32.8799, -117.234],
  92101: [32.7157, -117.1611],
  92103: [32.7454, -117.1641],
  92107: [32.7388, -117.2385],
  92108: [32.7586, -117.1382],
  92115: [32.7351, -117.0741],
  92116: [32.7581, -117.1116],
  92123: [32.7993, -117.1254],
  92131: [32.9015, -117.1028],
  94102: [37.7793, -122.4193],
  94103: [37.7727, -122.4102],
  94105: [37.7897, -122.3942],
  94107: [37.7648, -122.4],
  94109: [37.7948, -122.4221],
  94110: [37.7484, -122.4156],
  94114: [37.7591, -122.4339],
  94115: [37.7857, -122.4393],
  94117: [37.7699, -122.4441],
  94118: [37.7803, -122.4597],
  94121: [37.778, -122.4935],
  94122: [37.7629, -122.4822],
  94123: [37.8003, -122.4373],
  94127: [37.7368, -122.461],
  94131: [37.7419, -122.4382],
  94132: [37.7213, -122.4742],
  94133: [37.8006, -122.4115],
  94134: [37.713, -122.4077],
  95008: [37.27, -121.959],
  95014: [37.3181, -122.043],
  95101: [37.3382, -121.8863],
  95126: [37.3288, -121.9105],
  95128: [37.3133, -121.9393],
  95811: [38.5783, -121.4963],
  95814: [38.5816, -121.4944],
  95816: [38.5714, -121.4743],
  95819: [38.5611, -121.4422],
  95825: [38.5986, -121.4125],
};

function buildTherapistJsonLd(t) {
  var name = t.name || "";
  var credentials = t.credentials || "";
  var nameWithCreds = credentials ? name + ", " + credentials : name;
  var pageUrl = buildTherapistProfileUrl(t.slug || "");
  var address = {
    "@type": "PostalAddress",
    addressLocality: t.city || undefined,
    addressRegion: t.state || "CA",
    postalCode: t.zip || undefined,
    addressCountry: "US",
  };
  var rawBio = t.bio ? t.bio.replace(/<[^>]+>/g, "").trim() : "";
  var bioDescription = rawBio
    ? rawBio.length > 160
      ? rawBio.slice(0, 160) + "..."
      : rawBio
    : undefined;
  var sameAsLinks = [];
  if (t.license_number) {
    sameAsLinks.push(
      "https://search.dca.ca.gov/results#/advanced?licenseNumber=" +
        encodeURIComponent(t.license_number),
    );
  }
  var person = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: nameWithCreds,
    url: pageUrl,
    jobTitle: t.title || "Therapist",
    knowsAbout: ["Bipolar disorder", "Psychotherapy", "Mental health"],
    address: address,
    description: bioDescription,
    image: t.photo_url || undefined,
    telephone: t.phone || undefined,
    email: t.email || undefined,
    sameAs: sameAsLinks.length > 0 ? sameAsLinks : undefined,
  };
  var insurance = (t.insurance_accepted || []).filter(Boolean);
  var serviceChannels = [];
  if (t.accepts_telehealth) {
    serviceChannels.push({
      "@type": "ServiceChannel",
      serviceType: "Telehealth",
      availableLanguage: { "@type": "Language", name: "English" },
    });
  }
  var zipCoords = ZIP_GEO[t.zip];
  var medicalBusiness = {
    "@context": "https://schema.org",
    "@type": "MedicalBusiness",
    name: t.practice_name || nameWithCreds,
    url: pageUrl,
    address: address,
    telephone: t.phone || undefined,
    priceRange: "$$",
    medicalSpecialty: "Psychiatric",
    paymentAccepted: insurance.length ? insurance.join(", ") : undefined,
    areaServed: t.city ? { "@type": "City", name: t.city } : undefined,
    availableChannel: serviceChannels.length ? serviceChannels : undefined,
    geo: zipCoords
      ? { "@type": "GeoCoordinates", latitude: zipCoords[0], longitude: zipCoords[1] }
      : undefined,
  };
  var breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: "https://www.bipolartherapyhub.com/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Directory",
        item: "https://www.bipolartherapyhub.com/directory.html",
      },
      { "@type": "ListItem", position: 3, name: nameWithCreds || "Therapist", item: pageUrl },
    ],
  };
  var faqItems = buildFAQItems(t);
  var faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map(function (item) {
      return {
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      };
    }),
  };
  return [person, medicalBusiness, breadcrumb, faqSchema];
}

function applyTherapistSeo(t) {
  if (!t || typeof document === "undefined") return;
  const name = t.name || "Therapist";
  const credentials = t.credentials ? `, ${t.credentials}` : "";
  const location = [t.city, t.state].filter(Boolean).join(", ") || "California";
  const seoTitle = `${name}${credentials} — Bipolar Therapist in ${location}`;
  const seoDescription = buildTherapistSeoDescription(t);
  const canonicalUrl = buildTherapistProfileUrl(t.slug || "");

  document.title = `${seoTitle} — BipolarTherapyHub`;
  upsertMeta("name", "description", seoDescription);
  upsertLinkRel("canonical", canonicalUrl);

  // Open Graph + Twitter
  upsertMeta("property", "og:type", "profile");
  upsertMeta("property", "og:site_name", "BipolarTherapyHub");
  upsertMeta("property", "og:url", canonicalUrl);
  upsertMeta("property", "og:title", seoTitle);
  upsertMeta("property", "og:description", seoDescription);
  if (t.photo_url) {
    upsertMeta("property", "og:image", t.photo_url);
  }
  upsertMeta("name", "twitter:card", "summary");
  upsertMeta("name", "twitter:title", seoTitle);
  upsertMeta("name", "twitter:description", seoDescription);

  // JSON-LD structured data — remove previous instances, then inject one tag per schema
  try {
    ["therapist-jsonld", "therapist-jsonld-breadcrumb", "therapist-jsonld-faq"].forEach(
      function (id) {
        var el = document.getElementById(id);
        if (el) el.remove();
      },
    );
    var schemas = buildTherapistJsonLd(t);
    var ids = [
      "therapist-jsonld",
      "therapist-jsonld-business",
      "therapist-jsonld-breadcrumb",
      "therapist-jsonld-faq",
    ];
    schemas.forEach(function (schema, i) {
      var script = document.createElement("script");
      script.type = "application/ld+json";
      script.id = ids[i] || "therapist-jsonld-" + i;
      script.textContent = JSON.stringify(schema);
      document.head.appendChild(script);
    });
  } catch (_error) {
    // best-effort
  }
}

// ─── FAQ items ────────────────────────────────────────────────────────────────
// Returns [{q, a}] built from live therapist data.
// Used by both the FAQ section HTML and the FAQPage JSON-LD schema.
function buildFAQItems(t) {
  var name = t.name || "This therapist";
  var first = (t.name || "").split(" ")[0] || "They";
  var phone = t.phone || null;
  var website = t.website || t.booking_url || null;
  var contactPath = [phone ? "calling " + phone : null, website ? "visiting their website" : null]
    .filter(Boolean)
    .join(" or ");
  if (!contactPath) contactPath = "using the contact details on this page";

  var insurance = (t.insurance_accepted || []).filter(Boolean);
  var fee_min = t.session_fee_min;
  var fee_max = t.session_fee_max;
  var sliding = t.sliding_scale;
  var telehealth = Boolean(t.accepts_telehealth);
  var inPerson = Boolean(t.accepts_in_person);
  var modalities = (t.treatment_modalities || []).filter(Boolean);
  var accepting = Boolean(t.accepting_new_patients);
  var city = t.city || "their area";

  var items = [];

  // Q1: Accepting new patients
  items.push({
    q: "Is " + name + " currently accepting new patients?",
    a: accepting
      ? first +
        " is currently accepting new patients. You can reach them by " +
        contactPath +
        " to schedule an initial appointment."
      : first +
        " is not currently accepting new patients. Use the directory to find similar bipolar disorder specialists nearby.",
  });

  // Q2: Insurance
  if (insurance.length > 0) {
    items.push({
      q: "What insurance does " + name + " accept?",
      a:
        first +
        " accepts " +
        insurance.join(", ") +
        ". Coverage for therapy varies by plan and deductible — confirm your specific benefits directly with " +
        first +
        " or your insurance carrier before your first appointment.",
    });
  } else {
    items.push({
      q: "Does " + name + " accept insurance?",
      a:
        "Insurance information is not currently listed. Contact " +
        first +
        " directly to ask about accepted plans and out-of-pocket rates.",
    });
  }

  // Q3: Session fee
  if (fee_min) {
    var feeRange = fee_max && fee_max !== fee_min ? "$" + fee_min + "–$" + fee_max : "$" + fee_min;
    var feeAnswer =
      first +
      "'s session fee is " +
      feeRange +
      "/session." +
      (sliding
        ? " A sliding scale fee is available for qualifying clients — ask about it when you reach out."
        : "");
    items.push({ q: "How much does " + name + " charge per session?", a: feeAnswer });
  } else {
    items.push({
      q: "How much does " + name + " charge per session?",
      a:
        "Session fee information is not listed. Contact " +
        first +
        " directly to ask about rates and payment options.",
    });
  }

  // Q4: Telehealth
  if (telehealth && inPerson) {
    items.push({
      q: "Does " + name + " offer online therapy or telehealth?",
      a:
        "Yes, " +
        first +
        " offers both telehealth (secure video sessions) and in-person appointments in " +
        city +
        ". Discuss your preference when you schedule.",
    });
  } else if (telehealth) {
    items.push({
      q: "Does " + name + " offer online therapy or telehealth?",
      a:
        "Yes, " +
        first +
        " offers telehealth sessions so you can attend therapy from home via secure video.",
    });
  } else {
    items.push({
      q: "Does " + name + " offer online therapy or telehealth?",
      a: first + " currently offers in-person sessions in " + city + ".",
    });
  }

  // Q5: Bipolar specialization
  var modalityNote =
    modalities.length > 0
      ? " drawing on " +
        modalities.slice(0, 3).join(", ") +
        (modalities.length > 3 ? ", and more" : "") +
        "."
      : ".";
  items.push({
    q: "What makes " + name + " a bipolar disorder specialist?",
    a:
      first +
      " lists bipolar disorder as a primary specialty and uses evidence-based approaches recognized as effective for mood stabilization" +
      modalityNote +
      " " +
      first +
      " is listed on Bipolar Therapy Hub, a directory focused exclusively on therapists with verified bipolar expertise.",
  });

  // Q6: How to schedule
  items.push({
    q: "How do I schedule an appointment with " + name + "?",
    a:
      "Reach " +
      first +
      " by " +
      contactPath +
      ". When you do, mention you found their profile on Bipolar Therapy Hub and briefly describe what you’re hoping to work on. Many therapists offer a short phone consult before the first full session so both parties can assess fit.",
  });

  return items;
}

// ─── Mobile sticky CTA bar ────────────────────────────────────────────────────
function buildMobileStickyBar(t) {
  var phone = t.phone || null;
  var website = t.website || t.booking_url || null;
  var phoneDigits = phone ? phone.replace(/[^0-9+]/g, "") : null;
  var fee_min = t.session_fee_min;
  var fee_max = t.session_fee_max;
  var feeLabel = fee_min
    ? "$" + fee_min + (fee_max && fee_max !== fee_min ? "–$" + fee_max : "") + "/session"
    : null;

  if (!phone && !website) return "";

  return (
    '<div class="profile-mobile-sticky" id="profileMobileStickyBar" aria-hidden="true">' +
    '<div class="mobile-sticky-inner">' +
    (feeLabel || t.accepting_new_patients
      ? '<div class="mobile-sticky-meta">' +
        (feeLabel ? '<span class="mobile-sticky-fee">' + escapeHtml(feeLabel) + "</span>" : "") +
        (t.sliding_scale ? '<span class="mobile-sticky-note">Sliding scale</span>' : "") +
        (t.accepting_new_patients
          ? '<span class="mobile-sticky-status">Accepting patients</span>'
          : "") +
        "</div>"
      : "") +
    '<div class="mobile-sticky-actions">' +
    (phone && phoneDigits
      ? '<a href="tel:' +
        escapeHtml(phoneDigits) +
        '" class="mobile-sticky-cta" data-profile-contact-route="phone" data-profile-contact-priority="primary">Call ' +
        escapeHtml(phone) +
        "</a>"
      : "") +
    (website
      ? '<a href="' +
        escapeHtml(website) +
        '" target="_blank" rel="noopener noreferrer" class="mobile-sticky-secondary" data-profile-contact-route="website" data-profile-contact-priority="secondary">Website</a>'
      : "") +
    "</div>" +
    "</div>" +
    "</div>"
  );
}

function getFirstMeaningfulSentence(value) {
  var text = String(value || "").trim();
  if (!text) {
    return "";
  }
  var match = text.match(/^.*?[.!?](?:\s|$)/);
  return match ? match[0].trim() : text;
}

function getContactStrategy(
  therapist,
  responsivenessSignal,
  routePerformance,
  routeOutcomePerformance,
) {
  var bookingHealthy = isBookingRouteHealthy(therapist);
  var websiteHealthy = isWebsiteRouteHealthy(therapist);
  var suppressedRouteNote = "";
  if (therapist.booking_url && !bookingHealthy && therapist.website && !websiteHealthy) {
    suppressedRouteNote =
      " The booking link and website both look unavailable right now, so a direct route is safer.";
  } else if (therapist.booking_url && !bookingHealthy) {
    suppressedRouteNote =
      " The booking link looks unavailable right now, so a different contact route is safer.";
  } else if (therapist.website && !websiteHealthy) {
    suppressedRouteNote =
      " The website looks unavailable right now, so a different contact route is safer.";
  }
  var route = "profile";
  var routeLabel = "Use the clearest listed contact path";
  var routeReason = websiteHealthy
    ? "The clearest contact path on this profile is the best place to start."
    : "A direct contact route is a safer starting point than the website on this profile.";

  if (therapist.preferred_contact_method === "booking" && therapist.booking_url && bookingHealthy) {
    route = "booking";
    routeLabel = "Use the booking link first";
    routeReason = "A booking link usually gives the fastest path to a consult or intake.";
  } else if (therapist.preferred_contact_method === "phone" && therapist.phone) {
    route = "phone";
    routeLabel = "Call the practice first";
    routeReason =
      "Phone is marked as the preferred route, so it is the best shot for a quick response.";
  } else if (therapist.preferred_contact_method === "email" && therapist.email) {
    route = "email";
    routeLabel = "Email first";
    routeReason = "Email is the clearest documented route for a direct first message.";
  } else if (
    therapist.preferred_contact_method === "website" &&
    therapist.website &&
    websiteHealthy
  ) {
    route = "website";
    routeLabel = "Use the practice website first";
    routeReason = "The profile points to the website as the preferred contact path.";
  } else if (therapist.booking_url && bookingHealthy) {
    route = "booking";
    routeLabel = "Use the booking link first";
    routeReason = "The booking link creates the most executable next step on this profile.";
  } else if (therapist.phone) {
    route = "phone";
    routeLabel = "Call the practice first";
    routeReason = "Phone is the most direct route available on this profile.";
  } else if (therapist.email && therapist.email !== "contact@example.com") {
    route = "email";
    routeLabel = "Email first";
    routeReason = "Email is the cleanest direct route available on this profile.";
  }

  var outcomeRoute =
    routeOutcomePerformance &&
    routeOutcomePerformance.top_route &&
    routeOutcomePerformance.confidence !== "none" &&
    routeOutcomePerformance.top_route.route &&
    routeOutcomePerformance.top_route.route !== "unknown"
      ? routeOutcomePerformance.top_route.route
      : "";
  var performanceRoute =
    routePerformance &&
    routePerformance.top_route &&
    routePerformance.confidence !== "none" &&
    routePerformance.top_route.route &&
    routePerformance.top_route.route !== "unknown"
      ? routePerformance.top_route.route
      : "";
  var performanceRouteAvailable =
    (performanceRoute === "booking" && therapist.booking_url && bookingHealthy) ||
    (performanceRoute === "website" && therapist.website && websiteHealthy) ||
    (performanceRoute === "phone" && therapist.phone) ||
    (performanceRoute === "email" && therapist.email && therapist.email !== "contact@example.com");

  var outcomeRouteAvailable =
    (outcomeRoute === "booking" && therapist.booking_url && bookingHealthy) ||
    (outcomeRoute === "website" && therapist.website && websiteHealthy) ||
    (outcomeRoute === "phone" && therapist.phone) ||
    (outcomeRoute === "email" && therapist.email && therapist.email !== "contact@example.com");

  if (outcomeRoute && outcomeRouteAvailable && outcomeRoute !== route) {
    route = outcomeRoute;
    routeLabel =
      route === "booking"
        ? "Use the booking link first"
        : route === "phone"
          ? "Call the practice first"
          : route === "email"
            ? "Email first"
            : "Use the practice website first";
    routeReason =
      routeOutcomePerformance.confidence === "strong"
        ? "Past outreach outcomes most strongly point to this route as the one most likely to lead somewhere useful."
        : "Past outreach outcomes lean toward this route over the other options so far.";
  } else if (performanceRoute && performanceRouteAvailable && performanceRoute !== route) {
    route = performanceRoute;
    routeLabel =
      route === "booking"
        ? "Use the booking link first"
        : route === "phone"
          ? "Call the practice first"
          : route === "email"
            ? "Email first"
            : "Use the practice website first";
    routeReason =
      routePerformance.confidence === "strong"
        ? "Real profile behavior most clearly points to this route as the one users choose first."
        : "Observed profile behavior leans toward this route over the other contact options so far.";
  } else if (routeOutcomePerformance && routeOutcomePerformance.note) {
    routeReason =
      routeOutcomePerformance.confidence === "light"
        ? routeReason + " " + routeOutcomePerformance.note
        : routeReason;
  } else if (routePerformance && routePerformance.note) {
    routeReason =
      routePerformance.confidence === "light"
        ? routeReason + " " + routePerformance.note
        : routeReason;
  }

  var replyWindowCopy = therapist.estimated_wait_time
    ? "Expect the first useful answer to clarify whether timing is still around " +
      therapist.estimated_wait_time +
      "."
    : therapist.accepting_new_patients
      ? "If this profile is current, you should expect a reply that clarifies intake timing rather than leaving you guessing."
      : responsivenessSignal && responsivenessSignal.tone === "positive"
        ? "Public follow-through looks better than usual here, so a reply may still be worth waiting for briefly."
        : "Treat reply timing as uncertain and use a faster backup plan if you hear nothing.";

  if (responsivenessSignal && responsivenessSignal.tone === "positive") {
    replyWindowCopy += " Early reply follow-through also looks better than usual here.";
  }

  var followUpCopy =
    route === "phone"
      ? "If you reach voicemail, leave one concise message and try one more call in 2 to 3 business days."
      : route === "booking"
        ? "If the booking link does not lead to a real opening, switch to phone or email within 1 to 2 business days."
        : route === "email"
          ? "If there is no response after 2 business days, send one short follow-up and then move to the next route."
          : "If you do not hear back after 2 to 3 business days, follow up once or switch to a more direct route.";

  var backupPlanCopy =
    therapist.phone && route !== "phone"
      ? "If this stalls, call the practice next and ask whether they are still taking new bipolar-care inquiries."
      : therapist.email && therapist.email !== "contact@example.com" && route !== "email"
        ? "If this stalls, send a short email with your fit question and availability question together."
        : therapist.website && websiteHealthy && route !== "website"
          ? "If this stalls, use the website contact form as a second route before moving on."
          : "If this stalls after one follow-up, move on to your next saved option instead of waiting indefinitely.";

  var confidenceLabel = "Based on profile details";
  var confidenceNote =
    "This recommendation is based on the contact routes and practical details listed on the profile.";
  var confidenceTone = "profile";
  var proofLine = "";

  if (outcomeRoute && outcomeRouteAvailable) {
    confidenceLabel =
      routeOutcomePerformance.confidence === "strong"
        ? "Based on real outcomes"
        : "Leaning on early outcomes";
    confidenceNote = routeOutcomePerformance.note
      ? routeOutcomePerformance.note
      : "This recommendation is informed by past replies or consult outcomes tied to this therapist.";
    confidenceTone = "outcomes";
  } else if (performanceRoute && performanceRouteAvailable) {
    confidenceLabel =
      routePerformance.confidence === "strong"
        ? "Based on observed behavior"
        : "Leaning on observed behavior";
    confidenceNote = routePerformance.note
      ? routePerformance.note
      : "This recommendation is informed by the contact route people are choosing most on this profile.";
    confidenceTone = "behavior";
  }

  if (route === "booking" && therapist.booking_url) {
    proofLine = therapist.accepting_new_patients
      ? "Why this route: there is a live booking path and the profile indicates they are accepting new patients."
      : "Why this route: there is a live booking path, which is still the most direct way to test current openings.";
  } else if (
    route === "phone" &&
    responsivenessSignal &&
    responsivenessSignal.tone === "positive"
  ) {
    proofLine =
      "Why this route: early reply follow-through looks better than usual here, so a direct call is worth trying first.";
  } else if (route === "phone" && therapist.preferred_contact_method === "phone") {
    proofLine =
      "Why this route: the profile explicitly marks phone as the preferred contact method.";
  } else if (route === "email" && therapist.preferred_contact_method === "email") {
    proofLine =
      "Why this route: the profile explicitly marks email as the preferred first-contact path.";
  } else if (route === "website" && therapist.preferred_contact_method === "website") {
    proofLine =
      "Why this route: the profile points to the website as the intended first step for inquiries.";
  } else if (therapist.estimated_wait_time) {
    proofLine =
      "Why this route: the profile includes a recent timing note of " +
      therapist.estimated_wait_time +
      ", so this is the fastest way to confirm whether that is still current.";
  } else if (therapist.accepting_new_patients) {
    proofLine =
      "Why this route: the profile says they are accepting new patients, so this route is the clearest way to verify the next opening.";
  } else if (routeOutcomePerformance && routeOutcomePerformance.note) {
    proofLine = "Why this route: " + routeOutcomePerformance.note;
  } else if (routePerformance && routePerformance.note) {
    proofLine = "Why this route: " + routePerformance.note;
  } else {
    proofLine =
      "Why this route: it is the clearest documented way to confirm fit, timing, and next steps on this profile.";
  }

  if (suppressedRouteNote) {
    routeReason += suppressedRouteNote;
  }

  return {
    route: route,
    routeLabel: routeLabel,
    routeReason: routeReason,
    proofLine: proofLine,
    replyWindowCopy: replyWindowCopy,
    followUpCopy: followUpCopy,
    backupPlanCopy: backupPlanCopy,
    timingTone:
      therapist.accepting_new_patients || therapist.estimated_wait_time ? "green" : "teal",
    confidenceLabel: confidenceLabel,
    confidenceNote: confidenceNote,
    confidenceTone: confidenceTone,
    performanceConfidence:
      routePerformance && routePerformance.confidence ? routePerformance.confidence : "none",
    performanceNote: routePerformance && routePerformance.note ? routePerformance.note : "",
    outcomeConfidence:
      routeOutcomePerformance && routeOutcomePerformance.confidence
        ? routeOutcomePerformance.confidence
        : "none",
    outcomeNote:
      routeOutcomePerformance && routeOutcomePerformance.note ? routeOutcomePerformance.note : "",
  };
}

function getContactAnalyticsMeta(therapist, route) {
  return {
    therapist_slug: therapist.slug || "",
    preferred_contact_method: therapist.preferred_contact_method || "unknown",
    route: route || "unknown",
    accepting_new_patients: Boolean(therapist.accepting_new_patients),
    has_wait_time: Boolean(therapist.estimated_wait_time),
    has_fee_details: Boolean(
      therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale,
    ),
    has_insurance_details: Boolean(
      therapist.insurance_accepted && therapist.insurance_accepted.length,
    ),
    experiments: {
      therapist_contact_guidance: activeTherapistContactExperimentVariant,
    },
  };
}

function trackDirectoryProfileOpenQuality(therapist, readiness, freshness) {
  if (!profileSource) {
    return;
  }
  trackFunnelEvent("directory_profile_open_quality", {
    source: profileSource,
    therapist_slug: therapist.slug || "",
    readiness_score: readiness && typeof readiness.score === "number" ? readiness.score : 0,
    freshness_status: freshness && freshness.status ? freshness.status : "unknown",
    accepting_new_patients: Boolean(therapist.accepting_new_patients),
    has_bipolar_experience: Boolean(Number(therapist.bipolar_years_experience || 0)),
    has_fee_details: Boolean(
      therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale,
    ),
    has_wait_time: Boolean(therapist.estimated_wait_time),
  });
}

function readShortlist() {
  return readSavedList();
}

function readOutreachOutcomes() {
  try {
    return JSON.parse(window.localStorage.getItem(OUTREACH_OUTCOMES_KEY) || "[]");
  } catch (_error) {
    return [];
  }
}

function buildOutreachQueueUrl(focusSlug) {
  var shortlist = readShortlist();
  var slugs = shortlist
    .map(function (item) {
      return item.slug;
    })
    .filter(Boolean);
  if (!slugs.length) {
    return "match.html";
  }

  var params = new URLSearchParams();
  params.set("shortlist", slugs.join(","));
  params.set("entry", "directory_shortlist_queue");
  if (focusSlug) {
    params.set("focus", focusSlug);
  }
  return "match.html?" + params.toString();
}

function buildShortlistCompareUrl() {
  var shortlist = readShortlist();
  var slugs = shortlist
    .map(function (item) {
      return item.slug;
    })
    .filter(Boolean);
  if (!slugs.length) {
    return "match.html";
  }

  var params = new URLSearchParams();
  params.set("shortlist", slugs.join(","));
  return "match.html?" + params.toString();
}

function formatSavedOutcomeLabel(outcome) {
  var labels = {
    reached_out: "Reached out",
    heard_back: "Heard back",
    booked_consult: "Booked consult",
    good_fit_call: "Good fit call",
    insurance_mismatch: "Insurance mismatch",
    waitlist: "Waitlist",
    no_response: "No response yet",
  };
  return labels[String(outcome || "")] || "";
}

function getLatestOutreachOutcomeForSlug(slugValue) {
  return (
    readOutreachOutcomes().find(function (item) {
      return item && item.therapist_slug === slugValue;
    }) || null
  );
}

function recordProfileOutreachOutcome(therapist, outcome) {
  if (!therapist || !therapist.slug || !outcome) {
    return null;
  }

  var shortlist = readShortlist();
  var shortlistSlugs = shortlist
    .map(function (item) {
      return item.slug;
    })
    .filter(Boolean)
    .slice(0, DIRECTORY_LIST_LIMIT);
  var existing = readOutreachOutcomes();
  var now = new Date().toISOString();
  var entryIndex = shortlistSlugs.indexOf(therapist.slug);

  existing.unshift({
    recorded_at: now,
    journey_id: ["profile", now, shortlistSlugs.join("-") || therapist.slug].join(":"),
    therapist_slug: therapist.slug,
    therapist_name: therapist.name,
    rank_position: entryIndex === -1 ? 1 : entryIndex + 1,
    outcome: outcome,
    route_type: therapist.preferred_contact_method || "",
    actual_route_type: therapist.preferred_contact_method || "",
    route_signal_source: "profile",
    shortcut_type: "",
    pivot_at: "",
    recommended_wait_window: "",
    request_summary: "Therapist profile outreach update",
    context: {
      created_at: now,
      summary: "Therapist profile outreach update",
      profile: null,
      therapist_slugs: shortlistSlugs,
    },
  });

  try {
    window.localStorage.setItem(OUTREACH_OUTCOMES_KEY, JSON.stringify(existing.slice(0, 150)));
  } catch (_error) {
    return null;
  }

  return getLatestOutreachOutcomeForSlug(therapist.slug);
}

function buildProfileOutreachQueueState(slugValue) {
  var shortlist = readShortlist();
  var shortlistEntry = shortlist.find(function (item) {
    return item.slug === slugValue;
  });
  var latestOutcome = getLatestOutreachOutcomeForSlug(slugValue);
  var queueUrl = buildOutreachQueueUrl(slugValue);

  if (!shortlistEntry && !latestOutcome) {
    return null;
  }

  if (
    latestOutcome &&
    ["no_response", "waitlist", "insurance_mismatch"].indexOf(
      String(latestOutcome.outcome || ""),
    ) !== -1
  ) {
    return {
      tone: "watch",
      label: "Outreach queue status",
      title: "This contact path may be stalled",
      copy:
        "You already tried this therapist and hit " +
        formatSavedOutcomeLabel(latestOutcome.outcome).toLowerCase() +
        ". Resume your queue and move to the clearest backup instead of waiting here.",
      ctaLabel: "Resume outreach queue",
      ctaHref: queueUrl,
      actions: ["heard_back", "no_response"],
    };
  }

  if (latestOutcome) {
    return {
      tone: "fresh",
      label: "Outreach queue status",
      title: "This therapist is already in motion",
      copy:
        "Latest saved outreach outcome: " +
        formatSavedOutcomeLabel(latestOutcome.outcome) +
        ". Reopen your queue if you want to keep momentum or compare your backup.",
      ctaLabel: "Resume outreach queue",
      ctaHref: queueUrl,
      actions: ["heard_back", "good_fit_call"],
    };
  }

  return {
    tone: "teal",
    label: "Outreach queue status",
    title: "Saved, but not contacted yet",
    copy: "This therapist is already on your list. Start the outreach queue when you want a clear contact-first plan and backup path.",
    ctaLabel: "Start outreach queue",
    ctaHref: queueUrl,
    actions: ["reached_out", "heard_back", "no_response"],
  };
}

function getShortlistPriorityRank(value) {
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

function buildProfileBackupState(currentTherapist, therapistDirectory) {
  var shortlist = readShortlist();
  var backupSignals = summarizeProfileBackupSignals(
    readFunnelEvents(),
    currentTherapist && currentTherapist.slug,
  );
  if (!currentTherapist || !shortlist.length) {
    return null;
  }

  var alternatives = shortlist
    .filter(function (item) {
      return item.slug !== currentTherapist.slug;
    })
    .map(function (item) {
      var therapist = (therapistDirectory || []).find(function (candidate) {
        return candidate.slug === item.slug;
      });
      return therapist
        ? {
            therapist: therapist,
            shortlistEntry: item,
            rank: getShortlistPriorityRank(item.priority),
          }
        : null;
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return (
        b.rank - a.rank ||
        Number(Boolean(b.therapist.accepting_new_patients)) -
          Number(Boolean(a.therapist.accepting_new_patients)) ||
        Number(Boolean(b.therapist.bipolar_years_experience)) -
          Number(Boolean(a.therapist.bipolar_years_experience))
      );
    });

  var backup = alternatives[0] || null;
  if (!backup) {
    if (
      shortlist.some(function (item) {
        return item.slug === currentTherapist.slug;
      })
    ) {
      return {
        mode: "needs_backup",
        title: "Strong option, but no backup yet",
        copy: "If you like this therapist, keep momentum by saving one more credible option. That makes it easier to move quickly if this path stalls.",
        ctaLabel: "Compare list",
        ctaHref: buildShortlistCompareUrl(),
      };
    }
    return null;
  }

  return {
    mode: "has_backup",
    therapist: backup.therapist,
    title: "Best backup if this one stalls",
    copy:
      backup.shortlistEntry && backup.shortlistEntry.priority
        ? backup.therapist.name +
          " is already on your list as " +
          String(backup.shortlistEntry.priority || "").toLowerCase() +
          ". Keep this option close so you can move without restarting your search."
        : backup.therapist.name +
          " is the clearest backup already on your list if this first path slows down.",
    note: backupSignals && backupSignals.interpretation ? backupSignals.interpretation : "",
    ctaLabel:
      backupSignals && backupSignals.preferred_action === "open_backup"
        ? "Compare after backup review"
        : "Compare these two",
    ctaHref: buildShortlistCompareUrl(),
    profileHref: buildTherapistProfileUrl(backup.therapist.slug) + "?source=profile_backup",
    primaryAction: backupSignals ? backupSignals.preferred_action : "balanced",
  };
}

function buildProfileDecisionMemoryState(slugValue) {
  var shortlistEntry = readShortlist().find(function (item) {
    return item.slug === slugValue;
  });
  if (!shortlistEntry) {
    return null;
  }

  var latestOutcome = getLatestOutreachOutcomeForSlug(slugValue);
  var changedCopy = latestOutcome
    ? "Since you saved this, the newest signal is " +
      formatSavedOutcomeLabel(latestOutcome.outcome).toLowerCase() +
      ". Use that as more important than your earlier hunch if the two are in conflict."
    : "Nothing live has changed yet, so your saved note and the current profile details should still do most of the decision work.";

  return {
    title: shortlistEntry.priority
      ? "You saved this as " + String(shortlistEntry.priority || "").toLowerCase()
      : "You already saved this therapist",
    copy: shortlistEntry.note
      ? 'Your note: "' + String(shortlistEntry.note || "").trim() + '"'
      : "Add a quick note or list label so future-you can remember why this therapist stood out.",
    changedCopy: changedCopy,
    tone: shortlistEntry.note || shortlistEntry.priority ? "fresh" : "teal",
    compareHref: buildShortlistCompareUrl(),
  };
}

function renderQueueActionButtons(queueState) {
  var actions = Array.isArray(queueState && queueState.actions) ? queueState.actions : [];
  if (!actions.length) {
    return "";
  }

  return (
    '<div class="profile-queue-actions">' +
    actions
      .map(function (action) {
        return (
          '<button type="button" class="profile-queue-action-btn" data-profile-queue-outcome="' +
          escapeHtml(action) +
          '">' +
          escapeHtml(formatSavedOutcomeLabel(action) || action) +
          "</button>"
        );
      })
      .join("") +
    "</div>"
  );
}

function renderDecisionMemoryCard(memoryState) {
  if (!memoryState) {
    return "";
  }

  return (
    '<div class="profile-decision-memory-card tone-' +
    escapeHtml(memoryState.tone) +
    '"><div class="profile-decision-memory-label">Your decision memory</div><div class="profile-decision-memory-title">' +
    escapeHtml(memoryState.title) +
    '</div><div class="profile-decision-memory-copy">' +
    escapeHtml(memoryState.copy) +
    '</div><div class="profile-decision-memory-subtitle">What changed since you saved it</div><div class="profile-decision-memory-copy">' +
    escapeHtml(
      memoryState.changedCopy ||
        "Reopen your list if you want to compare this against your strongest backup.",
    ) +
    '</div><a href="' +
    escapeHtml(memoryState.compareHref) +
    '" class="profile-decision-memory-link">Review list</a></div>'
  );
}

function renderQueueStatusCard(queueState) {
  if (!queueState) {
    return "";
  }

  return (
    '<div class="profile-queue-status-card tone-' +
    escapeHtml(queueState.tone) +
    '"><div class="profile-queue-status-label">' +
    escapeHtml(queueState.label) +
    '</div><div class="profile-queue-status-title">' +
    escapeHtml(queueState.title) +
    '</div><div class="profile-queue-status-copy">' +
    escapeHtml(queueState.copy) +
    '</div><a href="' +
    escapeHtml(queueState.ctaHref) +
    '" class="profile-queue-status-link">' +
    escapeHtml(queueState.ctaLabel) +
    "</a>" +
    renderQueueActionButtons(queueState) +
    "</div>"
  );
}

function renderBackupCard(backupState) {
  if (!backupState) {
    return "";
  }

  return (
    '<div class="profile-backup-card"><div class="profile-backup-kicker">' +
    escapeHtml(backupState.title) +
    '</div><div class="profile-backup-copy">' +
    escapeHtml(backupState.copy) +
    "</div>" +
    (backupState.note
      ? '<div class="profile-backup-note">' + escapeHtml(backupState.note) + "</div>"
      : "") +
    '<div class="profile-backup-actions">' +
    (backupState.primaryAction === "open_backup" && backupState.profileHref
      ? '<a href="' +
        escapeHtml(backupState.profileHref) +
        '" class="btn-website profile-backup-link" data-profile-backup-link="' +
        escapeHtml(backupState.therapist.slug) +
        '">Open backup profile</a><a href="' +
        escapeHtml(backupState.ctaHref) +
        '" class="btn-website" data-profile-backup-compare="true">' +
        escapeHtml(backupState.ctaLabel) +
        "</a>"
      : '<a href="' +
        escapeHtml(backupState.ctaHref) +
        '" class="btn-website" data-profile-backup-compare="true">' +
        escapeHtml(backupState.ctaLabel) +
        "</a>" +
        (backupState.profileHref
          ? '<a href="' +
            escapeHtml(backupState.profileHref) +
            '" class="btn-website profile-backup-link" data-profile-backup-link="' +
            escapeHtml(backupState.therapist.slug) +
            '">Open backup profile</a>'
          : "")) +
    "</div></div>"
  );
}

function toggleShortlist(slugValue) {
  var wasSaved = isSavedSlug(slugValue);
  toggleSavedSlug(slugValue, { surface: "therapist_profile" });
  return !wasSaved;
}

function updateShortlistPriority(slugValue, priority) {
  updateSavedListPriority(slugValue, priority);
}

function updateShortlistNote(slugValue, note) {
  updateSavedListNote(slugValue, note);
}

function updateShortlistNoteMeta(currentValue) {
  var noteMeta = document.getElementById("profileShortlistNoteMeta");
  if (!noteMeta) {
    return;
  }
  var length = String(currentValue || "").trim().length;
  noteMeta.textContent = length
    ? length + "/120 characters"
    : "Keep this to one sharp reminder for future-you.";
}

function updateShortlistAction(slugValue) {
  var buttons = Array.prototype.slice.call(
    document.querySelectorAll("[data-shortlist-trigger='profile']"),
  );
  var status = document.getElementById("profileShortlistStatus");
  var decisionMemory = document.getElementById("profileDecisionMemory");
  var queueStatus = document.getElementById("profileQueueStatus");
  if (!buttons.length) {
    return;
  }

  var shortlistEntry = readShortlist().find(function (item) {
    return item.slug === slugValue;
  });
  var shortlisted = !!shortlistEntry;
  // Update the .profile-save-btn-label span if present (keeps the icon
  // intact); otherwise update textContent for the legacy plain button.
  buttons.forEach(function (button) {
    var label = button.querySelector(".profile-save-btn-label");
    var icon = button.querySelector(".profile-save-btn-icon");
    if (label) {
      label.textContent = shortlisted ? "Saved to list" : "Save to list";
    } else {
      button.textContent = shortlisted ? "Saved to list" : "Save to list";
    }
    if (icon) {
      icon.textContent = shortlisted ? "★" : "☆";
    }
    button.classList.toggle("is-saved", shortlisted);
    button.setAttribute("aria-pressed", shortlisted ? "true" : "false");
  });
  if (status) {
    status.textContent = shortlisted
      ? "Saved in your list on this browser. You can come back, compare, add a note, or move into outreach without losing your place."
      : "Save up to 6 therapists so you can compare, leave a note, and return later without having to rebuild your search.";
  }

  if (decisionMemory) {
    var memoryState = buildProfileDecisionMemoryState(slugValue);
    decisionMemory.innerHTML = renderDecisionMemoryCard(memoryState);
  }

  if (queueStatus) {
    var queueState = buildProfileOutreachQueueState(slugValue);
    queueStatus.innerHTML = renderQueueStatusCard(queueState);
  }

  var priorityWrap = document.getElementById("profileShortlistPriorityWrap");
  var prioritySelect = document.getElementById("profileShortlistPriority");
  var noteInput = document.getElementById("profileShortlistNote");
  if (priorityWrap && prioritySelect && noteInput) {
    priorityWrap.style.display = shortlisted ? "block" : "none";
    prioritySelect.value = shortlistEntry ? shortlistEntry.priority : "";
    noteInput.value = shortlistEntry ? shortlistEntry.note : "";
    updateShortlistNoteMeta(noteInput.value);
  }
}

async function resolveTherapistForProfile(slugValue, therapistDirectoryPromise) {
  var exact = await fetchPublicTherapistBySlug(slugValue);
  if (exact) {
    return exact;
  }

  var normalizedSlug = String(slugValue || "")
    .trim()
    .toLowerCase();
  if (!normalizedSlug) {
    return null;
  }

  var therapists = therapistDirectoryPromise
    ? await therapistDirectoryPromise
    : await fetchPublicTherapists();
  return (
    therapists.find(function (item) {
      var itemSlug = String((item && item.slug) || "").toLowerCase();
      return itemSlug === normalizedSlug || itemSlug.indexOf(normalizedSlug + "-") === 0;
    }) || null
  );
}

(async function init() {
  var wrap = document.getElementById("profileWrap");
  function reveal() {
    wrap.classList.add("is-loaded");
  }
  try {
    if (!slug) {
      wrap.innerHTML =
        '<div class="not-found"><h2>Choose a therapist to review</h2><p>Open a profile from the directory to compare bipolar-care fit, practical details, and the best next step in one place.</p><a href="/directory" class="back-link">← Back to Directory</a></div>';
      reveal();
      return;
    }

    // When the page was SSR-rendered by api/therapists/[slug].mjs, the server
    // embeds the full therapist object so we can skip a redundant Sanity fetch.
    var ssrData = window.__THERAPIST_DATA__;
    var therapistDirectoryPromise = fetchPublicTherapists();
    var therapist =
      ssrData && ssrData.slug === slug
        ? ssrData
        : await resolveTherapistForProfile(slug, therapistDirectoryPromise);
    var therapistDirectory = await therapistDirectoryPromise;
    if (!therapist) {
      wrap.innerHTML =
        '<div class="not-found"><h2>This profile is not available right now</h2><p>The link may be out of date, or the therapist may no longer be listed. You can return to the directory to compare other bipolar-informed options.</p><a href="/directory" class="back-link">← Back to Directory</a></div>';
      reveal();
      return;
    }

    activeTherapistContactExperimentVariant = getExperimentVariant("therapist_contact_guidance", [
      "control",
      "action_plan",
    ]);
    trackExperimentExposure("therapist_contact_guidance", activeTherapistContactExperimentVariant, {
      therapist_slug: therapist.slug || "",
      preferred_contact_method: therapist.preferred_contact_method || "unknown",
    });
    recordProfileViewSafely(therapist.slug || slug);
    renderProfile(therapist, therapistDirectory);
    initValuePillPopover();
    reveal();
  } catch (error) {
    console.error("Therapist profile failed to load.", error);
    wrap.innerHTML =
      '<div class="not-found"><h2>We could not load this profile</h2><p>Something went wrong while opening the therapist page. Please go back to the directory and try again.</p><a href="/directory" class="back-link">← Back to Directory</a></div>';
    var breadcrumbName = document.getElementById("breadcrumbName");
    if (breadcrumbName) {
      breadcrumbName.textContent = "Profile unavailable";
    }
    reveal();
  }
})();

function bindReportIssueDialog(therapist) {
  var dialog = document.getElementById("reportIssueDialog");
  var trigger = document.getElementById("profileReportIssueBtn");
  if (!dialog || !trigger || typeof dialog.showModal !== "function") return;

  var form = document.getElementById("reportIssueForm");
  var closeBtn = document.getElementById("reportIssueClose");
  var cancelBtn = document.getElementById("reportIssueCancel");
  var thanks = document.getElementById("reportIssueThanks");
  var commentInput = document.getElementById("reportIssueComment");

  if (trigger.dataset.reportBound === "true") return;
  trigger.dataset.reportBound = "true";

  trigger.addEventListener("click", function () {
    if (thanks) thanks.hidden = true;
    if (form) form.querySelectorAll(".report-issue-form-controls").forEach(function () {});
    var fieldsetEl = form ? form.querySelector(".report-issue-reasons") : null;
    var commentEl = commentInput;
    var actionsEl = form ? form.querySelector(".report-issue-actions") : null;
    if (fieldsetEl) fieldsetEl.hidden = false;
    if (commentEl) {
      commentEl.hidden = false;
      commentEl.value = "";
    }
    if (actionsEl) actionsEl.hidden = false;
    var checked = form ? form.querySelectorAll('input[name="reportReason"]:checked') : [];
    checked.forEach(function (input) {
      input.checked = false;
    });
    trackFunnelEvent("listing_issue_dialog_opened", {
      slug: (therapist && therapist.slug) || "",
    });
    dialog.showModal();
  });

  function closeDialog() {
    if (dialog.open) dialog.close();
  }

  if (closeBtn) closeBtn.addEventListener("click", closeDialog);
  if (cancelBtn) cancelBtn.addEventListener("click", closeDialog);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var reasonEl = form.querySelector('input[name="reportReason"]:checked');
    if (!reasonEl) return;
    var reason = reasonEl.value;
    var commentRaw = commentInput ? String(commentInput.value || "").trim() : "";
    var comment = commentRaw.length > 400 ? commentRaw.slice(0, 400) : commentRaw;
    trackFunnelEvent("listing_issue_reported", {
      slug: (therapist && therapist.slug) || "",
      therapist_name: (therapist && therapist.name) || "",
      reason: reason,
      comment: comment,
      has_comment: Boolean(comment),
    });
    var fieldsetEl = form.querySelector(".report-issue-reasons");
    var actionsEl = form.querySelector(".report-issue-actions");
    if (fieldsetEl) fieldsetEl.hidden = true;
    if (commentInput) commentInput.hidden = true;
    if (actionsEl) actionsEl.hidden = true;
    if (thanks) thanks.hidden = false;
    window.setTimeout(closeDialog, 1800);
  });
}

function renderProfile(t, therapistDirectory) {
  var readiness = getTherapistMatchReadiness(t);
  var freshness = getDataFreshnessSummary(t);
  var responsivenessSignal = getPublicResponsivenessSignal(t);
  var routePerformance = summarizeTherapistContactRoutePerformance(readFunnelEvents(), t.slug);
  var routeOutcomePerformance = summarizeTherapistContactRouteOutcomes(t);
  var backupState = buildProfileBackupState(t, therapistDirectory || []);
  trackDirectoryProfileOpenQuality(t, readiness, freshness);
  document.title = t.name + " — BipolarTherapyHub";
  applyTherapistSeo(t);
  document.getElementById("breadcrumbName").textContent = t.name;
  if (new URLSearchParams(window.location.search).get("ref") === "match") {
    var breadcrumbDirLink = document.getElementById("breadcrumbDirectoryLink");
    if (breadcrumbDirLink) {
      breadcrumbDirLink.textContent = "Your matches";
      var savedMatchUrl;
      try {
        savedMatchUrl = window.sessionStorage.getItem("matchResultsUrl");
      } catch (_) {}
      breadcrumbDirLink.href = savedMatchUrl || "/match?mode=form";
    }
  }
  // navClaimLink was removed from the nav (moved into heroClaimLink
  // banner). Keep the lookup for back-compat in case an older template
  // variant still renders it.
  var navClaimLink = document.getElementById("navClaimLink");
  var heroClaimLink = document.getElementById("heroClaimLink");
  var footerClaimLink = document.getElementById("footerClaimLink");
  var claimHref = "/claim?confirm=" + encodeURIComponent(t.slug);
  if (navClaimLink) {
    navClaimLink.href = claimHref;
  }
  if (heroClaimLink) {
    heroClaimLink.href = claimHref;
  }
  if (footerClaimLink) {
    footerClaimLink.href = claimHref;
  }

  function isRealEmail(email) {
    var value = String(email || "").trim();
    if (!value) return false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
    if (/@example\.(com|org|net)$/i.test(value)) return false;
    if (
      /^(contact|info|hello|admin|therapist|yourname|email)@/i.test(value) &&
      /example\./i.test(value)
    )
      return false;
    return true;
  }

  var bipolarYears = Number(t.bipolar_years_experience || 0);

  var contactBtns = "";
  var primaryContactLabel = String(t.preferred_contact_label || "").trim();
  var therapistFirstName = (function () {
    var titlePrefix = /^(dr|mr|mrs|ms|mx|prof)\.?$/i;
    var words = String(t.name || "")
      .split(/\s+/)
      .filter(Boolean)
      .filter(function (w) {
        return !titlePrefix.test(w);
      });
    return words[0] || t.name || "this therapist";
  })();
  var firstStepExpectation = String(t.first_step_expectation || "").trim();
  var contactQuestionItems = [];
  var bookingHealthy = isBookingRouteHealthy(t);
  var websiteHealthy = isWebsiteRouteHealthy(t);
  function buildPreferredContactButton() {
    if (t.preferred_contact_method === "booking" && t.booking_url && bookingHealthy) {
      return (
        '<a href="' +
        escapeHtml(t.booking_url) +
        '" target="_blank" rel="noopener noreferrer" class="btn-contact" data-profile-contact-route="booking" data-profile-contact-priority="primary">' +
        escapeHtml(primaryContactLabel || "Book consultation") +
        "</a>"
      );
    }
    if (t.preferred_contact_method === "website" && t.website && websiteHealthy) {
      return (
        '<a href="' +
        escapeHtml(t.website) +
        '" target="_blank" rel="noopener noreferrer" class="btn-contact" data-profile-contact-route="website" data-profile-contact-priority="primary">' +
        escapeHtml(primaryContactLabel || "Visit " + therapistFirstName + "'s website →") +
        "</a>"
      );
    }
    if (t.preferred_contact_method === "phone" && t.phone) {
      return (
        '<a href="tel:' +
        escapeHtml(normalizeTelUri(t.phone)) +
        '" class="btn-contact" data-profile-contact-route="phone" data-profile-contact-priority="primary">' +
        escapeHtml(primaryContactLabel || "Call " + t.phone + " →") +
        "</a>"
      );
    }
    if (t.preferred_contact_method === "email" && isRealEmail(t.email)) {
      return (
        '<a href="mailto:' +
        escapeHtml(t.email) +
        '" class="btn-contact" data-profile-contact-route="email" data-profile-contact-priority="primary">' +
        escapeHtml(primaryContactLabel || "Email " + therapistFirstName + " →") +
        "</a>"
      );
    }
    // Universal fallback ladder when preferred_contact_method is null or
    // its corresponding field is missing: phone → email → booking. Never
    // an external practice site, per spec.
    if (t.phone) {
      return (
        '<a href="tel:' +
        escapeHtml(normalizeTelUri(t.phone)) +
        '" class="btn-contact" data-profile-contact-route="phone" data-profile-contact-priority="primary">Call ' +
        escapeHtml(t.phone) +
        " →</a>"
      );
    }
    if (isRealEmail(t.email)) {
      return (
        '<a href="mailto:' +
        escapeHtml(t.email) +
        '" class="btn-contact" data-profile-contact-route="email" data-profile-contact-priority="primary">Send an email →</a>'
      );
    }
    if (t.booking_url && bookingHealthy) {
      return (
        '<a href="' +
        escapeHtml(t.booking_url) +
        '" target="_blank" rel="noopener noreferrer" class="btn-contact" data-profile-contact-route="booking" data-profile-contact-priority="primary">Book a consultation →</a>'
      );
    }
    return "";
  }
  contactBtns +=
    '<button type="button" class="btn-website shortlist-profile-btn" id="profileShortlistButton" data-shortlist-trigger="profile">Save to list</button>';
  contactBtns += buildPreferredContactButton();
  contactBtns +=
    '<a href="/portal?slug=' +
    encodeURIComponent(t.slug) +
    '" class="btn-website btn-contact-secondary">Claim or manage profile</a>';
  if (t.phone && t.preferred_contact_method !== "phone") {
    contactBtns +=
      '<a href="tel:' +
      escapeHtml(normalizeTelUri(t.phone)) +
      '" class="btn-contact btn-contact-secondary" data-profile-contact-route="phone" data-profile-contact-priority="secondary">Call ' +
      escapeHtml(t.phone) +
      "</a>";
  }
  if (isRealEmail(t.email) && t.preferred_contact_method !== "email") {
    contactBtns +=
      '<a href="mailto:' +
      escapeHtml(t.email) +
      '" class="btn-contact btn-contact-secondary" data-profile-contact-route="email" data-profile-contact-priority="secondary">Email</a>';
  }
  if (t.website && websiteHealthy && t.preferred_contact_method !== "website") {
    contactBtns +=
      '<a href="' +
      escapeHtml(t.website) +
      '" target="_blank" rel="noopener noreferrer" class="btn-website" data-profile-contact-route="website" data-profile-contact-priority="secondary">Visit website</a>';
  }
  if (t.booking_url && bookingHealthy && t.preferred_contact_method !== "booking") {
    contactBtns +=
      '<a href="' +
      escapeHtml(t.booking_url) +
      '" target="_blank" rel="noopener noreferrer" class="btn-website" data-profile-contact-route="booking" data-profile-contact-priority="secondary">Booking link</a>';
  }

  var bestNextStepCopy =
    firstStepExpectation ||
    (t.preferred_contact_method === "email"
      ? "Most therapists respond within 1–2 business days."
      : t.preferred_contact_method === "website"
        ? "You'll find a contact form or booking link on their site."
        : "After first contact, the next step is usually a brief fit conversation or intake review before a full appointment is scheduled.");
  var contactStrategy = getContactStrategy(
    t,
    responsivenessSignal,
    routePerformance,
    routeOutcomePerformance,
  );
  var outreachScript = buildOutreachScript(t, contactStrategy);
  var primaryButton = buildPreferredContactButton();

  contactQuestionItems.push("Do you work often with bipolar-spectrum care like what I need?");
  if (t.estimated_wait_time || t.accepting_new_patients) {
    contactQuestionItems.push(
      t.estimated_wait_time
        ? "Is the current opening timeline still around " + t.estimated_wait_time + "?"
        : "What is the current timeline for a first consult or intake?",
    );
  }
  if (!((t.insurance_accepted || []).length && (t.session_fee_min || t.session_fee_max))) {
    contactQuestionItems.push(
      "Can you confirm fees, insurance, or superbill details for my situation?",
    );
  }
  contactQuestionItems.push("What usually happens after the first message or consult?");

  var contactMessageOpener =
    getFirstMeaningfulSentence(outreachScript) ||
    "Lead with one calm sentence about the kind of bipolar-focused help you want.";
  var contactQuestionPreview = contactQuestionItems.slice(0, 2).join(" ");
  var consultConfirmItems = [];

  consultConfirmItems.push(
    t.accepting_new_patients || t.estimated_wait_time
      ? "Whether the actual opening timeline still matches what is listed here."
      : "Whether they have a realistic opening path for you right now.",
  );
  consultConfirmItems.push(
    (t.insurance_accepted || []).length || t.session_fee_min || t.session_fee_max || t.sliding_scale
      ? "What your real cost path would be after insurance, fee range, or superbill details are clarified."
      : "What fees, insurance, or superbill details would apply in your situation.",
  );
  consultConfirmItems.push(
    t.medication_management
      ? "How therapy and medication support would actually be coordinated if you move forward."
      : "Whether their bipolar-related experience and care style match what you want help with right now.",
  );

  var consultConfirmPreview = consultConfirmItems.slice(0, 2).join(" ");
  var contactPrepCardsHtml = [
    {
      label: "Lead with",
      title: "A calm first opener",
      copy:
        "<strong>" +
        escapeHtml(contactMessageOpener) +
        "</strong> Then keep the next line focused on fit or timing instead of writing a long backstory.",
    },
    {
      label: "Confirm first",
      title: "The two fastest questions",
      copy: escapeHtml(
        contactQuestionPreview ||
          "Ask one fit question and one timing question so you can rule this option in or out quickly.",
      ),
    },
    {
      label: "Use the first reply well",
      title: "Confirm these before you commit",
      copy: escapeHtml(
        consultConfirmPreview ||
          "Use the first reply to confirm fit, timing, and cost path before you treat this as your lead route.",
      ),
    },
    {
      label: "Keep momentum",
      title: "Know the pivot before you start",
      copy: escapeHtml(
        contactStrategy.backupPlanCopy ||
          "If this route stalls after one follow-up, move to the clearest backup instead of waiting indefinitely.",
      ),
    },
  ]
    .map(function (item) {
      return (
        '<div class="profile-cockpit-card"><div class="profile-cockpit-label">' +
        item.label +
        '</div><div class="profile-cockpit-title">' +
        item.title +
        '</div><div class="profile-cockpit-copy">' +
        item.copy +
        "</div></div>"
      );
    })
    .join("");
  var secondaryButtons =
    '<button type="button" class="btn-website shortlist-profile-btn" data-shortlist-trigger="profile">Save to list</button>';
  if (t.phone && t.preferred_contact_method !== "phone") {
    secondaryButtons +=
      '<a href="tel:' +
      escapeHtml(normalizeTelUri(t.phone)) +
      '" class="btn-website">Call practice</a>';
  }
  if (isRealEmail(t.email) && t.preferred_contact_method !== "email") {
    secondaryButtons +=
      '<a href="mailto:' + escapeHtml(t.email) + '" class="btn-website">Email</a>';
  }
  if (t.website && websiteHealthy && t.preferred_contact_method !== "website") {
    secondaryButtons +=
      '<a href="' +
      escapeHtml(t.website) +
      '" target="_blank" rel="noopener noreferrer" class="btn-website">Visit website</a>';
  }
  if (t.booking_url && bookingHealthy && t.preferred_contact_method !== "booking") {
    secondaryButtons +=
      '<a href="' +
      escapeHtml(t.booking_url) +
      '" target="_blank" rel="noopener noreferrer" class="btn-website">Booking link</a>';
  }
  secondaryButtons +=
    '<a href="/portal?slug=' +
    encodeURIComponent(t.slug) +
    '" class="btn-website">Claim or manage profile</a>';
  contactBtns =
    '<div class="profile-actions-intro"><div class="profile-actions-intro-label">Recommended first move</div><div class="profile-actions-intro-title">' +
    escapeHtml(contactStrategy.routeLabel) +
    '</div><div class="profile-actions-intro-copy">' +
    escapeHtml(contactStrategy.routeReason) +
    "</div></div>" +
    '<div class="profile-actions-header"><div class="profile-actions-kicker">Outreach cockpit</div><div class="profile-actions-title">Make one strong first move, not three hesitant ones.</div><div class="profile-actions-microcopy">This rail is built to help you choose the safest route, send a more credible first message, and know exactly when to pivot if the first path stalls.</div></div>' +
    '<div class="contact-strategy-card"><div class="contact-strategy-kicker">Best outreach path</div><div class="contact-strategy-title">' +
    escapeHtml(contactStrategy.routeLabel) +
    '</div><div class="contact-strategy-copy">' +
    escapeHtml(contactStrategy.routeReason) +
    '</div><div class="contact-strategy-highlight"><strong>Why this route now:</strong> ' +
    escapeHtml(contactStrategy.proofLine) +
    '</div><div class="contact-strategy-confidence tone-' +
    escapeHtml(contactStrategy.confidenceTone) +
    '"><div class="contact-strategy-confidence-label">' +
    escapeHtml(contactStrategy.confidenceLabel) +
    '</div><div class="contact-strategy-confidence-note">' +
    escapeHtml(contactStrategy.confidenceNote) +
    '</div></div><div class="contact-strategy-grid"><div class="contact-strategy-item"><div class="contact-strategy-label">Expected reply window</div><div class="contact-strategy-value ' +
    escapeHtml(contactStrategy.timingTone) +
    '">' +
    escapeHtml(contactStrategy.replyWindowCopy) +
    '</div></div><div class="contact-strategy-item"><div class="contact-strategy-label">Follow up if needed</div><div class="contact-strategy-value">' +
    escapeHtml(contactStrategy.followUpCopy) +
    '</div></div><div class="contact-strategy-item"><div class="contact-strategy-label">If this stalls</div><div class="contact-strategy-value">' +
    escapeHtml(contactStrategy.backupPlanCopy) +
    "</div></div></div></div>" +
    '<div class="profile-cockpit-strip">' +
    contactPrepCardsHtml +
    "</div>" +
    '<div class="profile-primary-action"><div class="primary-action-frame">' +
    (primaryButton || "") +
    '<div class="profile-primary-caption">' +
    escapeHtml(bestNextStepCopy) +
    "</div></div></div>" +
    renderBackupCard(backupState) +
    '<div class="profile-secondary-actions"><div class="profile-secondary-label">More ways to act</div>' +
    secondaryButtons +
    "</div>";
  void contactBtns;

  // Short-form signup injects stub placeholders into the application
  // so schema validation passes. Those used to leak through to the
  // published therapist doc and render to patients as "Pending —
  // completed after approval." Treat them as empty.
  var INTAKE_STUBS = [
    "Pending",
    "Pending — completed after approval.",
    "Pending - completed after approval.",
  ];
  function stripIntakeStub(value) {
    if (typeof value !== "string") return value;
    var trimmed = value.trim();
    return INTAKE_STUBS.indexOf(trimmed) !== -1 ? "" : value;
  }

  // Strip scraped directory prefix: "Name, Credential, City, State, ZIP, Phone, actual bio"
  // Anchors on the phone number — everything up through it is metadata, not bio copy.
  var SCRAPED_PREFIX_RE = /^.+,\s*\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4},?\s+/;
  function stripScrapedPrefix(value) {
    if (typeof value !== "string") return value;
    var cleaned = value.replace(SCRAPED_PREFIX_RE, "");
    return cleaned.length < value.length ? cleaned : value;
  }

  var scrubbedBio = stripScrapedPrefix(stripIntakeStub(t.bio));

  var backNavRef = new URLSearchParams(window.location.search).get("ref") || "";
  var backNavSavedUrl;
  try {
    backNavSavedUrl = window.sessionStorage.getItem("matchResultsUrl");
  } catch (_) {}
  var backNav =
    backNavRef === "match"
      ? { href: backNavSavedUrl || "/match?mode=form", label: "← Back to your matches" }
      : { href: "/directory", label: "← Back to directory" };

  // ─── Hero card helpers (Step 5 redesign) ──────────────────────────────
  // 6-color avatar palette per redesign spec. Hash on slug so a clinician's
  // chip color stays stable across visits. Local to this page so we don't
  // disturb the 4-color palette used in match cards.
  var HERO_AVATAR_RAMPS = [
    { bg: "#D6EFF6", ink: "#1C4D5C" }, // teal
    { bg: "#E8E4F8", ink: "#3C3489" }, // purple
    { bg: "#FAE8C0", ink: "#633806" }, // amber
    { bg: "#D8EAF8", ink: "#0C447C" }, // blue
    { bg: "#D4EDD9", ink: "#27500A" }, // sage
    { bg: "#FAE0D6", ink: "#712B13" }, // coral
  ];
  function heroAvatarPalette(slug) {
    var key = String(slug || t.name || "");
    var hash = 0;
    for (var i = 0; i < key.length; i += 1) {
      hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    return HERO_AVATAR_RAMPS[hash % HERO_AVATAR_RAMPS.length];
  }
  function heroInitials(name) {
    var titlePrefix = /^(dr|mr|mrs|ms|mx|prof)\.?$/i;
    var parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .filter(function (p) {
        return !titlePrefix.test(p);
      });
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }
  var heroPalette = heroAvatarPalette(t.slug);
  var heroAvatarHtml = t.photo_url
    ? '<img src="' +
      escapeHtml(t.photo_url) +
      '" alt="" class="profile-hero-avatar" loading="lazy" decoding="async" />'
    : '<span class="profile-hero-avatar" style="background:' +
      heroPalette.bg +
      ";color:" +
      heroPalette.ink +
      '">' +
      escapeHtml(heroInitials(t.name)) +
      "</span>";

  var heroStatusRow =
    '<div class="profile-hero-status">' +
    '<span class="profile-hero-badge profile-hero-badge--bp">Bipolar-informed profile</span>' +
    (t.accepting_new_patients === true
      ? '<span class="profile-hero-badge profile-hero-badge--accepting">Accepting new patients</span>'
      : t.accepting_new_patients === false
        ? '<span class="profile-hero-badge profile-hero-badge--closed">Not currently accepting</span>'
        : "") +
    "</div>";

  var heroTelehealthStates = Array.isArray(t.telehealth_states)
    ? t.telehealth_states.filter(Boolean)
    : [];
  var heroLocationParts = [];
  if (t.city) heroLocationParts.push(escapeHtml(t.city));
  if (t.state) heroLocationParts.push(escapeHtml(t.state));
  var heroLocationLine = heroLocationParts.join(", ");
  if (t.accepts_telehealth && heroTelehealthStates.length) {
    var thShown = heroTelehealthStates.slice(0, 6).join(", ");
    var thExtra =
      heroTelehealthStates.length > 6 ? " +" + (heroTelehealthStates.length - 6) + " more" : "";
    heroLocationLine +=
      ' <span class="profile-hero-loc-sep">·</span> Telehealth available in ' +
      escapeHtml(thShown + thExtra);
  } else if (t.accepts_telehealth) {
    heroLocationLine += ' <span class="profile-hero-loc-sep">·</span> Telehealth available';
  }

  var heroYearsHtml = "";
  if (bipolarYears > 0) {
    var coordinatesText = /coordinat/i.test(String(t.care_approach || ""))
      ? "Coordinates with psychiatrists"
      : "";
    var bipolarPopulations = (
      Array.isArray(t.client_populations) ? t.client_populations : []
    ).filter(function (p) {
      return /bipolar|cycl|mixed|hypoman|mood|mania/i.test(String(p || ""));
    });
    var subtypesText = bipolarPopulations.slice(0, 4).join(", ");
    heroYearsHtml =
      '<div class="profile-hero-years">' +
      '<div class="profile-hero-years-icon"><i class="ti ti-certificate" aria-hidden="true"></i></div>' +
      '<div class="profile-hero-years-main">' +
      '<div class="profile-hero-years-num">' +
      escapeHtml(bipolarYears + (bipolarYears === 1 ? " year" : " years")) +
      "</div>" +
      '<div class="profile-hero-years-sub">treating bipolar specifically</div>' +
      "</div>" +
      (coordinatesText || subtypesText
        ? '<div class="profile-hero-years-sep" aria-hidden="true"></div>' +
          '<div class="profile-hero-years-detail">' +
          (coordinatesText ? "<strong>" + escapeHtml(coordinatesText) + "</strong>" : "") +
          escapeHtml(subtypesText) +
          "</div>"
        : "") +
      "</div>";
  }

  var modalityList = (Array.isArray(t.treatment_modalities) ? t.treatment_modalities : []).filter(
    Boolean,
  );
  function isPrimaryHeroModality(name) {
    var n = String(name || "").toLowerCase();
    if (/ipsrt|interpersonal\s+and\s+social\s+rhythm/.test(n)) return true;
    if (/\bfft\b|family.?focused/.test(n)) return true;
    if (/dbt.*bipolar|bipolar.*dbt|dbt-for-bipolar/.test(n)) return true;
    return false;
  }
  var primaryModalities = modalityList.filter(isPrimaryHeroModality);
  var secondaryModalities = modalityList.filter(function (m) {
    return !isPrimaryHeroModality(m);
  });
  var orderedModalities = primaryModalities.concat(secondaryModalities);
  var visibleModalities = orderedModalities.slice(0, 6);
  var modalityOverflow = orderedModalities.length - visibleModalities.length;
  var heroTagsHtml = "";
  if (visibleModalities.length) {
    heroTagsHtml = '<div class="profile-hero-tags">';
    visibleModalities.forEach(function (m) {
      heroTagsHtml +=
        '<span class="profile-hero-tag ' +
        (isPrimaryHeroModality(m) ? "profile-hero-tag--primary" : "profile-hero-tag--secondary") +
        '">' +
        escapeHtml(m) +
        "</span>";
    });
    if (modalityOverflow > 0) {
      heroTagsHtml += '<span class="profile-hero-tag-more">+' + modalityOverflow + " more</span>";
    }
    heroTagsHtml += "</div>";
  }

  // Step 7: Bio card. Truncates to ~280 chars with a Read more / Show less
  // toggle when longer. Renders nothing if there's no bio to show (per the
  // graceful-empty-states rule — no "No bio yet" placeholder).
  var bioCardHtml = "";
  if (scrubbedBio && String(scrubbedBio).trim()) {
    var bioRaw = String(scrubbedBio).trim();
    var bioParagraphs = bioRaw
      .split(/\n\s*\n+/)
      .map(function (p) {
        return p.trim();
      })
      .filter(Boolean);
    if (!bioParagraphs.length) bioParagraphs = [bioRaw];
    var bioFullPlain = bioParagraphs.join("\n\n");
    var needsBioTruncate = bioFullPlain.length > 280;
    var bioPreviewText = "";
    if (needsBioTruncate) {
      bioPreviewText = bioFullPlain.slice(0, 280);
      var lastSpace = bioPreviewText.lastIndexOf(" ");
      if (lastSpace > 200) bioPreviewText = bioPreviewText.slice(0, lastSpace);
      bioPreviewText = bioPreviewText.replace(/[\s,;:.—–-]+$/, "") + "…";
    }
    var bioFullHtml = bioParagraphs
      .map(function (p) {
        return '<p class="profile-section-body">' + escapeHtml(p) + "</p>";
      })
      .join("");
    var bioPreviewHtml = needsBioTruncate
      ? '<p class="profile-section-body">' + escapeHtml(bioPreviewText) + "</p>"
      : "";
    bioCardHtml =
      '<div class="card profile-section-card">' +
      '<div class="profile-section-eyebrow">About ' +
      escapeHtml(therapistFirstName) +
      "</div>" +
      '<h2 class="profile-section-h2">In their own words</h2>' +
      '<div class="profile-bio-block" data-profile-bio-block>' +
      (needsBioTruncate
        ? '<div class="profile-bio-preview" data-profile-bio-preview>' +
          bioPreviewHtml +
          "</div>" +
          '<div class="profile-bio-full" data-profile-bio-full hidden>' +
          bioFullHtml +
          "</div>" +
          '<button type="button" class="profile-bio-toggle" data-profile-bio-toggle aria-expanded="false">Read more →</button>'
        : bioFullHtml) +
      "</div>" +
      "</div>";
  }

  // Step 6: Bipolar approach card. Renders only when populated; otherwise
  // skipped entirely (no placeholder per spec).
  var bipolarApproachText = String(t.bipolar_approach || "").trim();
  var bipolarApproachHtml = "";
  if (bipolarApproachText) {
    var approachParagraphs = bipolarApproachText
      .split(/\n{2,}/)
      .map(function (p) {
        return p.trim();
      })
      .filter(Boolean);
    var approachBody = approachParagraphs.length
      ? approachParagraphs
          .map(function (p) {
            return '<p class="profile-section-body">' + escapeHtml(p) + "</p>";
          })
          .join("")
      : '<p class="profile-section-body">' + escapeHtml(bipolarApproachText) + "</p>";
    bipolarApproachHtml =
      '<div class="card profile-section-card">' +
      '<div class="profile-section-eyebrow">Bipolar approach</div>' +
      '<h2 class="profile-section-h2">How ' +
      escapeHtml(therapistFirstName) +
      " thinks about bipolar care</h2>" +
      approachBody +
      "</div>";
  }

  // Step 8: Practice Details card. Each row renders only when its source
  // field is populated. The .profile-detail--full class on Insurance lets
  // it span both columns.
  function fmtUsd(n) {
    var num = Number(n);
    if (!isFinite(num) || num <= 0) return "";
    return "$" + Math.round(num);
  }
  var practiceRows = [];
  // Availability
  if (t.accepting_new_patients === true || t.accepting_new_patients === false) {
    var availabilityValue;
    var availabilityClass = "profile-detail-value";
    if (t.accepting_new_patients === true) {
      availabilityValue = '<span class="profile-detail-avail">Accepting new patients</span>';
      var posture = String(t.availability_posture || "").trim();
      if (posture) {
        availabilityValue += '<div class="profile-detail-sub">' + escapeHtml(posture) + "</div>";
      }
    } else {
      availabilityValue = "Not currently accepting";
    }
    practiceRows.push({
      label: "Availability",
      value: availabilityValue,
      cls: availabilityClass,
      raw: true,
    });
  }
  // Estimated wait
  var waitText = String(t.estimated_wait_time || "").trim();
  if (waitText) {
    practiceRows.push({ label: "Estimated wait", value: waitText });
  }
  // Session fee
  var feeMin = fmtUsd(t.session_fee_min);
  var feeMax = fmtUsd(t.session_fee_max);
  var feeText = "";
  if (feeMin && feeMax && feeMin !== feeMax) feeText = feeMin + "–" + feeMax;
  else if (feeMin) feeText = feeMin;
  else if (feeMax) feeText = feeMax;
  if (t.sliding_scale && feeText) feeText += " · Sliding scale available";
  else if (t.sliding_scale && !feeText) feeText = "Sliding scale available";
  if (feeText) {
    practiceRows.push({ label: "Session fee", value: feeText });
  }
  // Care mode
  var careMode = "";
  if (t.accepts_telehealth && t.accepts_in_person) careMode = "In-person & telehealth";
  else if (t.accepts_telehealth) careMode = "Telehealth";
  else if (t.accepts_in_person) careMode = "In-person";
  if (careMode) {
    practiceRows.push({ label: "Care mode", value: careMode });
  }
  // Languages
  var langs = (Array.isArray(t.languages) ? t.languages : []).filter(Boolean);
  if (langs.length) {
    practiceRows.push({ label: "Languages", value: langs.join(", ") });
  }
  // Insurance — full width row, pills
  var insuranceList = (Array.isArray(t.insurance_accepted) ? t.insurance_accepted : []).filter(
    Boolean,
  );
  var insuranceHtml = "";
  if (insuranceList.length) {
    var visibleInsurance = insuranceList.slice(0, 5);
    var insuranceOverflow = insuranceList.length - visibleInsurance.length;
    var pillHtml = visibleInsurance
      .map(function (ins) {
        return '<span class="profile-detail-pill">' + escapeHtml(String(ins)) + "</span>";
      })
      .join("");
    if (insuranceOverflow > 0) {
      pillHtml += '<span class="profile-detail-pill-more">+' + insuranceOverflow + " more</span>";
    }
    insuranceHtml = '<div class="profile-detail-pills">' + pillHtml + "</div>";
  }
  var practiceDetailsHtml = "";
  if (practiceRows.length || insuranceHtml) {
    var rowsHtml = practiceRows
      .map(function (row) {
        return (
          '<div class="profile-detail-row">' +
          '<div class="profile-detail-label">' +
          escapeHtml(row.label) +
          "</div>" +
          '<div class="' +
          (row.cls || "profile-detail-value") +
          '">' +
          (row.raw ? row.value : escapeHtml(row.value)) +
          "</div>" +
          "</div>"
        );
      })
      .join("");
    if (insuranceHtml) {
      rowsHtml +=
        '<div class="profile-detail-row profile-detail-row--full">' +
        '<div class="profile-detail-label">Insurance accepted</div>' +
        insuranceHtml +
        "</div>";
    }
    practiceDetailsHtml =
      '<div class="card profile-section-card">' +
      '<div class="profile-section-eyebrow">Practice details</div>' +
      '<h2 class="profile-section-h2">What to know before reaching out</h2>' +
      '<div class="profile-detail-grid">' +
      rowsHtml +
      "</div>" +
      "</div>";
  }

  // Step 9: Reach Out card. Open by default. Renders even when phone is
  // missing (call-script block is conditional on phone).
  var draftMessageText;
  var contactGuidanceText = String(t.contact_guidance || "").trim();
  if (contactGuidanceText) {
    draftMessageText = contactGuidanceText;
  } else {
    var careModeWord;
    if (t.accepts_telehealth && t.accepts_in_person)
      careModeWord = "either telehealth or in-person";
    else if (t.accepts_telehealth) careModeWord = "telehealth";
    else if (t.accepts_in_person) careModeWord = "in-person";
    else careModeWord = "telehealth or in-person";
    draftMessageText =
      "Hi " +
      therapistFirstName +
      ",\n\n" +
      "I found your profile on BipolarTherapyHub and wanted to see if you might be a good fit for bipolar-focused support.\n\n" +
      "I'm open to " +
      careModeWord +
      " care. I'd love to confirm insurance details and whether you have availability in the next few weeks before going further.\n\n" +
      "Thanks so much.";
  }
  var draftMessageHtml = escapeHtml(draftMessageText).replace(/\n/g, "<br>");

  var reachOutCallScript = "";
  if (t.phone) {
    var voicemailFirstName = therapistFirstName;
    reachOutCallScript =
      '<div class="profile-reach-call">' +
      '<div class="profile-reach-call-label">Calling? Here\'s what to say</div>' +
      '<p class="profile-reach-call-body">' +
      escapeHtml(
        "When someone answers: “Hi, my name is [your name]. I found " +
          voicemailFirstName +
          "’s profile on BipolarTherapyHub and I'm looking for a therapist who specializes in bipolar disorder. Are you currently taking new clients?”",
      ) +
      "</p>" +
      '<div class="profile-reach-call-label">If you get voicemail</div>' +
      '<p class="profile-reach-call-body">' +
      escapeHtml(
        "“Hi, my name is [your name] and my number is [your number]. I found " +
          voicemailFirstName +
          "’s profile on BipolarTherapyHub and would love to connect about bipolar-informed care. Please call me back when you have a moment, thank you.”",
      ) +
      "</p>" +
      '<button type="button" class="profile-reach-call-cta" data-profile-call-cta data-tel="' +
      escapeHtml(normalizeTelUri(t.phone)) +
      '">' +
      '<i class="ti ti-phone" aria-hidden="true"></i> Call ' +
      escapeHtml(t.phone) +
      "</button>" +
      "</div>";
  }

  var reachOutHtml =
    '<div class="card profile-section-card profile-reach-card">' +
    '<div class="profile-section-eyebrow">Reach out</div>' +
    '<h2 class="profile-section-h2">We\'ve drafted a message for you</h2>' +
    '<div class="profile-reach-draft">' +
    '<div class="profile-reach-draft-label">Written message</div>' +
    '<div class="profile-reach-draft-hint">A calm starting point. Swap in your name or add one personal detail if you\'d like.</div>' +
    '<div class="profile-reach-draft-msg" data-profile-draft-text>' +
    draftMessageHtml +
    "</div>" +
    '<div class="profile-reach-draft-foot">' +
    '<button type="button" class="profile-reach-copy" data-profile-copy-draft>' +
    '<i class="ti ti-copy" aria-hidden="true"></i> Copy message' +
    "</button>" +
    "</div>" +
    "</div>" +
    reachOutCallScript +
    "</div>";

  // Step 10: FAQ card. Renders in the main column (was previously inside
  // the sidebar's hero-right). Uses the shared buildFAQItems dynamic Q&A;
  // first item opens by default when accepting new patients is true.
  var faqItems = buildFAQItems(t);
  var faqAcceptingOpen = t.accepting_new_patients === true;
  var faqItemsHtml = faqItems
    .map(function (item, i) {
      var isFirst = i === 0;
      var isOpen = isFirst && faqAcceptingOpen;
      var iconClass = isOpen
        ? "ti ti-circle-check"
        : isFirst && !faqAcceptingOpen
          ? "ti ti-chevron-down"
          : "ti ti-chevron-down";
      var iconStyle = isOpen ? ' style="color:#3b9b5a"' : "";
      return (
        '<div class="profile-faq-item' +
        (isOpen ? " is-open" : "") +
        '" data-profile-faq-item' +
        (isFirst && faqAcceptingOpen ? " data-faq-accept-locked" : "") +
        ">" +
        '<button type="button" class="profile-faq-q" aria-expanded="' +
        (isOpen ? "true" : "false") +
        '" data-profile-faq-toggle>' +
        "<span>" +
        escapeHtml(item.q) +
        "</span>" +
        '<i class="' +
        iconClass +
        '" aria-hidden="true"' +
        iconStyle +
        "></i>" +
        "</button>" +
        '<div class="profile-faq-a"' +
        (isOpen ? "" : " hidden") +
        ">" +
        escapeHtml(item.a) +
        "</div>" +
        "</div>"
      );
    })
    .join("");

  var faqLicenseRow = "";
  if (t.license_number) {
    var faqLicenseState = t.license_state || t.state || "CA";
    var faqLicenseType = t.credentials || "License";
    faqLicenseRow =
      '<div class="profile-faq-license">' +
      '<i class="ti ti-shield-check" aria-hidden="true"></i> ' +
      "License verified · " +
      escapeHtml(faqLicenseState + " " + faqLicenseType + " #" + t.license_number) +
      " · California Department of Consumer Affairs" +
      "</div>";
  }

  var faqCardHtml =
    '<div class="card profile-section-card">' +
    '<div class="profile-section-eyebrow">Questions</div>' +
    '<h2 class="profile-section-h2">Common questions about ' +
    escapeHtml(therapistFirstName) +
    "</h2>" +
    '<div class="profile-faq-list">' +
    faqItemsHtml +
    "</div>" +
    faqLicenseRow +
    "</div>";

  // Step 11: Sidebar contact card. Coral primary CTA prefers phone, falls
  // back to email. Email anchor word-break for long addresses. Save button
  // toggles bth_saved_therapists in localStorage and pings the nav badge.
  var sideHasPhone = Boolean(t.phone);
  var sideHasEmail = isRealEmail(t.email);
  var sideHasWebsite = Boolean(t.website);
  var sideHasBooking = Boolean(t.booking_url) && t.booking_url !== t.website;
  var preferredContactRaw = String(t.preferred_contact_method || "").trim();
  var preferredContactLabelMap = {
    phone: "Phone first.",
    email: "Email first.",
    text: "Text first.",
    sms: "Text first.",
    booking_url: "Use the booking link.",
    booking: "Use the booking link.",
  };
  var preferredContactCopy = "";
  if (contactGuidanceText) {
    preferredContactCopy = contactGuidanceText;
  } else if (preferredContactRaw) {
    preferredContactCopy =
      preferredContactLabelMap[preferredContactRaw.toLowerCase()] ||
      preferredContactRaw.charAt(0).toUpperCase() + preferredContactRaw.slice(1);
  }

  var sidePrimaryHtml = "";
  if (sideHasPhone) {
    sidePrimaryHtml =
      '<a href="tel:' +
      escapeHtml(normalizeTelUri(t.phone)) +
      '" class="profile-side-primary" data-profile-side-primary>' +
      '<i class="ti ti-phone" aria-hidden="true"></i> Call ' +
      escapeHtml(t.phone) +
      "</a>";
  } else if (sideHasEmail) {
    sidePrimaryHtml =
      '<a href="mailto:' +
      escapeHtml(t.email) +
      '" class="profile-side-primary" data-profile-side-primary>' +
      '<i class="ti ti-mail" aria-hidden="true"></i> Email ' +
      escapeHtml(therapistFirstName) +
      "</a>";
  }

  var sideContactItems = "";
  if (sideHasEmail) {
    sideContactItems +=
      '<div class="profile-side-item">' +
      '<i class="ti ti-mail" aria-hidden="true"></i>' +
      '<a href="mailto:' +
      escapeHtml(t.email) +
      '" class="profile-side-email">' +
      escapeHtml(t.email) +
      "</a>" +
      "</div>";
  }
  if (sideHasWebsite) {
    sideContactItems +=
      '<div class="profile-side-item">' +
      '<i class="ti ti-world" aria-hidden="true"></i>' +
      '<a href="' +
      escapeHtml(t.website) +
      '" target="_blank" rel="noopener noreferrer">Practice website →</a>' +
      "</div>";
  }
  if (sideHasBooking) {
    sideContactItems +=
      '<div class="profile-side-item">' +
      '<i class="ti ti-calendar" aria-hidden="true"></i>' +
      '<a href="' +
      escapeHtml(t.booking_url) +
      '" target="_blank" rel="noopener noreferrer">Book a consultation →</a>' +
      "</div>";
  }

  var sidePreferredBlock = "";
  if (preferredContactCopy) {
    sidePreferredBlock =
      '<div class="profile-side-preferred">' +
      '<div class="profile-side-preferred-label">Preferred contact</div>' +
      '<div class="profile-side-preferred-text">' +
      escapeHtml(preferredContactCopy) +
      "</div>" +
      "</div>";
  }

  var sideSaveId = String(t.slug || t._id || t.name || "").trim();
  var sideSaveButton =
    '<button type="button" class="profile-side-save" data-profile-side-save data-save-id="' +
    escapeHtml(sideSaveId) +
    '" aria-pressed="false">' +
    '<i class="ti ti-bookmark" aria-hidden="true"></i>' +
    '<span class="profile-side-save-label">Save</span>' +
    "</button>";

  var sidebarHtml =
    '<div class="profile-side-card">' +
    '<div class="profile-side-eyebrow">Contact</div>' +
    sidePrimaryHtml +
    (sidePrimaryHtml
      ? '<p class="profile-side-note">After first contact, the next step is usually a brief 15-min consultation before scheduling.</p>'
      : "") +
    sideContactItems +
    sidePreferredBlock +
    sideSaveButton +
    "</div>";

  var html =
    '<div class="profile-layout">' +
    '<main class="profile-main-col">' +
    '<div class="profile-header" id="section-about" data-profile-section>' +
    '<div class="profile-hero-main">' +
    '<div class="profile-hero-top">' +
    '<div class="profile-identity">' +
    '<div class="card profile-hero-card">' +
    '<div class="profile-hero-top">' +
    heroAvatarHtml +
    '<div class="profile-hero-meta">' +
    heroStatusRow +
    '<h1 class="profile-hero-name">' +
    escapeHtml(t.name) +
    "</h1>" +
    (t.credentials || t.title
      ? '<div class="profile-hero-cred">' +
        [t.credentials, t.title].filter(Boolean).map(escapeHtml).join(" · ") +
        "</div>"
      : "") +
    (t.practice_name
      ? '<div class="profile-hero-practice">' + escapeHtml(t.practice_name) + "</div>"
      : "") +
    (heroLocationLine
      ? '<div class="profile-hero-loc"><i class="ti ti-map-pin" aria-hidden="true"></i> ' +
        heroLocationLine +
        "</div>"
      : "") +
    "</div>" +
    "</div>" +
    heroYearsHtml +
    heroTagsHtml +
    "</div>" +
    bipolarApproachHtml +
    bioCardHtml +
    practiceDetailsHtml +
    reachOutHtml +
    faqCardHtml +
    "</div>" +
    '<div class="profile-hero-right">' +
    sidebarHtml +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</main>" +
    '<aside class="profile-side-col" data-profile-side></aside>' +
    "</div>" +
    '<div class="profile-foot-actions">' +
    '<a href="' +
    escapeHtml(backNav.href) +
    '" class="profile-foot-back">' +
    escapeHtml(backNav.label) +
    "</a>" +
    '<button type="button" class="profile-foot-report" id="profileReportIssueBtn" data-report-slug="' +
    escapeHtml(t.slug || "") +
    '">Report an issue with this listing</button>' +
    "</div>";

  document.getElementById("profileWrap").innerHTML = html;

  // Step 4 layout: hero-right (contact card + FAQ) is rendered inside the
  // hero-top grid for backwards compatibility; move it into the sidebar
  // <aside> so the new two-column layout takes effect without rewriting
  // every interior render branch in this single step.
  (function liftHeroRightToSidebar() {
    var heroRight = document.querySelector(".profile-hero-right");
    var sideCol = document.querySelector("[data-profile-side]");
    if (heroRight && sideCol) {
      sideCol.appendChild(heroRight);
    }
  })();

  // Append mobile sticky bar to body (outside profileWrap so it stays fixed)
  var existingStickyBar = document.getElementById("profileMobileStickyBar");
  if (existingStickyBar) existingStickyBar.remove();
  var stickyBarHtml = buildMobileStickyBar(t);
  if (stickyBarHtml) {
    var stickyContainer = document.createElement("div");
    stickyContainer.innerHTML = stickyBarHtml;
    document.body.appendChild(stickyContainer.firstElementChild);
  }
  // Show mobile sticky bar once hero primary CTA scrolls out of view
  var heroCta = document.querySelector(".primary-action-frame");
  var stickyBar = document.getElementById("profileMobileStickyBar");
  if (heroCta && stickyBar && typeof window.IntersectionObserver === "function") {
    var stickyObserver = new window.IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          stickyBar.setAttribute("aria-hidden", entry.isIntersecting ? "true" : "false");
        });
      },
      { threshold: 0.1 },
    );
    stickyObserver.observe(heroCta);
  }

  bindReportIssueDialog(t);
  updateShortlistAction(t.slug);
  var shortlistButtons = Array.prototype.slice.call(
    document.querySelectorAll("[data-shortlist-trigger='profile']"),
  );
  shortlistButtons.forEach(function (shortlistButton) {
    shortlistButton.addEventListener("click", function () {
      toggleShortlist(t.slug);
      updateShortlistAction(t.slug);
      if (typeof window.refreshShortlistNav === "function") {
        window.refreshShortlistNav();
      }
    });
  });
  var prioritySelect = document.getElementById("profileShortlistPriority");
  if (prioritySelect) {
    prioritySelect.addEventListener("change", function () {
      updateShortlistPriority(t.slug, prioritySelect.value);
      updateShortlistAction(t.slug);
      if (typeof window.refreshShortlistNav === "function") {
        window.refreshShortlistNav();
      }
    });
  }
  var noteInput = document.getElementById("profileShortlistNote");
  if (noteInput) {
    noteInput.addEventListener("input", function () {
      updateShortlistNote(t.slug, noteInput.value);
      updateShortlistNoteMeta(noteInput.value);
    });
    noteInput.addEventListener("change", function () {
      updateShortlistNote(t.slug, noteInput.value);
      updateShortlistNoteMeta(noteInput.value);
      updateShortlistAction(t.slug);
      if (typeof window.refreshShortlistNav === "function") {
        window.refreshShortlistNav();
      }
    });
  }
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-contact-route]"))
    .forEach(function (link) {
      link.addEventListener("click", function () {
        var route = link.getAttribute("data-profile-contact-route") || "";
        rememberTherapistContactRoute(t.slug, route, "profile");
        recordCtaClickSafely(t.slug, route);
        trackFunnelEvent("profile_contact_route_clicked", {
          priority: link.getAttribute("data-profile-contact-priority") || "unknown",
          ...getContactAnalyticsMeta(t, route),
        });
      });
    });
  document.querySelectorAll("[data-copy-email]").forEach(function (link) {
    link.addEventListener("click", function (event) {
      var email = link.getAttribute("data-copy-email") || "";
      if (!email) return;
      var valueEl = link.querySelector(".profile-contact-value");
      var copyHint = link.querySelector(".profile-contact-copy-hint");
      var original = valueEl ? valueEl.textContent : "";
      function flash() {
        if (valueEl) valueEl.textContent = "Copied!";
        if (copyHint) copyHint.textContent = "✓";
        window.setTimeout(function () {
          if (valueEl) valueEl.textContent = original;
          if (copyHint) copyHint.textContent = "Copy";
        }, 2000);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        event.preventDefault();
        navigator.clipboard.writeText(email).then(flash, function () {
          window.location.href = "mailto:" + email;
        });
      } else {
        try {
          var ta = document.createElement("textarea");
          ta.value = email;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          event.preventDefault();
          flash();
        } catch (_e) {
          // fall through to mailto:
        }
      }
    });
  });

  var contactSection = document.querySelector("[data-profile-contact-section]");
  var contactSectionTracked = false;
  if (contactSection && typeof window.IntersectionObserver === "function") {
    var contactObserver = new window.IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting || contactSectionTracked) {
            return;
          }
          contactSectionTracked = true;
          trackFunnelEvent("profile_contact_section_viewed", getContactAnalyticsMeta(t, "section"));
          contactObserver.disconnect();
        });
      },
      { threshold: 0.2 },
    );
    contactObserver.observe(contactSection);
  }
  var outreachToggleBtn = document.querySelector("[data-outreach-toggle]");
  var outreachPanel = document.getElementById("contactOutreachPanel");
  if (outreachToggleBtn && outreachPanel) {
    outreachToggleBtn.addEventListener("click", function () {
      var isOpen = outreachToggleBtn.getAttribute("aria-expanded") === "true";
      outreachToggleBtn.setAttribute("aria-expanded", isOpen ? "false" : "true");
      if (isOpen) {
        outreachPanel.setAttribute("hidden", "");
      } else {
        outreachPanel.removeAttribute("hidden");
        trackFunnelEvent("profile_outreach_scripts_opened", getContactAnalyticsMeta(t, "scripts"));
      }
    });
  }
  if (window.location.hash === "#outreach" && outreachToggleBtn && outreachPanel) {
    outreachToggleBtn.setAttribute("aria-expanded", "true");
    outreachPanel.removeAttribute("hidden");
    window.setTimeout(function () {
      var card = document.getElementById("outreach");
      if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }
  var outreachScriptCard = document.querySelector("[data-profile-outreach-script]");
  if (outreachScriptCard) {
    outreachScriptCard.addEventListener("click", function () {
      trackFunnelEvent("profile_outreach_script_engaged", getContactAnalyticsMeta(t, "script"));
    });
  }
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-focus-script]"))
    .forEach(function (button) {
      button.addEventListener("click", function () {
        if (outreachToggleBtn && outreachPanel) {
          outreachToggleBtn.setAttribute("aria-expanded", "true");
          outreachPanel.removeAttribute("hidden");
        }
        var scriptCard = document.querySelector("[data-profile-outreach-script]");
        if (!scriptCard) {
          return;
        }
        scriptCard.scrollIntoView({ behavior: "smooth", block: "center" });
        window.setTimeout(function () {
          scriptCard.focus({ preventScroll: true });
        }, 220);
        trackFunnelEvent("profile_outreach_script_focused", getContactAnalyticsMeta(t, "script"));
      });
    });
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-copy-script]"))
    .forEach(function (button) {
      button.addEventListener("click", async function () {
        var message = String(outreachScript || "").trim();
        if (!message) {
          return;
        }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(message);
            button.textContent = "Copied first message";
            window.setTimeout(function () {
              button.textContent = "Copy first message";
            }, 1800);
          }
        } catch (_error) {
          button.textContent = "Copy manually below";
          window.setTimeout(function () {
            button.textContent = "Copy first message";
          }, 1800);
        }
        trackFunnelEvent("profile_outreach_script_copied", getContactAnalyticsMeta(t, "script"));
      });
    });
  var contactQuestionsCard = document.querySelector("[data-profile-contact-questions]");
  if (contactQuestionsCard) {
    contactQuestionsCard.addEventListener("click", function () {
      trackFunnelEvent(
        "profile_contact_questions_engaged",
        getContactAnalyticsMeta(t, "questions"),
      );
    });
  }
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-backup-link]"))
    .forEach(function (link) {
      link.addEventListener("click", function () {
        trackFunnelEvent("profile_backup_opened", {
          therapist_slug: t.slug || "",
          backup_slug: link.getAttribute("data-profile-backup-link") || "",
          source: profileSource || "profile",
        });
      });
    });
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-backup-compare]"))
    .forEach(function (link) {
      link.addEventListener("click", function () {
        trackFunnelEvent("profile_backup_compared", {
          therapist_slug: t.slug || "",
          source: profileSource || "profile",
        });
      });
    });
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-queue-outcome]"))
    .forEach(function (button) {
      button.addEventListener("click", function () {
        var outcome = button.getAttribute("data-profile-queue-outcome") || "";
        var saved = recordProfileOutreachOutcome(t, outcome);
        if (!saved) {
          return;
        }
        trackFunnelEvent("profile_queue_outcome_recorded", {
          therapist_slug: t.slug || "",
          source: profileSource || "profile",
          outcome: outcome,
        });
        updateShortlistAction(t.slug);
      });
    });
  // Sidebar Save toggle. Reads/writes through saved-list.js so the
  // button stays in sync with directory cards, results cards, and the
  // nav badge — and updates live if the same user saves from another
  // tab via the subscribe() callback.
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-side-save]"))
    .forEach(function (button) {
      var slug = button.getAttribute("data-save-id") || "";
      var label = button.querySelector(".profile-side-save-label");
      function paint(savedState) {
        button.classList.toggle("is-saved", savedState);
        button.setAttribute("aria-pressed", savedState ? "true" : "false");
        if (label) label.textContent = savedState ? "Saved" : "Save";
      }
      paint(slug && isSaved(slug));
      button.addEventListener("click", function () {
        if (!slug) return;
        toggleSaved(slug, { surface: "profile_sidebar" });
      });
      subscribe(function () {
        paint(slug && isSaved(slug));
      });
    });

  // Step 10: FAQ accordion. Clicking a closed item opens it and closes
  // siblings; clicking an open item closes it. The first item, when locked
  // open by accepting-new-patients, keeps its green check-circle icon.
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-faq-toggle]"))
    .forEach(function (button) {
      var item = button.closest("[data-profile-faq-item]");
      if (!item) return;
      var answer = item.querySelector(".profile-faq-a");
      var icon = button.querySelector("i");
      var locked = item.hasAttribute("data-faq-accept-locked");
      button.addEventListener("click", function () {
        var open = item.classList.contains("is-open");
        if (open) {
          item.classList.remove("is-open");
          if (answer) answer.hidden = true;
          button.setAttribute("aria-expanded", "false");
          if (icon && !locked) icon.className = "ti ti-chevron-down";
        } else {
          var siblings = item.parentNode
            ? item.parentNode.querySelectorAll("[data-profile-faq-item]")
            : [];
          Array.prototype.forEach.call(siblings, function (sib) {
            if (sib === item) return;
            sib.classList.remove("is-open");
            var sibAnswer = sib.querySelector(".profile-faq-a");
            var sibButton = sib.querySelector("[data-profile-faq-toggle]");
            var sibIcon = sibButton ? sibButton.querySelector("i") : null;
            var sibLocked = sib.hasAttribute("data-faq-accept-locked");
            if (sibAnswer) sibAnswer.hidden = true;
            if (sibButton) sibButton.setAttribute("aria-expanded", "false");
            if (sibIcon && !sibLocked) sibIcon.className = "ti ti-chevron-down";
          });
          item.classList.add("is-open");
          if (answer) answer.hidden = false;
          button.setAttribute("aria-expanded", "true");
          if (icon && !locked) icon.className = "ti ti-chevron-up";
        }
      });
    });

  // Step 9: copy-to-clipboard for the reach-out draft, and click-to-dial
  // for the inline call CTA.
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-copy-draft]"))
    .forEach(function (button) {
      var card = button.closest(".profile-reach-card");
      var msgEl = card ? card.querySelector("[data-profile-draft-text]") : null;
      var defaultLabel = button.innerHTML;
      button.addEventListener("click", function () {
        if (!msgEl) return;
        var text = msgEl.innerText || msgEl.textContent || "";
        var done = function () {
          button.classList.add("is-copied");
          button.innerHTML = '<i class="ti ti-check" aria-hidden="true"></i> Copied';
          window.setTimeout(function () {
            button.classList.remove("is-copied");
            button.innerHTML = defaultLabel;
          }, 2000);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, done);
        } else {
          done();
        }
      });
    });
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-call-cta]"))
    .forEach(function (button) {
      button.addEventListener("click", function () {
        var tel = button.getAttribute("data-tel");
        if (tel) window.location.href = "tel:" + tel;
      });
    });

  // Step 7: bio preview/full toggle. The new card renders a 280-char
  // preview <p> plus a hidden full bio block; clicking the button swaps
  // visibility and the button label.
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-bio-toggle]"))
    .forEach(function (button) {
      var block = button.closest("[data-profile-bio-block]");
      if (!block) return;
      var preview = block.querySelector("[data-profile-bio-preview]");
      var full = block.querySelector("[data-profile-bio-full]");
      button.addEventListener("click", function () {
        var expanded = button.getAttribute("aria-expanded") === "true";
        if (expanded) {
          if (full) full.hidden = true;
          if (preview) preview.hidden = false;
          button.textContent = "Read more →";
          button.setAttribute("aria-expanded", "false");
        } else {
          if (preview) preview.hidden = true;
          if (full) full.hidden = false;
          button.textContent = "Show less ←";
          button.setAttribute("aria-expanded", "true");
        }
      });
    });
  Array.prototype.slice
    .call(document.querySelectorAll(".profile-section-header"))
    .forEach(function (button) {
      button.addEventListener("click", function () {
        var section = button.closest("[data-profile-section]");
        var content = section ? section.querySelector(".profile-section-content") : null;
        var toggle = button.querySelector(".section-toggle");
        if (!content || !toggle) {
          return;
        }
        var collapsed = content.classList.toggle("is-collapsed");
        button.setAttribute("aria-expanded", collapsed ? "false" : "true");
        toggle.textContent = collapsed ? "Show" : "Hide";
      });
    });
  // FAQ accordion bindings
  Array.prototype.slice
    .call(document.querySelectorAll("[data-faq-toggle]"))
    .forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = btn.getAttribute("data-faq-toggle");
        var answer = document.getElementById("faq-answer-" + idx);
        if (!answer) return;
        var expanded = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", expanded ? "false" : "true");
        if (expanded) {
          answer.setAttribute("hidden", "");
        } else {
          answer.removeAttribute("hidden");
        }
        var icon = btn.querySelector(".faq-toggle-icon");
        if (icon) icon.textContent = expanded ? "+" : "−";
      });
    });

  if (typeof window.IntersectionObserver === "function") {
    var navLinks = Array.prototype.slice.call(document.querySelectorAll("[data-section-link]"));
    var sectionObserver = new window.IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) {
            return;
          }
          var id = entry.target.id;
          navLinks.forEach(function (link) {
            link.classList.toggle("is-active", link.getAttribute("data-section-link") === id);
          });
        });
      },
      {
        rootMargin: "-20% 0px -60% 0px",
        threshold: 0.1,
      },
    );
    Array.prototype.slice
      .call(document.querySelectorAll("[data-profile-section]"))
      .forEach(function (section) {
        sectionObserver.observe(section);
      });
  }
}
