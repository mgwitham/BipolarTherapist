import "./sentry-init.js";
import { fetchPublicTherapistBySlug, fetchPublicTherapists, getCmsState } from "./cms.js";
import { escapeHtml } from "./escape-html.js";
import { sanityImageUrl } from "./sanity-image.js";
import { getDataFreshnessSummary, getTherapistMatchReadiness } from "../shared/matching-model.mjs";
import { firstName as stripTitleFirstName } from "../shared/outreach-templates.mjs";
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
import { withReferralAttribution } from "../shared/contact-href.mjs";
import {
  submitMatchOutcome,
  submitTherapistCtaClick,
  submitTherapistProfileView,
} from "./review-api.js";
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
    const params = new URLSearchParams(window.location.search || "");
    const utmSource = (params.get("utm_source") || "").toLowerCase();
    if (utmSource === "email") {
      return "email";
    }
    if (utmSource === "directory") {
      return "directory";
    }
    if (utmSource === "match") {
      return "match";
    }
    const referrer = String(document.referrer || "").toLowerCase();
    if (!referrer) {
      return "direct";
    }
    const currentHost = (window.location.hostname || "").toLowerCase();
    if (currentHost && referrer.indexOf(currentHost) === -1) {
      return "search";
    }
    if (referrer.indexOf("/directory") !== -1) {
      return "directory";
    }
    // /results is the match flow's destination page, so arrivals from it
    // are match traffic — without this branch they were counted "direct".
    if (referrer.indexOf("/match") !== -1 || referrer.indexOf("/results") !== -1) {
      return "match";
    }
    return "direct";
  } catch (_error) {
    return "other";
  }
}

function recordProfileViewSafely(slug) {
  const cleanSlug = String(slug || "").trim();
  if (!cleanSlug) {
    return;
  }
  try {
    const promise = submitTherapistProfileView({
      therapist_slug: cleanSlug,
      source: detectProfileViewSource(),
    });
    if (promise && typeof promise.catch === "function") {
      promise.catch(function () {});
    }
  } catch (_error) {
    // Engagement pings are best-effort, never block page render.
  }
}

