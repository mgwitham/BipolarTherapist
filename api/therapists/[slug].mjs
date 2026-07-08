/**
 * SSR handler for /therapists/[slug]
 *
 * Fetches the therapist from Sanity server-side and returns a fully-rendered
 * HTML page so Googlebot sees real content in the initial response rather than
 * an empty #profileWrap shell. The Vite JS bundle loads after and replaces the
 * SSR content with the full interactive version using the embedded
 * window.__THERAPIST_DATA__ payload (no second Sanity fetch needed).
 *
 * vercel.json wires /therapists/:slug → this function and includes
 * dist/therapist.html in the function bundle so we can extract the
 * Vite-hashed asset URLs at runtime.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@sanity/client";
import {
  normalizeDisplayRole,
  normalizeFieldReviewStates,
} from "../../shared/therapist-domain.mjs";
import { hasActiveFeatured } from "../../shared/therapist-subscription-domain.mjs";
import { OG_CARD_VERSION } from "../../shared/og-card-version.mjs";

// ─── Config ──────────────────────────────────────────────────────────────────

const PROJECT_ID = process.env.SANITY_PROJECT_ID || process.env.VITE_SANITY_PROJECT_ID;
const DATASET = process.env.SANITY_DATASET || process.env.VITE_SANITY_DATASET || "production";
const API_VERSION =
  process.env.SANITY_API_VERSION || process.env.VITE_SANITY_API_VERSION || "2026-04-02";
const ORIGIN = "https://www.bipolartherapyhub.com";

const THERAPIST_GROQ = `*[_type == "therapist" && slug.current == $slug && listingActive == true && status == "active" && visibilityIntent == "listed"][0]{
  _id, name, credentials, title, bio, "photo_url": photo.asset->url,
  email, phone, website, bookingUrl, contactGuidance,
  practiceName, city, state, zip, licenseState, licenseNumber,
  claimStatus, verificationStatus, therapistReportedConfirmedAt,
  specialties, treatmentModalities, insuranceAccepted,
  acceptsTelehealth, acceptsInPerson, acceptingNewPatients,
  sessionFeeMin, sessionFeeMax, slidingScale,
  careApproach, medicationManagement, fieldReviewStates,
  therapistReportedFields, "slug": slug.current
}`;

// ─── Sanity fetch ─────────────────────────────────────────────────────────────

let sanityClient = null;

function getSanityClient() {
  if (!PROJECT_ID || !DATASET) {
    return null;
  }

  if (!sanityClient) {
    // Published public reads from a publicly-readable dataset: route through
    // Sanity's edge CDN (no token) so SSR profile pages skip the slower
    // authenticated live-API round trip.
    sanityClient = createClient({
      projectId: PROJECT_ID,
      dataset: DATASET,
      apiVersion: API_VERSION,
      useCdn: true,
      perspective: "published",
    });
  }

  return sanityClient;
}

async function fetchSanity(query, params = {}) {
  const client = getSanityClient();
  if (!client) return null;
  try {
    return await client.fetch(query, params);
  } catch (_err) {
    return null;
  }
}

// Like fetchSanity, but distinguishes "Sanity answered (possibly with no
// match)" from "couldn't reach Sanity at all." The handler needs this to
// tell a genuinely-missing profile (→ 404, so search engines de-index)
// apart from a transient backend outage (→ keep the resilient SPA fallback
// rather than 404 a real profile).
async function fetchSanityResult(query, params = {}) {
  const client = getSanityClient();
  if (!client) return { reached: false, data: null };
  try {
    return { reached: true, data: await client.fetch(query, params) };
  } catch (_err) {
    return { reached: false, data: null };
  }
}

// Minimal, noindex 404 body for a slug that has no active listed profile.
function buildNotFoundPage() {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="robots" content="noindex, follow" />',
    "<title>Profile not available · BipolarTherapyHub</title>",
    '<link rel="stylesheet" href="/assets/styles.css" />',
    "</head><body>",
    '<main style="max-width:640px;margin:4rem auto;padding:0 1.25rem;text-align:center;font-family:system-ui,sans-serif">',
    "<h1>This profile isn’t available</h1>",
    "<p>This therapist may no longer be listed. Browse the directory to find bipolar-informed care.</p>",
    '<p><a href="/directory">Back to the directory →</a></p>',
    "</main></body></html>",
  ].join("");
}

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizeDoc(doc, subscription = null) {
  if (!doc) return null;
  const frs = normalizeFieldReviewStates(doc.fieldReviewStates, { keyStyle: "camelCase" });
  return {
    id: doc._id,
    name: doc.name || "",
    credentials: doc.credentials || "",
    title: normalizeDisplayRole(doc.title || ""),
    bio: normalizeDisplayRole(doc.bio || ""),
    photo_url: doc.photo_url || null,
    email: doc.email || "",
    phone: doc.phone || "",
    website: doc.website || null,
    booking_url: doc.bookingUrl || null,
    contact_guidance: doc.contactGuidance || "",
    practice_name: doc.practiceName || "",
    city: doc.city || "",
    state: doc.state || "",
    zip: doc.zip || "",
    license_state: doc.licenseState || "",
    license_number: doc.licenseNumber || "",
    claim_status: doc.claimStatus || "unclaimed",
    verification_status: doc.verificationStatus || "",
    therapist_reported_confirmed_at: doc.therapistReportedConfirmedAt || "",
    specialties: Array.isArray(doc.specialties) ? doc.specialties : [],
    treatment_modalities: Array.isArray(doc.treatmentModalities) ? doc.treatmentModalities : [],
    insurance_accepted: Array.isArray(doc.insuranceAccepted) ? doc.insuranceAccepted : [],
    accepts_telehealth: Boolean(doc.acceptsTelehealth),
    accepts_in_person: Boolean(doc.acceptsInPerson),
    accepting_new_patients:
      doc.acceptingNewPatients === true ? true : doc.acceptingNewPatients === false ? false : null,
    session_fee_min: doc.sessionFeeMin || null,
    session_fee_max: doc.sessionFeeMax || null,
    sliding_scale: Boolean(doc.slidingScale),
    care_approach: doc.careApproach || "",
    medication_management: Boolean(doc.medicationManagement),
    therapist_reported_fields: Array.isArray(doc.therapistReportedFields)
      ? doc.therapistReportedFields
      : [],
    field_review_states: {
      estimated_wait_time: frs.estimatedWaitTime,
      insurance_accepted: frs.insuranceAccepted,
      telehealth_states: frs.telehealthStates,
      bipolar_years_experience: frs.bipolarYearsExperience,
    },
    has_paid_subscription: hasActiveFeatured(subscription),
    slug: doc.slug || "",
  };
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SCRAPED_PREFIX_RE = /^.+,\s*\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4},?\s+/;
function stripScrapedPrefix(value) {
  if (!value) return value;
  const cleaned = value.replace(SCRAPED_PREFIX_RE, "");
  return cleaned.length < value.length ? cleaned : value;
}

// ─── Asset tag extraction ─────────────────────────────────────────────────────

let _assetTags = null;
function getAssetTags() {
  if (_assetTags) return _assetTags;
  try {
    const builtHtml = readFileSync(join(process.cwd(), "dist", "therapist.html"), "utf-8");
    const linkTags = [...builtHtml.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)]
      .map((m) => "    " + m[0])
      .join("\n");
    const scriptTags = [...builtHtml.matchAll(/<script[^>]+type="module"[^>]*><\/script>/g)]
      .map((m) => "    " + m[0])
      .join("\n");
    _assetTags = { linkTags, scriptTags };
  } catch {
    _assetTags = {
      linkTags: '    <link rel="stylesheet" href="/assets/therapist-page.css">',
      scriptTags:
        '    <script type="module" src="/assets/therapist-page.js"></script>\n    <script type="module" src="/assets/shortlist-nav.js"></script>',
    };
  }
  return _assetTags;
}

// ─── SEO helpers ──────────────────────────────────────────────────────────────

function buildSeoDescription(t) {
  const name = t.name || "Bipolar therapist";
  const creds = t.credentials ? ", " + t.credentials : "";
  const location = [t.city, t.state].filter(Boolean).join(", ") || "";
  const parts = [name + creds + ", bipolar disorder specialist in " + location + "."];
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
  const ins = t.insurance_accepted.filter(Boolean);
  if (ins.length)
    parts.push("Accepts " + ins.slice(0, 3).join(", ") + (ins.length > 3 ? " & more." : "."));
  const result = parts.join(" ");
  return result.length > 158 ? result.slice(0, 155) + "…" : result;
}

export function buildFAQItems(t) {
  const name = t.name || "This therapist";
  const first = (t.name || "").split(" ")[0] || "They";
  const phone = t.phone || null;
  const website = t.website || t.booking_url || null;
  const contactPath = [phone ? "calling " + phone : null, website ? "visiting their website" : null]
    .filter(Boolean)
    .join(" or ");
  const contact = contactPath || "using the contact details on this page";
  const ins = t.insurance_accepted.filter(Boolean);
  const accepting = Boolean(t.accepting_new_patients);
  const city = t.city || "their area";
  const modalities = t.treatment_modalities.filter(Boolean);

  const items = [];
  items.push({
    q: "Is " + name + " currently accepting new patients?",
    a: accepting
      ? first +
        " is currently accepting new patients. Reach them by " +
        contact +
        " to schedule an initial appointment."
      : first +
        " is not currently accepting new patients. Use the directory to find similar bipolar disorder specialists nearby.",
  });
  if (ins.length) {
    items.push({
      q: "What insurance does " + name + " accept?",
      a:
        first +
        " accepts " +
        ins.join(", ") +
        ". Coverage varies by plan. Confirm your benefits directly with " +
        first +
        " or your carrier before your first appointment.",
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
  if (t.session_fee_min) {
    const feeRange =
      t.session_fee_max && t.session_fee_max !== t.session_fee_min
        ? "$" + t.session_fee_min + "–$" + t.session_fee_max
        : "$" + t.session_fee_min;
    items.push({
      q: "How much does " + name + " charge per session?",
      a:
        first +
        "'s session fee is " +
        feeRange +
        "/session." +
        (t.sliding_scale ? " A sliding scale fee is available for qualifying clients." : ""),
    });
  } else {
    items.push({
      q: "How much does " + name + " charge per session?",
      a:
        "Session fee information is not listed. Contact " + first + " directly to ask about rates.",
    });
  }
  if (t.accepts_telehealth && t.accepts_in_person) {
    items.push({
      q: "Does " + name + " offer online therapy or telehealth?",
      a:
        "Yes, " +
        first +
        " offers both telehealth (secure video) and in-person appointments in " +
        city +
        ".",
    });
  } else if (t.accepts_telehealth) {
    items.push({
      q: "Does " + name + " offer online therapy or telehealth?",
      a: "Yes, " + first + " offers telehealth sessions via secure video.",
    });
  } else {
    items.push({
      q: "Does " + name + " offer online therapy or telehealth?",
      a: first + " currently offers in-person sessions in " + city + ".",
    });
  }
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
      " lists bipolar disorder as a primary specialty and uses evidence-based approaches recognized for mood stabilization" +
      modalityNote +
      " " +
      first +
      " is listed on Bipolar Therapy Hub, a directory focused exclusively on therapists with verified bipolar expertise.",
  });
  items.push({
    q: "How do I schedule an appointment with " + name + "?",
    a:
      "Reach " +
      first +
      " by " +
      contact +
      ". Mention you found their profile on Bipolar Therapy Hub and briefly describe what you're hoping to work on.",
  });
  return items;
}

export function buildJsonLd(t) {
  const nameWithCreds = t.credentials ? t.name + ", " + t.credentials : t.name;
  const pageUrl = ORIGIN + "/therapists/" + encodeURIComponent(t.slug) + "/";
  const address = {
    "@type": "PostalAddress",
    addressLocality: t.city || undefined,
    addressRegion: t.state || undefined,
    postalCode: t.zip || undefined,
    addressCountry: "US",
  };
  const ins = t.insurance_accepted.filter(Boolean);
  // hasCredential surfaces the therapist's license category + issuing
  // board to search engines. For health professionals, this is the
  // single highest-value structured-data signal — Google uses it to
  // rank verified clinicians above bare directory listings on
  // "[credential] therapist [city]" queries. We map credential
  // initials to the issuing CA board (see BOARD_NAME_MAP in
  // server/dca-license-client.mjs for the canonical names).
  const credIssuer = (function () {
    const c = String(t.credentials || "").toUpperCase();
    if (/\b(LMFT|LCSW|LPCC|LPC|LEP)\b/.test(c)) return "California Board of Behavioral Sciences";
    if (/\b(PSY|PSYD|PHD)\b/.test(c)) return "California Board of Psychology";
    if (/\bMD\b/.test(c)) return "Medical Board of California";
    if (/\bDO\b/.test(c)) return "Osteopathic Medical Board of California";
    if (/\b(NP|RN)\b/.test(c)) return "California Board of Registered Nursing";
    return null;
  })();
  const credentialSchema =
    t.credentials && credIssuer
      ? {
          "@type": "EducationalOccupationalCredential",
          credentialCategory: "license",
          name: t.credentials,
          recognizedBy: {
            "@type": "Organization",
            name: credIssuer,
          },
        }
      : undefined;
  const schemas = [
    {
      "@context": "https://schema.org",
      "@type": "Person",
      name: nameWithCreds,
      url: pageUrl,
      jobTitle: t.title || "Therapist",
      knowsAbout: ["Bipolar disorder", "Psychotherapy", "Mental health"],
      address,
      image: t.photo_url || undefined,
      telephone: t.phone || undefined,
      email: t.email || undefined,
      hasCredential: credentialSchema,
    },
    {
      "@context": "https://schema.org",
      "@type": "MedicalBusiness",
      name: t.practice_name || nameWithCreds,
      url: pageUrl,
      address,
      telephone: t.phone || undefined,
      priceRange: "$$",
      medicalSpecialty: "Psychiatric",
      paymentAccepted: ins.length ? ins.join(", ") : undefined,
      areaServed: t.city ? { "@type": "City", name: t.city } : undefined,
      availableChannel: t.accepts_telehealth
        ? [{ "@type": "ServiceChannel", serviceType: "Telehealth" }]
        : undefined,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: ORIGIN + "/" },
        { "@type": "ListItem", position: 2, name: "Directory", item: ORIGIN + "/directory" },
        { "@type": "ListItem", position: 3, name: nameWithCreds, item: pageUrl },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: buildFAQItems(t).map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];
  return schemas
    .map((s, i) => {
      const ids = [
        "therapist-jsonld",
        "therapist-jsonld-business",
        "therapist-jsonld-breadcrumb",
        "therapist-jsonld-faq",
      ];
      return `<script type="application/ld+json" id="${ids[i]}">${JSON.stringify(s).replace(/<\/script>/gi, "<\\/script>")}</script>`;
    })
    .join("\n    ");
}

// ─── SSR profile HTML ─────────────────────────────────────────────────────────

function renderSSRProfile(t) {
  const location = [t.city, t.state].filter(Boolean).join(", ");
  const ins = t.insurance_accepted.filter(Boolean);
  const specialties = t.specialties.filter(Boolean);
  const faqItems = buildFAQItems(t);

  const acceptingBadge =
    t.accepting_new_patients === true
      ? '<span class="accepting-badge accepting-badge--open">Accepting patients</span>'
      : t.accepting_new_patients === false
        ? '<span class="accepting-badge accepting-badge--closed">Not accepting</span>'
        : "";

  const nameParts = t.name.split(" ");
  const initials = [nameParts[0]?.[0], nameParts[nameParts.length - 1]?.[0]]
    .filter(Boolean)
    .join("")
    .toUpperCase();
  // Richer alt text doubles as image-search context: "Dr Jane Doe,
  // LMFT in San Francisco, CA" lands better on "lmft san francisco
  // therapist" image queries than a bare name. Falls back to just
  // the name when credentials or city are missing.
  const photoAlt = (function () {
    const parts = [t.name];
    if (t.credentials) parts.push(t.credentials);
    const cityState = [t.city, t.state || "CA"].filter(Boolean).join(", ");
    if (cityState) {
      return parts.join(", ") + " in " + cityState;
    }
    return parts.join(", ");
  })();
  const avatar = t.photo_url
    ? `<img src="${esc(t.photo_url)}" alt="${esc(photoAlt)}" class="bth-avatar bth-avatar-profile" loading="eager">`
    : `<div class="bth-avatar bth-avatar-profile" aria-hidden="true" style="background:#1a7a8f;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:600">${esc(initials)}</div>`;

  const trustSignals = [];
  if (t.license_number) {
    trustSignals.push(
      `${esc(t.license_state || t.state || "")} ${esc(t.credentials || "License")} #${esc(String(t.license_number))}`.trim(),
    );
  }
  if (t.verification_status === "editorially_verified") trustSignals.push("Editorially verified");
  if (t.claim_status === "claimed") trustSignals.push("Profile claimed");
  const trustBar = trustSignals.length
    ? `<div class="profile-trust-bar" aria-label="Verification signals">${trustSignals
        .map(
          (s) =>
            `<span class="profile-trust-signal"><svg class="profile-trust-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>${s}</span>`,
        )
        .join("")}</div>`
    : "";

  const feeLabel = t.session_fee_min
    ? "$" +
      t.session_fee_min +
      (t.session_fee_max && t.session_fee_max !== t.session_fee_min
        ? "–$" + t.session_fee_max
        : "") +
      "/session" +
      (t.sliding_scale ? " · sliding scale available" : "")
    : null;

  const formatBadges = [
    t.accepts_telehealth ? "Telehealth" : null,
    t.accepts_in_person ? "In-person" : null,
  ]
    .filter(Boolean)
    .map((f) => `<span class="profile-tag profile-tag-format">${esc(f)}</span>`)
    .join("");

  const phoneDigits = t.phone ? t.phone.replace(/[^0-9+]/g, "") : "";

  return `
  <div class="profile-header" id="section-about" data-profile-section>
    <div class="profile-hero-main">
      <div class="profile-hero-top">
        <div class="profile-identity">
          <div class="avatar">${avatar}</div>
          <div class="profile-main">
            <div class="profile-eyebrow-row">
              <div class="eyebrow">Bipolar-informed therapist profile</div>
              ${acceptingBadge}
            </div>
            <h1>${esc(t.name)}</h1>
            ${t.credentials ? `<div class="creds">${esc(t.credentials)}</div>` : ""}
            ${t.title ? `<div class="title-text">${esc(t.title)}</div>` : ""}
            ${t.practice_name ? `<div class="title-text practice-line">${esc(t.practice_name)}</div>` : ""}
            <div class="location">📍 ${esc(location)}</div>
            ${formatBadges ? `<div class="hero-meta"><div class="trust-pills">${formatBadges}</div></div>` : ""}
          </div>
        </div>
        <div class="profile-contact-card">
          <div class="profile-contact-card-label">Contact</div>
          ${t.phone ? `<a href="tel:${esc(phoneDigits)}" class="profile-contact-row" aria-label="Call ${esc(t.name)}"><span class="profile-contact-icon" aria-hidden="true">📞</span><span class="profile-contact-value">${esc(t.phone)}</span></a>` : ""}
          ${t.website ? `<a href="${esc(t.website)}" target="_blank" rel="noopener noreferrer" class="profile-contact-row" aria-label="Visit ${esc(t.name)}'s website"><span class="profile-contact-icon" aria-hidden="true">🌐</span><span class="profile-contact-value">Practice website →</span></a>` : ""}
          ${t.booking_url ? `<a href="${esc(t.booking_url)}" target="_blank" rel="noopener noreferrer" class="profile-contact-row"><span class="profile-contact-icon" aria-hidden="true">📅</span><span class="profile-contact-value">Booking link</span></a>` : ""}
          ${!t.phone && !t.website && !t.booking_url ? '<div class="profile-contact-empty">No direct contact path listed yet.</div>' : ""}
        </div>
      </div>
      ${
        t.bio
          ? `<div class="profile-bio-wrap" data-profile-bio-wrap>
        <div class="profile-bio-text" id="profileBioPanel">
          <p class="profile-bio-paragraph">${esc(stripScrapedPrefix(t.bio))}</p>
          ${t.care_approach ? `<p class="profile-bio-paragraph profile-bio-approach">${esc(stripScrapedPrefix(t.care_approach))}</p>` : ""}
        </div>
        <div class="profile-bio-fade" aria-hidden="true"></div>
      </div>
      <button type="button" class="profile-bio-read-more" data-profile-bio-read-more aria-expanded="false" aria-controls="profileBioPanel">Read more ↓</button>`
          : ""
      }
    </div>
    ${trustBar}
    <nav class="profile-jump-nav" aria-label="Jump to section">
      <a href="#section-about" class="profile-jump-link is-active" data-section-link="section-about">About</a>
      <a href="#section-contact" class="profile-jump-link" data-section-link="section-contact">How to reach out</a>
      <a href="#section-faq" class="profile-jump-link" data-section-link="section-faq">FAQ</a>
    </nav>
  </div>
  <div class="profile-body">
    <div>
      ${
        specialties.length
          ? `<section class="profile-section profile-section-collapsible" data-profile-section>
          <button type="button" class="profile-section-header" aria-expanded="true">
            <span><span class="section-kicker">Focus areas</span><h2>Specialties</h2></span>
            <span class="section-toggle">Hide</span>
          </button>
          <div class="profile-section-content">
            <div class="profile-tags">${specialties.map((s) => `<span class="specialty-tag">${esc(s)}</span>`).join("")}</div>
          </div>
        </section>`
          : ""
      }
      ${
        ins.length || feeLabel
          ? `<section class="profile-section profile-section-collapsible" data-profile-section>
          <button type="button" class="profile-section-header" aria-expanded="true">
            <span><span class="section-kicker">Logistics</span><h2>Fees &amp; insurance</h2></span>
            <span class="section-toggle">Hide</span>
          </button>
          <div class="profile-section-content">
            ${feeLabel ? `<p class="profile-fee-line"><strong>${esc(feeLabel)}</strong></p>` : ""}
            ${
              ins.length
                ? `<ul class="insurance-list">${ins.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
                : ""
            }
          </div>
        </section>`
          : ""
      }
      <section class="profile-section profile-section-collapsible" id="section-contact" data-profile-section data-profile-contact-section>
        <button type="button" class="profile-section-header" aria-expanded="true">
          <span><span class="section-kicker">Outreach</span><h2>How to reach out</h2></span>
          <span class="section-toggle">Hide</span>
        </button>
        <div class="profile-section-content">
          <p class="outreach-intro">Reaching out is easier than it feels. The full outreach guide loads below.</p>
          ${t.phone ? `<a href="tel:${esc(phoneDigits)}" class="btn-contact" data-profile-contact-route="phone" data-profile-contact-priority="primary">Call ${esc(t.phone)}</a>` : ""}
          ${t.website ? `<a href="${esc(t.website)}" target="_blank" rel="noopener noreferrer" class="btn-contact btn-contact--secondary" data-profile-contact-route="website" data-profile-contact-priority="secondary">Visit website →</a>` : ""}
        </div>
      </section>
      <section class="profile-section profile-section-collapsible" id="section-faq" data-profile-section>
        <button type="button" class="profile-section-header" aria-expanded="true">
          <span><span class="section-kicker">Questions</span><h2>Frequently asked questions</h2></span>
          <span class="section-toggle">Hide</span>
        </button>
        <div class="profile-section-content">
          <p class="faq-intro">Common questions about ${esc(t.name)}.</p>
          <div class="faq-list">
            ${faqItems
              .map(
                (item, i) => `
              <div class="faq-item" data-faq-item>
                <button type="button" class="faq-question" aria-expanded="false" aria-controls="faq-answer-${i}" data-faq-toggle="${i}">
                  ${esc(item.q)}<span class="faq-toggle-icon" aria-hidden="true">+</span>
                </button>
                <div class="faq-answer" id="faq-answer-${i}" role="region" hidden>
                  <p>${esc(item.a)}</p>
                </div>
              </div>`,
              )
              .join("")}
          </div>
        </div>
      </section>
    </div>
    <div class="profile-sidebar-stack"></div>
    <div class="profile-foot-actions">
      <a href="/directory" class="profile-foot-back">← Back to Directory</a>
    </div>
  </div>`;
}

// ─── Full page HTML ───────────────────────────────────────────────────────────

function buildPage(t) {
  const { linkTags, scriptTags } = getAssetTags();
  const nameWithCreds = t.credentials ? t.name + ", " + t.credentials : t.name;
  const location = [t.city, t.state].filter(Boolean).join(", ") || "";
  const seoTitle = `${nameWithCreds}, Bipolar Therapist in ${location} | BipolarTherapyHub`;
  const seoDescription = buildSeoDescription(t);
  const canonicalUrl = `${ORIGIN}/therapists/${encodeURIComponent(t.slug)}/`;
  // Twitter / Facebook large-card preview wants a 1.91:1 image
  // (1200×630). We point to a branded card generated at build time by
  // scripts/generate-og-cards.mjs and served as a static asset from
  // /og/therapists/<slug>.png. It lays out the therapist's photo (or
  // initials avatar fallback), name, credentials, city, and an
  // accepting-new-patients pill on the brand palette — far better than
  // handing crawlers a raw headshot cropped to a weird aspect. Note the
  // path is /og/…, NOT /api/og/… — the latter 404s (and robots.txt
  // disallows /api/), which silently breaks the card on X/Facebook.
  const ogImage = `${ORIGIN}/og/therapists/${encodeURIComponent(t.slug)}.png?${OG_CARD_VERSION}`;
  // Alt text for the share-card image. Mirrors the photo alt on the
  // page itself — name + credentials + city — so accessibility tools
  // and crawler indexing see consistent context for the same asset.
  const ogImageAlt = (() => {
    const parts = [nameWithCreds];
    if (location) parts.push("Bipolar therapist in " + location);
    return parts.join(" — ").replace(/—/g, "·"); // copy rule: no em-dashes
  })();
  const shareTitle = nameWithCreds + ", Bipolar Therapist in " + location;
  const jsonLd = buildJsonLd(t);
  const profileHtml = renderSSRProfile(t);
  const safeData = JSON.stringify(t).replace(/<\/script>/gi, "<\\/script>");

  return `<!doctype html>
<html lang="en">
  <head>
    <!-- Google Analytics -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-Q22R5G7VB5"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag() { dataLayer.push(arguments); }
      gtag("js", new Date());
      gtag("config", "G-Q22R5G7VB5");
    </script>
    <meta charset="UTF-8" />
    <link rel="preconnect" href="https://cdn.sanity.io" crossorigin />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/favicon.png" />
    <title>${esc(seoTitle)}</title>
    <meta name="description" content="${esc(seoDescription)}" />
    <link rel="canonical" href="${esc(canonicalUrl)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="BipolarTherapyHub" />
    <meta property="og:url" content="${esc(canonicalUrl)}" />
    <meta property="og:title" content="${esc(shareTitle)}" />
    <meta property="og:description" content="${esc(seoDescription)}" />
    <meta property="og:image" content="${esc(ogImage)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(ogImageAlt)}" />
    <!-- summary_large_image gives the big preview card on Twitter
         instead of a tiny thumbnail. Requires a 1.91:1 image, which
         buildOgImageFromSanity produces above. -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:url" content="${esc(canonicalUrl)}" />
    <meta name="twitter:title" content="${esc(shareTitle)}" />
    <meta name="twitter:description" content="${esc(seoDescription)}" />
    <meta name="twitter:image" content="${esc(ogImage)}" />
    <meta name="twitter:image:alt" content="${esc(ogImageAlt)}" />
    ${jsonLd}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Lora:wght@400;600&display=swap" rel="stylesheet" />
${linkTags}
    <!-- Therapist data for client-side hydration — avoids a second Sanity fetch -->
    <script>window.__THERAPIST_DATA__ = ${safeData};</script>
  </head>
  <body>
    <nav>
      <a href="/" class="nav-logo">
        <span class="nav-name">BipolarTherapy<span>Hub</span></span>
      </a>
      <ul class="nav-links">
        <li><a href="/directory" class="nav-link-current">Find a Therapist</a></li>
        <li>
          <a href="/directory" class="nav-shortlist" data-shortlist-link
            >List <span class="nav-shortlist-count" data-shortlist-count>0</span></a>
        </li>
        <li class="nav-zone-switch-item">
          <a href="/signup" class="nav-zone-switch">For therapists →</a>
        </li>
      </ul>
    </nav>
    <div class="public-mobile-nav" aria-label="Mobile navigation">
      <a href="/" class="public-mobile-nav-link">
        <span class="public-mobile-nav-kicker">Start</span>
        <span class="public-mobile-nav-title">Homepage</span>
        <span class="public-mobile-nav-copy">Reorient fast</span>
      </a>
      <a href="/directory" class="public-mobile-nav-link">
        <span class="public-mobile-nav-kicker">Browse</span>
        <span class="public-mobile-nav-title">Directory</span>
        <span class="public-mobile-nav-copy">Keep context</span>
      </a>
      <span class="public-mobile-nav-link is-current" aria-current="page">
        <span class="public-mobile-nav-kicker">Profile</span>
        <span class="public-mobile-nav-title">Decision view</span>
        <span class="public-mobile-nav-copy">Saved <span data-shortlist-count>0</span> ready</span>
      </span>
    </div>

    <div class="breadcrumb">
      <a href="/">Home</a> › <a href="/directory" id="breadcrumbDirectoryLink">Directory</a> ›
      <span id="breadcrumbName">${esc(t.name)}</span>
    </div>

    <aside class="ts-claim-banner" id="inPageClaimBanner">
      <span class="ts-claim-banner-text">Is this your listing?</span>
      <a href="/claim" id="heroClaimLink" class="ts-claim-banner-cta">Claim your profile →</a>
    </aside>

    <div class="profile-wrap" id="profileWrap" data-ssr-rendered="true">
      ${profileHtml}
    </div>

    <footer>
      <p style="margin-bottom:0.4rem"><strong style="color:white">BipolarTherapyHub</strong></p>
      <p>Is this your listing? <a href="/claim" id="footerClaimLink">Claim or update your listing</a>.</p>
      <p class="footer-legal">
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> ·
        <a href="mailto:support@bipolartherapyhub.com">Contact</a>
      </p>
    </footer>

    <dialog id="reportIssueDialog" class="report-issue-dialog" aria-labelledby="reportIssueTitle">
      <form method="dialog" id="reportIssueForm" class="report-issue-form">
        <button type="button" class="report-issue-close" id="reportIssueClose" aria-label="Close">×</button>
        <h2 id="reportIssueTitle" class="report-issue-title">Report an issue with this listing</h2>
        <p class="report-issue-sub">Tell us what's wrong and we'll review it. Your report is anonymous.</p>
        <fieldset class="report-issue-reasons">
          <legend class="report-issue-legend">What's wrong?</legend>
          <label class="report-issue-radio"><input type="radio" name="reportReason" value="closed_or_moved" required /><span>The practice has closed or moved</span></label>
          <label class="report-issue-radio"><input type="radio" name="reportReason" value="not_bipolar_specialist" /><span>This therapist doesn't actually treat bipolar disorder</span></label>
          <label class="report-issue-radio"><input type="radio" name="reportReason" value="wrong_contact" /><span>The contact info is wrong</span></label>
          <label class="report-issue-radio"><input type="radio" name="reportReason" value="wrong_credentials_or_license" /><span>The credentials or license info looks wrong</span></label>
          <label class="report-issue-radio"><input type="radio" name="reportReason" value="other" /><span>Something else</span></label>
        </fieldset>
        <label class="report-issue-comment-label" for="reportIssueComment">Anything else to share? (optional)</label>
        <textarea id="reportIssueComment" name="reportComment" rows="4" maxlength="500" placeholder="Optional. We read every report."></textarea>
        <div class="report-issue-actions">
          <button type="button" class="report-issue-btn-secondary" id="reportIssueCancel">Cancel</button>
          <button type="submit" class="report-issue-btn-primary">Send report</button>
        </div>
        <div class="report-issue-thanks" id="reportIssueThanks" hidden>
          <p>Thank you. We received your report and will look into it.</p>
        </div>
      </form>
    </dialog>

${scriptTags}
  </body>
</html>`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const slug = req.query.slug;

  if (!slug || typeof slug !== "string") {
    res.writeHead(302, { Location: "/directory" });
    res.end();
    return;
  }

  // Fetch therapist + subscription in parallel
  const subscriptionId = `therapistSubscription-${slug.trim().toLowerCase()}`;
  const [therapistResult, subscription] = await Promise.all([
    fetchSanityResult(THERAPIST_GROQ, { slug }),
    fetchSanity(`*[_id == $id][0]{_id, plan, status}`, { id: subscriptionId }),
  ]);
  const doc = therapistResult.data;

  if (!doc) {
    if (therapistResult.reached) {
      // Sanity answered and there is no active, listed profile for this slug
      // (delisted, unlisted, or never existed). Return 404 so search engines
      // de-index the URL instead of seeing a soft-404 via the SPA shell.
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Robots-Tag", "noindex");
      res.end(buildNotFoundPage());
      return;
    }
    // Sanity unreachable (missing env or transient outage) — fall through to
    // the Vite SPA, which retries client-side, rather than 404 a real profile.
    res.writeHead(302, { Location: `/therapist?slug=${encodeURIComponent(slug)}` });
    res.end();
    return;
  }

  const therapist = normalizeDoc(doc, subscription);
  const html = buildPage(therapist);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  res.statusCode = 200;
  res.end(html);
}