function recordCtaClickSafely(slug, route) {
  const cleanSlug = String(slug || "").trim();
  const cleanRoute = String(route || "").trim();
  if (!cleanSlug || !cleanRoute) {
    return;
  }
  try {
    const promise = submitTherapistCtaClick({
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

// Inline Tabler icon paths (official, from @tabler/icons). Rendered as inline
// SVG instead of the @tabler webfont: the webfont was loaded from a CDN the
// CSP no longer allows (so icons were silently broken in production), and a
// self-hosted webfont would ship ~450KB for ~12 glyphs. Inline SVG is a few
// hundred bytes, CSP-clean, and removes a render-blocking third-party request.
const TI_ICON_PATHS = {
  bookmark: '<path d="M18 7v14l-6 -4l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4" />',
  calendar:
    '<path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12" /><path d="M16 3v4" /><path d="M8 3v4" /><path d="M4 11h16" /><path d="M11 15h1" /><path d="M12 15v3" />',
  check: '<path d="M5 12l5 5l10 -10" />',
  "chevron-down": '<path d="M6 9l6 6l6 -6" />',
  "circle-check": '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /><path d="M9 12l2 2l4 -4" />',
  copy: '<path d="M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666" /><path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" />',
  mail: '<path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10" /><path d="M3 7l9 6l9 -6" />',
  "map-pin":
    '<path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /><path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0" />',
  phone:
    '<path d="M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2" />',
  "shield-check":
    '<path d="M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06" /><path d="M15 19l2 2l4 -4" />',
  world:
    '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path d="M3.6 9h16.8" /><path d="M3.6 15h16.8" /><path d="M11.5 3a17 17 0 0 0 0 18" /><path d="M12.5 3a17 17 0 0 1 0 18" />',
};

// Wrap the SVG in an <i> so the existing `.context i { ... }` icon styles
// (size, color, spacing) keep applying unchanged — only the glyph source
// changes from a webfont to inline SVG.
function tiSvg(name, extraClass) {
  const paths = TI_ICON_PATHS[name] || "";
  const cls = "ti-icon" + (extraClass ? " " + extraClass : "");
  return (
    '<i class="' +
    cls +
    '" aria-hidden="true"><svg class="ti-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    paths +
    "</svg></i>"
  );
}

function getSlugFromPath(pathname) {
  const match = String(pathname || "").match(/^\/therapists\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function buildTherapistProfileUrl(slugValue) {
  const cleanSlug = String(slugValue || "").trim();
  return cleanSlug
    ? `https://www.bipolartherapyhub.com/therapists/${encodeURIComponent(cleanSlug)}/`
    : "https://www.bipolartherapyhub.com/directory";
}

const profileParams = new URLSearchParams(window.location.search);
const slug = profileParams.get("slug") || getSlugFromPath(window.location.pathname);
const profileSource = profileParams.get("source") || "";

// Outreach-recipient attribution: when the profile is reached from an
// outreach email (?ref=outreach), fire a funnel event so the daily
// "clicked but didn't claim" digest can attribute the view. SessionStorage
// dedup prevents reload-spamming the log within a single browser session.
(function recordOutreachClickOnce() {
  if (profileParams.get("ref") !== "outreach") return;
  if (!slug) return;
  try {
    const key = "bth_outreach_click_logged:" + slug;
    if (window.sessionStorage && window.sessionStorage.getItem(key)) return;
    if (window.sessionStorage) window.sessionStorage.setItem(key, "1");
  } catch (_error) {
    // sessionStorage can throw in some private-mode contexts; fall
    // through and accept potential reload double-firing rather than
    // dropping the event entirely.
  }
  try {
    trackFunnelEvent("outreach_profile_viewed", { therapist_slug: slug });
  } catch (_error) {
    // Analytics is best-effort.
  }
})();
const OUTREACH_OUTCOMES_KEY = "bth_outreach_outcomes_v1";
const DIRECTORY_LIST_LIMIT = SAVED_LIST_MAX;
let activeTherapistContactExperimentVariant = "control";

// Strip everything but digits and + so tel: URIs work across iOS, Android,
// and VoIP dialers. iOS auto-normalizes "(805) 870-8901" but Android Auto
// and some VoIP softphones don't. Display value can keep formatting; the
// href should always be digits-only.
function normalizeTelUri(phone) {
  return String(phone || "").replace(/[^0-9+]/g, "");
}

// Pull the human-usable address/number back out of a mailto: or tel:
// href so the no-handler fallback can copy it to the clipboard. Strips
// any ?subject= query on mailto and returns "" for other schemes.
function contactValueFromHref(href) {
  const raw = String(href || "");
  if (/^mailto:/i.test(raw)) {
    const address = raw.replace(/^mailto:/i, "").split("?")[0];
    try {
      return decodeURIComponent(address);
    } catch (_error) {
      return address;
    }
  }
  if (/^tel:/i.test(raw)) {
    return raw.replace(/^tel:/i, "");
  }
  return "";
}

// Bottom-center status toast for the contact-CTA fallback. One shared
// element, re-used across clicks; role="status" so screen readers
// announce it without stealing focus. Auto-hides after a beat long
// enough to read an email address.
function showContactFallbackToast(message) {
  let toast = document.querySelector("[data-contact-fallback-toast]");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "profile-cta-toast";
    toast.setAttribute("data-contact-fallback-toast", "");
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showContactFallbackToast.hideTimer);
  showContactFallbackToast.hideTimer = window.setTimeout(function () {
    toast.classList.remove("is-visible");
  }, 8000);
}

function safeExternalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch (_error) {
    return "";
  }
}

// A therapist's own booking/website URL, tagged with hub referral attribution
// so a real click-through from this profile shows up as bipolartherapyhub.com
// in their analytics. Pairs with rel="noopener" (referrer preserved) on the
// anchors. Only for practice/booking links — never photos.
function outboundSiteUrl(value) {
  return withReferralAttribution(safeExternalUrl(value), { campaign: "profile" });
}

// ─── Hero avatar (initial render + background photo refresh) ───────────
// Hash on slug so a clinician's avatar tone stays stable across visits.
const HERO_AVATAR_TONE_COUNT = 6;
function heroAvatarTone(slug, name) {
  const key = String(slug || name || "");
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash % HERO_AVATAR_TONE_COUNT;
}
function heroInitials(name) {
  const titlePrefix = /^(dr|mr|mrs|ms|mx|prof)\.?$/i;
  const parts = String(name || "")
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
function buildHeroAvatarHtml(t) {
  const heroPhotoUrl = safeExternalUrl(t.photo_url);
  return heroPhotoUrl
    ? '<img src="' +
        escapeHtml(sanityImageUrl(heroPhotoUrl, { width: 144, height: 144 })) +
        '" alt="" width="72" height="72" class="profile-hero-avatar" fetchpriority="high" decoding="async" />'
    : '<span class="profile-hero-avatar profile-hero-avatar--tone-' +
        heroAvatarTone(t.slug, t.name) +
        '">' +
        escapeHtml(heroInitials(t.name)) +
        "</span>";
}

// Per-therapist SEO: update/insert meta tags + Schema.org JSON-LD so
// each /therapists/X/ has unique title, description, OG tags,
// and structured data. Injected client-side after the therapist fetch
// resolves, Google's crawler executes JS and picks these up.
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
  const name = t.name || "Bipolar therapist";
  const credentials = t.credentials ? ", " + t.credentials : "";
  const location = [t.city, t.state].filter(Boolean).join(", ") || "California";
  const parts = [];
  parts.push(name + credentials + ", bipolar disorder specialist in " + location + ".");
  if (t.accepting_new_patients) parts.push("Accepting new patients.");
  const formats = [];
  if (t.accepts_telehealth) formats.push("telehealth");
  if (t.accepts_in_person) formats.push("in-person");
  if (formats.length) parts.push("Offers " + formats.join(" & ") + ".");
  if (t.session_fee_min) {
    const feeStr =
      "$" +
      t.session_fee_min +
      (t.session_fee_max && t.session_fee_max !== t.session_fee_min
        ? "–$" + t.session_fee_max
        : "") +
      "/session";
    parts.push("Fee: " + feeStr + (t.sliding_scale ? " (sliding scale)." : "."));
  }
  const insurance = (t.insurance_accepted || []).filter(Boolean);
  if (insurance.length)
    parts.push(
      "Accepts " + insurance.slice(0, 3).join(", ") + (insurance.length > 3 ? " & more." : "."),
    );
  const result = parts.join(" ");
  return result.length > 158 ? result.slice(0, 155) + "…" : result;
}

const ZIP_GEO = {
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
  const name = t.name || "";
  const credentials = t.credentials || "";
  const nameWithCreds = credentials ? name + ", " + credentials : name;
  const pageUrl = buildTherapistProfileUrl(t.slug || "");
  const address = {
    "@type": "PostalAddress",
    addressLocality: t.city || undefined,
    addressRegion: t.state || "CA",
    postalCode: t.zip || undefined,
    addressCountry: "US",
  };
  // Plain-text description for JSON-LD. Strip HTML tags by repeating the
  // replacement until the string stops changing, so a single pass can't leave
  // a tag behind (e.g. "<scr<script>ipt>"). The sink is textContent, so this
  // is defense-in-depth.
  let bioStripped = t.bio || "";
  let bioPrev;
  do {
    bioPrev = bioStripped;
    bioStripped = bioStripped.replace(/<[^>]*>/g, "");
  } while (bioStripped !== bioPrev);
  const rawBio = bioStripped.trim();
  const bioDescription = rawBio
    ? rawBio.length > 160
      ? rawBio.slice(0, 160) + "..."
      : rawBio
    : undefined;
  const sameAsLinks = [];
  if (t.license_number) {
    sameAsLinks.push(
      "https://search.dca.ca.gov/results#/advanced?licenseNumber=" +
        encodeURIComponent(t.license_number),
    );
  }
  const photoUrl = safeExternalUrl(t.photo_url);
  const person = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: nameWithCreds,
    url: pageUrl,
    jobTitle: t.title || "Therapist",
    knowsAbout: ["Bipolar disorder", "Psychotherapy", "Mental health"],
    address: address,
    description: bioDescription,
    image: photoUrl || undefined,
    telephone: t.phone || undefined,
    email: t.email || undefined,
    sameAs: sameAsLinks.length > 0 ? sameAsLinks : undefined,
  };
  const insurance = (t.insurance_accepted || []).filter(Boolean);
  const serviceChannels = [];
  if (t.accepts_telehealth) {
    serviceChannels.push({
      "@type": "ServiceChannel",
      serviceType: "Telehealth",
      availableLanguage: { "@type": "Language", name: "English" },
    });
  }
  const zipCoords = ZIP_GEO[t.zip];
  const medicalBusiness = {
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
  const breadcrumb = {
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
  const faqItems = buildFAQItems(t);
  const faqSchema = {
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
  const seoTitle = `${name}${credentials}, Bipolar Therapist in ${location}`;
  const seoDescription = buildTherapistSeoDescription(t);
  const canonicalUrl = buildTherapistProfileUrl(t.slug || "");

  document.title = `${seoTitle}, BipolarTherapyHub`;
  upsertMeta("name", "description", seoDescription);
  upsertLinkRel("canonical", canonicalUrl);

  // Open Graph + Twitter
  upsertMeta("property", "og:type", "website");
  upsertMeta("property", "og:site_name", "BipolarTherapyHub");
  upsertMeta("property", "og:url", canonicalUrl);
  upsertMeta("property", "og:title", seoTitle);
  upsertMeta("property", "og:description", seoDescription);
  const photoUrl = safeExternalUrl(t.photo_url);
  if (photoUrl) {
    upsertMeta("property", "og:image", photoUrl);
  }
  upsertMeta("name", "twitter:card", "summary");
  upsertMeta("name", "twitter:title", seoTitle);
  upsertMeta("name", "twitter:description", seoDescription);

  // JSON-LD structured data, remove previous instances, then inject one tag per schema
  try {
    ["therapist-jsonld", "therapist-jsonld-breadcrumb", "therapist-jsonld-faq"].forEach(
      function (id) {
        const el = document.getElementById(id);
        if (el) el.remove();
      },
    );
    const schemas = buildTherapistJsonLd(t);
    const ids = [
      "therapist-jsonld",
      "therapist-jsonld-business",
      "therapist-jsonld-breadcrumb",
      "therapist-jsonld-faq",
    ];
    schemas.forEach(function (schema, i) {
      const script = document.createElement("script");
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
  const name = t.name || "This therapist";
  const first = stripTitleFirstName(t.name, "They");
  const phone = t.phone || null;
  const website = t.website || t.booking_url || null;
  let contactPath = [phone ? "calling " + phone : null, website ? "visiting their website" : null]
    .filter(Boolean)
    .join(" or ");
  if (!contactPath) contactPath = "using the contact details on this page";

  const insurance = (t.insurance_accepted || []).filter(Boolean);
  const fee_min = t.session_fee_min;
  const fee_max = t.session_fee_max;
  const sliding = t.sliding_scale;
  const telehealth = Boolean(t.accepts_telehealth);
  const inPerson = Boolean(t.accepts_in_person);
  const modalities = (t.treatment_modalities || []).filter(Boolean);
  const accepting = Boolean(t.accepting_new_patients);
  const city = t.city || "their area";

  const items = [];

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
        ". Coverage for therapy varies by plan and deductible, confirm your specific benefits directly with " +
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
    const feeRange =
      fee_max && fee_max !== fee_min ? "$" + fee_min + "–$" + fee_max : "$" + fee_min;
    const feeAnswer =
      first +
      "'s session fee is " +
      feeRange +
      "/session." +
      (sliding
        ? " A sliding scale fee is available for qualifying clients, ask about it when you reach out."
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
  const modalityNote =
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
  const phone = t.phone || null;
  const email = t.email && t.email !== "contact@example.com" ? t.email : "";
  const website = outboundSiteUrl(t.website) || outboundSiteUrl(t.booking_url);
  const phoneDigits = phone ? phone.replace(/[^0-9+]/g, "") : null;
  const fee_min = t.session_fee_min;
  const fee_max = t.session_fee_max;
  const feeLabel = fee_min
    ? "$" + fee_min + (fee_max && fee_max !== fee_min ? "–$" + fee_max : "") + "/session"
    : null;
  const pref = String(t.preferred_contact_method || "")
    .trim()
    .toLowerCase();

  if (!phone && !email && !website) return "";

  // Primary CTA respects preferred_contact_method (email / phone /
  // booking / website). Falls back to phone-then-email when no
  // preference is set or the preferred channel is missing.
  const firstNameForLabel = (function () {
    const titlePrefix = /^(dr|mr|mrs|ms|mx|prof)\.?$/i;
    const words = String(t.name || "")
      .split(/\s+/)
      .filter(Boolean)
      .filter(function (w) {
        return !titlePrefix.test(w);
      });
    return words[0] || "";
  })();
  const bookingUrl = outboundSiteUrl(t.booking_url);
  let primaryHtml = "";
  function emailPrimary() {
    return (
      '<a href="mailto:' +
      escapeHtml(email) +
      '" class="mobile-sticky-cta" data-profile-contact-route="email" data-profile-contact-priority="primary">Email' +
      (firstNameForLabel ? " " + escapeHtml(firstNameForLabel) : "") +
      "</a>"
    );
  }
  function phonePrimary() {
    return (
      '<a href="tel:' +
      escapeHtml(phoneDigits) +
      '" class="mobile-sticky-cta" data-profile-contact-route="phone" data-profile-contact-priority="primary">Call ' +
      escapeHtml(phone) +
      "</a>"
    );
  }
  if (pref === "email" && email) {
    primaryHtml = emailPrimary();
  } else if (pref === "phone" && phone && phoneDigits) {
    primaryHtml = phonePrimary();
  } else if ((pref === "booking" || pref === "booking_url") && bookingUrl) {
    primaryHtml =
      '<a href="' +
      escapeHtml(bookingUrl) +
      '" target="_blank" rel="noopener" class="mobile-sticky-cta" data-profile-contact-route="booking" data-profile-contact-priority="primary">Book</a>';
  } else if (pref === "website" && website) {
    primaryHtml =
      '<a href="' +
      escapeHtml(website) +
      '" target="_blank" rel="noopener" class="mobile-sticky-cta" data-profile-contact-route="website" data-profile-contact-priority="primary">Visit website</a>';
  } else if (phone && phoneDigits) {
    primaryHtml = phonePrimary();
  } else if (email) {
    primaryHtml = emailPrimary();
  }

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
    primaryHtml +
    (website
      ? '<a href="' +
        escapeHtml(website) +
        '" target="_blank" rel="noopener" class="mobile-sticky-secondary" data-profile-contact-route="website" data-profile-contact-priority="secondary">Website</a>'
      : "") +
    "</div>" +
    "</div>" +
    "</div>"
  );
}

function getFirstMeaningfulSentence(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const match = text.match(/^.*?[.!?](?:\s|$)/);
  return match ? match[0].trim() : text;
}

function getContactStrategy(
  therapist,
  responsivenessSignal,
  routePerformance,
  routeOutcomePerformance,
) {
  const bookingHealthy = isBookingRouteHealthy(therapist);
  const websiteHealthy = isWebsiteRouteHealthy(therapist);
  let suppressedRouteNote = "";
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
  let route = "profile";
  let routeLabel = "Use the clearest listed contact path";
  let routeReason = websiteHealthy
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

  const outcomeRoute =
    routeOutcomePerformance &&
    routeOutcomePerformance.top_route &&
    routeOutcomePerformance.confidence !== "none" &&
    routeOutcomePerformance.top_route.route &&
    routeOutcomePerformance.top_route.route !== "unknown"
      ? routeOutcomePerformance.top_route.route
      : "";
  const performanceRoute =
    routePerformance &&
    routePerformance.top_route &&
    routePerformance.confidence !== "none" &&
    routePerformance.top_route.route &&
    routePerformance.top_route.route !== "unknown"
      ? routePerformance.top_route.route
      : "";
  const performanceRouteAvailable =
    (performanceRoute === "booking" && therapist.booking_url && bookingHealthy) ||
    (performanceRoute === "website" && therapist.website && websiteHealthy) ||
    (performanceRoute === "phone" && therapist.phone) ||
    (performanceRoute === "email" && therapist.email && therapist.email !== "contact@example.com");

  const outcomeRouteAvailable =
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

  let replyWindowCopy = therapist.estimated_wait_time
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

  const followUpCopy =
    route === "phone"
      ? "If you reach voicemail, leave one concise message and try one more call in 2 to 3 business days."
      : route === "booking"
        ? "If the booking link does not lead to a real opening, switch to phone or email within 1 to 2 business days."
        : route === "email"
          ? "If there is no response after 2 business days, send one short follow-up and then move to the next route."
          : "If you do not hear back after 2 to 3 business days, follow up once or switch to a more direct route.";

  const backupPlanCopy =
    therapist.phone && route !== "phone"
      ? "If this stalls, call the practice next and ask whether they are still taking new bipolar-care inquiries."
      : therapist.email && therapist.email !== "contact@example.com" && route !== "email"
        ? "If this stalls, send a short email with your fit question and availability question together."
        : therapist.website && websiteHealthy && route !== "website"
          ? "If this stalls, use the website contact form as a second route before moving on."
          : "If this stalls after one follow-up, move on to your next saved option instead of waiting indefinitely.";

  let confidenceLabel = "Based on profile details";
  let confidenceNote =
    "This recommendation is based on the contact routes and practical details listed on the profile.";
  let confidenceTone = "profile";
  let proofLine = "";

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
  const shortlist = readShortlist();
  const slugs = shortlist
    .map(function (item) {
      return item.slug;
    })
    .filter(Boolean);
  if (!slugs.length) {
    return "match.html";
  }

  const params = new URLSearchParams();
  params.set("shortlist", slugs.join(","));
  params.set("entry", "directory_shortlist_queue");
  if (focusSlug) {
    params.set("focus", focusSlug);
  }
  return "match.html?" + params.toString();
}

function buildShortlistCompareUrl() {
  const shortlist = readShortlist();
  const slugs = shortlist
    .map(function (item) {
      return item.slug;
    })
    .filter(Boolean);
  if (!slugs.length) {
    return "match.html";
  }

  const params = new URLSearchParams();
  params.set("shortlist", slugs.join(","));
  return "match.html?" + params.toString();
}

function formatSavedOutcomeLabel(outcome) {
  const labels = {
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

  const shortlist = readShortlist();
  const shortlistSlugs = shortlist
    .map(function (item) {
      return item.slug;
    })
    .filter(Boolean)
    .slice(0, DIRECTORY_LIST_LIMIT);
  const existing = readOutreachOutcomes();
  const now = new Date().toISOString();
  const entryIndex = shortlistSlugs.indexOf(therapist.slug);

  const entry = {
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
  };
  existing.unshift(entry);

  try {
    window.localStorage.setItem(OUTREACH_OUTCOMES_KEY, JSON.stringify(existing.slice(0, 150)));
  } catch (_error) {
    return null;
  }

  // Mirror the outcome to the Review API so the outreach funnel
  // (reached_out → booked_consult) is queryable as durable history, not
  // just this browser's 7-day localStorage cache. Fire-and-forget: a
  // failed POST must never block the local UI update. The server reuses
  // the same snake_case shape via normalizePortableMatchOutcome.
  submitMatchOutcome(entry).catch(function () {});

  return getLatestOutreachOutcomeForSlug(therapist.slug);
}

function buildProfileOutreachQueueState(slugValue) {
  const shortlist = readShortlist();
  const shortlistEntry = shortlist.find(function (item) {
    return item.slug === slugValue;
  });
  const latestOutcome = getLatestOutreachOutcomeForSlug(slugValue);
  const queueUrl = buildOutreachQueueUrl(slugValue);

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
  const normalized = String(value || "").toLowerCase();
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
  const shortlist = readShortlist();
  const backupSignals = summarizeProfileBackupSignals(
    readFunnelEvents(),
    currentTherapist && currentTherapist.slug,
  );
  if (!currentTherapist || !shortlist.length) {
    return null;
  }

  const alternatives = shortlist
    .filter(function (item) {
      return item.slug !== currentTherapist.slug;
    })
    .map(function (item) {
      const therapist = (therapistDirectory || []).find(function (candidate) {
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

  const backup = alternatives[0] || null;
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
  const shortlistEntry = readShortlist().find(function (item) {
    return item.slug === slugValue;
  });
  if (!shortlistEntry) {
    return null;
  }

  const latestOutcome = getLatestOutreachOutcomeForSlug(slugValue);
  const changedCopy = latestOutcome
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
  const actions = Array.isArray(queueState && queueState.actions) ? queueState.actions : [];
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
  const wasSaved = isSavedSlug(slugValue);
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
  const noteMeta = document.getElementById("profileShortlistNoteMeta");
  if (!noteMeta) {
    return;
  }
  const length = String(currentValue || "").trim().length;
  noteMeta.textContent = length
    ? length + "/120 characters"
    : "Keep this to one sharp reminder for future-you.";
}

function updateShortlistAction(slugValue) {
  const buttons = Array.prototype.slice.call(
    document.querySelectorAll("[data-shortlist-trigger='profile']"),
  );
  const status = document.getElementById("profileShortlistStatus");
  const decisionMemory = document.getElementById("profileDecisionMemory");
  const queueStatus = document.getElementById("profileQueueStatus");
  if (!buttons.length) {
    return;
  }

  const shortlistEntry = readShortlist().find(function (item) {
    return item.slug === slugValue;
  });
  const shortlisted = !!shortlistEntry;
  // Update the .profile-save-btn-label span if present (keeps the icon
  // intact); otherwise update textContent for the legacy plain button.
  buttons.forEach(function (button) {
    const label = button.querySelector(".profile-save-btn-label");
    const icon = button.querySelector(".profile-save-btn-icon");
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
    const memoryState = buildProfileDecisionMemoryState(slugValue);
    decisionMemory.innerHTML = renderDecisionMemoryCard(memoryState);
  }

  if (queueStatus) {
    const queueState = buildProfileOutreachQueueState(slugValue);
    queueStatus.innerHTML = renderQueueStatusCard(queueState);
  }

  const priorityWrap = document.getElementById("profileShortlistPriorityWrap");
  const prioritySelect = document.getElementById("profileShortlistPriority");
  const noteInput = document.getElementById("profileShortlistNote");
  if (priorityWrap && prioritySelect && noteInput) {
    priorityWrap.style.display = shortlisted ? "block" : "none";
    prioritySelect.value = shortlistEntry ? shortlistEntry.priority : "";
    noteInput.value = shortlistEntry ? shortlistEntry.note : "";
    updateShortlistNoteMeta(noteInput.value);
  }
}

function readEmbeddedTherapistData() {
  try {
    const el = document.getElementById("therapistData");
    if (!el) return null;
    return JSON.parse(el.textContent || "null");
  } catch (_error) {
    return null;
  }
}

async function resolveTherapistForProfile(slugValue, therapistDirectoryPromise) {
  const exact = await fetchPublicTherapistBySlug(slugValue);
  if (exact) {
    return exact;
  }

  const normalizedSlug = String(slugValue || "")
    .trim()
    .toLowerCase();
  if (!normalizedSlug) {
    return null;
  }

  const therapists = therapistDirectoryPromise
    ? await therapistDirectoryPromise
    : await fetchPublicTherapists();
  return (
    therapists.find(function (item) {
      const itemSlug = String((item && item.slug) || "").toLowerCase();
      return itemSlug === normalizedSlug || itemSlug.indexOf(normalizedSlug + "-") === 0;
    }) || null
  );
}

// Prerendered profile pages embed the therapist payload at build time, so a
// headshot published (or removed via opt-out) after the last deploy never
// reaches the embedded JSON — the directory always fetches live data, which
// is how the two pages drift apart. After rendering instantly from the
// embedded payload, re-fetch the live record and swap the hero avatar in
// place when the photo changed, in either direction: newly published photos
// appear, opted-out photos disappear, both without waiting for a redeploy.
async function refreshHeroPhotoFromLiveData(rendered) {
  try {
    const fresh = await fetchPublicTherapistBySlug(rendered.slug);
    // Only trust a payload that actually came from the live API — the
    // fetch falls back to seed data on failure, and acting on that
    // would wrongly strip a real photo.
    if (!fresh || getCmsState().source !== "sanity") {
      return;
    }
    if (safeExternalUrl(fresh.photo_url) === safeExternalUrl(rendered.photo_url)) {
      return;
    }
    const avatar = document.querySelector("#profileWrap .profile-hero-avatar");
    if (!avatar) {
      return;
    }
    const holder = document.createElement("div");
    holder.innerHTML = buildHeroAvatarHtml(fresh);
    if (holder.firstElementChild) {
      avatar.replaceWith(holder.firstElementChild);
    }
  } catch (_error) {
    // Keep the embedded rendering; the refresh is best-effort.
  }
}

(async function init() {
  const wrap = document.getElementById("profileWrap");
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

    // The prerendered page embeds the full public-API therapist payload in a
    // <script type="application/json" id="therapistData"> block (CSP-safe, as
    // the strict CSP forbids inline executable scripts). Reading it lets us
    // render without a /api/public round-trip — the main profile LCP cost on
    // mobile. Falls back to the legacy window.__THERAPIST_DATA__ (SSR route)
    // and then to the network fetch if neither is present.
    const ssrData = readEmbeddedTherapistData() || window.__THERAPIST_DATA__;
    const therapistDirectoryPromise = fetchPublicTherapists();
    const usedEmbeddedData = Boolean(ssrData && ssrData.slug === slug);
    const therapist = usedEmbeddedData
      ? ssrData
      : await resolveTherapistForProfile(slug, therapistDirectoryPromise);
    const therapistDirectory = await therapistDirectoryPromise;
    if (!therapist) {
      wrap.innerHTML =
        '<div class="not-found"><h2>This profile is not available right now</h2><p>The link may be out of date, or the therapist may no longer be listed. You can return to the directory to compare other bipolar informed options.</p><a href="/directory" class="back-link">← Back to Directory</a></div>';
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
    if (usedEmbeddedData) {
      refreshHeroPhotoFromLiveData(therapist);
    }
  } catch (error) {
    console.error("Therapist profile failed to load.", error);
    wrap.innerHTML =
      '<div class="not-found"><h2>We could not load this profile</h2><p>Something went wrong while opening the therapist page. Please go back to the directory and try again.</p><a href="/directory" class="back-link">← Back to Directory</a></div>';
    const breadcrumbName = document.getElementById("breadcrumbName");
    if (breadcrumbName) {
      breadcrumbName.textContent = "Profile unavailable";
    }
    reveal();
  }
})();

function bindReportIssueDialog(therapist) {
  const dialog = document.getElementById("reportIssueDialog");
  const trigger = document.getElementById("profileReportIssueBtn");
  if (!dialog || !trigger || typeof dialog.showModal !== "function") return;

  const form = document.getElementById("reportIssueForm");
  const closeBtn = document.getElementById("reportIssueClose");
  const cancelBtn = document.getElementById("reportIssueCancel");
  const thanks = document.getElementById("reportIssueThanks");
  const commentInput = document.getElementById("reportIssueComment");

  if (trigger.dataset.reportBound === "true") return;
  trigger.dataset.reportBound = "true";

  trigger.addEventListener("click", function () {
    if (thanks) thanks.hidden = true;
    if (form) form.querySelectorAll(".report-issue-form-controls").forEach(function () {});
    const fieldsetEl = form ? form.querySelector(".report-issue-reasons") : null;
    const commentEl = commentInput;
    const actionsEl = form ? form.querySelector(".report-issue-actions") : null;
    if (fieldsetEl) fieldsetEl.hidden = false;
    if (commentEl) {
      commentEl.hidden = false;
      commentEl.value = "";
    }
    if (actionsEl) actionsEl.hidden = false;
    const checked = form ? form.querySelectorAll('input[name="reportReason"]:checked') : [];
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
    const reasonEl = form.querySelector('input[name="reportReason"]:checked');
    if (!reasonEl) return;
    const reason = reasonEl.value;
    const commentRaw = commentInput ? String(commentInput.value || "").trim() : "";
    const comment = commentRaw.length > 400 ? commentRaw.slice(0, 400) : commentRaw;
    // Identify the listing by slug only — the name is a person's name and
    // this payload is forwarded to third-party analytics (Vercel).
    trackFunnelEvent("listing_issue_reported", {
      slug: (therapist && therapist.slug) || "",
      reason: reason,
      comment: comment,
      has_comment: Boolean(comment),
    });
    const fieldsetEl = form.querySelector(".report-issue-reasons");
    const actionsEl = form.querySelector(".report-issue-actions");
    if (fieldsetEl) fieldsetEl.hidden = true;
    if (commentInput) commentInput.hidden = true;
    if (actionsEl) actionsEl.hidden = true;
    if (thanks) thanks.hidden = false;
    window.setTimeout(closeDialog, 1800);
  });
}

function renderProfile(t, therapistDirectory) {
  const readiness = getTherapistMatchReadiness(t);
  const freshness = getDataFreshnessSummary(t);
  const responsivenessSignal = getPublicResponsivenessSignal(t);
  const routePerformance = summarizeTherapistContactRoutePerformance(readFunnelEvents(), t.slug);
  const routeOutcomePerformance = summarizeTherapistContactRouteOutcomes(t);
  const backupState = buildProfileBackupState(t, therapistDirectory || []);
  trackDirectoryProfileOpenQuality(t, readiness, freshness);
  document.title = t.name + ", BipolarTherapyHub";
  applyTherapistSeo(t);
  document.getElementById("breadcrumbName").textContent = t.name;
  if (new URLSearchParams(window.location.search).get("ref") === "match") {
    const breadcrumbDirLink = document.getElementById("breadcrumbDirectoryLink");
    if (breadcrumbDirLink) {
      breadcrumbDirLink.textContent = "Your matches";
      let savedMatchUrl;
      try {
        savedMatchUrl = window.sessionStorage.getItem("matchResultsUrl");
      } catch (_) {}
      breadcrumbDirLink.href = savedMatchUrl || "/results";
    }
  }
  // navClaimLink was removed from the nav (moved into heroClaimLink
  // banner). Keep the lookup for back-compat in case an older template
  // variant still renders it.
  const navClaimLink = document.getElementById("navClaimLink");
  const heroClaimLink = document.getElementById("heroClaimLink");
  const footerClaimLink = document.getElementById("footerClaimLink");
  const claimHref = "/claim?confirm=" + encodeURIComponent(t.slug);
  if (navClaimLink) {
    navClaimLink.href = claimHref;
  }
  if (heroClaimLink) {
    heroClaimLink.href = claimHref;
  }
  if (footerClaimLink) {
    footerClaimLink.href = claimHref;
  }

  // In-page claim banner. Hidden by default in markup; only shown when
  // the viewer arrived from an outreach email (?ref=outreach), AND the
  // profile isn't already claimed. Organic visitors don't see it, the
  // banner is targeted to the specific therapist we sent an email to,
  // not a general claim CTA on every profile.
  const claimBanner = document.getElementById("inPageClaimBanner");
  const claimStatus = String(t.claim_status || t.claimStatus || "unclaimed").toLowerCase();
  let fromOutreach = false;
  try {
    fromOutreach = new URLSearchParams(window.location.search).get("ref") === "outreach";
  } catch (_err) {
    fromOutreach = false;
  }
  if (claimBanner) {
    if (fromOutreach && claimStatus !== "claimed") {
      claimBanner.removeAttribute("hidden");
      claimBanner.classList.add("is-outreach");
      const headlineEl = document.getElementById("claimBannerHeadline");
      if (headlineEl) headlineEl.textContent = "This is your profile.";
    } else {
      claimBanner.setAttribute("hidden", "");
    }
  }

  function isRealEmail(email) {
    const value = String(email || "").trim();
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

  const bipolarYears = Number(t.bipolar_years_experience || 0);

  let contactBtns = "";
  const primaryContactLabel = String(t.preferred_contact_label || "").trim();
  const therapistFirstName = (function () {
    const titlePrefix = /^(dr|mr|mrs|ms|mx|prof)\.?$/i;
    const words = String(t.name || "")
      .split(/\s+/)
      .filter(Boolean)
      .filter(function (w) {
        return !titlePrefix.test(w);
      });
    return words[0] || t.name || "this therapist";
  })();
  const firstStepExpectation = String(t.first_step_expectation || "").trim();
  const contactQuestionItems = [];
  const bookingUrl = outboundSiteUrl(t.booking_url);
  const websiteUrl = outboundSiteUrl(t.website);
  const bookingHealthy = Boolean(bookingUrl) && isBookingRouteHealthy(t);
  const websiteHealthy = Boolean(websiteUrl) && isWebsiteRouteHealthy(t);
  function buildPreferredContactButton() {
    if (t.preferred_contact_method === "booking" && bookingUrl && bookingHealthy) {
      return (
        '<a href="' +
        escapeHtml(bookingUrl) +
        '" target="_blank" rel="noopener" class="btn-contact" data-profile-contact-route="booking" data-profile-contact-priority="primary">' +
        escapeHtml(primaryContactLabel || "Book consultation") +
        "</a>"
      );
    }
    if (t.preferred_contact_method === "website" && websiteUrl && websiteHealthy) {
      return (
        '<a href="' +
        escapeHtml(websiteUrl) +
        '" target="_blank" rel="noopener" class="btn-contact" data-profile-contact-route="website" data-profile-contact-priority="primary">' +
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
    if (bookingUrl && bookingHealthy) {
      return (
        '<a href="' +
        escapeHtml(bookingUrl) +
        '" target="_blank" rel="noopener" class="btn-contact" data-profile-contact-route="booking" data-profile-contact-priority="primary">Book a consultation →</a>'
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
  if (websiteUrl && websiteHealthy && t.preferred_contact_method !== "website") {
    contactBtns +=
      '<a href="' +
      escapeHtml(websiteUrl) +
      '" target="_blank" rel="noopener" class="btn-website" data-profile-contact-route="website" data-profile-contact-priority="secondary">Visit website</a>';
  }
  if (bookingUrl && bookingHealthy && t.preferred_contact_method !== "booking") {
    contactBtns +=
      '<a href="' +
      escapeHtml(bookingUrl) +
      '" target="_blank" rel="noopener" class="btn-website" data-profile-contact-route="booking" data-profile-contact-priority="secondary">Booking link</a>';
  }

  const bestNextStepCopy =
    firstStepExpectation ||
    (t.preferred_contact_method === "email"
      ? "Most therapists respond within 1–2 business days."
      : t.preferred_contact_method === "website"
        ? "You'll find a contact form or booking link on their site."
        : "After first contact, the next step is usually a brief fit conversation or intake review before a full appointment is scheduled.");
  const contactStrategy = getContactStrategy(
    t,
    responsivenessSignal,
    routePerformance,
    routeOutcomePerformance,
  );
  const outreachScript = buildOutreachScript(t, contactStrategy);
  const primaryButton = buildPreferredContactButton();

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

  const contactMessageOpener =
    getFirstMeaningfulSentence(outreachScript) ||
    "Lead with one calm sentence about the kind of bipolar-focused help you want.";
  const contactQuestionPreview = contactQuestionItems.slice(0, 2).join(" ");
  const consultConfirmItems = [];

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

  const consultConfirmPreview = consultConfirmItems.slice(0, 2).join(" ");
  const contactPrepCardsHtml = [
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
  let secondaryButtons =
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
  if (websiteUrl && websiteHealthy && t.preferred_contact_method !== "website") {
    secondaryButtons +=
      '<a href="' +
      escapeHtml(websiteUrl) +
      '" target="_blank" rel="noopener" class="btn-website">Visit website</a>';
  }
  if (bookingUrl && bookingHealthy && t.preferred_contact_method !== "booking") {
    secondaryButtons +=
      '<a href="' +
      escapeHtml(bookingUrl) +
      '" target="_blank" rel="noopener" class="btn-website">Booking link</a>';
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
  // published therapist doc and render to patients as "Pending,
  // completed after approval." Treat them as empty.
  const INTAKE_STUBS = [
    "Pending",
    "Pending, completed after approval.",
    "Pending - completed after approval.",
  ];
  function stripIntakeStub(value) {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return INTAKE_STUBS.indexOf(trimmed) !== -1 ? "" : value;
  }

  // Strip scraped directory prefix: "Name, Credential, City, State, ZIP, Phone, actual bio"
  // Anchors on the phone number, everything up through it is metadata, not bio copy.
  const SCRAPED_PREFIX_RE = /^.+,\s*\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4},?\s+/;
  function stripScrapedPrefix(value) {
    if (typeof value !== "string") return value;
    const cleaned = value.replace(SCRAPED_PREFIX_RE, "");
    return cleaned.length < value.length ? cleaned : value;
  }

  const scrubbedBio = stripScrapedPrefix(stripIntakeStub(t.bio));

  const backNavRef = new URLSearchParams(window.location.search).get("ref") || "";
  let backNavSavedUrl;
  try {
    backNavSavedUrl = window.sessionStorage.getItem("matchResultsUrl");
  } catch (_) {}
  const backNav =
    backNavRef === "match"
      ? { href: backNavSavedUrl || "/results", label: "← Back to your matches" }
      : { href: "/directory", label: "← Back to directory" };

  // ─── Hero card (Step 5 redesign) ───────────────────────────────────────
  const heroAvatarHtml = buildHeroAvatarHtml(t);

  // A profile earns the stronger "Bipolar specialist" label when it has any
  // years treating bipolar on file, or lists bipolar among its specialties.
  // Otherwise it falls back to the generic "Bipolar-informed profile" badge.
  const isBipolarSpecialist =
    bipolarYears >= 1 ||
    (Array.isArray(t.specialties) &&
      t.specialties.some(function (s) {
        return /bipolar/i.test(String(s || ""));
      }));
  const isLicenseVerified =
    t.verification_status === "editorially_verified" && Boolean(t.license_number);

  const heroStatusRow =
    '<div class="profile-hero-status">' +
    (isBipolarSpecialist
      ? '<span class="profile-hero-badge profile-hero-badge--bp">Bipolar specialist</span>'
      : '<span class="profile-hero-badge profile-hero-badge--bp">Bipolar-informed profile</span>') +
    (isLicenseVerified
      ? '<span class="profile-hero-badge profile-hero-badge--verified">License verified</span>'
      : "") +
    (t.accepting_new_patients === true
      ? '<span class="profile-hero-badge profile-hero-badge--accepting">Accepting new patients</span>'
      : t.accepting_new_patients === false
        ? '<span class="profile-hero-badge profile-hero-badge--closed">Not currently accepting</span>'
        : "") +
    "</div>";

  // The single fastest trust signal: verbatim language from the clinician's
  // own site proving bipolar specialization, rendered as a hero pull-quote.
  // Degrades to nothing when the field is absent (older published profiles).
  const heroEvidenceQuote = String(t.bipolar_evidence_quote || "").trim();
  let heroEvidenceHtml = "";
  if (heroEvidenceQuote) {
    heroEvidenceHtml =
      '<figure class="profile-hero-evidence">' +
      '<blockquote class="profile-hero-evidence-quote">' +
      escapeHtml(heroEvidenceQuote) +
      "</blockquote>" +
      '<figcaption class="profile-hero-evidence-cite">From ' +
      escapeHtml(therapistFirstName) +
      "&rsquo;s practice site</figcaption>" +
      "</figure>";
  }

  const heroTelehealthStates = Array.isArray(t.telehealth_states)
    ? t.telehealth_states.filter(Boolean)
    : [];
  const heroLocationParts = [];
  if (t.city) heroLocationParts.push(escapeHtml(t.city));
  if (t.state) heroLocationParts.push(escapeHtml(t.state));
  let heroLocationLine = heroLocationParts.join(", ");
  if (t.accepts_telehealth && heroTelehealthStates.length) {
    const thShown = heroTelehealthStates.slice(0, 6).join(", ");
    const thExtra =
      heroTelehealthStates.length > 6 ? " +" + (heroTelehealthStates.length - 6) + " more" : "";
    heroLocationLine +=
      ' <span class="profile-hero-loc-sep">·</span> Telehealth available in ' +
      escapeHtml(thShown + thExtra);
  } else if (t.accepts_telehealth) {
    heroLocationLine += ' <span class="profile-hero-loc-sep">·</span> Telehealth available';
  }

  let heroYearsHtml = "";
  if (bipolarYears > 0) {
    const coordinatesText = /coordinat/i.test(String(t.care_approach || ""))
      ? "Coordinates with psychiatrists"
      : "";
    const bipolarPopulations = (
      Array.isArray(t.client_populations) ? t.client_populations : []
    ).filter(function (p) {
      return /bipolar|cycl|mixed|hypoman|mood|mania/i.test(String(p || ""));
    });
    const subtypesText = bipolarPopulations.slice(0, 4).join(", ");
    heroYearsHtml =
      '<div class="profile-hero-years">' +
      '<div class="profile-hero-years-main">' +
      '<div class="profile-hero-years-num">' +
      escapeHtml(String(bipolarYears)) +
      '<span class="profile-hero-years-unit">' +
      (bipolarYears === 1 ? "year" : "years") +
      "</span>" +
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

  const modalityList = (Array.isArray(t.treatment_modalities) ? t.treatment_modalities : []).filter(
    Boolean,
  );
  function isPrimaryHeroModality(name) {
    const n = String(name || "").toLowerCase();
    if (/ipsrt|interpersonal\s+and\s+social\s+rhythm/.test(n)) return true;
    if (/\bfft\b|family.?focused/.test(n)) return true;
    if (/dbt.*bipolar|bipolar.*dbt|dbt-for-bipolar/.test(n)) return true;
    return false;
  }
  const primaryModalities = modalityList.filter(isPrimaryHeroModality);
  const secondaryModalities = modalityList.filter(function (m) {
    return !isPrimaryHeroModality(m);
  });
  const orderedModalities = primaryModalities.concat(secondaryModalities);
  const visibleModalities = orderedModalities.slice(0, 6);
  const modalityOverflow = orderedModalities.length - visibleModalities.length;
  let heroTagsHtml = "";
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
  // graceful-empty-states rule, no "No bio yet" placeholder).
  let bioCardHtml = "";
  if (scrubbedBio && String(scrubbedBio).trim()) {
    const bioRaw = String(scrubbedBio).trim();
    let bioParagraphs = bioRaw
      .split(/\n\s*\n+/)
      .map(function (p) {
        return p.trim();
      })
      .filter(Boolean);
    if (!bioParagraphs.length) bioParagraphs = [bioRaw];
    const bioFullPlain = bioParagraphs.join("\n\n");
    const needsBioTruncate = bioFullPlain.length > 280;
    let bioPreviewText = "";
    if (needsBioTruncate) {
      bioPreviewText = bioFullPlain.slice(0, 280);
      const lastSpace = bioPreviewText.lastIndexOf(" ");
      if (lastSpace > 200) bioPreviewText = bioPreviewText.slice(0, lastSpace);
      bioPreviewText = bioPreviewText.replace(/[\s,;:.–-]+$/, "") + "…";
    }
    const bioFullHtml = bioParagraphs
      .map(function (p) {
        return '<p class="profile-section-body">' + escapeHtml(p) + "</p>";
      })
      .join("");
    const bioPreviewHtml = needsBioTruncate
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
  const bipolarApproachText = String(t.bipolar_approach || "").trim();
  let bipolarApproachHtml = "";
  if (bipolarApproachText) {
    const approachParagraphs = bipolarApproachText
      .split(/\n{2,}/)
      .map(function (p) {
        return p.trim();
      })
      .filter(Boolean);
    const approachBody = approachParagraphs.length
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
    const num = Number(n);
    if (!isFinite(num) || num <= 0) return "";
    return "$" + Math.round(num);
  }
  const practiceRows = [];
  // Availability
  if (t.accepting_new_patients === true || t.accepting_new_patients === false) {
    let availabilityValue;
    const availabilityClass = "profile-detail-value";
    if (t.accepting_new_patients === true) {
      availabilityValue = '<span class="profile-detail-avail">Accepting new patients</span>';
      const posture = String(t.availability_posture || "").trim();
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
  const waitText = String(t.estimated_wait_time || "").trim();
  if (waitText) {
    practiceRows.push({ label: "Estimated wait", value: waitText });
  }
  // Session fee
  const feeMin = fmtUsd(t.session_fee_min);
  const feeMax = fmtUsd(t.session_fee_max);
  let feeText = "";
  if (feeMin && feeMax && feeMin !== feeMax) feeText = feeMin + "–" + feeMax;
  else if (feeMin) feeText = feeMin;
  else if (feeMax) feeText = feeMax;
  if (t.sliding_scale && feeText) feeText += " · Sliding scale available";
  else if (t.sliding_scale && !feeText) feeText = "Sliding scale available";
  if (feeText) {
    practiceRows.push({ label: "Session fee", value: feeText });
  }
  // Care mode
  let careMode = "";
  if (t.accepts_telehealth && t.accepts_in_person) careMode = "In-person & telehealth";
  else if (t.accepts_telehealth) careMode = "Telehealth";
  else if (t.accepts_in_person) careMode = "In-person";
  if (careMode) {
    practiceRows.push({ label: "Care mode", value: careMode });
  }
  // Languages
  const langs = (Array.isArray(t.languages) ? t.languages : []).filter(Boolean);
  if (langs.length) {
    practiceRows.push({ label: "Languages", value: langs.join(", ") });
  }
  // Insurance, full width row, pills
  const insuranceList = (Array.isArray(t.insurance_accepted) ? t.insurance_accepted : []).filter(
    Boolean,
  );
  let insuranceHtml = "";
  if (insuranceList.length) {
    const visibleInsurance = insuranceList.slice(0, 5);
    const insuranceOverflow = insuranceList.length - visibleInsurance.length;
    let pillHtml = visibleInsurance
      .map(function (ins) {
        return '<span class="profile-detail-pill">' + escapeHtml(String(ins)) + "</span>";
      })
      .join("");
    if (insuranceOverflow > 0) {
      pillHtml += '<span class="profile-detail-pill-more">+' + insuranceOverflow + " more</span>";
    }
    insuranceHtml = '<div class="profile-detail-pills">' + pillHtml + "</div>";
  }
  // Training & affiliations (STEP-BD, UCLA Mood Disorders, DBSA, NAMI, …) —
  // the kind of specific credential that separates a specialist from a
  // generalist. Rendered as chips; degrades to nothing when unset.
  const trainingAffiliations = (
    Array.isArray(t.training_affiliations) ? t.training_affiliations : []
  ).filter(Boolean);
  let trainingAffiliationsHtml = "";
  if (trainingAffiliations.length) {
    trainingAffiliationsHtml =
      '<div class="profile-detail-row profile-detail-row--full">' +
      '<div class="profile-detail-label">Training &amp; affiliations</div>' +
      '<div class="profile-affiliation-tags">' +
      trainingAffiliations
        .map(function (a) {
          return '<span class="profile-affiliation-tag">' + escapeHtml(a) + "</span>";
        })
        .join("") +
      "</div>" +
      "</div>";
  }

  let practiceDetailsHtml = "";
  if (practiceRows.length || insuranceHtml || trainingAffiliationsHtml) {
    let rowsHtml = practiceRows
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
    rowsHtml += trainingAffiliationsHtml;
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
  let draftMessageText;
  const contactGuidanceText = String(t.contact_guidance || "").trim();
  if (contactGuidanceText) {
    draftMessageText = contactGuidanceText;
  } else {
    let careModeWord;
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
  const draftMessageHtml = escapeHtml(draftMessageText).replace(/\n/g, "<br>");

  let reachOutCallScript = "";
  if (t.phone) {
    const voicemailFirstName = therapistFirstName;
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
          "’s profile on BipolarTherapyHub and would love to connect about bipolar informed care. Please call me back when you have a moment, thank you.”",
      ) +
      "</p>" +
      '<button type="button" class="profile-reach-call-cta" data-profile-call-cta data-tel="' +
      escapeHtml(normalizeTelUri(t.phone)) +
      '">' +
      "" +
      tiSvg("phone") +
      " Call " +
      escapeHtml(t.phone) +
      "</button>" +
      "</div>";
  }

  // Lead with the channel the therapist prefers. If they've set
  // "phone first", the call script appears above the email draft; if
  // they've set "email first" (or no preference), the draft email
  // stays on top.
  const reachOutDraftHtml =
    '<div class="profile-reach-draft">' +
    '<div class="profile-reach-draft-label">Written message</div>' +
    '<div class="profile-reach-draft-hint">A calm starting point. Swap in your name or add one personal detail if you\'d like.</div>' +
    '<div class="profile-reach-draft-msg" data-profile-draft-text>' +
    draftMessageHtml +
    "</div>" +
    '<div class="profile-reach-draft-foot">' +
    '<button type="button" class="profile-reach-copy" data-profile-copy-draft>' +
    "" +
    tiSvg("copy") +
    " Copy message" +
    "</button>" +
    "</div>" +
    "</div>";
  const reachOutPrefersPhone = String(t.preferred_contact_method || "").toLowerCase() === "phone";
  const reachOutBody = reachOutPrefersPhone
    ? reachOutCallScript + reachOutDraftHtml
    : reachOutDraftHtml + reachOutCallScript;
  const reachOutHeading = reachOutPrefersPhone
    ? "Call first, here's what to say"
    : "We've drafted a message for you";
  const reachOutHtml =
    '<div class="card profile-section-card profile-reach-card">' +
    '<div class="profile-section-eyebrow">Reach out</div>' +
    '<h2 class="profile-section-h2">' +
    escapeHtml(reachOutHeading) +
    "</h2>" +
    reachOutBody +
    "</div>";

  // Step 10: FAQ card. Renders in the main column (was previously inside
  // the sidebar's hero-right). Uses the shared buildFAQItems dynamic Q&A;
  // first item opens by default when accepting new patients is true.
  const faqItems = buildFAQItems(t);
  const faqAcceptingOpen = t.accepting_new_patients === true;
  const faqItemsHtml = faqItems
    .map(function (item, i) {
      const isFirst = i === 0;
      const isOpen = isFirst && faqAcceptingOpen;
      // Locked-open (accepting) item shows a static check; all others show a
      // chevron that rotates via CSS keyed on the button's aria-expanded.
      const faqIconSvg = isOpen
        ? tiSvg("circle-check", "profile-faq-icon--success")
        : tiSvg("chevron-down", "profile-faq-chevron");
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
        faqIconSvg +
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

  let faqLicenseRow = "";
  if (t.license_number) {
    const faqLicenseState = t.license_state || t.state || "CA";
    const faqLicenseType = t.credentials || "License";
    faqLicenseRow =
      '<div class="profile-faq-license">' +
      "" +
      tiSvg("shield-check") +
      " " +
      "License verified · " +
      escapeHtml(faqLicenseState + " " + faqLicenseType + " #" + t.license_number) +
      " · California Department of Consumer Affairs" +
      "</div>";
  }

  const faqCardHtml =
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
  const sideHasPhone = Boolean(t.phone);
  const sideHasEmail = isRealEmail(t.email);
  const sideHasWebsite = Boolean(websiteUrl);
  const sideHasBooking = Boolean(bookingUrl) && bookingUrl !== websiteUrl;
  const preferredContactRaw = String(t.preferred_contact_method || "").trim();

  // Sidebar primary button, respects preferred_contact_method when the
  // therapist set one (mirrors buildPreferredContactButton in the main
  // column). Falls back to the legacy phone-then-email ladder only when
  // no preference is set or the preferred channel's field is missing.
  function buildSidePrimaryHtml() {
    const pref = preferredContactRaw.toLowerCase();
    if (pref === "email" && sideHasEmail) {
      return (
        '<a href="mailto:' +
        escapeHtml(t.email) +
        '" class="profile-side-primary" data-profile-side-primary data-profile-contact-route="email">' +
        "" +
        tiSvg("mail") +
        " Email " +
        escapeHtml(therapistFirstName) +
        "</a>"
      );
    }
    if (pref === "phone" && sideHasPhone) {
      return (
        '<a href="tel:' +
        escapeHtml(normalizeTelUri(t.phone)) +
        '" class="profile-side-primary" data-profile-side-primary data-profile-contact-route="phone">' +
        "" +
        tiSvg("phone") +
        " Call " +
        escapeHtml(t.phone) +
        "</a>"
      );
    }
    if ((pref === "booking" || pref === "booking_url") && sideHasBooking && bookingHealthy) {
      return (
        '<a href="' +
        escapeHtml(bookingUrl) +
        '" target="_blank" rel="noopener" class="profile-side-primary" data-profile-side-primary data-profile-contact-route="booking">' +
        "" +
        tiSvg("calendar") +
        " Book a consultation" +
        "</a>"
      );
    }
    if (pref === "website" && sideHasWebsite && websiteHealthy) {
      return (
        '<a href="' +
        escapeHtml(websiteUrl) +
        '" target="_blank" rel="noopener" class="profile-side-primary" data-profile-side-primary data-profile-contact-route="website">' +
        "" +
        tiSvg("world") +
        " Visit " +
        escapeHtml(therapistFirstName) +
        "'s website</a>"
      );
    }
    // No preference set, or preferred channel's field is missing, fall
    // back to phone-then-email so the button still does something useful.
    if (sideHasPhone) {
      return (
        '<a href="tel:' +
        escapeHtml(normalizeTelUri(t.phone)) +
        '" class="profile-side-primary" data-profile-side-primary data-profile-contact-route="phone">' +
        "" +
        tiSvg("phone") +
        " Call " +
        escapeHtml(t.phone) +
        "</a>"
      );
    }
    if (sideHasEmail) {
      return (
        '<a href="mailto:' +
        escapeHtml(t.email) +
        '" class="profile-side-primary" data-profile-side-primary data-profile-contact-route="email">' +
        "" +
        tiSvg("mail") +
        " Email " +
        escapeHtml(therapistFirstName) +
        "</a>"
      );
    }
    return "";
  }
  const sidePrimaryHtml = buildSidePrimaryHtml();

  // Unified contact-method list. Each row shows an icon + a value,
  // with an inline (Preferred) tag on the row matching the therapist's
  // stated preference. Replaces the legacy separate "Preferred contact"
  // box at the bottom, same information, less chrome.
  const prefKey = preferredContactRaw.toLowerCase();
  const prefMap = {
    booking_url: "booking",
  };
  const prefRoute = prefMap[prefKey] || prefKey; // normalize booking_url → booking
  function sideContactRow(route, iconClass, href, label, opts) {
    const external = opts && opts.external ? ' target="_blank" rel="noopener"' : "";
    const anchorCls = opts && opts.cls ? ' class="' + opts.cls + '"' : "";
    const preferred = route === prefRoute;
    // No "Preferred" badge here: the primary CTA above already states
    // the preferred channel loudly, so the badge duplicated it — and
    // its fixed width crowded long emails into an ugly two-line wrap.
    // The tinted --preferred row background carries the signal on its
    // own and gives the value the full row width.
    //
    // Click-to-copy for the email row (opts.copyEmail): clicking copies
    // the address with a "Copied!" flash, falling back to the mailto in
    // href when the clipboard API is unavailable. Reuses the existing
    // [data-copy-email] handler + .profile-contact-copy-hint styling.
    const copyEmail = opts && opts.copyEmail ? opts.copyEmail : "";
    const copyAttr = copyEmail ? ' data-copy-email="' + escapeHtml(copyEmail) + '"' : "";
    // Action-oriented accessible name so a screen reader announces "Call
    // Dana" rather than reading the raw phone digits or URL aloud. The
    // visible value still carries the literal number/address for sighted users.
    const ariaLabel = opts && opts.ariaLabel ? opts.ariaLabel : "";
    const ariaAttr = ariaLabel ? ' aria-label="' + escapeHtml(ariaLabel) + '"' : "";
    const inner = copyEmail
      ? '<span class="profile-contact-value">' +
        escapeHtml(label) +
        '</span><span class="profile-contact-copy-hint" aria-hidden="true">Copy</span>'
      : escapeHtml(label);
    return (
      '<div class="profile-side-item' +
      (preferred ? " profile-side-item--preferred" : "") +
      '">' +
      tiSvg(String(iconClass).replace(/^ti-/, "")) +
      '<a href="' +
      escapeHtml(href) +
      '"' +
      external +
      anchorCls +
      copyAttr +
      ariaAttr +
      ">" +
      inner +
      "</a>" +
      "</div>"
    );
  }
  let sideContactItems = "";
  // Order: email, phone, website, booking. Stable order so the eye
  // can find a channel without scanning; the (Preferred) tag does
  // the prioritization visually.
  if (sideHasEmail) {
    sideContactItems += sideContactRow("email", "ti-mail", "mailto:" + t.email, t.email, {
      cls: "profile-side-email",
      copyEmail: t.email,
      ariaLabel: "Email " + therapistFirstName,
    });
  }
  if (sideHasPhone) {
    sideContactItems += sideContactRow(
      "phone",
      "ti-phone",
      "tel:" + normalizeTelUri(t.phone),
      t.phone,
      { ariaLabel: "Call " + therapistFirstName + " at " + t.phone },
    );
  }
  if (sideHasWebsite) {
    sideContactItems += sideContactRow("website", "ti-world", websiteUrl, "Practice website →", {
      external: true,
      ariaLabel: "Visit " + therapistFirstName + "'s practice website (opens in a new tab)",
    });
  }
  if (sideHasBooking) {
    sideContactItems += sideContactRow(
      "booking",
      "ti-calendar",
      bookingUrl,
      "Book a consultation →",
      {
        external: true,
        ariaLabel: "Book a consultation with " + therapistFirstName + " (opens in a new tab)",
      },
    );
  }

  // Optional contact-guidance copy (the long-form "Email first." style
  // line the therapist wrote). Shown as a quiet sentence below the
  // contact list when present and different from the route tag.
  let sideGuidanceBlock = "";
  if (
    contactGuidanceText &&
    contactGuidanceText !== "Email first." &&
    contactGuidanceText !== "Phone first." &&
    contactGuidanceText !== "Text first."
  ) {
    sideGuidanceBlock =
      '<p class="profile-side-guidance">' + escapeHtml(contactGuidanceText) + "</p>";
  }

  const sideSaveId = String(t.slug || t._id || t.name || "").trim();
  const sideSaveButton =
    '<button type="button" class="profile-side-save" data-profile-side-save data-save-id="' +
    escapeHtml(sideSaveId) +
    '" aria-pressed="false">' +
    "" +
    tiSvg("bookmark") +
    "" +
    '<span class="profile-side-save-label">Save</span>' +
    "</button>";

  const sidebarHtml =
    '<div class="profile-side-card">' +
    '<div class="profile-side-eyebrow">Contact</div>' +
    sidePrimaryHtml +
    (sidePrimaryHtml
      ? '<p class="profile-side-note">After first contact, the next step is usually a brief 15-min consultation before scheduling.</p>'
      : "") +
    sideContactItems +
    sideGuidanceBlock +
    sideSaveButton +
    "</div>";

  const html =
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
      ? '<div class="profile-hero-loc">' + tiSvg("map-pin") + " " + heroLocationLine + "</div>"
      : "") +
    "</div>" +
    "</div>" +
    heroEvidenceHtml +
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
    const heroRight = document.querySelector(".profile-hero-right");
    const sideCol = document.querySelector("[data-profile-side]");
    if (heroRight && sideCol) {
      sideCol.appendChild(heroRight);
    }
  })();

  // Append mobile sticky bar to body (outside profileWrap so it stays fixed)
  const existingStickyBar = document.getElementById("profileMobileStickyBar");
  if (existingStickyBar) existingStickyBar.remove();
  const stickyBarHtml = buildMobileStickyBar(t);
  if (stickyBarHtml) {
    const stickyContainer = document.createElement("div");
    stickyContainer.innerHTML = stickyBarHtml;
    document.body.appendChild(stickyContainer.firstElementChild);
  }
  // Show mobile sticky bar once hero primary CTA scrolls out of view
  const heroCta = document.querySelector(".primary-action-frame");
  const stickyBar = document.getElementById("profileMobileStickyBar");
  if (heroCta && stickyBar && typeof window.IntersectionObserver === "function") {
    const stickyObserver = new window.IntersectionObserver(
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
  const shortlistButtons = Array.prototype.slice.call(
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
  const prioritySelect = document.getElementById("profileShortlistPriority");
  if (prioritySelect) {
    prioritySelect.addEventListener("change", function () {
      updateShortlistPriority(t.slug, prioritySelect.value);
      updateShortlistAction(t.slug);
      if (typeof window.refreshShortlistNav === "function") {
        window.refreshShortlistNav();
      }
    });
  }
  const noteInput = document.getElementById("profileShortlistNote");
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
        // Ignore rapid repeat taps on the same CTA: on a slow network a user
        // double-taps before navigation kicks in, which fires duplicate
        // analytics and inflates the measured CTA click-rate. A brief
        // is-loading window grays the control (pointer-events:none in CSS)
        // and short-circuits the second event without ever blocking the
        // first click's navigation.
        if (link.dataset.ctaLoading === "1") return;
        link.dataset.ctaLoading = "1";
        link.classList.add("is-loading");
        window.setTimeout(function () {
          link.classList.remove("is-loading");
          delete link.dataset.ctaLoading;
        }, 600);
        const route = link.getAttribute("data-profile-contact-route") || "";
        rememberTherapistContactRoute(t.slug, route, "profile");
        recordCtaClickSafely(t.slug, route);
        trackFunnelEvent("profile_contact_route_clicked", {
          priority: link.getAttribute("data-profile-contact-priority") || "unknown",
          ...getContactAnalyticsMeta(t, route),
        });
        // mailto: and tel: only navigate when the device has a handler
        // app configured. A desktop with email living in a Gmail browser
        // tab has none, so the click silently does nothing (reported
        // 2026-06-11 as "the primary CTA is dead"). Copy the address up
        // front, and if the page never lost focus shortly after the
        // click (nothing opened), tell the user it is on the clipboard.
        if (route === "email" || route === "phone") {
          const contactValue = contactValueFromHref(link.getAttribute("href") || "");
          if (!contactValue) return;
          let copied = false;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(contactValue).then(
              function () {
                copied = true;
              },
              function () {},
            );
          }
          let handlerOpened = false;
          function markHandled() {
            handlerOpened = true;
          }
          window.addEventListener("blur", markHandled);
          document.addEventListener("visibilitychange", markHandled);
          window.setTimeout(function () {
            window.removeEventListener("blur", markHandled);
            document.removeEventListener("visibilitychange", markHandled);
            if (handlerOpened || document.visibilityState === "hidden") return;
            showContactFallbackToast(
              route === "email"
                ? copied
                  ? "No email app opened, so we copied " +
                    contactValue +
                    " for you. Paste it into any email."
                  : "No email app opened. You can write to " + contactValue + "."
                : copied
                  ? "No call app opened, so we copied " +
                    contactValue +
                    " for you. Dial it from your phone."
                  : "No call app opened. You can dial " + contactValue + ".",
            );
            trackFunnelEvent("profile_contact_fallback_shown", {
              copied: copied,
              ...getContactAnalyticsMeta(t, route),
            });
          }, 1400);
        }
      });
    });
  document.querySelectorAll("[data-copy-email]").forEach(function (link) {
    link.addEventListener("click", function (event) {
      const rawEmail = link.getAttribute("data-copy-email") || "";
      if (!rawEmail) return;
      // Allowlist-sanitize a DOM-sourced value before clipboard / mailto use.
      const email = rawEmail.replace(/[^a-zA-Z0-9@._%+-]/g, "");
      const valueEl = link.querySelector(".profile-contact-value");
      const copyHint = link.querySelector(".profile-contact-copy-hint");
      const original = valueEl ? valueEl.textContent : "";
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
          const ta = document.createElement("textarea");
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

  const contactSection = document.querySelector("[data-profile-contact-section]");
  let contactSectionTracked = false;
  if (contactSection && typeof window.IntersectionObserver === "function") {
    const contactObserver = new window.IntersectionObserver(
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
  const outreachToggleBtn = document.querySelector("[data-outreach-toggle]");
  const outreachPanel = document.getElementById("contactOutreachPanel");
  if (outreachToggleBtn && outreachPanel) {
    outreachToggleBtn.addEventListener("click", function () {
      const isOpen = outreachToggleBtn.getAttribute("aria-expanded") === "true";
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
      const card = document.getElementById("outreach");
      if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }
  const outreachScriptCard = document.querySelector("[data-profile-outreach-script]");
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
        const scriptCard = document.querySelector("[data-profile-outreach-script]");
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
        const message = String(outreachScript || "").trim();
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
  const contactQuestionsCard = document.querySelector("[data-profile-contact-questions]");
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
        const outcome = button.getAttribute("data-profile-queue-outcome") || "";
        const saved = recordProfileOutreachOutcome(t, outcome);
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
  // nav badge, and updates live if the same user saves from another
  // tab via the subscribe() callback.
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-side-save]"))
    .forEach(function (button) {
      const slug = button.getAttribute("data-save-id") || "";
      const label = button.querySelector(".profile-side-save-label");
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
      const item = button.closest("[data-profile-faq-item]");
      if (!item) return;
      const answer = item.querySelector(".profile-faq-a");
      // The chevron now rotates via CSS keyed on the button's aria-expanded
      // (see .profile-faq-chevron in therapist-page.css), so the handler only
      // toggles state — no icon swapping needed.
      button.addEventListener("click", function () {
        const open = item.classList.contains("is-open");
        if (open) {
          item.classList.remove("is-open");
          if (answer) answer.hidden = true;
          button.setAttribute("aria-expanded", "false");
        } else {
          const siblings = item.parentNode
            ? item.parentNode.querySelectorAll("[data-profile-faq-item]")
            : [];
          Array.prototype.forEach.call(siblings, function (sib) {
            if (sib === item) return;
            sib.classList.remove("is-open");
            const sibAnswer = sib.querySelector(".profile-faq-a");
            const sibButton = sib.querySelector("[data-profile-faq-toggle]");
            if (sibAnswer) sibAnswer.hidden = true;
            if (sibButton) sibButton.setAttribute("aria-expanded", "false");
          });
          item.classList.add("is-open");
          if (answer) answer.hidden = false;
          button.setAttribute("aria-expanded", "true");
        }
      });
    });

  // Step 9: copy-to-clipboard for the reach-out draft, and click-to-dial
  // for the inline call CTA.
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-copy-draft]"))
    .forEach(function (button) {
      const card = button.closest(".profile-reach-card");
      const msgEl = card ? card.querySelector("[data-profile-draft-text]") : null;
      const defaultLabel = button.innerHTML;
      button.addEventListener("click", function () {
        if (!msgEl) return;
        const text = msgEl.innerText || msgEl.textContent || "";
        const done = function () {
          button.classList.add("is-copied");
          button.innerHTML = "" + tiSvg("check") + " Copied";
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
        const rawTel = button.getAttribute("data-tel");
        // Allowlist-sanitize a DOM-sourced value before building a tel: URL.
        const tel = rawTel ? rawTel.replace(/[^0-9+().\- ]/g, "") : "";
        if (tel) window.location.href = "tel:" + tel;
      });
    });

  // Step 7: bio preview/full toggle. The new card renders a 280-char
  // preview <p> plus a hidden full bio block; clicking the button swaps
  // visibility and the button label.
  Array.prototype.slice
    .call(document.querySelectorAll("[data-profile-bio-toggle]"))
    .forEach(function (button) {
      const block = button.closest("[data-profile-bio-block]");
      if (!block) return;
      const preview = block.querySelector("[data-profile-bio-preview]");
      const full = block.querySelector("[data-profile-bio-full]");
      button.addEventListener("click", function () {
        const expanded = button.getAttribute("aria-expanded") === "true";
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
        const section = button.closest("[data-profile-section]");
        const content = section ? section.querySelector(".profile-section-content") : null;
        const toggle = button.querySelector(".section-toggle");
        if (!content || !toggle) {
          return;
        }
        const collapsed = content.classList.toggle("is-collapsed");
        button.setAttribute("aria-expanded", collapsed ? "false" : "true");
        toggle.textContent = collapsed ? "Show" : "Hide";
      });
    });
  // FAQ accordion bindings
  Array.prototype.slice
    .call(document.querySelectorAll("[data-faq-toggle]"))
    .forEach(function (btn) {
      btn.addEventListener("click", function () {
        const idx = btn.getAttribute("data-faq-toggle");
        const answer = document.getElementById("faq-answer-" + idx);
        if (!answer) return;
        const expanded = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", expanded ? "false" : "true");
        if (expanded) {
          answer.setAttribute("hidden", "");
        } else {
          answer.removeAttribute("hidden");
        }
        const icon = btn.querySelector(".faq-toggle-icon");
        if (icon) icon.textContent = expanded ? "+" : "−";
      });
    });

  if (typeof window.IntersectionObserver === "function") {
    const navLinks = Array.prototype.slice.call(document.querySelectorAll("[data-section-link]"));
    const sectionObserver = new window.IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) {
            return;
          }
          const id = entry.target.id;
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
